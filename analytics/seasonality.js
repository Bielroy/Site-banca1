'use strict';
// =====================================================================
//  analytics/seasonality.js — feriados, datas especiais e fatores sazonais.
//
//  PRINCÍPIO: correlação ≠ causalidade e 1 ocorrência ≠ padrão.
//  Um efeito de feriado/mês só entra no modelo quando o evento foi
//  observado em ≥ MIN_OCORRENCIAS vezes (ex.: 2 Natais = 2 anos de dados).
//  Antes disso o fator é 1 e o painel informa "dados insuficientes".
//  A estrutura já está pronta: assim que o histórico crescer, passa a valer.
// =====================================================================
const C = require('./config');
const { diaDeIso, dowDeDia } = require('./normalize');
const { mean, clamp } = require('./stats');

const pad = (n) => String(n).padStart(2, '0');

// Páscoa — algoritmo de Meeus/Jones/Butcher
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return diaDeIso(`${ano}-${pad(mes)}-${pad(dia)}`);
}
// n-ésimo dia-da-semana (dow) de um mês (1-based)
const enesimoDow = (ano, mes, dow, n) => {
  const d1 = diaDeIso(`${ano}-${pad(mes)}-01`);
  const off = (dow - dowDeDia(d1) + 7) % 7;
  return d1 + off + 7 * (n - 1);
};

function eventosDoAno(ano, extras = []) {
  const P = pascoa(ano);
  const fixo = (m, d) => diaDeIso(`${ano}-${pad(m)}-${pad(d)}`);
  const ev = [
    { dia: fixo(1, 1), nome: 'Ano Novo', tipo: 'feriado' },
    { dia: P - 48, nome: 'Carnaval', tipo: 'feriado' },
    { dia: P - 47, nome: 'Carnaval', tipo: 'feriado' },
    { dia: P - 2, nome: 'Sexta-feira Santa', tipo: 'feriado' },
    { dia: P, nome: 'Páscoa', tipo: 'data_especial' },
    { dia: fixo(4, 21), nome: 'Tiradentes', tipo: 'feriado' },
    { dia: fixo(5, 1), nome: 'Dia do Trabalho', tipo: 'feriado' },
    { dia: enesimoDow(ano, 5, 0, 2), nome: 'Dia das Mães', tipo: 'data_especial' },
    { dia: fixo(6, 12), nome: 'Dia dos Namorados', tipo: 'data_especial' },
    { dia: P + 60, nome: 'Corpus Christi', tipo: 'feriado' },
    { dia: enesimoDow(ano, 8, 0, 2), nome: 'Dia dos Pais', tipo: 'data_especial' },
    { dia: fixo(9, 7), nome: 'Independência', tipo: 'feriado' },
    { dia: fixo(10, 12), nome: 'N. Sra. Aparecida', tipo: 'feriado' },
    { dia: fixo(11, 2), nome: 'Finados', tipo: 'feriado' },
    { dia: fixo(11, 15), nome: 'Proclamação da República', tipo: 'feriado' },
    { dia: fixo(11, 20), nome: 'Consciência Negra', tipo: 'feriado' },
    { dia: enesimoDow(ano, 11, 5, 4), nome: 'Black Friday', tipo: 'data_especial' },
    { dia: fixo(12, 24), nome: 'Véspera de Natal', tipo: 'data_especial' },
    { dia: fixo(12, 25), nome: 'Natal', tipo: 'feriado' },
    { dia: fixo(12, 31), nome: 'Véspera de Ano Novo', tipo: 'data_especial' },
  ];
  // eventos cadastrados pelo dono: [{data:'2026-10-10', nome:'Festa do condomínio'}]
  (extras || []).forEach((e) => {
    if (e && e.data && /^\d{4}-\d{2}-\d{2}$/.test(e.data) && Number(e.data.slice(0, 4)) === ano) {
      ev.push({ dia: diaDeIso(e.data), nome: String(e.nome || 'Evento').slice(0, 40), tipo: 'cadastrado' });
    }
  });
  return ev;
}

function eventosEntre(d0, d1, extras = []) {
  const y0 = new Date(d0 * 86400000).getUTCFullYear(), y1 = new Date(d1 * 86400000).getUTCFullYear();
  const out = [];
  for (let y = y0; y <= y1; y++) eventosDoAno(y, extras).forEach((e) => { if (e.dia >= d0 && e.dia <= d1) out.push(e); });
  return out.sort((a, b) => a.dia - b.dia);
}

