'use strict';
// =====================================================================
//  lib/catalogo.js — A VITRINE NUM DOCUMENTO SÓ (loja/catalogo).
//
//  Antes, cada cliente que abria a loja lia CADA produto do banco (100 produtos = 100 leituras por
//  visita). Agora o servidor junta a vitrine num documento só e a loja lê esse documento: 1 leitura.
//  Isso é o que faz o plano gratuito do Firebase render muito mais.
//
//  COMO FICA SEMPRE CERTO (sem ninguém limpar cache):
//   - O painel avisa o servidor quando salva produto (js/admin.js → /api/pdv acao 'catalogo'):
//     o servidor remonta o documento inteiro, em segundos.
//   - Venda, cancelamento, pesagem e produção mexem no estoque (lib/estoque.js, registrarMovs): o servidor
//     confere SÓ os produtos que mudaram e remenda o documento (produto que esgotou sai da vitrine).
//   - A loja, além do documento, ouve os produtos mudados depois de `geradoEm` (menos 10 min de folga para
//     relógio de celular atrasado). Então uma mudança do painel aparece na hora, mesmo antes da remontagem.
//   - Qualquer coisa estranha (documento faltando, grande demais, versão diferente, erro de leitura):
//     a loja volta sozinha para o jeito antigo (lê os produtos um por um). Nunca fica sem vitrine.
//
//  Campos de estoque (saldo, mínimo, ideal, máximo, prazo) não vão para o documento: a vitrine não usa,
//  e assim uma venda que não esgota nada nem mexe no documento (zero gravação, zero leitura extra nas lojas).
//
//  Um servidor só (AWS): a fila por loja abaixo garante que duas remontagens não se atropelem.
// =====================================================================
const crypto = require('crypto');
const T = require('./tenant');

const VERSAO = 1;
const FORA = new Set(['estoqueFisico', 'estoqueMin', 'estoqueIdeal', 'estoqueMax', 'prazoDias']);
const LIMITE_BYTES = 900 * 1024;               // o documento do Firestore aceita até 1 MiB
const MARGEM_MS = 10 * 60 * 1000;              // a loja relê o que mudou até 10 min antes de geradoEm
const REMONTAR_APOS_MS = 20 * 60 * 1000;       // remendo em documento mais velho que isso vira remontagem
const VELHO_MS = 6 * 60 * 60 * 1000;           // painel abriu e o documento tem mais de 6 h: remonta

const vaiParaVitrine = (d) => !!(d && d.ativo && !d.soInsumo);
function entrada(id, d) {
  const o = { id: String(id) };
  for (const k of Object.keys(d || {}).sort()) if (!FORA.has(k) && k !== 'id') o[k] = d[k];
  return o;
}
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const assinar = (lista) => crypto.createHash('sha1').update(JSON.stringify(lista)).digest('hex').slice(0, 20);
const refDe = (db, tid) => T.tdoc(db, tid, 'loja', 'catalogo');
const valido = (c) => !!(c && c.v === VERSAO && !c.grande && Array.isArray(c.produtos) && Number(c.geradoEm) > 0);

/** Grava o documento (só se mudou). Devolve 'gravado' | 'igual' | 'grande'. */
async function gravar(db, tid, atual, lista, geradoEm) {
  lista.sort(porId);
  const assinatura = assinar(lista);
  if (valido(atual) && atual.assinatura === assinatura && Number(atual.geradoEm) === geradoEm) return 'igual';
  const doc = { v: VERSAO, geradoEm, assinatura, n: lista.length, produtos: lista };
  if (Buffer.byteLength(JSON.stringify(doc)) > LIMITE_BYTES) {
    // catálogo enorme: a loja usa o jeito antigo (não quebra nada, só não economiza)
    if (!(atual && atual.grande)) await refDe(db, tid).set({ v: VERSAO, grande: true, geradoEm, n: lista.length });
    return 'grande';
  }
  await refDe(db, tid).set(doc);
  return 'gravado';
}

