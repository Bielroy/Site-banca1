'use strict';
// =====================================================================
//  lib/apagar-cliente.js — PEDIDO DO CLIENTE PARA APAGAR OS DADOS (LGPD, art. 18), POR TELEFONE, NUMA LOJA.
//
//  Quem usa é scripts/apagar-cliente.js (no servidor, com confirmação). Sem `gravar`, só mostra o que faria.
//
//  COMO ACHA A PESSOA (só na loja escolhida)
//   1. pedidos com aquele telefone (com ou sem 55, com ou sem o 9 do celular);
//   2. as contas ligadas a esses pedidos ou com o mesmo telefone → os aparelhos (uids) e os pedidos dessas contas;
//   3. os pedidos feitos por esses aparelhos (userId) ou listados na conta, MESMO SEM telefone — e repete até não achar mais.
//  O perfil da previsão é o do ENDEREÇO dos pedidos dela: com condomínio, só a chave com condomínio (um vizinho de
//  outro condomínio com a mesma quadra e lote não é tocado); a chave sem condomínio só vale para pedido sem condomínio.
//
//  O QUE FAZ
//   - pedidos: troca SÓ os campos pessoais (nome, telefone, endereço, observação, conta, aparelho, ofertas, rota do frete),
//     numa transação por pedido: um pagamento ou uma etapa que chegue no meio não é desfeito. FICAM itens, valores,
//     pagamento, datas e situação (caixa e fechamento continuam batendo);
//   - contas, perfil da previsão (analytics_clientes) e ligações de aparelho (analytics_uid): apagados;
//   - lista de clientes do painel de previsão (analytics_previsoes/painel → indiceClientes), "já contatado" (crm/contatos),
//     ponto do frete (fretes/{dia}) e "me avise quando chegar" (espera/{produto}): a pessoa sai;
//   - MARCA (plataforma/lgpd_apagados): um HMAC do telefone e dos aparelhos, feito com a DADOS_CHAVE (nunca o telefone
//     em claro). Depois de restaurar uma cópia, server/restaurar-backup.js chama reaplicar() e a pessoa some de novo.
//  O QUE NÃO ALCANÇA (dizer ao cliente): cópias já feitas expiram sozinhas (dentro do Firebase, 7 dias; no servidor e no
//  R2, 60 dias), mensagens no WhatsApp da loja (apagar no aparelho) e o registro do pagamento no Asaas/PagBank (lei).
// =====================================================================
const crypto = require('crypto');
const T = require('./tenant');
const Cofre = require('./cofre');
const N = require('../analytics/normalize');

const ANONIMO = 'Cliente (dados apagados)';
const DOC_MARCAS = 'plataforma/lgpd_apagados';
const EXPIRA = 'As cópias de segurança já feitas expiram sozinhas: dentro do Firebase em 7 dias, no servidor e no R2 em 60 dias.';

/** Só os dígitos, sem o 55 do país. '' quando não parece telefone brasileiro com DDD. */
function normalizarTelefone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return /^[1-9]\d\d{8,9}$/.test(d) ? d : '';
}
/** Forma única do número (sem o 9 da frente do celular): a mesma pessoa com ou sem o 9 dá o mesmo resultado. */
const canonico = (v) => { const d = normalizarTelefone(v); return d.length === 11 && d[2] === '9' ? d.slice(0, 2) + d.slice(3) : d; };
function mesmoTelefone(a, b) { const x = canonico(a), y = canonico(b); return !!x && x === y; }

/** Chave da marca (HMAC com a DADOS_CHAVE). null sem chave: aí não dá para marcar. */
function chaveDasMarcas() {
  const b = Buffer.from(String(process.env.DADOS_CHAVE || '').trim(), 'base64');
  return b.length === 32 ? Buffer.from(crypto.hkdfSync('sha256', b, Buffer.from('banca-lgpd-v1'), Buffer.from('marcas'), 32)) : null;
}
const marca = (k, tid, tipo, valor) => crypto.createHmac('sha256', k).update(`${tid}|${tipo}|${valor}`).digest('hex').slice(0, 40);

