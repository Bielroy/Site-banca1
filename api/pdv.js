// =====================================================================
//  /api/pdv.js — vendas feitas PELA EQUIPE.
//
//  POST { acao: 'venda', itens:[{id,qtd}], pag, cliente?, chave }
//      Venda de balcão. O preço vem do cadastro (nunca do navegador). A venda
//      vira um pedido já concluído (origem "balcao"), então entra sozinha no
//      estoque, no faturamento, no Balanço e no motor de demanda.
//
//  POST { acao: 'mensagem', chave, itens:[{id, qtd, tipo:'kg'|'un'}], cliente:{nome, telefone, endereco}, pag, obs, entrega }
//      Pedido que chegou por MENSAGEM (WhatsApp colado na tela da impressora, js/whats-produtos-lib.js).
//      Vira um pedido normal, para hoje: preço do cadastro (nunca do navegador), por quilo com peso
//      escrito = valor fechado; por quilo pedido em unidades = "a pesar" (fecha na Pesagem, como o da
//      loja); por unidade = preço × quantidade. Baixa o estoque do que tem valor fechado, sem barrar.
//
//  POST { acao: 'pesagem', pedidoId, pesos:[{i, peso}] }
//      Fecha a pesagem de um pedido da loja: calcula o valor de cada item pelo
//      peso, MANTÉM o desconto do cupom e baixa do estoque o que foi pesado.
//      (Antes o painel gravava o total direto: o cupom se perdia e o estoque
//      dos itens por quilo nunca baixava.)
//
//  POST { acao: 'impressao', op, pedidoId, versao, aparelho }
//      Fila de impressão (lib/impressao.js): reservar → imprimir no aparelho → confirmar
//      (ou liberar, se não saiu). Um pedido não sai duas vezes, nem com dois aparelhos ligados.
//
//  POST { acao: 'ponte', op: 'codigo' | 'listar' | 'config' | 'remover' | 'imprimir', ... }
//      O APP PONTE (celular Android com a impressora, lib/ponte.js): gerar o código para ligar um
//      celular, ver como estão, configurar a impressão automática deles, desligar, e mandar papel.
//      Ligar e desligar celular: só proprietário e administrador.
//
//  POST { acao: 'catalogo', modo?: 'se-faltar' }
//      O painel salvou produto (ou acabou de abrir): remonta a vitrine num documento só (lib/catalogo.js).
//      Qualquer pessoa da equipe da loja pode pedir.
//
//  Quem pode: proprietário, administrador, funcionário e caixa DA LOJA.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const E = require('../lib/estoque');
const V = require('../lib/venda');
const Feira = require('../lib/feira');
const Avisos = require('../lib/avisos');
const P = require('../lib/prudencia');
const Imp = require('../lib/impressao');
const Ponte = require('../lib/ponte');
const Catalogo = require('../lib/catalogo');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const H = require('../lib/http');
const Cofre = require('../lib/cofre');
const cors = H.cors;            // origem (CORS): lista única em lib/http.js
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
  // RESUMO DE VÁRIAS VENDAS: o que saiu no balcão lançado de uma vez (de cabeça), de hoje ou de ontem.
  // Vale para caixa, estoque e previsão; não é "um cliente" e não ensina "quem leva X leva Y".
  const resumo = b.resumo === true, deOntem = resumo && b.dia === 'ontem';
  const c = !resumo && b.cliente && typeof b.cliente === 'object' ? b.cliente : {};
  const diaBr = new Date(V.agoraBrasilia().getTime() - (deOntem ? 86400000 : 0)).toISOString().slice(0, 10);
  const dataPedido = deOntem ? new Date(`${diaBr}T12:00:00-03:00`).toISOString() : new Date().toISOString();   // ontem: meio-dia, para cair no dia certo

  try {
    const saida = await db.runTransaction(async (t) => {
      const pedidoRef = T.tdoc(db, tid, 'pedidos', chave);
      const [jaSnap, ...prodSnaps] = await Promise.all([t.get(pedidoRef), ...itens.map((i) => t.get(T.tdoc(db, tid, 'produtos', i.id)))]);
      if (jaSnap.exists) return { repetido: true, id: chave, total: jaSnap.data().total };       // toque repetido

      let totalC = 0; const linhas = [], movs = [];
      itens.forEach((item, idx) => {
        const s = prodSnaps[idx];
        if (!s.exists) throw new Error('Um dos produtos não existe mais.');
        const p = s.data(), frac = V.isFracionavel(p.unidade), preco = Feira.precoDoDia(p, new Date(Date.now() - 3 * 3600000).getUTCDay());   // balcão: o preço de HOJE
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
          t.update(s.ref, { estoqueFisico: novo, ativo: E.ativoDepois(p, novo) });
          movs.push({ produtoId: String(item.id), nome: p.nome, unidade: p.unidade, tipo: 'venda', delta: E.fix(novo - atual), saldo: novo, custoUnit: p.custo, pedidoId: chave, obs: atual < qtd ? `Balcão: vendeu ${qtd}, o sistema tinha ${atual}` : 'Balcão', por: dec.email || dec.uid });
        }
      });
      const total = V.paraReais(totalC);
      const pedido = {
        id: chave, tenantId: tid, userId: `equipe:${dec.uid}`, origem: 'balcao', vendedor: dec.email || dec.uid,
        nome: resumo ? 'Balcão (resumo do dia)' : V.texto(c.nome, 100) || 'Balcão', ...(resumo ? { resumoDoDia: true } : {}), telefone: String(c.telefone || '').replace(/\D/g, '').slice(0, 13),
        condominio: V.texto(c.condominio, 60), condominioId: V.texto(c.condominioId, 40).replace(/[^\w-]/g, ''),
        formatoEndereco: ['rua', 'livre'].includes(c.formatoEndereco) ? c.formatoEndereco : 'ql', quadra: V.texto(c.quadra, 60), lote: V.texto(c.lote, 30),
        pag, troco: '', obs: '', itens: linhas, total, clientTotal: total, temItensAPesar: false, cupom: null,
        status: 'arquivado', data: dataPedido,
      };
      t.set(pedidoRef, Cofre.fecharCampos(pedido, tid));   // cliente do balcão também vai cifrado (lib/cofre.js)
      E.registrarMovs(t, db, tid, movs, admin.firestore.FieldValue);
      somarNoCaixa(t, tid, total, 1, diaBr);
      return { id: chave, total, itens: linhas.length };
    });
    // Venda no balcão também avisa os aparelhos da equipe (quem está longe do caixa acompanha o movimento).
    // Toque repetido não avisa de novo; e o aviso nunca derruba a venda, que já está gravada.
    if (!saida.repetido && !resumo) await Avisos.avisarLoja(db, tid, {
      titulo: 'Venda no balcão', corpo: `${Number(saida.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ${pag}`,
      url: tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`, tag: `balcao-${saida.id}`,
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (P.ehFalhaInterna(e)) { await P.avisarFalha(db, tid, 'A venda no balcão', e); return res.status(500).json({ error: 'Não consegui registrar a venda agora. Tente de novo em instantes.' }); }
    return res.status(400).json({ error: e.message || 'Não foi possível registrar a venda.' });
  }
}

async function mensagem(req, res, { tid, dec }) {
  const b = req.body || {}, chave = String(b.chave || '');
  if (!/^[\w-]{8,80}$/.test(chave)) return res.status(400).json({ error: 'Chave obrigatória.' });
  const itens = Array.isArray(b.itens) ? b.itens : [];
  if (!itens.length || itens.length > 120) return res.status(400).json({ error: 'Inclua pelo menos um produto.' });
  if (itens.some((i) => !i || !/^[\w-]{1,80}$/.test(String(i.id)) || !['kg', 'un'].includes(i.tipo))) return res.status(400).json({ error: 'Produto inválido.' });
  const pag = PAGAMENTOS.includes(b.pag) ? b.pag : null;
  if (!pag) return res.status(400).json({ error: 'Escolha a forma de pagamento.' });
  const c = b.cliente && typeof b.cliente === 'object' ? b.cliente : {};
  const nome = V.texto(c.nome, 100);
  if (!nome) return res.status(400).json({ error: 'Escreva o nome do cliente.' });
  const hoje = Feira.hojeBR(), dow = new Date(`${hoje}T12:00:00-03:00`).getUTCDay();

  try {
    const saida = await db.runTransaction(async (t) => {
      const pedidoRef = T.tdoc(db, tid, 'pedidos', chave);
      const ids = [...new Set(itens.map((i) => String(i.id)))];
      const [jaSnap, ...prodSnaps] = await Promise.all([t.get(pedidoRef), ...ids.map((id) => t.get(T.tdoc(db, tid, 'produtos', id)))]);
      if (jaSnap.exists) return { repetido: true, id: chave, total: jaSnap.data().total };       // toque repetido
      const prods = new Map(prodSnaps.map((s, i) => [ids[i], s]));

      let totalC = 0; const linhas = [], baixa = new Map();
      itens.forEach((item) => {
        const s = prods.get(String(item.id));
        if (!s || !s.exists) throw new Error('Um dos produtos não existe mais.');
        const p = s.data(), frac = V.isFracionavel(p.unidade), preco = Feira.precoDoDia(p, dow);
        if (!(preco > 0)) throw new Error(`"${p.nome}" está sem preço de venda.`);
        let qtd = Number(item.qtd);
        if (!Number.isFinite(qtd) || qtd <= 0 || qtd > 10000) throw new Error(`Quantidade inválida para "${p.nome}".`);
        const base = { id: String(item.id), nome: p.nome, cat: p.cat || '', preco, precoOriginal: preco, unidade: p.unidade || 'un' };
        if (item.tipo === 'kg') {
          if (!frac) throw new Error(`"${p.nome}" é vendido por ${p.unidade || 'unidade'}, não por quilo.`);
          qtd = E.fix(qtd); const subC = Math.round(V.paraCentavos(preco) * qtd); totalC += subC;
          linhas.push({ ...base, qtd, tipo: 'kg', aPesar: false, subtotal: V.paraReais(subC) });
          baixa.set(base.id, E.fix((baixa.get(base.id) || 0) + qtd));
        } else {
          qtd = Math.round(qtd);
          if (qtd < 1) throw new Error(`Quantidade inválida para "${p.nome}".`);
          if (frac) linhas.push({ ...base, qtd, tipo: 'un', aPesar: true, subtotal: 0 });       // por quilo, pedido em unidades: valor na balança
          else {
            const subC = Math.round(V.paraCentavos(preco) * qtd); totalC += subC;
            linhas.push({ ...base, qtd, tipo: 'un', aPesar: false, subtotal: V.paraReais(subC) });
            baixa.set(base.id, (baixa.get(base.id) || 0) + qtd);
          }
        }
      });
      // estoque: só o que tem valor fechado (o "a pesar" baixa na Pesagem). Pedido por mensagem nunca é barrado.
      const movs = [];
      for (const [id, q] of baixa) {
        const s = prods.get(id), p = s.data(); if (!E.temControle(p.estoqueFisico)) continue;
        const atual = Number(p.estoqueFisico), novo = Math.max(0, E.fix(atual - q));
        t.update(s.ref, { estoqueFisico: novo, ativo: E.ativoDepois(p, novo) });
        movs.push({ produtoId: id, nome: p.nome, unidade: p.unidade, tipo: 'venda', delta: E.fix(novo - atual), saldo: novo, custoUnit: p.custo, pedidoId: chave, obs: 'Pedido por mensagem', por: dec.email || dec.uid });
      }
      const total = V.paraReais(totalC), temItensAPesar = linhas.some((l) => l.aPesar);
      const pedido = {
        id: chave, tenantId: tid, userId: `equipe:${dec.uid}`, origem: 'mensagem', vendedor: dec.email || dec.uid,
        nome, telefone: String(c.telefone || '').replace(/\D/g, '').slice(0, 13),
        condominio: '', condominioId: '', formatoEndereco: 'livre', quadra: V.texto(c.endereco, 60), lote: '',
        pag, troco: '', obs: V.texto(b.obs, 500), itens: linhas, total, clientTotal: total, temItensAPesar, cupom: null,
        entrega: { taxa: 0, taxaCheia: 0, gratisAcima: 0, horario: V.texto(b.entrega, 60) },
        status: temItensAPesar ? 'aguardando_pesagem' : 'pendente', data: new Date().toISOString(), entregaDia: hoje,
      };
      t.set(pedidoRef, Cofre.fecharCampos(pedido, tid));   // nome, telefone e endereço cifrados, como os da loja
      E.registrarMovs(t, db, tid, movs, admin.firestore.FieldValue);
      somarNoCaixa(t, tid, total, 1, hoje);
      return { id: chave, total, itens: linhas.length, aPesar: linhas.filter((l) => l.aPesar).length };
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (P.ehFalhaInterna(e)) { await P.avisarFalha(db, tid, 'O pedido por mensagem', e); return res.status(500).json({ error: 'Não consegui registrar o pedido agora. Tente de novo em instantes.' }); }
    return res.status(400).json({ error: e.message || 'Não foi possível registrar o pedido.' });
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
      // cupom em %: vale sobre tudo, inclusive o que acabou de ser pesado. Cupom em reais: o valor dado no pedido continua.
      const pctCupom = ped.cupom ? Math.min(100, Number(ped.cupom.percentual) || 0) : 0;
      const descC = Math.min(totalC, pctCupom > 0 ? Math.round(totalC * pctCupom / 100) : (ped.cupom && Number(ped.cupom.desconto) > 0 ? V.paraCentavos(ped.cupom.desconto) : 0));
      // Entrega: a taxa do pedido continua; se depois da balança o pedido passou do valor de entrega grátis, ela sai.
      const ent = ped.entrega || null, itensC = Math.max(0, totalC - descC);
      const cheiaC = ent ? V.paraCentavos(Number(ent.taxaCheia) || 0) : 0, gratisC = ent ? V.paraCentavos(Number(ent.gratisAcima) || 0) : 0;
      const taxaC = pctCupom >= 100 ? 0 : (cheiaC > 0 && !(gratisC > 0 && itensC >= gratisC) ? cheiaC : 0);   // cupom de 100% é cortesia: sem taxa
      const total = V.paraReais(itensC + taxaC);

      const movs = [];
      for (const [id, kg] of baixa) {
        const p = prods.get(id); if (!p || !E.temControle(p.d.estoqueFisico) || kg === 0) continue;
        const atual = Number(p.d.estoqueFisico), novo = Math.max(0, E.fix(atual - kg));
        t.update(p.ref, { estoqueFisico: novo, ativo: E.ativoDepois(p.d, novo) });
        movs.push({ produtoId: id, nome: p.d.nome, unidade: p.d.unidade, tipo: 'venda', delta: E.fix(novo - atual), saldo: novo, custoUnit: p.d.custo, pedidoId, obs: 'Pesagem do pedido', por: dec.email || dec.uid });
      }
      const abertos = ['pendente', 'aguardando_pesagem', 'aguardando_pagamento'];
      t.update(pedidoRef, { itens, total, totalExato: total, temItensAPesar: false, ...(pctCupom > 0 ? { cupom: { ...ped.cupom, desconto: V.paraReais(descC) } } : {}), ...(ent ? { entrega: { ...ent, taxa: V.paraReais(taxaC) } } : {}), status: abertos.includes(ped.status) ? 'preparando' : ped.status, pesadoEm: new Date().toISOString() });
      E.registrarMovs(t, db, tid, movs, admin.firestore.FieldValue);
      // o caixa já tinha a parte de valor fechado: soma só a diferença
      const dif = V.paraReais(V.paraCentavos(total) - V.paraCentavos(Number(ped.total) || 0));
      // mesmo dia em que o checkout somou o pedido: o da ENTREGA (pedido para a próxima feira) ou o do pedido
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(ped.entregaDia || '')) ? ped.entregaDia : new Date(new Date(ped.data).getTime() - 3 * 3600000).toISOString().slice(0, 10);
      if (dif !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(dia)) somarNoCaixa(t, tid, dif, 0, dia);
      return { total, desconto: V.paraReais(descC), entrega: V.paraReais(taxaC), itens };
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (P.ehFalhaInterna(e)) { await P.avisarFalha(db, tid, 'A pesagem de pedidos', e); return res.status(500).json({ error: 'Não consegui salvar a pesagem agora. Tente de novo em instantes.' }); }
    return res.status(400).json({ error: e.message || 'Não foi possível salvar a pesagem.' });
  }
}

// FILA DE IMPRESSÃO (lib/impressao.js): o aparelho com a impressora reserva o pedido, imprime e confirma.
// POST { acao: 'impressao', op: 'reservar' | 'confirmar' | 'liberar', pedidoId, versao, aparelho }
async function impressao(req, res, { tid }) {
  const b = req.body || {}, pedidoId = String(b.pedidoId || ''), op = String(b.op || ''), versao = String(b.versao || 'inicial'), aparelho = b.aparelho;
  if (!/^[\w-]{6,80}$/.test(pedidoId)) return res.status(400).json({ error: 'Pedido inválido.' });
  if (!['reservar', 'confirmar', 'liberar'].includes(op) || Imp.nivel(versao) < 0 || !Imp.aparelhoOk(aparelho)) return res.status(400).json({ error: 'Pedido de impressão inválido.' });
  try {
    const saida = await db.runTransaction(async (t) => {
      const ref = T.tdoc(db, tid, 'pedidos', pedidoId), snap = await t.get(ref);
      if (!snap.exists) return { ok: false, motivo: 'sumiu' };
      const ped = snap.data(), atual = ped.impressao;
      if (ped.origem === 'balcao' && op === 'reservar') return { ok: false, motivo: 'ja' };          // venda de balcão: o cupom sai na hora, à mão
      if (op === 'reservar') {
        // o aviso de cancelado só existe para pedido cancelado; e pedido cancelado não imprime mais cupom
        if ((versao === 'cancelado') !== (ped.status === 'cancelado')) return { ok: false, motivo: 'ja' };
        const d = Imp.decidirReserva(atual, versao, aparelho);
        if (d.ok) t.update(ref, { impressao: d.novo });
        return d.ok ? { ok: true } : d;
      }
      if (op === 'confirmar') { const novo = Imp.confirmar(atual, versao, aparelho); t.update(ref, { impressao: novo }); return { ok: true, impressao: novo }; }
      const solto = Imp.liberar(atual, aparelho); if (solto) t.update(ref, { impressao: solto });
      return { ok: true };
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (P.ehFalhaInterna(e)) return res.status(500).json({ error: 'Não consegui falar com a fila de impressão agora.' });
    return res.status(400).json({ error: e.message || 'Não foi possível.' });
  }
}

// APP PONTE (lib/ponte.js): o painel liga, configura e manda papel para o celular da banca.
async function ponte(req, res, { tid, dec }) {
  const b = req.body || {}, op = String(b.op || ''), gestor = T.temPapel(dec, tid, T.GESTORES);
  try {
    if (op === 'codigo') {
      if (!gestor) return res.status(403).json({ error: 'Só o dono ou o administrador liga um celular novo.' });
      if (H.passouNaMemoria(`ponte-codigo:${dec.uid}`, 10, 10 * 60 * 1000)) return res.status(429).json({ error: 'Muitos códigos seguidos. Espere alguns minutos.' });
      return res.status(200).json({ sucesso: true, ...(await Ponte.criarCodigo(db, tid, { por: dec.email || dec.uid, cfg: b.cfg })) });
    }
    if (op === 'listar') return res.status(200).json({ sucesso: true, pontes: await Ponte.listar(db, tid), apk: Ponte.APK_URL });
    if (op === 'config') return res.status(200).json({ sucesso: true, ...(await Ponte.salvarConfig(db, tid, b.ponteId, b.cfg, { imprimirFila: b.imprimirFila === true })) });
    if (op === 'remover') {
      if (!gestor) return res.status(403).json({ error: 'Só o dono ou o administrador desliga um celular.' });
      await Ponte.remover(db, tid, b.ponteId); return res.status(200).json({ sucesso: true });
    }
    if (op === 'imprimir') return res.status(200).json({ sucesso: true, ...(await Ponte.novoTrabalho(db, tid, b, dec.email || dec.uid)) });
    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    if (e && e.status && e.status < 500) return res.status(e.status).json({ error: e.message });
    console.error('[pdv] ponte:', e && e.message);
    return res.status(500).json({ error: 'Não consegui falar com o celular da banca agora. Tente de novo.' });
  }
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  let dec, tid;
  try {
    dec = await admin.auth().verifyIdToken(H.tokenDe(req), true);        // true = recusa login encerrado (pessoa tirada da equipe)
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  if (H.passouNaMemoria(`pdv:${dec.uid}`, 90, 60000)) return res.status(429).json({ error: 'Muitas vendas seguidas. Aguarde um minuto.' });
  let ficha;
  try { ({ tid, ficha } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  // a pesagem de pedido da loja continua valendo mesmo com o Balcão desligado
  if ((req.body || {}).acao === 'venda' && !T.moduloAtivo(ficha, 'pdv')) return res.status(403).json({ error: 'O Balcão não está ligado nesta loja.' });
  const acao = (req.body || {}).acao;
  // O painel salvou produto: remonta a vitrine num documento só (lib/catalogo.js). Qualquer pessoa da equipe pode pedir.
  if (acao === 'catalogo') {
    if (!T.temPapel(dec, tid, T.PAPEIS)) return res.status(403).json({ error: 'Sua conta não é desta loja.' });
    try { const r = await Catalogo.pedidoDoPainel(db, tid, (req.body || {}).modo === 'se-faltar' ? 'se-faltar' : 'tudo'); return res.status(200).json({ sucesso: true, resultado: r }); }
    catch (e) { console.warn('[pdv] catálogo:', e && e.message); return res.status(503).json({ error: 'Não consegui atualizar a vitrine agora.' }); }
  }
  if (!T.temPapel(dec, tid, PODEM)) return res.status(403).json({ error: 'Sua conta não pode registrar vendas nesta loja.' });
  if (acao === 'venda') return venda(req, res, { tid, dec });
  if (acao === 'mensagem') return mensagem(req, res, { tid, dec });
  if (acao === 'pesagem') return pesagem(req, res, { tid, dec });
  if (acao === 'impressao') return impressao(req, res, { tid, dec });
  if (acao === 'ponte') return ponte(req, res, { tid, dec });
  return res.status(400).json({ error: 'Ação desconhecida.' });
};
