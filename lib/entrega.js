'use strict';
// =====================================================================
//  lib/entrega.js — TAXA, HORÁRIO e o que vale em cada dia: ENTREGA e RETIRADA (lado do servidor).
//
//  Cada banca guarda na configuração DELA (loja/config.entrega — outra banca nunca lê nem muda):
//     { taxa: 5, gratisAcima: 80, horarios: ['Manhã (8h às 12h)', 'Tarde (14h às 18h)'],
//       retirada: { ativa: true, dias: [1, 2], horarios: ['Das 8h às 12h'], local: 'Na banca' },        ← cliente SEM feira
//       agenda: [{ feira: 'madri', dia: 3, entrega: true,  horariosEntrega: ['Manhã'], retirada: false },   ← cliente DA FEIRA,
//                { feira: 'madri', dia: 5, entrega: true,  horariosEntrega: [], retirada: true,             no dia da entrega
//                  horariosRetirada: ['Das 7h às 11h'], local: 'Na feira do Madri' }] }
//  taxa 0 = não cobra · gratisAcima 0 = nunca é grátis · horarios vazio = não pergunta.
//  retirada.ativa só vale com `true`; retirada.dias vazio = todos os dias.
//
//  O QUE O CLIENTE PODE ESCOLHER (opcoesDoDia):
//   - cliente da feira X num dia da feira com linha na agenda → exatamente o que a linha diz;
//   - cliente da feira sem linha para aquele dia → entrega como sempre foi (lista geral), sem retirada;
//   - cliente sem feira → entrega (lista geral) e a retirada geral, se ligada e se hoje é um dos dias dela.
//  Quem calcula a taxa é SEMPRE o servidor: o navegador só mostra a prévia.
//  Mesma conta de js/entrega-lib.js. Se mudar uma, mude a outra.
// =====================================================================
const MAX_HORARIOS = 8;
const MAX_AGENDA = 40;
const centavos = (v) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };
const limparDias = (dias) => [...new Set((Array.isArray(dias) ? dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
const limpaTexto = (v, max) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const limpaHorarios = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map((h) => limpaTexto(h, 40)).filter(Boolean))].slice(0, MAX_HORARIOS);
const ID_FEIRA = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Agenda por feira e dia: só linhas com feira válida, dia de 0 a 6 e pelo menos entrega OU retirada. Feira + dia repetido: vale a primeira. */
function limpaAgenda(lista) {
  const out = [], vistos = new Set();
  for (const r of Array.isArray(lista) ? lista.slice(0, MAX_AGENDA * 2) : []) {
    if (!r || typeof r !== 'object' || !ID_FEIRA.test(String(r.feira || '')) || !Number.isInteger(r.dia) || r.dia < 0 || r.dia > 6) continue;
    const entrega = r.entrega === true, retirada = r.retirada === true, chave = `${r.feira}|${r.dia}`;
    if ((!entrega && !retirada) || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ feira: String(r.feira), dia: r.dia, entrega, horariosEntrega: entrega ? limpaHorarios(r.horariosEntrega) : [], retirada, horariosRetirada: retirada ? limpaHorarios(r.horariosRetirada) : [], local: retirada ? limpaTexto(r.local, 80) : '' });
    if (out.length >= MAX_AGENDA) break;
  }
  return out;
}

/** Lê a configuração da loja com segurança (qualquer lixo vira "não cobra, não pergunta, não tem retirada"). */
function lerConfig(config) {
  const e = (config && config.entrega) || {};
  const r = e.retirada && typeof e.retirada === 'object' ? e.retirada : {};
  return {
    taxaC: Math.min(centavos(e.taxa), 50000), gratisAcimaC: centavos(e.gratisAcima), horarios: limpaHorarios(e.horarios),
    retirada: { ativa: r.ativa === true, dias: limparDias(r.dias), horarios: limpaHorarios(r.horarios), local: limpaTexto(r.local, 80) },
    agenda: limpaAgenda(e.agenda),
  };
}

/** Taxa (em centavos) para um pedido cujo valor dos itens, já com o cupom, é `itensC`. */
function taxaC(cfg, itensC) {
  if (!cfg || !(cfg.taxaC > 0)) return 0;
  return cfg.gratisAcimaC > 0 && itensC >= cfg.gratisAcimaC ? 0 : cfg.taxaC;
}

/** A retirada geral (cliente sem feira) funciona neste dia da semana? (sem dias marcados = todos os dias) */
const retiradaNoDia = (cfg, dow) => !cfg.retirada.dias.length || cfg.retirada.dias.includes(dow);

/**
 * O que o cliente pode escolher para o dia do pedido.
 *   feira = id da feira do cliente nesta banca ('' = sem feira) · dow = dia da semana da ENTREGA (0 a 6)
 *   → { entrega, retirada, horariosEntrega, horariosRetirada, local, daAgenda }
 */
function opcoesDoDia(cfg, feira = '', dow = -1) {
  if (feira) {
    const r = cfg.agenda.find((x) => x.feira === feira && x.dia === dow);
    if (r) return { entrega: r.entrega, retirada: r.retirada, horariosEntrega: r.horariosEntrega, horariosRetirada: r.horariosRetirada, local: r.local, daAgenda: true };
    return { entrega: true, retirada: false, horariosEntrega: cfg.horarios, horariosRetirada: [], local: '', daAgenda: false };
  }
  return { entrega: true, retirada: cfg.retirada.ativa && retiradaNoDia(cfg, dow), horariosEntrega: cfg.horarios, horariosRetirada: cfg.retirada.horarios, local: cfg.retirada.local, daAgenda: false };
}

/** Os horários que valem para o modo do pedido. ctx = { feira, dow }. */
const horariosDe = (cfg, modo, ctx = {}) => { const o = opcoesDoDia(cfg, ctx.feira || '', Number.isInteger(ctx.dow) ? ctx.dow : -1); return modo === 'retirada' ? o.horariosRetirada : o.horariosEntrega; };

/**
 * Horário escolhido pelo cliente. Só vale se for um dos que a loja oferece PARA AQUELE MODO E DIA; qualquer outra coisa vira ''
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
 * Modo do pedido: 'retirada' ou 'entrega'. Quem não manda nada pede entrega (como sempre foi).
 * O modo pedido tem de existir naquele dia (opcoesDoDia). Se não existir, devolve { erro } com o motivo:
 * nunca troca um pelo outro em silêncio (entrega sem endereço, ou retirada num dia sem ninguém na banca).
 */
function modoDoPedido(cfg, pedido, ctx = {}) {
  const o = opcoesDoDia(cfg, ctx.feira || '', Number.isInteger(ctx.dow) ? ctx.dow : -1);
  if (String(pedido || '') === 'retirada') {
    if (o.retirada) return { modo: 'retirada', local: o.local };
    if (ctx.feira) return { erro: 'Neste dia a sua feira não tem retirada. Escolha a entrega ou chame a banca pelo WhatsApp.' };
    return { erro: cfg.retirada.ativa ? 'Hoje não tem retirada na banca. Escolha a entrega ou chame a banca pelo WhatsApp.' : 'A retirada na banca não está disponível agora. Escolha a entrega ou chame a banca pelo WhatsApp.' };
  }
  if (o.entrega) return { modo: 'entrega' };
  return { erro: 'Neste dia a sua feira é só retirada. Escolha "Retirar na feira" e envie de novo.' };
}

module.exports = { lerConfig, taxaC, horarioValido, horarioACombinar, modoDoPedido, opcoesDoDia, horariosDe, retiradaNoDia, MAX_HORARIOS, MAX_AGENDA };
