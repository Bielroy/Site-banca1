// =====================================================================
//  /api/plataforma.js — SUPER ADMIN: o dono da plataforma cuida das lojas.
//  Só entra quem tem  plataforma: true  no login (gravado pelo servidor).
//
//  POST { acao: 'situacao' }                                a plataforma já tem dono? (a tela usa para não oferecer "Assumir")
//  POST { acao: 'lojas' }                                   lista lojas, feiras e o movimento do mês
//  POST { acao: 'lojas-leve' }                              só nome, tipo e cor de cada loja (rápido; é a lista de "trocar de loja" do painel)
//  POST { acao: 'erros' }                                   erros do site nos últimos 7 dias (lib/erros.js)
//  POST { acao: 'erro-estado', assinatura, estado }          marca um erro como corrigido ('corrigido') ou reabre ('aberto')
//  POST { acao: 'criar-loja', id, nome, modelo, tipoNome?, emailDono? }   (modelo = aparência inicial; tipoNome = tipo escrito à mão)
//  POST { acao: 'imgbb', chave }                               liga (ou desliga, com chave vazia) o envio de fotos ao ImgBB
//  POST { acao: 'tipo', id, tipo }                              muda o tipo de negócio de uma loja
//  POST { acao: 'ativo', id, ativo }                        bloquear / liberar
//  POST { acao: 'modulos', id, modulos: { pdv: true, ... } }
//  POST { acao: 'campos', id, campos: { duracao: false, ... } }   campos do cadastro de produto (lib/campos.js)
//  POST { acao: 'proprietario', id, email, remover? }
//  POST { acao: 'condominio', id?, nome, formato, remover? }  cadastro de condomínios da plataforma
//  POST { acao: 'assinatura', id, valor, dia, obs }        mensalidade da banca (valor vazio = tira)
//  POST { acao: 'feira', fid, nome, dias: [0..6], lojas: [ids], condominiosIds: [ids do cadastro], horaLimite: 'HH:MM', semFeira: ['AAAA-MM-DD'] }   dias = dias da semana (vazio = todos); lojas vazio = desfaz a feira
//
//  O primeiro acesso de plataforma ainda é dado pelo terminal
//  (scripts/plataforma.js): não existe tela que promova alguém a dono de tudo.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const { MODELOS, MODULOS } = require('../lib/modelos');
const { CAMPOS_PRODUTO } = require('../lib/campos');
const Segredos = require('../lib/segredos');
const Asaas = require('../lib/asaas');
const P = require('../lib/prudencia');
const crypto = require('crypto');
const Feira = require('../lib/feira');
const Assinatura = require('../lib/assinatura');
const Cond = require('../lib/condominios');
const Erros = require('../lib/erros');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const H = require('../lib/http');
const cors = H.cors;            // origem (CORS): lista única em lib/http.js
const NOME_ORIGINAL = 'Banca Adair e Pedrina', MAX_LOJAS = 200;
const donoRegistrado = new Set();
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

// Movimento do mês e donos de cada loja mudam devagar e custam 2 leituras por loja a cada abertura da tela
// (e a cada botão tocado). Ficam guardados por 90 s na memória deste servidor; trocar o proprietário limpa o dono.
const TTL_LISTA_MS = 90 * 1000;
const guardados = { mov: new Map(), donos: new Map(), leve: null };
const doCache = (mapa, id, ler) => {
  const g = mapa.get(id);
  if (g && Date.now() - g.em < TTL_LISTA_MS) return Promise.resolve(g.v);
  return ler().then((v) => { mapa.set(id, { em: Date.now(), v }); return v; });
};
async function movimentoDoMes(id) { return doCache(guardados.mov, id, () => movimentoDoMesLido(id)); }
async function movimentoDoMesLido(id) {
  try {
    const mes = mesAtual();
    const s = await T.tcol(db, id, 'resumos').where(admin.firestore.FieldPath.documentId(), '>=', `${mes}-01`).get();
    let receita = 0, pedidos = 0;
    s.docs.forEach((d) => { if (d.id.startsWith(mes)) { receita += Number(d.data().receita) || 0; pedidos += Number(d.data().pedidos) || 0; } });
    return { receita: Math.round(receita * 100) / 100, pedidos };
  } catch (_) { return null; }
}
async function donosDe(id) { return doCache(guardados.donos, id, () => donosLidos(id)); }
async function donosLidos(id) {
  try { const s = await T.tcol(db, id, 'equipe').get(); return s.docs.filter((d) => d.data().papel === 'proprietario').map((d) => d.data().email).filter(Boolean).sort(); }
  catch (_) { return []; }
}

