// =====================================================================
//  api/analytics.js — Motor de demanda, recomendação e previsão (v1)
//
//  UMA função serve tudo (o plano Hobby da Vercel limita o nº de funções):
//
//   GET  (cron da Vercel, com Authorization: Bearer CRON_SECRET)
//        → recalcula tudo.
//   POST { acao: 'ranking', cesta?: [ids] }        qualquer cliente logado (anônimo vale)
//        → ranking PERSONALIZADO do próprio cliente (uid do token).
//   POST { acao: 'painel' }                        só admin
//   POST { acao: 'cliente', clienteId }            só admin  → explicação por cliente
//   POST { acao: 'recalcular', janelaDias? }       só admin  (janelaDias até 900 = backfill)
//
//  VARIÁVEIS: as mesmas do checkout (FIREBASE_*) + CRON_SECRET (recomendada).
//  Segurança: admin = custom claim `admin === true` no token (mesmo critério
//  do js/admin-guard.js). Nenhuma rota devolve dados de um cliente a outro.
// =====================================================================
const admin = require('firebase-admin');
const Store = require('../analytics/store');
const { montarRankingCliente } = require('../analytics/publicApi');
const K = require('../analytics/ranking');
const { diaDeTs, isoDeDia } = require('../analytics/normalize');

const ORIGENS_CONFIAVEIS = [
  'https://www.bancaadairepedrina.com.br',
  'https://bancaadairepedrina.com.br',
  'https://site-banca1.vercel.app',
];
const aplicarCors = (req, res) => {
  const extras = String(process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const permitidas = ORIGENS_CONFIAVEIS.concat(extras);
  const origem = req.headers && req.headers.origin;
  if (origem && permitidas.indexOf(origem) !== -1) res.setHeader('Access-Control-Allow-Origin', origem);
  else if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') res.setHeader('Access-Control-Allow-Origin', '*');
  else res.setHeader('Access-Control-Allow-Origin', permitidas[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// rate limit leve por uid (em memória; suficiente p/ evitar martelar o Firestore)
const ultimo = new Map();
const limitar = (chave, ms) => {
  const agora = Date.now();
  for (const [k, t] of ultimo) if (agora - t > 60000) ultimo.delete(k);
  if (ultimo.has(chave) && agora - ultimo.get(chave) < ms) return false;
  ultimo.set(chave, agora); return true;
};

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};

module.exports = async function handler(req, res) {
  aplicarCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let db;
  try { db = Store.obterDb(); } catch (e) { return res.status(500).json({ sucesso: false, error: 'Erro interno de configuração.' }); }

  try {
    // ------------------------- CRON -------------------------
    if (req.method === 'GET') {
      const segredo = process.env.CRON_SECRET;
      if (!segredo || tokenDe(req) !== segredo) return res.status(401).json({ sucesso: false, error: 'Não autorizado.' });
      const r = await Store.recalcular(db, { forcar: true });
      return res.status(200).json({ sucesso: true, cron: true, ...resumo(r) });
    }
    if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método não permitido.' });

    // ------------------------- AUTENTICAÇÃO -------------------------
    const token = tokenDe(req);
    if (!token) return res.status(401).json({ sucesso: false, error: 'Faça login para continuar.' });
    let dec;
    try { dec = await admin.auth().verifyIdToken(token); }
    catch (e) { return res.status(401).json({ sucesso: false, error: 'Sessão inválida.' }); }
    const ehAdmin = dec.admin === true;
    const corpo = req.body || {};
    const acao = String(corpo.acao || '');

    // ------------------------- CLIENTE DA LOJA -------------------------
    if (acao === 'ranking') {
      if (!limitar('r:' + dec.uid, 1500)) return res.status(429).json({ sucesso: false, error: 'Aguarde um instante.' });
      const [g, modelo] = await Promise.all([Store.lerGlobal(db), Store.lerClientePorUid(db, dec.uid)]);
      const out = montarRankingCliente({ modelo, G: g && g.global, catalogo: g && g.catalogo, cesta: corpo.cesta });
      return res.status(200).json({ sucesso: true, geradoEm: g && g.meta ? g.meta.geradoEm : null, ...out });
    }

    // ------------------------- ADMIN -------------------------
    if (!ehAdmin) return res.status(403).json({ sucesso: false, error: 'Acesso restrito ao administrador.' });

    if (acao === 'painel') {
      const p = await Store.lerPainel(db);
      return res.status(200).json({ sucesso: true, vazio: !p, ...(p || {}) });
    }

    if (acao === 'recalcular') {
      if (!limitar('recalc', 8000)) return res.status(429).json({ sucesso: false, error: 'Um cálculo acabou de rodar.' });
      const janela = Math.min(Math.max(parseInt(corpo.janelaDias, 10) || 0, 0), 900) || undefined;
      const r = await Store.recalcular(db, { janelaDias: janela, forcar: true });
      return res.status(200).json({ sucesso: true, ...resumo(r) });
    }

    if (acao === 'cliente') {
      const [g, m] = await Promise.all([Store.lerGlobal(db), Store.lerClientePorId(db, corpo.clienteId)]);
      if (!m || !g) return res.status(404).json({ sucesso: false, error: 'Cliente sem perfil calculado.' });
      const hoje = diaDeTs(Date.now());
      const catalogo = new Map(Object.entries(g.catalogo || {}).map(([id, c]) => [id, { id, nome: c.nome, unidade: c.un, cat: c.cat }]));
      const ativos = new Set(Object.entries(g.catalogo || {}).filter(([, c]) => c.ativo !== false).map(([id]) => id));
      const itens = K.pontuarCliente(m, g.global, hoje, { produtos: catalogo, ativos, explicar: 12 }).slice(0, 12)
        .map((o) => ({ id: o.id, nome: (g.catalogo[o.id] || {}).nome || o.id, p: Math.round(o.p * 100) / 100, conf: Math.round(o.conf * 100) / 100, confRotulo: K.rotuloConfianca(o.conf), qtd: o.qtd, motivos: o.motivos, tags: o.tags }));
      const perfil = {
        nome: m.nome, quadra: m.quadra, lote: m.lote, nivel: m.nivel, pedidos: m.nVisitas, ultimaCompra: isoDeDia(m.ultimoDia),
        intervaloMedioDias: m.nuMedia, intervaloMedianoDias: m.nuMed, intervaloDesvio: m.nuDp, diaMaisFrequente: K.NOMES_DOW[m.dowTop],
        juntos: (m.juntos || []).map((j) => ({ a: (g.catalogo[j.a] || {}).nome || j.a, b: (g.catalogo[j.b] || {}).nome || j.b, n: j.n })),
        abandonados: Object.entries(m.prod).filter(([, p]) => p.abandonado).map(([id]) => (g.catalogo[id] || {}).nome || id),
        novos: Object.entries(m.prod).filter(([, p]) => p.novo).map(([id]) => (g.catalogo[id] || {}).nome || id),
        alternados: Object.entries(m.prod).filter(([, p]) => p.alt).map(([id, p]) => ({ nome: (g.catalogo[id] || {}).nome || id, acada: p.alt })),
      };
      return res.status(200).json({ sucesso: true, perfil, itens });
    }

    return res.status(400).json({ sucesso: false, error: 'Ação desconhecida.' });
  } catch (e) {
    console.error('[analytics]', e);
    return res.status(500).json({ sucesso: false, error: 'Não foi possível processar agora.' });
  }
};

function resumo(r) {
  if (r.pulado) return { pulado: true, mensagem: 'Já existe um cálculo recente ou em andamento.' };
  const m = r.meta;
  return { pulado: false, duracaoMs: m.duracaoMs, pedidos: m.nPedidos, clientes: m.nClientes, avisos: m.avisos, truncado: !!r.truncado, gravado: r.gravado };
}

