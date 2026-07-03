// =====================================================================
//  /api/pagamento-pix.js  —  MODELO DE REFERÊNCIA (Fase 2 - Pagamentos)
//
//  Cria uma cobrança PIX (QR Code dinâmico) para um pedido já existente.
//  Gateway sugerido: Mercado Pago (melhor cobertura PIX no Brasil e
//  webhooks robustos). A mesma estrutura vale para Asaas/Pagar.me/Efí.
//
//  Fluxo (state machine do pedido):
//    aguardando_pagamento  --(webhook approved)-->  pendente/aguardando_pesagem
//                          --(expira/cancela)   -->  cancelado
//
//  IMPORTANTE: neste fluxo o ESTOQUE só é baixado quando o pagamento é
//  confirmado (no webhook), evitando travar estoque de carrinho abandonado.
//
//  Variáveis de ambiente necessárias:
//    MP_ACCESS_TOKEN            (token do Mercado Pago)
//    FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
//    PUBLIC_BASE_URL           (ex.: https://www.bancaadairepedrina.com.br)
// =====================================================================

const admin = require('firebase-admin');

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    bootFirebase();
    const { pedidoId, email } = req.body || {};
    if (!pedidoId) return res.status(400).json({ error: 'pedidoId é obrigatório.' });

    const pedidoRef = db.collection('pedidos').doc(pedidoId);
    const snap = await pedidoRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Pedido não encontrado.' });

    const pedido = snap.data();
    if (pedido.pagamento && pedido.pagamento.status === 'approved') {
      return res.status(409).json({ error: 'Este pedido já foi pago.' });
    }
    // Só cobra o que é valor fechado. Itens "a pesar" ficam para acerto no ato.
    const valor = Number(pedido.total || 0);
    if (valor <= 0) return res.status(400).json({ error: 'Pedido sem valor cobrável via PIX.' });

    // ---- Chamada ao Mercado Pago ----
    const idempotencia = `pix-${pedidoId}`;
    const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencia, // evita cobrança duplicada
      },
      body: JSON.stringify({
        transaction_amount: valor,
        description: `Pedido Banca Adair e Pedrina #${pedidoId.slice(0, 8)}`,
        payment_method_id: 'pix',
        external_reference: pedidoId, // o webhook usa isso para achar o pedido
        notification_url: `${process.env.PUBLIC_BASE_URL}/api/pagamento-webhook`,
        payer: { email: email || `${pedidoId}@cliente.banca` },
      }),
    });

    const data = await mpResp.json();
    if (!mpResp.ok) {
      return res.status(502).json({ error: 'Falha ao gerar PIX no gateway.', detalhe: data });
    }

    const tx = data.point_of_interaction?.transaction_data || {};
    await pedidoRef.set({
      status: 'aguardando_pagamento',
      pagamento: {
        provedor: 'mercadopago',
        id: String(data.id),
        status: data.status, // 'pending'
        criadoEm: new Date().toISOString(),
      },
    }, { merge: true });

    return res.status(200).json({
      sucesso: true,
      pagamentoId: String(data.id),
      qr_code: tx.qr_code,               // copia-e-cola
      qr_code_base64: tx.qr_code_base64, // imagem do QR
      expira_em: tx.ticket_url || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
