// =====================================================================
//  /api/pagamento-webhook.js  —  MODELO DE REFERÊNCIA (Fase 2)
//
//  Recebe a notificação do gateway quando o PIX é pago e, de forma
//  idempotente e transacional:
//    1) Verifica a assinatura (anti-fraude / anti-replay).
//    2) Consulta o pagamento na API do gateway (fonte de verdade —
//       nunca confie só no corpo do webhook).
//    3) Se 'approved' e ainda não processado: baixa o estoque dos itens
//       de valor fechado e move o pedido para a fila (pendente /
//       aguardando_pesagem). Tudo dentro de uma transação.
//
//  Responder 200 rápido é essencial — o gateway reenvia em caso de erro.
//
//  Variáveis de ambiente:
//    MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET
//    FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
// =====================================================================

const admin = require('firebase-admin');
const crypto = require('crypto');

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

const isFracionavel = (u) =>
  ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'].includes(String(u || '').toLowerCase());

// Validação de assinatura do Mercado Pago (header x-signature: "ts=...,v1=...")
function assinaturaValida(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // se não configurou segredo, não bloqueia (dev)
  try {
    const sig = req.headers['x-signature'] || '';
    const reqId = req.headers['x-request-id'] || '';
    const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
    const ts = parts.ts; const v1 = parts.v1;
    const dataId = (req.query && req.query['data.id']) || req.body?.data?.id || '';
    const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
    const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1 || ''));
  } catch (e) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Responde 200 mesmo em erro de assinatura para não gerar retries infinitos,
  // mas NÃO processa nada se a assinatura for inválida.
  if (!assinaturaValida(req)) return res.status(200).json({ ignorado: 'assinatura' });

  try {
    bootFirebase();

    const paymentId = req.body?.data?.id || (req.query && req.query['data.id']);
    const tipo = req.body?.type || req.body?.topic;
    if (!paymentId || (tipo && tipo !== 'payment')) return res.status(200).json({ ok: true });

    // 2) Fonte de verdade: consulta o pagamento no gateway
    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const pay = await mpResp.json();
    if (!mpResp.ok) return res.status(200).json({ ok: true }); // não trava a fila do gateway

    const pedidoId = pay.external_reference;
    if (!pedidoId) return res.status(200).json({ ok: true });

    if (pay.status !== 'approved') {
      // pending/rejected/cancelled -> só atualiza o rótulo do pagamento
      await db.collection('pedidos').doc(pedidoId).set(
        { pagamento: { status: pay.status } }, { merge: true }
      );
      return res.status(200).json({ ok: true });
    }

    // 3) Transação idempotente: baixa estoque + libera pedido uma única vez
    await db.runTransaction(async (t) => {
      const pedidoRef = db.collection('pedidos').doc(pedidoId);
      const pedidoSnap = await t.get(pedidoRef);
      if (!pedidoSnap.exists) return;

      const pedido = pedidoSnap.data();
      if (pedido.pagamento && pedido.pagamento.status === 'approved') return; // já processado

      const itensFechados = (pedido.itens || []).filter((i) => !i.aPesar);
      const prodSnaps = await Promise.all(
        itensFechados.map((i) => t.get(db.doc(`produtos/${i.id}`)))
      );

      const updates = [];
      itensFechados.forEach((item, idx) => {
        const snap = prodSnaps[idx];
        if (!snap.exists) return;
        const p = snap.data();
        if (p.estoqueFisico !== null && p.estoqueFisico !== undefined && p.estoqueFisico !== '') {
          const novo = Math.round((Number(p.estoqueFisico) - Number(item.qtd)) * 1000) / 1000;
          updates.push([snap.ref, { estoqueFisico: Math.max(novo, 0), ativo: novo > 0 }]);
        }
      });

      updates.forEach(([ref, patch]) => t.update(ref, patch));

      const novoStatus = pedido.temItensAPesar ? 'aguardando_pesagem' : 'pendente';
      t.update(pedidoRef, {
        status: novoStatus,
        pagamento: { ...(pedido.pagamento || {}), status: 'approved', pagoEm: new Date().toISOString() },
      });
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    // 200 evita retries em loop; o erro fica logado para inspeção
    console.error('Webhook erro:', err);
    return res.status(200).json({ ok: true });
  }
};
