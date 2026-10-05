'use strict';
// Pequenas contas de dinheiro e unidade usadas pelas vendas (balcão e pesagem).
const paraCentavos = (v) => Math.round(Number(v) * 100);
const paraReais = (c) => Math.round(c) / 100;
const isFracionavel = (u) => ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'].includes(String(u || '').toLowerCase());
const agoraBrasilia = () => new Date(Date.now() - 3 * 3600000);
const texto = (v, max) => String(v == null ? '' : v).normalize('NFC').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
module.exports = { paraCentavos, paraReais, isFracionavel, agoraBrasilia, texto };
