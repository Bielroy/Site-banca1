'use strict';
// =====================================================================
//  analytics/customerProfile.js — PERFIL COMPORTAMENTAL (módulo 1) e
//  CONTEXTO GLOBAL (níveis 3-5 da hierarquia, módulo 11).
//
//  modelarCliente()  → documento COMPACTO por cliente. É o que vai pro
//                      Firestore; o ranking o usa sem precisar do histórico bruto.
//  construirGlobal() → popularidade, efeito dia-da-semana, ritmo de visitas
//                      e priors usados quando o cliente tem pouco histórico.
//  Mediana/MAD/desvio/frequência/recência — nunca só a média.
// =====================================================================
const C = require('./config');
const S = require('./stats');
const R = require('./repurchaseModel');
const { dowDeDia, semanaDeDia } = require('./normalize');

const nivelHistorico = (n) => (n <= 0 ? 'sem_historico' : n >= C.NIVEIS_HISTORICO.recorrente ? 'recorrente' : n >= C.NIVEIS_HISTORICO.aprendendo ? 'aprendendo' : 'inicial');

function construirGlobal(clientes, produtos, hoje) {   // hoje = data de corte (inclusive)
  const hl = C.MEIA_VIDA_GLOBAL_DIAS;
  let N = 0, nVisitas = 0; const Nd = Array(7).fill(0);
  const nP = {}, nPraw = {}, nPd = {}, nCat = {}, qtds = {};
  const gapCont = Array(C.GAP_MAX + 1).fill(0); let nGaps = 0;
  const nus = [], sObs = [], locRel = [];

  for (const cli of clientes) {
    const V = cli.visitas.filter((v) => v.dia <= hoje); if (!V.length) continue;
    for (let i = 1; i < V.length; i++) {
      const k = Math.min(C.GAP_MAX, Math.max(0, semanaDeDia(V[i].dia) - semanaDeDia(V[i - 1].dia)));
      gapCont[k]++; nGaps++;
    }
    const nuC = V.length >= 3 ? S.median(V.slice(1).map((v, i) => v.dia - V[i].dia)) : null;
    if (nuC) nus.push(nuC);

    const dias = {};
    for (const v of V) {
      const w = Math.pow(0.5, Math.max(0, hoje - v.dia) / hl), d = dowDeDia(v.dia);
      N += w; nVisitas++; Nd[d] += w;
      const cats = new Set();
      for (const [pid, it] of v.itens) {
        nP[pid] = (nP[pid] || 0) + w; nPraw[pid] = (nPraw[pid] || 0) + 1;
        (nPd[pid] = nPd[pid] || Array(7).fill(0))[d] += w;
        const pr = produtos.get(pid); if (pr) cats.add(pr.cat);
        if (it.conhecida) (qtds[pid] = qtds[pid] || []).push(it.qtd);
        (dias[pid] = dias[pid] || []).push(v.dia);
      }
      cats.forEach((c) => { nCat[c] = (nCat[c] || 0) + w; });
    }
    for (const pid of Object.keys(dias)) {
      if (dias[pid].length >= 4) {
        const iv = dias[pid].slice(1).map((d, i) => Math.log(d - dias[pid][i])); const s = S.robustSd(iv);
        if (Number.isFinite(s)) sObs.push(s);
        if (nuC) locRel.push(S.median(iv) - Math.log(nuC));      // ciclo do produto relativo ao ritmo do cliente
      }
    }
  }

  const pop = {};
  for (const pid of Object.keys(nP)) {
    const pr = produtos.get(pid);
    pop[pid] = { p: N > 0 ? nP[pid] / N : 0, n: nPraw[pid], cat: pr ? pr.cat : 'outros', qMed: qtds[pid] ? S.arred(S.median(qtds[pid])) : null };
  }
  for (const pr of produtos.values()) if (!pop[pr.id]) pop[pr.id] = { p: 0, n: 0, cat: pr.cat, qMed: null };
  const cat = {}; for (const c of Object.keys(nCat)) cat[c] = N > 0 ? nCat[c] / N : 0;

  const dow = {};
  for (const pid of Object.keys(nPd)) {
    if (nPraw[pid] < 5 || !(pop[pid].p > 0)) continue;
    dow[pid] = nPd[pid].map((x, d) => S.arred(((x + C.K_DOW_PRODUTO * pop[pid].p) / (Nd[d] + C.K_DOW_PRODUTO)) / pop[pid].p, 2));
  }
  const sN = Nd.reduce((a, b) => a + b, 0) || 1;

  return {
    hoje, nVisitas, nClientes: clientes.length,
    pop, cat, dow, dowGlobal: Nd.map((x) => x / sN),
    gapGlobal: nGaps >= 5 ? gapCont.map((c) => c / nGaps) : null,
    nuGlobal: nus.length >= 3 ? S.median(nus) : C.NU_PADRAO,
    sLogPrior: sObs.length >= 5 ? S.clamp(S.median(sObs), C.S_MIN_LOG, 1) : C.S_PRIOR_PADRAO,
    // incerteza do prior de localização = quanto o ciclo de um produto varia em relação ao ritmo de visitas
    tauLoc: locRel.length >= 5 ? Math.max(S.robustSd(locRel), 2 * C.S_MIN_LOG) : C.TAU_PRIOR_PADRAO,
    assoc: {},
  };
}

