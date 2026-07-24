// =====================================================================
//  /api/cancelar-pedido.js  —  Banca Adair e Pedrina
//
//  Deixa a própria cliente cancelar o pedido numa janela curta depois de
//  enviar, sem precisar chamar no WhatsApp.
//
//  POR QUE ISSO É UM ENDPOINT E NÃO UMA ESCRITA DIRETA DO NAVEGADOR:
//   cancelar precisa DEVOLVER O ESTOQUE dos itens. Se o navegador pudesse
//   fazer isso sozinho, alguém poderia inflar o estoque à vontade. Aqui o
//   servidor confere quem é a dona do pedido, se ainda está no prazo, e
//   devolve o estoque na mesma transação.
//
//  REGRAS DE CANCELAMENTO
//   - só quem criou o pedido (mesmo userId anônimo) pode cancelar
//   - só dentro de MINUTOS_PARA_CANCELAR minutos após o envio
//   - só se ninguém tiver começado a mexer (status pendente, aguardando
//     pesagem ou aguardando pagamento)
//   - nunca se o pagamento já foi confirmado (aí é conversa com a banca)
//
//  Variáveis: FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
// =====================================================================

const admin = require('firebase-admin');

const MINUTOS_PARA_CANCELAR = 5;
const STATUS_CANCELAVEIS = ['pendente', 'aguardando_pesagem', 'aguardando_pagamento'];

const ORIGEM_PADRAO = 'https://site-banca1.vercel.app';
const aplicarCors = (res) => {
  const permitida = process.env.ALLOWED_ORIGIN
    || (process.env.VERCEL_ENV === 'production' ? ORIGEM_PADRAO : '*');
  res.setHeader('Access-Control-Allow-Origin', permitida);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');

let db;
const bootFirebase = () => {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Variáveis do Firebase ausentes no ambiente.');
    }
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  }
  if (!db) db = admin.firestore();
};

const fixFloat = (n) => Math.round(n * 1000) / 1000;

module.exports = async function handler(req, res) {
  aplicarCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const { pedidoId, userId } = req.body || {};
  if (!pedidoId) return res.status(400).json({ error: 'pedidoId é obrigatório.' });

  try { bootFirebase(); }
  catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }

  try {
    const resultado = await db.runTransaction(async (t) => {
      const pedidoRef = db.collection('pedidos').doc(String(pedidoId));
      const pedidoSnap = await t.get(pedidoRef);
      if (!pedidoSnap.exists) throw new Error('Pedido não encontrado.');

      const pedido = pedidoSnap.data();

      // Só a dona do pedido cancela o próprio pedido
      if (pedido.userId && pedido.userId !== 'anonimo' && pedido.userId !== userId) {
        throw new Error('Este pedido não pertence a este dispositivo.');
      }

      if (pedido.status === 'cancelado') {
        return { jaEstava: true };
      }

      if (pedido.pagamento && pedido.pagamento.status === 'PAID') {
        throw new Error('Este pedido já está pago. Chame a banca no WhatsApp para resolver.');
      }

      if (!STATUS_CANCELAVEIS.includes(pedido.status)) {
        throw new Error('A banca já começou a separar este pedido. Chame no WhatsApp, por favor.');
      }

      const minutosPassados = (Date.now() - new Date(pedido.data).getTime()) / 60000;
      if (!Number.isFinite(minutosPassados) || minutosPassados > MINUTOS_PARA_CANCELAR) {
        throw new Error(`O cancelamento pela loja só vale nos primeiros ${MINUTOS_PARA_CANCELAR} minutos. Chame no WhatsApp, por favor.`);
      }

      // Devolve o estoque dos itens que foram baixados no checkout
      // (os "a pesar" nunca baixaram estoque, então ficam de fora)
      const itensFechados = (pedido.itens || []).filter((i) => !i.aPesar);
      const prodSnaps = await Promise.all(
        itensFechados.map((i) => t.get(db.doc(`produtos/${i.id}`)))
      );

      const devolucoes = [];
      itensFechados.forEach((item, idx) => {
        const snap = prodSnaps[idx];
        if (!snap || !snap.exists) return;
        const p = snap.data();
        if (p.estoqueFisico !== null && p.estoqueFisico !== undefined && p.estoqueFisico !== '') {
          const novo = fixFloat(Number(p.estoqueFisico) + Number(item.qtd));
          devolucoes.push([snap.ref, { estoqueFisico: novo, ativo: novo > 0 }]);
        }
      });

      // Desfaz o uso do cupom, se houver
      let cupomRef = null;
      if (pedido.cupom && pedido.cupom.codigo) {
        cupomRef = db.doc(`cupons/${pedido.cupom.codigo}`);
        const cupomSnap = await t.get(cupomRef);
        if (!cupomSnap.exists) cupomRef = null;
      }

      // ---- escritas ----
      devolucoes.forEach(([ref, patch]) => t.update(ref, patch));
      if (cupomRef) t.update(cupomRef, { usos: admin.firestore.FieldValue.increment(-1) });

      t.update(pedidoRef, {
        status: 'cancelado',
        canceladoEm: new Date().toISOString(),
        canceladoPor: 'cliente',
      });

      // Reverte os números agregados
      const total = Number(pedido.total || 0);
      t.set(db.doc('analytics/dashboard'), {
        receitaTotal: admin.firestore.FieldValue.increment(-total),
        totalPedidos: admin.firestore.FieldValue.increment(-1),
      }, { merge: true });

      const diaChave = String(pedido.data || '').slice(0, 10);
      if (diaChave) {
        t.set(db.doc(`resumos/${diaChave}`), {
          receita: admin.firestore.FieldValue.increment(-total),
          pedidos: admin.firestore.FieldValue.increment(-1),
          atualizadoEm: new Date().toISOString(),
        }, { merge: true });
      }

      return { itensDevolvidos: devolucoes.length };
    });

    return res.status(200).json({ sucesso: true, ...resultado });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Não foi possível cancelar o pedido.' });
  }
};
