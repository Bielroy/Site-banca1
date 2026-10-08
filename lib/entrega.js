'use strict';
// =====================================================================
//  lib/entrega.js — TAXA e HORÁRIO de entrega (lado do servidor).
//
//  A loja guarda em loja/config.entrega:
//     { taxa: 5, gratisAcima: 80, horarios: ['Manhã (8h às 12h)', 'Tarde (14h às 18h)'] }
//  taxa 0 = não cobra · gratisAcima 0 = nunca é grátis · horarios vazio = não pergunta.
//  Quem calcula a taxa é SEMPRE o servidor: o navegador só mostra a prévia.
//  Mesma conta de js/entrega-lib.js. Se mudar uma, mude a outra.
// =====================================================================
const MAX_HORARIOS = 8;
const centavos = (v) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };

/** Lê a configuração da loja com segurança (qualquer lixo vira "não cobra, não pergunta"). */
function lerConfig(config) {
  const e = (config && config.entrega) || {};
  const horarios = (Array.isArray(e.horarios) ? e.horarios : []).map((h) => String(h || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, MAX_HORARIOS);
  return { taxaC: Math.min(centavos(e.taxa), 50000), gratisAcimaC: centavos(e.gratisAcima), horarios: [...new Set(horarios)] };
}

/** Taxa (em centavos) para um pedido cujo valor dos itens, já com o cupom, é `itensC`. */
function taxaC(cfg, itensC) {
  if (!cfg || !(cfg.taxaC > 0)) return 0;
  return cfg.gratisAcimaC > 0 && itensC >= cfg.gratisAcimaC ? 0 : cfg.taxaC;
}

/**
 * Horário escolhido pelo cliente. Só vale se for um dos que a loja oferece; qualquer outra coisa vira ''
 * ("a combinar"). NUNCA barra o pedido: um cliente com a tela desatualizada (sem o campo, ou com a lista
 * antiga) ficava preso em "Escolha um horário de entrega da lista" sem ter lista nenhuma para escolher.
 * Quem exige a escolha é a tela, quando o campo está visível.
 */
function horarioValido(cfg, escolhido) {
  const h = String(escolhido || '').trim();
  return cfg.horarios.includes(h) ? h : '';
}
/** A loja pergunta o horário e este pedido chegou sem um válido: combina-se pelo WhatsApp. */
const horarioACombinar = (cfg, horario) => cfg.horarios.length > 0 && !horario;

module.exports = { lerConfig, taxaC, horarioValido, horarioACombinar, MAX_HORARIOS };