/** Perfil(s) da previsão do endereço do pedido. Com condomínio, só a chave com condomínio. */
function idsDoPerfil(p) {
  const cond = N.normCond(p.condominio);
  const k = N.chaveCliente({ ...p, id: 'x' }, cond);
  return k.startsWith('ped:') ? [] : [N.idDeChave(k)];
}

const uidValido = (u) => typeof u === 'string' && u && u !== 'anonimo' && !u.includes('/') && u.length <= 128;

/**
 * Núcleo: acha tudo da pessoa a partir de `ehTelefone(telefoneAberto)` e `ehUid(uid)` e (com gravar) apaga.
 * Devolve o relatório { pedidos, contas, perfis, uids, fretes, espera, painel, gravado, telefones: Set (só na memória) }.
 */
async function apagarPor(db, tid, { ehTelefone, ehUid = () => false, gravar = false, agora = new Date() }) {
  const rel = { loja: tid, pedidos: [], contas: [], perfis: [], uids: 0, fretes: 0, espera: 0, painel: 0, gravado: false };
  const [pedSnap, contaSnap, perfilSnap] = await Promise.all([T.tcol(db, tid, 'pedidos').get(), T.tcol(db, tid, 'contas').get(), T.tcol(db, tid, 'analytics_clientes').get()]);
  const pedidos = pedSnap.docs.map((d) => ({ d, p: Cofre.abrirCampos(d.data() || {}, tid) }));
  const contas = contaSnap.docs.map((d) => ({ d, c: Cofre.abrirCampos(d.data() || {}, tid) }));
  const achadosP = new Map(), achadosC = new Map(), uids = new Set(), contaIds = new Set(), pedidosDaConta = new Set(), telefones = new Set();
  // repete até não achar mais nada novo (telefone → conta → aparelhos → pedidos sem telefone → ...)
  for (let volta = 0, mudou = true; mudou && volta < 10; volta++) {
    mudou = false;
    for (const { d, p } of pedidos) {
      if (achadosP.has(d.id)) continue;
      if (ehTelefone(p.telefone) || (uidValido(p.userId) && (uids.has(p.userId) || ehUid(p.userId))) || (p.clienteId && contaIds.has(String(p.clienteId))) || pedidosDaConta.has(d.id)) {
        achadosP.set(d.id, { d, p }); mudou = true;
        if (p.clienteId) contaIds.add(String(p.clienteId));
        if (uidValido(p.userId)) uids.add(p.userId);
        if (normalizarTelefone(p.telefone)) telefones.add(canonico(p.telefone));
      }
    }
    for (const { d, c } of contas) {
      if (achadosC.has(d.id)) continue;
      const us = Array.isArray(c.uids) ? c.uids.filter(uidValido) : [];
      if (contaIds.has(d.id) || ehTelefone(c.telefone) || us.some((u) => uids.has(u) || ehUid(u))) {
        achadosC.set(d.id, { d, c }); mudou = true; contaIds.add(d.id);
        us.forEach((u) => uids.add(u));
        (Array.isArray(c.pedidos) ? c.pedidos : []).forEach((id) => pedidosDaConta.add(String(id)));
        if (normalizarTelefone(c.telefone)) telefones.add(canonico(c.telefone));
      }
    }
  }
  const perfilIds = new Set();
  for (const { p } of achadosP.values()) idsDoPerfil(p).forEach((id) => perfilIds.add(id));
  for (const { c } of achadosC.values()) if (c.crm) perfilIds.add(String(c.crm));
  const perfis = [];
  for (const d of perfilSnap.docs) {
    const m = Cofre.abrirCampos(d.data() || {}, tid);
    if (perfilIds.has(d.id) || ehTelefone(m.telefone)) { perfis.push(d.id); (Array.isArray(m.uids) ? m.uids : []).filter(uidValido).forEach((u) => uids.add(u)); }
  }
  rel.pedidos = [...achadosP.keys()]; rel.contas = [...achadosC.keys()]; rel.perfis = perfis; rel.uids = uids.size;
  const fora = new Set(perfis);

  // o que muda fora dos pedidos/contas (só conta aqui; grava lá embaixo)
  const painelRef = T.docDe(db, tid, 'analytics_previsoes/painel'), painel = await painelRef.get();
  const indice = painel.exists ? Cofre.abrirJSON((painel.data() || {}).indiceClientes, tid, 'indiceClientes', []) : [];
  rel.painel = Array.isArray(indice) ? indice.filter((c) => c && fora.has(c.id)).length : 0;
  const fretes = new Map();
  for (const { d, p } of achadosP.values()) if (p.entregaDia && p.entrega && p.entrega.frete) { if (!fretes.has(p.entregaDia)) fretes.set(p.entregaDia, []); fretes.get(p.entregaDia).push(d.id); }
  const espera = await T.tcol(db, tid, 'espera').get();
  const naEspera = (c) => c && ehTelefone(Cofre.abrir(c.tel, tid, 'telefone'));
  for (const d of espera.docs) rel.espera += (Array.isArray((d.data() || {}).clientes) ? d.data().clientes : []).filter(naEspera).length;
  rel.fretes = fretes.size;
  Object.defineProperty(rel, 'telefones', { value: telefones, enumerable: false });
  Object.defineProperty(rel, 'listaUids', { value: uids, enumerable: false });
  if (!gravar) return rel;

  // ---- gravar: cada documento que pode mudar no meio vai numa transação, trocando só os campos da pessoa ----
  const quando = agora.toISOString();
  for (const { d } of achadosP.values()) {
    await db.runTransaction(async (t) => {
      const s = await t.get(d.ref); if (!s.exists) return;
      const atual = s.data() || {};
      const campos = { nome: ANONIMO, telefone: '', quadra: '', lote: '', obs: '', condominio: '', condominioId: '', aceitaOfertas: false, userId: '', clienteId: '', dadosApagadosEm: quando };
      if (atual.entrega && atual.entrega.frete) campos.entrega = { ...atual.entrega, frete: { valor: atual.entrega.frete.valor, km: atual.entrega.frete.km } };
      t.update(d.ref, campos);
    });
  }
  const apagar = [...[...achadosC.values()].map(({ d }) => d.ref), ...perfis.map((id) => T.tdoc(db, tid, 'analytics_clientes', id)), ...[...uids].map((u) => T.tdoc(db, tid, 'analytics_uid', u))];
  for (let i = 0; i < apagar.length; i += 400) { const lote = db.batch(); apagar.slice(i, i + 400).forEach((r) => lote.delete(r)); await lote.commit(); }
  if (rel.painel) await db.runTransaction(async (t) => {
    const s = await t.get(painelRef); if (!s.exists) return;
    const ind = Cofre.abrirJSON((s.data() || {}).indiceClientes, tid, 'indiceClientes', []);
    if (Array.isArray(ind)) t.update(painelRef, { indiceClientes: Cofre.fecharJSON(ind.filter((c) => !(c && fora.has(c.id))), tid, 'indiceClientes') });
  });
  const contatosRef = T.tdoc(db, tid, 'crm', 'contatos');
  await db.runTransaction(async (t) => {
    const s = await t.get(contatosRef); if (!s.exists) return;
    const c = s.data() || {}, fica = Object.fromEntries(Object.entries(c).filter(([k]) => !fora.has(k)));
    if (Object.keys(fica).length !== Object.keys(c).length) t.set(contatosRef, fica);
  });
  for (const [dia, ids] of fretes) {
    const ref = T.docDe(db, tid, `fretes/${dia}`);
    await db.runTransaction(async (t) => {
      const s = await t.get(ref); if (!s.exists) return;
      const ps = { ...((s.data() || {}).pedidos || {}) }; let mudou = false;
      for (const id of ids) if (id in ps) { delete ps[id]; mudou = true; }
      if (mudou) t.update(ref, { pedidos: ps });
    });
  }
  for (const d of espera.docs) {
    await db.runTransaction(async (t) => {
      const s = await t.get(d.ref); if (!s.exists) return;
      const lista = Array.isArray((s.data() || {}).clientes) ? s.data().clientes : [], fica = lista.filter((c) => !naEspera(c));
      if (fica.length !== lista.length) t.update(d.ref, { clientes: fica });
    });
  }
  rel.gravado = true;
  return rel;
}

