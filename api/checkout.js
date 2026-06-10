const admin = require('firebase-admin');

const formatPrivateKey = (key) => {
  if (!key) return '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
};

let db;

// [3] Inicialização Estável
const bootFirebase = () => {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (!projectId || !clientEmail || !privateKey) throw new Error("Variáveis do Firebase ausentes.");

    try {
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    } catch (certError) {
      throw new Error("Credenciais inválidas.");
    }
  }
  if (!db) db = admin.firestore();
};

const paraCentavos = (valor) => Math.round(valor * 100);
const paraFlutuante = (centavos) => parseFloat((centavos / 100).toFixed(2));

const sanitizeString = (str, maxLength) => {
    if (!str) return '';
    const cleanStr = String(str).trim();
    return cleanStr.length > maxLength ? cleanStr.substring(0, maxLength) : cleanStr;
};

// [4] Rate Limit Básico para Checkout
const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método não permitido.' });

  // Rate Limiting (Previne flood de pedidos falsos pelo mesmo IP)
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const agora = Date.now();
  if (rateLimitMap.has(ip) && agora - rateLimitMap.get(ip) < 5000) {
      return res.status(429).json({ sucesso: false, error: 'Processando muitos pedidos. Aguarde alguns segundos.' });
  }
  rateLimitMap.set(ip, agora);
  if (rateLimitMap.size > 2000) rateLimitMap.clear();

  try { bootFirebase(); } catch (bootError) { return res.status(500).json({ sucesso: false, error: "Erro interno no servidor." }); }

  const bodySize = JSON.stringify(req.body).length;
  if (bodySize > 15000) return res.status(413).json({ sucesso: false, error: 'Payload abusivo.' });

  let { nome, quadra, lote, pag, troco, obs, itens, clientTotal, idempotencyKey, userId } = req.body;

  if (!idempotencyKey) return res.status(400).json({ sucesso: false, error: 'Falha de segurança: Chave de Idempotência ausente.' });
  if (!nome || !quadra || !lote || !pag || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ sucesso: false, error: 'Dados incompletos.' });
  }

  nome = sanitizeString(nome, 100);
  quadra = sanitizeString(quadra, 20);
  lote = sanitizeString(lote, 20);
  obs = sanitizeString(obs, 500);

  try {
    const resultado = await db.runTransaction(async (transaction) => {
      // 1. CHECAGEM DE IDEMPOTÊNCIA
      const pedidoRef = db.collection("pedidos").doc(idempotencyKey);
      const pedidoSnap = await transaction.get(pedidoRef);
      
      const configRef = db.doc("loja/config");
      const configSnap = await transaction.get(configRef);
      const configData = configSnap.data();

      if (pedidoSnap.exists) {
         return { id: pedidoRef.id, total: pedidoSnap.data().total, whatsappMsg: montarTextoWhatsApp(pedidoSnap.data(), configData.wpp) };
      }

      if (configData.lojaAberta === false) throw new Error("A loja está fechada.");
      
      let totalAcumuladoCentavos = 0;
      const itensValidados = [];

      for (const item of itens) {
        if (!item.id || item.qtd <= 0 || item.qtd > 500) throw new Error("Quantidade inválida.");
        const prodRef = db.doc(`produtos/${item.id}`);
        const prodSnap = await transaction.get(prodRef);
        
        if (!prodSnap.exists) throw new Error("Produto inexistente.");
        const prodData = prodSnap.data();
        if (prodData.ativo === false) throw new Error(`O produto ${prodData.nome} esgotou.`);

        const precoUnidadeCentavos = paraCentavos(prodData.preco);
        const subtotalItemCentavos = Math.round(precoUnidadeCentavos * item.qtd);
        totalAcumuladoCentavos += subtotalItemCentavos;

        itensValidados.push({
          id: item.id, nome: prodData.nome, qtd: item.qtd,
          preco: prodData.preco, unidade: prodData.unidade || "un",
          subtotal: paraFlutuante(subtotalItemCentavos)
        });
      }

      const totalFinalFlutuante = paraFlutuante(totalAcumuladoCentavos);
      
      // 2. CHECAGEM DE PREÇO (Segurança Financeira)
      const clientTotalVal = parseFloat(clientTotal);
      if (Math.abs(totalFinalFlutuante - clientTotalVal) > 0.05) {
          throw new Error(`Houve alteração nos preços (Atual: R$ ${totalFinalFlutuante.toFixed(2).replace('.',',')}). Atualize o carrinho.`);
      }

      if (totalFinalFlutuante < (configData.minimo || 0)) throw new Error(`O pedido mínimo é R$ ${configData.minimo}.`);

      let trocoFormatado = "";
      if (pag === "Dinheiro" && troco && troco !== "Não preciso") {
        const valorTroco = parseFloat(String(troco).replace(",", "."));
        if (isNaN(valorTroco) || valorTroco < totalFinalFlutuante) throw new Error("Troco inválido.");
        trocoFormatado = `(Troco p/: R$ ${valorTroco.toFixed(2).replace(".", ",")})`;
      } else if (pag === "Dinheiro") {
        trocoFormatado = "(Dinheiro trocado)";
      }
      
      const dadosPedido = {
        id: pedidoRef.id, 
        userId: userId || "anonimo", // Integração com Firestore Security Rules
        nome, 
        quadra, 
        lote, 
        pag: trocoFormatado ? `${pag} ${trocoFormatado}` : pag,
        obs, 
        total: totalFinalFlutuante, 
        itens: itensValidados,
        data: new Date().toISOString(), 
        status: "pendente" 
      };

      transaction.set(pedidoRef, dadosPedido);

      const analyticsRef = db.doc("analytics/dashboard");
      transaction.set(analyticsRef, {
        receitaTotal: admin.firestore.FieldValue.increment(totalFinalFlutuante),
        totalPedidos: admin.firestore.FieldValue.increment(1)
      }, { merge: true });

      return { id: pedidoRef.id, total: totalFinalFlutuante, whatsappMsg: montarTextoWhatsApp(dadosPedido, configData.wpp) };
    });

    return res.status(200).json({ sucesso: true, pedido: resultado });

  } catch (error) {
    return res.status(400).json({ sucesso: false, error: error.message });
  }
};

function montarTextoWhatsApp(pedido, numero) {
  let msg = `*NOVO PEDIDO*\n👤 ${pedido.nome}\n📍 Q${pedido.quadra} L${pedido.lote}\n💳 Pag: ${pedido.pag}\n\n*ITENS:*\n`;
  pedido.itens.forEach(i => msg += `• ${i.qtd}x ${i.nome} - R$ ${i.subtotal.toFixed(2).replace('.',',')}\n`);
  msg += `\n*TOTAL: R$ ${pedido.total.toFixed(2).replace('.',',')}*`;
  if (pedido.obs) msg += `\n\n📝 *Obs:* ${pedido.obs}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}