async function lojas(res) {
  const [ts, fs, as] = await Promise.all([db.collection('tenants').get(), db.collection('feiras').get(), db.collection('assinaturas').get().catch(() => ({ docs: [] }))]);
  const assinaturas = new Map(as.docs.map((d) => [d.id, Assinatura.limpar(d.data())]));
  const fichas = new Map(ts.docs.map((d) => [d.id, d.data()]));
  if (!fichas.has(T.TENANT_PADRAO)) fichas.set(T.TENANT_PADRAO, { nome: NOME_ORIGINAL, ativo: true });
  const ids = [...fichas.keys()].filter(T.idValido).sort((a, b) => (a === T.TENANT_PADRAO ? -1 : b === T.TENANT_PADRAO ? 1 : a.localeCompare(b))).slice(0, MAX_LOJAS);
  const lista = await Promise.all(ids.map(async (id) => {
    const f = fichas.get(id), [mes, donos] = await Promise.all([movimentoDoMes(id), donosDe(id)]);
    const modulos = {}; Object.keys(MODULOS).forEach((m) => { modulos[m] = m === 'ia' && id !== T.TENANT_PADRAO ? !!(f.modulos && f.modulos.ia === true) : T.moduloAtivo(f, m); });
    return { id, nome: f.nome || id, tipo: f.tipo || '', ativo: f.ativo !== false, original: id === T.TENANT_PADRAO, feiraId: f.feiraId || '', cor: (f.tema && f.tema.primaria) || '#1a3a2a', criadoEm: f.criadoEm || '', modulos, campos: camposMarcados(f), mes, donos, assinatura: assinaturas.get(id) || null };
  }));
  const condominios = await Cond.garantir(db, T);   // sem o cadastro, a tela não abre (senão salvar uma feira apagaria os condomínios dela)
  const feiras = fs.docs.map((d) => ({ id: d.id, nome: d.data().nome || d.id, condominiosIds: Cond.idsDaFeira(condominios, d.data()), dias: Array.isArray(d.data().dias) ? d.data().dias.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [], lojas: (d.data().lojas || []).map((l) => l.id), condominios: Array.isArray(d.data().condominios) ? d.data().condominios.filter((c) => typeof c === 'string').slice(0, 40) : [], horaLimite: Feira.limparHora(d.data().horaLimite), semFeira: Feira.limparDatas(d.data().semFeira) }));
  const seg = await db.collection('plataforma').doc('segredos').get();
  const fotos = /^[a-f0-9]{32}$/i.test(String(process.env.IMGBB_API_KEY || (seg.exists && seg.data().imgbb) || ''));
  const pix = !!process.env.PAGBANK_API_TOKEN || Segredos.tokenPagbankValido(seg.exists && seg.data().pagbank);
  return res.status(200).json({ sucesso: true, lojas: lista, feiras, condominios, modelos: Object.keys(MODELOS), modulos: MODULOS, campos: CAMPOS_PRODUTO, mes: mesAtual(), fotos, pix, asaas: await situacaoAsaas(seg.exists ? seg.data() : {}) });
}

