// =====================================================================
//  /api/pagamento-asaas.js — AVISO DE PAGAMENTO DO ASAAS (webhook).
//
//  Cadastro no Asaas: Integrações → Webhooks → Adicionar
//    URL:    https://usebanca.com/api/pagamento-asaas
//    Token:  o "token do aviso" mostrado na tela Plataforma (aba Chaves)
//    Eventos de cobrança: PAYMENT_RECEIVED e PAYMENT_CONFIRMED (os outros são ignorados sem erro)
//
//  Segurança:
//    • o Asaas manda o token no cabeçalho "asaas-access-token": sem token configurado aqui, ou
//      token diferente, NADA é processado (falha fechada);
//    • do corpo só se aproveita o ID da cobrança: a situação é sempre consultada no Asaas;
//    • reprocessar é seguro (pedido já pago não muda; o Asaas entrega "pelo menos uma vez").
//
//  Respostas: 200 = feito ou nada a fazer · 401 = token errado · 503 = falha temporária (o Asaas
//  tenta de novo). Cuidado: depois de 15 falhas seguidas o Asaas PAUSA a fila de avisos, então
//  só responde erro quando vale mesmo a pena tentar de novo.
// =====================================================================
const admin = require('firebase-admin');
const crypto = require('crypto');
const Segredos = require('../lib/segredos');
const Asaas = require('../lib/asaas');
const Avisos = require('../lib/avisos');
const T = require('../lib/tenant');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const bootFirebase = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      }),
    });
  }
  if (!db) db = admin.firestore();
};

function tokenConfere(recebido, esperado) {
  if (!esperado || typeof recebido !== 'string' || !recebido) return false;
  const a = crypto.createHash('sha256').update(recebido).digest(), b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

const urlPainel = (tid) => (tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();

  let esperado = '', cfg = null;
  try { bootFirebase(); [esperado, cfg] = await Promise.all([Segredos.asaasAviso(db), Segredos.asaas(db)]); }
  catch (e) { console.error('[asaas] não consegui ler as chaves:', e && e.message); return res.status(503).json({ tentar: 'depois' }); }

  if (!tokenConfere(req.headers && req.headers['asaas-access-token'], esperado)) {
    if (!esperado) console.error('[asaas] aviso recusado: token do aviso não configurado (tela Plataforma).');
    return res.status(401).json({ ignorado: 'token' });
  }

  const corpo = req.body && typeof req.body === 'object' ? req.body : {};
  const evento = String(corpo.event || ''), id = corpo.payment && corpo.payment.id;
  if (!/^PAYMENT_/.test(evento) || !Asaas.ID_COBRANCA.test(String(id || ''))) return res.status(200).json({ ok: true });
  if (!cfg) return res.status(200).json({ ok: true, ignorado: 'sem chave' });        // conta desligada: tentar de novo não resolve

  try {
    const { cobranca, temporario } = await Asaas.consultarCobranca(cfg, id);
    if (temporario) return res.status(503).json({ tentar: 'depois' });
    if (!cobranca) return res.status(200).json({ ok: true });
    const aviso = await Asaas.aplicarCobranca(db, cobranca);
    if (aviso) {
      // o pagamento já foi gravado: se só o aviso à equipe falhar, não pede reenvio
      try { await Avisos.avisarLoja(db, aviso.tid, { titulo: aviso.titulo, corpo: aviso.corpo, url: urlPainel(aviso.tid), tag: `pix-${aviso.pedidoId}` }); }
      catch (e) { console.error('[asaas] aviso à equipe falhou:', e && e.message); }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[asaas] erro:', err && err.message);
    return res.status(503).json({ tentar: 'depois' });
  }
};
