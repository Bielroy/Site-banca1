// =====================================================================
//  /api/pagamento-webhook.js  —  VERSÃO PAGBANK
//
//  Recebe a notificação do PagBank quando o status do pedido muda
//  (ex.: PIX pago) e, de forma idempotente e transacional, baixa o
//  estoque e libera o pedido para a fila de preparo.
//
//  VALIDAÇÃO DE ASSINATURA (documentação oficial do PagBank):
//    assinatura = SHA256( TOKEN_DA_CONTA + "-" + corpo_bruto_da_requisicao )
//    header recebido: x-authenticity-token
//  Ou seja, o PagBank NÃO usa um "secret" separado — reaproveita o
//  mesmo token que você usa pra chamar a API (PAGBANK_API_TOKEN).
//
//  IMPORTANTE: para calcular esse hash corretamente, precisamos do
//  corpo da requisição *exatamente como chegou* (string bruta), antes
//  de qualquer parse. Por isso desligamos o bodyParser automático da
//  Vercel abaixo (`config.api.bodyParser = false`) e lemos o stream
//  manualmente.
//
//  Variáveis de ambiente:
//    PAGBANK_API_TOKEN (mesmo token do pagamento-pix.js)
//    PAGBANK_ENV        "sandbox" ou "production"
//    FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
// =====================================================================

const admin = require('firebase-admin');
const crypto = require('crypto');

// Desliga o parse automático — precisamos do corpo bruto pra assinatura
module.exports.config = { api: { bodyParser: false } };

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

const PAGBANK_BASE_URL = process.env.PAGBANK_ENV === 'sandbox'
  ? 'https://sandbox.api.pagseguro.com'
  : 'https://api.pagseguro.com';

// Lê o corpo bruto da requisição (necessário p/ validar a assinatura)
function lerCorpoCru(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (chunk) => { dados += chunk; });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

function assinaturaValida(rawBody, headerRecebido) {
  const token = process.env.PAGBANK_API_TOKEN;
  // CORRIGIDO (era falha ABERTA): sem token configurado, recusa tudo.
  // Antes o código retornava true aqui, então se a variável de ambiente
  // sumisse, qualquer pessoa na internet poderia fingir um pagamento.
  if (!token) {
    console.error('[webhook] PAGBANK_API_TOKEN ausente — recusando notificação.');
    return false;
  }
  if (!headerRecebido) return false;
  const hash = crypto.createHash('sha256').update(`${token}-${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(headerRecebido));
  } catch (e) {
    return false; // tamanhos diferentes = inválido
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await lerCorpoCru(req);
  const assinaturaHeader = req.headers['x-authenticity-token'];

  // Assinatura inválida: responde 200 (evita retries infinitos) mas NÃO processa nada
  if (!assinaturaValida(rawBody, assinaturaHeader)) {
    return res.status(200).json({ ignorado: 'assinatura_invalida' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch (e) { return res.status(200).json({ ok: true }); }

  try {
    bootFirebase();

    // Do corpo do webhook só aproveitamos o ID do pedido no PagBank.
    // Todo o resto vem da re-consulta abaixo, que é a fonte confiável.
    const orderId = payload.id;          // ex.: "ORDE_..."
    if (!orderId) return res.status(200).json({ ok: true });

    // 2) Fonte de verdade: reconsulta o pedido na API (nunca confia só no corpo do webhook)
    const consulta = await fetch(`${PAGBANK_BASE_URL}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${process.env.PAGBANK_API_TOKEN}` },
    });
    const order = await consulta.json();
    if (!consulta.ok) return res.status(200).json({ ok: true });

    // CORRIGIDO: o pedidoId agora vem da resposta da API (confiável), e não
    // do corpo do webhook (que qualquer um poderia ter escrito).
    const pedidoId = order.reference_id;
    if (!pedidoId) return res.status(200).json({ ok: true });

    const charges = order.charges || [];
    const pago = charges.some((c) => c.status === 'PAID');

    if (!pago) {
      // WAITING / DECLINED / CANCELED / IN_ANALYSIS -> só atualiza o rótulo
      await db.collection('pedidos').doc(pedidoId).set(
        { pagamento: { status: charges[0]?.status || 'WAITING' } }, { merge: true }
      );
      return res.status(200).json({ ok: true });
    }

    // 3) Confirma o pagamento de forma idempotente.
    //
    // CORRIGIDO — ANTES ESTE BLOCO BAIXAVA O ESTOQUE DE NOVO.
    // O checkout.js já baixa o estoque no momento em que o pedido é criado,
    // qualquer que seja a forma de pagamento. Como o webhook fazia a mesma
    // baixa, todo produto com estoque controlado teria saído em DOBRO em
    // cada venda no PIX. Fonte única de verdade agora: checkout.js.
    await db.runTransaction(async (t) => {
      const pedidoRef = db.collection('pedidos').doc(pedidoId);
      const pedidoSnap = await t.get(pedidoRef);
      if (!pedidoSnap.exists) return;

      const pedido = pedidoSnap.data();
      if (pedido.pagamento && pedido.pagamento.status === 'PAID') return; // já processado

      const novoStatus = pedido.temItensAPesar ? 'aguardando_pesagem' : 'pendente';
      t.update(pedidoRef, {
        status: novoStatus,
        pagamento: Object.assign({}, pedido.pagamento || {}, {
          status: 'PAID',
          pagoEm: new Date().toISOString(),
        }),
      });
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook PagBank erro:', err);
    return res.status(200).json({ ok: true }); // 200 evita retries em loop
  }
};
