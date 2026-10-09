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
  // DETALHES (para quem for corrigir): o que pula, o que pesa, o que não foi compactado
  const itens = (k) => ((a[k] || {}).details || {}).items || [];
  const curto = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 90);
  const det = [];
  const lcp = itens('largest-contentful-paint-element')[0];
  if (lcp) { const n = (lcp.items || [lcp])[0]; det.push(`Maior elemento: ${((n.node || n).selector || (n.node || n).snippet || '').slice(0, 120)}`); }
  const pulos = itens('layout-shifts').slice(0, 5).map((x) => `${(x.score || 0).toFixed(3)} ${((x.node || {}).selector || (x.node || {}).snippet || '?').slice(0, 90)}`);
  if (pulos.length) det.push('O que pula: ' + pulos.join(' | '));
  const sem = itens('unminified-javascript').concat(itens('unminified-css')).slice(0, 5).map((x) => `${curto(x.url)} (${kb(x.wastedBytes)})`);
  if (sem.length) det.push('Sem compactar: ' + sem.join(' | '));
  const boot = itens('bootup-time').slice(0, 5).map((x) => `${curto(x.url)} ${Math.round(x.scripting || x.total || 0)} ms`);
  if (boot.length) det.push('Código que mais trabalha: ' + boot.join(' | '));
  const tarefas = itens('mainthread-work-breakdown').slice(0, 5).map((x) => `${x.groupLabel || x.group} ${Math.round(x.duration)} ms`);
  if (tarefas.length) det.push('Tempo do celular: ' + tarefas.join(' | '));
  const naoUsado = itens('unused-javascript').slice(0, 4).map((x) => `${curto(x.url)} (${kb(x.wastedBytes)} sem uso)`);
  if (naoUsado.length) det.push('Código baixado e não usado: ' + naoUsado.join(' | '));
  const fotos = itens('uses-responsive-images').slice(0, 4).map((x) => `${curto(x.url)} (${kb(x.wastedBytes)} a mais)`);
  if (fotos.length) det.push('Fotos maiores que o necessário: ' + fotos.join(' | '));
  const letras = itens('network-requests').filter((x) => x.resourceType === 'Font').map((x) => `${curto(x.url).slice(-40)} ${kb(x.transferSize)}`);
  if (letras.length) det.push('Letras: ' + letras.join(' | '));
  const bloqueia = itens('render-blocking-resources').map((x) => `${curto(x.url)} (${seg(x.wastedMs)})`);
  if (bloqueia.length) det.push('Atrasa a primeira tela: ' + bloqueia.join(' | '));
  if (det.length) console.log(`::notice title=Detalhes ${nota}/100 ${(r.finalDisplayedUrl || '').replace(/^https?:\/\/[^/]+/, '') || '/'}::${det.join('\n').replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
  linhas.push(texto.join('\n'), ...det, '');
  const msg = texto.join('\n').replace(/%/g, '%25').replace(/\n/g, '%0A');
  console.log(`::${nota < 50 ? 'warning' : 'notice'} title=Velocidade no celular: ${nota}/100::${msg}`);
}
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Velocidade no celular (Lighthouse)\n\n```\n' + linhas.join('\n') + '\n```\n');
