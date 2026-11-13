'use strict';
// =====================================================================
//  lib/ajuste.js — MEXER NUM PEDIDO DEPOIS QUE ELE CHEGOU (contas puras, sem banco).
//
//  A equipe pode, pelo painel (api/pdv.js → acao 'ajuste'):
//    tirar        um item que faltou (o estoque baixado por ele volta);
//    acrescentar  um item que o cliente pediu depois, pelo WhatsApp;
//    voltar       o pedido uma etapa (Entregue → A caminho → Separando → Novo);
//    precos       pedido feito para outro dia: passa a valer o preço de hoje do cadastro.
//
//  Tirar e acrescentar só valem ANTES de o pedido sair para entrega. Quem faz a conta é o
//  servidor, com o preço do cadastro: o navegador só diz QUAL item.
//  A conta do total é a mesma da pesagem (cupom em % vale sobre tudo; a entrega grátis
//  acima de um valor é reavaliada).
// =====================================================================
const V = require('./venda');
const E = require('./estoque');

/** Etapas em que ainda dá para tirar ou acrescentar item. Depois de "saiu para entrega", não. */
const PODE_MEXER = ['pendente', 'aguardando_pesagem', 'aguardando_pagamento', 'preparando'];
const MAX_REGISTROS = 40;

const pago = (ped) => !!(ped && ped.pagamento && ped.pagamento.status === 'PAID');

/** Por que este pedido não pode ter item tirado/acrescentado ('' = pode). */
function travaDeItens(ped) {
  if (!ped) return 'Pedido não encontrado.';
  if (ped.status === 'cancelado') return 'Este pedido foi cancelado.';
  if (ped.origem === 'balcao') return 'Venda de balcão já foi fechada na hora: não dá para mudar os itens.';
  if (!PODE_MEXER.includes(ped.status)) return 'Este pedido já saiu para entrega: os itens não mudam mais.';
  return '';
}

/** Para qual etapa o pedido volta ('' = não tem para onde voltar). */
function etapaAnterior(ped) {
  if (!ped || ped.status === 'cancelado' || ped.origem === 'balcao') return '';
  if (ped.status === 'arquivado') return 'enviado';
  if (ped.status === 'enviado') return 'preparando';
  if (ped.status === 'preparando') return (ped.itens || []).some((i) => i && i.aPesar) ? 'aguardando_pesagem' : 'pendente';
  return '';
}

/** Valor de um item em centavos (item ainda "a pesar" vale zero até a balança). */
const centavosDoItem = (i) => (i && !i.aPesar ? V.paraCentavos(Number(i.subtotal) || (Number(i.preco ?? i.precoOriginal) || 0) * (Number(i.qtd) || 0)) : 0);

/**
 * Fecha a conta do pedido com a lista de itens dada. Mesma regra da pesagem (api/pdv.js):
 *   cupom em %  → vale sobre a soma nova; cupom em reais → o valor dado no pedido, sem passar da soma;
 *   entrega     → a taxa cheia do pedido, que sai se a soma passou do valor de entrega grátis (ou cupom de 100%).
 * Devolve { total, itensC, descC, taxaC, cupom, entrega } (cupom/entrega já com os valores novos, ou null).
 */
function contaDoPedido(ped, itens) {
  const somaC = (itens || []).reduce((t, i) => t + centavosDoItem(i), 0);
  const cup = ped && ped.cupom ? ped.cupom : null;
  const pct = cup ? Math.min(100, Number(cup.percentual) || 0) : 0;
  const descC = Math.min(somaC, pct > 0 ? Math.round(somaC * pct / 100) : (cup && Number(cup.desconto) > 0 ? V.paraCentavos(cup.desconto) : 0));
  const ent = ped && ped.entrega ? ped.entrega : null, itensC = Math.max(0, somaC - descC);
  const cheiaC = ent ? V.paraCentavos(Number(ent.taxaCheia) || 0) : 0, gratisC = ent ? V.paraCentavos(Number(ent.gratisAcima) || 0) : 0;
  const taxaC = pct >= 100 ? 0 : (cheiaC > 0 && !(gratisC > 0 && itensC >= gratisC) ? cheiaC : 0);
  return {
    total: V.paraReais(itensC + taxaC), itensC, descC, taxaC,
    cupom: cup ? { ...cup, desconto: V.paraReais(descC) } : null,
    entrega: ent ? { ...ent, taxa: V.paraReais(taxaC) } : null,
  };
}

