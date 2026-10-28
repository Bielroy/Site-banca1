// =====================================================================
//  /api/passkey.js — ENTRAR NO PAINEL COM FACE ID / DIGITAL (verificação em lib/passkey.js).
//
//  SEM LOGIN:
//    POST { acao: 'opcoes-entrada' }                  → { publicKey }  (desafio para o aparelho assinar)
//    POST { acao: 'entrar', resposta }                → { token }      (login do Firebase: signInWithCustomToken)
//  COM LOGIN (quem já entrou pelo link do e-mail e faz parte de alguma equipe):
//    POST { acao: 'opcoes-cadastro' }                 → { publicKey }  (para o aparelho criar a chave)
//    POST { acao: 'cadastrar', resposta }             → guarda a chave pública deste aparelho
//    POST { acao: 'listar' } / { acao: 'remover', id } → aparelhos com Face ID/digital desta conta
//
//  Travas: a entrada só vale para quem AINDA faz parte de alguma equipe (tirou da equipe = a chave para de abrir);
//  conta desativada não entra; "Sair de todos os aparelhos" apaga as chaves (api/equipe.js); cada desafio vale
//  5 minutos e uma vez só; limites de tentativa por conexão. A chave privada nunca sai do aparelho.
// =====================================================================
const admin = require('firebase-admin');
const H = require('../lib/http');
const P = require('../lib/prudencia');
const T = require('../lib/tenant');
const PK = require('../lib/passkey');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
// segredo dos desafios: um próprio (PASSKEY_SEGREDO) ou, sem ele, derivado da chave do servidor (que já é secreta)
const segredo = () => String(process.env.PASSKEY_SEGREDO || process.env.FIREBASE_PRIVATE_KEY || '');
const MAX_POR_CONTA = 10;
const temAlgumPapel = (c) => {
  const x = c || {};
  return x.plataforma === true || x.admin === true || (x.tenants && typeof x.tenants === 'object' && Object.values(x.tenants).some((p) => T.PAPEIS.includes(p)));
};
const col = () => db.collection('passkeys');
const idOk = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{16,1400}$/.test(id);
const aparelhoDe = (ua) => {
  const u = String(ua || '');
  return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Macintosh/.test(u) ? 'Mac' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : 'Aparelho';
};
const recusa = (res, status, msg) => res.status(status).json({ error: msg });

async function opcoesEntrada(req, res) {
  const { rpId } = PK.siteDe(req.headers && req.headers.origin, H.origensPermitidas());
  return res.status(200).json({ sucesso: true, publicKey: { challenge: PK.b64u(Buffer.from(PK.novoDesafio(segredo(), 'entrada'))), rpId, userVerification: 'required', timeout: 120000, allowCredentials: [] } });
}

async function entrar(req, res) {
  const ip = H.ipDe(req), b = req.body || {}, resposta = b.resposta || {};
  if (!(await P.limitar(db, 'passkey-ip', ip, 12, 900))) return recusa(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
  if (!idOk(resposta.id)) return recusa(res, 400, 'Resposta do aparelho estranha.');
  const { origem, rpId } = PK.siteDe(req.headers && req.headers.origin, H.origensPermitidas());
  const ref = col().doc(resposta.id), s = await ref.get();
  if (!s.exists) return recusa(res, 404, 'Esta chave não está mais cadastrada. Entre pelo link do e-mail e ative o Face ID de novo.');
  const chave = s.data();
  let r;
  try { r = PK.verificarEntrada({ resposta, segredo: segredo(), chave, origens: [origem], rpId }); }
  catch (e) { await P.registrar(db, null, { acao: 'passkey-recusada', quem: chave.email || chave.uid, detalhe: String(e.message).slice(0, 80), ip }); return recusa(res, e.status || 400, e.message); }
  // uso único do desafio: gravar o "usado" falha se ele já foi usado (create não sobrescreve)
  try { await db.collection('passkey_usados').doc(PK.sha256(Buffer.from(r.desafio)).toString('hex')).create({ em: new Date().toISOString() }); }
  catch (_) { return recusa(res, 400, 'Este pedido já foi usado. Toque de novo para entrar.'); }
  let u = null;
  try { u = await admin.auth().getUser(chave.uid); } catch (_) { u = null; }
  if (!u || u.disabled === true || !temAlgumPapel(u.customClaims)) {
    await P.registrar(db, null, { acao: 'passkey-sem-acesso', quem: chave.email || chave.uid, detalhe: 'conta fora de todas as equipes', ip });
    return recusa(res, 403, 'Esta conta não tem mais acesso ao painel.');
  }
  await ref.set({ contador: r.contador, usadoEm: new Date().toISOString() }, { merge: true });
  const token = await admin.auth().createCustomToken(u.uid);
  await P.registrar(db, null, { acao: 'login-passkey', quem: u.email || u.uid, uid: u.uid, detalhe: chave.aparelho || '', ip });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ sucesso: true, token });
}

