'use strict';
// =====================================================================
//  analytics/demandForecast.js — PREVISÃO DE DEMANDA GERAL (módulos 7, 8,
//  11 níveis 3-5, 13)
//
//  1) NÚCLEO por produto (série diária, só dias abertos, zeros preenchidos):
//       E1 = média ponderada (meia-vida) das últimas N ocorrências do MESMO
//            dia da semana                       → captura o dia da semana
//       E2 = nível dos últimos 28 dias × fator do dia da semana (encolhido)
//                                                → robusto quando E1 tem poucas obs.
//       núcleo = (n1·E1 + K·E2) / (n1 + K)
//  2) FATORES SAZONAIS: feriado/data especial e mês — SÓ com evidência
//     (≥ 2 ocorrências, ver seasonality.js). Antes disso, fator = 1.
//  3) BOTTOM-UP: Σ_clientes  P(visita no dia) × P(compra|visita) × qtd habitual
//     (módulo 10). Combinado com o top-down por pesos ∝ 1/WAPE medido em
//     backtest dos últimos dias — o método que errou menos pesa mais.
//  4) INCERTEZA: quantis EMPÍRICOS dos resíduos de um walk-forward do próprio
//     núcleo (previsão de cada dia usando só o passado dele). Sem resíduos
//     suficientes → incerteza de Poisson (princípio de contagem) e confiança baixa.
//     Horizontes de vários dias usam a soma móvel dos resíduos (não √n ad hoc).
// =====================================================================
const C = require('./config');
const S = require('./stats');
const N = require('./normalize');
const SZ = require('./seasonality');
const R = require('./repurchaseModel');
const P = require('./customerProfile');
const K = require('./ranking');
const F = require('./confidence');
const INV = require('./inventoryRecommendation');
const EF = require('./externalFactors');
const { dowDeDia, semanaDeDia } = N;

// ---------- série --------------------------------------------------
// rupturas (opcional): Set de dias em que o produto ACABOU (aba Fechamento, "Não tem")
// extra (opcional):
//   pular     Set de dias que NÃO entram (loja não funcionou, produto fora da loja o dia todo)
//   fatorDe   (dia) → fator externo do dia (clima, pagamento, preço). A série guarda a venda
//             DIVIDIDA pelo fator ("procura de um dia comum") e o fator em `f`.
//   dowPrior  [7] perfil de dia da semana da LOJA (média 1), ponto de partida do produto
function montarSerie(mapaDia, fim, abertos, rupturas, extra = {}) {
  if (!mapaDia || !mapaDia.size) return [];
  const ini = Math.max(Math.min(...mapaDia.keys()), fim - C.JANELA_LONGA_DIAS);
  const s = [];
  for (let d = ini; d <= fim; d++) if (abertos.has(dowDeDia(d))) {
    if (extra.pular && extra.pular.has(d) && !mapaDia.get(d)) continue;
    const f = extra.fatorDe ? extra.fatorDe(d) : 1;
    const o = { dia: d, y: (mapaDia.get(d) || 0) / f };
    if (f !== 1) o.f = f;
    if (rupturas && rupturas.has(d)) o.cens = true;
    s.push(o);
  }
  const out = C.CORRIGIR_RUPTURA ? descensurar(s) : s;
  if (extra.dowPrior) out.dowPrior = extra.dowPrior;
  return out;
}

// Perfil de dia da semana da LOJA: média de cada dia ÷ média geral (em R$ ou pedidos),
// encolhido para 1 e com média 1 nos dias abertos. Um produto novo já nasce sabendo que
// "sábado vende mais", em vez de precisar de semanas para descobrir sozinho.
function perfilDowLoja(mapaDia, fim, abertos, pular) {
  const soma = Array(7).fill(0), n = Array(7).fill(0);
  if (!mapaDia || !mapaDia.size) return null;
  const ini = Math.max(Math.min(...mapaDia.keys()), fim - 8 * 7 + 1);
  for (let d = ini; d <= fim; d++) { const w = dowDeDia(d); if (!abertos.has(w) || (pular && pular.has(d))) continue; soma[w] += mapaDia.get(d) || 0; n[w]++; }
  const tot = S.sum(soma), dias = S.sum(n);
  if (!(tot > 0) || dias < 4) return null;
  const mAll = tot / dias, f = Array(7).fill(1);
  for (let w = 0; w < 7; w++) if (abertos.has(w)) f[w] = n[w] ? (n[w] * (soma[w] / n[w] / mAll) + 2) / (n[w] + 2) : 1;
  const ab = [...abertos], m = S.mean(ab.map((w) => f[w]));
  ab.forEach((w) => { f[w] /= m; });
  return f;
}

