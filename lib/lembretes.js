'use strict';
// =====================================================================
//  lib/lembretes.js — AVISOS QUE O SERVIDOR MANDA SOZINHO (sem ninguém ter feito nada na hora).
//  Roda de 3 em 3 minutos dentro do servidor (server/index.js). Só mexe em loja que tem aparelho com aviso ligado.
//
//    Pedido esperando  pedido que continua "pendente" depois de 10 min vira UM lembrete (segunda chance caso o
//                      primeiro aviso tenha passado batido). Marca o pedido com lembreteEm: nunca repete.
//                      Só lê os pedidos feitos nas últimas 6 h (o parado há mais tempo não vira lembrete e nem é lido).
//    Estoque baixo     uma vez por dia, entre 7h e 10h (Brasília): resumo do que está zerado ou abaixo do mínimo.
//
//  Tudo respeita as preferências de cada aparelho (tipos 'lembrete' e 'estoque' em lib/avisos.js).
// =====================================================================
const T = require('./tenant');
const Avisos = require('./avisos');

const MIN_PARADO = 10 * 60000, MAX_PARADO = 6 * 3600000;
const STATUS_ESPERANDO = ['pendente', 'aguardando_pesagem'];
const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const horaBr = (agora) => new Date(agora - 3 * 3600000).getUTCHours();
const diaBr = (agora) => new Date(agora - 3 * 3600000).toISOString().slice(0, 10);
const urlPainel = (tid) => (tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`);

/** Mesma regra de js/estoque-lib.js (situacao): 'zerado' | 'baixo' | outro. */
const situacaoDoEstoque = (p) => {
  const atual = num(p.estoqueFisico), min = num(p.estoqueMin);
  if (atual === null) return 'sem-controle';
  if (atual <= 0) return 'zerado';
  return min !== null && atual < min ? 'baixo' : 'ok';
};

// CUSTO: antes a volta lia TODOS os pedidos 'pendente' e 'aguardando_pesagem' da loja, de 3 em 3 minutos, para sempre
// (pedido esquecido nesses status era relido o dia inteiro, todo dia). Agora a consulta já vem só com os pedidos feitos
// dentro da janela do lembrete (de 10 min a 6 h atrás, pelo campo `data`): pedido parado há mais tempo (inclusive os de
// mais de 48 h) nem é lido. É um filtro de UM campo só, que o Firestore atende sem índice composto.
async function pedidosEsperando(db, tid, agora) {
  const achados = [];
  const s = await T.tcol(db, tid, 'pedidos')
    .where('data', '>=', new Date(agora - MAX_PARADO).toISOString())
    .where('data', '<=', new Date(agora - MIN_PARADO).toISOString()).get();
  for (const d of s.docs) {
    const p = d.data(), t = Date.parse(p.data);
    if (!STATUS_ESPERANDO.includes(p.status) || p.lembreteEm || !Number.isFinite(t) || agora - t < MIN_PARADO || agora - t > MAX_PARADO) continue;
    achados.push({ ref: d.ref, minutos: Math.floor((agora - t) / 60000), total: Number(p.total) || 0 });
  }
  return achados;
}

async function lembrarPedidos(db, tid, agora) {
  const achados = await pedidosEsperando(db, tid, agora);
  if (!achados.length) return 0;
  // marca ANTES de avisar: se o servidor reiniciar no meio, o lembrete se perde em vez de repetir de 3 em 3 minutos
  await Promise.all(achados.map((a) => a.ref.set({ lembreteEm: new Date(agora).toISOString() }, { merge: true })));
  const mais = Math.max(...achados.map((a) => a.minutos));
  await Avisos.avisarLoja(db, tid, {
    titulo: achados.length === 1 ? `Pedido esperando há ${mais} min` : `${achados.length} pedidos esperando`,
    corpo: achados.length === 1 ? `${achados[0].total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ainda não foi atendido.` : `O mais antigo está há ${mais} min sem atendimento.`,
    url: urlPainel(tid), tag: `lembrete-${tid}`, tipo: 'lembrete',
  });
  return achados.length;
}

async function resumoDeEstoque(db, tid, agora) {
  const h = horaBr(agora); if (h < 7 || h >= 10) return 0;
  const marca = T.docDe(db, tid, 'loja/avisosEstado'), hoje = diaBr(agora);
  if ((((await marca.get()).data()) || {}).estoqueDia === hoje) return 0;
  await marca.set({ estoqueDia: hoje }, { merge: true });                 // marca antes: um aviso por dia, mesmo que reinicie
  const s = await T.tcol(db, tid, 'produtos').get();
  const lista = s.docs.map((d) => d.data()).filter((p) => p.ativo !== false && ['zerado', 'baixo'].includes(situacaoDoEstoque(p)));
  if (!lista.length) return 0;
  lista.sort((a, b) => (situacaoDoEstoque(a) === 'zerado' ? 0 : 1) - (situacaoDoEstoque(b) === 'zerado' ? 0 : 1));
  const nomes = lista.slice(0, 3).map((p) => String(p.nome || '').slice(0, 24)).join(', ');
  await Avisos.avisarLoja(db, tid, {
    titulo: lista.length === 1 ? 'Estoque: 1 produto para repor' : `Estoque: ${lista.length} produtos para repor`,
    corpo: `${nomes}${lista.length > 3 ? ` e mais ${lista.length - 3}` : ''}`, url: urlPainel(tid), tag: `estoque-${tid}`, tipo: 'estoque',
  });
  return lista.length;
}

// TRAVA: uma volta de cada vez. Com muitas lojas (ou o banco lento) uma volta pode passar dos 3 minutos; antes a próxima
// começava por cima e as duas liam tudo em dobro. Se a anterior ainda está rodando, esta é pulada.
// (Se uma volta travar de vez, depois de 15 min a trava é ignorada, para os lembretes não pararem para sempre.)
const TRAVA_MAX_MS = 15 * 60000;
let rodandoDesde = 0;

/** Uma volta: passa por todas as lojas que têm aparelho com aviso. Nunca lança erro. */
async function rodar(db, agora = Date.now()) {
  if (!Avisos.ligado()) return { lojas: 0 };
  const inicio = Date.now();
  if (rodandoDesde && inicio - rodandoDesde < TRAVA_MAX_MS) return { lojas: 0, pulou: true };
  rodandoDesde = inicio;
  try { return await umaVolta(db, agora); }
  finally { if (rodandoDesde === inicio) rodandoDesde = 0; }
}

async function umaVolta(db, agora) {
  let lojas = 0;
  try {
    for (const tid of await T.listarLojas(db)) {
      try {
        if (!(await T.tcol(db, tid, 'avisos').limit(1).get()).size) continue;
        lojas++;
        const h = horaBr(agora);
        if (h >= 6 && h < 23) await lembrarPedidos(db, tid, agora);
        await resumoDeEstoque(db, tid, agora);
      } catch (e) { console.error('[lembretes]', tid, e && e.message); }
    }
  } catch (e) { console.error('[lembretes]', e && e.message); }
  return { lojas };
}

module.exports = { rodar, lembrarPedidos, resumoDeEstoque, situacaoDoEstoque, pedidosEsperando, MIN_PARADO, MAX_PARADO };
