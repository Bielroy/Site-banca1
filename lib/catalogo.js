'use strict';
// =====================================================================
//  lib/catalogo.js — A LOJA E O PAINEL LENDO UM DOCUMENTO SÓ.
//
//  Cada leitura do Firestore conta no plano. Ler 150 produtos um por um = 150 leituras, a cada visita e a
//  cada vez que o painel abre. Então o SERVIDOR junta tudo em três documentos, e quem abre lê só eles:
//
//   loja/catalogo  (público)   a vitrine: produtos que aparecem (sem campos de estoque) + categorias, aviso
//                               do dia (comunicados) e nota da loja (avaliacoes). A loja: 1 leitura por visita.
//   loja/painel    (equipe)    TODOS os produtos, com estoque. O painel abre com 1 leitura.
//   loja/custos    (estoque)   custo e ficha técnica de cada produto (privado: o caixa não vê).
//
//  COMO FICA SEMPRE CERTO (sem ninguém limpar cache):
//   - Painel salvou produto: avisa o servidor com os ids (js/pedir-catalogo.js → /api/pdv acao 'catalogo',
//     modo 'mudou'). O servidor relê SÓ esses produtos e remenda os documentos, em segundos.
//     Apagou produto, mexeu em custo ou restaurou cópia: remontagem inteira ('tudo').
//   - Venda, cancelamento, pesagem e produção mexem no estoque (lib/estoque.js, registrarMovs): remenda só os
//     produtos que mudaram. Produção e compra também mexem no custo: remenda o custo deles.
//   - Categorias, aviso do dia e nota: o painel (e o servidor, na nota) pedem 'extras'.
//   - Quem lê, além do documento, ouve os produtos com `ultimaModificacao` depois de `geradoEm` (menos 10 min de
//     folga para relógio atrasado): mudança do painel aparece na hora, antes do servidor remendar.
//   - Documento com mais de 20 min (e algo mudou): ATUALIZAÇÃO PELO QUE MUDOU — lê só os produtos com
//     `ultimaModificacao` recente (antes relia a loja inteira a cada 20 min de vendas) e avança o `geradoEm`.
//   - A cada 6 h, quando o painel abre, uma remontagem inteira (segurança contra qualquer coisa perdida).
//   - Qualquer coisa estranha (documento faltando, grande demais, versão diferente, regra não publicada):
//     quem lê volta sozinho para o jeito antigo (lê um por um). Nunca fica sem vitrine nem sem painel.
//
//  Um servidor só (AWS): a fila por loja abaixo garante que duas atualizações não se atropelem.
// =====================================================================
const crypto = require('crypto');
const T = require('./tenant');

const VERSAO = 1;
const FORA = new Set(['estoqueFisico', 'estoqueMin', 'estoqueIdeal', 'estoqueMax', 'prazoDias']);
const LIMITE_BYTES = 900 * 1024;               // o documento do Firestore aceita até 1 MiB
const MARGEM_MS = 10 * 60 * 1000;              // quem lê pega o que mudou até 10 min antes de geradoEm
const REMONTAR_APOS_MS = 20 * 60 * 1000;       // documento mais velho que isso: atualiza pelo que mudou e avança geradoEm
const VELHO_MS = 6 * 60 * 60 * 1000;           // painel abriu e a última remontagem inteira tem mais de 6 h: remonta
const DERIVADOS = ['catalogo', 'painel', 'custos'];   // montados aqui; ninguém mais grava (regras) e não vão para a cópia de segurança

const vaiParaVitrine = (d) => !!(d && d.ativo && !d.soInsumo);
const ordenado = (d) => { const o = {}; for (const k of Object.keys(d || {}).sort()) o[k] = d[k]; return o; };
/** Produto como vai para a vitrine (sem campos de estoque). */
function entrada(id, d) {
  const o = { id: String(id) };
  for (const k of Object.keys(d || {}).sort()) if (!FORA.has(k) && k !== 'id') o[k] = d[k];
  return o;
}
/** Produto como vai para o painel (inteiro). */
const entradaPainel = (id, d) => ({ ...ordenado(d), id: String(id) });
const entradaCusto = (d) => ({ custo: d && d.custo != null ? d.custo : null, ficha: d && d.ficha != null ? d.ficha : null });
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const assinar = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 20);
const refDe = (db, tid, nome = 'catalogo') => T.tdoc(db, tid, 'loja', nome);

const temLista = (c) => !!(c && c.v === VERSAO && !c.grande && Number(c.geradoEm) > 0);
const valido = (c) => temLista(c) && Array.isArray(c.produtos);                 // catálogo e painel
const custosValido = (c) => temLista(c) && !!c.custos && typeof c.custos === 'object' && !Array.isArray(c.custos);
const grande = (c) => !!(c && c.v === VERSAO && c.grande);
const VALIDA = { catalogo: valido, painel: valido, custos: custosValido };
const usavel = (nome, c) => VALIDA[nome](c) || grande(c);                       // grande: quem lê usa o jeito antigo

