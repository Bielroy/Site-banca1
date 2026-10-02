'use strict';
// =====================================================================
//  analytics/evaluation.js — PREVISÃO × REALIZADO (módulo 16)
//
//   MAE   = média |previsto − real|            (mesma unidade do produto)
//   RMSE  = √ média (previsto − real)²         (pune erros grandes)
//   WAPE  = Σ|erro| / Σ real                   (escolhido no lugar do MAPE:
//                                               MAPE explode com vendas ≈ 0,
//                                               comuns em hortifruti)
//   MAPE  = só sobre dias com real > 0, informado junto c/ quantos dias entraram
//   viés  = média (previsto − real)            (>0: superestima)
//   cobertura = % de reais DENTRO de [q10, q90] — calibração do intervalo:
//               um intervalo 10–90 honesto deve cobrir ≈ 80%.
// =====================================================================
const { sum } = require('./stats');
const r = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

function metricas(pares) {
  const v = pares.filter((p) => Number.isFinite(p.previsto) && Number.isFinite(p.real));
  const n = v.length;
  if (!n) return { n: 0, mae: null, rmse: null, wape: null, vies: null, mape: null, mapeN: 0, cobertura: null };
  const err = v.map((p) => p.previsto - p.real);
  const somaReal = sum(v.map((p) => p.real));
  const nz = v.filter((p) => p.real > 0);
  const comInt = v.filter((p) => Number.isFinite(p.q10) && Number.isFinite(p.q90));
  return {
    n, mae: r(sum(err.map(Math.abs)) / n), rmse: r(Math.sqrt(sum(err.map((e) => e * e)) / n)),
    wape: somaReal > 0 ? r(sum(err.map(Math.abs)) / somaReal) : null,
    vies: r(sum(err) / n),
    mape: nz.length ? r(sum(nz.map((p) => Math.abs(p.previsto - p.real) / p.real)) / nz.length) : null, mapeN: nz.length,
    cobertura: comInt.length ? r(comInt.filter((p) => p.real >= p.q10 && p.real <= p.q90).length / comInt.length) : null,
  };
}

/** snapshot: {diaAlvo, itens:{pid:{previsto,q10,q90}}}  ×  realizado: Map(pid → qtd) */
function avaliarSnapshot(snapshot, realizadoPorProduto) {
  const pares = [], porProduto = {};
  for (const [pid, it] of Object.entries(snapshot.itens || {})) {
    const real = realizadoPorProduto.get(pid) || 0;
    pares.push({ previsto: it.previsto, real, q10: it.q10, q90: it.q90 });
    porProduto[pid] = { previsto: it.previsto, real: r(real), erro: r(it.previsto - real) };
  }
  return { diaAlvo: snapshot.diaAlvo, ...metricas(pares), porProduto };
}

module.exports = { metricas, avaliarSnapshot };

