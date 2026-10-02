'use strict';
// =====================================================================
//  analytics/repurchaseModel.js — MODELO DE RECORRÊNCIA (módulos 3 e 5)
//
//  IDEIA: cada par (cliente, produto) é um processo de renovação. O tempo
//  entre compras T segue uma lognormal ajustada com a mediana e o desvio
//  ROBUSTO (MAD) dos intervalos reais do cliente, encolhidos em direção a
//  um prior (o ritmo de visitas do próprio cliente) com peso K_CICLO.
//
//  PROBABILIDADE DE COMPRAR NA PRÓXIMA VISITA, com t = dias desde a última
//  compra do produto e w = metade do intervalo típico entre visitas:
//
//        h(t) = [ F(t+w) − F(t−w) ] / [ 1 − F(t−w) ]
//
//  = "dado que ainda não recomprou, qual a chance de recomprar NESTA visita".
//  Propriedades (todas pedidas no briefing):
//   • t pequeno  → h ≈ 0   (ainda tem em casa)
//   • t ≈ ciclo  → h alto
//   • produto de ciclo 14d e visitas semanais → alterna sozinho (h baixo,
//     alto, baixo...) SEM tratar a ausência como rejeição
//   • atraso NÃO zera: acima de mediana+Z·desvio a hazard fica em platô
//     ("ainda é devido") e só uma retenção A(t) vai decaindo devagar,
//     marcando "possivelmente abandonado" — nunca "cliente perdido" de cara.
// =====================================================================
const C = require('./config');
const { median, robustSd, mad, clamp, normCdf, quantile } = require('./stats');

/** Ajusta (m, s) da lognormal dos intervalos, com encolhimento ao prior. */
function ajustarCiclo(intervalos, prior) {
  const logs = intervalos.map(Math.log);
  const n = logs.length;
  const mObs = n ? median(logs) : prior.m0;
  const sBruto = n >= 2 ? robustSd(logs) : null;         // 1 intervalo não informa dispersão
  const sObs = sBruto == null ? prior.s0 : Math.max(sBruto, C.S_MIN_LOG);
  const K = C.K_CICLO;
  // LOCALIZAÇÃO: normal-normal por PRECISÃO. Compras muito regulares (sObs
  // pequeno) valem muito mais que o prior; poucas compras erráticas valem pouco.
  const tau = prior.tau || C.TAU_PRIOR_PADRAO;
  const pDados = n / (sObs * sObs), pPrior = K / (tau * tau);
  const m = (pDados * mObs + pPrior * prior.m0) / (pDados + pPrior);
  // DISPERSÃO: encolhimento por pseudo-observações.
  const s = Math.max(Math.sqrt((n * sObs * sObs + K * prior.s0 * prior.s0) / (n + K)), C.S_MIN_LOG);
  return { m, s, n, sObs: sBruto };
}

const tAtraso = (ciclo) => Math.exp(ciclo.m + C.Z_ATRASO * ciclo.s);

function hazardVisita(ciclo, t, nuDias) {
  const { m, s } = ciclo;
  const w = Math.max(nuDias / 2, 0.5);
  const F = (x) => (x <= 0 ? 0 : normCdf((Math.log(x) - m) / s));
  const te = Math.min(Math.max(t, 0), tAtraso(ciclo));   // platô após o atraso
  const lo = Math.max(te - w, 0), hi = te + w;
  const surv = 1 - F(lo);
  const h = surv > 1e-3 ? (F(hi) - F(lo)) / surv : 1;
  return clamp(h, 0, 1);
}

/** Retenção: 1 até o limite de atraso; depois cai pela metade a cada ciclo extra. */
function retencao(ciclo, t) {
  const tl = tAtraso(ciclo);
  if (t <= tl) return 1;
  return Math.pow(0.5, (t - tl) / Math.exp(ciclo.m) / C.MEIA_VIDA_ATRASO_CICLOS);
}

