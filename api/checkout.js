const admin = require('firebase-admin');

// Sanitizador brutal de Chave Privada (Previne erros de cópia e cola)
const formatPrivateKey = (key) => {
  if (!key) return '';
  return key
    .replace(/\\n/g, '\n') // Converte quebras falsas em reais
    .replace(/^"|"$/g, '') // Arranca aspas nas pontas
    .trim();
};

// Variável de instância global para o banco de dados
let db;

// Função de boot seguro (Late Initialization)
const bootFirebase = () => {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Variáveis de ambiente (PROJECT_ID, EMAIL ou PRIVATE_KEY) ausentes na Vercel.");
    }

    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        })
      });
    } catch (certError) {
      throw new Error("Credenciais inválidas: O Firebase rejeitou a Chave Privada. Verifique as aspas e quebras de linha.");
    }
  }
  if (!db) db = admin.firestore();
};

const paraCentavos = (valor) => Math.round(valor * 100);
const paraFlutuante = (centavos) => parseFloat((centavos / 100).toFixed(2));

module.exports = async function handler(req, res) {
  // CORS Rigoroso
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método HTTP não permitido.' });

  // Tenta ligar o banco DENTRO do request. Se falhar, retorna JSON (não quebra o Front)
  try {
    bootFirebase();
  } catch (bootError) {
    console.error("FALHA DE BOOT NO FIREBASE:", bootError.message);
    return res.status(500).json({ sucesso: false, error: `Servidor Vercel sem acesso: ${bootError.message}` });
  }

  const { nome, quadra, lote, pag, troco, obs, itens } = req.body;

  if (!nome || !quadra || !lote || !pag || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ sucesso: false, error: 'Payload malformado ou itens ausentes no carrinho.' });
  }

  try {
    const resultado = await db.runTransaction(async (transaction) => {
      const configRef = db.doc("loja/config");
      const configSnap = await transaction.get(configRef);
      if (!configSnap.exists) throw new Error("Parâmetros da loja não configurados no Firebase.");
      
      const configData = configSnap.data();
      if (configData.lojaAberta === false) throw new Error("Operação negada: A loja está fechada.");
      
      let totalAcumuladoCentavos = 0;
      const itensValidados = [];

      for (const item of itens) {
        if (!item.id || item.qtd <= 0) throw new Error("Item com ID nulo ou quantidade inválida.");
        const prodRef = db.doc(`produtos/${item.id}`);
        const prodSnap = await transaction.get(prodRef);
        if (!prodSnap.exists) throw new Error(`Produto não localizado na base de dados.`);
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
      }

      const totalFinalFlutuante = paraFlutuante(totalAcumuladoCentavos);
      if (totalFinalFlutuante < (configData.minimo || 0)) {
        throw new Error(`Pedido mínimo: R$ ${configData.minimo}. Adicione mais itens.`);
      }

      let trocoFormatado = "";
      if (pag === "Dinheiro" && troco && troco !== "Não preciso") {
        const valorTroco = parseFloat(String(troco).replace(",", "."));
        if (isNaN(valorTroco) || valorTroco <= totalFinalFlutuante) throw new Error("Troco menor que o valor total.");
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
    console.error("ERRO TRANSACIONAL INTERNO:", error.message);
    return res.status(400).json({ sucesso: false, error: error.message });
  }
};

function montarTextoWhatsApp(pedido, numero) {
  let msg = `*NOVO PEDIDO (Seguro)*\n👤 ${pedido.nome}\n📍 Q${pedido.quadra} L${pedido.lote}\n💳 Pagamento: ${pedido.pag}\n\n*ITENS:*\n`;
  pedido.itens.forEach(i => msg += `• ${i.qtd}x ${i.nome} - R$ ${i.subtotal.toFixed(2).replace('.',',')}\n`);
  msg += `\n*TOTAL: R$ ${pedido.total.toFixed(2).replace('.',',')}*`;
  if (pedido.obs) msg += `\n\n📝 *Obs:* ${pedido.obs}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}
