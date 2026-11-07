'use strict';
// =====================================================================
//  lib/asaas.js — PIX pelo ASAAS (conta da plataforma + carteira de cada banca).
//
//  Como o dinheiro anda:
//    • a cobrança é criada na conta Asaas da PLATAFORMA (a chave guardada no servidor);
//    • loja original: o valor fica nessa conta (como era com o PagBank);
//    • outra loja: a cobrança sai com "split" para a CARTEIRA (walletId) da banca, que
//      recebe 100% do valor líquido (menos a comissão da plataforma, se houver:
//      ASAAS_COMISSAO_PCT). Loja sem carteira cadastrada não gera PIX automático.
//
//  A fonte de verdade é sempre a consulta da cobrança no Asaas: o aviso (webhook) e o
//  "conferir pagamento" só trazem o ID. A gravação no pedido usa as MESMAS regras do
//  PagBank (lib/pagbank.js, aplicarOrdem): a cobrança é traduzida para o formato de ordem.
//
//  Doc: https://docs.asaas.com (cobranças via Pix, split, webhooks).
// =====================================================================
const PagBank = require('./pagbank');
const Dias = require('./dias');

const BASES = { sandbox: 'https://api-sandbox.asaas.com/v3', producao: 'https://api.asaas.com/v3' };
const ID_COBRANCA = /^pay_[A-Za-z0-9]{4,60}$/;
const ID_CLIENTE = /^cus_[A-Za-z0-9]{4,60}$/;
const CARTEIRA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const DESFEITOS = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];

/** Ambiente pela própria chave ("$aact_hmlg_..." = teste, "$aact_prod_..." = produção); senão, o que foi escolhido (padrão: teste). */
function ambienteDaChave(chave, escolhido) {
  const c = String(chave || '');
  if (/^\$?aact_hmlg_/.test(c)) return 'sandbox';
  if (/^\$?aact_prod_/.test(c)) return 'producao';
  return escolhido === 'producao' ? 'producao' : 'sandbox';
}

const carteiraValida = (w) => CARTEIRA.test(String(w || ''));

/** Comissão da plataforma em % (0 a 50). Vazio ou estranho = 0: a banca recebe tudo. */
function comissaoPct() {
  const n = Number(String(process.env.ASAAS_COMISSAO_PCT || '0').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 50 ? Math.round(n * 100) / 100 : 0;
}

async function chamar(cfg, metodo, caminho, corpo) {
  const base = process.env.ASAAS_BASE_URL || BASES[cfg.ambiente === 'producao' ? 'producao' : 'sandbox'];
  let resp;
  try {
    resp = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: { access_token: cfg.chave, 'Content-Type': 'application/json', 'User-Agent': 'usebanca/1.0 (feira)' },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) { return { ok: false, status: 0, temporario: true, dados: null }; }
  const dados = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, temporario: resp.status >= 500 || resp.status === 429, dados };
}

/** Primeira mensagem de erro que o Asaas devolveu (para o registro do servidor; nunca vai ao cliente como está). */
const erroDe = (r) => String((r && r.dados && Array.isArray(r.dados.errors) && r.dados.errors[0] && (r.dados.errors[0].description || r.dados.errors[0].code)) || `HTTP ${r && r.status}`).slice(0, 300);

/**
 * Cria cliente + cobrança PIX. Devolve { id } ou { erro, status }.
 * dados = { nome, cpf (11 números), email, valorC (centavos), referencia ("loja~pedido"), descricao, carteira }
 */
