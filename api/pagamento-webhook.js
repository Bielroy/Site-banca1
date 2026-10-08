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
const PagBank = require('../lib/pagbank');

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

const urlPainel = (tid) => (tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');

  // Códigos de resposta (o PagBank reenvia o aviso quando a resposta não é 2xx):
  //   200 = processado, ou nada a fazer (ordem que não é nossa, pedido que não existe): não reenviar
  //   400 = corpo que não é JSON · 401 = assinatura não confere
  //   503 = falha TEMPORÁRIA (Firebase ou PagBank fora do ar): o banco tenta de novo mais tarde.
  //         Antes respondia 200 também aqui, e um PIX pago podia ficar sem baixa.
  // Reprocessar é seguro: pedido já pago não muda (a transação confere).
  let rawBody;
  try { rawBody = await lerCorpoCru(req); } catch (e) { return res.status(e && e.status === 413 ? 413 : 400).end(); }
  const assinaturaHeader = req.headers['x-authenticity-token'];

  // A chave vem da Vercel ou da tela Plataforma (lib/segredos.js).
  let TOKEN_PAGBANK = '';
  try { bootFirebase(); TOKEN_PAGBANK = await Segredos.pagbank(db); }
  catch (e) { console.error('[webhook] não consegui ler a chave:', e && e.message); return res.status(503).json({ tentar: 'depois' }); }

  // Assinatura inválida: NÃO processa nada
  if (!assinaturaValida(rawBody, assinaturaHeader, TOKEN_PAGBANK)) {
    return res.status(401).json({ ignorado: 'assinatura_invalida' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch (e) { return res.status(400).json({ ignorado: 'corpo_invalido' }); }

  try {
    // Do corpo do webhook só aproveitamos o ID da ordem; a fonte de verdade é a consulta ao PagBank
    // (nunca confia só no corpo do aviso). O ID só passa se tiver cara de ID (entra no endereço da consulta).
    const { order, temporario } = await PagBank.consultarOrdem(TOKEN_PAGBANK, payload && payload.id);
    if (temporario) return res.status(503).json({ tentar: 'depois' });
    if (!order) return res.status(200).json({ ok: true });

    const aviso = await PagBank.aplicarOrdem(db, order);
    if (aviso) {
      // o pagamento já foi gravado: se só o aviso para a equipe falhar, NÃO pede reenvio
      try { await Avisos.avisarLoja(db, aviso.tid, { titulo: aviso.titulo, corpo: aviso.corpo, url: urlPainel(aviso.tid), tag: `pix-${aviso.pedidoId}` }); }
      catch (e) { console.error('[webhook] aviso à equipe falhou:', e && e.message); }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook PagBank erro:', err && err.message);
    return res.status(503).json({ tentar: 'depois' });
  }
};

// Desliga o parse automático — precisamos do corpo bruto pra conferir a assinatura
module.exports.config = { api: { bodyParser: false } };
