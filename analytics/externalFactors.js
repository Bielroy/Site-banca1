'use strict';
// =====================================================================
//  analytics/externalFactors.js — O QUE MEXE NA PROCURA ALÉM DO CALENDÁRIO
//
//  Quatro "estados" do dia e um efeito contínuo:
//    chuva     choveu de verdade (≥ CHUVA_MM)
//    calor     máxima bem acima do normal dos últimos 30 dias
//    frio      máxima bem abaixo do normal dos últimos 30 dias
//    pag       dias de pagamento (do dia 5 ao 10 do mês)
//    preço     quanto o preço do dia está abaixo/acima do preço de referência
//              (preço "de" da oferta, ou a mediana das 4 semanas anteriores)
//
//  COMO APRENDE (rápido, sem inventar):
//   • Cada efeito é medido comparando os dias "com" e os dias "sem", SEMPRE do
//     mesmo dia da semana (sábado de chuva × sábado seco).
//   • Hierarquia: LOJA → CATEGORIA → PRODUTO. Com 4 dias de chuva a loja inteira
//     já mostra o efeito, muito antes de um produto sozinho mostrar. O produto
//     herda o da categoria e só se afasta dele quando o próprio volume justifica
//     (encolhimento bayesiano: peso = τ² / (τ² + variância da medida)).
//   • Sem evidência o fator é 1. A única exceção é o preço: antes de ver uma
//     oferta na loja, vale uma elasticidade modesta de partida (ELAST_PRIOR).
//   • Os efeitos são estimados juntos, em 2 voltas (cada um mede o que sobra
//     depois de descontar os outros), para chuva e frio não se confundirem.
//
//  COMO ENTRA NA PREVISÃO: a série de cada produto é dividida pelo fator do dia
//  (vira "procura de um dia comum"); o núcleo prevê o dia comum e a previsão é
//  multiplicada pelo fator do dia-alvo (clima previsto, preço de hoje).
//
//  Arquivo PURO: não fala com banco nem com a internet (isso é lib/clima.js).
// =====================================================================
const C = require('./config');
const S = require('./stats');
const { dowDeDia } = require('./normalize');

const ESTADOS = ['chuva', 'calor', 'frio', 'pag'];
const ROTULO = { chuva: 'dia de chuva', calor: 'dia de calor acima do normal', frio: 'dia mais frio que o normal', pag: 'dias de pagamento (5 a 10)' };

// ---------- estados do dia -----------------------------------------
const diaDoMes = (d) => new Date(d * 86400000).getUTCDate();
const mesDe = (d) => { const t = new Date(d * 86400000); return t.getUTCFullYear() * 12 + t.getUTCMonth(); };

/** clima: Map(dia → { chuva: mm, tmax: °C }). Devolve Map(dia → { chuva, calor, frio }) com true/false/null (null = não sei). */
function estadosDoClima(clima) {
  const out = new Map();
  if (!clima || !clima.size) return out;
  const dias = [...clima.keys()].sort((a, b) => a - b);
  for (const d of dias) {
    const c = clima.get(d) || {};
    const ant = [];
    for (let k = 1; k <= 30; k++) { const x = clima.get(d - k); if (x && Number.isFinite(x.tmax)) ant.push(x.tmax); }
    const med = ant.length >= 7 ? S.median(ant) : null;
    out.set(d, {
      chuva: Number.isFinite(c.chuva) ? c.chuva >= C.CHUVA_MM : null,
      calor: med != null && Number.isFinite(c.tmax) ? c.tmax >= med + C.CALOR_GRAUS : null,
      frio: med != null && Number.isFinite(c.tmax) ? c.tmax <= med - C.FRIO_GRAUS : null,
    });
  }
  return out;
}
const ehPagamento = (d) => { const m = diaDoMes(d); return m >= C.PAGAMENTO_DE && m <= C.PAGAMENTO_ATE; };

/** Estado completo de um dia. ctx.estadosClima = saída de estadosDoClima. */
function estadoDoDia(d, ctx) {
  const c = (ctx && ctx.estadosClima && ctx.estadosClima.get(d)) || {};
  return { chuva: c.chuva ?? null, calor: c.calor ?? null, frio: c.frio ?? null, pag: C.USAR_PAGAMENTO ? ehPagamento(d) : null };
}