// ---------- preparo: dias fechados, perfil da loja, fatores externos ----------
/**
 * Monta as séries de todos os produtos já "limpas":
 *   vendasDia   Map(pid → Map(dia → qtd))        produtos   Map(pid → { cat, preco })
 *   ids         produtos a prever                rupturas   Map(pid → Set(dia)) dias em que acabou
 *   atividade   Map(dia → nº de pedidos da loja) contexto   { estadosClima, precos, fora: Map(pid → Set(dia)) }
 * Devolve { series, modelo, fechados, dowPrior, receitaDia }.
 */
function prepararSeries({ vendasDia, produtos, ids, asOfD, abertos, rupturas = new Map(), atividade, contexto = {} }) {
  // 1) dias em que a loja não funcionou
  const fechados = new Set();
  if (atividade && atividade.size) {
    const comMov = [...atividade.entries()].filter(([d, n]) => d <= asOfD && n > 0);
    if (comMov.length >= 7 && S.mean(comMov.map(([, n]) => n)) >= C.FECHADO_MIN_VISITAS) {
      const ini = Math.min(...comMov.map(([d]) => d));
      for (let d = ini; d <= asOfD; d++) if (abertos.has(dowDeDia(d)) && !(atividade.get(d) > 0)) fechados.add(d);
    }
  }
  // 2) receita por dia (R$) → perfil de dia da semana da loja
  const receitaDia = new Map();
  for (const [pid, mp] of vendasDia) { const pr = produtos.get(pid); if (!pr) continue; for (const [d, q] of mp) if (d <= asOfD) receitaDia.set(d, (receitaDia.get(d) || 0) + q * (Number(pr.preco) || 0)); }
  const dowPrior = C.DOW_LOJA_ATIVO ? perfilDowLoja(receitaDia, asOfD, abertos, fechados) : null;
  const pularDe = (pid) => { const f = contexto.fora && contexto.fora.get(pid); if (!f || !f.size) return fechados; const u = new Set(fechados); f.forEach((d) => u.add(d)); return u; };
  // 3) séries cruas → o que cada fator externo faz → séries ajustadas
  const cruas = new Map();
  for (const pid of ids) { const s = montarSerie(vendasDia.get(pid), asOfD, abertos, rupturas.get(pid), { pular: pularDe(pid) }); if (s.length) cruas.set(pid, s); }
  const modelo = EF.aprender({ series: cruas, produtos, ctx: contexto, fim: asOfD });
  const series = new Map();
  for (const [pid] of cruas) {
    const cat = (produtos.get(pid) || {}).cat;
    series.set(pid, montarSerie(vendasDia.get(pid), asOfD, abertos, rupturas.get(pid), { pular: pularDe(pid), dowPrior, fatorDe: (d) => EF.fator(modelo, pid, cat, d).f }));
  }
  return { series, modelo, fechados, dowPrior, receitaDia };
}

