'use strict';
// =====================================================================
//  analytics/engine.js — PIPELINE (módulo 24). Função PURA: recebe dados,
//  devolve resultados. Não fala com Firestore (isso é store.js), por isso
//  é testável e determinístico.
//
//   PEDIDOS → normalização → histórico por cliente → perfis/recorrência
//   → associações → sazonalidade → previsão individual → previsão geral
//   → incerteza → recomendação de estoque → ranking → dashboard
//
//  REGRA DE VAZAMENTO: a previsão de DEMANDA usa só dias COMPLETOS
//  (≤ hoje−1). O dia de hoje ainda está em andamento, então vendas parciais
//  nunca entram no modelo que prevê o próprio dia. Já o perfil do CLIENTE
//  (ranking da loja) usa até hoje: se ele acabou de comprar, o ranking sabe.
// =====================================================================
const C = require('./config');
const S = require('./stats');
const N = require('./normalize');
const P = require('./customerProfile');
const A = require('./productAssociation');
const D = require('./demandForecast');
const E = require('./evaluation');
const K = require('./ranking');
const { dowDeDia, diaDeTs, isoDeDia, diaDeIso } = N;

const PADROES = JSON.parse(JSON.stringify(C));
function aplicarParametros(over) {
  Object.keys(PADROES).forEach((k) => { C[k] = JSON.parse(JSON.stringify(PADROES[k])); });
  Object.entries(over || {}).forEach(([k, v]) => {
    if (k in PADROES && typeof v === typeof PADROES[k] && (typeof v !== 'number' || Number.isFinite(v))) C[k] = v;
  });
}

const r2 = (x) => S.arred(x, 2);

