// =====================================================================
//  lib/pagbank.js — o que o aviso do PagBank (api/pagamento-webhook.js) e o
//  "conferir pagamento" (api/pagamento-pix.js, acao: 'conferir') fazem igual:
//    1) consultar a ordem direto no PagBank (fonte de verdade);
//    2) gravar o resultado no pedido, numa transação, com as mesmas regras.
//  Assim, se um aviso do banco se perder, a tela do PIX do cliente pergunta
//  ao PagBank e o pedido anda do mesmo jeito.
// =====================================================================
const T = require('./tenant');
const Cofre = require('./cofre');

const BASE_URL = () => (process.env.PAGBANK_ENV === 'sandbox' ? 'https://sandbox.api.pagseguro.com' : 'https://api.pagseguro.com');
const ID_ORDEM = /^[A-Za-z0-9_-]{6,80}$/;
const ROTULOS = ['WAITING', 'DECLINED', 'CANCELED', 'IN_ANALYSIS', 'AUTHORIZED'];
const paraCentavos = (v) => Math.round(Number(v) * 100);
const reais = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * O QR que já foi gerado para o pedido ainda serve? Só se for do MESMO valor do total de agora
 * e ainda estiver dentro da validade (com 2 minutos de folga para a cliente pagar).
 * Antes o QR velho era reaproveitado mesmo depois de a pesagem ou um ajuste mudar o total.
 *   qrC = valor do QR em centavos; totalC = total do pedido agora; expira = data de validade (texto ISO, opcional)
 */
function qrAindaServe({ qrC, totalC, expira, agora = Date.now(), folgaMs = 2 * 60 * 1000 }) {
  if (!Number.isFinite(Number(qrC)) || !Number.isFinite(Number(totalC)) || Math.round(Number(qrC)) !== Math.round(Number(totalC))) return false;
  if (expira === undefined || expira === null || expira === '') return true;
  const fim = Date.parse(expira);
  return Number.isFinite(fim) && fim - folgaMs > agora;
}

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

/**
 * Consulta uma ordem no PagBank.
 *   { order }            achou e é a ordem pedida
 *   { temporario: true } rede caiu, demorou ou o banco deu erro 5xx/429: vale tentar de novo depois
 *   {}                   ordem não existe / não é nossa: não adianta tentar de novo
 */