const tendencia = (qs) => {
  if (qs.length < 5) return 'insuficiente';
  const rec = qs.slice(-3), ant = qs.slice(-8, -3);
  const sd = S.stdev(qs);
  if (!(sd > 0) || ant.length < 2) return 'estavel';
  const z = (S.mean(rec) - S.mean(ant)) / (sd * Math.sqrt(1 / rec.length + 1 / ant.length));
  return z > C.Z_TENDENCIA ? 'crescente' : z < -C.Z_TENDENCIA ? 'decrescente' : 'estavel';
};

function modelarCliente(cli, G, hoje, produtos) {
  const V = cli.visitas.filter((v) => v.dia <= hoje);
  const n = V.length; if (!n) return null;
  const dias = V.map((v) => v.dia);
  const ints = dias.slice(1).map((d, i) => d - dias[i]);
  const nuMed = ints.length >= 2 ? S.median(ints) : null;

  const gaps = Array(C.GAP_MAX + 1).fill(0), dow = Array(7).fill(0);
  for (let i = 0; i < n; i++) {
    dow[dowDeDia(dias[i])]++;
    if (i) gaps[Math.min(C.GAP_MAX, Math.max(0, semanaDeDia(dias[i]) - semanaDeDia(dias[i - 1])))]++;
  }

  const rec = new Map(); const cats = {}; const pares = new Map();
  V.forEach((v, idx) => {
    const cs = new Set(), ids = [];
    for (const [pid, it] of v.itens) {
      if (!rec.has(pid)) rec.set(pid, { dias: [], idx: [], qtds: [], nEst: 0 });
      const r = rec.get(pid); r.dias.push(v.dia); r.idx.push(idx);
      if (it.conhecida) r.qtds.push(it.qtd); if (it.estimada) r.nEst++;
      const pr = produtos.get(pid); if (pr) cs.add(pr.cat); ids.push(pid);
    }
    cs.forEach((c) => { cats[c] = (cats[c] || 0) + 1; });
    ids.sort(); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] + '\u0001' + ids[j]; pares.set(k, (pares.get(k) || 0) + 1); }
  });

  const prior = { m0: Math.log(Math.max(nuMed || G.nuGlobal, 1)), s0: G.sLogPrior, tau: G.tauLoc };
  const prod = {};
  for (const [pid, r] of rec) {
    const iv = r.dias.slice(1).map((d, i) => d - r.dias[i]);
    const ciclo = R.ajustarCiclo(iv, prior);
    const mu = Math.exp(ciclo.m);
    const lbl = R.rotuloCiclo(mu, iv.length, ciclo.sObs);
    const qs = r.qtds;
    let q = null;
    if (qs.length) {
      const w = S.pesosMeiaVida(qs.length, C.MEIA_VIDA_COMPRAS);
      q = { med: S.arred(S.medianaPonderada(qs, w)), media: S.arred(S.mean(qs)), dp: S.arred(qs.length > 1 ? S.stdev(qs) : 0), p25: S.arred(S.quantile(qs, 0.25)), p75: S.arred(S.quantile(qs, 0.75)), n: qs.length, ult: S.arred(qs[qs.length - 1]), tend: tendencia(qs) };
    }
    const ult = r.dias[r.dias.length - 1];
    const a = R.retencao(ciclo, hoje - ult);
    prod[pid] = {
      n: r.dias.length, ult, pen: r.dias.length > 1 ? r.dias[r.dias.length - 2] : null,
      m: S.arred(ciclo.m, 4), s: S.arred(ciclo.s, 4), nInt: iv.length, sObs: S.arred(ciclo.sObs),
      mu: S.arred(mu, 1), ciclo: lbl, alt: R.detectarAlternancia(r.idx), q,
      nEst: r.nEst,
      abandonado: r.dias.length >= 3 && a < 0.5,
      novo: n >= 4 && r.idx[0] >= n - 3 && r.dias.length <= 2,
    };
  }

  const dowTop = dow.indexOf(Math.max(...dow));
  const juntos = [...pares.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, c]) => { const [a, b] = k.split('\u0001'); return { a, b, n: c }; });   // objetos: Firestore não aceita arrays aninhados

  return {
    id: cli.id, nome: cli.nome, quadra: cli.quadra, lote: cli.lote, uids: [...cli.uids],
    nVisitas: n, nivel: nivelHistorico(n),
    primeiroDia: dias[0], ultimoDia: dias[n - 1], penultimoDia: n > 1 ? dias[n - 2] : null,
    nuMed, nuMedia: ints.length ? S.arred(S.mean(ints), 2) : null, nuDp: ints.length >= 2 ? S.arred(S.stdev(ints), 2) : null,
    freqSemanal: ints.length ? S.arred(7 / S.mean(ints), 2) : null,
    dow, dowTop, gaps, cats, prod, juntos,
  };
}

module.exports = { construirGlobal, modelarCliente, nivelHistorico };

