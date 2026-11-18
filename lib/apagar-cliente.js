'use strict';
// =====================================================================
//  lib/apagar-cliente.js — PEDIDO DO CLIENTE PARA APAGAR OS DADOS (LGPD, art. 18), POR TELEFONE, NUMA LOJA.
//
//  Quem usa é scripts/apagar-cliente.js (no servidor, com confirmação). Sem `gravar`, só mostra o que faria.
//
//  O QUE FAZ, SÓ NA LOJA ESCOLHIDA
//   - pedidos com aquele telefone: ANONIMIZA nome, telefone, endereço (quadra, lote, condomínio), observação, ligação
//     com a conta e o aparelho, consentimento de ofertas e a rota do frete. FICAM: itens, valores, pagamento, datas e
//     situação (o caixa, o fechamento e a contabilidade da loja continuam batendo);
//   - contas do cliente (contas/{id}): apagadas (a ligada aos pedidos e qualquer outra com o mesmo telefone);
//   - perfil do motor de previsão (analytics_clientes/{id}) e as ligações dele (analytics_uid/{uid}): apagados.
//     O endereço dos pedidos sumiu, então a rotina da noite não refaz o perfil;
//   - marca de "já contatado" da aba Clientes (crm/contatos) e o ponto no mapa do frete (fretes/{dia});
//   - lista de "me avise quando chegar" (espera/{produto}): o telefone sai.
//  O QUE NÃO ALCANÇA (dizer ao cliente): as cópias de segurança já feitas (expiram em até 60 dias), as mensagens no
//  WhatsApp da loja (apagar no aparelho) e o que está no Asaas/PagBank (registro de pagamento: a lei obriga a guardar).
// =====================================================================
const T = require('./tenant');
const Cofre = require('./cofre');
const N = require('../analytics/normalize');

const ANONIMO = 'Cliente (dados apagados)';

/** Só os dígitos, sem o 55 do país. '' quando não parece telefone brasileiro com DDD. */
function normalizarTelefone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return /^[1-9]\d\d{8,9}$/.test(d) ? d : '';
}
/** O mesmo número, com ou sem o 9 da frente do celular (cadastro antigo às vezes vem sem). */
function mesmoTelefone(a, b) {
  const x = normalizarTelefone(a), y = normalizarTelefone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const sem9 = (d) => (d.length === 11 && d[2] === '9' ? d.slice(0, 2) + d.slice(3) : d);
  return sem9(x) === sem9(y);
}

const idsDoPerfil = (p) => {
  const ids = new Set();
  for (const cond of [N.normCond(p.condominio), '']) { const k = N.chaveCliente({ ...p, id: 'x' }, cond); if (!k.startsWith('ped:')) ids.add(N.idDeChave(k)); }
  return ids;
};

/**
 * Procura e (com gravar: true) apaga/anonimiza. Devolve o relatório:
 * { telefone, pedidos: [ids], contas: [ids], perfis: [ids], uids: n, fretes: n, espera: n, gravado }
 */
