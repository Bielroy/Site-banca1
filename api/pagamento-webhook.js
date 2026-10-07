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
const Segredos = require('../lib/segredos');
const crypto = require('crypto');
const T = require('../lib/tenant');
const Avisos = require('../lib/avisos');

// (o "config" que desliga o parse automático é exportado no FIM do arquivo:
//  aqui em cima ele era apagado pelo "module.exports = handler" logo abaixo)

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

// Lê o corpo bruto da requisição (necessário p/ validar a assinatura).
// Com teto de tamanho: um aviso de pagamento tem poucos KB; sem teto, qualquer um podia mandar
// megabytes para o servidor ficar guardando na memória.
const MAX_CORPO = 256 * 1024;
function lerCorpoCru(req) {
  return new Promise((resolve, reject) => {
    let dados = '', bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_CORPO) { reject(Object.assign(new Error('corpo grande demais'), { status: 413 })); try { req.destroy(); } catch (_) { /* já fechou */ } return; }
      dados += chunk;
    });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

function assinaturaValida(rawBody, headerRecebido, token) {
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

const paraCentavos = (v) => Math.round(Number(v) * 100);
const ROTULOS = ['WAITING', 'DECLINED', 'CANCELED', 'IN_ANALYSIS', 'AUTHORIZED'];
/** Quanto foi pago de verdade nesta ordem, em centavos (soma das cobranças pagas). null = o banco não informou. */
function valorPagoC(order) {
  let soma = 0, leu = false;
  for (const c of Array.isArray(order.charges) ? order.charges : []) {
    if (!c || c.status !== 'PAID') continue;
    const a = c.amount || {}, v = Number(a.summary && a.summary.paid != null ? a.summary.paid : a.value);
    if (Number.isFinite(v) && v > 0) { soma += Math.round(v); leu = true; }
  }
  return leu ? soma : null;
}
const urlPainel = (tid) => (tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');

  let rawBody;
  try { rawBody = await lerCorpoCru(req); } catch (e) { return res.status(e && e.status === 413 ? 413 : 400).end(); }
  const assinaturaHeader = req.headers['x-authenticity-token'];

  // A chave vem da Vercel ou da tela Plataforma (lib/segredos.js). Sem conseguir ler, recusa.
  let TOKEN_PAGBANK = '';
  try { bootFirebase(); TOKEN_PAGBANK = await Segredos.pagbank(db); } catch (e) { console.error('[webhook] não consegui ler a chave:', e && e.message); }

  // Assinatura inválida: responde 200 (evita retries infinitos) mas NÃO processa nada
  if (!assinaturaValida(rawBody, assinaturaHeader, TOKEN_PAGBANK)) {
    return res.status(200).json({ ignorado: 'assinatura_invalida' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch (e) { return res.status(200).json({ ok: true }); }

  try {
    bootFirebase();

    // Do corpo do webhook só aproveitamos o ID da ordem no PagBank, e só se tiver cara de ID
    // (ele entra no endereço da consulta abaixo: nada de barra, ponto ou interrogação).
    const orderId = payload && payload.id;          // ex.: "ORDE_..."
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) return res.status(200).json({ ok: true });

    // 2) Fonte de verdade: reconsulta a ordem na API (nunca confia só no corpo do webhook)
    const consulta = await fetch(`${PAGBANK_BASE_URL}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${TOKEN_PAGBANK}` }, signal: AbortSignal.timeout(15000),
    });
    const order = await consulta.json().catch(() => null);
    if (!consulta.ok || !order || order.id !== orderId) return res.status(200).json({ ok: true });

    // Referência = "pedido" (loja original) ou "loja~pedido" (demais lojas) — ver pagamento-pix.js
    const ref = String(order.reference_id || '');
    const [parteA, parteB] = ref.includes('~') ? ref.split('~') : [T.TENANT_PADRAO, ref];
    const tid = parteA, pedidoId = parteB;
    if (!pedidoId || !T.idValido(tid) || !/^[\w-]{6,80}$/.test(pedidoId)) return res.status(200).json({ ok: true });

    const charges = Array.isArray(order.charges) ? order.charges : [];
    const pago = charges.some((c) => c && c.status === 'PAID');
    const pagoC = valorPagoC(order);

    // 3) Confere e grava numa transação. O que mudou em relação à versão anterior:
    //   a) a ordem do banco precisa ser uma das que ESTE pedido gerou (antes bastava a referência bater);
    //   b) o valor pago é comparado com o total do pedido: pagou menos, não vira "pago";
    //   c) o aviso nunca CRIA pedido (antes o ramo "não pago" criava um documento solto) nem volta o status
    //      para trás: só o pedido que estava "aguardando pagamento" anda; o já aceito, entregue ou cancelado fica onde está;
    //   d) pedido cancelado que recebe PIX fica marcado e a equipe é avisada para devolver.
    // O estoque NÃO é mexido aqui: quem baixa é o checkout, uma vez só.
    const aviso = await db.runTransaction(async (t) => {
      const pedidoRef = T.tdoc(db, tid, 'pedidos', pedidoId);
      const pedidoSnap = await t.get(pedidoRef);
      if (!pedidoSnap.exists) return null;
      const pedido = pedidoSnap.data(), pg = pedido.pagamento || {};
      const minhas = [pg.orderId].concat(Array.isArray(pg.ordens) ? pg.ordens : []);
      if (!minhas.includes(orderId)) { console.warn('[webhook] ordem que este pedido não gerou; ignorada.'); return null; }
      if (pg.status === 'PAID') return null;                                  // já processado (o banco repete o aviso)

      if (!pago) {
        const rotulo = ROTULOS.includes(charges[0] && charges[0].status) ? charges[0].status : 'WAITING';
        if (pg.status !== rotulo) t.update(pedidoRef, { pagamento: { ...pg, status: rotulo } });
        return null;
      }

      const totalC = paraCentavos(pedido.total), cobradoC = Number.isFinite(Number(pg.valorC)) ? Number(pg.valorC) : null;
      const recebidoC = pagoC !== null ? pagoC : cobradoC;                    // o banco não disse quanto: vale o valor do QR que nós mesmos criamos
      if (recebidoC !== null && Number.isFinite(totalC) && recebidoC < totalC) {
        t.update(pedidoRef, { pagamento: { ...pg, status: 'PAGO_PARCIAL', valorPagoC: recebidoC, pagoEm: new Date().toISOString() } });
        return { titulo: 'PIX menor que o pedido', corpo: `${pedido.nome || 'Cliente'} pagou menos que o total. Confira antes de entregar.` };
      }
      const cancelado = pedido.status === 'cancelado';
      t.update(pedidoRef, {
        ...(pedido.status === 'aguardando_pagamento' ? { status: pedido.temItensAPesar ? 'aguardando_pesagem' : 'pendente' } : {}),
        pagamento: { ...pg, status: 'PAID', pagoEm: new Date().toISOString(), ...(recebidoC !== null ? { valorPagoC: recebidoC } : {}), ...(cancelado ? { pagoDepoisDeCancelar: true } : {}) },
      });
      return cancelado ? { titulo: 'PIX de pedido cancelado', corpo: `${pedido.nome || 'Cliente'} pagou um pedido que já estava cancelado. Devolva o PIX.` }
        : { titulo: 'PIX recebido', corpo: `${pedido.nome || 'Cliente'} pagou o pedido.` };
    });
    if (aviso) await Avisos.avisarLoja(db, tid, { ...aviso, url: urlPainel(tid), tag: `pix-${pedidoId}` });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook PagBank erro:', err && err.message);
    return res.status(200).json({ ok: true }); // 200 evita retries em loop
  }
};

// Desliga o parse automático — precisamos do corpo bruto pra conferir a assinatura
module.exports.config = { api: { bodyParser: false } };