// ---------- falta de produto ---------------------------------------
// No dia em que o produto acabou, a venda (c) é só um PISO da procura real (D ≥ c).
// Sem corrigir, o motor aprende "vende pouco" justamente no que mais falta.
// Correção: troca a venda do dia pela procura ESPERADA sabendo que ela foi ≥ c,
//     E[D | D ≥ c] = μ + σ · φ(z) / (1 − Φ(z)),   z = (c − μ) / σ
// (média de uma normal truncada). μ = o que o próprio modelo esperava para o dia usando
// só os dias anteriores (já corrigidos); σ = variação das vendas do mesmo dia da semana.
// Feito em ordem de data, então cada correção melhora a referência das seguintes.
// O resultado nunca fica abaixo da venda registrada e tem teto de c + 2,5σ.
// `yObs` guarda a venda registrada.
function descensurar(serie) {
  if (!serie.some((o) => o.cens)) return serie;
  const fi = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  for (let i = 0; i < serie.length; i++) {
    if (!serie[i].cens) continue;
    const c = serie[i].y, r = nucleo(serie, serie[i].dia, i);
    if (!Number.isFinite(r.pred)) continue;
    const mu = r.pred;
    const sdDow = r.mesmos && r.mesmos.length >= 3 ? S.stdev(r.mesmos) : NaN;
    const sd = Math.max(Number.isFinite(sdDow) ? sdDow : 0, Math.sqrt(Math.max(mu, C.EPS_ESCALA)) * 0.5, 1e-6);
    const z = (c - mu) / sd, cauda = 1 - S.normCdf(z);
    const esperado = cauda > 1e-6 ? mu + sd * fi(z) / cauda : c;
    const novo = Math.min(Math.max(c, esperado), c + 2.5 * sd);
    if (novo > c) { serie[i].yObs = c; serie[i].y = novo; }
  }
  return serie;
}

// ---------- demanda intermitente (TSB) ------------------------------
// Devolve a venda esperada por dia aberto = chance de vender × tamanho da venda.
function tsb(ys) {
  const pos = ys.filter((y) => y > 0);
  if (!pos.length) return 0;
  const ini = ys.slice(0, Math.min(ys.length, 14)), iniPos = ini.filter((y) => y > 0);
  let p = (iniPos.length + 0.5) / (ini.length + 1), z = iniPos.length ? S.mean(iniPos) : pos[0];
  for (const y of ys) {
    if (y > 0) { z += C.TSB_ALFA * (y - z); p += C.TSB_BETA * (1 - p); }
    else p += C.TSB_BETA * (0 - p);
  }
  return p * z;
}
const adi = (ys) => { const n = ys.filter((y) => y > 0).length; return n ? ys.length / n : Infinity; };

// ---------- núcleo -------------------------------------------------
const JANELA_LOOKBACK = 90;   // dias olhados pelo núcleo (cobre N_OBS_DOW semanas mesmo com loja fechada 1 dia)
function inicioJanela(serie, end, diaMin) {   // 1º índice em [0,end) com dia > diaMin (série ordenada)
  let lo = 0, hi = end;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (serie[mid].dia > diaMin) hi = mid; else lo = mid + 1; }
  return lo;
}
function nucleo(serie, D, end = serie.length) {
  if (end < C.MIN_HIST_NUCLEO) return { pred: NaN, nDow: 0 };
  const dow = dowDeDia(D), fim = serie[end - 1].dia;
  const W = serie.slice(inicioJanela(serie, end, fim - JANELA_LOOKBACK), end);
  const mesmos = W.filter((o) => dowDeDia(o.dia) === dow).slice(-C.N_OBS_DOW);
  // Nível "de um dia médio": cada venda é pesada pelo perfil da loja do seu dia da semana.
  // Com semanas completas dá a média simples; com 3 ou 4 dias de história evita achar que
  // o produto vende muito só porque os únicos dias vistos foram sexta e sábado.
  const prior = C.DOW_LOJA_ATIVO && serie.dowPrior ? serie.dowPrior : null;
  const nivelDe = (lista) => (prior ? S.sum(lista.map((o) => o.y)) / Math.max(S.sum(lista.map((o) => prior[dowDeDia(o.dia)])), 1e-9) : S.mean(lista.map((o) => o.y)));
  const recO = W.filter((o) => o.dia > fim - C.JANELA_NIVEL);
  const nivel = recO.length ? nivelDe(recO) : nivelDe(W.slice(-7));

  // fator do dia da semana: média desse dia / média geral, no mesmo lookback
  const look = W.filter((o) => o.dia > fim - C.N_OBS_DOW * 7);
  const mAll = S.mean(look.map((o) => o.y)), dl = look.filter((o) => dowDeDia(o.dia) === dow);
  const fPrior = prior ? prior[dow] : 1;
  let fdow = fPrior;
  if (mAll > 0 && dl.length) {
    // razão do produto medida contra o nível "de um dia médio" do mesmo período
    const base = prior ? nivelDe(look) : mAll;
    fdow = (dl.length * (S.mean(dl.map((o) => o.y)) / Math.max(base, 1e-9)) + C.K_DOW_DEMANDA * fPrior) / (dl.length + C.K_DOW_DEMANDA);
  }
  const E2 = nivel * fdow;

  // Produto intermitente: média entre o núcleo e o TSB (combinar métodos erra menos
  // que escolher um só). Para produto que vende quase todo dia, nada muda.
  const ys = W.map((o) => o.y);
  const inter = C.TSB_ATIVO && C.PESO_TSB > 0 && ys.length >= 14 && adi(ys) > C.ADI_INTERMITENTE;
  const misturar = (base) => (inter ? (1 - C.PESO_TSB) * base + C.PESO_TSB * tsb(ys) * fdow : base);

  if (!mesmos.length) return { pred: misturar(E2), nDow: 0, E1: null, E2, mesmos: [], intermitente: inter };
  const E1 = S.mediaPonderada(mesmos.map((o) => o.y), S.pesosMeiaVida(mesmos.length, C.MEIA_VIDA_DEMANDA));
  const n1 = mesmos.length;
  return { pred: misturar((n1 * E1 + C.K_NUCLEO * E2) / (n1 + C.K_NUCLEO)), nDow: n1, E1, E2, mesmos: mesmos.map((o) => o.y), intermitente: inter };
}