async function criarCobrancaPix(cfg, dados) {
  const cli = await chamar(cfg, 'POST', '/customers', {
    name: String(dados.nome || 'Cliente').slice(0, 100), cpfCnpj: dados.cpf,
    ...(dados.email ? { email: dados.email } : {}), externalReference: dados.referencia, notificationDisabled: true,
  });
  if (!cli.ok || !cli.dados || !ID_CLIENTE.test(String(cli.dados.id || ''))) return { erro: erroDe(cli), status: cli.status, temporario: cli.temporario };

  const valor = Math.round(Number(dados.valorC)) / 100;
  const corpo = {
    customer: cli.dados.id, billingType: 'PIX', value: valor, dueDate: Dias.diaBR().dia,
    description: String(dados.descricao || 'Pedido').slice(0, 200), externalReference: dados.referencia,
  };
  if (dados.carteira) {
    if (!carteiraValida(dados.carteira)) return { erro: 'carteira inválida', status: 400 };
    corpo.split = [{ walletId: dados.carteira, percentualValue: Math.round((100 - comissaoPct()) * 100) / 100 }];
  }
  const pg = await chamar(cfg, 'POST', '/payments', corpo);
  if (!pg.ok || !pg.dados || !ID_COBRANCA.test(String(pg.dados.id || ''))) return { erro: erroDe(pg), status: pg.status, temporario: pg.temporario };
  return { id: pg.dados.id };
}

/** QR Code da cobrança: { payload, imagem } (imagem = PNG em base64) ou null. Tenta 2 vezes (logo depois de criar pode demorar um instante). */
async function qrDaCobranca(cfg, id) {
  if (!ID_COBRANCA.test(String(id || ''))) return null;
  for (let i = 0; i < 2; i++) {
    const r = await chamar(cfg, 'GET', `/payments/${id}/pixQrCode`);
    const d = r.ok && r.dados;
    if (d && typeof d.payload === 'string' && d.payload.length > 20 && d.payload.length < 1000) {
      const img = typeof d.encodedImage === 'string' && d.encodedImage.length < 300000 && /^[A-Za-z0-9+/=\s]+$/.test(d.encodedImage) ? d.encodedImage.replace(/\s/g, '') : '';
      return { payload: d.payload, imagem: img };
    }
    if (i === 0) await new Promise((ok) => setTimeout(ok, process.env.ASAAS_ESPERA_QR_MS ? Number(process.env.ASAAS_ESPERA_QR_MS) : 800));
  }
  return null;
}

/**
 * Consulta uma cobrança.
 *   { cobranca }         achou
 *   { temporario: true } rede caiu ou o Asaas deu erro 5xx/429: tentar depois
 *   {}                   não existe / ID estranho: não adianta tentar de novo
 */
async function consultarCobranca(cfg, id) {
  if (!ID_COBRANCA.test(String(id || ''))) return {};
  const r = await chamar(cfg, 'GET', `/payments/${id}`);
  if (!r.ok) return r.temporario ? { temporario: true } : {};
  return r.dados && r.dados.id === id ? { cobranca: r.dados } : {};
}

/** A cobrança do Asaas no formato de ordem que lib/pagbank.js (aplicarOrdem) entende. */
function paraOrdem(c) {
  const st = String((c && c.status) || '');
  const pago = PAGOS.includes(st) && c.deleted !== true;
  const rotulo = pago ? 'PAID' : (c && c.deleted === true) || DESFEITOS.includes(st) ? 'CANCELED' : 'WAITING';
  const v = Number(c && c.value);
  return {
    id: c && c.id, reference_id: String((c && c.externalReference) || ''),
    charges: [{ status: rotulo, amount: Number.isFinite(v) && v > 0 ? { value: Math.round(v * 100) } : {} }],
  };
}

/** Grava no pedido o que o Asaas disse da cobrança (mesmas regras do PagBank). Devolve o aviso para a equipe ou null. */
const aplicarCobranca = (db, cobranca) => PagBank.aplicarOrdem(db, paraOrdem(cobranca));

module.exports = { BASES, ambienteDaChave, carteiraValida, comissaoPct, criarCobrancaPix, qrDaCobranca, consultarCobranca, paraOrdem, aplicarCobranca, ID_COBRANCA, PAGOS };