async function comLogin(req, res) {
  let dec;
  try { dec = await admin.auth().verifyIdToken(H.tokenDe(req), true); } catch (_) { return recusa(res, 401, 'Entre no painel de novo.'); }
  if (dec.email_verified === false || !temAlgumPapel(dec)) return recusa(res, 403, 'Esta conta não faz parte de nenhuma equipe.');
  if (H.passouNaMemoria(`passkey:${dec.uid}`, 30, 60000)) return recusa(res, 429, 'Muitos pedidos seguidos. Aguarde um minuto.');
  const b = req.body || {}, acao = b.acao;
  const { origem, rpId } = PK.siteDe(req.headers && req.headers.origin, H.origensPermitidas());
  const minhas = async () => (await col().where('uid', '==', dec.uid).get()).docs;
  if (acao === 'opcoes-cadastro') {
    const ja = (await minhas()).filter((d) => d.data().rpId === rpId).map((d) => ({ type: 'public-key', id: d.id }));
    const email = dec.email || dec.uid;
    return res.status(200).json({ sucesso: true, publicKey: {
      challenge: PK.b64u(Buffer.from(PK.novoDesafio(segredo(), 'cadastro', dec.uid))),
      rp: { name: 'Painel da loja', id: rpId },
      user: { id: PK.b64u(Buffer.from(dec.uid)), name: email, displayName: email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      excludeCredentials: ja, attestation: 'none', timeout: 120000,
    } });
  }
  if (acao === 'cadastrar') {
    let r;
    try { r = PK.verificarCadastro({ resposta: b.resposta, segredo: segredo(), uid: dec.uid, origens: [origem], rpId }); }
    catch (e) { return recusa(res, e.status || 400, e.message); }
    const lista = await minhas();
    if (lista.length >= MAX_POR_CONTA) return recusa(res, 400, `Esta conta já tem ${MAX_POR_CONTA} aparelhos com Face ID ou digital. Tire um antes.`);
    const aparelho = aparelhoDe(req.headers && req.headers['user-agent']);
    await col().doc(r.credId).set({ uid: dec.uid, email: dec.email || '', jwk: r.jwk, alg: r.alg, contador: r.contador, rpId, aparelho, criadoEm: new Date().toISOString() });
    await P.registrar(db, null, { acao: 'passkey-cadastrada', quem: dec.email || dec.uid, uid: dec.uid, detalhe: aparelho, ip: H.ipDe(req) });
    return res.status(200).json({ sucesso: true, aparelho });
  }
  if (acao === 'listar') {
    return res.status(200).json({ sucesso: true, aparelhos: (await minhas()).map((d) => ({ id: d.id, aparelho: d.data().aparelho || 'Aparelho', criadoEm: d.data().criadoEm || '', usadoEm: d.data().usadoEm || '' })) });
  }
  if (acao === 'remover') {
    if (!idOk(b.id)) return recusa(res, 400, 'Aparelho inválido.');
    const s = await col().doc(b.id).get();
    if (s.exists && s.data().uid === dec.uid) await s.ref.delete();
    return res.status(200).json({ sucesso: true });
  }
  return recusa(res, 400, 'Ação desconhecida.');
}

module.exports = async function handler(req, res) {
  H.cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return recusa(res, 405, 'Método não permitido.');
  try { boot(); } catch (_) { return recusa(res, 500, 'Erro interno de configuração.'); }
  if (!segredo()) return recusa(res, 503, 'Face ID ainda não está ligado no servidor.');
  const acao = (req.body || {}).acao;
  try {
    if (acao === 'opcoes-entrada') {
      if (H.passouNaMemoria(`pk-op:${H.ipDe(req)}`, 30, 60000)) return recusa(res, 429, 'Muitas tentativas. Aguarde um minuto.');
      return await opcoesEntrada(req, res);
    }
    if (acao === 'entrar') return await entrar(req, res);
    return await comLogin(req, res);
  } catch (e) { console.error('[passkey]', e && e.message); return recusa(res, 500, 'Não foi possível concluir. Tente de novo.'); }
};
