'use strict';
// =====================================================================
//  testes/mundo-simulado.js — uma loja de MENTIRA com regras conhecidas
//  (dia da semana, chuva, calor, dias de pagamento, oferta, falta, dia fechado).
//  Serve de régua: o motor de previsão tem de descobrir essas regras só olhando
//  as vendas. Usado pelos testes e por scripts/medir-motor.js. Nada daqui vai ao site.
// =====================================================================
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function poisson(lam, r) { if (lam <= 0) return 0; if (lam > 60) { const u = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); return Math.max(0, Math.round(lam + Math.sqrt(lam) * u)); } const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
function gama(k, r) { // Marsaglia-Tsang, k>0
  if (k < 1) return gama(k + 1, r) * Math.pow(r() || 1e-9, 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = r(); if (Math.log(u || 1e-9) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; }
}
const negbin = (mu, disp, r) => poisson(mu * gama(disp, r) / disp, r);   // variância = mu + mu²/disp

const CATS = ['folhas', 'frutas', 'legumes', 'artesanais'];
const EF = { // efeitos verdadeiros por categoria
  chuva: { folhas: 0.72, frutas: 0.85, legumes: 0.82, artesanais: 0.9 },
  calor: { folhas: 1.0, frutas: 1.28, legumes: 0.97, artesanais: 0.95 },
  frio: { folhas: 0.95, frutas: 0.85, legumes: 1.1, artesanais: 1.05 },
  pag: { folhas: 1.08, frutas: 1.15, legumes: 1.1, artesanais: 1.3 },
};
/** opts: { seed, dias, efeitos (liga clima/preço/pagamento), nProd, dia0 } */
function gerar({ seed = 1, dias = 150, efeitos = true, nProd = 32, dia0 = 20000, dowDisp = 0.35 } = {}) {
  const r = rng(seed);
  const dowLoja = [0.9, 0.7, 0.85, 0.95, 1.0, 1.25, 1.55];               // dom..sáb
  const m = dowLoja.reduce((a, b) => a + b) / 7; for (let i = 0; i < 7; i++) dowLoja[i] /= m;
  const produtos = [];
  for (let i = 0; i < nProd; i++) {
    const cat = CATS[i % 4], nivel = Math.exp(-0.9 + 4.6 * r());              // 0,4 a 40 por dia
    const dow = dowLoja.map((f) => f * Math.exp((r() - 0.5) * dowDisp));
    const md = dow.reduce((a, b) => a + b) / 7;
    produtos.push({ id: 'p' + i, nome: 'P' + i, cat, unidade: i % 3 === 0 ? 'kg' : 'un', preco: 3 + Math.round(r() * 200) / 10, nivel, dow: dow.map((f) => f / md),
      disp: 3 + r() * 9, elast: 1.2 + r() * 1.6, tend: i % 7 === 0 ? (r() < 0.5 ? 0.006 : -0.005) : 0, nasce: i % 9 === 8 ? 35 + Math.floor(r() * 40) : 0, sens: Math.exp((r() - 0.5) * 0.3) });
  }
  const clima = new Map(), estados = new Map();
  let chuvaOntem = false; const tmaxs = [];
  for (let t = 0; t < dias + 20; t++) {
    const d = dia0 + t, sazon = 30 + 3 * Math.sin(t / 25);
    const chove = r() < (chuvaOntem ? 0.5 : 0.22); chuvaOntem = chove;
    const tmax = sazon + (chove ? -3.5 : 0.8) + (r() - 0.5) * 7;
    clima.set(d, { chuva: chove ? 5 + r() * 30 : (r() < 0.2 ? r() * 3 : 0), tmax: Math.round(tmax * 10) / 10 });
    tmaxs.push(tmax);
  }
  const vendas = new Map(produtos.map((p) => [p.id, new Map()])), precos = new Map(produtos.map((p) => [p.id, new Map()])), ruptura = new Map(produtos.map((p) => [p.id, new Set()]));
  const esperado = new Map(produtos.map((p) => [p.id, new Map()]));        // a média verdadeira de cada dia (o teto do que dá para acertar)
  const fechados = new Set(); const oferta = new Map();                     // pid → { ate, desc }
  for (let t = 0; t < dias; t++) {
    const d = dia0 + t, dw = (((d + 4) % 7) + 7) % 7, dm = new Date(d * 86400000).getUTCDate();
    if (efeitos && r() < 0.015) { fechados.add(d); continue; }                 // loja não abriu
    const c = clima.get(d), ant = tmaxs.slice(Math.max(0, t - 30), t).sort((a, b) => a - b), med = ant.length ? ant[ant.length >> 1] : c.tmax;
    const st = { chuva: c.chuva >= 5, calor: c.tmax >= med + 3, frio: c.tmax <= med - 4, pag: dm >= 5 && dm <= 10 };
    estados.set(d, st);
    for (const p of produtos) {
      if (t < p.nasce) continue;
      let o = oferta.get(p.id);
      if (o && t > o.ate) { oferta.delete(p.id); o = null; }
      if (!o && efeitos && r() < 0.035) { o = { ate: t + 1 + Math.floor(r() * 4), desc: 0.12 + r() * 0.23 }; oferta.set(p.id, o); }
      const preco = o ? Math.round(p.preco * (1 - o.desc) * 100) / 100 : p.preco;
      precos.get(p.id).set(d, { p: preco, de: o ? p.preco : null });
      let mu = p.nivel * p.dow[dw] * Math.exp(p.tend * (t - p.nasce));
      if (efeitos) {
        for (const k of ['chuva', 'calor', 'frio', 'pag']) if (st[k]) mu *= Math.pow(EF[k][p.cat], p.sens);
        if (o) mu *= Math.pow(preco / p.preco, -p.elast);
      }
      let y = negbin(mu, p.disp, r);
      if (p.unidade === 'kg') y = Math.round(y * (0.85 + 0.3 * r()) * 100) / 100;
      // falta: em 3% dos dias o produto acaba no meio do dia
      if (efeitos && y > 2 && r() < 0.03) { y = Math.floor(y * (0.3 + 0.4 * r())); ruptura.get(p.id).add(d); }
      esperado.get(p.id).set(d, mu);
      if (y > 0) vendas.get(p.id).set(d, y);
    }
  }
  return { produtos, vendas, precos, clima, estados, ruptura, esperado, fechados, dia0, dias };
}
module.exports = { gerar, rng };
