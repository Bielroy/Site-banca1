'use strict';
// =====================================================================
//  analytics/inventoryRecommendation.js — previsão → decisão (módulo 9)
//
//  A previsão vira distribuição: mediana = previsto; q10/q90 vêm da
//  variabilidade histórica. Entre os quantis usamos duas normais
//  ("two-piece"), então a cauda esquerda e a direita podem diferir.
//
//  SUGESTÃO DE COMPRA = quantil de nível NIVEL_SERVICO (problema do jornaleiro:
//  é a probabilidade de NÃO faltar). NIVEL_SERVICO é decisão de negócio
//  (custo da falta × custo da sobra); perecível pede valor < 1.
//
//  FAIXAS (para qualquer quantidade em estoque s):
//    🔴 s < q10        risco de falta ALTO      (P(falta) > 90%)
//    🟡 q10 ≤ s < previsto  risco MODERADO     (50–90%)
//    🟢 previsto ≤ s ≤ q90  risco BAIXO        (10–50%)  ← faixa recomendada
//    🔵 s > q90        margem de segurança      (< 10%; risco de sobra)
//  Os cortes vêm dos QUANTIS, não de ±% fixos.
// =====================================================================
const C = require('./config');
const { normCdf, normInv, clamp } = require('./stats');
const { ehFracionavel } = require('./normalize');

function distribuicao(prev, q10, q90) {
  const z = normInv(C.Q_SUP);
  const sL = Math.max((prev - q10) / z, 1e-9), sR = Math.max((q90 - prev) / z, 1e-9);
  return {
    quantil: (a) => Math.max(0, a <= 0.5 ? prev + sL * normInv(a) : prev + sR * normInv(a)),
    cdf: (x) => normCdf((x - prev) / (x <= prev ? sL : sR)),
  };
}
const teto = (x, step) => Math.ceil(x / step - 1e-9) * step;
const arred = (x) => Math.round(x * 100) / 100;

function zona(s, prev, q10, q90) {
  return s < q10 ? 'vermelho' : s < prev ? 'amarelo' : s <= q90 ? 'verde' : 'margem';
}
const RISCO = { vermelho: 'alto', amarelo: 'moderado', verde: 'baixo', margem: 'muito baixo' };

function recomendar({ previsto, q10, q90, conf, unidade, estoque, nivelServico }) {
  if (previsto == null || !Number.isFinite(previsto)) return null;
  const step = ehFracionavel(unidade) ? 0.5 : 1;
  const d = distribuicao(previsto, q10, q90);
  const nivel = Number.isFinite(nivelServico) && nivelServico > 0 && nivelServico < 1 ? nivelServico : C.NIVEL_SERVICO;
  const sugestao = teto(d.quantil(nivel), step);
  const larguraRel = (q90 - q10) / Math.max(previsto, C.EPS_ESCALA);
  const avisos = [];
  if (conf < C.CONF_BAIXA) avisos.push('Confiança baixa — poucos dados ou padrão instável');
  if (larguraRel > C.LARGURA_REL_ALTA) avisos.push('Previsão com alta variabilidade');
  const z = zona(sugestao, previsto, q10, q90);
  const out = {
    sugestao, nivelServico: nivel, riscoFalta: arred(1 - d.cdf(sugestao)), riscoRotulo: RISCO[z], zonaSugestao: z,
    faixas: { vermelhoAte: arred(q10), amareloAte: arred(previsto), verdeAte: arred(q90) },
    larguraRel: arred(larguraRel), avisos,
  };
  if (estoque != null && Number.isFinite(estoque)) {
    const ze = zona(estoque, previsto, q10, q90);
    out.estoque = { atual: estoque, zona: ze, riscoFalta: arred(1 - d.cdf(estoque)), riscoRotulo: RISCO[ze], comprarAdicional: Math.max(0, teto(sugestao - estoque, step)), excessoSobreQ90: Math.max(0, arred(estoque - q90)) };
  }
  return out;
}

module.exports = { distribuicao, recomendar, zona, RISCO };

