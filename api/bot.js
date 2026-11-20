// =====================================================================
//  /api/bot.js — a ÁREA DO DONO do app da ponte pede tarefas ao bot do servidor por aqui. Regras: lib/bot.js.
//
//  POST { op: 'entrar', codigo, app }            troca o código da Plataforma pelo token deste celular
//  POST { op: 'cardapio' }                       (Authorization: Bearer bd1....) tarefas e as últimas pedidas
//  POST { op: 'tarefa', tarefa }                 (Authorization: Bearer bd1....) pede; sensível sai já aprovada
//  POST { op: 'sair' }                           (Authorization: Bearer bd1....) este celular deixa de valer
// =====================================================================
const admin = require('firebase-admin');
const H = require('../lib/http');
const B = require('../lib/bot');
const Prud = require('../lib/prudencia');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const FORA = { error: 'Este celular não tem acesso à área do dono. Gere um código na Plataforma.', desligado: true };

function criarHandler({ obterDb = () => { boot(); return db; }, env = process.env, fetchFn = globalThis.fetch, opcoesTarefa = {} } = {}) {
  return async function handler(req, res) {
    H.cors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
    let banco;
    try { banco = obterDb(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      if (b.op === 'entrar') {
        if (H.passouNaMemoria(`bot-entrar:${H.ipDe(req)}`, 8, 10 * 60 * 1000)) return res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos.' });
        const r = await B.entrar(banco, b);
        try { await Prud.registrar(banco, null, { acao: 'bot-celular-ligado', quem: 'app da ponte', detalhe: r.modelo, ip: H.ipDe(req) }); } catch (_) { /* a trilha não trava o pedido */ }
        return res.status(200).json({ sucesso: true, ...r });
      }
      if (H.passouNaMemoria(`bot-token:${H.ipDe(req)}`, 30, 60000)) return res.status(429).json({ error: 'Pedidos demais. Espere um minuto.' });
      const ap = await B.aparelhoDoToken(banco, H.tokenDe(req));
      if (!ap) return res.status(401).json(FORA);
      if (b.op === 'cardapio') {
        let ultimas = [], aviso = '';
        try { ultimas = await B.ultimas(env, fetchFn); } catch (e) { aviso = e.message; }
        return res.status(200).json({ sucesso: true, normais: B.NORMAIS, sensiveis: B.SENSIVEIS, ultimas, aviso });
      }
      if (b.op === 'tarefa') {
        if (H.passouNaMemoria(`bot-tarefa:${ap.id}`, 6, 60000)) return res.status(429).json({ error: 'Muitas tarefas seguidas. Espere um minuto.' });
        const r = await B.pedirTarefa(banco, ap, b, { env, fetchFn, ...opcoesTarefa });
        try { await Prud.registrar(banco, null, { acao: 'bot-tarefa', quem: ap.email || ap.uid, uid: ap.uid, detalhe: `${r.tarefa}${r.sensivel ? (r.aprovada ? ' (aprovada com a digital)' : ' (não achei para aprovar)') : ''}`, ip: H.ipDe(req) }); } catch (_) { /* idem */ }
        return res.status(200).json({ sucesso: true, ...r });
      }
      if (b.op === 'sair') { await B.removerAparelho(banco, ap.id); return res.status(200).json({ sucesso: true }); }
      return res.status(400).json({ error: 'Ação desconhecida.' });
    } catch (e) {
      if (e && e.status && e.status < 600) return res.status(e.status).json({ error: e.message });
      console.error('[bot] erro:', e && e.message);
      return res.status(500).json({ error: 'O servidor teve um problema. Tente de novo.' });
    }
  };
}

module.exports = criarHandler();
module.exports.criarHandler = criarHandler;
