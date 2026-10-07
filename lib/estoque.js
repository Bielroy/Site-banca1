'use strict';
// =====================================================================
//  lib/estoque.js — MOVIMENTAÇÕES DE ESTOQUE (lado do servidor)
//
//  Toda mudança de estoque vira um registro em estoque_mov/{id}:
//    { produtoId, nome, tipo, qtd (com sinal), saldo (depois), motivo, obs,
//      custoUnit, valor, pedidoId, por, em }
//  Assim dá para responder "por que o tomate está com 11 kg?" olhando o histórico.
//
//  Quem grava é SEMPRE o servidor, na mesma transação que muda o produto:
//    venda         → api/checkout.js
//    cancelamento  → api/cancelar-pedido.js
//    o resto       → api/estoque.js (entrada, compra, perda, saída, contagem)
// =====================================================================
const T = require('./tenant');

const fix = (n) => Math.round(n * 1000) / 1000;
const TIPOS_MANUAIS = ['entrada', 'compra', 'perda', 'saida', 'ajuste'];
const MOTIVOS_PERDA = ['vencimento', 'maturacao', 'dano', 'producao', 'erro', 'devolucao', 'outro'];
const temControle = (v) => v !== null && v !== undefined && v !== '';

/**
 * Conta pura: dado o estoque atual e o que a pessoa informou, devolve
 * { delta, novo } ou lança erro com frase para a tela.
 *   entrada/compra → soma `qtd`          perda/saida → tira `qtd`
 *   ajuste         → `contagem` é o que tem de verdade na banca (o sistema calcula a diferença)
 */
function calcularMovimento({ atual, tipo, qtd, contagem }) {
  if (!TIPOS_MANUAIS.includes(tipo)) throw new Error('Tipo de movimentação inválido.');
  const base = temControle(atual) ? Number(atual) : 0;
  let delta;
  if (tipo === 'ajuste') {
    const c = Number(contagem);
    if (!Number.isFinite(c) || c < 0 || c > 1e6) throw new Error('Informe quanto tem de verdade (zero ou mais).');
    delta = fix(c - base);
  } else {
    const q = Number(qtd);
    if (!Number.isFinite(q) || q <= 0 || q > 1e6) throw new Error('Informe uma quantidade maior que zero.');
    delta = tipo === 'entrada' || tipo === 'compra' ? fix(q) : -fix(q);
  }
  const novo = fix(base + delta);
  if (novo < 0) throw new Error(`Não dá para tirar mais do que tem (estoque atual: ${String(base).replace('.', ',')}).`);
  return { delta, novo };
}

/** Grava o registro da movimentação dentro de uma transação já aberta. */
function registrarMov(t, db, tid, m) {
  const ref = m.chave ? T.tdoc(db, tid, 'estoque_mov', m.chave) : T.tcol(db, tid, 'estoque_mov').doc();
  const custoUnit = Number.isFinite(Number(m.custoUnit)) && Number(m.custoUnit) > 0 ? Number(m.custoUnit) : null;
  t.set(ref, {
    produtoId: String(m.produtoId), nome: String(m.nome || ''), unidade: String(m.unidade || ''),
    tipo: m.tipo, qtd: fix(m.delta), saldo: fix(m.saldo),
    motivo: m.motivo || '', obs: m.obs || '',
    custoUnit, valor: custoUnit ? Math.round(Math.abs(m.delta) * custoUnit * 100) / 100 : null,
    pedidoId: m.pedidoId || '', por: m.por || 'sistema', em: new Date().toISOString(),
  });
  return ref;
}

