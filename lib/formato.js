'use strict';
// =====================================================================
//  lib/formato.js — FORMATO DA LOJA no servidor (mesmas regras de js/formato-lib.js; um teste confere).
//    'loja'    (ou sem campo)  carrinho e pedidos, como sempre.
//    'vitrine'                 só catálogo: o checkout recusa pedido.
// =====================================================================
const FORMATOS = ['loja', 'whatsapp', 'vitrine'];   // mesma ordem de js/formato-lib.js (a plataforma mostra nesta ordem)
const formatoDaFicha = (ficha) => (ficha && (ficha.formato === 'vitrine' || ficha.formato === 'whatsapp') ? ficha.formato : 'loja');
const ehVitrine = (ficha) => formatoDaFicha(ficha) === 'vitrine';
const formatoValido = (v) => FORMATOS.includes(v);
const MSG_VITRINE = 'Esta loja mostra só o catálogo. Faça o seu pedido pelo WhatsApp da loja.';
/** Sacola no WhatsApp: o pedido é fechado só no WhatsApp do dono, nunca pelo site. */
const semPedidoNoSite = (ficha) => ['vitrine', 'whatsapp'].includes(formatoDaFicha(ficha));
const MSG_WHATSAPP = 'Nesta loja o pedido é enviado pelo WhatsApp. Toque em "Finalizar no WhatsApp".';

module.exports = { FORMATOS, formatoDaFicha, ehVitrine, formatoValido, semPedidoNoSite, MSG_VITRINE, MSG_WHATSAPP };
