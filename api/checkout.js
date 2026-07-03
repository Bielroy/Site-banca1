// =====================================================================
//  /api/checkout.js  —  VERSÃO CORRIGIDA (v3.1)
//  Substitui o antigo checkout.js na íntegra.
//
//  Correções principais vs. versão anterior:
//   [CRÍTICO] Itens "a pesar" (tipo 'un' de produto fracionável) NÃO
//             entram mais no total nem baixam estoque com qtd errada.
//   [CRÍTICO] O nº de WhatsApp agora vem de loja/config (não mais fixo).
//   [CRÍTICO] tipo/aPesar/precoOriginal são PERSISTIDOS no pedido, para
//             o fluxo de pesagem do admin funcionar.
//   [ALTO]    Persiste troco, obs e pag; mensagem de WhatsApp completa.
//   [ALTO]    status é recalculado no servidor (fonte de verdade).
//   [MÉDIO]   sanitizeString preserva acentos (não vira "Jos" p/ "José").
//   [MÉDIO]   Rate-limit em memória com poda (evita vazamento em warm start).
// =====================================================================

const admin = require('firebase-admin');

let kv;
try { kv = require('@vercel/kv').kv; } catch (e) { /* KV opcional */ }

// ---------------------------------------------------------------------
// Helpers de dinheiro (centavos evitam erro de ponto flutuante)
// ---------------------------------------------------------------------
const paraCentavos   = (v) => Math.round(Number(v) * 100);
const paraFlutuante  = (c) => parseFloat((c / 100).toFixed(2));
const fixFloat       = (n) => Math.round(n * 1000) / 1000;
const fmtBRL         = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

// Unidades que são vendidas por peso/volume (fracionáveis)
const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const isFracionavel = (u) => FRACIONAVEIS.includes(String(u || '').toLowerCase());

// Preserva letras acentuadas; remove só o que é perigoso p/ layout/injeção
const sanitizeString = (str, maxLength = 120) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .normalize('NFC')
    .replace(/[<>]/g, '')     // evita quebrar HTML no painel
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
};

const WPP_FALLBACK = process.env.WHATSAPP_FALLBACK || '5562999999999';
const resolveWpp = (configSnap) => {
  const raw = configSnap && configSnap.exists ? configSnap.data().wpp : null;
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : WPP_FALLBACK;
};

// ---------------------------------------------------------------------
// Boot do Firebase Admin (singleton entre invocações "warm")
// ---------------------------------------------------------------------
const formatPrivateKey = (key) =>
  key ? key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '';

let db;
const bootFirebase = () => {
  if (!admin.apps.length) {
    const projectId  = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Variáveis do Firebase ausentes no ambiente.');
    }
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  }
  if (!db) db = admin.firestore();
};

// ---------------------------------------------------------------------
// Rate limit fallback em memória (com poda p/ não vazar)
// ---------------------------------------------------------------------
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 5000;
const pruneRateLimit = () => {
  const agora = Date.now();
  for (const [ip, ts] of rateLimitMap) {
    if (agora - ts > RATE_WINDOW_MS) rateLimitMap.delete(ip);
  }
};

