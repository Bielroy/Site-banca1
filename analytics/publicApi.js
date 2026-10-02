'use strict';
// =====================================================================
//  analytics/publicApi.js — o que o CLIENTE DA LOJA pode ver (módulo 22).
//
//  PRIVACIDADE: a resposta contém SÓ o ranking do PRÓPRIO cliente (id do
//  produto, probabilidade arredondada e um motivo curto). Nunca devolve
//  nome, endereço, intervalos, histórico, nem dados de outro cliente.
//  A identidade vem do uid do TOKEN verificado (api/analytics.js) — nunca
//  de um parâmetro enviado pelo navegador (senão bastaria "adivinhar" um
//  clienteId/endereço para espiar o padrão de compra de um vizinho).
// =====================================================================
const K = require('./ranking');
const { diaDeTs } = require('./normalize');

function montarRankingCliente({ modelo, G, catalogo, cesta, agora = Date.now(), limite = 120 }) {
  if (!G) return { nivel: 'sem_dados', itens: [] };
  const hoje = diaDeTs(agora);
  const produtos = new Map(Object.entries(catalogo || {}).map(([id, c]) => [id, { id, nome: c.nome, unidade: c.un, cat: c.cat }]));
  const ativos = new Set(Object.entries(catalogo || {}).filter(([, c]) => c.ativo !== false).map(([id]) => id));
  const cestaValida = Array.isArray(cesta) ? cesta.filter((x) => typeof x === 'string' && x.length < 80).slice(0, 40) : [];
  const r = K.pontuarCliente(modelo || null, G, hoje, { produtos, ativos, cesta: cestaValida, explicar: 12 });
  const itens = r.slice(0, limite).map((o) => ({
    id: o.id, p: Math.round(o.p * 100) / 100,
    ...(o.motivoCurto ? { motivo: o.motivoCurto } : {}),
    ...(o.tags && o.tags.includes('repor') ? { repor: true } : {}),
  }));
  return { nivel: modelo ? modelo.nivel : 'sem_historico', itens };
}

module.exports = { montarRankingCliente };