// ---------------------------------------------------------------- leituras
const lerDoc = async (db, tid, nome) => { const s = await refDe(db, tid, nome).get(); return s.exists ? s.data() : null; };
/** Categorias, aviso do dia e nota: poucos documentos, relidos inteiros sempre que o catálogo é atualizado. */
async function lerExtras(db, tid) {
  const [cats, com, aval] = await Promise.all([
    T.tcol(db, tid, 'categorias').get(), refDe(db, tid, 'comunicados').get(), refDe(db, tid, 'avaliacoes').get(),
  ]);
  return {
    categorias: cats.docs.map((s) => ({ ...ordenado(s.data()), id: s.id })).filter((c) => c.chave).sort(porId),
    comunicados: com.exists ? ordenado(com.data()) : null,
    avaliacoes: aval.exists ? ordenado(aval.data()) : null,
  };
}

// ---------------------------------------------------------------- gravação
/**
 * Grava um documento só se o conteúdo mudou (cada gravação faz todas as telas abertas lerem de novo).
 * corpo = { produtos } | { custos } (+ extras no catálogo). Devolve 'gravado' | 'igual' | 'grande'.
 */
async function gravar(db, tid, nome, atual, corpo, geradoEm, cheioEm) {
  const assinatura = assinar(corpo);
  if (VALIDA[nome](atual) && atual.assinatura === assinatura && Number(atual.geradoEm) === geradoEm) return 'igual';
  const n = Array.isArray(corpo.produtos) ? corpo.produtos.length : Object.keys(corpo.custos || {}).length;
  const doc = { v: VERSAO, geradoEm, cheioEm, assinatura, n, ...corpo };
  if (Buffer.byteLength(JSON.stringify(doc)) > LIMITE_BYTES) {
    // enorme: quem lê usa o jeito antigo (não quebra nada, só não economiza)
    if (!(atual && atual.grande && Number(atual.cheioEm) === cheioEm)) await refDe(db, tid, nome).set({ v: VERSAO, grande: true, geradoEm, cheioEm, n });
    return 'grande';
  }
  await refDe(db, tid, nome).set(doc);
  return 'gravado';
}

const listaDoCatalogo = (porIdMapa) => [...porIdMapa.values()].sort(porId);

// Servidor acabou de ligar: o que estava pendente na memória (uma venda de segundos atrás) se perdeu. Então a
// primeira atualização de cada loja depois de ligar é uma remontagem inteira.
const remontadas = new WeakMap();      // db -> Set(tid)
const jaRemontou = (db, tid) => !!(remontadas.get(db) && remontadas.get(db).has(tid));
const marcarRemontada = (db, tid) => { if (!remontadas.has(db)) remontadas.set(db, new Set()); remontadas.get(db).add(tid); };

/** REMONTAGEM INTEIRA: lê todos os produtos, custos e extras. Devolve o resultado do catálogo (da vitrine). */
async function remontar(db, tid) {
  marcarRemontada(db, tid);
  const geradoEm = Date.now();                 // ANTES de ler: o que mudar durante a leitura quem lê pega pela folga
  const [cat, painel, custos, prods, privs, extras] = await Promise.all([
    lerDoc(db, tid, 'catalogo'), lerDoc(db, tid, 'painel'), lerDoc(db, tid, 'custos'),
    T.tcol(db, tid, 'produtos').get(), T.tcol(db, tid, 'produtos_custos').get(), lerExtras(db, tid),
  ]);
  const vitrine = prods.docs.filter((s) => vaiParaVitrine(s.data())).map((s) => entrada(s.id, s.data())).sort(porId);
  const todos = prods.docs.map((s) => entradaPainel(s.id, s.data())).sort(porId);
  const mapaCustos = {};
  privs.docs.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((s) => { mapaCustos[s.id] = entradaCusto(s.data()); });
  // nada mudou e o documento é recente: mantém (senão a folga de quem lê cresce à toa)
  const manter = (nome, atual, corpo) => VALIDA[nome](atual) && atual.assinatura === assinar(corpo) && geradoEm - Number(atual.geradoEm) < REMONTAR_APOS_MS;
  const corpoCat = { produtos: vitrine, ...extras }, corpoPainel = { produtos: todos }, corpoCustos = { custos: mapaCustos };
  const [r] = await Promise.all([
    manter('catalogo', cat, corpoCat) ? 'igual' : gravar(db, tid, 'catalogo', cat, corpoCat, geradoEm, geradoEm),
    manter('painel', painel, corpoPainel) ? 'igual' : gravar(db, tid, 'painel', painel, corpoPainel, geradoEm, geradoEm),
    manter('custos', custos, corpoCustos) ? 'igual' : gravar(db, tid, 'custos', custos, corpoCustos, geradoEm, geradoEm),
  ]);
  return r;
}