// ---------------------------------------------------------------------
// RESUMO DO MÊS — estoque_resumo/{AAAA-MM} = { p: { [produtoId]: { entrou, perdeu, perdeuValor, vendeu, usou, ajuste } } }
// Atualizado junto com cada movimentação. Serve para calcular o desperdício
// ("o tomate perde 8,7% do que entra") lendo 2 documentos em vez de centenas.
// ---------------------------------------------------------------------
const mesBrasilia = (agora = Date.now()) => new Date(agora - 3 * 3600000).toISOString().slice(0, 7);
function parcelaDoResumo(m) {
  const q = Math.abs(m.delta), custo = Number(m.custoUnit) > 0 ? Number(m.custoUnit) : 0;
  if (m.tipo === 'perda') return { perdeu: q, perdeuValor: Math.round(q * custo * 100) / 100 };
  if (m.tipo === 'venda') return { vendeu: q };
  if (m.tipo === 'cancelamento') return { vendeu: -q };
  if (m.tipo === 'ajuste') return { ajuste: m.delta };
  if (m.delta > 0) return { entrou: q };                 // compra, entrada, produção (o que foi produzido)
  return { usou: q };                                    // saída, produção (ingrediente consumido)
}

/** Grava VÁRIAS movimentações e atualiza o resumo do mês com uma escrita só. */
function registrarMovs(t, db, tid, lista, FieldValue) {
  if (!lista.length) return;
  const porProduto = {};
  for (const m of lista) {
    registrarMov(t, db, tid, m);
    const alvo = (porProduto[String(m.produtoId)] = porProduto[String(m.produtoId)] || {});
    for (const [k, v] of Object.entries(parcelaDoResumo(m))) alvo[k] = fix((alvo[k] || 0) + v);
  }
  const p = {};
  for (const [id, campos] of Object.entries(porProduto)) { p[id] = {}; for (const [k, v] of Object.entries(campos)) p[id][k] = FieldValue.increment(v); }
  t.set(T.tdoc(db, tid, 'estoque_resumo', mesBrasilia()), { mes: mesBrasilia(), p }, { merge: true });
}

// ---------------------------------------------------------------------
// FICHA TÉCNICA — produto.ficha = { rende, validadeDias, itens: [{ id, qtd }] }
//   rende = quantas unidades UMA receita faz · qtd = na unidade de estoque do ingrediente
// Mesma conta de js/estoque-lib.js (custoDaFicha). Se mudar uma, mude a outra.
// ---------------------------------------------------------------------
function custoDaFicha(ficha, produtos) {
  const rende = Number(ficha && ficha.rende), itens = (ficha && ficha.itens) || [];
  if (!(rende > 0) || !itens.length) return { valida: false };
  let total = 0, semCusto = 0;
  const linhas = itens.map((i) => {
    const p = produtos.get(String(i.id)) || null, qtd = Number(i.qtd), custo = p && Number(p.custo) > 0 ? Number(p.custo) : null;
    if (custo === null) semCusto++; else total += qtd * custo;
    return { id: String(i.id), nome: p ? p.nome : '(produto apagado)', unidade: p ? p.unidade : '', qtd, custo, existe: !!p };
  });
  if (linhas.some((l) => !(l.qtd > 0) || !l.existe)) return { valida: false, linhas };
  total = Math.round(total * 100) / 100;
  return { valida: true, rende, linhas, total, porUnidade: Math.round((total / rende) * 100) / 100, completo: semCusto === 0, semCusto };
}

// ---------------------------------------------------------------------
// O produto fica à venda depois deste movimento?
//   • estoque chegou a zero            → sai da loja (esgotou)
//   • estava ZERADO e entrou estoque   → volta para a loja (o esgotado automático se desfaz)
//   • nos outros casos                 → fica como estava. Quem tocou em "Tirar da loja" com
//     estoque na prateleira continua fora, mesmo vendendo no balcão ou lançando uma perda.
// (Antes era sempre "tem estoque = à venda", e qualquer movimento desfazia o "Tirar da loja".)
// ---------------------------------------------------------------------
function ativoDepois(produto, novo) {
  if (!(novo > 0)) return false;
  const antes = produto ? produto.estoqueFisico : null;
  if (temControle(antes) && !(Number(antes) > 0)) return true;
  return !produto || produto.ativo !== false;
}

module.exports = { ativoDepois, TIPOS_MANUAIS, MOTIVOS_PERDA, temControle, calcularMovimento, registrarMov, registrarMovs, parcelaDoResumo, mesBrasilia, custoDaFicha, fix };