// walk-forward: previsão de cada dia usando só dados anteriores (últimos 150 pontos bastam)
function walkForward(serie) {
  const out = [];
  for (let i = Math.max(C.MIN_HIST_NUCLEO, serie.length - 150); i < serie.length; i++) {
    if (serie[i].cens) continue;                 // dia com falta: a procura real é desconhecida, não mede erro
    const r = nucleo(serie, serie[i].dia, i);
    // erro medido em unidades REAIS: a previsão do dia comum × o fator externo daquele dia
    const f = serie[i].f || 1, pred = r.pred * f, y = serie[i].y * f;
    if (Number.isFinite(r.pred)) out.push({ dia: serie[i].dia, pred, y, res: y - pred });
  }
  return out;
}

function tendencia(serie) {
  const fim = serie.length ? serie[serie.length - 1].dia : 0, J = C.JANELA_NIVEL;
  const r = serie.filter((o) => o.dia > fim - J).map((o) => o.y), a = serie.filter((o) => o.dia > fim - 2 * J && o.dia <= fim - J).map((o) => o.y);
  if (r.length < 8 || a.length < 8) return { tipo: 'insuficiente', pct: null };
  const mr = S.mean(r), ma = S.mean(a);
  if (!(ma > 0)) return { tipo: mr > 0 ? 'novo' : 'estavel', pct: null };
  const se = Math.sqrt(S.stdev(r) ** 2 / r.length + S.stdev(a) ** 2 / a.length);
  const z = se > 0 ? (mr - ma) / se : 0, pct = mr / ma - 1;
  return { tipo: z > C.Z_TEND_DEMANDA ? 'crescente' : z < -C.Z_TEND_DEMANDA ? 'decrescente' : 'estavel', pct: S.arred(pct, 3), z: S.arred(z, 2) };
}

// ---------- intervalo ---------------------------------------------
function intervalo(pred0, residuos, k, nObs) {
  // residuos: array de {res}; k: nº de dias somados
  const res = residuos.map((r) => r.res);
  const somas = [];
  if (k === 1) res.forEach((x) => somas.push(x));
  else for (let i = 0; i + k <= res.length; i++) somas.push(S.sum(res.slice(i, i + k)));
  if (somas.length >= C.MIN_RESIDUOS) {
    return { tipo: 'empirico', lo: S.quantile(somas, C.Q_INF), hi: S.quantile(somas, C.Q_SUP), nRes: somas.length };
  }
  const z = S.normInv(C.Q_SUP);
  const sd = Math.sqrt(Math.max(pred0, C.EPS_ESCALA) * (1 + 1 / Math.max(nObs, 1)));
  return { tipo: 'poisson', lo: -z * sd, hi: z * sd, nRes: somas.length };
}