// ---------- preço relativo -----------------------------------------
/**
 * ρ = preço do dia ÷ preço de referência. 1 quando não dá para saber. mapa: Map(dia → { p, de })
 * porDia: o produto tem PREÇO POR DIA DA SEMANA (terça mais cara, quarta mais barata, de propósito).
 * Aí a referência é o preço dos MESMOS dias da semana nas semanas anteriores: senão toda quarta
 * pareceria promoção e toda terça pareceria aumento, e o motor erraria a procura dos dois dias.
 */
function precoRelativo(mapa, d, porDia = false) {
  if (!mapa) return 1;
  const info = mapa.get(d); if (!info || !(info.p > 0)) return 1;
  let ref = null;
  if (info.de > info.p) ref = info.de;                                    // oferta declarada: o "de" é a referência
  else {
    const ant = [];
    if (porDia) for (let k = 1; k <= 8; k++) { const x = mapa.get(d - 7 * k); if (x && x.p > 0) ant.push(x.de > x.p ? x.de : x.p); }
    else for (let k = 1; k <= C.PRECO_JANELA_REF; k++) { const x = mapa.get(d - k); if (x && x.p > 0) ant.push(x.de > x.p ? x.de : x.p); }
    if (ant.length >= 3) ref = S.median(ant);
  }
  if (!(ref > 0)) return 1;
  const r = info.p / ref;
  return Math.abs(Math.log(r)) < C.PRECO_MIN_LOG ? 1 : S.clamp(r, 0.4, 2);
}

// ---------- medida "com × sem", controlada pelo dia da semana -------
// pontos: [{ dia, y }] já sem os dias de falta. dentro(d) → true/false/null.
// Devolve O (vendido nos dias "com"), E (o que se esperava neles pelos dias "sem" do
// mesmo dia da semana), nIn/nOut e, por dia, o par (o, e) para os níveis agregados.
function comSem(pontos, dentro) {
  const sIn = Array(7).fill(0), nIn = Array(7).fill(0), sOut = Array(7).fill(0), nOut = Array(7).fill(0);
  const marc = [];
  for (const o of pontos) {
    const st = dentro(o.dia); if (st == null) continue;
    const w = dowDeDia(o.dia);
    if (st) { sIn[w] += o.y; nIn[w]++; } else { sOut[w] += o.y; nOut[w]++; }
    marc.push({ dia: o.dia, y: o.y, w, st });
  }
  let O = 0, E = 0, n = 0, somaOut = 0, totOut = 0;
  for (let w = 0; w < 7; w++) { somaOut += sOut[w]; totOut += nOut[w]; if (nIn[w] && nOut[w]) { O += sIn[w]; E += nIn[w] * (sOut[w] / nOut[w]); n += nIn[w]; } }
  // por dia: esperado = média dos OUTROS dias "sem" do mesmo dia da semana (deixa o próprio dia de fora)
  const porDia = [];
  for (const m of marc) {
    if (m.st) { if (nOut[m.w]) porDia.push({ dia: m.dia, st: true, o: m.y, e: sOut[m.w] / nOut[m.w] }); }
    else if (nOut[m.w] >= 2) porDia.push({ dia: m.dia, st: false, o: m.y, e: (sOut[m.w] - m.y) / (nOut[m.w] - 1) });
  }
  return { O, E, n, nOut: totOut, somaOut, porDia };
}

// agrega vários produtos (peso = preço: tudo vira R$) num "com × sem" por DIA
function agregar(medidas) {
  const dias = new Map();
  for (const { m, peso } of medidas) for (const x of m.porDia) {
    const a = dias.get(x.dia) || { st: x.st, o: 0, e: 0 }; a.o += x.o * peso; a.e += x.e * peso; dias.set(x.dia, a);
  }
  let oI = 0, eI = 0, oO = 0, eO = 0, nI = 0, nO = 0; const logsOut = [];
  for (const a of dias.values()) {
    if (!(a.e > 0)) continue;
    if (a.st) { oI += a.o; eI += a.e; nI++; } else { oO += a.o; eO += a.e; nO++; logsOut.push(Math.log(Math.max(a.o, a.e * 0.05) / a.e)); }
  }
  if (!nI || !nO || !(eI > 0) || !(eO > 0)) return { ok: false, nIn: nI, nOut: nO };
  const bruto = Math.log(Math.max(oI, eI * 0.05) / eI) - Math.log(Math.max(oO, eO * 0.05) / eO);
  const sdDia = logsOut.length >= 4 ? Math.max(S.stdev(logsOut), C.FATOR_SD_DIA_MIN) : C.FATOR_SD_DIA_PADRAO;
  return { ok: true, bruto, variancia: sdDia * sdDia * (1 / nI + 1 / nO), nIn: nI, nOut: nO, diasIn: [...dias.entries()].filter(([, a]) => a.st && a.e > 0).map(([d]) => d) };
}
const encolher = (pai, bruto, variancia, tau) => pai + (bruto - pai) * (tau * tau) / (tau * tau + variancia);