/**
 * Atualização pelo que mudou.
 *  ids     produtos que mudaram (venda, painel): relidos um por um (vale até com relógio errado no celular);
 *  custos  os custos desses ids também mudaram (produção, compra, painel);
 *  extras  categorias, aviso ou nota mudaram.
 * Documento faltando ou de outra versão: remontagem inteira. Documento com mais de 20 min: além dos ids, lê os
 * produtos com ultimaModificacao recente e avança o geradoEm (a folga de quem lê volta a ser pequena).
 */
async function atualizar(db, tid, { ids = [], custos = false, extras = false } = {}) {
  if (!jaRemontou(db, tid)) return remontar(db, tid);
  const agora = Date.now();
  const [cat, painel, docCustos] = await Promise.all([lerDoc(db, tid, 'catalogo'), lerDoc(db, tid, 'painel'), custos ? lerDoc(db, tid, 'custos') : null]);
  if (!usavel('catalogo', cat) || !usavel('painel', painel) || (custos && !usavel('custos', docCustos))) return remontar(db, tid);
  const comLista = [cat, painel].filter(valido);
  if (!comLista.length && !(custos && custosValido(docCustos))) return 'grande';           // tudo grande: quem lê usa o jeito antigo
  const geradoAntes = Math.min(...comLista.map((c) => Number(c.geradoEm)));
  const velho = comLista.length && agora - geradoAntes > REMONTAR_APOS_MS;
  const queIds = new Set((ids || []).map(String));
  let geradoEm = comLista.length ? Number(comLista[0].geradoEm) : agora;
  const lidos = new Map();                                   // id -> data | null (apagado)
  if (velho) {
    geradoEm = agora;                                        // ANTES de ler (a folga cobre o que mudar durante a leitura)
    const recentes = await T.tcol(db, tid, 'produtos').where('ultimaModificacao', '>', geradoAntes - MARGEM_MS).get();
    recentes.docs.forEach((s) => { lidos.set(s.id, s.data()); queIds.delete(s.id); });
    extras = true;
  }
  const snaps = await Promise.all([...queIds].map((id) => T.tdoc(db, tid, 'produtos', id).get()));
  snaps.forEach((s) => lidos.set(s.id, s.exists ? s.data() : null));
  const ex = extras ? await lerExtras(db, tid) : null;

  const tarefas = [];
  let r = 'igual';
  if (valido(cat)) {
    const m = new Map(cat.produtos.map((p) => [String(p.id), p]));
    for (const [id, d] of lidos) { if (d && vaiParaVitrine(d)) m.set(id, entrada(id, d)); else m.delete(id); }
    const velhos = { categorias: cat.categorias, comunicados: cat.comunicados, avaliacoes: cat.avaliacoes };
    const corpo = { produtos: listaDoCatalogo(m), ...(ex || velhos) };
    if (!ex && !Array.isArray(cat.categorias)) Object.assign(corpo, await lerExtras(db, tid));   // documento de antes dos extras
    tarefas.push(gravar(db, tid, 'catalogo', cat, corpo, velho ? geradoEm : Number(cat.geradoEm), Number(cat.cheioEm || cat.geradoEm)).then((x) => { r = x; }));
  } else r = 'grande';
  if (valido(painel)) {
    const m = new Map(painel.produtos.map((p) => [String(p.id), p]));
    for (const [id, d] of lidos) { if (d) m.set(id, entradaPainel(id, d)); else m.delete(id); }
    tarefas.push(gravar(db, tid, 'painel', painel, { produtos: listaDoCatalogo(m) }, velho ? geradoEm : Number(painel.geradoEm), Number(painel.cheioEm || painel.geradoEm)));
  }
  if (custos && custosValido(docCustos) && ids.length) {
    const privs = await Promise.all(ids.map((id) => T.tdoc(db, tid, 'produtos_custos', String(id)).get()));
    const mapa = { ...docCustos.custos };
    privs.forEach((s) => { if (s.exists) mapa[s.id] = entradaCusto(s.data()); else delete mapa[s.id]; });
    const ord = {}; Object.keys(mapa).sort().forEach((k) => { ord[k] = mapa[k]; });
    tarefas.push(gravar(db, tid, 'custos', docCustos, { custos: ord }, Number(docCustos.geradoEm), Number(docCustos.cheioEm || docCustos.geradoEm)));
  }
  await Promise.all(tarefas);
  return r;
}

/** Remenda só alguns produtos (estoque mudou). Documento ausente: remonta tudo. */
const remendar = (db, tid, ids, opcoes = {}) => atualizar(db, tid, { ...opcoes, ids });

