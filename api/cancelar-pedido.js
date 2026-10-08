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
//   - só quem criou o pedido pode cancelar, e isso é provado por TOKEN
//     do Firebase (não por um campo enviado no corpo da requisição)
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
const PODEM_CANCELAR_NO_PAINEL = ['proprietario', 'administrador', 'funcionario', 'caixa'];

// ---------------------------------------------------------------------
// CORS — lista de origens confiáveis
//
// POR QUE NÃO DEPENDE MAIS DE VARIÁVEL DE AMBIENTE:
// a versão anterior usava ALLOWED_ORIGIN e, se ela estivesse errada ou
// ausente, o site bloqueava a si mesmo — o navegador da cliente manda a
// requisição de um domínio e o servidor autoriza outro. Como a banca tem
// três endereços válidos (domínio próprio com e sem "www", mais o da
// Vercel), agora conferimos de qual deles a chamada veio e devolvemos
// exatamente esse. Funciona nos três sem configurar nada.
//
// ALLOWED_ORIGIN continua sendo lida e ACRESCENTA origens à lista
// (aceita várias separadas por vírgula), mas não é mais obrigatória.
// ---------------------------------------------------------------------
// Origem (CORS): a lista de endereços nossos fica num lugar só, lib/http.js.
const H = require('../lib/http');
const aplicarCors = H.cors;

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

const T = require('../lib/tenant');
const E = require('../lib/estoque');
const Avisos = require('../lib/avisos');
const P = require('../lib/prudencia');
const Conta = require('../lib/conta');

