'use strict';
// =====================================================================
//  testes/velocidade/resumo.js — lê os relatórios do Lighthouse (celular simulado,
//  internet 4G lenta) e escreve o resumo como "anotações" do GitHub, em português.
//  Uso: node testes/velocidade/resumo.js relatorio1.json relatorio2.json ...
//  Não reprova a publicação: é medição. Nota abaixo de 50 vira aviso amarelo.
// =====================================================================
const fs = require('fs');
const kb = (b) => `${Math.round((b || 0) / 1024)} KB`;
const seg = (ms) => `${((ms || 0) / 1000).toFixed(1)} s`;
const linhas = [];
for (const arq of process.argv.slice(2)) {
  let r; try { r = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { console.log(`::warning title=Velocidade::Não consegui ler ${arq}`); continue; }
  const a = r.audits || {}, nota = Math.round(((r.categories && r.categories.performance && r.categories.performance.score) || 0) * 100);
  const acess = Math.round(((r.categories && r.categories.accessibility && r.categories.accessibility.score) || 0) * 100);
  const praticas = Math.round(((r.categories && r.categories['best-practices'] && r.categories['best-practices'].score) || 0) * 100);
  const v = (k) => (a[k] && a[k].numericValue) || 0;
  const porTipo = {}; for (const it of ((a['resource-summary'] || {}).details || {}).items || []) porTipo[it.resourceType] = it;
  const oport = Object.values(a).filter((x) => x && x.details && x.details.type === 'opportunity' && (x.details.overallSavingsMs || 0) > 150)
    .sort((x, y) => y.details.overallSavingsMs - x.details.overallSavingsMs).slice(0, 4).map((x) => `${x.title} (-${seg(x.details.overallSavingsMs)})`);
  const texto = [
    `Página: ${r.finalDisplayedUrl || r.requestedUrl}`,
    `Nota de velocidade: ${nota}/100 · Acessibilidade: ${acess}/100 · Boas práticas: ${praticas}/100`,
    `Primeira coisa na tela: ${seg(v('first-contentful-paint'))} · Maior parte na tela: ${seg(v('largest-contentful-paint'))} · Travado esperando código: ${Math.round(v('total-blocking-time'))} ms · Pulo de layout: ${(v('cumulative-layout-shift')).toFixed(3)}`,
    `Baixou: ${kb((porTipo.total || {}).transferSize)} no total (código ${kb((porTipo.script || {}).transferSize)}, imagens ${kb((porTipo.image || {}).transferSize)}, letras ${kb((porTipo.font || {}).transferSize)})`,
    oport.length ? `O que mais ajudaria: ${oport.join('; ')}` : 'Nada grande a ganhar apontado.',
  ];
  linhas.push(texto.join('\n'), '');
  const msg = texto.join('\n').replace(/%/g, '%25').replace(/\n/g, '%0A');
  console.log(`::${nota < 50 ? 'warning' : 'notice'} title=Velocidade no celular: ${nota}/100::${msg}`);
}
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Velocidade no celular (Lighthouse)\n\n```\n' + linhas.join('\n') + '\n```\n');
