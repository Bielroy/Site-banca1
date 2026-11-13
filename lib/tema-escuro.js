'use strict';
// =====================================================================
//  lib/tema-escuro.js — GERADOR do tema escuro do PAINEL (css/admin-escuro.css).
//
//  O painel tem centenas de cores escritas direto no CSS. Em vez de mexer em cada uma (e arriscar o tema claro,
//  que é o original e não muda), este gerador LÊ o CSS do painel e escreve um arquivo só com as trocas de cor,
//  todas debaixo de html[data-painel-tema="escuro"]. Sem esse atributo, nada do arquivo vale.
//
//  Cada cor é trocada pelo PAPEL dela na regra:
//    fundo  claro  -> superfície escura (branco = card, creme = fundo da página, pergaminho = "poço" um pouco mais claro)
//    texto  escuro -> texto claro (o cinza vira cinza claro; a cor mantém o tom e clareia)
//    borda  clara  -> linha escura
//  Fundo de cor forte (verde da marca, vermelho, manga) e texto branco em cima dele ficam como estão.
//
//  Rodar depois de mexer em qualquer CSS do painel:  node scripts/gerar-tema-escuro.js
//  (testes/index.js confere se o arquivo gerado está em dia.)
// =====================================================================
const ATRIBUTO = 'html[data-painel-tema="escuro"]';
// Ordem igual à do admin.html. variables.css só serve para saber o valor das variáveis.
const ARQUIVOS = ['css/variables.css', 'css/shared.css', 'css/admin.css', 'css/admin-picking.css', 'css/admin-previsao.css', 'css/admin-modulo3.css',
  'css/admin-aparencia.css', 'css/admin-estoque.css', 'css/admin-icones.css', 'css/admin-casca.css', 'css/admin-vitrine.css', 'css/admin-rotulos.css',
  'css/admin-impressora.css', 'css/admin-cadastro.css', 'css/admin-montar.css', 'css/painel-base.css', 'css/admin-resumo.css'];

// ---------------------------------------------------------------- cores
const NOMES = { white: '#ffffff', black: '#000000' };
function lerCor(t) {
  t = t.trim().toLowerCase(); if (NOMES[t]) t = NOMES[t];
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1]; if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t);
  if (m) { const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return { r: +m[1], g: +m[2], b: +m[3], a }; }
  return null;
}
function paraHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, c = mx - mn;
  let h = 0; if (c) { h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; h *= 60; if (h < 0) h += 360; }
  return { h, s: c ? c / (1 - Math.abs(2 * l - 1)) : 0, l, c };
}
function deHsl(h, s, l, a = 1) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const p = (v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255);
  return { r: p(r), g: p(g), b: p(b), a };
}
function escrever({ r, g, b, a }) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return a >= 0.999 ? `#${h(r)}${h(g)}${h(b)}` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contraste = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

// "neutro" nesta paleta = cinza ou bege (os neutros do site são quentes); o resto é cor de verdade (verde, vermelho, âmbar, azul)
const neutro = ({ h, c }) => c < 0.035 || (h >= 22 && h <= 68 && c < 0.13);

/** Troca UMA cor conforme o papel ('fundo' | 'texto' | 'borda'). Devolve a cor nova (objeto) ou null para deixar como está. */
function trocar(cor, papel) {
  const { h, s, l, c } = paraHsl(cor), a = cor.a, n = neutro({ h, c });
  if (a < 0.02) return null;
  if (papel === 'fundo') {
    if (l >= 0.80) {
      if (!n) return deHsl(h, Math.min(s, 0.42), 0.17, a);                 // fundo claro COM cor (verde/vermelho/âmbar claro): mesmo tom, escuro
      if (l >= 0.975) return deHsl(150, 0.16, 0.115, a);                   // branco: card
      if (l >= 0.945) return deHsl(150, 0.19, 0.075, a);                   // creme: fundo da página
      return deHsl(150, 0.15, Math.min(0.26, 0.155 + (0.945 - l) * 0.6), a); // pergaminho: "poço", um pouco mais claro que o card
    }
    if (l >= 0.45 && n) return deHsl(150, 0.10, 0.30, a);                  // cinza médio (desligado)
    if (l < 0.22 && !n && c >= 0.08) return deHsl(h, s, 0.25, a);          // verde da marca (botões, aba escolhida): um pouco mais claro, para não sumir no fundo escuro
    return null;                                                           // cor forte ou escura: fica
  }
  if (papel === 'texto') {
    if (l >= 0.60) return null;                                            // texto claro (em cima de cor): fica
    if (c < 0.08) return deHsl(140, 0.08, Math.min(0.93, Math.max(0.62, 1 - l * 0.78)), a);
    return deHsl(h, Math.min(Math.max(s, 0.35), 0.72), l < 0.3 ? 0.74 : 0.70, a);
  }
  if (papel === 'borda') {
    if (l >= 0.70) return n ? deHsl(150, 0.15, Math.min(0.30, 0.20 + (0.92 - Math.min(l, 0.92)) * 0.35), a) : deHsl(h, Math.min(s, 0.40), 0.32, a);
    if (l < 0.45) return c < 0.08 ? deHsl(140, 0.08, 0.62, a) : deHsl(h, Math.min(Math.max(s, 0.35), 0.6), 0.66, a);
    return null;
  }
  return null;
}

