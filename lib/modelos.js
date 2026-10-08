'use strict';
// =====================================================================
//  lib/modelos.js — o que a PLATAFORMA oferece a cada loja nova.
//  MODELOS: aparência inicial por tipo de negócio. Cada um é IGUAL ao de mesmo nome em js/aparencia-lib.js
//           (um teste confere). Lá há também modelos só de estilo ("natural", "noite"), que não são tipo de negócio.
//  MODULOS: partes do sistema que a plataforma liga ou desliga por loja.
//           Desligado = some do painel E o servidor recusa.
// =====================================================================
const MODELOS = {
  hortifruti: { primaria: '#1a3a2a', secundaria: '#4a9467', destaque: '#c4773a', fundo: '#faf7f2', superficie: '#ffffff', texto: '#1a1a18', sobrePrimaria: '#ffffff', fonteTitulo: 'Fraunces', fonteTexto: 'Figtree', raio: 14, etiqueta: 'barbante' },
  espetinhos: { primaria: '#b3261e', secundaria: '#e8622c', destaque: '#f2b33d', fundo: '#141110', superficie: '#211c1a', texto: '#f4ece6', sobrePrimaria: '#ffffff', fonteTitulo: 'Oswald', fonteTexto: 'Barlow', raio: 8, etiqueta: 'limpa' },
  jantinha: { primaria: '#7a2e12', secundaria: '#c8662e', destaque: '#e0a23a', fundo: '#fbf3e7', superficie: '#fffaf2', texto: '#2a1c14', sobrePrimaria: '#fff8ef', fonteTitulo: 'Lora', fonteTexto: 'Nunito Sans', raio: 18, etiqueta: 'limpa' },
  padaria: { primaria: '#5b3a1e', secundaria: '#b9853f', destaque: '#d9a441', fundo: '#f7efe3', superficie: '#fffdf8', texto: '#2b1d10', sobrePrimaria: '#fff8ec', fonteTitulo: 'Playfair Display', fonteTexto: 'Lato', raio: 12, etiqueta: 'barbante', fundoEstilo: 'papel' },
  acai: { primaria: '#4a1650', secundaria: '#8e3a8f', destaque: '#f0b21a', fundo: '#f8f2f8', superficie: '#ffffff', texto: '#24102a', sobrePrimaria: '#ffffff', fonteTitulo: 'Baloo 2', fonteTexto: 'Poppins', raio: 20, etiqueta: 'selo', botaoFormato: 'pilula', card: 'sombra' },
  mercadinho: { primaria: '#0f4c81', secundaria: '#2f8fd8', destaque: '#f2a516', fundo: '#f2f6fa', superficie: '#ffffff', texto: '#14212e', sobrePrimaria: '#ffffff', fonteTitulo: 'Montserrat', fonteTexto: 'Inter', raio: 10, etiqueta: 'selo', botaoFormato: 'arredondado', card: 'borda', borda: 'reta' },
  doceria: { primaria: '#c2416b', secundaria: '#e88aa8', destaque: '#7a3b2e', fundo: '#fdf3f5', superficie: '#ffffff', texto: '#3a1a24', sobrePrimaria: '#ffffff', fonteTitulo: 'Pacifico', fonteTexto: 'Nunito Sans', raio: 22, etiqueta: 'limpa', card: 'sombra', fundoEstilo: 'pontos', borda: 'onda' },
};
const MODULOS = {
  pdv: 'Balcão', estoque: 'Estoque e compras', crm: 'Clientes', copiloto: 'Copiloto',
  calendario: 'Calendário', cupons: 'Cupons', ia: 'Ajudante de IA na loja',
};
module.exports = { MODELOS, MODULOS };