/** Anota a marca (HMAC) do telefone e dos aparelhos apagados. Devolve quantas marcas, ou 0 sem DADOS_CHAVE. */
async function guardarMarcas(db, tid, telefones, uids, agora = new Date()) {
  const k = chaveDasMarcas(); if (!k) return 0;
  const novas = {};
  for (const t of telefones) if (t) novas[marca(k, tid, 'tel', t)] = { loja: tid, tipo: 'tel', em: agora.toISOString() };
  for (const u of uids) if (uidValido(u)) novas[marca(k, tid, 'uid', u)] = { loja: tid, tipo: 'uid', em: agora.toISOString() };
  if (Object.keys(novas).length) await db.doc(DOC_MARCAS).set(novas, { merge: true });
  return Object.keys(novas).length;
}

/** Apaga por telefone (o pedido do cliente). Com gravar, também deixa a marca para depois de uma restauração. */
async function apagarCliente(db, tid, telefone, { gravar = false, agora = new Date() } = {}) {
  if (!(tid === T.TENANT_PADRAO || T.idValido(tid))) throw new Error('Loja inválida.');
  const fone = normalizarTelefone(telefone);
  if (!fone) throw new Error('Telefone inválido: use DDD + número (ex.: 62999990000).');
  const rel = await apagarPor(db, tid, { ehTelefone: (x) => mesmoTelefone(x, fone), gravar, agora });
  rel.telefone = fone.replace(/\d(?=\d{4})/g, '•');
  if (gravar) {
    rel.telefones.add(canonico(fone));
    rel.marcas = await guardarMarcas(db, tid, rel.telefones, rel.listaUids, agora);
    rel.aviso = rel.marcas ? EXPIRA : `${EXPIRA} SEM DADOS_CHAVE a marca não foi guardada: uma restauração traria esta pessoa de volta.`;
  }
  return rel;
}

