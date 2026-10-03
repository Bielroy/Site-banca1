'use strict';
// =====================================================================
//  analytics/normalize.js — DADOS → estrutura limpa para análise.
//
//  Decisões ancoradas no código real do projeto:
//   • pedidos.data é ISO em UTC  → convertemos para o DIA em Brasília.
//   • pedidos.userId é uid ANÔNIMO do Firebase (muda por aparelho) e o
//     telefone é opcional → "cliente" = unidade de entrega (quadra+lote).
//     Nada é gravado no checkout: a identidade é derivada do que já existe.
//   • itens "a pesar" têm qtd em UNIDADES e o kg real só aparece em
//     pesoFinal (admin.js, fechamento da esteira) → convertemos tudo para a
//     unidade de venda do produto (kg, un, maço...).
//   • pedidos cancelados saem; arquivados ENTRAM (arquivar = concluir).
//   • duas compras do mesmo cliente no mesmo dia viram UMA visita.
// =====================================================================
const crypto = require('crypto');
const C = require('./config');
const { median } = require('./stats');

const DIA_MS = 86400000;
const diaDeTs = (ts) => Math.floor((ts + C.TZ_OFFSET_HORAS * 3600000) / DIA_MS);
const isoDeDia = (d) => new Date(d * DIA_MS).toISOString().slice(0, 10);
const diaDeIso = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DIA_MS);
const dowDeDia = (d) => (((d + 4) % 7) + 7) % 7;          // 0=domingo (1970-01-01 foi quinta)
const semanaDeDia = (d) => Math.floor((d + 3) / 7);       // semanas começam na segunda

const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro']; // = api/checkout.js
const ehFracionavel = (u) => FRACIONAVEIS.includes(String(u || '').toLowerCase());

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// "Quadra 05" / "Q5" / "5" → "5"
const normEnd = (s) => {
  let t = semAcento(s).replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.replace(/^(quadra|qd|lote|lt|q|l)\s*(?=\d)/, '').trim();
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t;
};

const chaveCliente = (p) => {
  const q = normEnd(p.quadra), l = normEnd(p.lote);
  return q || l ? `end:${q}|${l}` : `ped:${p.id || Math.random()}`;
};
const idDeChave = (k) => 'c_' + crypto.createHash('sha1').update(k).digest('hex').slice(0, 12);

// Quantidade na unidade de venda do produto
const qtdItem = (it) => {
  const q = Number(String(it.qtd).replace(',', '.'));
  if (!Number.isFinite(q) || q <= 0) return null;
  if (!ehFracionavel(it.unidade)) return { qtd: q, un: q, estimada: false };
  if (it.tipo === 'un') {
    const pf = Number(it.pesoFinal);
    if (pf > 0) return { qtd: pf, un: q, estimada: false, kgPorUn: pf / q };
    return { qtd: null, un: q, estimada: true };            // ainda não pesado
  }
  return { qtd: q, un: q, estimada: false };                // tipo 'kg'
};

/**
 * @param {Array} pedidos   docs de `pedidos` (com id)
 * @param {Array} catalogo  docs de `produtos` (com id)
 */
