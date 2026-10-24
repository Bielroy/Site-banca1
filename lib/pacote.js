'use strict';
// =====================================================================
//  lib/pacote.js — PROMOÇÃO POR QUANTIDADE no servidor ("4 por R$ 10").
//  Mesma conta de js/pacote-lib.js (promoDe / totalComPromo); um teste
//  confere que as duas batem. A do servidor é a que vale: o navegador
//  nunca manda preço.
// =====================================================================
const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const fracionavel = (u) => FRACIONAVEIS.includes(String(u || '').toLowerCase());
const centavos = (v) => Math.round(Number(v) * 100);
const MAX_PROMO_QTD = 50;

function promoDe(p, preco = p && p.preco) {
  if (!p || fracionavel(p.unidade)) return null;
  const q = Number(p.promoQtd), v = Math.round(Number(p.promoPreco) * 100) / 100, un = Number(preco);
  if (!Number.isInteger(q) || q < 2 || q > MAX_PROMO_QTD) return null;
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(un) || un <= 0) return null;
  if (centavos(v) >= centavos(un) * q) return null;
  return { qtd: q, preco: v };
}

function totalComPromo(precoUnit, qtd, promo) {
  const n = Math.max(0, Math.round(Number(qtd) || 0)), un = centavos(precoUnit);
  if (!promo || n < promo.qtd) return un * n;
  const grupos = Math.floor(n / promo.qtd), resto = n % promo.qtd;
  return grupos * centavos(promo.preco) + resto * un;
}

const ehPacote = (p) => !!p && p.pacote === true && !fracionavel(p.unidade);

// ---------------------------------------------------------------------
// PROMOÇÃO MISTURADA: "4 por R$ 10" vale para QUALQUER pacote com a mesma
// promoção (2 de batata + 2 de cenoura = 4). Produto que não é pacote conta
// sozinho (4 alfaces). Quando os preços são diferentes, os mais caros entram
// na promoção (melhor para o cliente) e o valor da promoção é repartido
// entre os itens, proporcional ao preço, sem perder centavo.
// ---------------------------------------------------------------------
/** Grupo de promoção do produto: pacotes com a mesma promoção se juntam; o resto, por produto. */
const chavePromo = (p, promo) => (!promo || !p ? '' : ehPacote(p) ? `pac|${promo.qtd}|${centavos(promo.preco)}` : `id|${p.id}`);

/**
 * linhas = [{ preco, qtd, promo, chave }] (na ordem da sacola)
 * → { itens: [{ sub (centavos), naPromo (quantas unidades entraram na promoção) }],
 *     grupos: Map chave → { promo, total, completos, falta } }
 * Linha sem promoção: sub = preço × quantidade (arredondado em centavos).
 */
function contaDaPromo(linhas) {
  const ls = (Array.isArray(linhas) ? linhas : []).map((l, i) => {
      const promo = l && l.promo && Number(l.promo.qtd) >= 2 ? l.promo : null;
      const n = promo ? Math.max(0, Math.round(Number(l.qtd) || 0)) : Number(l && l.qtd) || 0;
      return { i, n, un: centavos(l && l.preco), promo, chave: promo ? String(l.chave || `linha|${i}`) : '' };
  });
  const itens = ls.map((l) => ({ sub: Math.round(l.un * l.n), naPromo: 0 }));
  const porChave = new Map(), grupos = new Map();
  for (const l of ls) if (l.chave) { if (!porChave.has(l.chave)) porChave.set(l.chave, []); porChave.get(l.chave).push(l); }
  for (const [chave, g] of porChave) {
      const promo = g[0].promo, q = promo.qtd, total = g.reduce((s, l) => s + l.n, 0), completos = Math.floor(total / q);
      grupos.set(chave, { promo, total, completos, falta: total % q ? q - (total % q) : 0 });
      if (!completos) continue;
      let resta = completos * q;
      const dentro = new Map();
      for (const l of [...g].sort((a, b) => b.un - a.un || a.i - b.i)) { const t = Math.min(l.n, resta); dentro.set(l, t); resta -= t; }
      const P = completos * centavos(promo.preco), base = g.reduce((s, l) => s + dentro.get(l) * l.un, 0);
      const partes = g.map((l) => { const ex = base ? (P * dentro.get(l) * l.un) / base : 0; return { l, c: Math.floor(ex), r: ex - Math.floor(ex) }; });
      let sobra = P - partes.reduce((s, x) => s + x.c, 0);
      for (const x of [...partes].sort((a, b) => b.r - a.r || a.l.i - b.l.i)) { if (sobra <= 0) break; x.c++; sobra--; }
      for (const x of partes) itens[x.l.i] = { sub: x.c + (x.l.n - dentro.get(x.l)) * x.l.un, naPromo: dentro.get(x.l) };
  }
  return { itens, grupos };
}

module.exports = { promoDe, totalComPromo, ehPacote, chavePromo, contaDaPromo, MAX_PROMO_QTD };
