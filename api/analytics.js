// =====================================================================
//  api/analytics.js — Motor de demanda, recomendação e previsão (v1)
//
//  UMA função serve tudo (o plano Hobby da Vercel limita o nº de funções):
//
//   GET  (cron da Vercel, com Authorization: Bearer CRON_SECRET)
//        → recalcula tudo.
//   POST { acao: 'ranking', cesta?: [ids] }        qualquer cliente logado (anônimo vale)
//        → ranking PERSONALIZADO do próprio cliente (uid do token).
//   POST { acao: 'painel', atualizar? }            só admin  (atualizar: recalcula antes se há pedido novo)
//   POST { acao: 'cliente', clienteId }            só admin  → explicação por cliente
//   POST { acao: 'recalcular', janelaDias? }       só admin  (janelaDias até 900 = backfill)
//   POST { acao: 'erro', msg, arquivo, linha, ... } SEM login: erro que aconteceu no navegador (lib/erros.js)
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
const T = require('../lib/tenant');
const P = require('../lib/prudencia');
const Maq = require('../lib/maquininha');
const Erros = require('../lib/erros');

// Origem (CORS): a lista de endereços nossos fica num lugar só, lib/http.js.
const H = require('../lib/http');
const aplicarCors = H.cors;

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

  let db, banco;
  try { banco = Store.obterDb(); db = banco; } catch (e) { return res.status(500).json({ sucesso: false, error: 'Erro interno de configuração.' }); }

  try {
    // ------------------------- CRON -------------------------
    if (req.method === 'GET') {
      const segredo = process.env.CRON_SECRET;
      if (!segredo || !H.igualSeguro(tokenDe(req), segredo)) return res.status(401).json({ sucesso: false, error: 'Não autorizado.' });
      // Rotina diária, em ETAPAS, cada uma com o seu prazo (a função tem 60 s):
      //   1. CÓPIA DE SEGURANÇA de cada loja (o mais importante: vem primeiro), até 25 s;
      //   2. vendas da MAQUININHA de ontem, até 35 s;
      //   3. RECÁLCULO de cada loja (previsão, ranking), até 48 s desde o começo;
      //   4. faxinas (rápidas) com o que sobra.
      // A ordem das lojas gira a cada dia: quem ficou por último hoje sai na frente amanhã.
      // O que ficar de fora é anotado e vira aviso. (As lojas também recalculam sozinhas quando o painel abre.)
      const inicio = Date.now(), PRAZO_COPIAS_MS = 25000, PRAZO_MAQUININHA_MS = 35000, PRAZO_RECALCULO_MS = 48000;
      const todas = await T.listarLojas(banco), saida = {}, semCopia = [], puladas = [];
      const giro = todas.length ? Math.floor(Date.now() / 86400000) % todas.length : 0;
      const lojas = todas.slice(giro).concat(todas.slice(0, giro));
      for (const id of lojas) {
        saida[id] = {};
        if (Date.now() - inicio > PRAZO_COPIAS_MS) { semCopia.push(id); saida[id].copia = { pulada: true }; continue; }
        try { saida[id].copia = await P.copiar(banco, id); }
        catch (e) { console.error('[copia] loja', id, e && e.message); saida[id].copia = { erro: true }; await P.avisarFalha(banco, id, 'A cópia de segurança', e); }
      }
      // MAQUININHA: as vendas de ontem (o PagBank só entrega no dia seguinte), até 35 s. Loja sem credenciais é pulada.
      const ontem = new Date(Date.now() - 27 * 3600000).toISOString().slice(0, 10), maquininha = {};
      for (const id of lojas) {
        if (Date.now() - inicio > PRAZO_MAQUININHA_MS) { maquininha[id] = { pulada: true }; continue; }
        try { const m = await Maq.buscarDia(banco, id, ontem); if (m) maquininha[id] = { dia: m.dia, total: m.total, vendas: m.vendas }; }
        catch (e) { console.error('[maquininha] loja', id, e && e.message); maquininha[id] = { erro: true }; }
      }
      for (const id of lojas) {
        if (Date.now() - inicio > PRAZO_RECALCULO_MS) { puladas.push(id); saida[id] = { ...saida[id], pulada: true }; continue; }
        try { saida[id] = { ...resumo(await Store.recalcular(T.escopo(banco, id), { forcar: true })), copia: saida[id].copia }; }
        catch (e) { console.error('[analytics] loja', id, e); saida[id] = { ...saida[id], erro: true }; }
      }
      if (puladas.length || semCopia.length) {
        console.warn('[analytics] sem tempo:', { semCopia, puladas });
        const partes = [semCopia.length ? `${semCopia.length} sem cópia de segurança hoje` : '', puladas.length ? `${puladas.length} sem recálculo` : ''].filter(Boolean).join(' e ');
        try { await P.alertar(banco, T.TENANT_PADRAO, 'cron-sem-tempo', { titulo: 'Rotina da noite sem tempo', corpo: `De ${todas.length} lojas, ${partes}. Ficam para amanhã (a ordem gira). Se repetir, é hora de dividir a rotina.` }); } catch (_) { /* só aviso */ }
      }
      await P.limparLimites(banco);
      try { await Erros.faxina(banco); } catch (e) { console.error('[erros] faxina', e && e.message); }
      // trilha de auditoria: o que passou de 400 dias sai
      try { await P.limparAuditoria(banco, null); for (const id of lojas) await P.limparAuditoria(banco, id); } catch (e) { console.error('[auditoria] faxina', e && e.message); }
      for (const id of Object.keys(maquininha)) saida[id] = { ...saida[id], maquininha: maquininha[id] };
      return res.status(200).json({ sucesso: true, cron: true, ...(saida[T.TENANT_PADRAO] || {}), lojas: saida });
    }
    if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método não permitido.' });
    // erro do navegador: sem login (pode ter acontecido antes dele), com freio por endereço de internet
    if ((req.body || {}).acao === 'erro') return await Erros.receber(banco, req, res, admin);

    // ------------------------- AUTENTICAÇÃO -------------------------
    const token = tokenDe(req);
    if (!token) return res.status(401).json({ sucesso: false, error: 'Faça login para continuar.' });
    let dec;
    try { dec = await admin.auth().verifyIdToken(token); }
    catch (e) { return res.status(401).json({ sucesso: false, error: 'Sessão inválida.' }); }
    // Loja desta chamada → todos os dados abaixo saem SÓ dela. Ser gestor de uma loja
    // não dá acesso a nenhuma outra: o papel é conferido para ESTA loja.
    let tid;
    try { ({ tid } = await T.resolverLoja(banco, req)); }
    catch (e) { return res.status(e.status || 400).json({ sucesso: false, error: e.message }); }
    db = T.escopo(banco, tid);
    const ehAdmin = T.temPapel(dec, tid, T.GESTORES);
    const corpo = req.body || {};
    const acao = String(corpo.acao || '');

    // ------------------------- CLIENTE DA LOJA -------------------------
    if (acao === 'ranking') {
      if (!limitar('r:' + tid + ':' + dec.uid, 1500) || H.passouNaMemoria(`ranking:${H.ipDe(req)}`, 60, 60000)) return res.status(429).json({ sucesso: false, error: 'Aguarde um instante.' });
      const [g, modelo] = await Promise.all([Store.lerGlobal(db), Store.lerClientePorUid(db, dec.uid)]);
      const out = montarRankingCliente({ modelo, G: g && g.global, catalogo: g && g.catalogo, cesta: corpo.cesta });
      return res.status(200).json({ sucesso: true, geradoEm: g && g.meta ? g.meta.geradoEm : null, ...out });
    }

    // ------------------------- ADMIN -------------------------
    if (!ehAdmin) return res.status(403).json({ sucesso: false, error: 'Acesso restrito ao administrador.' });

    if (acao === 'painel') {
      let p = await Store.lerPainel(db), atualizou = false;
      // aba Clientes: se chegou pedido depois do último cálculo, recalcula antes de responder.
      // Vale o mesmo limite do botão "recalcular"; passou do limite, devolve o cálculo que já existe.
      if (corpo.atualizar === true && await Store.temPedidoNovo(db, p && p.meta && p.meta.geradoEm)
          && limitar('recalc:' + tid, 8000) && await P.limitar(banco, 'recalcular', tid, 20, 3600)) {
        const r = await Store.recalcular(db, {});
        if (!r.pulado) { p = await Store.lerPainel(db); atualizou = true; }
      }
      return res.status(200).json({ sucesso: true, vazio: !p, atualizou, ...(p || {}) });
    }

    if (acao === 'recalcular') {
      // recalcular relê meses de pedidos: no máximo 20 por hora por loja (conta no banco, vale para todas as cópias do servidor)
      if (!limitar('recalc:' + tid, 8000) || !(await P.limitar(banco, 'recalcular', tid, 20, 3600))) return res.status(429).json({ sucesso: false, error: 'Um cálculo acabou de rodar. Aguarde alguns minutos.' });
      const janela = Math.min(Math.max(parseInt(corpo.janelaDias, 10) || 0, 0), 900) || undefined;
      const r = await Store.recalcular(db, { janelaDias: janela, forcar: true });
      return res.status(200).json({ sucesso: true, ...resumo(r) });
    }

    if (acao === 'cliente') {
      if (typeof corpo.clienteId !== 'string' || !/^[\w-]{1,120}$/.test(corpo.clienteId)) return res.status(400).json({ sucesso: false, error: 'Cliente inválido.' });
      const [g, m] = await Promise.all([Store.lerGlobal(db), Store.lerClientePorId(db, corpo.clienteId)]);
      if (!m || !g) return res.status(404).json({ sucesso: false, error: 'Cliente sem perfil calculado.' });
      const hoje = diaDeTs(Date.now());
      const catalogo = new Map(Object.entries(g.catalogo || {}).map(([id, c]) => [id, { id, nome: c.nome, unidade: c.un, cat: c.cat }]));
      const ativos = new Set(Object.entries(g.catalogo || {}).filter(([, c]) => c.ativo !== false).map(([id]) => id));
      const itens = K.pontuarCliente(m, g.global, hoje, { produtos: catalogo, ativos, explicar: 12 }).slice(0, 12)
        .map((o) => ({ id: o.id, nome: (g.catalogo[o.id] || {}).nome || o.id, p: Math.round(o.p * 100) / 100, conf: Math.round(o.conf * 100) / 100, confRotulo: K.rotuloConfianca(o.conf), qtd: o.qtd, motivos: o.motivos, tags: o.tags }));
      const perfil = {
        nome: m.nome, condominio: m.condominio || '', formatoEndereco: m.formatoEndereco || 'ql', quadra: m.quadra, lote: m.lote, nivel: m.nivel, pedidos: m.nVisitas, ultimaCompra: isoDeDia(m.ultimoDia),
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

