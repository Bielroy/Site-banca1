'use strict';
// =====================================================================
//  scripts/medir-motor.js — quanto o motor de previsão erra, numa loja simulada.
//
//  Uso:  node scripts/medir-motor.js [sementes, ex.: 1,2,3]
//
//  Prevê 1 dia à frente, dia após dia, só com o que se sabia na véspera, e compara
//  duas regulagens do MESMO motor: a "simples" (como era antes: sem clima, sem preço,
//  sem dias de pagamento, sem o perfil de dia da semana da loja) e a atual.
//  O erro é medido contra a procura VERDADEIRA do mundo simulado (não contra a venda
//  do dia, que tem sorte e azar). É uma régua de laboratório: o número da loja de
//  verdade aparece na aba Previsão, em "Erro das previsões anteriores".
// =====================================================================
const path = require('path');
const raiz = (p) => path.join(__dirname, '..', p);
const { gerar } = require(raiz('testes/mundo-simulado'));
const D = require(raiz('analytics/demandForecast')), EF = require(raiz('analytics/externalFactors'));
const { aplicarParametros } = require(raiz('analytics/engine'));

const SIMPLES = { FATORES_ATIVOS: false, DOW_LOJA_ATIVO: false, K_DOW_DEMANDA: 1, K_NUCLEO: 1, MIN_HIST_NUCLEO: 4, FECHADO_MIN_VISITAS: 1e9 };
const FAIXAS = [[2, 7], [8, 14], [15, 28], [29, 56], [57, 400]];
const abertos = new Set([0, 1, 2, 3, 4, 5, 6]);

/** Roda um mundo e devolve, por faixa de dias, o erro de cada regulagem. `erroDoTempo` = fração dos dias em que a previsão do tempo erra. */
function medir(mundo, { erroDoTempo = 0.12, regulagens = { simples: SIMPLES, atual: {} } } = {}) {
  const { produtos, vendas, precos, clima, ruptura, esperado, fechados, dia0, dias } = mundo;
  const prodMap = new Map(produtos.map((p) => [p.id, p]));
  const out = Object.fromEntries(Object.keys(regulagens).map((k) => [k, FAIXAS.map(() => ({ erro: 0, mu: 0, n: 0, sem: 0, tot: 0 }))]));
  let s = 12345; const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let t = 2; t < dias; t++) {
    const dia = dia0 + t; if (fechados.has(dia)) continue;
    const fx = FAIXAS.findIndex(([a, b]) => t >= a && t <= b); if (fx < 0) continue;
    const vd = new Map([...vendas].map(([id, m]) => [id, new Map([...m].filter(([d]) => d < dia))]));
    const rup = new Map([...ruptura].map(([id, x]) => [id, new Set([...x].filter((d) => d < dia))]));
    const cl = new Map([...clima].filter(([d]) => d < dia)), real = clima.get(dia);
    cl.set(dia, rr() < erroDoTempo ? { chuva: real.chuva >= 5 ? 0 : 12, tmax: real.tmax + (rr() - 0.5) * 4 } : real);
    const ctx = { estadosClima: EF.estadosDoClima(cl), precos: new Map([...precos].map(([id, m]) => [id, new Map([...m].filter(([d]) => d <= dia))])) };
    const atividade = new Map(); for (const [, m] of vd) for (const [d] of m) atividade.set(d, (atividade.get(d) || 0) + 1);
    const ids = produtos.map((p) => p.id).filter((id) => vd.get(id).size);
    for (const [nome, params] of Object.entries(regulagens)) {
      aplicarParametros(params);
      const prep = D.prepararSeries({ vendasDia: vd, produtos: prodMap, ids, asOfD: dia - 1, abertos, rupturas: rup, atividade, contexto: ctx });
      for (const p of produtos) {
        const mu = esperado.get(p.id).get(dia); if (mu == null || ruptura.get(p.id).has(dia)) continue;
        const serie = prep.series.get(p.id), a = out[nome][fx]; a.tot++;
        const h = serie ? D.preverSerie({ serie, hoje: dia, hz: { hoje: [dia] }, abertos, extras: [], unidade: p.unidade, fracEstimada: 0, fatorFuturo: (d) => EF.fator(prep.modelo, p.id, p.cat, d) }).horizontes.hoje : {};
        if (h.previsto == null) { a.sem++; continue; }
        a.erro += Math.abs(h.previsto - mu); a.mu += mu; a.n++;
      }
    }
  }
  aplicarParametros({});
  return out;
}
const somar = (lista) => lista.reduce((acc, r) => { for (const [k, fs] of Object.entries(r)) { acc[k] = acc[k] || fs.map(() => ({ erro: 0, mu: 0, n: 0, sem: 0, tot: 0 })); fs.forEach((f, i) => Object.keys(f).forEach((c) => { acc[k][i][c] += f[c]; })); } return acc; }, {});

if (require.main === module) {
  const sementes = (process.argv[2] || '1,2,3').split(',').map(Number);
  const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '–').padStart(7);
  for (const [titulo, efeitos] of [['Loja simulada COM chuva, calor, pagamento, oferta, falta e dia fechado', true], ['Loja simulada SEM nada disso (o motor não pode piorar aqui)', false]]) {
    const r = somar(sementes.map((sd) => medir(gerar({ seed: sd + (efeitos ? 0 : 100), efeitos }))));
    console.log('\n' + titulo + '\n  dias de loja   erro simples   erro atual   diferença   sem previsão (simples → atual)');
    FAIXAS.forEach(([a, b], i) => {
      const x = r.simples[i], y = r.atual[i]; if (!x.n || !y.n) return;
      const ex = x.erro / x.mu, ey = y.erro / y.mu;
      console.log(`  ${String(a).padStart(3)} a ${String(Math.min(b, 150)).padEnd(4)}     ${pct(ex)}       ${pct(ey)}    ${pct(ey / ex - 1)}      ${pct(x.sem / x.tot)} → ${pct(y.sem / y.tot)}`);
    });
  }
}
module.exports = { medir, somar, SIMPLES, FAIXAS };
