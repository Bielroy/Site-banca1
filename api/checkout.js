const admin = require('firebase-admin');

// FASE 3: Rate Limiting Distribuído
let kv;
try { kv = require('@vercel/kv').kv; } catch(e) {}

const formatPrivateKey = (key) => key ? key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '';
let db;

const bootFirebase = () => {
  if (!admin.apps.length) {
    const pId = process.env.FIREBASE_PROJECT_ID; const cEmail = process.env.FIREBASE_CLIENT_EMAIL; const pKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    if (!pId || !cEmail || !pKey) throw new Error("Variáveis do Firebase ausentes.");
    admin.initializeApp({ credential: admin.credential.cert({ projectId: pId, clientEmail: cEmail, privateKey: pKey }) });
  }
  if (!db) db = admin.firestore();
};

const paraCentavos = (valor) => Math.round(valor * 100);
const paraFlutuante = (centavos) => parseFloat((centavos / 100).toFixed(2));
const sanitizeString = (str, maxLength) => str ? String(str).trim().substring(0, maxLength).replace(/[^a-zA-Z0-9\s-]/g, '') : '';

const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  try {
      if (kv && process.env.KV_REST_API_URL) {
          const limit = await kv.incr(`checkout:${ip}`);
          if (limit === 1) await kv.expire(`checkout:${ip}`, 20);
          if (limit > 3) return res.status(429).json({ error: 'Aguarde antes de enviar novo pedido.' });
      } else {
          if (rateLimitMap.has(ip) && Date.now() - rateLimitMap.get(ip) < 5000) return res.status(429).json({ error: 'Processando...' });
          rateLimitMap.set(ip, Date.now());
      }
  } catch(e) {}

  try { bootFirebase(); } catch(e) { return res.status(500).json({ error: "Erro interno." }); }

  let { nome, quadra, lote, pag, cupom, itens, clientTotal, idempotencyKey, userId } = req.body;
  if (!idempotencyKey || !nome || !quadra || !Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'Dados incompletos.' });

  nome = sanitizeString(nome, 100); quadra = sanitizeString(quadra, 30); lote = sanitizeString(lote, 30);

  try {
    const resultado = await db.runTransaction(async (transaction) => {
      const pedidoRef = db.collection("pedidos").doc(idempotencyKey);
      const pedidoSnap = await transaction.get(pedidoRef);
      if (pedidoSnap.exists) return { id: pedidoRef.id, total: pedidoSnap.data().total, whatsappMsg: montarTextoWhatsApp(pedidoSnap.data(), "5562999999999") };

      let totalAcumuladoCentavos = 0; const itensValidados = [];

      for (const item of itens) {
        const prodSnap = await transaction.get(db.doc(`produtos/${item.id}`));
        if (!prodSnap.exists || !prodSnap.data().ativo) throw new Error("Produto indisponível ou esgotado no sistema.");
        const prodData = prodSnap.data();
        
        // FASE 3: Dedução no Stock Quantitativo (3.03)
        if (prodData.estoqueFisico !== null && prodData.estoqueFisico !== undefined) {
            let novoEstoque = prodData.estoqueFisico - item.qtd;
            if (novoEstoque < 0) throw new Error(`O produto ${prodData.nome} não tem stock suficiente.`);
            transaction.update(prodSnap.ref, { estoqueFisico: novoEstoque, ativo: novoEstoque > 0 });
        }

        const subtotalItemCentavos = Math.round(paraCentavos(prodData.preco) * item.qtd);
        totalAcumuladoCentavos += subtotalItemCentavos;
        itensValidados.push({ id: item.id, nome: prodData.nome, qtd: item.qtd, preco: prodData.preco, subtotal: paraFlutuante(subtotalItemCentavos), unidade: prodData.unidade || "un" });
      }

      let totalFinalFlutuante = paraFlutuante(totalAcumuladoCentavos);
      
      // FASE 3: Lógica de Aplicação da Negociação da IA (3.04)
      let descAplicadoStr = '';
      if (cupom && cupom.toUpperCase() === 'IA-DESCONTO-10') {
          const desconto = totalFinalFlutuante * 0.10;
          totalFinalFlutuante -= desconto;
          descAplicadoStr = `\n🎁 Cupão Aplicado: IA-DESCONTO (-R$ ${desconto.toFixed(2).replace('.',',')})`;
      }

      const dadosPedido = {
        id: pedidoRef.id, userId: userId || "anonimo", nome, quadra, lote, pag, total: totalFinalFlutuante, itens: itensValidados, data: new Date().toISOString(), status: "pendente",
        obs: descAplicadoStr
      };

      transaction.set(pedidoRef, dadosPedido);
      transaction.set(db.doc("analytics/dashboard"), { receitaTotal: admin.firestore.FieldValue.increment(totalFinalFlutuante), totalPedidos: admin.firestore.FieldValue.increment(1) }, { merge: true });

      return { id: pedidoRef.id, total: totalFinalFlutuante, whatsappMsg: montarTextoWhatsApp(dadosPedido, "5562999999999") };
    });

    return res.status(200).json({ sucesso: true, pedido: resultado });
  } catch (error) { return res.status(400).json({ error: error.message }); }
};

function montarTextoWhatsApp(pedido, numero) {
  let msg = `*NOVO PEDIDO*\n👤 ${pedido.nome}\n📍 Q${pedido.quadra} L${pedido.lote}\n💳 Pag: ${pedido.pag}\n\n*ITENS:*\n`;
  pedido.itens.forEach(i => msg += `• ${i.qtd}x ${i.nome} - R$ ${i.subtotal.toFixed(2).replace('.',',')}\n`);
  msg += `\n*TOTAL: R$ ${pedido.total.toFixed(2).replace('.',',')}*`;
  if(pedido.obs) msg += `\n${pedido.obs}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}