// ---------- aprendizado --------------------------------------------
/**
 * series:   Map(pid → [{ dia, y, cens? }])  vendas CRUAS, só dias abertos (zeros preenchidos)
 * produtos: Map(pid → { cat, preco })
 * ctx:      { estadosClima: Map, precos: Map(pid → Map(dia → {p, de})) }
 * fim:      último dia completo
 */
function aprender({ series, produtos, ctx, fim }) {
  const modelo = { estados: {}, preco: { loja: C.ELAST_PRIOR, cat: {}, prod: {}, n: 0 }, ctx };
  ESTADOS.forEach((s) => { modelo.estados[s] = { loja: 0, cat: {}, prod: {}, n: 0, confiavel: false }; });
  if (!C.FATORES_ATIVOS) return modelo;
  const ini = fim - C.JANELA_FATORES;
  const base = new Map();
  for (const [pid, s] of series) {
    const pts = s.filter((o) => o.dia > ini && o.dia <= fim && !o.cens).map((o) => ({ dia: o.dia, y: o.yObs != null ? o.yObs : o.y }));
    if (pts.length >= C.MIN_PONTOS_FATOR) base.set(pid, pts);
  }
  if (!base.size) return modelo;
  const catDe = (pid) => (produtos.get(pid) || {}).cat || 'outros';
  const pesoDe = (pid) => Math.max(Number((produtos.get(pid) || {}).preco) || 0, 0.01);
  const rho = new Map();                                              // pid → Map(dia → ρ) só onde ρ ≠ 1
  if (C.USAR_PRECO && ctx && ctx.precos) for (const [pid, pts] of base) {
    const mp = ctx.precos.get(pid); if (!mp) continue;
    const porDia = !!(ctx.porDia && ctx.porDia.has(pid));
    const r = new Map(); for (const o of pts) { const x = precoRelativo(mp, o.dia, porDia); if (x !== 1) r.set(o.dia, x); }
    if (r.size) rho.set(pid, r);
  }
  const est = new Map(); const estado = (d) => { if (!est.has(d)) est.set(d, estadoDoDia(d, ctx)); return est.get(d); };

  // fator atual de um produto num dia, opcionalmente SEM um dos efeitos (para medir justamente esse)
  const fatorSem = (pid, d, menos) => {
    let lf = 0; const st = estado(d), cat = catDe(pid);
    for (const s of ESTADOS) if (s !== menos && st[s]) lf += betaDe(modelo, s, pid, cat);
    if (menos !== 'preco') { const r = rho.get(pid); const x = r && r.get(d); if (x) lf += -elastDe(modelo, pid, cat) * Math.log(x); }
    return Math.exp(S.clamp(lf, Math.log(C.FATOR_MIN), Math.log(C.FATOR_MAX)));
  };

  for (let volta = 0; volta < C.FATOR_VOLTAS; volta++) {
    // ----- preço (elasticidade) -----
    if (C.USAR_PRECO && rho.size) {
      const porProd = [];
      for (const [pid, r] of rho) {
        const pts = base.get(pid).map((o) => ({ dia: o.dia, y: o.y / fatorSem(pid, o.dia, 'preco') }));
        const m = comSem(pts, (d) => r.has(d));
        if (!(m.n > 0) || !(m.E > 0)) continue;
        let sx = 0, se = 0; for (const x of m.porDia) if (x.st) { sx += x.e * Math.log(r.get(x.dia)); se += x.e; }
        const lr = se > 0 ? sx / se : 0; if (Math.abs(lr) < C.PRECO_MIN_LOG) continue;
        const ylog = Math.log((m.O + 0.5) / (m.E + 0.5)), v = C.FATOR_SOBREDISP * (1 / (m.O + 0.5) + 1 / (m.somaOut + 0.5));
        porProd.push({ pid, cat: catDe(pid), x: -lr, ylog, v, n: m.n });
      }
      const mqo = (lista) => { let a = 0, b = 0, n = 0; for (const p of lista) { a += p.x * p.ylog / p.v; b += p.x * p.x / p.v; n += p.n; } return b > 0 ? { e: a / b, v: 1 / b, n } : null; };
      const L = mqo(porProd);
      modelo.preco = { loja: C.ELAST_PRIOR, cat: {}, prod: {}, n: L ? L.n : 0 };
      if (L) modelo.preco.loja = S.clamp(encolher(C.ELAST_PRIOR, L.e, L.v, C.TAU_ELAST_LOJA), 0, C.ELAST_MAX);
      const cats = {}; porProd.forEach((p) => { (cats[p.cat] = cats[p.cat] || []).push(p); });
      for (const [c, lista] of Object.entries(cats)) { const m = mqo(lista); if (m) modelo.preco.cat[c] = S.clamp(encolher(modelo.preco.loja, m.e, m.v, C.TAU_ELAST_FILHO), 0, C.ELAST_MAX); }
      for (const p of porProd) modelo.preco.prod[p.pid] = S.clamp(encolher(modelo.preco.cat[p.cat] ?? modelo.preco.loja, p.ylog / p.x, p.v / (p.x * p.x), C.TAU_ELAST_FILHO), 0, C.ELAST_MAX);
    }
    // ----- estados (clima e pagamento) -----
    for (const s of ESTADOS) {
      if ((s === 'pag' && !C.USAR_PAGAMENTO) || (s !== 'pag' && !C.USAR_CLIMA)) continue;
      const med = [];
      for (const [pid, ptsB] of base) {
        const pts = ptsB.map((o) => ({ dia: o.dia, y: o.y / fatorSem(pid, o.dia, s) }));
        const m = comSem(pts, (d) => estado(d)[s]);
        if (m.n > 0 && m.E > 0) med.push({ pid, cat: catDe(pid), m, peso: pesoDe(pid) });
      }
      const alvo = { loja: 0, cat: {}, prod: {}, n: 0, confiavel: false };
      const L = agregar(med);
      alvo.n = L.nIn || 0;
      const meses = L.ok ? new Set(L.diasIn.map(mesDe)).size : 0;
      // só usa o efeito quando ele se destaca do sobe-e-desce normal de um dia para o outro
      const destaca = L.ok && Math.abs(L.bruto) >= C.Z_ESTADO_MIN * Math.sqrt(L.variancia);
      const dados = L.ok && L.nIn >= C.MIN_DIAS_ESTADO && L.nOut >= C.MIN_DIAS_SEM && (s !== 'pag' || meses >= C.MIN_MESES_PAGAMENTO);
      if (dados) {
        const cats = {}; med.forEach((x) => { (cats[x.cat] = cats[x.cat] || []).push(x); });
        const usadas = new Set();
        if (destaca) {
          // a loja inteira muda nesses dias: cada categoria parte do efeito da loja
          alvo.confiavel = true;
          alvo.loja = S.clamp(encolher(0, L.bruto, L.variancia, C.TAU_ESTADO_LOJA), -C.BETA_MAX, C.BETA_MAX);
          for (const [c, lista] of Object.entries(cats)) {
            const a = agregar(lista);
            alvo.cat[c] = a.ok && a.nIn >= C.MIN_DIAS_ESTADO ? S.clamp(encolher(alvo.loja, a.bruto, a.variancia, C.TAU_ESTADO_FILHO), -C.BETA_MAX, C.BETA_MAX) : alvo.loja;
            usadas.add(c);
          }
        } else {
          // a loja como um todo não muda, mas UMA categoria pode mudar (calor puxa fruta e não mexe no resto).
          // Como são várias categorias testadas, a exigência aqui é maior.
          for (const [c, lista] of Object.entries(cats)) {
            const a = agregar(lista);
            if (a.ok && a.nIn >= C.MIN_DIAS_ESTADO && a.nOut >= C.MIN_DIAS_SEM && Math.abs(a.bruto) >= C.Z_ESTADO_CAT * Math.sqrt(a.variancia)) {
              alvo.cat[c] = S.clamp(encolher(0, a.bruto, a.variancia, C.TAU_ESTADO_LOJA), -C.BETA_MAX, C.BETA_MAX);
              alvo.confiavel = true; usadas.add(c);
            }
          }
        }
        for (const x of med) {
          if (!usadas.has(x.cat)) continue;
          const pai = alvo.cat[x.cat] ?? alvo.loja;
          const bruto = Math.log((x.m.O + 0.5) / (x.m.E + 0.5)), v = C.FATOR_SOBREDISP * (1 / (x.m.O + 0.5) + 1 / (x.m.somaOut + 0.5));
          alvo.prod[x.pid] = S.clamp(encolher(pai, bruto, v, C.TAU_ESTADO_PROD), -C.BETA_MAX, C.BETA_MAX);
        }
      }
      modelo.estados[s] = alvo;
    }
  }
  return modelo;
}