// ---------- horizontes --------------------------------------------
function horizontes(hoje, abertos) {
  const f = (a, b) => { const l = []; for (let d = a; d <= b; d++) if (abertos.has(dowDeDia(d))) l.push(d); return l; };
  const prox = (() => { for (let d = hoje + 1; d <= hoje + 8; d++) if (abertos.has(dowDeDia(d))) return d; return null; })();
  const seg = hoje - ((dowDeDia(hoje) + 6) % 7) + 7;
  return {
    hoje: f(hoje, hoje), amanha: f(hoje + 1, hoje + 1), proximoDia: prox ? [prox] : [],
    proximaSemana: f(seg, seg + 6), prox7: f(hoje, hoje + 6), prox30: f(hoje, hoje + 29),
  };
}

// ---------- bottom-up ---------------------------------------------
function modelosClientes(clientes, G, asOf, produtos) {
  return clientes.map((c) => P.modelarCliente(c, G, asOf, produtos)).filter((m) => m && m.nVisitas >= C.MIN_VISITAS_BU);
}
function bottomUpDia(modelos, G, D, asOf, abertos, produtos) {
  const por = new Map(), clientes = []; let pedidos = 0;
  for (const m of modelos) {
    const v = R.probabilidadeVisita(m, D, G, abertos, asOf, semanaDeDia, dowDeDia);
    if (!(v.p > 0.001)) continue;
    pedidos += v.p;
    const itens = [];
    for (const pid of Object.keys(m.prod)) {
      const mp = m.prod[pid]; if (!mp.q || !mp.q.med) continue;
      const pc = K.probCompra(m, pid, G, D).p, e = v.p * pc * mp.q.med;
      por.set(pid, (por.get(pid) || 0) + e);
      itens.push({ id: pid, p: pc, qtd: mp.q.med, e });
    }
    clientes.push({ id: m.id, nome: m.nome, condominio: m.condominio || '', formatoEndereco: m.formatoEndereco || 'ql', quadra: m.quadra, lote: m.lote, p: S.arred(v.p, 3), ultimoDia: m.ultimoDia, nuMed: m.nuMed, itens });
  }
  return { por, clientes, pedidos };
}

// ---------- pesos TD × BU por backtest ----------------------------
function pesosMetodos(ctx, walks) {
  const { clientes, produtos, hoje, abertos } = ctx;
  const out = { wBU: 0, nDias: 0, wapeTD: null, wapeBU: null, motivo: null };
  if (clientes.length < C.MIN_CLIENTES_BU) { out.motivo = 'poucos clientes recorrentes'; return out; }
  const dias = []; for (let d = hoje - C.BACKTEST_DIAS; d < hoje; d++) if (abertos.has(dowDeDia(d))) dias.push(d);
  let eTD = 0, eBU = 0, somaReal = 0, n = 0;
  for (const b of dias) {
    const Gb = P.construirGlobal(clientes, produtos, b - 1);
    const modelos = modelosClientes(clientes, Gb, b - 1, produtos);
    if (modelos.length < C.MIN_CLIENTES_BU) continue;
    const bu = bottomUpDia(modelos, Gb, b, b - 1, abertos, produtos).por;
    for (const [pid, w] of walks) {
      const pt = w.find((x) => x.dia === b); if (!pt) continue;   // walks guarda só os últimos 150 pontos
      eTD += Math.abs(pt.pred - pt.y); eBU += Math.abs((bu.get(pid) || 0) - pt.y); somaReal += pt.y;
    }
    n++;
  }
  out.nDias = n;
  if (n < C.MIN_BACKTEST || !(somaReal > 0)) { out.motivo = `só ${n} dia(s) de backtest`; return out; }
  out.wapeTD = S.arred(eTD / somaReal); out.wapeBU = S.arred(eBU / somaReal);
  const iTD = 1 / Math.max(eTD / somaReal, 1e-6), iBU = 1 / Math.max(eBU / somaReal, 1e-6);
  out.wBU = S.arred(iBU / (iBU + iTD), 3);
  return out;
}

