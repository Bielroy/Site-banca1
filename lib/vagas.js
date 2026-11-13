'use strict';
// =====================================================================
//  lib/vagas.js — VAGAS POR HORÁRIO e ANTECEDÊNCIA, lado do servidor. Mesma conta de js/vagas-lib.js (ver lá).
//  O checkout lê {loja}/vagas/{dia} DENTRO da transação, recusa horário lotado ou que já fechou para hoje e soma +1;
//  o cancelamento devolve a vaga (pedido.entrega.vaga = chave contada).
// =====================================================================
const MAX_VAGAS = 500, MAX_ANTECEDENCIA = 1440;
function inicioMin(texto) {
  const m = String(texto || '').match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i);
  if (!m) return -1;
  const h = Number(m[1]), mi = Number(m[2] || 0);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? h * 60 + mi : -1;
}
const chaveHorario = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'sem-nome';
function lerVagas(entrega) {
  const e = entrega || {}, inteiro = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  return { vagas: inteiro(e.vagas, MAX_VAGAS), antecedenciaMin: inteiro(e.antecedenciaMin, MAX_ANTECEDENCIA) };
}
function estadoDoHorario({ horario, vagas = 0, usados = 0, paraHoje = false, agoraMin = 0, antecedenciaMin = 0 }) {
  const restam = vagas > 0 ? Math.max(0, vagas - (Number(usados) || 0)) : null;
  const lotado = vagas > 0 && restam === 0;
  const ini = inicioMin(horario);
  const fechado = !!paraHoje && antecedenciaMin > 0 && ini >= 0 && agoraMin + antecedenciaMin > ini;   // sem antecedência: não fecha por hora (como antes)
  return { ok: !lotado && !fechado, lotado, fechado, restam };
}
const agoraMinBR = (agora = Date.now()) => { const d = new Date(agora - 3 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
/** Mensagem para o cliente quando o horário não serve. */
const motivo = (e, horario) => (e.lotado ? `O horário "${horario}" lotou. Escolha outro horário e envie de novo.` : `O horário "${horario}" já fechou para hoje. Escolha outro horário e envie de novo.`);
module.exports = { MAX_VAGAS, MAX_ANTECEDENCIA, inicioMin, chaveHorario, lerVagas, estadoDoHorario, agoraMinBR, motivo };
