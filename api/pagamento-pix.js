// =====================================================================
//  /api/pagamento-pix.js  —  VERSÃO PAGBANK (substitui a versão Mercado Pago)
//
//  Usa a "API de Pedidos" (Orders API) do PagBank, que é a atual e
//  oficial para gerar QR Code PIX dinâmico.
//  Doc oficial: https://developer.pagbank.com.br/reference/criar-pedido-pedido-com-qr-code
//
//  DIFERENÇAS IMPORTANTES vs. Mercado Pago:
//   - Endpoint é /orders (não /payments)
//   - Valores em CENTAVOS como número inteiro (ex.: R$ 5,00 = 500)
//   - O QR Code NÃO vem em base64 pronto — vem uma URL (links[].href)
//     que o navegador carrega diretamente no <img src="...">
//   - O "copia e cola" vem no campo qr_codes[0].text
//   - O PagBank pode exigir "tax_id" (CPF) do cliente no objeto customer.
//     Seu checkout hoje NÃO coleta CPF. Se a PagBank recusar por falta
//     de CPF, o erro específico virá em `detalhe` na resposta — trate
//     isso adicionando um campo opcional de CPF no formulário depois.
//
//  Variáveis de ambiente necessárias (Vercel):
//    PAGBANK_API_TOKEN   (o mesmo token usado pra tudo — inclusive
//                         validar o webhook, ver pagamento-webhook.js)
//    PAGBANK_ENV         "sandbox" ou "production" (padrão: production)
//    FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
//    PUBLIC_BASE_URL     (ex.: https://www.bancaadairepedrina.com.br)
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

const PAGBANK_BASE_URL = process.env.PAGBANK_ENV === 'sandbox'
  ? 'https://sandbox.api.pagseguro.com'
  : 'https://api.pagseguro.com';

const paraCentavos = (v) => Math.round(Number(v) * 100);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN
    || (process.env.VERCEL_ENV === 'production' ? 'https://site-banca1.vercel.app' : '*'));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    bootFirebase();
    const { pedidoId, cpf, email } = req.body || {};
    if (!pedidoId) return res.status(400).json({ error: 'pedidoId é obrigatório.' });

    const pedidoRef = db.collection('pedidos').doc(pedidoId);
    const snap = await pedidoRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Pedido não encontrado.' });

    const pedido = snap.data();

    // Já pago? Não gera novo QR.
    if (pedido.pagamento && pedido.pagamento.status === 'PAID') {
      return res.status(409).json({ error: 'Este pedido já foi pago.' });
    }

    // Já existe um QR ainda válido pra esse pedido? Reaproveita (evita
    // gerar QR duplicado se o cliente reabrir o modal / clicar 2x).
    if (pedido.pagamento && pedido.pagamento.orderId && pedido.pagamento.status === 'WAITING') {
      const check = await fetch(`${PAGBANK_BASE_URL}/orders/${pedido.pagamento.orderId}`, {
        headers: { Authorization: `Bearer ${process.env.PAGBANK_API_TOKEN}` },
      });
      const existente = await check.json();
      if (check.ok && existente.qr_codes && existente.qr_codes[0]) {
        const qr = existente.qr_codes[0];
        const qrPng = qr.links?.find((l) => l.rel === 'QRCODE.PNG')?.href || null;
        return res.status(200).json({
          sucesso: true, orderId: existente.id,
          qr_code: qr.text, qr_code_url: qrPng,
        });
      }
      // Se falhar a consulta (expirado etc.), segue e cria um novo abaixo.
    }

    const valor = Number(pedido.total || 0);
    if (valor <= 0) return res.status(400).json({ error: 'Pedido sem valor cobrável via PIX.' });

    const valorCentavos = paraCentavos(valor);
    const expiracao = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

    const customer = {
      name: pedido.nome || 'Cliente Banca',
      email: email || `${pedidoId}@cliente.banca`,
    };
    // CPF é frequentemente exigido pelo PagBank para orders. Só inclui
    // se o front mandou (campo opcional que você pode adicionar depois
    // no formulário de checkout).
    if (cpf) customer.tax_id = String(cpf).replace(/\D/g, '');

    const orderResp = await fetch(`${PAGBANK_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAGBANK_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference_id: pedidoId,
        customer,
        items: [{ name: `Pedido Banca Adair e Pedrina`, quantity: 1, unit_amount: valorCentavos }],
        qr_codes: [{ amount: { value: valorCentavos }, expiration_date: expiracao }],
        notification_urls: [`${process.env.PUBLIC_BASE_URL}/api/pagamento-webhook`],
      }),
    });

    const data = await orderResp.json();
    if (!orderResp.ok) {
      // Devolve o erro exato do PagBank — essencial pra depurar (ex.: CPF ausente)
      return res.status(502).json({ error: 'Falha ao gerar PIX no PagBank.', detalhe: data });
    }

    const qr = data.qr_codes && data.qr_codes[0];
    if (!qr) return res.status(502).json({ error: 'PagBank não retornou QR Code.', detalhe: data });

    const qrPngUrl = qr.links?.find((l) => l.rel === 'QRCODE.PNG')?.href || null;

    await pedidoRef.set({
      status: 'aguardando_pagamento',
      pagamento: {
        provedor: 'pagbank',
        orderId: data.id,
        status: 'WAITING',
        criadoEm: new Date().toISOString(),
      },
    }, { merge: true });

    return res.status(200).json({
      sucesso: true,
      orderId: data.id,
      qr_code: qr.text,         // copia-e-cola (EMV)
      qr_code_url: qrPngUrl,    // URL da imagem do QR (usar direto no <img src>)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
