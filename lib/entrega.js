'use strict';
// =====================================================================
//  lib/entrega.js — TAXA e HORÁRIO de entrega e de RETIRADA (lado do servidor).
//
//  A loja guarda em loja/config.entrega:
//     { taxa: 5, gratisAcima: 80, horarios: ['Manhã (8h às 12h)', 'Tarde (14h às 18h)'],
//       retirada: { ativa: true, horarios: ['Das 8h às 12h'], local: 'Na banca, no portão 2' } }
//  taxa 0 = não cobra · gratisAcima 0 = nunca é grátis · horarios vazio = não pergunta.
//  retirada.ativa só vale com `true`: sem isso o cliente nem vê a opção "Retirar na banca".
//  Quem calcula a taxa é SEMPRE o servidor: o navegador só mostra a prévia.
//  Mesma conta de js/entrega-lib.js. Se mudar uma, mude a outra.
// =====================================================================
const MAX_HORARIOS = 8;
const centavos = (v) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };
const limpaHorarios = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map((h) => String(h || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, MAX_HORARIOS))];

/** Lê a configuração da loja com segurança (qualquer lixo vira "não cobra, não pergunta, não tem retirada"). */
function lerConfig(config) {
  const e = (config && config.entrega) || {};
  const r = e.retirada && typeof e.retirada === 'object' ? e.retirada : {};
  return {
    taxaC: Math.min(centavos(e.taxa), 50000), gratisAcimaC: centavos(e.gratisAcima), horarios: limpaHorarios(e.horarios),
    retirada: { ativa: r.ativa === true, horarios: limpaHorarios(r.horarios), local: String(r.local || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) },
  };
}

/** Taxa (em centavos) para um pedido cujo valor dos itens, já com o cupom, é `itensC`. */
function taxaC(cfg, itensC) {
  if (!cfg || !(cfg.taxaC > 0)) return 0;
  return cfg.gratisAcimaC > 0 && itensC >= cfg.gratisAcimaC ? 0 : cfg.taxaC;
}

/** Os horários que valem para o modo do pedido (entrega em casa ou retirada na banca). */
const horariosDe = (cfg, modo) => (modo === 'retirada' ? cfg.retirada.horarios : cfg.horarios);

/**
 * Horário escolhido pelo cliente. Só vale se for um dos que a loja oferece PARA AQUELE MODO; qualquer outra coisa vira ''
 * ("a combinar"). NUNCA barra o pedido: um cliente com a tela desatualizada (sem o campo, ou com a lista
 * antiga) ficava preso em "Escolha um horário de entrega da lista" sem ter lista nenhuma para escolher.
 * Quem exige a escolha é a tela, quando o campo está visível.
 */
function horarioValido(cfg, escolhido, modo = 'entrega') {
  const h = String(escolhido || '').trim();
  return horariosDe(cfg, modo).includes(h) ? h : '';
}
/** A loja pergunta o horário e este pedido chegou sem um válido: combina-se pelo WhatsApp. */
const horarioACombinar = (cfg, horario, modo = 'entrega') => horariosDe(cfg, modo).length > 0 && !horario;

/**
 * Modo do pedido: 'retirada' (o cliente busca na banca) ou 'entrega' (como sempre foi).
 * Quem não manda nada é entrega. Retirada pedida com a loja sem retirada ligada NÃO vira entrega em silêncio
 * (cobraria taxa de um pedido sem endereço): devolve null e o servidor explica o motivo.
 */
function modoDoPedido(cfg, pedido) {
  if (String(pedido || '') !== 'retirada') return 'entrega';
  return cfg.retirada.ativa ? 'retirada' : null;
}

module.exports = { lerConfig, taxaC, horarioValido, horarioACombinar, modoDoPedido, horariosDe, MAX_HORARIOS };