/** Quanto de estoque este item baixou (e precisa voltar se ele sair do pedido). Mesma regra do cancelamento. */
function estoqueDoItem(i) {
  if (!i || !i.id) return 0;
  const q = Number(i.pesoBaixado) > 0 ? Number(i.pesoBaixado) : (i.aPesar ? 0 : Number(i.qtd));
  return Number.isFinite(q) && q > 0 ? E.fix(q) : 0;
}

/** Texto curto da quantidade, para o registro e a mensagem ("2 un", "1,5 kg"). */
function qtdEscrita(i) {
  if (!i) return '';
  if (Number(i.pesoFinal) > 0) return `${String(i.pesoFinal).replace('.', ',')} kg`;
  const un = String(i.tipo === 'kg' ? (i.unidade || 'kg') : 'un').toLowerCase();
  return `${String(i.qtd).replace('.', ',')} ${un}`;
}

/**
 * Tira o item `indice`. Não deixa o pedido vazio (aí é cancelar o pedido).
 * Devolve { itens, tirado, devolver: { produtoId, qtd } | null, conta, registro }.
 */
function tirarItem(ped, indice, { motivo = '', por = '', agora = new Date() } = {}) {
  const trava = travaDeItens(ped); if (trava) throw new Error(trava);
  const itens = (ped.itens || []).map((i) => ({ ...i })), idx = Number(indice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= itens.length) throw new Error('Este item não está mais no pedido. Atualize a tela.');
  if (itens.length === 1) throw new Error('Este é o único item do pedido. Para tirar tudo, cancele o pedido.');
  const [tirado] = itens.splice(idx, 1);
  const q = estoqueDoItem(tirado);
  return {
    itens, tirado, devolver: q > 0 ? { produtoId: String(tirado.id), qtd: q } : null,
    conta: contaDoPedido(ped, itens),
    registro: { op: 'tirou', nome: String(tirado.nome || ''), qtd: qtdEscrita(tirado), valor: V.paraReais(centavosDoItem(tirado)), motivo: V.texto(motivo, 120), por: String(por || ''), em: agora.toISOString() },
  };
}

/**
 * Monta a linha de um item acrescentado, com o cadastro do produto e o preço do dia já resolvido.
 *   pedido = { qtd, tipo: 'kg' | 'un' };  produto = cadastro;  preco = preço do dia da entrega
 * Por quilo com peso escrito = valor fechado; por quilo pedido em unidades = "a pesar"; por unidade = preço × qtd.
 */
function linhaNova(id, produto, pedido, preco) {
  const p = produto || {}, frac = V.isFracionavel(p.unidade);
  if (p.soInsumo === true) throw new Error(`"${p.nome}" não está à venda.`);
  if (!(Number(preco) > 0) || Number(preco) > 100000) throw new Error(`"${p.nome}" está sem preço de venda.`);
  let qtd = Number(String(pedido && pedido.qtd).replace(',', '.'));
  if (!Number.isFinite(qtd) || qtd <= 0 || qtd > 10000) throw new Error(`Quantidade inválida para "${p.nome}".`);
  const base = { id: String(id), nome: p.nome, cat: p.cat || '', preco: Number(preco), precoOriginal: Number(preco), unidade: p.unidade || 'un', acrescentado: true };
  if (pedido.tipo === 'kg') {
    if (!frac) throw new Error(`"${p.nome}" é vendido por ${p.unidade || 'unidade'}, não por quilo.`);
    qtd = E.fix(qtd);
    return { linha: { ...base, qtd, tipo: 'kg', aPesar: false, subtotal: V.paraReais(Math.round(V.paraCentavos(preco) * qtd)) }, baixa: qtd };
  }
  if (Math.abs(qtd - Math.round(qtd)) > 1e-9) throw new Error(`"${p.nome}": em unidades a quantidade é inteira.`);
  qtd = Math.round(qtd);
  if (frac) return { linha: { ...base, qtd, tipo: 'un', aPesar: true, subtotal: 0 }, baixa: 0 };       // vai à balança
  return { linha: { ...base, qtd, tipo: 'un', aPesar: false, subtotal: V.paraReais(Math.round(V.paraCentavos(preco) * qtd)) }, baixa: qtd };
}

