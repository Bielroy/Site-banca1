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
const Segredos = require('../lib/segredos');

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

// ---------------------------------------------------------------------
// CORS — lista de origens confiáveis
//
// POR QUE NÃO DEPENDE MAIS DE VARIÁVEL DE AMBIENTE:
// a versão anterior usava ALLOWED_ORIGIN e, se ela estivesse errada ou
// ausente, o site bloqueava a si mesmo — o navegador da cliente manda a
// requisição de um domínio e o servidor autoriza outro. Como a banca tem
// três endereços válidos (domínio próprio com e sem "www", mais o da
// Vercel), agora conferimos de qual deles a chamada veio e devolvemos
// exatamente esse. Funciona nos três sem configurar nada.
//
// ALLOWED_ORIGIN continua sendo lida e ACRESCENTA origens à lista
// (aceita várias separadas por vírgula), mas não é mais obrigatória.
// ---------------------------------------------------------------------
// Origem (CORS): a lista de endereços nossos fica num lugar só, lib/http.js.
const H = require('../lib/http');
const aplicarCors = H.cors;

const T = require('../lib/tenant');
const P = require('../lib/prudencia');
// Quem da equipe gera PIX de um pedido: quem atende pedidos (não o estoque nem a produção).
const EQUIPE_DO_PIX = ['proprietario', 'administrador', 'funcionario', 'caixa'];
const emailValido = (e) => typeof e === 'string' && e.length <= 120 && /^[^\s@<>"']{1,64}@[^\s@<>"']{1,100}\.[a-z]{2,}$/i.test(e);
// chamada ao banco com prazo: sem isto, o PagBank lento prendia a função até a Vercel derrubar
const comPrazo = (url, opcoes = {}, ms = 15000) => fetch(url, { ...opcoes, signal: AbortSignal.timeout(ms) });

module.exports = async function handler(req, res) {
  aplicarCors(req, res, 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Loja');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    bootFirebase();
    const { pedidoId, cpf, email } = req.body || {};
    if (typeof pedidoId !== 'string' || !/^[\w-]{6,80}$/.test(pedidoId)) return res.status(400).json({ error: 'pedidoId é obrigatório.' });
    if (H.passouNaMemoria(`pix:${H.ipDe(req)}`, 10, 60000)) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde um minuto.' });
    let tid;
    try { ({ tid } = await T.resolverLoja(db, req)); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

    // A conta do PagBank configurada no servidor é a da loja original. Gerar PIX para outra
    // loja mandaria o dinheiro do cliente dela para a conta errada: fica bloqueado até cada
    // loja ter as próprias credenciais.
    if (tid !== T.TENANT_PADRAO) return res.status(400).json({ error: 'O PIX automático ainda não está disponível nesta loja. Combine o pagamento pelo WhatsApp.' });

    // Quem pede o QR precisa ser o dono do pedido ou alguém da equipe (antes bastava saber o número do pedido).
    let dec;
    try {
      const cab = String((req.headers && req.headers.authorization) || '');
      dec = await admin.auth().verifyIdToken(cab.startsWith('Bearer ') ? cab.slice(7).trim() : '');
    } catch (e) { return res.status(401).json({ error: 'Sessão não identificada. Recarregue a página e tente de novo.' }); }

    // Desligado até a loja ter a conta do PagBank configurada E ligar a opção no painel.
    // A chave vem da Vercel ou da tela Plataforma (lib/segredos.js).
    const TOKEN_PAGBANK = await Segredos.pagbank(db);
    if (!TOKEN_PAGBANK) return res.status(503).json({ error: 'O PIX automático ainda não está ligado. Combine o pagamento pelo WhatsApp.' });
    const cfg = await T.docDe(db, tid, 'loja/config').get();
    if (!cfg.exists || cfg.data().pixAutomatico !== true) return res.status(503).json({ error: 'O PIX automático está desligado nesta loja. Combine o pagamento pelo WhatsApp.' });

    const pedidoRef = T.tdoc(db, tid, 'pedidos', pedidoId);
    const snap = await pedidoRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Pedido não encontrado.' });

    const pedido = snap.data();
    if (pedido.userId !== dec.uid && !T.temPapel(dec, tid, EQUIPE_DO_PIX)) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (pedido.status === 'cancelado') return res.status(409).json({ error: 'Este pedido foi cancelado.' });
    if (pedido.status === 'arquivado') return res.status(409).json({ error: 'Este pedido já foi concluído. Combine o pagamento pelo WhatsApp.' });
    // Cada QR é uma ordem criada no banco: no máximo 6 em 10 minutos por pessoa, 300 por dia na loja (conta guardada no banco).
    if (!(await P.limitar(db, 'pix', `${tid}|${dec.uid}`, 6, 600)) || !(await P.limitar(db, 'pix-loja', tid, 300, 86400))) return res.status(429).json({ error: 'Muitos códigos PIX gerados em pouco tempo. Aguarde alguns minutos ou combine pelo WhatsApp.' });
    if (pedido.temItensAPesar) return res.status(409).json({ error: 'Este pedido ainda tem itens a pesar. O PIX sai depois da pesagem.' });

    // Já pago? Não gera novo QR.
    if (pedido.pagamento && pedido.pagamento.status === 'PAID') {
      return res.status(409).json({ error: 'Este pedido já foi pago.' });
    }

    // Já existe um QR ainda válido pra esse pedido? Reaproveita (evita
    // gerar QR duplicado se o cliente reabrir o modal / clicar 2x).
    if (pedido.pagamento && pedido.pagamento.orderId && pedido.pagamento.status === 'WAITING') {
      const check = await comPrazo(`${PAGBANK_BASE_URL}/orders/${encodeURIComponent(pedido.pagamento.orderId)}`, {
        headers: { Authorization: `Bearer ${TOKEN_PAGBANK}` },
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
    if (!Number.isFinite(valor) || valor <= 0 || valor > 100000) return res.status(400).json({ error: 'Pedido sem valor cobrável via PIX.' });

    const valorCentavos = paraCentavos(valor);
    const expiracao = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

    const customer = {
      name: pedido.nome || 'Cliente Banca',
      email: emailValido(email) ? email.trim().toLowerCase() : `${pedidoId}@cliente.banca`,
    };
    // CPF é frequentemente exigido pelo PagBank para orders. Só inclui
    // se o front mandou (campo opcional que você pode adicionar depois
    // no formulário de checkout).
    if (cpf) {
      const d = String(cpf).replace(/\D/g, '');
      if (d.length !== 11) return res.status(400).json({ error: 'Confira o CPF: são 11 números.' });
      customer.tax_id = d;
    }

    // -------------------------------------------------------------------
    // ENDEREÇO DO WEBHOOK
    //
    // Se PUBLIC_BASE_URL não estiver definida na Vercel, o template
    // literal produzia a string "undefined/api/pagamento-webhook" — uma
    // URL inválida que o PagBank aceitaria sem reclamar na criação do
    // pedido, mas para a qual nunca conseguiria avisar o pagamento.
    // Resultado: cliente paga, dinheiro entra, e o pedido fica travado
    // "aguardando pagamento" para sempre, sem erro visível em lugar nenhum.
    // Melhor falhar agora, alto e claro, do que perder uma venda em silêncio.
    // -------------------------------------------------------------------
    const baseUrl = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\/[^\s]+$/.test(baseUrl)) {
      console.error('[pix] PUBLIC_BASE_URL ausente ou inválida:', JSON.stringify(process.env.PUBLIC_BASE_URL));
      return res.status(500).json({
        error: 'Pagamento por PIX indisponível no momento. Escolha outra forma de pagamento.'
      });
    }

    const orderResp = await comPrazo(`${PAGBANK_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN_PAGBANK}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Outras lojas: a referência leva o id da loja, para o aviso de pagamento achar o pedido certo.
        reference_id: tid === T.TENANT_PADRAO ? pedidoId : `${tid}~${pedidoId}`,
        customer,
        items: [{ name: `Pedido Banca Adair e Pedrina`, quantity: 1, unit_amount: valorCentavos }],
        qr_codes: [{ amount: { value: valorCentavos }, expiration_date: expiracao }],
        notification_urls: [`${baseUrl}/api/pagamento-webhook`],
      }),
    });

    const data = await orderResp.json();
    if (!orderResp.ok) {
      // Devolve o erro exato do PagBank — essencial pra depurar (ex.: CPF ausente)
      console.error('[pix] PagBank recusou:', JSON.stringify(data).slice(0, 600));
      return res.status(502).json({ error: 'O banco não gerou o PIX agora. Confira o CPF ou combine o pagamento pelo WhatsApp.' });
    }

    const qr = data.qr_codes && data.qr_codes[0];
    if (!qr) return res.status(502).json({ error: 'O banco não devolveu o código PIX. Combine o pagamento pelo WhatsApp.' });

    const qrPngUrl = qr.links?.find((l) => l.rel === 'QRCODE.PNG')?.href || null;

    // Grava dentro de uma transação, relendo o pedido: enquanto o banco respondia, a loja pode ter aceitado,
    // cancelado ou o pagamento de um QR anterior pode ter caído. Regras:
    //  - o status só vira "aguardando_pagamento" se o pedido ainda estava NOVO (antes voltava para trás um
    //    pedido que a loja já estava separando, ou até um já entregue);
    //  - pedido já pago não é mexido;
    //  - o valor do QR fica guardado (valorC) para o aviso de pagamento conferir quanto foi cobrado;
    //  - as ordens anteriores ficam na lista: se a cliente pagar um QR antigo ainda válido, o aviso é reconhecido.
    await db.runTransaction(async (t) => {
      const atualSnap = await t.get(pedidoRef); if (!atualSnap.exists) return;
      const atual = atualSnap.data(), pg = atual.pagamento || {};
      if (pg.status === 'PAID') return;
      const ordens = [...new Set([...(Array.isArray(pg.ordens) ? pg.ordens : []), pg.orderId, data.id].filter((x) => typeof x === 'string' && x))].slice(-6);
      t.update(pedidoRef, {
        ...(atual.status === 'pendente' ? { status: 'aguardando_pagamento' } : {}),
        pagamento: { provedor: 'pagbank', orderId: data.id, ordens, valorC: valorCentavos, status: 'WAITING', criadoEm: new Date().toISOString() },
      });
    });

    return res.status(200).json({
      sucesso: true,
      orderId: data.id,
      qr_code: qr.text,         // copia-e-cola (EMV)
      qr_code_url: qrPngUrl,    // URL da imagem do QR (usar direto no <img src>)
    });
  } catch (err) {
    console.error('[pix]', err && err.message);
    return res.status(500).json({ error: 'Não foi possível gerar o PIX agora. Combine o pagamento pelo WhatsApp.' });
  }
};