// ---------- previsão de uma série (produto, categoria ou loja) -----
function preverSerie({ serie, hoje, hz, abertos, extras, bu, wBU, unidade, estoque, fracEstimada, nivelServico, wf: wfPre, fatorFuturo }) {
  const wf = wfPre || walkForward(serie);
  const wape = (() => { const u = wf.filter((x) => x.dia > hoje - 1 - C.AVALIACAO_JANELA_DIAS); const s = S.sum(u.map((x) => x.y)); return s > 0 ? S.sum(u.map((x) => Math.abs(x.res))) / s : null; })();
  const efeitos = SZ.aprenderEfeitosEvento(serie, extras);
  const tend = tendencia(serie);
  const cache = new Map();
  const dia = (D) => {
    if (cache.has(D)) return cache.get(D);
    const nu = nucleo(serie, D);
    const ev = SZ.fatorEvento(D, efeitos, extras), ms = SZ.fatorMes(serie, D);
    const fat = ev.fator * ms.fator;
    const fx = fatorFuturo ? fatorFuturo(D) : { f: 1, partes: [] };          // clima previsto, pagamento, preço de hoje
    if (Number.isFinite(nu.pred) && fx.f !== 1) nu.pred *= fx.f;             // daqui em diante o "núcleo" já é o do dia real
    const td = Number.isFinite(nu.pred) ? nu.pred * fat : NaN;
    const b = bu && D - hoje < C.HORIZONTE_BU_MAX && bu.dias[D] ? (bu.dias[D].get(bu.pid) || 0) : null;
    const final = Number.isFinite(td) ? (b != null && wBU > 0 ? (1 - wBU) * td + wBU * b : td) : NaN;
    const r = { D, nu, ev, ms, fat, fx, td, bu: b, final }; cache.set(D, r); return r;
  };
  const resultado = {};
  for (const [nome, dias] of Object.entries(hz)) {
    if (!dias.length) { resultado[nome] = { fechado: true }; continue; }
    const ds = dias.map(dia);
    if (ds.some((x) => !Number.isFinite(x.final))) { resultado[nome] = { semDados: true, nObs: serie.length }; continue; }
    const prev = S.sum(ds.map((x) => x.final)), pred0 = S.sum(ds.map((x) => x.nu.pred));
    const nObs = Math.min(...ds.map((x) => x.nu.nDow));
    const it = intervalo(pred0, wf, dias.length, Math.max(nObs, 1));
    // O intervalo só é escalado pelo fator SAZONAL (td/núcleo); a mistura com o bottom-up
    // apenas desloca o centro. (Escalar por previsto/núcleo explodia quando o núcleo ≈ 0.)
    const tdSoma = S.sum(ds.map((x) => x.td));
    const fatMed = pred0 > 1e-6 ? S.clamp(tdSoma / pred0, 0.2, 5) : 1;
    const q10 = Math.max(0, Math.min(prev, prev + it.lo * fatMed)), q90 = Math.max(prev, prev + it.hi * fatMed);
    const cv = (() => { const m = ds[0].nu.mesmos; return m && m.length >= 2 && S.mean(m) > 0 ? S.stdev(m) / S.mean(m) : (wf.length >= 6 ? S.stdev(wf.map((x) => x.y)) / Math.max(S.mean(wf.map((x) => x.y)), 1e-6) : NaN); })();
    const cf = F.confiancaDemanda({ nObs: dias.length === 1 ? nObs : Math.floor(serie.length / 7) * 1, cv, wape, fracEstimada });
    let conf = cf.conf * (it.tipo === 'poisson' ? 0.8 : 1);
    // "saber quando NÃO sabe": com < MIN_OBS_DEMANDA observações do dia, a confiança nunca passa de 'baixa'
    if (nObs < C.MIN_OBS_DEMANDA) conf = Math.min(conf, C.CONF_BAIXA * 0.9);
    const rec = INV.recomendar({ previsto: prev, q10, q90, conf, unidade, estoque, nivelServico });
    resultado[nome] = {
      dias: dias.length, previsto: S.arred(prev, 2), q10: S.arred(q10, 2), q90: S.arred(q90, 2), conf: S.arred(conf, 3),
      intervalo: it.tipo, nRes: it.nRes, nObs, componentes: Object.fromEntries(Object.entries(cf.componentes).map(([k, v]) => [k, S.arred(v, 2)])),
      td: S.arred(S.sum(ds.map((x) => x.td)), 2), bu: ds.every((x) => x.bu != null) ? S.arred(S.sum(ds.map((x) => x.bu)), 2) : null,
      fator: S.arred(fatMed, 3), recomendacao: rec,
      _exp: dias.length === 1 ? { mesmos: ds[0].nu.mesmos, E1: S.arred(ds[0].nu.E1, 2), E2: S.arred(ds[0].nu.E2, 2), ev: ds[0].ev, ms: ds[0].ms, fx: ds[0].fx.partes, intermitente: !!ds[0].nu.intermitente, faltas: serie.filter((o) => o.yObs != null && o.dia > hoje - 1 - C.JANELA_NIVEL).length } : null,
    };
  }
  return { horizontes: resultado, tendencia: tend, wape: S.arred(wape), nSerie: serie.length, residuos: wf.length };
}

