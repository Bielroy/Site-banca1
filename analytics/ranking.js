'use strict';
// =====================================================================
//  analytics/ranking.js — PROBABILIDADE DE COMPRA, RANKING E EXPLICAÇÃO
//  (módulos 2, 6, 11, 12 e 14)
//
//  P(cliente c compra produto p na visita do dia D) é uma mistura por
//  CREDIBILIDADE (Bühlmann), não uma soma de pesos arbitrários:
//
//      P = λ · P_pessoal  +  (1 − λ) · P_prior          λ = n / (n + K·(s/τ)²)  (Bühlmann)
//
//   • P_pessoal = h(t) · A(t)  — modelo de recompra (repurchaseModel.js)
//   • P_prior   = frequência encolhida (n + K·prior)/(visitas + K), com
//                 prior = pop(p)·κ·dia-da-semana — popularidade GLOBAL (níveis 3/4),
//                 escalada por κ = quanto este cliente gosta da CATEGORIA
//                 comparado à média (nível 2). Sem histórico: κ = 1.
//   • n = nº de INTERVALOS observados do par (cliente, produto). Sem intervalos só o
//     prior manda (cold start); conforme n cresce — e quanto mais regular o ciclo —
//     o individual assume.
//
//  Depois, no espaço log-odds, entra o ajuste de associação:
//   • associação com o que já está na cesta (média dos log-lifts)
//
//  recommendation_score = P final. Confiança é medida À PARTE.
// =====================================================================
const C = require('./config');
const S = require('./stats');
const R = require('./repurchaseModel');
const { ajusteCesta } = require('./productAssociation');
const { dowDeDia } = require('./normalize');

const NOMES_DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function probCompra(mod, pid, G, D, opts = {}) {
  const pop = G.pop[pid];
  const gp = pop ? pop.p : 0;
  const nC = mod ? mod.nVisitas : 0;

  let kappa = 1;
  if (mod && pop && G.cat[pop.cat] > 0) {
    const gc = G.cat[pop.cat];
    kappa = (((mod.cats && mod.cats[pop.cat]) || 0) + C.K_CAT * gc) / (nC + C.K_CAT) / gc;
  }
  const lifts = G.dow && G.dow[pid];
  const fDow = lifts ? lifts[dowDeDia(D)] : 1;
  // PRIOR global (popularidade × gosto pela categoria × dia da semana do produto).
  // O dia da semana entra SÓ aqui: no modelo individual o dia já é tratado pela
  // probabilidade de visita, e aplicar de novo contaria o mesmo efeito duas vezes.
  const prior = S.clamp(gp * kappa * Math.max(fDow, 0.05), 0, 0.95);

  const mp = mod && mod.prod ? mod.prod[pid] : null;
  const nP = mp ? mp.n : 0;
  // FREQUÊNCIA encolhida (beta-binomial): inclui a EVIDÊNCIA DE AUSÊNCIA.
  // 10 visitas sem nunca levar o item derrubam o prior; 0 visitas = só prior.
  const freqS = (nP + C.K_CRED * prior) / (nC + C.K_CRED);

  let pPess = 0, lambda = 0, h = null, A = 1, t = null, reg = 0;
  if (mp) {
    t = D - mp.ult;
    const ciclo = { m: mp.m, s: mp.s };
    h = R.hazardVisita(ciclo, t, mod.nuMed || G.nuGlobal);
    A = R.retencao(ciclo, t);
    pPess = h * A;
    // CREDIBILIDADE de Bühlmann: Z = n / (n + K·(s/τ)²). s = variabilidade do ciclo DESTE
    // cliente; τ = quanto os ciclos variam ENTRE produtos. Compras muito regulares (s pequeno)
    // → Z ≈ 1 mesmo com poucos intervalos; compras erráticas → Z baixo, pesa mais o prior.
    // Sem nenhum intervalo observado (1 compra) o ciclo é desconhecido → Z = 0.
    const tau = G.tauLoc || C.TAU_PRIOR_PADRAO;
    // n_ef = intervalos − 1: com UM intervalo não há como medir a regularidade (o s viria do
    // prior global, não dos dados), então ele não pode sustentar um ciclo individual.
    const nEf = Math.max(mp.nInt - 1, 0);
    lambda = nEf / (nEf + C.K_CRED * Math.pow(mp.s / tau, 2));
    reg = 1 / (1 + mp.s);
  }
  const pBase = lambda * pPess + (1 - lambda) * freqS;

  const aj = opts.cesta && opts.cesta.length ? ajusteCesta(pid, opts.cesta, G.assoc || {}) : { delta: 0, de: 0 };
  const p = pBase <= 0 ? 0 : S.expit(S.logit(pBase) + aj.delta);

  // Confiança desta previsão: raiz de (peso do individual × regularidade do ciclo).
  // Sem histórico do produto a previsão é só popularidade geral → teto baixo.
  const confPrior = 0.25 * (1 - Math.exp(-(pop ? pop.n : 0) / C.N0_VOLUME));
  const conf = mp ? Math.max(Math.sqrt(lambda * reg), confPrior) : confPrior;

  return { p, pBase, prior, pPess, lambda, h, A, t, conf, fDow, aj, mp, kappa };
}

