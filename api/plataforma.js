// =====================================================================
//  /api/plataforma.js — SUPER ADMIN: o dono da plataforma cuida das lojas.
//  Só entra quem tem  plataforma: true  no login (gravado pelo servidor).
//
//  POST { acao: 'lojas' }                                   lista lojas, feiras e o movimento do mês
//  POST { acao: 'criar-loja', id, nome, modelo, emailDono? }
//  POST { acao: 'ativo', id, ativo }                        bloquear / liberar
//  POST { acao: 'modulos', id, modulos: { pdv: true, ... } }
//  POST { acao: 'proprietario', id, email, remover? }
//  POST { acao: 'feira', fid, nome, lojas: [ids] }          lojas vazio = desfaz a feira
//
//  O primeiro acesso de plataforma ainda é dado pelo terminal
//  (scripts/plataforma.js): não existe tela que promova alguém a dono de tudo.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const { MODELOS, MODULOS } = require('../lib/modelos');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const ORIGENS = ['https://www.bancaadairepedrina.com.br', 'https://bancaadairepedrina.com.br', 'https://site-banca1.vercel.app'];
const cors = (req, res) => {
  const extras = String(process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = ORIGENS.concat(extras), origem = req.headers && req.headers.origin;
  if (origem && ok.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  else if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') res.setHeader('Access-Control-Allow-Origin', '*');
  else res.setHeader('Access-Control-Allow-Origin', ok[0]);
  res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Loja');
};
const NOME_ORIGINAL = 'Banca Adair e Pedrina', MAX_LOJAS = 200;
const falha = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const emailValido = (e) => /^[^\s@]{1,64}@[^\s@]{1,180}\.[a-z]{2,}$/i.test(e);
const exigirId = (id) => { if (!T.idValido(id)) throw falha(400, 'Endereço da loja inválido: use letras minúsculas, números e hífen (2 a 40).'); return id; };
const fichaRef = (id) => db.collection('tenants').doc(id);
async function exigirLoja(id) {
  exigirId(id);
  const s = await fichaRef(id).get();
  if (!s.exists && id !== T.TENANT_PADRAO) throw falha(404, 'Loja não encontrada.');
  return s.exists ? s.data() : { nome: NOME_ORIGINAL, ativo: true, _nova: true };
}
// a loja original pode ainda não ter ficha: na primeira gravação ela nasce com nome e ligada
const base = (f) => (f._nova ? { nome: NOME_ORIGINAL, ativo: true } : {});
const mesAtual = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7);

async function movimentoDoMes(id) {
  try {
    const mes = mesAtual();
    const s = await T.tcol(db, id, 'resumos').where(admin.firestore.FieldPath.documentId(), '>=', `${mes}-01`).get();
    let receita = 0, pedidos = 0;
    s.docs.forEach((d) => { if (d.id.startsWith(mes)) { receita += Number(d.data().receita) || 0; pedidos += Number(d.data().pedidos) || 0; } });
    return { receita: Math.round(receita * 100) / 100, pedidos };
  } catch (_) { return null; }
}
async function donosDe(id) {
  try { const s = await T.tcol(db, id, 'equipe').get(); return s.docs.filter((d) => d.data().papel === 'proprietario').map((d) => d.data().email).filter(Boolean).sort(); }
  catch (_) { return []; }
}

async function lojas(res) {
  const [ts, fs] = await Promise.all([db.collection('tenants').get(), db.collection('feiras').get()]);
  const fichas = new Map(ts.docs.map((d) => [d.id, d.data()]));
  if (!fichas.has(T.TENANT_PADRAO)) fichas.set(T.TENANT_PADRAO, { nome: NOME_ORIGINAL, ativo: true });
  const ids = [...fichas.keys()].filter(T.idValido).sort((a, b) => (a === T.TENANT_PADRAO ? -1 : b === T.TENANT_PADRAO ? 1 : a.localeCompare(b))).slice(0, MAX_LOJAS);
  const lista = await Promise.all(ids.map(async (id) => {
    const f = fichas.get(id), [mes, donos] = await Promise.all([movimentoDoMes(id), donosDe(id)]);
    const modulos = {}; Object.keys(MODULOS).forEach((m) => { modulos[m] = m === 'ia' && id !== T.TENANT_PADRAO ? !!(f.modulos && f.modulos.ia === true) : T.moduloAtivo(f, m); });
    return { id, nome: f.nome || id, tipo: f.tipo || '', ativo: f.ativo !== false, original: id === T.TENANT_PADRAO, feiraId: f.feiraId || '', cor: (f.tema && f.tema.primaria) || '#1a3a2a', criadoEm: f.criadoEm || '', modulos, mes, donos };
  }));
  const feiras = fs.docs.map((d) => ({ id: d.id, nome: d.data().nome || d.id, lojas: (d.data().lojas || []).map((l) => l.id) }));
  return res.status(200).json({ sucesso: true, lojas: lista, feiras, modelos: Object.keys(MODELOS), modulos: MODULOS, mes: mesAtual() });
}

async function definirDono(id, email, remover) {
  let u;
  try { u = await admin.auth().getUserByEmail(email); }
  catch (e) { if ((e && e.code !== 'auth/user-not-found') || remover) throw remover ? falha(404, 'Conta não encontrada.') : e; u = await admin.auth().createUser({ email }); }
  const claims = u.customClaims || {}, tenants = { ...(claims.tenants || {}) };
  if (remover) { if (tenants[id] !== 'proprietario') throw falha(400, 'Esta conta não é proprietária desta loja.'); delete tenants[id]; } else tenants[id] = 'proprietario';
  const novos = { ...claims, tenants };
  if (JSON.stringify(novos).length > 900) throw falha(400, 'Esta conta já participa de lojas demais.');
  await admin.auth().setCustomUserClaims(u.uid, novos);
  const ref = T.tdoc(db, id, 'equipe', u.uid);
  if (remover) { await ref.delete(); try { await admin.auth().revokeRefreshTokens(u.uid); } catch (_) { /* o papel já saiu */ } }
  else await ref.set({ email, papel: 'proprietario', em: new Date().toISOString(), por: 'plataforma' });
}

async function criarLoja(req, res) {
  const b = req.body || {}, id = exigirId(String(b.id || '')), nome = texto(b.nome, 60), modelo = String(b.modelo || 'hortifruti'), email = String(b.emailDono || '').trim().toLowerCase();
  if (id === T.TENANT_PADRAO || ['tenants', 'feiras', 'api', 'admin', 'plataforma', 'www'].includes(id)) throw falha(400, 'Este endereço é reservado. Escolha outro.');
  if (nome.length < 2) throw falha(400, 'Dê um nome para a loja.');
  if (!MODELOS[modelo]) throw falha(400, 'Escolha um modelo da lista.');
  if (email && !emailValido(email)) throw falha(400, 'Confira o e-mail do proprietário.');
  if ((await db.collection('tenants').get()).size >= MAX_LOJAS) throw falha(400, `A plataforma chegou ao limite de ${MAX_LOJAS} lojas.`);
  const ref = fichaRef(id);
  await db.runTransaction(async (t) => {
    if ((await t.get(ref)).exists) throw falha(409, 'Já existe uma loja com este endereço.');
    t.set(ref, { nome, tipo: modelo, ativo: true, tema: MODELOS[modelo], modulos: { ia: false }, criadoEm: new Date().toISOString() });
    t.set(T.docDe(db, id, 'loja/config'), { lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], minimo: 0, wpp: '' }, { merge: true });
  });
  if (email) await definirDono(id, email, false);
  T._cacheFichas.delete(id);
  return res.status(200).json({ sucesso: true, id });
}

