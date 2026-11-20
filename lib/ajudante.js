'use strict';
// =====================================================================
//  lib/ajudante.js — QUEM o Ajudante (chat da loja) é em cada loja.
//
//  O Ajudante nasceu para a Banca (hortifruti: receitas e ingredientes).
//  Numa pastelaria ele ajuda a escolher sabores e a MONTAR o pastel; num
//  espetinho, a calcular para quantas pessoas; numa padaria, café e festa.
//  O tipo vem do campo "tipo" da ficha (o mesmo que escolhe o desenho do
//  cabeçalho, lib/artes.js). Os textos da TELA ficam em js/ajudante-lib.js,
//  com o mesmo mapa de GRUPOS (um teste confere).
// =====================================================================
const { arteDoTipo } = require('./artes');
const Montar = require('./montar');
const { TENANT_PADRAO } = require('./tenant');

const NOME_PADRAO = 'Banca Adair e Pedrina';

/** Desenho do tipo de loja → jeito de atender. O que não está aqui é 'geral'. */
const GRUPOS = {
  caixote: 'horti', queijo: 'horti',
  pastel: 'montar', pastelacai: 'montar', tigela: 'montar', crepe: 'montar', burger: 'montar', hotdog: 'montar', pizza: 'montar',
  espeto: 'refeicao', prato: 'refeicao', macarrao: 'refeicao', pamonha: 'refeicao',
  pao: 'doce', bolo: 'doce', doce: 'doce',
  copo: 'bebida', cana: 'bebida',
};

const PERFIS = {
  horti: {
    negocio: 'um hortifruti de bairro que entrega em condomínios',
    papel: 'o assistente de receitas e compras da loja',
    foco: 'Ajude a escolher frutas, verduras e legumes, sugira receitas com o que a loja tem hoje e diga quanto levar.',
    assunto: 'comida, receitas e os produtos acima',
  },
  montar: {
    negocio: 'uma loja de comida feita na hora',
    papel: 'o atendente que ajuda o cliente a escolher e a montar o pedido',
    foco: 'Ajude a escolher sabores e combinações, a montar cada item com as opções que a loja oferece e a calcular quanto pedir para quantas pessoas.',
    assunto: 'os produtos e o pedido desta loja',
  },
  refeicao: {
    negocio: 'uma loja de comida pronta',
    papel: 'o atendente que ajuda o cliente a escolher a refeição',
    foco: 'Ajude a escolher pratos e porções, a calcular quanto pedir para quantas pessoas e a combinar acompanhamentos e bebidas do catálogo.',
    assunto: 'os produtos e o pedido desta loja',
  },
  doce: {
    negocio: 'uma loja de pães, bolos e doces',
    papel: 'o atendente que ajuda o cliente a escolher',
    foco: 'Ajude a escolher para café da manhã, lanche, festa ou presente, e a calcular quanto levar para quantas pessoas.',
    assunto: 'os produtos e o pedido desta loja',
  },
  bebida: {
    negocio: 'uma loja de bebidas',
    papel: 'o atendente que ajuda o cliente a escolher',
    foco: 'Ajude a escolher bebidas e combinações do catálogo e a calcular quanto levar para quantas pessoas.',
    assunto: 'os produtos e o pedido desta loja',
  },
  geral: {
    negocio: 'uma loja de bairro que entrega em condomínios',
    papel: 'o atendente que ajuda o cliente a achar e escolher produtos',
    foco: 'Ajude a achar o que o cliente procura no catálogo e a montar o pedido.',
    assunto: 'os produtos e o pedido desta loja',
  },
};

// Tudo o que vem da ficha entra no texto da IA como DADO curto, de uma linha, sem aspas.
const curto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').replace(/["`<>]/g, "'").replace(/\s+/g, ' ').trim().slice(0, max);

/** O grupo de atendimento desta loja ('horti', 'montar', 'refeicao', 'doce', 'bebida', 'geral'). */
function grupoDaLoja(tid, ficha) {
  if (tid === TENANT_PADRAO) return 'horti';
  return GRUPOS[arteDoTipo(ficha && ficha.tipo)] || 'geral';
}