function explicar(mod, pid, r, G, D, produtos) {
  const m = [], tags = []; const pr = produtos.get(pid); const un = pr ? pr.unidade : 'un';
  const mp = r.mp, nC = mod ? mod.nVisitas : 0;
  if (!mp) {
    m.push(nC ? 'Você ainda não comprou este produto — sugerido pelo que outros clientes levam' : 'Dados insuficientes para previsão individual — baseado no que a maioria dos clientes leva');
    return { motivos: m, tags, motivoCurto: null };
  }
  if (nC >= 3) m.push(`Você leva em ${mp.n} de ${nC} pedidos`);
  else m.push(`Poucos pedidos seus (${nC}) — previsão com baixa confiança`);
  if (mp.ciclo.tipo === 'insuficiente') m.push('Poucas compras para definir um ciclo');
  else m.push(`Ciclo ${mp.ciclo.rotulo} (intervalo típico ≈ ${Math.round(mp.mu)} dias)`);
  m.push(r.t <= 0 ? 'Última compra: hoje' : `Última compra: há ${r.t} dia${r.t === 1 ? '' : 's'}`);
  if (mp.alt) { m.push(`Costuma alternar: leva a cada ${mp.alt} pedidos`); tags.push('alternado'); }
  if (r.lambda >= 0.5 && r.t < 0.5 * mp.mu) m.push('Comprou há pouco — provavelmente ainda tem em casa');
  else if (r.lambda >= 0.5 && r.h >= 0.6 && r.t >= 0.7 * mp.mu) { m.push('Está chegando a hora de repor'); tags.push('repor'); }
  if (mp.abandonado) { m.push('Faz tempo além do normal — pode ter deixado de comprar'); tags.push('abandonado'); }
  if (mp.novo) tags.push('novo');
  if (mod.dowTop === dowDeDia(D) && mod.dow[mod.dowTop] / nC >= 0.4 && nC >= 3) m.push(`Hoje (${NOMES_DOW[dowDeDia(D)]}) é seu dia habitual de compra`);
  if (mp.q) m.push(`Quantidade habitual: ${mp.q.med} ${un}` + (mp.q.tend === 'crescente' ? ' (aumentando)' : mp.q.tend === 'decrescente' ? ' (diminuindo)' : ''));
  if (r.fDow >= C.LIMIAR_EXPLICAR_FATOR) m.push(`Este produto vende ${Math.round((r.fDow - 1) * 100)}% mais às ${NOMES_DOW[dowDeDia(D)]}s`);
  else if (r.fDow <= 1 / C.LIMIAR_EXPLICAR_FATOR) m.push(`Este produto vende ${Math.round((1 - r.fDow) * 100)}% menos às ${NOMES_DOW[dowDeDia(D)]}s`);
  if (r.aj.de && r.aj.delta > Math.log(C.LIMIAR_EXPLICAR_FATOR)) { m.push('Costuma ser levado junto com itens da sua cesta'); tags.push('combina'); }
  if (r.lambda < 0.3) m.push('Pouco histórico deste item: parte da previsão vem do comportamento geral');

  let curto = null;
  if (tags.includes('abandonado')) curto = null;
  else if (tags.includes('repor')) curto = 'Hora de repor';
  else if (tags.includes('combina')) curto = 'Combina com sua cesta';
  else if (nC >= 4 && mp.n / nC >= 0.7) curto = 'Você sempre leva';
  return { motivos: m, tags, motivoCurto: curto };
}

/**
 * Ranking de TODOS os produtos para um cliente (ou global se mod == null).
 * opts: { cesta, ativos:Set, explicar:n (quantos do topo explicar), produtos:Map }
 */
function pontuarCliente(mod, G, D, opts = {}) {
  const produtos = opts.produtos || new Map();
  const ids = new Set(Object.keys(G.pop));
  if (mod) Object.keys(mod.prod).forEach((i) => ids.add(i));
  const out = [];
  for (const pid of ids) {
    if (opts.ativos && !opts.ativos.has(pid)) continue;
    const r = probCompra(mod, pid, G, D, opts);
    const q = r.mp && r.mp.q ? { esperada: r.mp.q.med, p25: r.mp.q.p25, p75: r.mp.q.p75 } : { esperada: G.pop[pid] ? G.pop[pid].qMed : null, p25: null, p75: null };
    out.push({ id: pid, p: r.p, conf: r.conf, qtd: q, t: r.t, _r: r });
  }
  out.sort((a, b) => b.p - a.p || (G.pop[b.id]?.p || 0) - (G.pop[a.id]?.p || 0));
  const nExp = opts.explicar === undefined ? 0 : opts.explicar;
  out.forEach((o, i) => {
    if (i < nExp) { const e = explicar(mod, o.id, o._r, G, D, produtos); o.motivos = e.motivos; o.tags = e.tags; o.motivoCurto = e.motivoCurto; }
    delete o._r;
  });
  return out;
}

const rotuloConfianca = (c) => (c < C.CONF_BAIXA ? 'baixa' : c < C.CONF_ALTA ? 'média' : 'alta');

module.exports = { probCompra, explicar, pontuarCliente, rotuloConfianca, NOMES_DOW };

