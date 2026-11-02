'use strict';
// =====================================================================
//  lib/formato.js — FORMATO DA LOJA no servidor (mesmas regras de js/formato-lib.js; um teste confere).
//    'loja'    (ou sem campo)  carrinho e pedidos, como sempre.
//    'vitrine'                 só catálogo: o checkout recusa pedido.
// =====================================================================
const FORMATOS = ['loja', 'vitrine'];
const formatoDaFicha = (ficha) => (ficha && ficha.formato === 'vitrine' ? 'vitrine' : 'loja');
const ehVitrine = (ficha) => formatoDaFicha(ficha) === 'vitrine';
const formatoValido = (v) => FORMATOS.includes(v);
const MSG_VITRINE = 'Esta loja mostra só o catálogo. Faça o seu pedido pelo WhatsApp da loja.';

module.exports = { FORMATOS, formatoDaFicha, ehVitrine, formatoValido, MSG_VITRINE };