function rotuloCiclo(mu, nInt, sObs) {
  if (nInt < 2) return { tipo: 'insuficiente', rotulo: 'sem ciclo definido (poucas compras)' };
  if (sObs != null && sObs > C.CV_IRREGULAR) return { tipo: 'irregular', rotulo: 'irregular' };
  const r = C.ROTULOS_CICLO.find((x) => mu >= x.min && mu <= x.max);
  return r ? { tipo: 'regular', rotulo: r.rotulo } : { tipo: 'regular', rotulo: `a cada ~${Math.round(mu)} dias` };
}

/** Compra alternada: o padrão em nº de VISITAS entre compras é estável e ≥ 2. */
function detectarAlternancia(idxVisitas) {
  const ks = []; for (let i = 1; i < idxVisitas.length; i++) ks.push(idxVisitas[i] - idxVisitas[i - 1]);
  if (ks.length < 3) return null;
  const med = median(ks);
  return med >= 2 && mad(ks) <= 0.5 ? Math.round(med) : null;
}

// ---------------------------------------------------------------------
//  PROBABILIDADE DE O CLIENTE FAZER PEDIDO EM UM DIA (módulo 10)
//  π(D) = P(visita cai na semana de D) × P(dia da semana de D | visita)
//  O 1º termo é a hazard discreta da distribuição de "semanas entre visitas"
//  do cliente (suavizada com a distribuição global). Cliente quinzenal =
//  hazard baixa na semana 1 e alta na semana 2.
// ---------------------------------------------------------------------
function distribuicaoGaps(contagens, global) {
  const n = contagens.reduce((a, b) => a + b, 0), K = C.K_GAP;
  const g = global || contagens.map((_, k) => Math.pow(0.5, k + 1));
  const gs = g.reduce((a, b) => a + b, 0) || 1;
  return contagens.map((c, k) => (c + K * (g[k] / gs)) / (n + K));
}

function probabilidadeVisita(mv, dia, G, abertos, asOf, semanaDeDia, dowDeDia) {
  if (!mv || dia <= mv.ultimoDia) return { p: 0, motivo: 'já comprou hoje' };
  const dow = dowDeDia(dia);
  if (!abertos.has(dow)) return { p: 0, motivo: 'loja fechada' };
  const wk = semanaDeDia(dia);
  const k = Math.max(0, wk - semanaDeDia(mv.ultimoDia));
  const gp = distribuicaoGaps(mv.gaps, G.gapGlobal);
  const kk = Math.min(k, gp.length - 1);
  const cauda = gp.slice(kk).reduce((a, b) => a + b, 0);
  const hz = cauda > 1e-9 ? gp[kk] / cauda : 1;

  // retenção do cliente: depois do quantil 95% dos gaps, decai por semana de atraso
  let acc = 0, k95 = gp.length - 1;
  for (let i = 0; i < gp.length; i++) { acc += gp[i]; if (acc >= 0.95) { k95 = i; break; } }
  const medGap = Math.max(1, quantile(expandir(gp), 0.5));
  const A = k > k95 ? Math.pow(0.5, (k - k95) / medGap) : 1;

  // dia da semana: contagens do cliente + prior global, só dias abertos.
  // Dias que JÁ PASSARAM (≤ asOf) sem visita, ou anteriores à última visita, não contam mais.
  const segunda = dia - ((dow + 6) % 7);
  const K = C.K_DOW_CLIENTE, nv = mv.dow.reduce((a, b) => a + b, 0);
  let tot = 0, meu = 0;
  for (let d = 0; d < 7; d++) {
    const diaD = segunda + ((d + 6) % 7);
    const ok = abertos.has(d) && diaD > Math.max(mv.ultimoDia, asOf);
    const w = ok ? (mv.dow[d] + K * (G.dowGlobal[d] || 1 / 7)) / (nv + K) : 0;
    tot += w; if (d === dow) meu = w;
  }
  const pDia = tot > 0 ? meu / tot : 0;
  return { p: clamp(hz * pDia * A, 0, 1), hz, pDia, A, semanasDesde: k };
}
const expandir = (probs) => { const v = []; probs.forEach((p, k) => { for (let i = 0; i < Math.round(p * 100); i++) v.push(k); }); return v.length ? v : [0]; };

module.exports = {
  ajustarCiclo, hazardVisita, retencao, tAtraso, rotuloCiclo, detectarAlternancia,
  distribuicaoGaps, probabilidadeVisita,
};
