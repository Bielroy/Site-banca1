// =====================================================================
//  /api/foto.js — FOTO DE PRODUTO → Cloudflare R2 (ou ImgBB, de reserva).
//
//  POST { acao: 'estado' }                          → { ligado, onde: 'r2' | 'imgbb' | '' }
//  POST { imagem: <base64>, nome? }                 → { url }
//
//  O painel reduz a foto no próprio aparelho e manda para cá. Daqui ela
//  vai para o R2 (lib/r2.js, endereço fotos.usebanca.com) e volta o link,
//  que o painel grava no produto. Sem o R2 configurado, ou se o R2 falhar,
//  vai para o ImgBB, como era antes. Sem nenhum dos dois, o painel usa o
//  armazenamento do Firebase (código 'sem-imgbb').
//
//  Nenhuma chave vai para o navegador: as do R2 ficam no ~/segredos.env do
//  servidor; a do ImgBB, na variável IMGBB_API_KEY ou em plataforma/segredos
//  (gravada pela tela Plataforma), que as regras do banco não deixam ninguém ler.
//
//  Travas: só proprietário/administrador da loja; só imagem de verdade
//  (WebP, JPG ou PNG, conferido pelos primeiros bytes); até 1,5 MB.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const P = require('../lib/prudencia');
const R2 = require('../lib/r2');
const crypto = require('crypto');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const H = require('../lib/http');
const cors = H.cors;            // origem (CORS): lista única em lib/http.js

const MAX_BYTES = 1.5 * 1024 * 1024;
const chaveValida = (k) => /^[a-f0-9]{32}$/i.test(String(k || ''));
const TIPO = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** Que imagem é esta? Olha os primeiros bytes; nome e "tipo" enviados pelo navegador não contam. */
function tipoDaImagem(buf) {
  if (buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return '';
}
let _chave = { valor: '', ate: 0 };
async function chaveImgbb() {
  if (chaveValida(process.env.IMGBB_API_KEY)) return process.env.IMGBB_API_KEY;
  if (_chave.ate > Date.now()) return _chave.valor;
  const s = await db.collection('plataforma').doc('segredos').get();
  const k = s.exists && chaveValida(s.data().imgbb) ? s.data().imgbb : '';
  _chave = { valor: k, ate: Date.now() + 60000 };
  return k;
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  let dec, tid;
  try {
    dec = await admin.auth().verifyIdToken(H.tokenDe(req), true);        // true = recusa login encerrado (pessoa tirada da equipe)
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  try { ({ tid } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!T.temPapel(dec, tid)) return res.status(403).json({ error: 'Só o proprietário ou o administrador envia fotos.' });

  try {
    const b = req.body || {}, r2 = R2.config();
    const chave = r2 ? '' : await chaveImgbb();          // com o R2, o ImgBB só é lido se o R2 falhar
    if (b.acao === 'estado') return res.status(200).json({ sucesso: true, ligado: !!(r2 || chave), onde: r2 ? 'r2' : chave ? 'imgbb' : '' });
    if (!r2 && !chave) return res.status(503).json({ error: 'O envio automático de fotos ainda não foi ligado. Peça ao dono da plataforma para colar a chave do ImgBB na tela Plataforma.', codigo: 'sem-imgbb' });

    // Teto de envios: 300 fotos por hora por pessoa (o cadastro em lote de uma loja inteira cabe com folga).
    if (H.passouNaMemoria(`foto:${dec.uid}`, 40, 60000) || !(await P.limitar(db, 'foto', `${tid}|${dec.uid}`, 300, 3600))) return res.status(429).json({ error: 'Muitas fotos enviadas em pouco tempo. Aguarde alguns minutos.' });
    const b64 = String(b.imagem || '').replace(/^data:[^,]*,/, '');
    if (!b64 || b64.length > MAX_BYTES * 1.4 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return res.status(400).json({ error: 'Foto inválida ou grande demais.' });
    const buf = Buffer.from(b64, 'base64'), ext = tipoDaImagem(buf);
    if (buf.length > MAX_BYTES || !ext) return res.status(400).json({ error: 'Envie uma imagem WebP, JPG ou PNG de até 1,5 MB.' });
    const nome = String(b.nome || 'foto').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'foto';

    if (r2) {
      // lojas/<loja>/<nome>-<hora><sorteio>.<tipo>: cada loja na sua pasta; o sorteio impede adivinhar ou sobrescrever
      const arquivo = `lojas/${tid}/${nome}-${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}.${ext}`;
      try {
        return res.status(200).json({ sucesso: true, url: await R2.enviar(arquivo, buf, TIPO[ext]) });
      } catch (e) {
        console.error('[foto] r2', e && e.status, e && e.codigo);
        const reserva = await chaveImgbb().catch(() => '');
        if (!reserva) return res.status(502).json({ error: 'O armazenamento de fotos não aceitou agora. Tente de novo em instantes.' });
        return enviarAoImgbb(res, reserva, buf, tid, nome);            // R2 fora: a foto não se perde, vai para o ImgBB
      }
    }
    return enviarAoImgbb(res, chave, buf, tid, nome);
  } catch (e) {
    console.error('[foto]', e && e.message);
    return res.status(e && e.name === 'AbortError' ? 504 : 500).json({ error: 'Não foi possível enviar a foto. Tente de novo.' });
  }
};

async function enviarAoImgbb(res, chave, buf, tid, nome) {
  try {
    const ctl = new AbortController(), relogio = setTimeout(() => ctl.abort(), 25000);
    let r, corpo;
    try {
      r = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ key: chave, image: buf.toString('base64'), name: `${tid}-${nome}` }).toString() });
      corpo = await r.json().catch(() => null);
    } finally { clearTimeout(relogio); }
    const url = corpo && corpo.data && String(corpo.data.url || '');
    if (!r.ok || !corpo || corpo.success !== true || !/^https:\/\/[^\s"'<>]+$/.test(url)) {
      console.error('[foto] imgbb', r && r.status, corpo && corpo.error && corpo.error.message);
      const chaveRuim = r && (r.status === 400 || r.status === 403) && /key/i.test(String(corpo && corpo.error && corpo.error.message));
      return res.status(502).json({ error: chaveRuim ? 'O ImgBB recusou a chave. Confira a chave na tela Plataforma.' : 'O ImgBB não aceitou a foto agora. Tente de novo em instantes.' });
    }
    return res.status(200).json({ sucesso: true, url });
  } catch (e) {
    console.error('[foto] imgbb', e && e.message);
    return res.status(e && e.name === 'AbortError' ? 504 : 500).json({ error: 'Não foi possível enviar a foto. Tente de novo.' });
  }
}
module.exports.tipoDaImagem = tipoDaImagem;
module.exports.chaveValida = chaveValida;
module.exports._zerar = () => { _chave = { valor: '', ate: 0 }; };