/** Remonta a vitrine inteira a partir dos produtos. */
async function remontar(db, tid) {
  const geradoEm = Date.now();                 // ANTES de ler: o que mudar durante a leitura a loja pega pela folga
  const [atualSnap, snap] = await Promise.all([refDe(db, tid).get(), T.tcol(db, tid, 'produtos').get()]);
  const lista = snap.docs.filter((s) => vaiParaVitrine(s.data())).map((s) => entrada(s.id, s.data()));
  const atual = atualSnap.exists ? atualSnap.data() : null;
  // se nada mudou, mantém o geradoEm antigo só quando ele ainda é recente (senão a folga da loja cresce à toa)
  if (valido(atual) && atual.assinatura === assinar(lista.slice().sort(porId)) && geradoEm - Number(atual.geradoEm) < REMONTAR_APOS_MS) return 'igual';
  return gravar(db, tid, atual, lista, geradoEm);
}

/** Remenda só alguns produtos (estoque mudou). Documento ausente ou velho: remonta tudo. */
async function remendar(db, tid, ids) {
  const atualSnap = await refDe(db, tid).get();
  const atual = atualSnap.exists ? atualSnap.data() : null;
  if (!valido(atual) || Date.now() - Number(atual.geradoEm) > REMONTAR_APOS_MS) return remontar(db, tid);
  const snaps = await Promise.all(ids.map((id) => T.tdoc(db, tid, 'produtos', id).get()));
  const tirar = new Set(ids.map(String));
  const lista = atual.produtos.filter((p) => !tirar.has(String(p.id)));
  snaps.forEach((s) => { if (s.exists && vaiParaVitrine(s.data())) lista.push(entrada(s.id, s.data())); });
  // remendo NÃO mexe no geradoEm: o que o painel mudou e ainda não entrou continua chegando pela folga da loja
  return gravar(db, tid, atual, lista, Number(atual.geradoEm));
}

// ---------------------------------------------------------------- fila por loja (uma coisa de cada vez)
const filas = new Map();         // tid -> Promise
const pendentes = new Map();     // tid -> { ids:Set, tudo:bool, timer }
const desligado = () => process.env.CATALOGO_DESLIGADO === '1';

function enfileirar(tid, fn) {
  const antes = filas.get(tid) || Promise.resolve();
  const agora = antes.then(fn, fn).catch((e) => { console.warn(`[catalogo] ${tid}: ${e && e.message}`); return 'erro'; });
  filas.set(tid, agora);
  agora.finally(() => { if (filas.get(tid) === agora) filas.delete(tid); });
  return agora;
}

/**
 * Pede uma atualização (junta pedidos próximos num só). ids = produtos que mudaram; sem ids = remontar tudo.
 * esperaMs: quanto esperar antes (dá tempo da gravação do pedido terminar).
 */
function agendar(db, tid, ids, esperaMs = 2500) {
  if (desligado() || !db || !T.idValido(String(tid || '')) && tid !== T.TENANT_PADRAO) return;
  const p = pendentes.get(tid) || { ids: new Set(), tudo: false, timer: null };
  if (Array.isArray(ids) && ids.length) ids.forEach((id) => id != null && p.ids.add(String(id))); else p.tudo = true;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    pendentes.delete(tid);
    const tudo = p.tudo, lista = [...p.ids];
    enfileirar(tid, () => (tudo || !lista.length ? remontar(db, tid) : remendar(db, tid, lista)));
  }, esperaMs);
  if (p.timer.unref) p.timer.unref();
  pendentes.set(tid, p);
}

/** Estoque mudou nestes produtos (chamado de dentro da transação: confere de novo 15 s depois, se a gravação demorar). */
function estoqueMudou(db, tid, ids) {
  if (!ids || !ids.length) return;
  agendar(db, tid, ids, 2500);
  const t = setTimeout(() => agendar(db, tid, ids, 0), 15000); if (t.unref) t.unref();
}

/** Painel pediu: 'tudo' remonta já; 'se-faltar' só remonta se o documento falta, está inválido ou velho. */
async function pedidoDoPainel(db, tid, modo) {
  if (modo === 'se-faltar') {
    const s = await refDe(db, tid).get(), c = s.exists ? s.data() : null;
    if (valido(c) && Date.now() - Number(c.geradoEm) < VELHO_MS) return 'em-dia';
    if (c && c.grande) return 'grande';
  }
  return enfileirar(tid, () => remontar(db, tid));
}

module.exports = { VERSAO, MARGEM_MS, FORA, remontar, remendar, agendar, estoqueMudou, pedidoDoPainel, vaiParaVitrine, entrada, _filas: filas };
