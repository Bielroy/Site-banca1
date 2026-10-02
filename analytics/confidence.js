'use strict';
// =====================================================================
//  analytics/confidence.js — forecast_confidence (módulo 15 e 25)
//
//  Confiança é uma métrica SEPARADA da previsão. Média GEOMÉTRICA de 4
//  componentes em [0,1] — um elo fraco derruba o conjunto (ao contrário da
//  média aritmética, que deixaria "muito dado + muito erro" parecer ok):
//
//   volume        = 1 − exp(−n / N0)       quantidade de observações
//   regularidade  = 1 / (1 + CV)           coeficiente de variação das observações
//   estabilidade  = 1 / (1 + WAPE)         erro real do backtest recente
//                   (sem backtest: 0,5 · volume — desconhecido é penalizado)
//   qualidade     = 1 − fração de quantidades ESTIMADAS (item "a pesar" ainda sem peso)
//
//  conf = (volume · regularidade · estabilidade · qualidade) ^ 1/4
// =====================================================================
const C = require('./config');
const { clamp } = require('./stats');

function confiancaDemanda({ nObs, cv, wape, fracEstimada }) {
  const volume = 1 - Math.exp(-(nObs || 0) / C.N0_VOLUME);
  const regularidade = 1 / (1 + (Number.isFinite(cv) ? Math.max(cv, 0) : 1));
  const estabilidade = Number.isFinite(wape) ? 1 / (1 + Math.max(wape, 0)) : 0.5 * volume;
  const qualidade = 1 - clamp(fracEstimada || 0, 0, 1);
  const conf = Math.pow(volume * regularidade * estabilidade * qualidade, 1 / 4);
  return { conf: clamp(conf, 0, 1), componentes: { volume, regularidade, estabilidade, qualidade } };
}
const rotulo = (c) => (c < C.CONF_BAIXA ? 'baixa' : c < C.CONF_ALTA ? 'média' : 'alta');

module.exports = { confiancaDemanda, rotulo };
