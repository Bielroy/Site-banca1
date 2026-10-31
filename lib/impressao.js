'use strict';
// =====================================================================
//  lib/impressao.js — a FILA DE IMPRESSÃO de cada pedido (quem imprime, e se já imprimiu).
//
//  O cupom em si é montado no aparelho (ele tem os dados do cliente abertos; o banco
//  guarda cifrado). Aqui fica só o "estado" no pedido, campo `impressao`:
//      { saiu, saiuEm, vezes,                       ← o que já saiu no papel
//        versao, estado, em, aparelho }             ← a última tentativa
//      estado: 'reservado' (um aparelho vai imprimir) | 'impresso' | 'falhou'
//
//  VERSÃO = qual papel:
//      inicial    o cupom do pedido
//      pesado     o cupom de novo, depois da balança (valor certo)
//      cancelado  o aviso "PEDIDO CANCELADO" de um pedido que já tinha saído no papel
//  Uma versão nunca sai duas vezes sozinha, e uma versão "menor" não sai depois de uma maior.
//
//  Para dois aparelhos não imprimirem o mesmo pedido, quem vai imprimir RESERVA primeiro.
//  Reserva que não foi confirmada em RESERVA_MS (o aparelho caiu no meio) pode ser tomada.
// =====================================================================
const VERSOES = ['inicial', 'pesado', 'cancelado'];
const RESERVA_MS = 90 * 1000;
const nivel = (v) => VERSOES.indexOf(v);
const aparelhoOk = (a) => typeof a === 'string' && /^[\w-]{6,40}$/.test(a);
const obj = (x) => (x && typeof x === 'object' ? x : {});
const maior = (a, b) => (nivel(a) >= nivel(b) ? a : b);

/**
 * Pode reservar `versao` para `aparelho` agora?
 * Devolve { ok: true, novo } (novo = o campo `impressao` a gravar) ou { ok: false, motivo }.
 * motivo: 'ja' (já saiu esta versão ou uma maior) | 'outro' (outro aparelho está imprimindo agora).
 */
function decidirReserva(atual, versao, aparelho, agora = Date.now()) {
  const a = obj(atual);
  if (a.saiu && nivel(a.saiu) >= nivel(versao)) return { ok: false, motivo: 'ja' };
  const recente = agora - (Date.parse(a.em) || 0) < RESERVA_MS;
  if (a.estado === 'reservado' && a.aparelho !== aparelho && recente && nivel(a.versao) >= nivel(versao)) return { ok: false, motivo: 'outro' };
  return { ok: true, novo: { ...a, versao, estado: 'reservado', em: new Date(agora).toISOString(), aparelho } };
}

/** O papel saiu: grava como impresso. Vale também para impressão feita à mão (sem reserva). */
function confirmar(atual, versao, aparelho, agora = Date.now()) {
  const a = obj(atual), em = new Date(agora).toISOString();
  return { ...a, saiu: a.saiu ? maior(a.saiu, versao) : versao, saiuEm: em, vezes: (Number(a.vezes) || 0) + 1, versao, estado: 'impresso', em, aparelho };
}

/** Não saiu (impressora desligada, sem papel...): solta a reserva para tentar de novo. Só quem reservou solta. */
function liberar(atual, aparelho, agora = Date.now()) {
  const a = obj(atual);
  if (a.estado !== 'reservado' || a.aparelho !== aparelho) return null;          // nada a fazer
  return { ...a, estado: 'falhou', em: new Date(agora).toISOString() };
}

module.exports = { VERSOES, RESERVA_MS, nivel, aparelhoOk, decidirReserva, confirmar, liberar };