/**
 * Depois de restaurar uma cópia: quem já pediu para apagar some de novo (pelas marcas de plataforma/lgpd_apagados).
 * Devolve { lojas: { id: relatório } } ou { semChave: true } quando há marcas e falta a DADOS_CHAVE.
 */
async function reaplicar(db, lojas, { agora = new Date() } = {}) {
  const s = await db.doc(DOC_MARCAS).get();
  const todas = s.exists ? s.data() || {} : {};
  const saida = { lojas: {}, marcas: Object.keys(todas).length };
  if (!saida.marcas) return saida;
  const k = chaveDasMarcas();
  if (!k) return { ...saida, semChave: true };
  const marcas = new Set(Object.keys(todas));
  for (const tid of lojas) {
    if (!Object.values(todas).some((m) => m && m.loja === tid)) continue;
    const r = await apagarPor(db, tid, {
      ehTelefone: (x) => { const c = canonico(x); return !!c && marcas.has(marca(k, tid, 'tel', c)); },
      ehUid: (u) => marcas.has(marca(k, tid, 'uid', u)), gravar: true, agora,
    });
    if (r.pedidos.length || r.contas.length || r.perfis.length || r.espera) saida.lojas[tid] = r;
  }
  return saida;
}

module.exports = { apagarCliente, apagarPor, reaplicar, guardarMarcas, normalizarTelefone, mesmoTelefone, canonico, idsDoPerfil, ANONIMO, DOC_MARCAS, EXPIRA };