function normalizarPedidos(pedidos, catalogo = []) {
  const produtos = new Map();
  catalogo.forEach((p) => produtos.set(p.id, {
    id: p.id, nome: p.nome || p.id, cat: semAcento(p.cat) || 'outros',
    unidade: p.unidade || 'un', foto: p.foto || '', preco: Number(p.preco) || 0,
    estoque: p.estoqueFisico === '' || p.estoqueFisico == null ? null : Number(p.estoqueFisico),
    ativo: p.ativo !== false, noCatalogo: true,
  }));

  const validos = [];
  for (const p of pedidos || []) {
    if (!p || p.status === 'cancelado') continue;
    const ts = Date.parse(p.data);
    if (!Number.isFinite(ts) || !Array.isArray(p.itens) || !p.itens.length) continue;
    validos.push({ ...p, _ts: ts, _dia: diaDeTs(ts) });
  }
  validos.sort((a, b) => a._ts - b._ts);

  // 1ª passada: quantos kg pesa, em média, 1 unidade de cada produto fracionável
  const amostrasKg = new Map();
  for (const p of validos) for (const it of p.itens) {
    if (!it || !it.id) continue;                 // item estragado no banco não derruba o cálculo inteiro
    const r = qtdItem(it);
    if (r && r.kgPorUn) { if (!amostrasKg.has(it.id)) amostrasKg.set(it.id, []); amostrasKg.get(it.id).push(r.kgPorUn); }
  }
  const kgPorUn = new Map();
  for (const [id, arr] of amostrasKg) if (arr.length >= C.KG_POR_UN_MIN_OBS) kgPorUn.set(id, median(arr));

  const clientes = new Map();          // id → {id, nome, quadra, lote, uids:Set, visitas:Map(dia→visita)}
  const vendasDia = new Map();         // produtoId → Map(dia → qtd)
  const pedidosDia = new Map();        // dia → nº de visitas
  const visitasVistas = new Set();
  let primeiroDia = Infinity, ultimoDia = -Infinity;

  for (const p of validos) {
    const chave = chaveCliente(p); const cid = idDeChave(chave);
    if (!clientes.has(cid)) clientes.set(cid, { id: cid, nome: '', quadra: '', lote: '', uids: new Set(), visitas: new Map() });
    const cli = clientes.get(cid);
    cli.nome = p.nome || cli.nome; cli.quadra = p.quadra || cli.quadra; cli.lote = p.lote || cli.lote;   // o mais recente vence
    if (p.userId && p.userId !== 'anonimo') cli.uids.add(p.userId);

    if (!cli.visitas.has(p._dia)) cli.visitas.set(p._dia, { dia: p._dia, ts: p._ts, itens: new Map() });
    const vis = cli.visitas.get(p._dia);
    const vk = `${cid}|${p._dia}`;
    if (!visitasVistas.has(vk)) { visitasVistas.add(vk); pedidosDia.set(p._dia, (pedidosDia.get(p._dia) || 0) + 1); }
    primeiroDia = Math.min(primeiroDia, p._dia); ultimoDia = Math.max(ultimoDia, p._dia);

    for (const it of p.itens) {
      if (!it || !it.id) continue;
      const r = qtdItem(it); if (!r) continue;
      let qtd = r.qtd, estimada = r.estimada;
      if (qtd == null && kgPorUn.has(it.id)) { qtd = r.un * kgPorUn.get(it.id); estimada = true; }
      if (!produtos.has(it.id)) produtos.set(it.id, { id: it.id, nome: it.nome || it.id, cat: 'outros', unidade: it.unidade || 'un', foto: '', preco: Number(it.preco) || 0, estoque: null, ativo: false, noCatalogo: false });

      const atual = vis.itens.get(it.id) || { qtd: 0, conhecida: false, estimada: false };
      if (qtd != null) { atual.qtd += qtd; atual.conhecida = true; }
      atual.estimada = atual.estimada || estimada;
      vis.itens.set(it.id, atual);

      if (qtd != null) {
        if (!vendasDia.has(it.id)) vendasDia.set(it.id, new Map());
        const m = vendasDia.get(it.id); m.set(p._dia, (m.get(p._dia) || 0) + qtd);
      }
    }
  }

  const lista = [...clientes.values()].map((c) => ({
    ...c, visitas: [...c.visitas.values()].sort((a, b) => a.dia - b.dia),
  }));
  return { clientes: lista, produtos, vendasDia, pedidosDia, primeiroDia, ultimoDia, kgPorUn, nPedidos: validos.length };
}

module.exports = {
  DIA_MS, diaDeTs, isoDeDia, diaDeIso, dowDeDia, semanaDeDia,
  ehFracionavel, normEnd, semAcento, normalizarPedidos, qtdItem, idDeChave, chaveCliente,
};
