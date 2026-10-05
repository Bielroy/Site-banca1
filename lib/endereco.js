'use strict';
// =====================================================================
//  lib/endereco.js — endereço do pedido em uma linha (lado do servidor).
//  Mesma regra de js/endereco.js (loja e painel). Se mudar uma, mude a outra.
//    formatoEndereco 'ql'    → "Jardins X — Quadra 5 • Lote 3"
//    formatoEndereco 'rua'   → "Jardins X — Das Alpineas, nº 12"
//    formatoEndereco 'livre' → "Outro Condomínio — <campo 1>, <campo 2>"
//  Pedido antigo (sem condomínio) sai como sempre saiu: "Quadra 5 • Lote 3".
// =====================================================================
function linhaEndereco(p) {
  if (!p) return '';
  const a = String(p.quadra || '').trim(), b = String(p.lote || '').trim();
  const f = p.formatoEndereco || 'ql';
  let resto;
  if (f === 'rua') resto = [a, b && `nº ${b}`].filter(Boolean).join(', ');
  else if (f === 'livre') resto = [a, b].filter(Boolean).join(', ');
  else resto = [a && `Quadra ${a}`, b && `Lote ${b}`].filter(Boolean).join(' • ');
  return [String(p.condominio || '').trim(), resto].filter(Boolean).join(' — ');
}
module.exports = { linhaEndereco };
