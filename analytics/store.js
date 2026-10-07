'use strict';
// =====================================================================
//  analytics/store.js — ÚNICA camada que fala com o Firestore (Admin SDK).
//
//  Coleções (todas só acessíveis pelo servidor — ver ANALYTICS.md p/ rules):
//   analytics_vendas/{YYYY-MM-DD}   agregado diário por produto (histórico longo, barato)
//   analytics_clientes/{clienteId}  perfil comportamental compacto
//   analytics_uid/{uid}             uid anônimo do Firebase → clienteId
//   analytics_global/atual          popularidade, dia-da-semana, associações, catálogo compacto
//   analytics_previsoes/painel      dashboard + clientes esperados + índice de clientes
//   analytics_previsoes_chunks/c{n} previsões por produto (fatiadas p/ caber em 1 MiB)
//   analytics_snapshots/{id}        previsão congelada p/ comparar com o realizado
//   analytics_avaliacao/{id}        erro medido (MAE/RMSE/WAPE/cobertura)
//   analytics_config/params|eventos overrides de parâmetros e datas especiais (opcional)
//   analytics_meta/execucao         trava anti-concorrência
// =====================================================================
const admin = require('firebase-admin');
const C = require('./config');
// Janela padrão lida UMA vez: o motor reescreve C.JANELA_DIAS a cada execução,
// e depois de um "importar 365 dias" todo cálculo seguinte relia o ano inteiro.
const JANELA_PADRAO = C.JANELA_DIAS;
const { diaDeTs, isoDeDia } = require('./normalize');

let _db;
function obterDb() {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID, clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
    if (!projectId || !clientEmail || !privateKey) throw new Error('Variáveis do Firebase ausentes no ambiente.');
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  }
  if (!_db) { _db = admin.firestore(); try { _db.settings({ ignoreUndefinedProperties: true }); } catch (_) { /* já configurado */ } }
  return _db;
}

// JSON round-trip: remove undefined, converte NaN/Infinity em null → sempre aceito pelo Firestore
const limpo = (o) => JSON.parse(JSON.stringify(o));
const bytes = (o) => Buffer.byteLength(JSON.stringify(o));

async function lerLoteadoEscrita(db, ops) {   // ops: [{tipo:'set'|'update'|'delete', ref, dados, merge}]
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach((o) => {
      if (o.tipo === 'delete') b.delete(o.ref); else if (o.tipo === 'update') b.update(o.ref, o.dados); else b.set(o.ref, o.dados, o.campos ? { mergeFields: o.campos } : o.merge ? { merge: true } : {});
    });
    await b.commit();
  }
}