async function consultarOrdem(token, orderId) {
  if (typeof orderId !== 'string' || !ID_ORDEM.test(orderId)) return {};
  let resp;
  try {
    resp = await fetch(`${BASE_URL()}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  } catch (e) { return { temporario: true }; }
  if (!resp.ok) return resp.status >= 500 || resp.status === 429 ? { temporario: true } : {};
  const order = await resp.json().catch(() => null);
  return order && order.id === orderId ? { order } : {};
}

/** De qual loja e pedido é a ordem ("pedido" na loja original ou "loja~pedido" nas demais). null = referência estranha. */
function destinoDaOrdem(order) {
  const ref = String((order && order.reference_id) || '');
  const [tid, pedidoId] = ref.includes('~') ? ref.split('~') : [T.TENANT_PADRAO, ref];
  return pedidoId && T.idValido(tid) && /^[\w-]{6,80}$/.test(pedidoId) ? { tid, pedidoId } : null;
}

/**
 * Grava no pedido o que o PagBank disse da ordem. Devolve o aviso para a equipe (ou null).
 * Regras (as mesmas de sempre):
 *   a) a ordem precisa ser uma das que ESTE pedido gerou;
 *   b) cada ordem paga entra UMA vez na soma (pagamento.ordensPagas, pagamento.valorPagoC). A soma é comparada com o
 *      total: menos = PAGO_PARCIAL (o próximo QR cobra só o que falta); mais = pago, para devolver a diferença;
 *      outro PIX num pedido já pago = "em-dobro". Nesses casos o pedido fica marcado em conferirPagamento
 *      (sempre com a soma final) e a equipe é avisada; quando a soma fecha certinho, a marca sai;
 *   c) nunca cria pedido nem volta o status para trás: só o pedido "aguardando pagamento" anda;
 *   d) pedido cancelado que recebe PIX fica marcado e a equipe é avisada para devolver.
 * O estoque NÃO é mexido aqui: quem baixa é o checkout, uma vez só.
 */
/**
 * Ordens deste pedido cujo pagamento já entrou na conta. Pedido pago antes desta lista existir:
 * vale a ordem principal (assim o aviso repetido do banco não vira "pago em dobro").
 */
function ordensPagasDe(pg) {
  if (pg && Array.isArray(pg.ordensPagas)) return pg.ordensPagas;
  return pg && (pg.status === 'PAID' || pg.status === 'PAGO_PARCIAL') && pg.orderId ? [pg.orderId] : [];
}
/** Quanto já entrou neste pedido, em centavos (a soma das ordens pagas). */
const jaPagoC = (pg) => (ordensPagasDe(pg).length ? Math.max(0, Number(pg.valorPagoC) || 0) : 0);

async function aplicarOrdem(db, order) {
  const destino = destinoDaOrdem(order);
  if (!destino) return null;
  const { tid, pedidoId } = destino, orderId = order.id;
  const charges = Array.isArray(order.charges) ? order.charges : [];
  const pago = charges.some((c) => c && c.status === 'PAID');
  const pagoC = valorPagoC(order);
  const aviso = await db.runTransaction(async (t) => {
    const pedidoRef = T.tdoc(db, tid, 'pedidos', pedidoId);
    const pedidoSnap = await t.get(pedidoRef);
    if (!pedidoSnap.exists) return null;
    const pedido = pedidoSnap.data(), pg = pedido.pagamento || {};
    const minhas = [pg.orderId].concat(Array.isArray(pg.ordens) ? pg.ordens : []);
    if (!minhas.includes(orderId)) { console.warn('[pagbank] ordem que este pedido não gerou; ignorada.'); return null; }
    // Ordens deste pedido que já entraram na conta (cada PIX pago conta uma vez só: o banco repete o aviso)
    const pagas = ordensPagasDe(pg);
    if (pagas.includes(orderId)) return null;

    if (!pago) {
      if (pagas.length) return null;                                       // já entrou dinheiro: um "aguardando" atrasado não muda nada
      const rotulo = ROTULOS.includes(charges[0] && charges[0].status) ? charges[0].status : 'WAITING';
      if (pg.status !== rotulo) t.update(pedidoRef, { pagamento: { ...pg, status: rotulo } });
      return null;
    }

    const totalC = paraCentavos(pedido.total), jaC = jaPagoC(pg), estavaPago = pg.status === 'PAID';
    // quanto entrou NESTA ordem: o que o banco disse; se não disse, o valor do QR que nós criamos para ela
    const doQr = pg.valores && Number.isFinite(Number(pg.valores[orderId])) ? Number(pg.valores[orderId]) : (orderId === pg.orderId && Number.isFinite(Number(pg.valorC)) ? Number(pg.valorC) : null);
    const recebidoC = pagoC !== null ? pagoC : doQr !== null ? doQr : Math.max(0, totalC - jaC);
    const somaC = jaC + recebidoC, ordensPagas = [...pagas, orderId].slice(-12);
    const nome = Cofre.abrir(pedido.nome, tid, 'nome') || 'Cliente', em = new Date().toISOString();
    // VALOR DIFERENTE DO TOTAL (o pedido mudou depois do QR, pagou dois QRs, pagou só uma parte): o pedido fica marcado
    // para a equipe conferir (pedido.conferirPagamento, sempre com a SOMA de tudo o que entrou) e a equipe recebe o aviso.
    // Somou certinho (ex.: a parte que faltava chegou): a marca sai.
    const conferir = (motivo) => ({ conferirPagamento: { motivo, recebidoC: somaC, totalC, orderId, ordens: ordensPagas, em } });
    const pagamento = { ...pg, valorPagoC: somaC, ordensPagas, pagoEm: em };
    const cancelado = pedido.status === 'cancelado';
    if (!cancelado && !estavaPago && Number.isFinite(totalC) && somaC < totalC) {
      t.update(pedidoRef, { pagamento: { ...pagamento, status: 'PAGO_PARCIAL' }, ...conferir('a-menos') });
      return { titulo: 'PIX menor que o pedido', corpo: `${nome} pagou ${reais(somaC)}, mas o pedido está em ${reais(totalC)}. Falta ${reais(totalC - somaC)}. Confira antes de entregar.` };
    }
    // já estava pago e entrou OUTRO PIX (ex.: pagou o QR antigo e o novo): pago em dobro, devolver
    const motivo = cancelado ? '' : estavaPago ? 'em-dobro' : somaC > totalC ? 'a-mais' : '';
    t.update(pedidoRef, {
      ...(pedido.status === 'aguardando_pagamento' ? { status: pedido.temItensAPesar ? 'aguardando_pesagem' : 'pendente' } : {}),
      pagamento: { ...pagamento, status: 'PAID', ...(cancelado ? { pagoDepoisDeCancelar: true } : {}) },
      ...(motivo ? conferir(motivo) : pedido.conferirPagamento ? { conferirPagamento: null } : {}),
    });
    if (cancelado) return { titulo: 'PIX de pedido cancelado', corpo: `${nome} pagou um pedido que já estava cancelado. Devolva o PIX.` };
    if (motivo === 'em-dobro') return { titulo: 'PIX pago duas vezes', corpo: `${nome} pagou de novo um pedido que já estava pago: entrou ${reais(somaC)} para um pedido de ${reais(totalC)}. Devolva a diferença.` };
    if (motivo === 'a-mais') return { titulo: 'PIX maior que o pedido', corpo: `${nome} pagou ${reais(somaC)}, mas o pedido está em ${reais(totalC)}. Confira e devolva a diferença.` };
    return { titulo: 'PIX recebido', corpo: jaC > 0 ? `${nome} pagou o que faltava. O pedido está pago.` : `${nome} pagou o pedido.` };
  });
  return aviso ? { ...aviso, tid, pedidoId } : null;
}

module.exports = { BASE_URL, valorPagoC, qrAindaServe, ordensPagasDe, jaPagoC, consultarOrdem, destinoDaOrdem, aplicarOrdem, ROTULOS };
