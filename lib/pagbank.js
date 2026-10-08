// =====================================================================
//  lib/pagbank.js — o que o aviso do PagBank (api/pagamento-webhook.js) e o
//  "conferir pagamento" (api/pagamento-pix.js, acao: 'conferir') fazem igual:
//    1) consultar a ordem direto no PagBank (fonte de verdade);
//    2) gravar o resultado no pedido, numa transação, com as mesmas regras.
//  Assim, se um aviso do banco se perder, a tela do PIX do cliente pergunta
//  ao PagBank e o pedido anda do mesmo jeito.
// =====================================================================
const T = require('./tenant');

const BASE_URL = () => (process.env.PAGBANK_ENV === 'sandbox' ? 'https://sandbox.api.pagseguro.com' : 'https://api.pagseguro.com');
const ID_ORDEM = /^[A-Za-z0-9_-]{6,80}$/;
const ROTULOS = ['WAITING', 'DECLINED', 'CANCELED', 'IN_ANALYSIS', 'AUTHORIZED'];
const paraCentavos = (v) => Math.round(Number(v) * 100);

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
 *   b) o valor pago é comparado com o total: pagou menos, não vira "pago";
 *   c) nunca cria pedido nem volta o status para trás: só o pedido "aguardando pagamento" anda;
 *   d) pedido cancelado que recebe PIX fica marcado e a equipe é avisada para devolver.
 * O estoque NÃO é mexido aqui: quem baixa é o checkout, uma vez só.
 */
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
    if (pg.status === 'PAID') return null;                                  // já processado (o banco repete o aviso)

    if (!pago) {
      const rotulo = ROTULOS.includes(charges[0] && charges[0].status) ? charges[0].status : 'WAITING';
      if (pg.status !== rotulo) t.update(pedidoRef, { pagamento: { ...pg, status: rotulo } });
      return null;
    }

    const totalC = paraCentavos(pedido.total), cobradoC = Number.isFinite(Number(pg.valorC)) ? Number(pg.valorC) : null;
    const recebidoC = pagoC !== null ? pagoC : cobradoC;                    // o banco não disse quanto: vale o valor do QR que nós mesmos criamos
    if (recebidoC !== null && Number.isFinite(totalC) && recebidoC < totalC) {
      if (pg.status === 'PAGO_PARCIAL') return null;                        // já avisado
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
  return aviso ? { ...aviso, tid, pedidoId } : null;
}

module.exports = { BASE_URL, valorPagoC, consultarOrdem, destinoDaOrdem, aplicarOrdem, ROTULOS };
