// =====================================================================
//  /api/foto.js — FOTO DE PRODUTO → Cloudflare R2 (fotos.usebanca.com).
//
//  POST { acao: 'estado' }                          → { ligado, onde: 'r2' | '' }
//  POST { imagem: <base64>, nome? }                 → { url }
//
//  O painel reduz a foto no próprio aparelho e manda para cá. Daqui ela
//  vai para o R2 (lib/r2.js) e volta o link, que o painel grava no produto.
//  O ImgBB não é mais usado (as fotos de lá foram copiadas por server/migrar-fotos.js).
//  Sem o R2 configurado no servidor, responde 'sem-lugar' e o painel usa o
//  armazenamento do Firebase, como fazia antes de existir envio pelo servidor.
//
//  Nenhuma chave vai para o navegador: as do R2 ficam no ~/segredos.env do servidor.
//
//  Travas: só proprietário/administrador da loja; só imagem de verdade
//  (WebP, JPG ou PNG, conferido pelos primeiros bytes); até 1,5 MB; cada loja
//  na sua pasta e nome com sorteio (ninguém adivinha nem sobrescreve a foto de outro).
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
const TIPO = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** Que imagem é esta? Olha os primeiros bytes; nome e "tipo" enviados pelo navegador não contam. */
function tipoDaImagem(buf) {
  if (buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return '';
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
    if (b.acao === 'estado') return res.status(200).json({ sucesso: true, ligado: !!r2, onde: r2 ? 'r2' : '' });
    if (!r2) return res.status(503).json({ error: 'O envio de fotos pelo servidor está desligado (faltam as chaves do Cloudflare R2 no servidor).', codigo: 'sem-lugar' });

    // Teto de envios: 300 fotos por hora por pessoa (o cadastro em lote de uma loja inteira cabe com folga).
    if (H.passouNaMemoria(`foto:${dec.uid}`, 40, 60000) || !(await P.limitar(db, 'foto', `${tid}|${dec.uid}`, 300, 3600))) return res.status(429).json({ error: 'Muitas fotos enviadas em pouco tempo. Aguarde alguns minutos.' });
    const b64 = String(b.imagem || '').replace(/^data:[^,]*,/, '');
    if (!b64 || b64.length > MAX_BYTES * 1.4 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return res.status(400).json({ error: 'Foto inválida ou grande demais.' });
    const buf = Buffer.from(b64, 'base64'), ext = tipoDaImagem(buf);
    if (buf.length > MAX_BYTES || !ext) return res.status(400).json({ error: 'Envie uma imagem WebP, JPG ou PNG de até 1,5 MB.' });
    const nome = String(b.nome || 'foto').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'foto';

    // lojas/<loja>/<nome>-<hora><sorteio>.<tipo>
    const arquivo = `lojas/${tid}/${nome}-${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}.${ext}`;
    try {
      return res.status(200).json({ sucesso: true, url: await R2.enviar(arquivo, buf, TIPO[ext]) });
    } catch (e) {
      console.error('[foto] r2', e && e.status, e && e.codigo);
      const semPermissao = e && (e.status === 401 || e.status === 403);
      return res.status(e && e.name === 'AbortError' ? 504 : 502).json({ error: semPermissao ? 'O armazenamento de fotos recusou a chave do servidor. Avise o dono da plataforma.' : 'O armazenamento de fotos não aceitou agora. Tente de novo em instantes.' });
    }
  } catch (e) {
    console.error('[foto]', e && e.message);
    return res.status(500).json({ error: 'Não foi possível enviar a foto. Tente de novo.' });
  }
};
module.exports.tipoDaImagem = tipoDaImagem;
