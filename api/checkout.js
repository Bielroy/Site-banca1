import admin from 'firebase-admin';

// Inicializa o Firebase Admin com proteção para evitar recarregamento no Serverless (Cold Start)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // O Vercel lida com quebras de linha nas variáveis de ambiente
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    })
  });
}

const db = admin.firestore();

// Helpers financeiros de alta precisão
const paraCentavos = (valor) => Math.round(valor * 100);
const paraFlutuante = (centavos) => parseFloat((centavos / 100).toFixed(2));

export default async function handler(req, res) {
  // Configuração restrita de CORS para o Frontend
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  const { nome, quadra, lote, pag, troco, obs, itens } = req.body;

  // Sanitização de Entrada
  if (!nome || !quadra || !lote || !pag || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Payload malformado ou itens ausentes.' });
  }

  try {
    const resultado = await db.runTransaction(async (transaction) => {
      // 1. Lógica de Parâmetros da Loja
      const configRef = db.doc("loja/config");
      const configSnap = await transaction.get(configRef);
      if (!configSnap.exists) throw new Error("Parâmetros da loja não configurados.");
      
      const configData = configSnap.data();
      if (configData.lojaAberta === false) throw new Error("A loja encontra-se fechada.");
      
      const diaSemanaHoje = new Date().getDay();
      const diasPermitidos = configData.diasAbertos || [0, 1, 2, 3, 4, 5, 6];
      if (!diasPermitidos.includes(diaSemanaHoje)) throw new Error("Fora do dia de funcionamento.");

      let totalAcumuladoCentavos = 0;
      const itensValidados = [];
      const contagemProdutos = {};

      // 2. Cálculo Seguro no Servidor
      for (const item of itens) {
        if (!item.id || item.qtd <= 0) throw new Error("Item corrompido no carrinho.");

        const prodRef = db.doc(`produtos/${item.id}`);
        const prodSnap = await transaction.get(prodRef);

        if (!prodSnap.exists) throw new Error(`Produto não localizado no banco.`);
        const prodData = prodSnap.data();
        if (prodData.ativo === false) throw new Error(`O produto ${prodData.nome} esgotou.`);

        const precoUnidadeCentavos = paraCentavos(prodData.preco);
        const subtotalItemCentavos = Math.round(precoUnidadeCentavos * item.qtd);
        totalAcumuladoCentavos += subtotalItemCentavos;

        itensValidados.push({
          id: item.id,
          nome: prodData.nome,
          qtd: item.qtd,
          preco: prodData.preco,
          unidade: prodData.unidade || "un",
          subtotal: paraFlutuante(subtotalItemCentavos)
        });

        contagemProdutos[item.nome || prodData.nome] = item.qtd;
      }

      const totalFinalFlutuante = paraFlutuante(totalAcumuladoCentavos);
      if (totalFinalFlutuante < (configData.minimo || 0)) {
        throw new Error(`O valor mínimo do pedido é ${configData.minimo}.`);
      }

      // 3. Regra do Troco Otimizada
      let trocoFormatado = "";
      if (pag === "Dinheiro") {
        if (troco && troco !== "Não preciso") {
          const valorTrocoDigitado = parseFloat(String(troco).replace(",", "."));
          if (isNaN(valorTrocoDigitado) || valorTrocoDigitado <= totalFinalFlutuante) {
            throw new Error("Troco menor que o total da compra.");
          }
          trocoFormatado = `(Troco para: R$ ${valorTrocoDigitado.toFixed(2).replace(".", ",")})`;
        } else {
          trocoFormatado = "(Dinheiro trocado)";
        }
      }

      // 4. Criação do Pedido
      const novoPedidoId = `PED-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const pedidoRef = db.doc(`pedidos/${novoPedidoId}`);

      const dadosPedido = {
        id: novoPedidoId,
        nome, quadra, lote, 
        pag: trocoFormatado ? `${pag} ${trocoFormatado}` : pag,
        obs: obs || "",
        total: totalFinalFlutuante,
        itens: itensValidados,
        data: new Date().toISOString(),
        status: "pendente"
      };

      transaction.set(pedidoRef, dadosPedido);

      // 5. Analytics (Evita Billing Bomb)
      const analyticsRef = db.doc("analytics/dashboard");
      const atualizacoes = {
        receitaTotal: admin.firestore.FieldValue.increment(totalFinalFlutuante),
        totalPedidos: admin.firestore.FieldValue.increment(1)
      };

      transaction.set(analyticsRef, atualizacoes, { merge: true });

      return { id: novoPedidoId, total: totalFinalFlutuante, whatsappMsg: montarTextoWhatsApp(dadosPedido, configData.wpp) };
    });

    return res.status(200).json({ sucesso: true, pedido: resultado });

  } catch (error) {
    return res.status(400).json({ sucesso: false, error: error.message });
  }
}

// Helper para formatar o link de envio seguro no servidor
function montarTextoWhatsApp(pedido, numero) {
  let msg = `*NOVO PEDIDO (Seguro)*\n👤 ${pedido.nome}\n📍 Q${pedido.quadra} L${pedido.lote}\n💳 Pagamento: ${pedido.pag}\n\n*ITENS:*\n`;
  pedido.itens.forEach(i => {
    msg += `• ${i.qtd}x ${i.nome} - R$ ${i.subtotal.toFixed(2).replace('.',',')}\n`;
  });
  msg += `\n*TOTAL: R$ ${pedido.total.toFixed(2).replace('.',',')}*`;
  if (pedido.obs) msg += `\n\n📝 *Obs:* ${pedido.obs}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}