// ---------------------------------------------------------------- fila por loja (uma coisa de cada vez)
const filas = new Map();         // tid -> Promise
const pendentes = new Map();     // tid -> { ids:Set, custos:Set, tudo, extras, timer }
const desligado = () => process.env.CATALOGO_DESLIGADO === '1';

function enfileirar(tid, fn) {
  const antes = filas.get(tid) || Promise.resolve();
  const agora = antes.then(fn, fn).catch((e) => { console.warn(`[catalogo] ${tid}: ${e && e.message}`); return 'erro'; });
  filas.set(tid, agora);
  agora.finally(() => { if (filas.get(tid) === agora) filas.delete(tid); });
  return agora;
}

/** Executa o que estava pendente: remontagem inteira ganha de tudo; senão uma atualização só, com tudo junto. */
const executar = (db, tid, p) => {
  if (p.tudo) return remontar(db, tid);
  const ids = [...new Set([...p.ids, ...p.custos])];
  if (!ids.length && !p.extras) return remontar(db, tid);
  return atualizar(db, tid, { ids, custos: p.custos.size > 0, extras: p.extras });
};

/**
 * Pede uma atualização (junta pedidos próximos num só). ids = produtos que mudaram; sem ids = remontar tudo.
 * opcoes: { custos: true } os custos desses ids mudaram · { extras: true } categorias/aviso/nota mudaram.
 * esperaMs: quanto esperar antes (dá tempo da gravação do pedido terminar).
 */
function agendar(db, tid, ids, esperaMs = 2500, opcoes = {}) {
  if (desligado() || !db || !T.idValido(String(tid || '')) && tid !== T.TENANT_PADRAO) return;
  const p = pendentes.get(tid) || { ids: new Set(), custos: new Set(), tudo: false, extras: false, timer: null };
  const lista = Array.isArray(ids) ? ids.filter((id) => id != null).map(String) : [];
  if (lista.length) lista.forEach((id) => (opcoes.custos ? p.custos : p.ids).add(id));
  else if (opcoes.extras) p.extras = true;
  else p.tudo = true;
  if (opcoes.extras) p.extras = true;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => { pendentes.delete(tid); enfileirar(tid, () => executar(db, tid, p)); }, esperaMs);
  if (p.timer.unref) p.timer.unref();
  pendentes.set(tid, p);
}

/** Estoque mudou nestes produtos (chamado de dentro da transação: confere de novo 15 s depois, se a gravação demorar). */
function estoqueMudou(db, tid, ids, opcoes = {}) {
  if (!ids || !ids.length) return;
  agendar(db, tid, ids, 2500, opcoes);
  const t = setTimeout(() => agendar(db, tid, ids, 0, opcoes), 15000); if (t.unref) t.unref();
}

/** Categorias, aviso do dia ou nota da loja mudaram. */
const extrasMudaram = (db, tid, esperaMs = 2500) => agendar(db, tid, null, esperaMs, { extras: true });

const MODOS = ['tudo', 'se-faltar', 'mudou', 'custos', 'extras'];
/**
 * O painel pediu:
 *  'tudo'      remonta já;            'se-faltar' só se falta documento, está inválido ou a remontagem inteira tem 6 h;
 *  'mudou'     estes produtos mudaram; 'custos'    os custos destes produtos mudaram;   'extras' categorias/aviso.
 */
async function pedidoDoPainel(db, tid, modo, ids) {
  const lista = (Array.isArray(ids) ? ids : []).map(String).filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id)).slice(0, 400);
  if (modo === 'se-faltar') {
    const docs = await Promise.all(DERIVADOS.map((n) => lerDoc(db, tid, n)));
    const ok = DERIVADOS.every((n, i) => usavel(n, docs[i]));
    const cheio = Math.min(...docs.map((c) => Number((c && (c.cheioEm || c.geradoEm)) || 0)));
    if (ok && Date.now() - cheio < VELHO_MS) return 'em-dia';
    if (ok && docs.every(grande)) return 'grande';
    return enfileirar(tid, () => remontar(db, tid));
  }
  if (modo === 'mudou' && lista.length) return enfileirar(tid, () => atualizar(db, tid, { ids: lista }));
  if (modo === 'custos' && lista.length) return enfileirar(tid, () => atualizar(db, tid, { ids: lista, custos: true }));
  if (modo === 'extras') return enfileirar(tid, () => atualizar(db, tid, { extras: true }));
  return enfileirar(tid, () => remontar(db, tid));
}

module.exports = {
  VERSAO, MARGEM_MS, FORA, DERIVADOS, MODOS, remontar, remendar, atualizar, agendar, estoqueMudou, extrasMudaram, pedidoDoPainel,
  vaiParaVitrine, entrada, entradaPainel, _filas: filas,
};