/**
 * Acrescenta a linha ao pedido. Se o item novo vai à balança, o pedido volta para "a pesar"
 * (os pesos já lançados continuam valendo).
 */
function acrescentarItem(ped, linha, { por = '', agora = new Date() } = {}) {
  const trava = travaDeItens(ped); if (trava) throw new Error(trava);
  const itens = (ped.itens || []).map((i) => ({ ...i }));
  if (itens.length >= 120) throw new Error('Este pedido já tem itens demais.');
  itens.push({ ...linha });
  const temItensAPesar = itens.some((i) => i.aPesar);
  return {
    itens, temItensAPesar, conta: contaDoPedido(ped, itens),
    status: linha.aPesar && ped.status === 'preparando' ? 'aguardando_pesagem' : ped.status,
    registro: { op: 'acrescentou', nome: String(linha.nome || ''), qtd: qtdEscrita(linha), valor: Number(linha.subtotal) || 0, aPesar: !!linha.aPesar, por: String(por || ''), em: agora.toISOString() },
  };
}

/**
 * PEDIDO PARA OUTRO DIA (feito antes da feira): os valores gravados são os do dia em que o cliente pediu.
 * No dia, a banca confirma o preço: cada item passa a valer o preço de HOJE do cadastro (`precoDe(id)`).
 * Ficam como estão: item de promoção por quantidade, item montado (com adicionais), item sem cadastro ou sem preço.
 * Devolve { itens, mudou: [{ nome, de, para }], conta, registro }.
 */
function reprecificar(ped, precoDe, { por = '', agora = new Date() } = {}) {
  const trava = travaDeItens(ped); if (trava) throw new Error(trava);
  if (pago(ped)) throw new Error('Este pedido já foi pago pelo valor combinado: o preço não muda mais.');
  const mudou = [];
  const itens = (ped.itens || []).map((i) => {
    const novo = i && i.id && !i.promo && !i.adicionais && !i.kit ? Number(precoDe(String(i.id))) : NaN;
    const antes = Number(i && (i.precoOriginal ?? i.preco)) || 0;
    if (!(novo > 0) || novo > 100000 || Math.abs(novo - antes) < 0.005) return { ...i };
    const x = { ...i, preco: novo, precoOriginal: novo };
    if (!i.aPesar) {
      const base = Number(i.pesoFinal) > 0 && i.tipo === 'un' && V.isFracionavel(i.unidade) ? Number(i.pesoFinal) : Number(i.qtd) || 0;
      x.subtotal = V.paraReais(Math.round(V.paraCentavos(novo) * base));
    }
    mudou.push({ nome: String(i.nome || ''), de: antes, para: novo });
    return x;
  });
  return { itens, mudou, conta: contaDoPedido(ped, itens),
    registro: { op: 'precos', n: mudou.length, por: String(por || ''), em: agora.toISOString() } };
}

/** Junta um registro novo aos do pedido (os mais antigos saem quando passa do teto). */
const comRegistro = (ped, registro) => [...(Array.isArray(ped && ped.ajustes) ? ped.ajustes : []), registro].slice(-MAX_REGISTROS);

/**
 * Pedido já PAGO que mudou de valor: quanto falta cobrar (positivo) ou devolver (negativo), em reais.
 * Pedido não pago: 0 (o total novo é o que o cliente vai pagar).
 */
function diferencaDoPago(ped, totalNovo) {
  if (!pago(ped)) return 0;
  const pagoC = Number.isFinite(Number(ped.pagamento.valorC)) ? Number(ped.pagamento.valorC) : V.paraCentavos(Number(ped.total) || 0);
  return V.paraReais(V.paraCentavos(totalNovo) - pagoC);
}

module.exports = { PODE_MEXER, travaDeItens, etapaAnterior, contaDoPedido, estoqueDoItem, tirarItem, linhaNova, acrescentarItem, reprecificar, comRegistro, diferencaDoPago, qtdEscrita, pago };
