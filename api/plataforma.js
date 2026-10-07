// =====================================================================
//  /api/plataforma.js — SUPER ADMIN: o dono da plataforma cuida das lojas.
//  Só entra quem tem  plataforma: true  no login (gravado pelo servidor).
//
//  POST { acao: 'situacao' }                                a plataforma já tem dono? (a tela usa para não oferecer "Assumir")
//  POST { acao: 'lojas' }                                   lista lojas, feiras e o movimento do mês
//  POST { acao: 'criar-loja', id, nome, modelo, tipoNome?, emailDono? }   (modelo = aparência inicial; tipoNome = tipo escrito à mão)
//  POST { acao: 'imgbb', chave }                               liga (ou desliga, com chave vazia) o envio de fotos ao ImgBB
//  POST { acao: 'tipo', id, tipo }                              muda o tipo de negócio de uma loja
//  POST { acao: 'ativo', id, ativo }                        bloquear / liberar
//  POST { acao: 'modulos', id, modulos: { pdv: true, ... } }
//  POST { acao: 'proprietario', id, email, remover? }
//  POST { acao: 'feira', fid, nome, dias: [0..6], lojas: [ids] }   dias = dias da semana (vazio = todos); lojas vazio = desfaz a feira
//
//  O primeiro acesso de plataforma ainda é dado pelo terminal
//  (scripts/plataforma.js): não existe tela que promova alguém a dono de tudo.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const { MODELOS, MODULOS } = require('../lib/modelos');
const Segredos = require('../lib/segredos');
const P = require('../lib/prudencia');
const crypto = require('crypto');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const H = require('../lib/http');
const cors = H.cors;            // origem (CORS): lista única em lib/http.js
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
  const feiras = fs.docs.map((d) => ({ id: d.id, nome: d.data().nome || d.id, dias: Array.isArray(d.data().dias) ? d.data().dias.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [], lojas: (d.data().lojas || []).map((l) => l.id) }));
  const seg = await db.collection('plataforma').doc('segredos').get();
  const fotos = /^[a-f0-9]{32}$/i.test(String(process.env.IMGBB_API_KEY || (seg.exists && seg.data().imgbb) || ''));
  const pix = !!process.env.PAGBANK_API_TOKEN || Segredos.tokenPagbankValido(seg.exists && seg.data().pagbank);
  return res.status(200).json({ sucesso: true, lojas: lista, feiras, modelos: Object.keys(MODELOS), modulos: MODULOS, mes: mesAtual(), fotos, pix });
}