// ---------------------------------------------------------------------
// AVALIAÇÃO: "chegou tudo fresquinho?"  POST { acao: 'avaliar', pedidoId, nota: 1..5, texto? }
//
//  - só a dona do pedido avalia (uid do token), uma vez só, e nunca pedido cancelado;
//  - a nota fica no pedido (a equipe vê no painel) e entra na média pública da loja
//    (loja/avaliacoes: só soma e quantidade, sem nome nem texto de ninguém);
//  - nota 3 ou menos avisa a equipe no celular, para dar tempo de resolver com a cliente.
// ---------------------------------------------------------------------
async function avaliar(req, res, { tid, uid, pedidoId, peloCracha }) {
  const nota = Number((req.body || {}).nota);
  const texto = String((req.body || {}).texto || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return res.status(400).json({ error: 'Escolha de 1 a 5 estrelas.' });
  try {
    const saida = await db.runTransaction(async (t) => {
      const pedidoRef = T.tdoc(db, tid, 'pedidos', String(pedidoId)), resumoRef = T.docDe(db, tid, 'loja/avaliacoes');
      const [ps, rs] = await Promise.all([t.get(pedidoRef), t.get(resumoRef)]);
      if (!ps.exists) throw new Error('Pedido não encontrado.');
      const pedido = ps.data();
      if (!peloCracha && (!pedido.userId || pedido.userId === 'anonimo' || pedido.userId !== uid)) throw new Error('Só quem fez o pedido pode avaliar.');
      if (pedido.status === 'cancelado') throw new Error('Pedido cancelado não recebe avaliação.');
      if (pedido.avaliacao) throw new Error('Este pedido já foi avaliado. Obrigado!');
      const r = rs.exists ? rs.data() : {}, soma = Number(r.soma || 0) + nota, n = Number(r.n || 0) + 1;
      t.set(pedidoRef, { avaliacao: { nota, texto, em: new Date().toISOString() } }, { merge: true });
      t.set(resumoRef, { soma, n, media: Math.round((soma / n) * 10) / 10, em: new Date().toISOString() }, { merge: true });
      return { nome: pedido.nome || 'Cliente' };
    });
    if (nota <= 3) await Avisos.avisarLoja(db, tid, { titulo: `Avaliação ${nota} de 5`, corpo: `${saida.nome}${texto ? ': ' + texto.slice(0, 90) : ' não ficou satisfeita com o pedido.'}`, url: tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`, tag: `avaliacao-${pedidoId}` });
    return res.status(200).json({ sucesso: true });
  } catch (e) { return res.status(400).json({ error: e.message || 'Não foi possível guardar a avaliação.' }); }
}

module.exports = async function handler(req, res) {
  aplicarCors(req, res, 'OPTIONS,POST');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const { pedidoId } = req.body || {};
  // o id vira nome de documento: só o formato que o próprio site gera (nada de barra, objeto ou texto gigante)
  if (!H.idSeguro(pedidoId, 6, 80)) return res.status(400).json({ error: 'Pedido não encontrado.' });
  if (H.passouNaMemoria(`cancelar:${H.ipDe(req)}`, 20, 60000)) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde um minuto.' });

  try { bootFirebase(); }
  catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }

  // Qual loja? (cabeçalho X-Loja; sem ele, a loja original). Só diz ONDE olhar.
  let tid;
  try { ({ tid } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }


  // -------------------------------------------------------------------
  // QUEM ESTÁ PEDINDO O CANCELAMENTO?
  //
  // A versão anterior aceitava um `userId` enviado no corpo da requisição
  // e só comparava texto com texto. Isso é fraco: quem descobrisse o
  // userId de outra pessoa (num link compartilhado sem querer, por
  // exemplo) conseguiria cancelar o pedido dela.
  //
  // Agora exigimos o token de autenticação do Firebase. Ele é assinado
  // pelo Google, expira sozinho e é impossível de forjar. O uid sai de
  // DENTRO do token verificado — nunca do que o navegador afirmou ser.
  // -------------------------------------------------------------------
  const cabecalho = String((req.headers && req.headers.authorization) || '');
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'Sessão não identificada. Recarregue a página e tente de novo.' });
  }

  let uidVerificado, daEquipe = false, quem = '';
  try {
    const decodificado = await admin.auth().verifyIdToken(token);
    uidVerificado = decodificado.uid;
    // Quem trabalha na loja cancela pelo painel, a qualquer momento (o cliente, só nos primeiros minutos).
    daEquipe = T.temPapel(decodificado, tid, PODEM_CANCELAR_NO_PAINEL);
    quem = decodificado.email || decodificado.uid;
  } catch (e) {
    return res.status(401).json({ error: 'Sessão expirada. Recarregue a página e tente de novo.' });
  }
  const motivo = daEquipe ? H.textoCurto((req.body || {}).motivo, 200) : '';
  // Cliente: no máximo 10 cancelamentos/avaliações em 10 minutos por pessoa (conta guardada no banco, vale para todas as cópias do servidor).
  if (!daEquipe && !(await P.limitar(db, 'cancelar', `${tid}|${uidVerificado}`, 10, 600))) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde alguns minutos.' });

  // CELULAR NOVO ou limpeza do iPhone: o login do aparelho muda, mas o crachá da conta (lib/conta.js) prova que
  // o pedido é desta pessoa. Vale só para pedido que está na conta do crachá apresentado.
  const peloCracha = daEquipe ? false : await Conta.donoPeloCracha(db, tid, req, pedidoId);

  // AVALIAÇÃO DEPOIS DA ENTREGA (mesma prova de dono do cancelamento: o token ou o crachá).
  if ((req.body || {}).acao === 'avaliar') return avaliar(req, res, { tid, uid: uidVerificado, pedidoId, peloCracha });

  try {
    const resultado = await db.runTransaction(async (t) => {
      const pedidoRef = T.tdoc(db, tid, 'pedidos', pedidoId);
      const pedidoSnap = await t.get(pedidoRef);
      if (!pedidoSnap.exists) throw new Error('Pedido não encontrado.');

      const pedido = pedidoSnap.data();

      // Só a dona do pedido cancela o próprio pedido.
      // O uid vem do token verificado, não do corpo da requisição.
      //
      // Pedidos antigos (feitos antes desta versão) podem ter sido gravados
      // com 'anonimo' no lugar do uid. Nesses casos não há como provar quem
      // é a dona, então o cancelamento automático é recusado — de propósito.
      // É melhor recusar e mandar chamar a banca do que arriscar cancelar o
      // pedido da pessoa errada.
      if (daEquipe) {
        if (pedido.status === 'cancelado') return { jaEstava: true };
      } else {
      if (!peloCracha && (!pedido.userId || pedido.userId === 'anonimo')) {
        throw new Error('Não consigo confirmar que este pedido é seu. Chame a banca no WhatsApp, por favor.');
      }
      if (!peloCracha && pedido.userId !== uidVerificado) {
        throw new Error('Este pedido não pertence a esta sessão.');
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
      }

      // Devolve o estoque que este pedido baixou:
      //   item de valor fechado → a quantidade pedida (baixada no checkout)
      //   item pesado           → o peso baixado na pesagem (pesoBaixado, em quilos)
      //   item ainda "a pesar"  → nada (nunca baixou)
      const aDevolver = new Map();                       // produtoId → quantidade
      // TRAVA: o estoque, o cupom e o caixa de um pedido só voltam UMA vez. Se o pedido já passou por aqui
      // (marca `estornadoEm`) e alguém conseguiu tirá-lo de "cancelado" por fora, um novo cancelamento só
      // muda o status: não devolve produto de novo nem desconta a venda outra vez.
      const jaEstornado = !!pedido.estornadoEm;
      (jaEstornado ? [] : (pedido.itens || [])).forEach((i) => {
        const q = Number(i.pesoBaixado) > 0 ? Number(i.pesoBaixado) : (i.aPesar ? 0 : Number(i.qtd));
        if (Number.isFinite(q) && q > 0 && i.id) aDevolver.set(String(i.id), fixFloat((aDevolver.get(String(i.id)) || 0) + q));
      });
      const ids = [...aDevolver.keys()];
      const prodSnaps = await Promise.all(ids.map((id) => t.get(T.docDe(db, tid, `produtos/${id}`))));

      const devolucoes = [];
      ids.forEach((id, idx) => {
        const snap = prodSnaps[idx];
        if (!snap || !snap.exists) return;
        const p = snap.data(), q = aDevolver.get(id);
        if (p.estoqueFisico !== null && p.estoqueFisico !== undefined && p.estoqueFisico !== '') {
          const novo = fixFloat(Number(p.estoqueFisico) + q);
          devolucoes.push([snap.ref, { estoqueFisico: novo, ativo: E.ativoDepois(p, novo) }, { produtoId: id, nome: p.nome, unidade: p.unidade, delta: q, saldo: novo, custoUnit: p.custo, por: daEquipe ? quem : 'cliente' }]);
        }
      });

      // Desfaz o uso do cupom, se houver
      let cupomRef = null;
      if (!jaEstornado && pedido.cupom && H.idSeguro(pedido.cupom.codigo, 1, 40)) {
        cupomRef = T.docDe(db, tid, `cupons/${pedido.cupom.codigo}`);
        const cupomSnap = await t.get(cupomRef);
        if (!cupomSnap.exists) cupomRef = null;
      }

      // ---- escritas ----
      devolucoes.forEach(([ref, patch]) => t.update(ref, patch));
      E.registrarMovs(t, db, tid, devolucoes.map(([, , m]) => ({ ...m, tipo: 'cancelamento', pedidoId: String(pedidoId) })), admin.firestore.FieldValue);
      if (cupomRef) t.update(cupomRef, { usos: admin.firestore.FieldValue.increment(-1) });

      t.update(pedidoRef, {
        status: 'cancelado',
        canceladoEm: new Date().toISOString(),
        canceladoPor: daEquipe ? 'loja' : 'cliente',
        ...(daEquipe ? { canceladoPorQuem: quem, canceladoMotivo: motivo } : {}),
        ...(jaEstornado ? {} : { estornadoEm: new Date().toISOString() }),
      });
      if (jaEstornado) return { itensDevolvidos: 0, jaEstornado: true, estavaPago: !!(pedido.pagamento && pedido.pagamento.status === 'PAID') };

      // Reverte os números agregados (valor que não é número não entra na conta: estragaria o caixa do dia)
      const total = Number.isFinite(Number(pedido.total)) ? Number(pedido.total) : 0;
      t.set(T.docDe(db, tid, 'analytics/dashboard'), {
        receitaTotal: admin.firestore.FieldValue.increment(-total),
        totalPedidos: admin.firestore.FieldValue.increment(-1),
      }, { merge: true });

      // mesmo dia (horário de Brasília) em que o checkout somou a venda
      // (pedido para a próxima feira foi somado no dia da ENTREGA)
      const dt = new Date(pedido.data);
      const diaChave = /^\d{4}-\d{2}-\d{2}$/.test(String(pedido.entregaDia || '')) ? pedido.entregaDia
        : Number.isFinite(dt.getTime()) ? new Date(dt.getTime() - 3 * 3600000).toISOString().slice(0, 10) : '';
      if (diaChave) {
        t.set(T.docDe(db, tid, `resumos/${diaChave}`), {
          receita: admin.firestore.FieldValue.increment(-total),
          pedidos: admin.firestore.FieldValue.increment(-1),
          atualizadoEm: new Date().toISOString(),
        }, { merge: true });
      }

      return { itensDevolvidos: devolucoes.length, estavaPago: !!(pedido.pagamento && pedido.pagamento.status === 'PAID') };
    });

    return res.status(200).json({ sucesso: true, ...resultado });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Não foi possível cancelar o pedido.' });
  }
};
