'use strict';
// =====================================================================
//  analytics/productAssociation.js — PRODUTOS COMPLEMENTARES (módulo 4)
//
//  Cada VISITA (cliente+dia) é uma cesta. Para cada par (i → j):
//    support    = n_ij / N               (quão comum é o par)
//    confidence = n_ij / n_i             (P(j | i))
//    lift       = confidence / (n_j / N) (>1: andam juntos além do acaso)
//
//  Lift calculado com pouco suporte é ruído, então é ENCOLHIDO para 1:
//    lift_s = 1 + (lift − 1) · n_ij / (n_ij + K_ASSOC)
//  e pares vistos < ASSOC_MIN_PARES vezes são descartados.
//  Isso evita recomendar "porque é o mais vendido": lift mede o EXCESSO
//  sobre a popularidade do item.
// =====================================================================
const C = require('./config');
const { arred } = require('./stats');

function calcularAssociacoes(cestas) {
  const N = cestas.length;
  const n = new Map(), par = new Map();
  for (const itens of cestas) {
    const ids = [...new Set(itens)].sort();
    for (const a of ids) n.set(a, (n.get(a) || 0) + 1);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = ids[i] + '\u0001' + ids[j]; par.set(k, (par.get(k) || 0) + 1);
    }
  }
  const out = {}; const push = (i, j, nij) => {
    const conf = nij / n.get(i), lift = conf / (n.get(j) / N);
    const ls = 1 + (lift - 1) * nij / (nij + C.K_ASSOC);
    (out[i] = out[i] || []).push({ j, n: nij, support: arred(nij / N, 4), conf: arred(conf), lift: arred(lift, 2), ls: arred(ls, 3) });
  };
  for (const [k, nij] of par) {
    if (nij < C.ASSOC_MIN_PARES) continue;
    const [a, b] = k.split('\u0001'); push(a, b, nij); push(b, a, nij);
  }
  for (const i of Object.keys(out)) out[i] = out[i].sort((x, y) => y.ls - x.ls).slice(0, C.ASSOC_TOP);
  return { assoc: out, nCestas: N };
}

/** Δ no log-odds de `alvo` dado o que já está na cesta (média dos log-lifts). */
function ajusteCesta(alvo, cesta, assoc) {
  const logs = [];
  for (const i of cesta || []) {
    if (i === alvo) continue;
    const e = (assoc[i] || []).find((x) => x.j === alvo);
    if (e) logs.push(Math.log(Math.max(e.ls, 0.05)));
  }
  return logs.length ? { delta: logs.reduce((a, b) => a + b, 0) / logs.length, de: logs.length } : { delta: 0, de: 0 };
}

module.exports = { calcularAssociacoes, ajusteCesta };

