'use strict';
// =====================================================================
//  lib/avise.js — "AVISE-ME QUANDO VOLTAR" (lista de espera de produto em falta).
//
//  Na loja, o produto com estoque zerado aparece em "Em falta hoje" com o botão
//  "Avise-me". O cliente deixa o nome e o WhatsApp. Quando o produto volta ao
//  estoque, o painel (aba Estoque) mostra quem está esperando, com um botão que
//  abre a conversa no WhatsApp já com a mensagem escrita. NADA é enviado sozinho:
//  é a banca que toca em enviar, um cliente de cada vez (sem disparo em massa).
//
//  Guarda: {loja}/espera/{produtoId} = { produtoId, nome, clientes: [{ nome, tel, em }] }
//    • o telefone fica cifrado no cofre da loja (lib/cofre.js), como os dados dos pedidos;
//    • no máximo 60 pessoas por produto, uma vez cada telefone;
//    • quem foi avisado sai da lista; a lista inteira some 60 dias depois do último pedido.
//  O navegador do cliente nunca lê esta coleção (firestore.rules não a libera).
// =====================================================================
const T = require('./tenant');
const Cofre = require('./cofre');

const MAX_POR_PRODUTO = 60;
const VALIDADE_MS = 60 * 86400000;
const limpo = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Só os dígitos de um celular/fixo brasileiro com DDD (10 ou 11), sem o 55 da frente. '' se não parece telefone. */
function telefone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return /^[1-9]\d(9\d{8}|[2-5]\d{7})$/.test(d) ? d : '';
}
const refDe = (db, tid, produtoId) => T.tdoc(db, tid, 'espera', String(produtoId));
const temControle = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
/** O produto está "em falta" (estoque contado que zerou e por isso saiu da loja)? */
const emFalta = (p) => !!(p && p.ativo === false && !p.soInsumo && temControle(p.estoqueFisico) && !(Number(p.estoqueFisico) > 0));

/**
 * O cliente pede para ser avisado. Devolve { ok: true, jaEstava }.
 * Lança Error com `status` (400 quando o pedido não faz sentido).
 */
async function pedir(db, tid, { produtoId, nome, telefone: tel } = {}, agora = Date.now()) {
  const id = String(produtoId || ''), fone = telefone(tel), quem = limpo(nome, 40);
  const falha = (msg, status = 400) => Object.assign(new Error(msg), { status });
  if (!/^[\w-]{1,80}$/.test(id)) throw falha('Produto inválido.');
  if (!fone) throw falha('Confira o WhatsApp: precisa do DDD e do número.');
  if (quem.length < 2) throw falha('Escreva o seu nome.');
  return db.runTransaction(async (t) => {
    const ps = await t.get(T.tdoc(db, tid, 'produtos', id));
    if (!ps.exists) throw falha('Este produto não existe mais.');
    const p = ps.data();
    if (!emFalta(p)) throw falha(p.ativo ? `${p.nome} já voltou. É só pedir.` : 'Este produto não está à venda no momento.');
    const ref = refDe(db, tid, id), s = await t.get(ref);
    const atual = s.exists && Array.isArray(s.data().clientes) ? s.data().clientes.filter((c) => c && c.tel && agora - (Date.parse(c.em) || 0) < VALIDADE_MS) : [];
    const jaEstava = atual.some((c) => Cofre.abrir(c.tel, tid, 'telefone') === fone);
    if (!jaEstava) {
      if (atual.length >= MAX_POR_PRODUTO) throw falha('A lista de espera deste produto está cheia. Fale com a loja pelo WhatsApp.');
      atual.push({ nome: quem, tel: Cofre.fechar(fone, tid, 'telefone'), em: new Date(agora).toISOString() });
    }
    t.set(ref, { produtoId: id, nome: limpo(p.nome, 80), clientes: atual, atualizadoEm: new Date(agora).toISOString() });
    return { ok: true, jaEstava };
  });
}

/**
 * Para o painel: quem está esperando o quê. Cada item diz se o produto JÁ VOLTOU (aí é hora de avisar).
 * Devolve [{ produtoId, nome, voltou, clientes: [{ nome, telefone, em }] }], os que voltaram primeiro.
 */
async function listar(db, tid, agora = Date.now()) {
  const snap = await T.tcol(db, tid, 'espera').get();
  const saida = [];
  for (const d of snap.docs) {
    const x = d.data() || {};
    const clientes = (Array.isArray(x.clientes) ? x.clientes : []).filter((c) => c && c.tel && agora - (Date.parse(c.em) || 0) < VALIDADE_MS)
      .map((c) => ({ nome: limpo(c.nome, 40), telefone: telefone(Cofre.abrir(c.tel, tid, 'telefone')), em: String(c.em || '') })).filter((c) => c.telefone);
    if (!clientes.length) continue;
    const ps = await T.tdoc(db, tid, 'produtos', d.id).get();
    const p = ps.exists ? ps.data() : null;
    saida.push({ produtoId: d.id, nome: limpo((p && p.nome) || x.nome, 80), voltou: !!(p && p.ativo && !emFalta(p)), existe: !!p, clientes });
  }
  return saida.sort((a, b) => Number(b.voltou) - Number(a.voltou) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** A banca avisou (ou desistiu de avisar) um cliente: ele sai da lista. telefone = '' tira todos do produto. */
async function tirar(db, tid, { produtoId, telefone: tel } = {}) {
  const id = String(produtoId || ''), fone = telefone(tel);
  if (!/^[\w-]{1,80}$/.test(id)) throw Object.assign(new Error('Produto inválido.'), { status: 400 });
  return db.runTransaction(async (t) => {
    const ref = refDe(db, tid, id), s = await t.get(ref);
    if (!s.exists) return { ok: true, restam: 0 };
    const resto = fone ? (Array.isArray(s.data().clientes) ? s.data().clientes : []).filter((c) => c && Cofre.abrir(c.tel, tid, 'telefone') !== fone) : [];
    if (resto.length) t.set(ref, { ...s.data(), clientes: resto, atualizadoEm: new Date().toISOString() }); else t.delete(ref);
    return { ok: true, restam: resto.length };
  });
}

/** A mensagem que a banca manda (o painel só abre a conversa; quem envia é a pessoa). */
const mensagem = (loja, cliente, produto) => `*${limpo(loja, 60) || 'Nossa loja'}*\n\nOlá${cliente ? `, ${limpo(cliente, 40).split(' ')[0]}` : ''}! Você pediu para ser avisado: *${limpo(produto, 80)}* voltou.\n\nSe quiser, é só fazer o pedido pela loja ou responder esta mensagem.`;

module.exports = { pedir, listar, tirar, telefone, emFalta, mensagem, MAX_POR_PRODUTO, VALIDADE_MS };