const betaDe = (modelo, s, pid, cat) => { const e = modelo.estados[s]; if (!e || !e.confiavel) return 0; return e.prod[pid] ?? e.cat[cat] ?? e.loja; };
const elastDe = (modelo, pid, cat) => modelo.preco.prod[pid] ?? modelo.preco.cat[cat] ?? modelo.preco.loja;

/**
 * Fator multiplicativo de um produto num dia (passado ou futuro).
 * precoInfo (opcional): { p, de } para um dia que ainda não está em ctx.precos (hoje/amanhã).
 * Devolve { f, partes: [{ tipo, fator, n }] } — partes só com o que mudou alguma coisa.
 */
function fator(modelo, pid, cat, d, precoInfo) {
  const partes = []; let lf = 0;
  if (!modelo || !C.FATORES_ATIVOS) return { f: 1, partes };
  const st = estadoDoDia(d, modelo.ctx);
  for (const s of ESTADOS) {
    if (!st[s]) continue;
    const b = betaDe(modelo, s, pid, cat);
    if (b !== 0) { lf += b; partes.push({ tipo: s, fator: Math.exp(b), n: modelo.estados[s].n }); }
  }
  if (C.USAR_PRECO && modelo.ctx && modelo.ctx.precos) {
    let mp = modelo.ctx.precos.get(pid);
    if (precoInfo && precoInfo.p > 0) { mp = new Map(mp || []); mp.set(d, precoInfo); }
    const r = precoRelativo(mp, d, !!(modelo.ctx.porDia && modelo.ctx.porDia.has(pid)));
    if (r !== 1) { const b = -elastDe(modelo, pid, cat) * Math.log(r); lf += b; partes.push({ tipo: 'preco', fator: Math.exp(b), rho: r, n: modelo.preco.n }); }
  }
  return { f: Math.exp(S.clamp(lf, Math.log(C.FATOR_MIN), Math.log(C.FATOR_MAX))), partes };
}

