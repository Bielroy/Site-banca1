import admin from 'firebase-admin';

// Sanitizador brutal de Chave Privada (Previne erros de cópia e cola na Vercel)
const formatPrivateKey = (key) => {
  if (!key) return '';
  return key
    .replace(/\\n/g, '\n') // Converte barra-n literal em quebra de linha real
    .replace(/^"|"$/g, '') // Remove aspas duplas no início e no fim, se existirem
    .trim();
};

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      })
    });
  } catch (initError) {
    console.error("FALHA CRÍTICA NA INICIALIZAÇÃO DO FIREBASE:", initError.message);
  }
}

const db = admin.firestore();

const paraCentavos = (valor) => Math.round(valor * 100);
const paraFlutuante = (centavos) => parseFloat((centavos / 100).toFixed(2));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  // Trava de segurança: Verifica se as variáveis de ambiente foram carregadas
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
    console.error("ERRO DE AMBIENTE: Variáveis do Firebase ausentes na Vercel.");
    return res.status(500).json({ error: 'Erro de configuração no servidor (Variáveis de Ambiente).' });
  }

  const { nome, quadra, lote, pag, troco, obs, itens } = req.body;

  if (!nome || !quadra || !lote || !pag || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Payload malformado ou itens ausentes.' });
  }

  try {
    const resultado = await db.runTransaction(async (transaction) => {
      const configRef = db.doc("loja/config");
      const configSnap = await transaction.get(configRef);
      if (!configSnap.exists) throw new Error("Parâmetros da loja não configurados.");
      
      const configData = configSnap.data();
      if (configData.lojaAberta === false) throw new Error("A loja encontra-se fechada.");
      
      let totalAcumuladoCentavos = 0;
      const itensValidados = [];

      for (const item of itens) {
        if (!item.id || item.qtd <= 0) throw new Error("Item corrompido.");
        const prodRef = db.doc(`produtos/${item.id}`);
        const prodSnap = await transaction.get(prodRef);
        if (!prodSnap.exists) throw new Error(`Produto não localizado.`);
        const prodData = prodSnap.data();
        if (prodData.ativo === false) throw new Error(`Produto esgotado.`);

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
      }

      const totalFinalFlutuante = paraFlutuante(totalAcumuladoCentavos);
      if (totalFinalFlutuante < (configData.minimo || 0)) {
        throw new Error(`Pedido mínimo: R$ ${configData.minimo}.`);
      }

      let trocoFormatado = "";
      if (pag === "Dinheiro" && troco && troco !== "Não preciso") {
        const valorTroco = parseFloat(String(troco).replace(",", "."));
        if (isNaN(valorTroco) || valorTroco <= totalFinalFlutuante) throw new Error("Troco inválido.");
        trocoFormatado = `(Troco para: R$ ${valorTroco.toFixed(2).replace(".", ",")})`;
      } else if (pag === "Dinheiro") {
        trocoFormatado = "(Dinheiro trocado)";
      }

      const novoPedidoId = `PED-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const pedidoRef = db.doc(`pedidos/${novoPedidoId}`);
      const dadosPedido = {
        id: novoPedidoId, nome, quadra, lote, 
        pag: trocoFormatado ? `${pag} ${trocoFormatado}` : pag,
        obs: obs || "", total: totalFinalFlutuante, itens: itensValidados,
        data: new Date().toISOString(), status: "pendente"
      };

      transaction.set(pedidoRef, dadosPedido);

      const analyticsRef = db.doc("analytics/dashboard");
      transaction.set(analyticsRef, {
        receitaTotal: admin.firestore.FieldValue.increment(totalFinalFlutuante),
        totalPedidos: admin.firestore.FieldValue.increment(1)
      }, { merge: true });

      return { id: novoPedidoId, total: totalFinalFlutuante, whatsappMsg: montarTextoWhatsApp(dadosPedido, configData.wpp) };
    });

    return res.status(200).json({ sucesso: true, pedido: resultado });

  } catch (error) {
    console.error("ERRO NA TRANSAÇÃO:", error.message);
    return res.status(400).json({ sucesso: false, error: error.message });
  }
}

function montarTextoWhatsApp(pedido, numero) {
  let msg = `*NOVO PEDIDO (Seguro)*\n👤 ${pedido.nome}\n📍 Q${pedido.quadra} L${pedido.lote}\n💳 Pagamento: ${pedido.pag}\n\n*ITENS:*\n`;
  pedido.itens.forEach(i => msg += `• ${i.qtd}x ${i.nome} - R$ ${i.subtotal.toFixed(2).replace('.',',')}\n`);
  msg += `\n*TOTAL: R$ ${pedido.total.toFixed(2).replace('.',',')}*`;
  if (pedido.obs) msg += `\n\n📝 *Obs:* ${pedido.obs}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}