async function definirDono(id, email, remover) {
  let u;
  try { u = await admin.auth().getUserByEmail(email); }
  catch (e) { if ((e && e.code !== 'auth/user-not-found') || remover) throw remover ? falha(404, 'Conta não encontrada.') : e; u = await admin.auth().createUser({ email }); }
  // conta que já existia com e-mail nunca confirmado: troca a senha por uma que ninguém conhece antes de dar o papel (ver api/equipe.js)
  if (!remover && u.emailVerified !== true) { try { await admin.auth().updateUser(u.uid, { password: crypto.randomBytes(48).toString('base64') }); await admin.auth().revokeRefreshTokens(u.uid); } catch (e) { console.error('[plataforma] blindar', e && e.code); } }
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
  const b = req.body || {}, id = exigirId(String(b.id || '')), nome = texto(b.nome, 60), modelo = String(b.modelo || 'hortifruti'), tipoNome = texto(b.tipoNome, 30), email = String(b.emailDono || '').trim().toLowerCase();
  if (id === T.TENANT_PADRAO || ['tenants', 'feiras', 'api', 'admin', 'plataforma', 'www'].includes(id)) throw falha(400, 'Este endereço é reservado. Escolha outro.');
  if (nome.length < 2) throw falha(400, 'Dê um nome para a loja.');
  if (!MODELOS[modelo]) throw falha(400, 'Escolha um modelo da lista.');
  if (email && !emailValido(email)) throw falha(400, 'Confira o e-mail do proprietário.');
  if ((await db.collection('tenants').get()).size >= MAX_LOJAS) throw falha(400, `A plataforma chegou ao limite de ${MAX_LOJAS} lojas.`);
  const ref = fichaRef(id);
  await db.runTransaction(async (t) => {
    if ((await t.get(ref)).exists) throw falha(409, 'Já existe uma loja com este endereço.');
    t.set(ref, { nome, tipo: tipoNome || modelo, ativo: true, tema: MODELOS[modelo], modulos: { ia: false }, criadoEm: new Date().toISOString() });
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
// Tipo de negócio escrito à mão ("Padaria", "Açaí"...). É só um rótulo: a aparência fica como está.
async function tipo(req, res) {
  const id = String((req.body || {}).id || ''), f = await exigirLoja(id), nome = texto((req.body || {}).tipo, 30);
  if (nome.length < 2) throw falha(400, 'Escreva o tipo de negócio.');
  await fichaRef(id).set({ ...base(f), tipo: nome }, { merge: true });
  T._cacheFichas.delete(id);
  return res.status(200).json({ sucesso: true });
}
// Chave do ImgBB (hospedagem das fotos). Fica em plataforma/segredos, que ninguém lê pelo navegador.
// A tela só fica sabendo SE existe chave, nunca qual é.
async function imgbb(req, res) {
  const chave = String((req.body || {}).chave || '').trim();
  if (chave && !/^[a-f0-9]{32}$/i.test(chave)) throw falha(400, 'Esta não parece uma chave do ImgBB (são 32 letras e números).');
  await db.collection('plataforma').doc('segredos').set({ imgbb: chave, imgbbEm: new Date().toISOString() }, { merge: true });
  return res.status(200).json({ sucesso: true, ligado: !!chave });
}
// Chave do PagBank (PIX automático). Mesmo cuidado da chave do ImgBB: fica em plataforma/segredos
// e a tela só fica sabendo SE existe. Chave vazia desliga.
async function pagbank(req, res) {
  const chave = String((req.body || {}).chave || '').trim();
  if (chave && !Segredos.tokenPagbankValido(chave)) throw falha(400, 'Este não parece um token do PagBank. Confira se copiou inteiro, sem espaços.');
  await db.collection('plataforma').doc('segredos').set({ pagbank: chave, pagbankEm: new Date().toISOString() }, { merge: true });
  Segredos._zerar();
  return res.status(200).json({ sucesso: true, ligado: !!chave });
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
// FEIRA = um dia (ou mais) da semana + as lojas que vão nesse dia. A mesma loja pode estar em várias
// feiras (quarta num condomínio, sábado em outro); a loja mostra a faixa só da feira de HOJE.
// Na ficha da loja:  feiras: [ids]  (a lista)  e  feiraId  (campo antigo, mantido para telas já abertas).
const MAX_FEIRAS_POR_LOJA = 8;
const feirasDe = (f) => [...new Set([...(Array.isArray(f.feiras) ? f.feiras : []), f.feiraId].filter((x) => typeof x === 'string' && T.idValido(x)))];
async function feira(req, res) {
  const b = req.body || {}, fid = exigirId(String(b.fid || '')), nome = texto(b.nome, 60), ids = Array.isArray(b.lojas) ? [...new Set(b.lojas.map(String))] : [];
  const dias = [...new Set((Array.isArray(b.dias) ? b.dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((x, y) => x - y);
  if (ids.length > 12) throw falha(400, 'Uma feira tem no máximo 12 lojas.');
  if (ids.length && nome.length < 2) throw falha(400, 'Dê um nome para a feira.');
  const fichas = []; for (const id of ids) fichas.push([id, await exigirLoja(id)]);
  const refFeira = db.collection('feiras').doc(fid), antiga = await refFeira.get();
  if (!antiga.exists && ids.length && (await db.collection('feiras').get()).size >= 60) throw falha(400, 'A plataforma chegou ao limite de 60 feiras.');
  const saem = antiga.exists ? (antiga.data().lojas || []).map((l) => l.id).filter((id) => T.idValido(id) && !ids.includes(id)) : [];
  const lote = db.batch();
  for (const id of saem) {
    const s = await fichaRef(id).get(); if (!s.exists) continue;
    const resto = feirasDe(s.data()).filter((x) => x !== fid);
    lote.set(fichaRef(id), { feiras: resto, feiraId: resto[0] || '' }, { merge: true });
  }
  for (const [id, f] of fichas) {
    const lista = [...new Set([...feirasDe(f), fid])];
    if (lista.length > MAX_FEIRAS_POR_LOJA) throw falha(400, `${f.nome || id} já está em ${MAX_FEIRAS_POR_LOJA} feiras. Tire de uma antes.`);
    lote.set(fichaRef(id), { ...base(f), feiras: lista, feiraId: lista[0] }, { merge: true });
  }
  if (ids.length) lote.set(refFeira, { nome, dias, lojas: fichas.map(([id, f]) => ({ id, nome: f.nome || NOME_ORIGINAL, cor: (f.tema && f.tema.primaria) || '#1a3a2a' })), atualizadoEm: new Date().toISOString() });
  else lote.delete(refFeira);
  await lote.commit();
  saem.concat(ids).forEach((id) => T._cacheFichas.delete(id));
  return res.status(200).json({ sucesso: true });
}

async function assumir(dec, res) {
  const donoDaOriginal = dec.admin === true || (dec.tenants && dec.tenants[T.TENANT_PADRAO] === 'proprietario');
  if (!donoDaOriginal && dec.plataforma !== true) throw falha(403, 'Só quem é dono da loja original pode assumir a plataforma.');
  const ref = db.collection('plataforma').doc('dono');
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists && s.data().uid !== dec.uid) throw falha(403, 'A plataforma já tem dono. Peça a ele para criar a sua loja.');
    if (!s.exists) t.set(ref, { uid: dec.uid, email: dec.email || '', em: new Date().toISOString() });
  });
  const u = await admin.auth().getUser(dec.uid);
  await admin.auth().setCustomUserClaims(dec.uid, { ...(u.customClaims || {}), plataforma: true });
  return res.status(200).json({ sucesso: true });
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  let dec;
  try {
    // true = recusa login que foi encerrado ("sair de todos os aparelhos", acesso retirado). É a conta mais poderosa do sistema.
    dec = await admin.auth().verifyIdToken(H.tokenDe(req), true);
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  if (dec.email_verified === false) return res.status(403).json({ error: 'Confirme o e-mail desta conta entrando pelo link enviado a ele.' });
  if (H.passouNaMemoria(`plataforma:${dec.uid}`, 90, 60000)) return res.status(429).json({ error: 'Muitos pedidos seguidos. Aguarde um minuto.' });
  const anotar = (acao, detalhe) => P.registrar(db, null, { acao, quem: dec.email || dec.uid, uid: dec.uid, detalhe, ip: H.ipDe(req) });
  // PRIMEIRO ACESSO, sem terminal: enquanto a plataforma não tem dono, quem já é dono da loja original
  // (a conta antiga, admin: true, ou proprietário da 'banca') pode assumir. Vale UMA vez: fica gravado
  // em plataforma/dono e ninguém mais passa por aqui.
  // A tela pergunta ANTES de oferecer o botão "Assumir": se a plataforma já tem dono, o botão nem aparece.
  if ((req.body || {}).acao === 'situacao') {
    try { const s = await db.collection('plataforma').doc('dono').get(); return res.status(200).json({ sucesso: true, temDono: s.exists, souEu: s.exists && s.data().uid === dec.uid }); }
    catch (e) { console.error('[plataforma] situacao', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  if ((req.body || {}).acao === 'assumir') {
    try { await anotar('plataforma-assumir', 'pediu para assumir a plataforma'); return await assumir(dec, res); }
    catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); console.error('[plataforma] assumir', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  if (dec.plataforma !== true) return res.status(403).json({ error: 'Área restrita ao dono da plataforma.' });
  // Dono que ganhou o acesso pelo terminal (sem passar pelo botão) não tinha o registro em plataforma/dono, e aí
  // outra conta dona da loja original ainda conseguiria assumir. Ao usar a tela, o registro passa a existir.
  try { await db.runTransaction(async (t) => { const r = db.collection('plataforma').doc('dono'), s = await t.get(r); if (!s.exists) t.set(r, { uid: dec.uid, email: dec.email || '', em: new Date().toISOString() }); }); }
  catch (e) { console.error('[plataforma] dono', e && e.message); }
  const acoes = { auditoria: async () => res.status(200).json({ sucesso: true, registros: await P.lerAuditoria(db, null, 80) }), lojas: () => lojas(res), 'criar-loja': () => criarLoja(req, res), ativo: () => ativo(req, res), modulos: () => modulos(req, res), tipo: () => tipo(req, res), imgbb: () => imgbb(req, res), pagbank: () => pagbank(req, res), proprietario: () => proprietario(req, res), feira: () => feira(req, res) };
  const nomeAcao = typeof (req.body || {}).acao === 'string' ? (req.body || {}).acao : '';
  const fn = Object.prototype.hasOwnProperty.call(acoes, nomeAcao) ? acoes[nomeAcao] : null;
  if (!fn) return res.status(400).json({ error: 'Ação desconhecida.' });
  // Tudo o que MUDA alguma coisa fica na trilha (auditoria_plataforma). Chave e token nunca entram no registro: só "gravou" ou "apagou".
  if (nomeAcao !== 'lojas' && nomeAcao !== 'auditoria') {
    const b = req.body || {}, alvo = String(b.id || b.fid || '').slice(0, 40);
    const detalhe = nomeAcao === 'imgbb' || nomeAcao === 'pagbank' ? (String(b.chave || '').trim() ? 'chave gravada' : 'chave apagada')
      : nomeAcao === 'proprietario' ? `${alvo}: ${b.remover === true ? 'tirou' : 'definiu'} ${String(b.email || '').slice(0, 80)}`
      : nomeAcao === 'ativo' ? `${alvo}: ${b.ativo === true ? 'liberou' : 'bloqueou'}`
      : nomeAcao === 'criar-loja' ? `${alvo} (${String(b.emailDono || 'sem dono').slice(0, 80)})` : alvo;
    await anotar(`plataforma-${nomeAcao}`, detalhe);
    if (['proprietario', 'pagbank', 'ativo'].includes(nomeAcao)) await P.alertar(db, T.TENANT_PADRAO, `plataforma-${nomeAcao}`, { titulo: 'Plataforma alterada', corpo: `${dec.email || 'O dono da plataforma'} mudou: ${nomeAcao} (${detalhe}).`, url: '/plataforma.html' });
  }
  try { return await fn(); }
  catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); console.error('[plataforma]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
};