/** Fator só com os efeitos da LOJA (para as séries agregadas em R$: categoria e loja inteira). */
function fatorLoja(modelo, d, cat) {
  if (!modelo || !C.FATORES_ATIVOS) return 1;
  const st = estadoDoDia(d, modelo.ctx); let lf = 0;
  for (const s of ESTADOS) { const e = modelo.estados[s]; if (st[s] && e && e.confiavel) lf += (cat && e.cat[cat] != null ? e.cat[cat] : e.loja); }
  return Math.exp(S.clamp(lf, Math.log(C.FATOR_MIN), Math.log(C.FATOR_MAX)));
}

/** Frases para o painel. */
function explicar(partes) {
  return (partes || []).filter((p) => Math.abs(Math.log(p.fator)) >= Math.log(C.LIMIAR_EXPLICAR_FATOR) * 0.5).map((p) => {
    const pc = Math.round(Math.abs(p.fator - 1) * 100), x = p.fator >= 1 ? `uns ${pc}% maior` : `uns ${pc}% menor`;
    if (p.tipo === 'preco') {
      const pct = Math.round(Math.abs(1 - p.rho) * 100);
      return p.rho < 1 ? `Preço ${pct}% abaixo do normal: procura ${x}${p.n ? ` (medido em ${p.n} dia(s) de oferta na loja)` : ' (estimativa de partida: a loja ainda não teve oferta medida)'}`
        : `Preço ${pct}% acima do normal: procura ${x}`;
    }
    if (p.tipo === 'pag') return `Dias de pagamento (5 a 10): procura ${x} (visto em ${p.n} dia(s))`;
    return `Previsão do tempo: ${ROTULO[p.tipo]}. Nesses dias a procura é ${x} (visto em ${p.n} dia(s))`;
  });
}

/** Resumo do que o motor aprendeu, para o cabeçalho do painel. */
function resumo(modelo) {
  const out = {};
  for (const s of ESTADOS) { const e = modelo.estados[s]; out[s] = { n: e.n, confiavel: e.confiavel, fator: e.confiavel ? S.arred(Math.exp(e.loja), 2) : null }; }
  out.preco = { n: modelo.preco.n, elasticidade: S.arred(modelo.preco.loja, 2) };
  return out;
}

module.exports = { ESTADOS, ROTULO, estadosDoClima, ehPagamento, estadoDoDia, precoRelativo, comSem, agregar, aprender, fator, fatorLoja, explicar, resumo };