async function ativo(req, res) {
  const id = String((req.body || {}).id || ''), f = await exigirLoja(id);
  await fichaRef(id).set({ ...base(f), ativo: (req.body || {}).ativo === true }, { merge: true });
  T._cacheFichas.delete(id);
  return res.status(200).json({ sucesso: true });
}
async function modulos(req, res) {
  const id = String((req.body || {}).id || ''), f = await exigirLoja(id), pedido = (req.body || {}).modulos;
  if (!pedido || typeof pedido !== 'object') throw falha(400, 'Nada para mudar.');
  const novo = { ...(f.modulos || {}) };
  for (const [k, v] of Object.entries(pedido)) { if (!MODULOS[k] || typeof v !== 'boolean') throw falha(400, 'Módulo desconhecido.'); novo[k] = v; }
  await fichaRef(id).set({ ...base(f), modulos: novo }, { merge: true });
  T._cacheFichas.delete(id);
  return res.status(200).json({ sucesso: true, modulos: novo });
}
async function proprietario(req, res) {
  const b = req.body || {}, id = String(b.id || ''), email = String(b.email || '').trim().toLowerCase(); await exigirLoja(id);
  if (!emailValido(email)) throw falha(400, 'Confira o e-mail.');
  await definirDono(id, email, b.remover === true);
  return res.status(200).json({ sucesso: true });
}
async function feira(req, res) {
  const b = req.body || {}, fid = exigirId(String(b.fid || '')), nome = texto(b.nome, 60), ids = Array.isArray(b.lojas) ? [...new Set(b.lojas.map(String))] : [];
  if (ids.length === 1 || ids.length > 12) throw falha(400, 'Uma feira tem de 2 a 12 lojas.');
  if (ids.length && nome.length < 2) throw falha(400, 'Dê um nome para a feira.');
  const fichas = []; for (const id of ids) fichas.push([id, await exigirLoja(id)]);
  const refFeira = db.collection('feiras').doc(fid), antiga = await refFeira.get();
  const saem = antiga.exists ? (antiga.data().lojas || []).map((l) => l.id).filter((id) => !ids.includes(id)) : [];
  const lote = db.batch();
  saem.forEach((id) => lote.set(fichaRef(id), { feiraId: '' }, { merge: true }));
  fichas.forEach(([id, f]) => lote.set(fichaRef(id), { ...base(f), feiraId: fid }, { merge: true }));
  if (ids.length) lote.set(refFeira, { nome, lojas: fichas.map(([id, f]) => ({ id, nome: f.nome || NOME_ORIGINAL, cor: (f.tema && f.tema.primaria) || '#1a3a2a' })), atualizadoEm: new Date().toISOString() });
  else lote.delete(refFeira);
  await lote.commit();
  saem.concat(ids).forEach((id) => T._cacheFichas.delete(id));
  return res.status(200).json({ sucesso: true });
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  let dec;
  try {
    const cab = String((req.headers && req.headers.authorization) || '');
    dec = await admin.auth().verifyIdToken(cab.startsWith('Bearer ') ? cab.slice(7).trim() : '');
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  if (dec.plataforma !== true) return res.status(403).json({ error: 'Área restrita ao dono da plataforma.' });
  const acoes = { lojas: () => lojas(res), 'criar-loja': () => criarLoja(req, res), ativo: () => ativo(req, res), modulos: () => modulos(req, res), proprietario: () => proprietario(req, res), feira: () => feira(req, res) };
  const fn = acoes[(req.body || {}).acao];
  if (!fn) return res.status(400).json({ error: 'Ação desconhecida.' });
  try { return await fn(); }
  catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); console.error('[plataforma]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
};