function executarMotor({ pedidos, catalogo, agregados = [], parametros, eventos = [], diasAbertos, snapshots = [], agora = Date.now() }) {
  aplicarParametros(parametros);
  const t0 = Date.now();
  const hoje = diaDeTs(agora), asOfD = hoje - 1;
  const abertos = new Set(Array.isArray(diasAbertos) && diasAbertos.length ? diasAbertos : C.DIAS_ABERTOS_PADRAO);
  const norm = N.normalizarPedidos(pedidos, catalogo);
  const { clientes, produtos } = norm;
  const iniPed = hoje - C.JANELA_DIAS + 1;           // 1º dia coberto integralmente pelos pedidos lidos

  // ---------- séries diárias: pedidos (janela) + agregados (histórico longo) ----------
  const vendasDia = new Map(), visitasDia = new Map();
  const put = (m, id, d, q) => { if (!m.has(id)) m.set(id, new Map()); m.get(id).set(d, (m.get(id).get(d) || 0) + q); };
  for (const [pid, mp] of norm.vendasDia) for (const [d, q] of mp) if (d >= iniPed) put(vendasDia, pid, d, q);
  for (const [d, n] of norm.pedidosDia) if (d >= iniPed) visitasDia.set(d, n);
  let diasDeAgregado = 0;
  for (const ag of agregados) {
    const d = diaDeIso(ag.dia); if (!(d < iniPed)) continue;
    diasDeAgregado++; visitasDia.set(d, Number(ag.visitas) || 0);
    for (const [pid, q] of Object.entries(ag.produtos || {})) if (Number(q) > 0) put(vendasDia, pid, d, Number(q));
  }

  // agregados a persistir (1 doc/dia, só dias com venda) — alimenta o histórico longo
  const porDia = new Map();
  for (const [pid, mp] of norm.vendasDia) for (const [d, q] of mp) {
    if (d < iniPed) continue; if (!porDia.has(d)) porDia.set(d, {}); porDia.get(d)[pid] = S.arred(q, 3);
  }
  const agregadosNovos = [...porDia.entries()].map(([d, pr]) => ({ dia: isoDeDia(d), produtos: pr, visitas: visitasDia.get(d) || 0 }));

  // ---------- perfis (ranking) até HOJE ----------
  const G = P.construirGlobal(clientes, produtos, hoje);
  G.assoc = A.calcularAssociacoes(clientes.flatMap((c) => c.visitas.filter((v) => v.dia <= hoje).map((v) => [...v.itens.keys()]))).assoc;
  const modelos = clientes.map((c) => P.modelarCliente(c, G, hoje, produtos)).filter(Boolean);

  // ---------- previsão de demanda (dias completos) ----------
  const Gd = P.construirGlobal(clientes, produtos, asOfD);
  const modelosD = D.modelosClientes(clientes, Gd, asOfD, produtos);
  const hz = D.horizontes(hoje, abertos);

  // fração de quantidades estimadas (itens "a pesar" ainda sem peso) — qualidade dos dados
  const est = new Map();
  for (const c of clientes) for (const v of c.visitas) if (v.dia > hoje - 28) for (const [pid, it] of v.itens) {
    const e = est.get(pid) || { n: 0, e: 0 }; e.n++; if (it.estimada) e.e++; est.set(pid, e);
  }

  const ativos = [...produtos.values()].filter((p) => p.ativo || (vendasDia.has(p.id) && [...vendasDia.get(p.id).keys()].some((d) => d > hoje - 28)));
  const series = new Map(), walks = new Map();
  for (const p of ativos) {
    const s = D.montarSerie(vendasDia.get(p.id), asOfD, abertos);
    if (!s.length) continue;
    series.set(p.id, s); walks.set(p.id, D.walkForward(s));
  }
  const pesos = D.pesosMetodos({ clientes, produtos, hoje, abertos }, walks);

  const buDias = {};
  for (const d of new Set([].concat(...Object.values(hz)))) {
    if (d - hoje < C.HORIZONTE_BU_MAX && modelosD.length >= C.MIN_CLIENTES_BU) buDias[d] = D.bottomUpDia(modelosD, Gd, d, asOfD, abertos, produtos);
  }
  const wBU = pesos.wBU || 0;

  const dowNome = (d) => K.NOMES_DOW[dowDeDia(d)];
  const prev = {};
  for (const p of ativos) {
    const serie = series.get(p.id); if (!serie) continue;
    const eg = est.get(p.id);
    const r = D.preverSerie({
      serie, hoje, hz, abertos, extras: eventos, wf: walks.get(p.id), wBU,
      bu: { dias: Object.fromEntries(Object.entries(buDias).map(([d, v]) => [d, v.por])), pid: p.id },
      unidade: p.unidade, estoque: p.estoque, fracEstimada: eg ? eg.e / eg.n : 0,
    });
    // explicação (só dos horizontes de 1 dia)
    for (const nome of ['hoje', 'amanha', 'proximoDia']) {
      const h = r.horizontes[nome]; if (!h || !h._exp) continue;
      const d = hz[nome][0];
      const top = buDias[d] ? buDias[d].clientes.map((c) => ({ c, e: (c.itens.find((i) => i.id === p.id) || {}).e || 0 })).filter((x) => x.e > 0.01).sort((a, b) => b.e - a.e).slice(0, 3).map((x) => `${(x.c.nome || 'Cliente').split(' ')[0]} (Q${x.c.quadra}·L${x.c.lote})`) : [];
      h.explicacao = D.explicarDemanda(p.nome, h, r.tendencia, wBU, p.unidade, dowNome(d), top);
      delete h._exp;
    }
    Object.values(r.horizontes).forEach((h) => { if (h) delete h._exp; });
    prev[p.id] = { id: p.id, nome: p.nome, cat: p.cat, unidade: p.unidade, foto: p.foto, preco: p.preco, estoque: p.estoque, ativo: p.ativo, tendencia: r.tendencia, wape: r.wape, ...{ horizontes: r.horizontes } };
  }

  // ---------- níveis agregados: categoria (4) e loja (5), em R$ ----------
  const serieReceita = (ids) => {
    const m = new Map();
    for (const pid of ids) { const pr = produtos.get(pid), mp = vendasDia.get(pid); if (!mp || !pr) continue; for (const [d, q] of mp) if (d <= asOfD) m.set(d, (m.get(d) || 0) + q * pr.preco); }
    return m;
  };
  const prevAgg = (mapa, un) => {
    const s = D.montarSerie(mapa, asOfD, abertos); if (s.length < C.MIN_HIST_NUCLEO) return null;
    const r = D.preverSerie({ serie: s, hoje, hz: { hoje: hz.hoje, amanha: hz.amanha, prox7: hz.prox7 }, abertos, extras: eventos, unidade: un, fracEstimada: 0 });
    return { horizontes: Object.fromEntries(Object.entries(r.horizontes).map(([k, v]) => [k, v && v.previsto != null ? { previsto: v.previsto, q10: v.q10, q90: v.q90, conf: v.conf } : v])), tendencia: r.tendencia };
  };
  const catIds = {}; produtos.forEach((p) => { (catIds[p.cat] = catIds[p.cat] || []).push(p.id); });
  const categorias = {}; Object.entries(catIds).forEach(([c, ids]) => { const x = prevAgg(serieReceita(ids), 'R$'); if (x) categorias[c] = x; });
  const loja = { receita: prevAgg(serieReceita([...produtos.keys()]), 'R$'), visitas: prevAgg(new Map([...visitasDia].filter(([d]) => d <= asOfD)), 'un') };

  // ---------- clientes esperados (módulo 10) ----------
  const jaHoje = new Set(clientes.filter((c) => c.visitas.some((v) => v.dia === hoje)).map((c) => c.id));
  const esperados = {};
  for (const nome of ['hoje', 'amanha']) {
    const d = hz[nome][0]; const b = d != null ? buDias[d] : null;
    if (!b) { esperados[nome] = d == null ? { fechado: true } : { indisponivel: true }; continue; }
    esperados[nome] = {
      dia: isoDeDia(d), pedidosEsperados: r2(b.pedidos),
      clientes: b.clientes.sort((x, y) => y.p - x.p).slice(0, 25).map((c) => ({
        id: c.id, nome: c.nome, quadra: c.quadra, lote: c.lote, p: c.p, diasDesdeUltima: asOfD - c.ultimoDia, intervaloMedio: c.nuMed, jaComprouHoje: nome === 'hoje' && jaHoje.has(c.id),
        itens: c.itens.sort((x, y) => y.e - x.e).slice(0, 5).map((i) => ({ id: i.id, nome: (produtos.get(i.id) || {}).nome || i.id, p: S.arred(i.p, 2), qtd: i.qtd })),
      })),
    };
  }

  // ---------- avaliação: previsto × realizado ----------
  const avaliacoes = [];
  for (const sn of snapshots) {
    if (!(sn.diaAlvo < hoje)) continue;
    const real = new Map(); for (const [pid, mp] of vendasDia) if (mp.has(sn.diaAlvo)) real.set(pid, mp.get(sn.diaAlvo));
    avaliacoes.push({ id: sn.id, horizonte: sn.horizonte, ...E.avaliarSnapshot(sn, real), diaAlvoIso: isoDeDia(sn.diaAlvo) });
  }
  const novosSnapshots = [];
  for (const nome of ['hoje', 'amanha']) {
    if (!hz[nome].length) continue;
    const itens = {}; for (const [pid, p] of Object.entries(prev)) { const h = p.horizontes[nome]; if (h && h.previsto != null) itens[pid] = { previsto: h.previsto, q10: h.q10, q90: h.q90 }; }
    novosSnapshots.push({ id: `${isoDeDia(hz[nome][0])}_${nome}`, horizonte: nome, diaAlvo: hz[nome][0], diaAlvoIso: isoDeDia(hz[nome][0]), itens });
  }

  // ---------- dashboard (módulo 19) ----------
  const lista = Object.values(prev);
  const comH = (nome) => lista.filter((p) => p.horizontes[nome] && p.horizontes[nome].previsto != null);
  const base = hz.hoje.length ? 'hoje' : 'proximoDia';
  const resumoDia = (nome) => {
    const L = comH(nome); if (!L.length) return null;
    return { produtos: L.length, faturamentoPrevisto: r2(S.sum(L.map((p) => p.horizontes[nome].previsto * (p.preco || 0)))), pedidosEsperados: (esperados[nome] || {}).pedidosEsperados ?? null };
  };
  const comEstoque = comH('prox7').filter((p) => p.estoque != null && p.horizontes.prox7.recomendacao && p.horizontes.prox7.recomendacao.estoque);
  const tend = lista.filter((p) => p.tendencia && (p.tendencia.tipo === 'crescente' || p.tendencia.tipo === 'decrescente'));
  const compacto = (p, extra) => ({ id: p.id, nome: p.nome, foto: p.foto, unidade: p.unidade, ...extra });
  const confs = comH(base).map((p) => p.horizontes[base].conf);
  const dashboard = {
    geradoEm: new Date(agora).toISOString(), hoje: isoDeDia(hoje), base,
    resumo: { hoje: resumoDia('hoje'), amanha: resumoDia('amanha') },
    riscoFalta: comEstoque.map((p) => compacto(p, { estoque: p.estoque, previsto: p.horizontes.prox7.previsto, risco: p.horizontes.prox7.recomendacao.estoque.riscoFalta, comprar: p.horizontes.prox7.recomendacao.estoque.comprarAdicional }))
      .filter((x) => x.risco >= 0.5).sort((a, b) => b.risco - a.risco).slice(0, 8),
    excesso: comEstoque.map((p) => compacto(p, { estoque: p.estoque, q90: p.horizontes.prox7.q90, excesso: p.horizontes.prox7.recomendacao.estoque.excessoSobreQ90 }))
      .filter((x) => x.excesso > 0).sort((a, b) => b.excesso / Math.max(b.q90, 1) - a.excesso / Math.max(a.q90, 1)).slice(0, 8),
    crescendo: tend.filter((p) => p.tendencia.tipo === 'crescente').sort((a, b) => b.tendencia.pct - a.tendencia.pct).slice(0, 8).map((p) => compacto(p, { pct: p.tendencia.pct })),
    caindo: tend.filter((p) => p.tendencia.tipo === 'decrescente').sort((a, b) => a.tendencia.pct - b.tendencia.pct).slice(0, 8).map((p) => compacto(p, { pct: p.tendencia.pct })),
    confiancaMedia: confs.length ? S.arred(S.mean(confs), 3) : null, nProdutosPrevistos: lista.length,
    estoqueSemControle: lista.filter((p) => p.estoque == null).length,
  };

  // dados compactos para a API pública / painel (sem nada sensível)
  const catalogoCompacto = {}; produtos.forEach((p) => { catalogoCompacto[p.id] = { nome: p.nome, un: p.unidade, cat: p.cat, ativo: p.ativo }; });
  const indiceClientes = modelos.map((m) => ({ id: m.id, nome: m.nome, quadra: m.quadra, lote: m.lote, n: m.nVisitas, nivel: m.nivel, ult: isoDeDia(m.ultimoDia) }))
    .sort((a, b) => b.n - a.n).slice(0, 600);

  const meta = {
    versao: C.VERSAO, nivelServico: C.NIVEL_SERVICO, geradoEm: new Date(agora).toISOString(), hoje: isoDeDia(hoje), duracaoMs: Date.now() - t0,
    nPedidos: norm.nPedidos, nClientes: clientes.length, nClientesModelados: modelos.length, nClientesBottomUp: modelosD.length,
    diasHistorico: norm.ultimoDia >= norm.primeiroDia ? norm.ultimoDia - norm.primeiroDia + 1 : 0, diasDeAgregado,
    pesos, hz: Object.fromEntries(Object.entries(hz).map(([k, v]) => [k, v.map(isoDeDia)])),
    avisos: [
      ...(norm.nPedidos < 30 ? ['Poucos pedidos no histórico: todas as previsões têm confiança baixa.'] : []),
      ...(wBU === 0 ? [`Previsão baseada só no histórico agregado (${pesos.motivo || 'bottom-up sem vantagem comprovada'}).`] : []),
    ],
  };
  return { meta, global: G, catalogo: catalogoCompacto, indiceClientes, clientes: modelos, previsoes: prev, categorias, loja, esperados, dashboard, avaliacoes, novosSnapshots, agregadosNovos };
}

module.exports = { executarMotor, aplicarParametros };