// ---------------------------------------------------------------------
//  ENTRADAS
// ---------------------------------------------------------------------
const { paraMotor } = require('../lib/calendario');
const Clima = require('../lib/clima');
async function carregarEntradas(db, { janelaDias } = {}) {
  const [cfgP, evP, cfgLoja, calSnap] = await Promise.all([db.doc('analytics_config/params').get(), db.doc('analytics_config/eventos').get(), db.doc('loja/config').get(),
    db.collection('calendario').get().catch(() => ({ docs: [] }))]);          // calendário operacional (aba Calendário do painel)
  const parametros = cfgP.exists ? cfgP.data() : {};
  // Eventos que mexem na procura: os antigos (analytics_config/eventos) + promoções, eventos, feriados locais
  // e datas especiais do calendário. O motor só usa um efeito depois de ver o mesmo nome 2 vezes.
  const hojeCal = diaDeTs(Date.now());
  const doCalendario = paraMotor(calSnap.docs.map((d) => d.data()), isoDeDia(hojeCal - C.JANELA_LONGA_DIAS), isoDeDia(hojeCal + 45));
  const eventos = (evP.exists ? (evP.data().lista || []) : []).concat(doCalendario);
  const dias = Math.min(Math.max(Number(janelaDias) || Number(parametros.JANELA_DIAS) || JANELA_PADRAO, 14), 900);

  const agora = Date.now(), hoje = diaDeTs(agora);
  // início do 1º dia da janela em horário de Brasília → ISO UTC
  const desde = new Date((hoje - dias) * 86400000 - C.TZ_OFFSET_HORAS * 3600000).toISOString();

  const [pedSnap, prodSnap, aggSnap, snapSnap, fechSnap, zerouSnap, clima] = await Promise.all([
    db.collection('pedidos').where('data', '>=', desde).orderBy('data', 'asc').limit(C.MAX_PEDIDOS).get(),
    db.collection('produtos').get(),
    db.collection('analytics_vendas').where(admin.firestore.FieldPath.documentId(), '>=', isoDeDia(hoje - C.JANELA_LONGA_DIAS)).get(),
    db.collection('analytics_snapshots').where('avaliado', '==', false).get(),
    // Fechamento da feira: dias em que cada produto acabou. Se a leitura falhar, o motor segue sem essa correção.
    db.collection('fechamentos').where('dia', '>=', isoDeDia(hoje - C.JANELA_LONGA_DIAS)).get().catch(() => ({ docs: [] })),
    // Vendas que ZERARAM o estoque: naquele dia o produto acabou, mesmo sem ninguém marcar no Fechamento.
    db.collection('estoque_mov').where('saldo', '<=', 0).limit(4000).get().catch(() => ({ docs: [] })),
    // Clima da cidade da loja (passado + previsão). Sem cidade ou sem resposta, segue com o que já estava guardado.
    Clima.atualizar(db, cfgLoja.exists ? cfgLoja.data() : {}, agora).catch((e) => ({ cidade: '', lugar: '', dias: {}, atualizado: false, motivo: String(e && e.message).slice(0, 80) })),
  ]);
  const brt = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? isoDeDia(diaDeTs(t)) : null; };
  return {
    pedidos: pedSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
    catalogo: prodSnap.docs.map((d) => ({ ...d.data(), id: d.id })),     // o id do registro sempre vale (produto antigo trazia um campo "id" velho dentro)
    agregados: aggSnap.docs.map((d) => ({ ...d.data(), dia: d.id })),
    snapshots: snapSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
    fechamentos: fechSnap.docs.map((d) => ({ dia: d.data().dia || d.id, itens: d.data().itens || {} })),
    faltasEstoque: zerouSnap.docs.map((d) => d.data()).filter((m) => m && m.tipo === 'venda' && m.produtoId && brt(m.em)).map((m) => ({ produtoId: String(m.produtoId), dia: brt(m.em) })),
    clima,
    // o retrato de preços de hoje já foi guardado? (o primeiro cálculo do dia, de madrugada, é o que vale)
    temRetratoHoje: aggSnap.docs.some((d) => d.id === isoDeDia(hoje) && d.data().precos),
    parametros: { ...parametros, JANELA_DIAS: dias }, eventos,
    diasAbertos: cfgLoja.exists ? cfgLoja.data().diasAbertos : undefined,
    truncado: pedSnap.size >= C.MAX_PEDIDOS, agora,
  };
}

// ---------------------------------------------------------------------
//  SAÍDAS
// ---------------------------------------------------------------------
function fatiar(obj, limite) {
  const chunks = []; let atual = {}, tam = 0;
  for (const [k, v] of Object.entries(obj)) {
    const b = bytes(v) + k.length + 16;
    if (tam + b > limite && Object.keys(atual).length) { chunks.push(atual); atual = {}; tam = 0; }
    atual[k] = v; tam += b;
  }
  if (Object.keys(atual).length) chunks.push(atual);
  return chunks;
}

async function persistir(db, r, opcoes = {}) {
  const ops = [], ts = new Date().toISOString();
  const set = (path, dados, merge) => ops.push({ tipo: 'set', ref: db.doc(path), dados: limpo(dados), merge });

  set('analytics_global/atual', { meta: r.meta, global: r.global, catalogo: r.catalogo });
  set('analytics_previsoes/painel', { meta: r.meta, dashboard: r.dashboard, esperados: r.esperados, categorias: r.categorias, loja: r.loja, indiceClientes: r.indiceClientes });

  // 250 KB por documento: fatias maiores chegavam perto do limite de 40 mil
  // campos indexados por documento do Firestore com ~100 produtos previstos.
  const chunks = fatiar(r.previsoes, 250000);
  chunks.forEach((c, i) => set(`analytics_previsoes_chunks/c${i}`, { n: i, produtos: c, geradoEm: ts }));
  const antigos = await db.collection('analytics_previsoes_chunks').get();
  antigos.docs.forEach((d) => { if (Number(d.id.slice(1)) >= chunks.length) ops.push({ tipo: 'delete', ref: d.ref }); });

  r.clientes.forEach((m) => {
    set(`analytics_clientes/${m.id}`, { ...m, geradoEm: ts });
    (m.uids || []).forEach((u) => set(`analytics_uid/${u}`, { clienteId: m.id, atualizadoEm: ts }));
  });
  // só os campos de venda são trocados: o retrato de preços do mesmo dia (abaixo) não pode ser apagado junto
  r.agregadosNovos.forEach((a) => ops.push({ tipo: 'set', ref: db.doc(`analytics_vendas/${a.dia}`), dados: limpo({ produtos: a.produtos, visitas: a.visitas, atualizadoEm: ts }), campos: ['produtos', 'visitas', 'atualizadoEm'] }));
  // retrato do cadastro de hoje (preço, oferta, quem está fora da loja): vira o histórico de preços do motor
  if (r.contextoNovo && !opcoes.temRetratoHoje) ops.push({ tipo: 'set', ref: db.doc(`analytics_vendas/${r.contextoNovo.dia}`), dados: limpo({ precos: r.contextoNovo.precos, fora: r.contextoNovo.fora, retratoEm: ts }), campos: ['precos', 'fora', 'retratoEm'] });
  r.novosSnapshots.forEach((s) => set(`analytics_snapshots/${s.id}`, { ...s, avaliado: false, criadoEm: ts }));
  r.avaliacoes.forEach((a) => {
    set(`analytics_avaliacao/${a.id}`, { ...a, avaliadoEm: ts });
    ops.push({ tipo: 'update', ref: db.doc(`analytics_snapshots/${a.id}`), dados: { avaliado: true } });
  });
  await lerLoteadoEscrita(db, ops);
  return { docs: ops.length, chunks: chunks.length };
}

