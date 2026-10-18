'use strict';
// =====================================================================
//  lib/entrega.js — TAXA e HORÁRIO de entrega e de RETIRADA (lado do servidor).
//
//  A loja guarda em loja/config.entrega:
//     { taxa: 5, gratisAcima: 80, horarios: ['Manhã (8h às 12h)', 'Tarde (14h às 18h)'],
//       retirada: { ativa: true, horarios: ['Das 8h às 12h'], local: 'Na banca, no portão 2' } }
//  taxa 0 = não cobra · gratisAcima 0 = nunca é grátis · horarios vazio = não pergunta.
//     regras: [{ feira: 'atenas', dias: [3], horarios: ['Manhã (8h às 11h)'] }]   (horários de ENTREGA por feira/condomínio e dia)
//  retirada.dias = dias da semana em que a retirada funciona (vazio = todos os dias).
//  retirada.ativa só vale com `true`: sem isso o cliente nem vê a opção "Retirar na banca".
//  Quem calcula a taxa é SEMPRE o servidor: o navegador só mostra a prévia.
//  Mesma conta de js/entrega-lib.js. Se mudar uma, mude a outra.
// =====================================================================
const MAX_HORARIOS = 8;
const centavos = (v) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };
const limparDias = (dias) => [...new Set((Array.isArray(dias) ? dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
const MAX_REGRAS = 20;
/** Regras de horário da entrega: lixo é descartado. `feira` vazio = qualquer feira (e quem não é de feira); `dias` vazio = qualquer dia. */
const limpaRegras = (lista) => (Array.isArray(lista) ? lista : []).filter((r) => r && typeof r === 'object').slice(0, MAX_REGRAS).map((r) => ({
  feira: /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(r.feira || '')) ? String(r.feira) : '', dias: limparDias(r.dias), horarios: limpaHorarios(r.horarios),
}));
const limpaHorarios = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map((h) => String(h || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, MAX_HORARIOS))];

/** Lê a configuração da loja com segurança (qualquer lixo vira "não cobra, não pergunta, não tem retirada"). */
function lerConfig(config) {
  const e = (config && config.entrega) || {};
  const r = e.retirada && typeof e.retirada === 'object' ? e.retirada : {};
  return {
    taxaC: Math.min(centavos(e.taxa), 50000), gratisAcimaC: centavos(e.gratisAcima), horarios: limpaHorarios(e.horarios), regras: limpaRegras(e.regras),
    retirada: { ativa: r.ativa === true, dias: limparDias(r.dias), horarios: limpaHorarios(r.horarios), local: String(r.local || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) },
  };
}

/** Taxa (em centavos) para um pedido cujo valor dos itens, já com o cupom, é `itensC`. */
function taxaC(cfg, itensC) {
  if (!cfg || !(cfg.taxaC > 0)) return 0;
  return cfg.gratisAcimaC > 0 && itensC >= cfg.gratisAcimaC ? 0 : cfg.taxaC;
}

/**
 * Horários de ENTREGA que valem para uma feira (ou '') num dia da semana. Vence a regra mais específica:
 * feira + dia · feira · dia · a lista geral. Empate: a primeira da lista. Regra com lista vazia = "neste caso a loja não pergunta".
 * Mesma conta de js/entrega-lib.js (horariosDaEntrega).
 */
function horariosDaEntrega(cfg, feira = '', dow = -1) {
  let melhor = null, nota = -1;
  for (const r of cfg.regras || []) {
    if ((r.feira && r.feira !== feira) || (r.dias.length && !r.dias.includes(dow))) continue;
    const n = (r.feira ? 2 : 0) + (r.dias.length ? 1 : 0);
    if (n > nota) { melhor = r; nota = n; }
  }
  return melhor ? melhor.horarios : cfg.horarios;
}
/** A retirada funciona neste dia da semana? (sem dias marcados = todos os dias) */
const retiradaNoDia = (cfg, dow) => !cfg.retirada.dias.length || cfg.retirada.dias.includes(dow);
/** Os horários que valem para o modo do pedido. ctx = { feira, dow } só serve para a entrega. */
const horariosDe = (cfg, modo, ctx = {}) => (modo === 'retirada' ? cfg.retirada.horarios : horariosDaEntrega(cfg, ctx.feira || '', Number.isInteger(ctx.dow) ? ctx.dow : -1));

/**
 * Horário escolhido pelo cliente. Só vale se for um dos que a loja oferece PARA AQUELE MODO; qualquer outra coisa vira ''
 * ("a combinar"). NUNCA barra o pedido: um cliente com a tela desatualizada (sem o campo, ou com a lista
 * antiga) ficava preso em "Escolha um horário de entrega da lista" sem ter lista nenhuma para escolher.
 * Quem exige a escolha é a tela, quando o campo está visível.
 */
function horarioValido(cfg, escolhido, modo = 'entrega', ctx = {}) {
  const h = String(escolhido || '').trim();
  return horariosDe(cfg, modo, ctx).includes(h) ? h : '';
}
/** A loja pergunta o horário e este pedido chegou sem um válido: combina-se pelo WhatsApp. */
const horarioACombinar = (cfg, horario, modo = 'entrega', ctx = {}) => horariosDe(cfg, modo, ctx).length > 0 && !horario;

/**
 * Modo do pedido: 'retirada' (o cliente busca na banca) ou 'entrega' (como sempre foi).
 * Quem não manda nada é entrega. Retirada pedida com a loja sem retirada ligada, ou num dia (`dow`) em que ela não
 * funciona, NÃO vira entrega em silêncio (cobraria taxa de um pedido sem endereço): devolve null e o servidor explica o motivo.
 */
function modoDoPedido(cfg, pedido, dow = -1) {
  if (String(pedido || '') !== 'retirada') return 'entrega';
  return cfg.retirada.ativa && retiradaNoDia(cfg, dow) ? 'retirada' : null;
}

module.exports = { lerConfig, taxaC, horarioValido, horarioACombinar, modoDoPedido, horariosDe, horariosDaEntrega, retiradaNoDia, MAX_HORARIOS, MAX_REGRAS };