/** Perfil completo: nome da loja, grupo e os textos que vão para a IA. */
function perfilDaLoja(tid, ficha) {
  const f = ficha && typeof ficha === 'object' ? ficha : {};
  const grupo = grupoDaLoja(tid, f);
  const nome = curto(f.nome, 60) || (tid === TENANT_PADRAO ? NOME_PADRAO : curto(tid, 40));
  const tipo = tid === TENANT_PADRAO ? '' : curto(f.tipo, 60);
  const sub = tid === TENANT_PADRAO ? '' : curto(f.subtitulo, 100);
  return { grupo, nome, tipo, sub, ...PERFIS[grupo] };
}

/** Voz de quem escreve: a base de todos os textos da IA (chat e painel). */
function vozDe(perfil) {
  const p = perfil || perfilDaLoja(TENANT_PADRAO, {});
  const extra = [p.tipo && `Tipo de negócio informado pela loja: ${p.tipo}.`, p.sub && `Como a loja se apresenta: ${p.sub}.`].filter(Boolean).join(' ');
  return `Você escreve para "${p.nome}", ${p.negocio}.${extra ? ' ' + extra : ''}
Tom caloroso, simples e brasileiro, sem palavra difícil nem exagero de propaganda. Nunca invente promoção, prazo de entrega
ou selo de qualidade que não foi informado.`;
}

// ---------------------------------------------------------------------
// MONTAR no catálogo da IA: cada grupo com a regra e as opções à venda, por id.
// ---------------------------------------------------------------------
const reais = (v) => `R$${(Number(v) || 0).toFixed(2)}`;
function regraDoGrupo(g) {
  let r = g.min >= 1 && g.max === 1 ? 'escolha 1, obrigatório'
    : g.max === 1 ? 'opcional, até 1'
    : g.min >= 1 ? `escolha de ${g.min} a ${g.max}` : `opcional, até ${g.max}`;
  if (g.gratis > 0) r += `, ${g.gratis} sem custo`;
  return r;
}
/** "monte: sabor[Sabor](escolha 1, obrigatório): carne=Carne; queijo=Queijo +R$2.00 | ..." ou '' (produto sem montar). */
function linhaMontar(produto) {
  const m = Montar.montarDoProduto(produto);
  if (!m) return '';
  const grupos = m.grupos.map((g) => {
    const ops = g.opcoes.filter((o) => o.ativo).map((o) => `${o.id}=${curto(o.nome, 40)}${o.preco > 0 ? ' +' + reais(o.preco) : ''}`);
    return ops.length ? `${g.id}[${curto(g.nome, 40)}](${regraDoGrupo(g)}): ${ops.join('; ')}` : '';
  }).filter(Boolean);
  if (!grupos.length) return '';
  const linha = `monte: ${grupos.join(' | ')}`;
  return linha.length > 900 ? linha.slice(0, 897) + '...' : linha;
}

/** Regras extras do chat quando o catálogo tem produto de montar. */
const REGRAS_MONTAR = `- Produtos com a linha "monte:" logo abaixo são montados pelo cliente. Cada grupo aparece como
  idDoGrupo[Nome](regra): idDaOpcao=Nome +acréscimo. Respeite a regra de cada grupo (obrigatório, até quantas)
  e use só as opções listadas. Ajude o cliente a decidir a combinação e diga o preço base do produto; não
  calcule o total exato de um montado, porque o valor final aparece na tela de montar.
- Quando o cliente decidir como quer um produto montado, escreva no fim uma linha no formato exato
  [MONTAR:idDoProduto|idDoGrupo=idDaOpcao,idDaOpcao|idDoGrupo=idDaOpcao] com os ids copiados do catálogo,
  sem acento, sem aspas e sem negrito. No máximo 2 linhas MONTAR por resposta. O cliente confere tudo
  na tela de montar antes de pôr na sacola.`;

module.exports = { GRUPOS, PERFIS, TENANT_PADRAO, grupoDaLoja, perfilDaLoja, vozDe, linhaMontar, REGRAS_MONTAR };