// ---------------------------------------------------------------------
//  EXECUÇÃO COM TRAVA (evita 2 cálculos simultâneos: cron + botão)
// ---------------------------------------------------------------------
async function recalcular(db, { janelaDias, forcar } = {}) {
  const { executarMotor } = require('./engine');
  const ref = db.doc('analytics_meta/execucao');
  const agora = Date.now();
  const ok = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists && s.data().emAndamento && agora - s.data().iniciadoEm < 4 * 60 * 1000) return false;
    if (!forcar && s.exists && s.data().concluidoEm && agora - s.data().concluidoEm < 30 * 1000) return false;   // debounce
    t.set(ref, { emAndamento: true, iniciadoEm: agora }, { merge: true });
    return true;
  });
  if (!ok) return { pulado: true };
  try {
    const entradas = await carregarEntradas(db, { janelaDias });
    const r = executarMotor(entradas);
    const gravado = await persistir(db, r, { temRetratoHoje: entradas.temRetratoHoje });
    await ref.set({ emAndamento: false, concluidoEm: Date.now(), ultimaDuracaoMs: r.meta.duracaoMs, erro: null }, { merge: true });
    return { pulado: false, meta: r.meta, gravado, truncado: entradas.truncado };
  } catch (e) {
    await ref.set({ emAndamento: false, erro: String(e.message || e).slice(0, 300) }, { merge: true });
    throw e;
  }
}

// ---------------------------------------------------------------------
//  LEITURA (API)
// ---------------------------------------------------------------------
// `db` pode ser o banco inteiro (loja original) ou um banco com escopo de UMA loja
// (lib/tenant.js → escopo). O que fica guardado em memória é separado por loja.
const _gCaches = new Map();
async function lerGlobal(db) {
  const k = db._tenant || 'banca';
  const c = _gCaches.get(k);
  if (c && c.v && Date.now() - c.ts < C.RECALC_INTERVALO_MS) return c.v;
  const s = await db.doc('analytics_global/atual').get();
  const novo = { ts: Date.now(), v: s.exists ? s.data() : null };
  _gCaches.set(k, novo);
  return novo.v;
}
async function lerClientePorUid(db, uid) {
  const m = await db.doc(`analytics_uid/${uid}`).get();
  if (!m.exists) return null;
  const c = await db.doc(`analytics_clientes/${m.data().clienteId}`).get();
  return c.exists ? c.data() : null;
}
async function lerPainel(db) {
  const [p, ch, av] = await Promise.all([
    db.doc('analytics_previsoes/painel').get(),
    db.collection('analytics_previsoes_chunks').get(),
    db.collection('analytics_avaliacao').orderBy('diaAlvoIso', 'desc').limit(30).get(),
  ]);
  if (!p.exists) return null;
  const produtos = {}; ch.docs.forEach((d) => Object.assign(produtos, d.data().produtos || {}));
  return { ...p.data(), produtos, avaliacoes: av.docs.map((d) => d.data()) };
}
async function lerClientePorId(db, id) {
  const c = await db.doc(`analytics_clientes/${String(id).replace(/[^\w]/g, '')}`).get();
  return c.exists ? c.data() : null;
}

module.exports = { obterDb, carregarEntradas, persistir, recalcular, lerGlobal, lerClientePorUid, lerPainel, lerClientePorId, fatiar, limpo };
