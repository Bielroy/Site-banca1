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

module.exports = { promoDe, totalComPromo, ehPacote, MAX_PROMO_QTD };