function eventoProximo(dia, extras = [], janela = C.JANELA_EVENTO) {
  let melhor = null;
  for (const e of eventosEntre(dia - janela, dia + janela, extras)) {
    const delta = dia - e.dia;
    if (!melhor || Math.abs(delta) < Math.abs(melhor.delta)) melhor = { nome: e.nome, tipo: e.tipo, delta };
  }
  return melhor;
}

/**
 * Aprende, para UMA série diária [{dia,y}], o efeito de cada evento:
 *   razão = média nos dias da janela do evento / média de dias-base
 *           (qualquer dia ±28 dias do evento e fora de qualquer janela de evento)
 * O efeito de um evento só é "confiável" com ≥ MIN_OCORRENCIAS_EVENTO
 * ocorrências; o log-efeito é encolhido por n/(n+K_SAZ).
 */
function aprenderEfeitosEvento(serie, extras = []) {
  if (!serie.length) return {};
  const d0 = serie[0].dia, d1 = serie[serie.length - 1].dia;
  const evs = eventosEntre(d0 - C.JANELA_EVENTO, d1 + C.JANELA_EVENTO, extras);
  const emJanela = new Set();
  evs.forEach((e) => { for (let k = -C.JANELA_EVENTO; k <= C.JANELA_EVENTO; k++) emJanela.add(e.dia + k); });
  const porDia = new Map(serie.map((o) => [o.dia, o.y]));
  const acc = {};
  for (const e of evs) {
    const janela = []; for (let k = -C.JANELA_EVENTO; k <= C.JANELA_EVENTO; k++) if (porDia.has(e.dia + k)) janela.push(porDia.get(e.dia + k));
    if (janela.length < 2) continue;
    const base = serie.filter((o) => Math.abs(o.dia - e.dia) <= 28 && !emJanela.has(o.dia)).map((o) => o.y);
    if (base.length < 3) continue;
    const b = mean(base); if (!(b > 0)) continue;
    const r = Math.max(mean(janela) / b, 0.1);
    (acc[e.nome] = acc[e.nome] || []).push(Math.log(r));
  }
  const out = {};
  for (const [nome, logs] of Object.entries(acc)) {
    const n = logs.length;
    out[nome] = { n, confiavel: n >= C.MIN_OCORRENCIAS_EVENTO, fator: Math.exp(mean(logs) * (n / (n + C.K_SAZ))) };
  }
  return out;
}

// Fator multiplicativo p/ um dia-alvo. Retorna 1 enquanto não houver evidência.
function fatorEvento(dia, efeitos, extras = []) {
  const ev = eventoProximo(dia, extras);
  if (!ev) return { fator: 1, evento: null, confiavel: false };
  const ef = efeitos[ev.nome];
  if (!ef) return { fator: 1, evento: ev.nome, confiavel: false, motivo: 'sem histórico do evento' };
  if (!ef.confiavel) return { fator: 1, evento: ev.nome, confiavel: false, motivo: `só ${ef.n} ocorrência(s) observada(s)` };
  return { fator: clamp(ef.fator, 0.2, 5), evento: ev.nome, confiavel: true, n: ef.n };
}

// Efeito do MÊS do ano — só com ≥ 2 anos distintos observados nesse mês.
function fatorMes(serie, dia) {
  const mesAlvo = new Date(dia * 86400000).getUTCMonth();
  const porAno = new Map();
  for (const o of serie) {
    const dt = new Date(o.dia * 86400000);
    if (dt.getUTCMonth() === mesAlvo) { const y = dt.getUTCFullYear(); if (!porAno.has(y)) porAno.set(y, []); porAno.get(y).push(o.y); }
  }
  if (porAno.size < C.MIN_OCORRENCIAS_MES) return { fator: 1, confiavel: false, motivo: `${porAno.size} ano(s) com este mês` };
  const todos = serie.map((o) => o.y); const base = mean(todos);
  const mMes = mean([].concat(...porAno.values()));
  if (!(base > 0)) return { fator: 1, confiavel: false };
  const n = porAno.size;
  return { fator: Math.exp(Math.log(Math.max(mMes / base, 0.1)) * (n / (n + C.K_SAZ))), confiavel: true, n };
}

module.exports = { pascoa, eventosDoAno, eventosEntre, eventoProximo, aprenderEfeitosEvento, fatorEvento, fatorMes };