const papelDe = (prop) => {
  if (prop.startsWith('--')) return null;
  if (/^(color|fill|stroke|caret-color|text-decoration-color|-webkit-text-fill-color|text-decoration|accent-color)$/.test(prop)) return 'texto';
  if (prop.startsWith('background')) return 'fundo';
  if (/^(border|outline|column-rule)/.test(prop) && !/radius|width|style|collapse|spacing|offset|image/.test(prop)) return 'borda';
  if (prop === 'box-shadow') return 'sombra';
  return null;
};

// ---------------------------------------------------------------- leitura do CSS
const semComentario = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Acha o fim do bloco que começa em css[i] === '{'. */
function fimDoBloco(css, i) {
  let f = 0, asp = '';
  for (; i < css.length; i++) {
    const ch = css[i];
    if (asp) { if (ch === '\\') i++; else if (ch === asp) asp = ''; continue; }
    if (ch === '"' || ch === "'") asp = ch; else if (ch === '{') f++; else if (ch === '}') { f--; if (!f) return i; }
  }
  return css.length;
}
/** Separa por um caractere, fora de parênteses e de aspas. */
function separar(txt, sep) {
  const partes = []; let p = 0, asp = '', ini = 0;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (asp) { if (ch === '\\') i++; else if (ch === asp) asp = ''; continue; }
    if (ch === '"' || ch === "'") asp = ch; else if (ch === '(') p++; else if (ch === ')') p--;
    else if (ch === sep && !p) { partes.push(txt.slice(ini, i)); ini = i + 1; }
  }
  partes.push(txt.slice(ini)); return partes;
}
/** Lê o CSS em nós: { sel, decls: [[prop, valor]] } ou { arroba, filhos }. @keyframes, @font-face etc. ficam de fora. */
function ler(css) {
  const nos = []; let i = 0;
  while (i < css.length) {
    const abre = css.indexOf('{', i), pv = css.indexOf(';', i);
    if (abre < 0) break;
    if (pv >= 0 && pv < abre && css.slice(i, pv).trim().startsWith('@')) { i = pv + 1; continue; }   // @import ...;
    const pre = css.slice(i, abre).trim(), fim = fimDoBloco(css, abre), miolo = css.slice(abre + 1, fim);
    if (pre.startsWith('@')) {
      if (/^@(media|supports|container|layer)\b/.test(pre)) nos.push({ arroba: pre, filhos: ler(miolo) });
    } else if (pre) {
      const decls = [];
      for (const d of separar(miolo, ';')) { const k = d.indexOf(':'); if (k > 0) decls.push([d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()]); }
      nos.push({ sel: pre, decls });
    }
    i = fim + 1;
  }
  return nos;
}

// ---------------------------------------------------------------- gerador
// O que imita PAPEL (prévia do que sai na impressora) continua claro: papel é branco, com tinta escura.
const FICA_CLARO = /\.ipr-(papel|previa|vazio|canvas)\b/;
// var(--nome) ou var(--nome, reserva): vale a cor da variável (a reserva só se a variável não existir). Vem primeiro, para a reserva não ser lida solta.
const RE_COR = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)|#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|(?<![\w-])(?:white|black)(?![\w-])/g;

function variaveis(folhas) {
  const v = {};
  const andar = (nos) => { for (const n of nos) { if (n.filhos) continue; if (/^(:root|html)$/.test(n.sel)) for (const [p, val] of n.decls) if (p.startsWith('--') && !(p in v)) v[p] = val; } };
  for (const f of folhas) andar(f);
  const resolver = (nome, n = 0) => { const val = v[nome]; if (val === undefined || n > 5) return null; const m = /^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/.exec(val); return m ? resolver(m[1], n + 1) : lerCor(val); };
  return resolver;
}

function prefixar(sel) {
  return separar(sel, ',').map((s) => {
    s = s.trim().replace(/\s+/g, ' ');
    if (/^(html|:root)(?![\w-])/.test(s)) return s.replace(/^(html|:root)/, ATRIBUTO);
    return `${ATRIBUTO} ${s}`;
  }).join(', ');
}

/**
 * Gera o CSS do tema escuro. `ler1(arquivo)` devolve o texto de um arquivo CSS.
 * `extra` é um trecho escrito à mão que vai no fim (acertos que o gerador não alcança).
 */
