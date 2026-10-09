'use strict';
// =====================================================================
//  testes/velocidade/pulos.js — abre o SITE NO AR num celular simulado (internet 4G
//  lenta, processador 4× mais lento) e anota O QUE PULA na tela, O QUE TRAVA e qual é
//  o maior elemento, com o momento de cada coisa. Complementa o Lighthouse com o "porquê".
//  Uso (no GitHub, ver .github/workflows/velocidade.yml):
//     node testes/velocidade/pulos.js https://site-banca1.vercel.app/ https://.../?loja=x
//  Só lê o site, como um visitante. Não reprova nada.
// =====================================================================
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(path.join(__dirname, '..', 'tela', 'node_modules', 'playwright'))); }

const anotar = (titulo, linhas) => console.log(`::notice title=${titulo}::${linhas.join('\n').replace(/%/g, '%25').replace(/\n/g, '%0A')}`);

(async () => {
  const b = await chromium.launch();
  for (const url of process.argv.slice(2)) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' });
    await ctx.addInitScript(() => {
      window.__m = { pulos: [], longas: [], lcp: null, t0: performance.now() };
      const desc = (n) => { if (!n || !n.nodeName) return '?'; const id = n.id ? '#' + n.id : ''; const cl = n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; return (n.nodeName.toLowerCase() + id + cl).slice(0, 60); };
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.pulos.push({ v: e.value, t: e.startTime, s: (e.sources || []).slice(0, 3).map((x) => `${desc(x.node)} y${Math.round(x.previousRect.y)}→${Math.round(x.currentRect.y)} alt${Math.round(x.previousRect.height)}→${Math.round(x.currentRect.height)}`) }); }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.longas.push({ d: e.duration, t: e.startTime }); }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((l) => { const e = l.getEntries().pop(); if (e) window.__m.lcp = { t: e.startTime, el: desc(e.element), url: String(e.url || '').slice(0, 80) }; }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const erros = []; p.on('pageerror', (e) => erros.push(e.message));
    try { await p.goto(url, { waitUntil: 'load', timeout: 60000 }); } catch (e) { erros.push('abrir: ' + e.message); }
    await p.waitForTimeout(12000);
    const m = await p.evaluate(() => window.__m).catch(() => null);
    if (!m) { anotar(`Pulos ${url}`, ['Não consegui medir.', ...erros]); await ctx.close(); continue; }
    // o que um visitante de verdade baixou, sem rolar a tela
    const baixado = await p.evaluate(() => { const r = performance.getEntriesByType('resource'), soma = (f) => r.filter(f).reduce((t, e) => t + (e.transferSize || 0), 0);
      const fotos = r.filter((e) => e.initiatorType === 'img' || /\.(jpe?g|png|webp|avif)(\?|$)|_vercel\/image/.test(e.name));
      return { fotos: fotos.length, kbFotos: Math.round(fotos.reduce((t, e) => t + (e.transferSize || 0), 0) / 1024), kbTotal: Math.round(soma(() => true) / 1024) }; }).catch(() => null);
    const total = m.pulos.reduce((t, x) => t + x.v, 0), travado = m.longas.reduce((t, x) => t + Math.max(0, x.d - 50), 0);
    const linhas = [
      `Pulo total: ${total.toFixed(3)} · Travado: ${Math.round(travado)} ms em ${m.longas.length} tarefas longas · Maior elemento aos ${Math.round((m.lcp || {}).t || 0)} ms: ${(m.lcp || {}).el || '?'} ${(m.lcp || {}).url || ''}`,
      ...(baixado ? [`Baixou sem rolar: ${baixado.kbTotal} KB (${baixado.fotos} fotos, ${baixado.kbFotos} KB)`] : []),
      ...m.pulos.filter((x) => x.v >= 0.005).sort((a, b) => a.t - b.t).slice(0, 10).map((x) => `  ${x.v.toFixed(3)} aos ${Math.round(x.t)} ms: ${x.s.join(' | ')}`),
      ...m.longas.sort((a, b) => b.d - a.d).slice(0, 5).map((x) => `  trava ${Math.round(x.d)} ms aos ${Math.round(x.t)} ms`),
      ...(erros.length ? ['Erros: ' + erros.slice(0, 3).join(' | ')] : []),
    ];
    anotar(`Pulos ${url.replace(/^https?:\/\/[^/]+/, '') || '/'}`, linhas);
    console.log(linhas.join('\n'));
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.log('::warning title=Pulos::' + String(e && e.message)); });