// ---------------------------------------------------------------------
// Montagem da mensagem de WhatsApp (agora com "a pesar", troco e obs)
// ---------------------------------------------------------------------
function montarTextoWhatsApp(pedido, numero) {
  let msg = `*NOVO PEDIDO*\n`;
  msg += `👤 ${pedido.nome}\n`;
  msg += `📍 Quadra ${pedido.quadra} • Lote ${pedido.lote}\n`;
  msg += `💳 Pagamento: ${pedido.pag || 'A combinar'}\n`;
  if (pedido.troco) msg += `💵 Troco para: ${pedido.troco}\n`;
  msg += `\n*ITENS:*\n`;

  (pedido.itens || []).forEach((i) => {
    if (i.aPesar) {
      msg += `• ${i.qtd} un de ${i.nome}  ⚖️ _(a pesar na balança)_\n`;
    } else {
      const und = isFracionavel(i.unidade) ? ` ${i.unidade}` : 'x';
      const rotulo = isFracionavel(i.unidade) ? `${i.qtd}${und}` : `${i.qtd}x`;
      msg += `• ${rotulo} ${i.nome} — ${fmtBRL(i.subtotal)}\n`;
    }
  });

  msg += `\n*Subtotal (itens já pesados): ${fmtBRL(pedido.total)}*`;
  if (pedido.temItensAPesar) {
    msg += `\n➕ _Os itens marcados com ⚖️ serão pesados e o valor final ajustado._`;
  }
  if (pedido.obs) msg += `\n\n📝 Obs: ${pedido.obs}`;

  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  // Rate limit
  try {
    if (kv && process.env.KV_REST_API_URL) {
      const n = await kv.incr(`checkout:${ip}`);
      if (n === 1) await kv.expire(`checkout:${ip}`, 20);
      if (n > 3) return res.status(429).json({ error: 'Aguarde antes de enviar um novo pedido.' });
    } else {
      pruneRateLimit();
      const ultimo = rateLimitMap.get(ip);
      if (ultimo && Date.now() - ultimo < RATE_WINDOW_MS) {
        return res.status(429).json({ error: 'Processando o pedido anterior...' });
      }
      rateLimitMap.set(ip, Date.now());
    }
  } catch (e) { /* nunca bloqueia o pedido por falha do limitador */ }

  try { bootFirebase(); }
  catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }

  // Validação de entrada
  let { nome, quadra, lote, pag, troco, obs, cupom, itens, idempotencyKey, userId } = req.body || {};
  if (!idempotencyKey || !nome || !quadra || !lote || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Dados do pedido incompletos.' });
  }
  if (itens.length > 100) return res.status(400).json({ error: 'Pedido excede o limite de itens.' });

  nome   = sanitizeString(nome, 100);
  quadra = sanitizeString(quadra, 30);
  lote   = sanitizeString(lote, 30);
  pag    = sanitizeString(pag, 30);
  troco  = sanitizeString(troco, 40);
  obs    = sanitizeString(obs, 300);

  try {
    const resultado = await db.runTransaction(async (t) => {
      const pedidoRef = db.collection('pedidos').doc(idempotencyKey);
      const configRef = db.doc('loja/config');

      // ---- TODAS as leituras ANTES de qualquer escrita (regra do Firestore) ----
      const [pedidoSnap, configSnap] = await Promise.all([t.get(pedidoRef), t.get(configRef)]);

      // Idempotência: pedido já criado -> retorna o mesmo resultado
      if (pedidoSnap.exists) {
        const d = pedidoSnap.data();
        return { id: pedidoRef.id, total: d.total, temItensAPesar: !!d.temItensAPesar,
                 whatsappMsg: montarTextoWhatsApp(d, resolveWpp(configSnap)) };
      }

      const wpp = resolveWpp(configSnap);

      // Loja fechada? (defesa extra além do front)
      if (configSnap.exists) {
        const cfg = configSnap.data();
        if (cfg.lojaAberta === false) throw new Error('A loja está fechada no momento.');
        const diasAbertos = cfg.diasAbertos || [0, 1, 2, 3, 4, 5, 6];
        if (!diasAbertos.includes(new Date().getDay())) throw new Error('A loja não abre hoje.');
      }

      const prodSnaps = await Promise.all(itens.map((i) => t.get(db.doc(`produtos/${i.id}`))));

      // ---- Cálculo (ainda sem escrever) ----
      let totalExatoCentavos = 0;
      const itensValidados = [];
      const estoqueUpdates = [];

      itens.forEach((item, idx) => {
        const snap = prodSnaps[idx];
        if (!snap.exists) throw new Error(`Um produto do carrinho não existe mais.`);
        const p = snap.data();
        if (p.ativo === false) throw new Error(`"${p.nome}" está esgotado.`);

        const fracionavel = isFracionavel(p.unidade);
        // tipo escolhido pelo cliente; produto não-fracionável é sempre 'un'
        const tipo = (item.tipo === 'un') ? 'un' : (fracionavel ? 'kg' : 'un');
        const aPesar = fracionavel && tipo === 'un';

        // qtd inteira para unidade; float para peso
        let qtd = Number(String(item.qtd).replace(',', '.'));
        if (!Number.isFinite(qtd) || qtd <= 0) throw new Error(`Quantidade inválida para "${p.nome}".`);
        qtd = (aPesar || !fracionavel) ? Math.round(qtd) : fixFloat(qtd);

        if (aPesar) {
          // NÃO soma no total (preço só após pesagem) e NÃO baixa estoque por unidade
          itensValidados.push({
            id: item.id, nome: p.nome, qtd, tipo: 'un', aPesar: true,
            precoOriginal: p.preco, unidade: p.unidade || 'un', subtotal: 0,
          });
        } else {
          const subC = Math.round(paraCentavos(p.preco) * qtd);
          totalExatoCentavos += subC;
          itensValidados.push({
            id: item.id, nome: p.nome, qtd, tipo, aPesar: false,
            preco: p.preco, precoOriginal: p.preco, unidade: p.unidade || 'un',
            subtotal: paraFlutuante(subC),
          });
          // Baixa de estoque só para itens de valor fechado
          if (p.estoqueFisico !== null && p.estoqueFisico !== undefined && p.estoqueFisico !== '') {
            const novo = fixFloat(Number(p.estoqueFisico) - qtd);
            if (novo < 0) throw new Error(`"${p.nome}" não tem estoque suficiente.`);
            estoqueUpdates.push([snap.ref, { estoqueFisico: novo, ativo: novo > 0 }]);
          }
        }
      });

      // Cupom (opcional). Em produção, valide contra uma coleção "cupons".
      let obsFinal = obs;
      if (cupom && String(cupom).toUpperCase() === 'IA-DESCONTO-10') {
        const descC = Math.round(totalExatoCentavos * 0.10);
        totalExatoCentavos -= descC;
        obsFinal = `${obs ? obs + ' | ' : ''}🎁 Cupom IA-DESCONTO (-${fmtBRL(paraFlutuante(descC))})`;
      }

      const totalExato = paraFlutuante(totalExatoCentavos);
      const temItensAPesar = itensValidados.some((i) => i.aPesar);

      const dadosPedido = {
        id: pedidoRef.id,
        userId: userId || 'anonimo',
        nome, quadra, lote, pag, troco: troco || '', obs: obsFinal || '',
        itens: itensValidados,
        total: totalExato,        // total dos itens de valor fechado
        clientTotal: totalExato,  // usado pelo painel de pesagem como base
        temItensAPesar,
        status: temItensAPesar ? 'aguardando_pesagem' : 'pendente',
        data: new Date().toISOString(),
        origem: 'whatsapp',
      };

      // ---- Agora sim, as escritas ----
      estoqueUpdates.forEach(([ref, patch]) => t.update(ref, patch));
      t.set(pedidoRef, dadosPedido);
      t.set(db.doc('analytics/dashboard'), {
        receitaTotal: admin.firestore.FieldValue.increment(totalExato),
        totalPedidos: admin.firestore.FieldValue.increment(1),
      }, { merge: true });

      return { id: pedidoRef.id, total: totalExato, temItensAPesar,
               whatsappMsg: montarTextoWhatsApp(dadosPedido, wpp) };
    });

    return res.status(200).json({ sucesso: true, pedido: resultado });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Não foi possível registrar o pedido.' });
  }
};
