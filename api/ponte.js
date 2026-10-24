// =====================================================================
//  /api/ponte.js — o APP PONTE (celular Android com a impressora) fala com a loja por aqui.
//  Regras e explicação: lib/ponte.js. O painel liga e configura o celular por /api/pdv (acao 'ponte').
//
//  POST { op: 'entrar', codigo, app }
//      Troca o código de 8 letras gerado no painel pelo token deste celular.
//  POST { op: 'aguardar', espera, pausa, feitos, impressora, app }     (Authorization: Bearer pb1....)
//      Conta o que saiu no papel e espera (até 45 s) por papel novo para imprimir.
//  POST { op: 'sair' }                                                (Authorization: Bearer pb1....)
//      O próprio celular se desliga da loja.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const H = require('../lib/http');
const P = require('../lib/ponte');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const DESLIGADO = { error: 'Este celular não está ligado a nenhuma loja. Gere um código no painel.', desligado: true };

module.exports = async function handler(req, res) {
  H.cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    if (b.op === 'entrar') {
      // 31^8 códigos possíveis, cada um vale 15 min e uma vez: o freio por IP barra quem tenta adivinhar
      if (H.passouNaMemoria(`ponte-entrar:${H.ipDe(req)}`, 12, 10 * 60 * 1000)) return res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos e confira o código no painel.' });
      return res.status(200).json({ sucesso: true, ...(await P.entrar(db, b)) });
    }
    const tk = P.lerToken(H.tokenDe(req));
    if (!tk) return res.status(401).json(DESLIGADO);
    if (H.passouNaMemoria(`ponte:${tk.id}`, 60, 60000)) { res.setHeader('Retry-After', '30'); return res.status(429).json({ error: 'Chamadas demais. O app tenta de novo sozinho.' }); }
    const ficha = await T.fichaDaLoja(db, tk.tid);
    if (tk.tid !== T.TENANT_PADRAO && !ficha) return res.status(401).json(DESLIGADO);
    if (ficha && ficha.ativo === false) return res.status(403).json({ error: 'Esta loja está fora do ar.' });
    const ponte = await P.ponteDoToken(db, tk);
    if (!ponte) return res.status(401).json(DESLIGADO);

    if (b.op === 'aguardar') {
      let fechou = false; const avisos = [];
      // o app desistiu da conversa (sem internet, app fechado): para de esperar por ele
      if (typeof res.on === 'function') res.on('close', () => { if (!res.writableEnded) { fechou = true; avisos.forEach((f) => f()); } });
      const r = await P.aguardar(db, tk.tid, ponte, b, { fechou: () => fechou, aoFechar: (f) => avisos.push(f) });
      if (fechou) return undefined;
      return res.status(200).json({ sucesso: true, ...r });
    }
    if (b.op === 'sair') { await P.remover(db, tk.tid, tk.id); return res.status(200).json({ sucesso: true }); }
    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    if (e && e.status && e.status < 500) return res.status(e.status).json(e.status === 401 ? DESLIGADO : { error: e.message });
    console.error('[ponte] erro:', e && e.message);
    return res.status(500).json({ error: 'O servidor teve um problema. O app tenta de novo sozinho.' });
  }
};
