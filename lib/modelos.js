'use strict';
// =====================================================================
//  lib/modelos.js — o que a PLATAFORMA oferece a cada loja nova.
//  MODELOS: aparência inicial por tipo de negócio (a mesma lista de js/tema.js;
//           um teste confere que as duas não se afastam).
//  MODULOS: partes do sistema que a plataforma liga ou desliga por loja.
//           Desligado = some do painel E o servidor recusa.
// =====================================================================
const MODELOS = {
  hortifruti: { primaria: '#1a3a2a', secundaria: '#4a9467', destaque: '#c4773a', fundo: '#faf7f2', superficie: '#ffffff', texto: '#1a1a18', sobrePrimaria: '#ffffff', fonteTitulo: 'Fraunces', fonteTexto: 'Figtree', raio: 14, etiqueta: 'barbante' },
  espetinhos: { primaria: '#b3261e', secundaria: '#e8622c', destaque: '#f2b33d', fundo: '#141110', superficie: '#211c1a', texto: '#f4ece6', sobrePrimaria: '#ffffff', fonteTitulo: 'Oswald', fonteTexto: 'Barlow', raio: 8, etiqueta: 'limpa' },
  jantinha: { primaria: '#7a2e12', secundaria: '#c8662e', destaque: '#e0a23a', fundo: '#fbf3e7', superficie: '#fffaf2', texto: '#2a1c14', sobrePrimaria: '#fff8ef', fonteTitulo: 'Lora', fonteTexto: 'Nunito Sans', raio: 18, etiqueta: 'limpa' },
};
const MODULOS = {
  pdv: 'Balcão', estoque: 'Estoque e compras', crm: 'Clientes', copiloto: 'Copiloto',
  calendario: 'Calendário', cupons: 'Cupons', ia: 'Ajudante de IA na loja',
};
module.exports = { MODELOS, MODULOS };