// LISTA LEVE (trocar de loja): só as fichas, sem movimento do mês nem donos. 1 leitura por loja, guardada por 60 s.
async function lojasLeve(res) {
  const g = guardados.leve;
  if (!g || Date.now() - g.em > 60 * 1000) {
    const ts = await db.collection('tenants').get();
    const fichas = new Map(ts.docs.map((d) => [d.id, d.data()]));
    if (!fichas.has(T.TENANT_PADRAO)) fichas.set(T.TENANT_PADRAO, { nome: NOME_ORIGINAL, ativo: true });
    const lista = [...fichas.keys()].filter(T.idValido).sort((a, b) => (a === T.TENANT_PADRAO ? -1 : b === T.TENANT_PADRAO ? 1 : String(fichas.get(a).nome || a).localeCompare(String(fichas.get(b).nome || b), 'pt-BR'))).slice(0, MAX_LOJAS)
      .map((id) => { const f = fichas.get(id); return { id, nome: texto(f.nome || id, 60), tipo: texto(f.tipo, 30), ativo: f.ativo !== false, original: id === T.TENANT_PADRAO, cor: /^#[0-9a-fA-F]{6}$/.test(String(f.tema && f.tema.primaria)) ? f.tema.primaria : '#1a3a2a' }; });
    guardados.leve = { em: Date.now(), lista };
  }
  return res.status(200).json({ sucesso: true, lojas: guardados.leve.lista });
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
  guardados.donos.delete(id);                   // a lista de donos desta loja volta a ser lida na próxima abertura
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
// ---------------------------------------------------------------- Asaas (PIX com carteira por banca)
// A chave fica em plataforma/segredos (a tela só sabe SE existe). O token do aviso é criado aqui e
// mostrado SÓ nesta tela (do dono da plataforma), para colar no cadastro do webhook no Asaas.
async function situacaoAsaas(s) {
  const cfg = await Segredos.asaas(db);
  const carteiras = {};
  for (const [tid, w] of Object.entries(s.carteirasAsaas || {})) if (T.idValido(tid) && Asaas.carteiraValida(w)) carteiras[tid] = w;
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return {
    ligado: !!cfg, ambiente: cfg ? cfg.ambiente : '', viaAmbiente: !!process.env.ASAAS_API_KEY,
    aviso: process.env.ASAAS_WEBHOOK_TOKEN ? '' : (Segredos.avisoAsaasValido(s.asaasAviso) ? s.asaasAviso : ''),
    avisoViaAmbiente: !!process.env.ASAAS_WEBHOOK_TOKEN,
    urlAviso: /^https:\/\//.test(base) ? `${base}/api/pagamento-asaas` : '', carteiras, comissao: Asaas.comissaoPct(),
  };
}
// Desligar: apaga a chave e, se o PagBank também não atende, desliga o "PIX automático" de todas as lojas.
// Sem isso o cliente veria o botão "Pagar com PIX agora" e levaria um erro; assim ele só vê o copia e cola
// da loja (código com o valor do pedido). Para voltar: salvar a chave de novo e ligar a opção em cada loja.
async function desligarPixAutomaticoDasLojas() {
  if (await Segredos.pagbank(db)) return 0;                          // o PagBank continua atendendo: nada a desligar
  const ts = await db.collection('tenants').get();
  const ids = [...new Set([T.TENANT_PADRAO, ...ts.docs.map((d) => d.id)])].filter(T.idValido);
  let n = 0;
  await Promise.all(ids.map(async (id) => {
    const ref = T.docDe(db, id, 'loja/config'), snap = await ref.get();
    if (snap.exists && snap.data().pixAutomatico === true) { await ref.set({ pixAutomatico: false }, { merge: true }); n++; }
  }));
  return n;
}
async function asaas(req, res) {
  const b = req.body || {}, desligar = b.desligar === true, chave = desligar ? '' : String(b.chave || '').trim();
  if (desligar && process.env.ASAAS_API_KEY) throw falha(400, 'A chave está no servidor (variável ASAAS_API_KEY): para desligar, apague-a lá.');
  if (chave && !Segredos.chaveAsaasValida(chave)) throw falha(400, 'Esta não parece uma chave do Asaas. Ela começa com $aact_ e não tem espaços.');
  const ref = db.collection('plataforma').doc('segredos'), atual = (await ref.get()).data() || {};
  const novo = { asaas: chave, asaasEm: new Date().toISOString(), asaasAmbiente: b.ambiente === 'producao' ? 'producao' : 'sandbox' };
  // o token do aviso nasce junto com a chave (ou quando pedem um novo) e não muda ao trocar a chave
  if (chave && (b.novoAviso === true || !Segredos.avisoAsaasValido(atual.asaasAviso))) novo.asaasAviso = crypto.randomBytes(30).toString('base64url');
  await ref.set(novo, { merge: true });
  Segredos._zerar();
  const lojasDesligadas = desligar ? await desligarPixAutomaticoDasLojas() : 0;
  return res.status(200).json({ sucesso: true, ligado: !!chave, lojasDesligadas });
}
async function asaasCarteira(req, res) {
  const b = req.body || {}, id = String(b.id || ''), carteira = String(b.carteira || '').trim().toLowerCase();
  await exigirLoja(id);
  if (id === T.TENANT_PADRAO) throw falha(400, 'A loja original recebe na conta da plataforma: não precisa de carteira.');
  if (carteira && !Asaas.carteiraValida(carteira)) throw falha(400, 'A carteira (walletId) tem o formato 0b763922-aa88-4cbe-a567-e3fe8511fa06. Confira se copiou inteira.');
  // o mapa inteiro é regravado (com merge, uma carteira apagada continuaria lá dentro)
  const ref = db.collection('plataforma').doc('segredos'), atual = (await ref.get()).data() || {};
  const mapa = { ...(atual.carteirasAsaas || {}) };
  if (carteira) mapa[id] = carteira; else delete mapa[id];
  await ref.set({ ...atual, carteirasAsaas: mapa });
  // na ficha pública só vai o SIM/NÃO (o painel da loja libera a opção "PIX automático"); a carteira não
  await fichaRef(id).set({ pixAsaas: !!carteira }, { merge: true });
  Segredos._zerar();
  return res.status(200).json({ sucesso: true, ligado: !!carteira });
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
// só o que a plataforma MARCOU (true/false); o que falta segue o tipo de negócio (js/cadastro-lib.js)
function camposMarcados(f) {
  const c = f && f.campos && typeof f.campos === 'object' ? f.campos : {}, r = {};
  Object.keys(CAMPOS_PRODUTO).forEach((k) => { if (typeof c[k] === 'boolean') r[k] = c[k]; });
  return r;
}
async function campos(req, res) {
  const id = String((req.body || {}).id || ''), f = await exigirLoja(id), pedido = (req.body || {}).campos;
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) throw falha(400, 'Nada para mudar.');
  const novo = camposMarcados(f);
  for (const [k, v] of Object.entries(pedido)) { if (!CAMPOS_PRODUTO[k] || typeof v !== 'boolean') throw falha(400, 'Campo desconhecido.'); novo[k] = v; }
  await fichaRef(id).set({ ...base(f), campos: novo }, { merge: true });
  T._cacheFichas.delete(id);
  return res.status(200).json({ sucesso: true, campos: novo });
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
// Condomínios que a feira atende (o cliente que escolhe um deles cai nesta feira). Mesma regra de js/plataforma-lib.js.
const normCond = (c) => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function limparCondominios(lista) {
  const vistos = new Set(), out = [];
  for (const c of Array.isArray(lista) ? lista.slice(0, 200) : []) {
    const nome = texto(c, 80), k = normCond(nome);
    if (k.length < 2 || vistos.has(k)) continue;
    vistos.add(k); out.push(nome); if (out.length >= 40) break;
  }
  return out;
}
const feirasDe = (f) => [...new Set([...(Array.isArray(f.feiras) ? f.feiras : []), f.feiraId].filter((x) => typeof x === 'string' && T.idValido(x)))];
async function feira(req, res) {
  const b = req.body || {}, fid = exigirId(String(b.fid || '')), nome = texto(b.nome, 60), ids = Array.isArray(b.lojas) ? [...new Set(b.lojas.map(String))] : [];
  const dias = [...new Set((Array.isArray(b.dias) ? b.dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((x, y) => x - y);
  if (ids.length > 12) throw falha(400, 'Uma feira tem no máximo 12 lojas.');
  if (ids.length && nome.length < 2) throw falha(400, 'Dê um nome para a feira.');
  const fichas = []; for (const id of ids) fichas.push([id, await exigirLoja(id)]);
  const refFeira = db.collection('feiras').doc(fid), antiga = await refFeira.get();
  if (b.nova === true && antiga.exists) throw falha(409, 'Já existe uma feira com um nome parecido. Escolha outro nome.');   // feira nova nunca substitui outra
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
  // CONDOMÍNIOS: marcados do cadastro da plataforma (condominiosIds). Telas antigas ainda mandam nomes escritos.
  if (Array.isArray(b.condominiosIds) && new Set(b.condominiosIds).size > 40) throw falha(400, 'Uma feira atende no máximo 40 condomínios.');
  const doCadastro = Array.isArray(b.condominiosIds) ? Cond.copiaParaFeira(Cond.escolher(await Cond.garantir(db, T), b.condominiosIds)) : null;
  const condominios = doCadastro ? doCadastro.condominios : limparCondominios(b.condominios), conds = doCadastro ? doCadastro.conds : [];
  // horário limite do pedido para o mesmo dia (vazio = aceita o dia todo) e datas sem feira (chuva, feriado)
  const horaLimite = Feira.limparHora(b.horaLimite), semFeira = Feira.limparDatas(b.semFeira);
  if (ids.length) lote.set(refFeira, { nome, dias, condominios, conds, horaLimite, semFeira, lojas: fichas.map(([id, f]) => ({ id, nome: f.nome || NOME_ORIGINAL, cor: (f.tema && f.tema.primaria) || '#1a3a2a' })), atualizadoEm: new Date().toISOString() });
  else lote.delete(refFeira);
  await lote.commit();
  saem.concat(ids).forEach((id) => T._cacheFichas.delete(id));
  return res.status(200).json({ sucesso: true });
}

// CADASTRO DE CONDOMÍNIOS (aba Condomínios). Mudar nome/formato atualiza as feiras que usam;
// tirar só deixa quando nenhuma feira usa (senão a feira perderia o condomínio sem ninguém perceber).
async function condominio(req, res) {
  const b = req.body || {}, lista = await Cond.garantir(db, T);
  const nome = texto(b.nome, 80), formato = Cond.FORMATOS.includes(b.formato) ? b.formato : 'ql', id = String(b.id || '');
  const feirasSnap = await db.collection('feiras').get();
  const usam = (cid) => feirasSnap.docs.filter((d) => Cond.idsDaFeira(lista, d.data()).includes(cid));
  if (b.remover === true) {
    const em = usam(id);
    if (em.length) throw falha(409, `Este condomínio está na feira ${em.map((d) => d.data().nome || d.id).join(', ')}. Tire de lá antes.`);
    await Cond.salvar(db, lista.filter((c) => c.id !== id));
    return res.status(200).json({ sucesso: true });
  }
  if (Cond.normCond(nome).length < 2) throw falha(400, 'Escreva o nome do condomínio.');
  const igual = lista.find((c) => Cond.normCond(c.nome) === Cond.normCond(nome) && c.id !== id);
  if (igual) throw falha(409, `Já existe "${igual.nome}" no cadastro.`);
  if (id) {
    const atual = lista.find((c) => c.id === id); if (!atual) throw falha(404, 'Condomínio não encontrado.');
    // o nome antigo vira apelido: cliente com o endereço antigo guardado continua caindo na feira
    const nova = lista.map((c) => (c.id === id ? { ...c, nome, formato, apelidos: Cond.normCond(c.nome) === Cond.normCond(nome) ? c.apelidos || [] : [c.nome, ...(c.apelidos || [])] } : c));
    await Cond.salvar(db, nova);
    // as feiras que usam este condomínio passam a ter o nome e o formato novos
    const lote = db.batch(); let n = 0;
    for (const d of usam(id)) { lote.set(d.ref, Cond.copiaParaFeira(Cond.escolher(Cond.limparLista(nova), Cond.idsDaFeira(lista, d.data()))), { merge: true }); n++; }
    if (n) await lote.commit();
    return res.status(200).json({ sucesso: true });
  }
  if (lista.length >= Cond.MAX) throw falha(400, `O cadastro chegou a ${Cond.MAX} condomínios.`);
  await Cond.salvar(db, [...lista, { nome, formato }]);
  return res.status(200).json({ sucesso: true });
}

// MENSALIDADE da banca: só a plataforma define. O proprietário vê a dele no painel (api/equipe.js).
async function assinatura(req, res) {
  const b = req.body || {}, id = String(b.id || ''); await exigirLoja(id);
  const dados = Assinatura.limpar(b);
  if (!dados && String(b.valor == null ? '' : b.valor).trim() !== '') throw falha(400, 'Confira o valor da mensalidade.');   // valor ilegível não apaga a mensalidade
  if (dados) await Assinatura.ref(db, id).set({ ...dados, atualizadoEm: new Date().toISOString() });
  else await Assinatura.ref(db, id).delete();
  return res.status(200).json({ sucesso: true, assinatura: dados });
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
  // (uma vez por conta e por cópia do servidor: antes era uma transação a cada toque na tela)
  if (!donoRegistrado.has(dec.uid)) {
    try { await db.runTransaction(async (t) => { const r = db.collection('plataforma').doc('dono'), s = await t.get(r); if (!s.exists) t.set(r, { uid: dec.uid, email: dec.email || '', em: new Date().toISOString() }); }); donoRegistrado.add(dec.uid); }
    catch (e) { console.error('[plataforma] dono', e && e.message); }
  }
  const acoes = { auditoria: async () => res.status(200).json({ sucesso: true, registros: await P.lerAuditoria(db, null, 80) }), erros: async () => res.status(200).json({ sucesso: true, erros: await Erros.listar(db, 7) }), 'erro-estado': async () => res.status(200).json({ sucesso: true, ...(await Erros.marcarEstado(db, req.body, dec.email || dec.uid)) }), lojas: () => lojas(res), 'lojas-leve': () => lojasLeve(res), 'criar-loja': () => criarLoja(req, res), ativo: () => ativo(req, res), modulos: () => modulos(req, res), campos: () => campos(req, res), tipo: () => tipo(req, res), imgbb: () => imgbb(req, res), pagbank: () => pagbank(req, res), asaas: () => asaas(req, res), 'asaas-carteira': () => asaasCarteira(req, res), proprietario: () => proprietario(req, res), feira: () => feira(req, res), assinatura: () => assinatura(req, res), condominio: () => condominio(req, res) };
  const nomeAcao = typeof (req.body || {}).acao === 'string' ? (req.body || {}).acao : '';
  const fn = Object.prototype.hasOwnProperty.call(acoes, nomeAcao) ? acoes[nomeAcao] : null;
  if (!fn) return res.status(400).json({ error: 'Ação desconhecida.' });
  // Tudo o que MUDA alguma coisa fica na trilha (auditoria_plataforma). Chave e token nunca entram no registro: só "gravou" ou "apagou".
  if (!['lojas', 'lojas-leve', 'auditoria', 'erros'].includes(nomeAcao)) {
    guardados.leve = null; guardados.mov.clear();          // mexeu em alguma coisa: as listas guardadas são lidas de novo
    const b = req.body || {}, alvo = String(b.id || b.fid || '').slice(0, 40);
    const detalhe = nomeAcao === 'imgbb' || nomeAcao === 'pagbank' || nomeAcao === 'asaas' ? (String(b.chave || '').trim() ? 'chave gravada' : 'chave apagada')
      : nomeAcao === 'asaas-carteira' ? `carteira de ${String(b.id || '').slice(0, 40)} ${String(b.carteira || '').trim() ? 'gravada' : 'apagada'}`
      : nomeAcao === 'proprietario' ? `${alvo}: ${b.remover === true ? 'tirou' : 'definiu'} ${String(b.email || '').slice(0, 80)}`
      : nomeAcao === 'ativo' ? `${alvo}: ${b.ativo === true ? 'liberou' : 'bloqueou'}`
      : nomeAcao === 'criar-loja' ? `${alvo} (${String(b.emailDono || 'sem dono').slice(0, 80)})`
      : nomeAcao === 'condominio' ? `${b.remover === true ? 'tirou' : b.id ? 'mudou' : 'cadastrou'} ${String(b.nome || b.id || '').slice(0, 60)}`
      : nomeAcao === 'erro-estado' ? `${String(b.assinatura || '').slice(0, 20)} ${b.estado === 'aberto' ? 'reaberto' : 'corrigido'}`
      : nomeAcao === 'assinatura' ? `${alvo}: ${String(b.valor == null ? '' : b.valor).trim() === '' ? 'sem mensalidade' : `R$ ${String(b.valor).slice(0, 12)}`}` : alvo;
    await anotar(`plataforma-${nomeAcao}`, detalhe);
    if (['proprietario', 'pagbank', 'asaas', 'asaas-carteira', 'ativo'].includes(nomeAcao)) await P.alertar(db, T.TENANT_PADRAO, `plataforma-${nomeAcao}`, { titulo: 'Plataforma alterada', corpo: `${dec.email || 'O dono da plataforma'} mudou: ${nomeAcao} (${detalhe}).`, url: '/admin-plataforma' });
  }
  try { return await fn(); }
  catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); console.error('[plataforma]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  finally { if (!['lojas', 'lojas-leve', 'auditoria', 'erros'].includes(nomeAcao)) { guardados.leve = null; guardados.mov.clear(); } }   // depois de mudar algo, de novo (uma leitura no meio não pode guardar o antigo)
};
