// =====================================================================
//  /api/pdv.js — vendas feitas PELA EQUIPE.
//
//  POST { acao: 'venda', itens:[{id,qtd}], pag, cliente?, chave }
//      Venda de balcão. O preço vem do cadastro (nunca do navegador). A venda
//      vira um pedido já concluído (origem "balcao"), então entra sozinha no
//      estoque, no faturamento, no Balanço e no motor de demanda.
//
//  POST { acao: 'pesagem', pedidoId, pesos:[{i, peso}] }
//      Fecha a pesagem de um pedido da loja: calcula o valor de cada item pelo
//      peso, MANTÉM o desconto do cupom e baixa do estoque o que foi pesado.
//      (Antes o painel gravava o total direto: o cupom se perdia e o estoque
//      dos itens por quilo nunca baixava.)
//
//  Quem pode: proprietário, administrador, funcionário e caixa DA LOJA.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const E = require('../lib/estoque');
const V = require('../lib/venda');
const Avisos = require('../lib/avisos');
const P = require('../lib/prudencia');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const ORIGENS = ['https://www.bancaadairepedrina.com.br', 'https://bancaadairepedrina.com.br', 'https://site-banca1.vercel.app'];
const cors = (req, res) => {
  const extras = String(process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = ORIGENS.concat(extras), origem = req.headers && req.headers.origin;
  if (origem && ok.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  else if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') res.setHeader('Access-Control-Allow-Origin', '*');
  else res.setHeader('Access-Control-Allow-Origin', ok[0]);
  res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Loja');
};
const PODEM = ['proprietario', 'administrador', 'funcionario', 'caixa'];
const PAGAMENTOS = ['PIX', 'Dinheiro', 'Cartão'];
const inc = (n) => admin.firestore.FieldValue.increment(n);

// soma a venda nos contadores gerais e no resumo do dia
function somarNoCaixa(t, tid, valor, nPedidos, diaChave) {
  if (!valor && !nPedidos) return;
  t.set(T.docDe(db, tid, 'analytics/dashboard'), { receitaTotal: inc(valor), totalPedidos: inc(nPedidos) }, { merge: true });
  t.set(T.docDe(db, tid, `resumos/${diaChave}`), { dia: diaChave, receita: inc(valor), pedidos: inc(nPedidos), atualizadoEm: new Date().toISOString() }, { merge: true });
}

async function venda(req, res, { tid, dec }) {
  const b = req.body || {}, chave = String(b.chave || '');
  if (!/^[\w-]{8,80}$/.test(chave)) return res.status(400).json({ error: 'Chave obrigatória.' });
  const itens = Array.isArray(b.itens) ? b.itens : [];
  if (!itens.length || itens.length > 100) return res.status(400).json({ error: 'Inclua pelo menos um produto.' });
  if (itens.some((i) => !i || !/^[\w-]{1,80}$/.test(String(i.id)))) return res.status(400).json({ error: 'Produto inválido.' });
  if (new Set(itens.map((i) => String(i.id))).size !== itens.length) return res.status(400).json({ error: 'O mesmo produto aparece duas vezes.' });
  const pag = PAGAMENTOS.includes(b.pag) ? b.pag : null;
  if (!pag) return res.status(400).json({ error: 'Escolha a forma de pagamento.' });
  const c = b.cliente && typeof b.cliente === 'object' ? b.cliente : {};

  try {
    const saida = await db.runTransaction(async (t) => {
      const pedidoRef = T.tdoc(db, tid, 'pedidos', chave);
      const [jaSnap, ...prodSnaps] = await Promise.all([t.get(pedidoRef), ...itens.map((i) => t.get(T.tdoc(db, tid, 'produtos', i.id)))]);
      if (jaSnap.exists) return { repetido: true, id: chave, total: jaSnap.data().total };       // toque repetido

      let totalC = 0; const linhas = [], movs = [];
      itens.forEach((item, idx) => {
        const s = prodSnaps[idx];
        if (!s.exists) throw new Error('Um dos produtos não existe mais.');
        const p = s.data(), frac = V.isFracionavel(p.unidade), preco = Number(p.preco);
        if (!(preco > 0)) throw new Error(`"${p.nome}" está sem preço de venda.`);
        let qtd = Number(item.qtd);
        if (!Number.isFinite(qtd) || qtd <= 0 || qtd > 10000) throw new Error(`Quantidade inválida para "${p.nome}".`);
        qtd = frac ? E.fix(qtd) : Math.round(qtd);
        if (!frac && Math.abs(qtd - Number(item.qtd)) > 1e-9) throw new Error(`"${p.nome}" é vendido por unidade inteira.`);
        if (qtd <= 0) throw new Error(`Quantidade inválida para "${p.nome}".`);
        const subC = Math.round(V.paraCentavos(preco) * qtd); totalC += subC;
        linhas.push({ id: String(item.id), nome: p.nome, cat: p.cat || '', qtd, tipo: frac ? 'kg' : 'un', aPesar: false, preco, precoOriginal: preco, unidade: p.unidade || 'un', subtotal: V.paraReais(subC) });
        if (E.temControle(p.estoqueFisico)) {
          // No balcão o produto está na mão do cliente: a venda nunca é barrada por estoque.
          // Se o sistema achava que tinha menos, o saldo vai a zero (e a contagem corrige depois).
          const atual = Number(p.estoqueFisico), novo = Math.max(0, E.fix(atual - qtd));
          t.update(s.ref, { estoqueFisico: novo, ativo: novo > 0 });
          movs.push({ produtoId: String(item.id), nome: p.nome, unidade: p.unidade, tipo: 'venda', delta: E.fix(novo - atual), saldo: novo, custoUnit: p.custo, pedidoId: chave, obs: atual < qtd ? `Balcão: vendeu ${qtd}, o sistema tinha ${atual}` : 'Balcão', por: dec.email || dec.uid });
        }
      });
      const total = V.paraReais(totalC);
      const pedido = {
        id: chave, tenantId: tid, userId: `equipe:${dec.uid}`, origem: 'balcao', vendedor: dec.email || dec.uid,
        nome: V.texto(c.nome, 100) || 'Balcão', telefone: String(c.telefone || '').replace(/\D/g, '').slice(0, 13),
        condominio: V.texto(c.condominio, 60), condominioId: V.texto(c.condominioId, 40).replace(/[^\w-]/g, ''),
        formatoEndereco: ['rua', 'livre'].includes(c.formatoEndereco) ? c.formatoEndereco : 'ql', quadra: V.texto(c.quadra, 60), lote: V.texto(c.lote, 30),
        pag, troco: '', obs: '', itens: linhas, total, clientTotal: total, temItensAPesar: false, cupom: null,
        status: 'arquivado', data: new Date().toISOString(),
      };
      t.set(pedidoRef, pedido);
      E.registrarMovs(t, db, tid, movs, admin.firestore.FieldValue);
      somarNoCaixa(t, tid, total, 1, V.agoraBrasilia().toISOString().slice(0, 10));
      return { id: chave, total, itens: linhas.length };
    });
    // Venda no balcão também avisa os aparelhos da equipe (quem está longe do caixa acompanha o movimento).
    // Toque repetido não avisa de novo; e o aviso nunca derruba a venda, que já está gravada.
    if (!saida.repetido) await Avisos.avisarLoja(db, tid, {
      titulo: 'Venda no balcão', corpo: `${Number(saida.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ${pag}`,
      url: tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`, tag: `balcao-${saida.id}`,
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (P.ehFalhaInterna(e)) { await P.avisarFalha(db, tid, 'A venda no balcão', e); return res.status(500).json({ error: 'Não consegui registrar a venda agora. Tente de novo em instantes.' }); }
    return res.status(400).json({ error: e.message || 'Não foi possível registrar a venda.' });
  }
}

async function pesagem(req, res, { tid, dec }) {
  const b = req.body || {}, pedidoId = String(b.pedidoId || '');
  if (!/^[\w-]{6,80}$/.test(pedidoId)) return res.status(400).json({ error: 'Pedido inválido.' });
  const pesos = new Map((Array.isArray(b.pesos) ? b.pesos : []).slice(0, 200).map((x) => [Number(x && x.i), Number(x && x.peso)]));
  try {
    const saida = await db.runTransaction(async (t) => {
      const pedidoRef = T.tdoc(db, tid, 'pedidos', pedidoId), snap = await t.get(pedidoRef);
      if (!snap.exists) throw new Error('Pedido não encontrado.');
      const ped = snap.data();
      if (ped.status === 'cancelado') throw new Error('Este pedido foi cancelado.');
      if (ped.pagamento && ped.pagamento.status === 'PAID') throw new Error('Este pedido já foi pago: o valor não pode mais mudar.');
      const itens = (ped.itens || []).map((i) => ({ ...i }));
      const deBalanca = (i) => i.tipo === 'un' && V.isFracionavel(i.unidade);
      const idsBalanca = [...new Set(itens.filter(deBalanca).map((i) => String(i.id)))];
      const snaps = await Promise.all(idsBalanca.map((id) => t.get(T.tdoc(db, tid, 'produtos', id))));
      const prods = new Map(snaps.filter((s) => s.exists).map((s) => [s.id, { ref: s.ref, d: s.data() }]));

      let totalC = 0; const baixa = new Map();           // produtoId → kg a baixar (diferença para o que já tinha sido baixado)
      itens.forEach((i, idx) => {
        if (deBalanca(i)) {
          const peso = pesos.has(idx) ? pesos.get(idx) : Number(i.pesoFinal);
          if (!Number.isFinite(peso) || peso <= 0 || peso > 500) throw new Error(`Falta o peso de "${i.nome}".`);
          const kg = E.fix(peso), subC = Math.round(V.paraCentavos(i.precoOriginal) * kg);
          baixa.set(String(i.id), E.fix((baixa.get(String(i.id)) || 0) + kg - (Number(i.pesoBaixado) || 0)));
          Object.assign(i, { pesoFinal: kg, pesoBaixado: kg, aPesar: false, subtotal: V.paraReais(subC), precoFinalCalculado: V.paraReais(subC) });
          totalC += subC;
        } else totalC += V.paraCentavos(Number(i.subtotal) || (Number(i.preco ?? i.precoOriginal) || 0) * (Number(i.qtd) || 0));
      });
      const descC = ped.cupom && Number(ped.cupom.desconto) > 0 ? V.paraCentavos(ped.cupom.desconto) : 0;      // o desconto dado no pedido continua valendo
      // Entrega: a taxa do pedido continua; se depois da balança o pedido passou do valor de entrega grátis, ela sai.
      const ent = ped.entrega || null, itensC = Math.max(0, totalC - descC);
      const cheiaC = ent ? V.paraCentavos(Number(ent.taxaCheia) || 0) : 0, gratisC = ent ? V.paraCentavos(Number(ent.gratisAcima) || 0) : 0;
      const taxaC = cheiaC > 0 && !(gratisC > 0 && itensC >= gratisC) ? cheiaC : 0;
      const total = V.paraReais(itensC + taxaC);

      const movs = [];
      for (const [id, kg] of baixa) {
        const p = prods.get(id); if (!p || !E.temControle(p.d.estoqueFisico) || kg === 0) continue;
        const atual = Number(p.d.estoqueFisico), novo = Math.max(0, E.fix(atual - kg));
        t.update(p.ref, { estoqueFisico: novo, ativo: novo > 0 });
        movs.push({ produtoId: id, nome: p.d.nome, unidade: p.d.unidade, tipo: 'venda', delta: E.fix(novo - atual), saldo: novo, custoUnit: p.d.custo, pedidoId, obs: 'Pesagem do pedido', por: dec.email || dec.uid });
      }
      const abertos = ['pendente', 'aguardando_pesagem', 'aguardando_pagamento'];
      t.update(pedidoRef, { itens, total, totalExato: total, temItensAPesar: false, ...(ent ? { entrega: { ...ent, taxa: V.paraReais(taxaC) } } : {}), status: abertos.includes(ped.status) ? 'preparando' : ped.status, pesadoEm: new Date().toISOString() });
      E.registrarMovs(t, db, tid, movs, admin.firestore.FieldValue);
      // o caixa já tinha a parte de valor fechado: soma só a diferença
      const dif = V.paraReais(V.paraCentavos(total) - V.paraCentavos(Number(ped.total) || 0));
      const dia = new Date(new Date(ped.data).getTime() - 3 * 3600000).toISOString().slice(0, 10);
      if (dif !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(dia)) somarNoCaixa(t, tid, dif, 0, dia);
      return { total, desconto: V.paraReais(descC), entrega: V.paraReais(taxaC), itens };
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) { return res.status(400).json({ error: e.message || 'Não foi possível salvar a pesagem.' }); }
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  let dec, tid;
  try {
    const cab = String((req.headers && req.headers.authorization) || '');
    dec = await admin.auth().verifyIdToken(cab.startsWith('Bearer ') ? cab.slice(7).trim() : '');
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  let ficha;
  try { ({ tid, ficha } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  // a pesagem de pedido da loja continua valendo mesmo com o Balcão desligado
  if ((req.body || {}).acao === 'venda' && !T.moduloAtivo(ficha, 'pdv')) return res.status(403).json({ error: 'O Balcão não está ligado nesta loja.' });
  if (!T.temPapel(dec, tid, PODEM)) return res.status(403).json({ error: 'Sua conta não pode registrar vendas nesta loja.' });
  const acao = (req.body || {}).acao;
  if (acao === 'venda') return venda(req, res, { tid, dec });
  if (acao === 'pesagem') return pesagem(req, res, { tid, dec });
  return res.status(400).json({ error: 'Ação desconhecida.' });
};