function gerar(ler1, extra = '') {
  const folhas = ARQUIVOS.map((a) => ler(semComentario(ler1(a))));
  const corDaVar = variaveis(folhas);
  // a reserva de um var() pode ser outra variável: var(--forest-texto, var(--forest))
  const corDaReserva = (r) => { if (!r) return null; const m = /^\s*var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*(.*))?\)\s*$/.exec(r); return m ? (corDaVar(m[1]) || corDaReserva(m[2])) : lerCor(r); };
  const saida = [];
  const umaRegra = (n) => {
    // cor de fundo e de texto da PRÓPRIA regra: se o fundo fica (cor forte), o texto em cima dele também fica
    const novas = []; let fundoFinal = null, textoOriginal = null, textoIdx = -1;
    // fundo de cor forte que fica (ex.: botão verde): a borda da MESMA cor também fica (senão o botão ganharia um contorno claro)
    let fundoQueFica = null;
    for (const [prop, valor] of n.decls) {
      if (papelDe(prop) !== 'fundo') continue;
      const m = valor.match(RE_COR); if (!m) continue;
      const nv = /^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*(.*))?\)$/.exec(m[0]), cor = nv ? (corDaVar(nv[1]) || corDaReserva(nv[2])) : lerCor(m[0]);
      fundoQueFica = cor && cor.a > 0.5 && (paraHsl(cor).l < 0.5 || !trocar(cor, 'fundo')) ? escrever(cor) : null;
    }
    for (const [prop, valor] of n.decls) {
      const papel = papelDe(prop); if (!papel) continue;
      const imp = /!important\s*$/.test(valor);
      let mudou = false, primeira = null, primeiraNova = null;
      // bolinha de chave liga/desliga e marcas feitas com ::before/::after: o branco continua branco
      const pseudoBranco = papel === 'fundo' && /::?(after|before)\b/.test(n.sel);
      const novo = valor.replace(RE_COR, (tudo, nomeVar, reserva) => {
        const cor = nomeVar ? (corDaVar(nomeVar) || corDaReserva(reserva)) : lerCor(tudo);
        if (!cor) return tudo;
        const t = (pseudoBranco && paraHsl(cor).l > 0.9) ? null : papel === 'borda' && fundoQueFica && paraHsl(cor).l < 0.5 ? null : trocar(cor, papel === 'sombra' ? (paraHsl(cor).l > 0.9 ? 'fundo' : 'nada') : papel);
        if (!primeira) { primeira = cor; primeiraNova = t || cor; }
        if (!t) return tudo;
        mudou = true; return escrever(t);
      });
      if (papel === 'fundo' && primeira && primeira.a > 0.5) fundoFinal = primeiraNova;
      if (prop === 'color' && primeira) { textoOriginal = primeira; textoIdx = novas.length; }
      // regra com cor que NÃO muda também é repetida: o prefixo deixa as regras escuras mais fortes, e sem repetir a de
      // "ligado" (ex.: chave verde) a de "desligado" ganharia dela. Repetida com a cor original, a ordem do CSS vale de novo.
      if (primeira) novas.push([prop, mudou ? novo : valor, imp, valor]);
    }
    // texto escuro em cima de fundo forte que ficou (ex.: botão manga com texto verde-escuro): mantém o texto original se lê melhor
    if (fundoFinal && textoOriginal && textoIdx >= 0 && novas[textoIdx][1]) {
      const trocada = lerCor(novas[textoIdx][1].replace(/\s*!important\s*$/, ''));
      if (trocada && contraste(textoOriginal, fundoFinal) > contraste(trocada, fundoFinal)) novas[textoIdx][1] = novas[textoIdx][3];
    }
    const finais = novas.filter((x) => x[1]);
    if (!finais.length) return '';
    return `${prefixar(n.sel)} { ${finais.map(([p, v]) => `${p}: ${v};`).join(' ')} }`;
  };
  const andar = (nos, nivel) => {
    const linhas = [];
    for (const n of nos) {
      if (n.filhos) { const dentro = andar(n.filhos, nivel + 1); if (dentro.length) linhas.push(`${'  '.repeat(nivel)}${n.arroba} {`, ...dentro, `${'  '.repeat(nivel)}}`); continue; }
      if (/^(:root|html)$/.test(n.sel) && n.decls.every(([p]) => p.startsWith('--'))) continue;
      if (FICA_CLARO.test(n.sel)) continue;
      const r = umaRegra(n); if (r) linhas.push('  '.repeat(nivel) + r);
    }
    return linhas;
  };
  ARQUIVOS.forEach((arq, k) => { const l = andar(folhas[k], 0); if (l.length) saida.push(`/* ---- ${arq} ---- */`, ...l, ''); });
  return `/* GERADO por scripts/gerar-tema-escuro.js (lib/tema-escuro.js). NÃO EDITE À MÃO: mexa no CSS do painel ou em css/admin-escuro-extra.css e rode o gerador.\n   Tema escuro do PAINEL: só vale com ${ATRIBUTO}. A loja do cliente não usa este arquivo. */\n`
    + saida.join('\n') + (extra.trim() ? `\n/* ---- css/admin-escuro-extra.css (acertos à mão) ---- */\n${extra.trim()}\n` : '');
}

module.exports = { gerar, ler, trocar, lerCor, escrever, contraste, papelDe, ARQUIVOS, ATRIBUTO };
