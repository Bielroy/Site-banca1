'use strict';
// =====================================================================
//  lib/roteamentoWhatsapp.js — decide PARA QUAL número de WhatsApp cada
//  item do pedido vai. Função pura (sem Firebase), por isso é testável.
//
//  Cadastro (feito no painel, aba "Categorias"):
//    loja/config.wpp      → número PADRÃO (o de sempre; nada muda se não houver mais nenhum)
//    loja/config.numeros  → [{ id, nome, numero }]  números extras
//    categorias/{id}      → { chave, wppId }        qual número atende a categoria
//
//  Regra: item → categoria → wppId → número. Sem categoria cadastrada, sem
//  wppId, ou wppId de um número que foi apagado/inválido → número padrão.
//  Itens que caem no mesmo número viram UMA mensagem.
// =====================================================================

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
// Formato que o wa.me exige: DDI + DDD + número. Número salvo só com DDD
// ("62999998888") ganha o 55 do Brasil; sem isso o link abria um número de
// outro país. Zeros à esquerda ("062...") são descartados.
const normalizar = (v) => {
  let d = soDigitos(v).replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
};
const numeroValido = (d) => d.length >= 12 && d.length <= 15;

/** Lista de números extras válidos, sem repetir. */
function numerosExtras(config) {
  const vistos = new Set();
  const out = [];
  for (const n of Array.isArray(config && config.numeros) ? config.numeros : []) {
    if (!n || !n.id) continue;
    const numero = normalizar(n.numero);
    if (!numeroValido(numero) || vistos.has(n.id)) continue;
    vistos.add(n.id);
    out.push({ id: String(n.id), nome: String(n.nome || 'Atendimento').slice(0, 40), numero });
  }
  return out;
}

function numeroPadrao(config, fallback) {
  const d = normalizar(config && config.wpp);
  return numeroValido(d) ? d : normalizar(fallback);
}

/**
 * @param {{itens:Array, categorias:Array, config:Object, fallback:string}} p
 * @returns {Array<{numero:string, nome:string, itens:Array}>}  padrão sempre primeiro
 */
function resolverDestinos({ itens, categorias, config, fallback }) {
  const padrao = numeroPadrao(config, fallback);
  const extras = numerosExtras(config);
  const porId = new Map(extras.map((n) => [n.id, n]));
  const catPorChave = new Map((categorias || []).map((c) => [semAcento(c.chave), c]));

  const nomePadrao = (extras.find((n) => n.numero === padrao) || {}).nome || 'Banca';
  const grupos = new Map();
  grupos.set(padrao, { numero: padrao, nome: nomePadrao, itens: [] });

  for (const item of itens || []) {
    const cat = catPorChave.get(semAcento(item.cat));
    const alvo = cat && cat.wppId ? porId.get(String(cat.wppId)) : null;
    const numero = alvo ? alvo.numero : padrao;
    if (!grupos.has(numero)) grupos.set(numero, { numero, nome: alvo ? alvo.nome : nomePadrao, itens: [] });
    grupos.get(numero).itens.push(item);
  }
  // o número padrão sem itens não gera mensagem vazia
  return [...grupos.values()].filter((g) => g.itens.length > 0);
}

module.exports = { resolverDestinos, numerosExtras, numeroPadrao, soDigitos, numeroValido, normalizar, semAcento };