function explicarDemanda(nome, h, tend, wBU, un, dowNome, clientesTop) {
  const m = [], e = h._exp;
  if (e && e.mesmos && e.mesmos.length) {
    m.push(`Últimas ${e.mesmos.length} ${dowNome}s: ${e.mesmos.map((x) => S.arred(x, 1)).join(', ')} ${un}`);
    m.push(`Média ponderada (recentes pesam mais): ${e.E1} ${un}`);
  } else if (e) m.push('Sem ocorrências suficientes deste dia da semana — usando o nível dos últimos 28 dias');
  if (tend.tipo === 'crescente') m.push(`Demanda crescendo (${Math.round(tend.pct * 100)}% vs. 4 semanas antes)`);
  if (tend.tipo === 'decrescente') m.push(`Demanda caindo (${Math.round(tend.pct * 100)}% vs. 4 semanas antes)`);
  if (e && e.ev && e.ev.evento) m.push(e.ev.confiavel ? `Próximo de ${e.ev.evento}: efeito de ×${S.arred(e.ev.fator, 2)} (observado ${e.ev.n}×)` : `Próximo de ${e.ev.evento}, mas ${e.ev.motivo || 'sem evidência'} — sem ajuste`);
  if (e && e.ms && e.ms.confiavel) m.push(`Efeito do mês: ×${S.arred(e.ms.fator, 2)}`);
  if (e && e.fx && e.fx.length) EF.explicar(e.fx).forEach((x) => m.push(x));
  if (h.bu != null && wBU > 0) m.push(`Combina histórico agregado (${Math.round((1 - wBU) * 100)}%) com clientes recorrentes esperados (${Math.round(wBU * 100)}%): ${h.bu} ${un}`);
  if (clientesTop && clientesTop.length) m.push(`Clientes que mais puxam: ${clientesTop.join(', ')}`);
  if (e && e.intermitente) m.push('Produto que passa dias sem vender: previsão suavizada (chance de vender × tamanho da venda)');
  if (e && e.faltas) m.push(`Faltou em ${e.faltas} dia(s) recente(s): a previsão considera a procura que não foi atendida`);
  if (h.intervalo === 'poisson') m.push('Histórico curto: incerteza estimada por modelo de contagem, não pelos seus erros passados');
  if (h.nObs < 3) m.push(`Apenas ${h.nObs} observação(ões) deste dia — previsão de baixa confiança`);
  return m;
}

module.exports = { montarSerie, perfilDowLoja, prepararSeries, descensurar, tsb, adi, nucleo, walkForward, tendencia, intervalo, horizontes, modelosClientes, bottomUpDia, pesosMetodos, preverSerie, explicarDemanda };