async function apagarCliente(db, tid, telefone, { gravar = false, agora = new Date() } = {}) {
  if (!(tid === T.TENANT_PADRAO || T.idValido(tid))) throw new Error('Loja inválida.');
  const fone = normalizarTelefone(telefone);
  if (!fone) throw new Error('Telefone inválido: use DDD + número (ex.: 62999990000).');
  const rel = { loja: tid, telefone: fone.replace(/\d(?=\d{4})/g, '•'), pedidos: [], contas: [], perfis: [], uids: 0, fretes: 0, espera: 0, gravado: false };
  const escritas = [];                                          // [ref, dados | null (apagar)]
  const contaIds = new Set(), perfilIds = new Set(), uids = new Set(), fretes = new Map();

  // 1. pedidos (o telefone está cifrado: abre um por um)
  const pedidos = await T.tcol(db, tid, 'pedidos').get();
  for (const d of pedidos.docs) {
    const bruto = d.data() || {}, p = Cofre.abrirCampos(bruto, tid);
    if (!mesmoTelefone(p.telefone, fone)) continue;
    rel.pedidos.push(d.id);
    if (p.clienteId) contaIds.add(String(p.clienteId));
    if (p.userId && p.userId !== 'anonimo') uids.add(String(p.userId));
    idsDoPerfil(p).forEach((id) => perfilIds.add(id));
    if (p.entregaDia && p.entrega && p.entrega.frete) { if (!fretes.has(p.entregaDia)) fretes.set(p.entregaDia, []); fretes.get(p.entregaDia).push(d.id); }
    const novo = { ...bruto, nome: ANONIMO, telefone: '', quadra: '', lote: '', obs: '', condominio: '', condominioId: '', aceitaOfertas: false, userId: '', clienteId: '', dadosApagadosEm: agora.toISOString() };
    if (novo.entrega && novo.entrega.frete) novo.entrega = { ...novo.entrega, frete: { valor: novo.entrega.frete.valor, km: novo.entrega.frete.km } };
    escritas.push([d.ref, novo]);
  }

  // 2. contas: as ligadas aos pedidos e qualquer outra com o mesmo telefone
  const contas = await T.tcol(db, tid, 'contas').get();
  for (const d of contas.docs) {
    const c = Cofre.abrirCampos(d.data() || {}, tid);
    if (!contaIds.has(d.id) && !mesmoTelefone(c.telefone, fone)) continue;
    rel.contas.push(d.id);
    (Array.isArray(c.uids) ? c.uids : []).forEach((u) => uids.add(String(u)));
    if (c.crm) perfilIds.add(String(c.crm));
    escritas.push([d.ref, null]);
  }

  // 3. perfil do motor de previsão (pelo endereço dos pedidos ou pelo telefone guardado nele)
  const perfis = await T.tcol(db, tid, 'analytics_clientes').get();
  for (const d of perfis.docs) {
    const m = Cofre.abrirCampos(d.data() || {}, tid);
    if (!perfilIds.has(d.id) && !mesmoTelefone(m.telefone, fone)) continue;
    rel.perfis.push(d.id);
    (Array.isArray(m.uids) ? m.uids : []).forEach((u) => uids.add(String(u)));
    escritas.push([d.ref, null]);
  }
  for (const u of uids) if (u && !u.includes('/')) { escritas.push([T.tdoc(db, tid, 'analytics_uid', u), null]); rel.uids++; }

  // 4. "já contatado" da aba Clientes
  const contatos = await T.tdoc(db, tid, 'crm', 'contatos').get();
  if (contatos.exists) {
    const c = contatos.data() || {}, fica = Object.fromEntries(Object.entries(c).filter(([k]) => !rel.perfis.includes(k) && !perfilIds.has(k)));
    if (Object.keys(fica).length !== Object.keys(c).length) escritas.push([contatos.ref, fica]);
  }

  // 5. ponto do frete no mapa do dia
  for (const [dia, ids] of fretes) {
    const s = await T.docDe(db, tid, `fretes/${dia}`).get();
    if (!s.exists) continue;
    const f = s.data() || {}, ps = { ...(f.pedidos || {}) };
    let mudou = false; for (const id of ids) if (id in ps) { delete ps[id]; mudou = true; }
    if (mudou) { escritas.push([s.ref, { ...f, pedidos: ps }]); rel.fretes++; }
  }

  // 6. "me avise quando chegar"
  const espera = await T.tcol(db, tid, 'espera').get();
  for (const d of espera.docs) {
    const e = d.data() || {}, lista = Array.isArray(e.clientes) ? e.clientes : [];
    const fica = lista.filter((c) => !(c && mesmoTelefone(Cofre.abrir(c.tel, tid, 'telefone'), fone)));
    if (fica.length !== lista.length) { escritas.push([d.ref, { ...e, clientes: fica }]); rel.espera += lista.length - fica.length; }
  }

  if (!gravar) return rel;
  for (let i = 0; i < escritas.length; i += 400) {
    const lote = db.batch();
    escritas.slice(i, i + 400).forEach(([ref, dados]) => (dados === null ? lote.delete(ref) : lote.set(ref, dados)));
    await lote.commit();
  }
  rel.gravado = true;
  return rel;
}

module.exports = { apagarCliente, normalizarTelefone, mesmoTelefone, ANONIMO };
