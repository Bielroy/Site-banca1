'use strict';
// Pequenas contas de dinheiro e unidade usadas pelas vendas (balcão e pesagem).
const paraCentavos = (v) => Math.round(Number(v) * 100);
const paraReais = (c) => Math.round(c) / 100;
const isFracionavel = (u) => ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'].includes(String(u || '').toLowerCase());
const agoraBrasilia = () => new Date(Date.now() - 3 * 3600000);
const texto = (v, max) => String(v == null ? '' : v).normalize('NFC').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// FORMAS DE PAGAMENTO: lista fechada. São os mesmos valores que a loja (index.html, js/loja.js) e o balcão (api/pdv.js)
// mandam. Antes o pedido da loja aceitava qualquer texto ("Fiado", "pago já", um link...), que ia para o painel e o WhatsApp.
const FORMAS_PAGAMENTO = ['PIX', 'Cartão', 'Dinheiro'];
// chave de cada forma em loja/config.formasPagamento (o painel liga e desliga)
const CHAVE_DA_FORMA = { PIX: 'pix', 'Cartão': 'cartao', Dinheiro: 'dinheiro' };
/** 'pix', 'Pix', 'CARTAO', 'cartão', ' dinheiro ' → a forma certa ('PIX' | 'Cartão' | 'Dinheiro'), ou '' se não for nenhuma. */
function formaDePagamento(v) {
  if (typeof v !== 'string') return '';
  const k = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return FORMAS_PAGAMENTO.find((f) => CHAVE_DA_FORMA[f] === k) || '';
}
module.exports = { paraCentavos, paraReais, isFracionavel, agoraBrasilia, texto, FORMAS_PAGAMENTO, CHAVE_DA_FORMA, formaDePagamento };
