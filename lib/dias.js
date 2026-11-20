'use strict';
// =====================================================================
//  lib/dias.js — espelho de js/dias-lib.js para o servidor (o checkout confere
//  se cada produto sai no dia da entrega e se o pedido para amanhã vale).
//  Um teste confere que as duas contas batem.
// =====================================================================
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function limparDiasProduto(v) {
  if (!Array.isArray(v)) return null;
  const dias = [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return dias.length === 0 || dias.length === 7 ? null : dias;
}

function vendeNoDia(p, dow) {
  const dias = limparDiasProduto(p && p.dias);
  if (!dias || !Number.isInteger(dow) || dow < 0 || dow > 6) return true;
  return dias.includes(dow);
}

function textoDosDias(v) {
  const dias = limparDiasProduto(v);
  if (!dias) return 'todo dia';
  const seguidos = dias.length >= 3 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  if (seguidos) return `${NOMES_DIA[dias[0]]} a ${NOMES_DIA[dias[dias.length - 1]]}`;
  const nomes = dias.map((d) => NOMES_DIA[d]);
  return nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

function diaBR(agora = Date.now(), maisDias = 0) {
  const br = new Date(agora - 3 * 3600000);
  const d = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + maisDias));
  return { dia: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
}

/** No servidor basta a regra da loja (não precisa olhar os produtos): pedido para amanhã é aceito
 *  se a loja não desligou e amanhã é dia de abrir. */
function amanhaPermitido(config, agora = Date.now()) {
  const c = config || {};
  if (c.pedidoAmanha === false || c.lojaAberta === false) return false;
  const abertos = Array.isArray(c.diasAbertos) && c.diasAbertos.length ? c.diasAbertos : [0, 1, 2, 3, 4, 5, 6];
  return abertos.includes(diaBR(agora, 1).dow);
}

module.exports = { NOMES_DIA, limparDiasProduto, vendeNoDia, textoDosDias, diaBR, amanhaPermitido };
