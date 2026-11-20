// =====================================================================
//  /api/pix-informado.js — o "Já paguei" do CLIENTE chega ao painel.
//
//  PIX pela chave da loja: o site não sabe quando o dinheiro cai. O cliente toca "Já paguei" na loja e,
//  antes, isso ficava só no celular dele: a banca não via nada. Agora a loja manda também para cá, e o
//  cartão do pedido no painel mostra "CLIENTE DIZ QUE PAGOU às HH:MM" ao lado do botão "PIX recebido".
//  NÃO é pagamento confirmado: quem confirma é a equipe, olhando o app do banco (api/pdv.js, 'pix-recebido').
//
//  POST { pedidoId }                  anota pixInformado: { em, total }
//  POST { pedidoId, desfazer: true }  "Ainda não paguei": apaga a anotação
//  Authorization: Bearer <token do login anônimo do cliente>
//
//  REGRAS
//   - só o dono do pedido (o uid sai do token verificado, nunca do corpo);
//   - só pedido PIX, não pago, não cancelado, já com valor fechado (lib/senha.js → travaDoPixInformado);
//   - o total gravado é o do PEDIDO no banco, nunca o que o navegador mandou;
//   - grava só o campo pixInformado (o cliente continua sem poder gravar pedido direto: firestore.rules);
//   - freio por conexão (memória) e por pessoa (contado no banco).
//  Servidor antigo sem este arquivo: a loja recebe 404 e segue como antes (o "Já paguei" fica só no aparelho).
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const H = require('../lib/http');
const P = require('../lib/prudencia');
const Senha = require('../lib/senha');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};

module.exports = async function handler(req, res) {
  H.cors(req, res, 'OPTIONS,POST');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const b = req.body || {}, pedidoId = b.pedidoId, desfazer = b.desfazer === true;
  if (!H.idSeguro(pedidoId, 6, 80)) return res.status(400).json({ error: 'Pedido não encontrado.' });
  if (H.passouNaMemoria(`pix-informado:${H.ipDe(req)}`, 20, 60000)) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde um minuto.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }

  let tid;
  try { ({ tid } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  let uid;
  try { uid = (await admin.auth().verifyIdToken(H.tokenDe(req))).uid; }
  catch (e) { return res.status(401).json({ error: 'Sessão expirada. Recarregue a página e tente de novo.' }); }
  if (!uid) return res.status(401).json({ error: 'Sessão expirada. Recarregue a página e tente de novo.' });
  // por pessoa: 12 em 10 minutos (vale para todas as cópias do servidor)
  if (!(await P.limitar(db, 'pix-informado', `${tid}|${uid}`, 12, 600))) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde alguns minutos.' });

  try {
    const saida = await db.runTransaction(async (t) => {
      const ref = T.tdoc(db, tid, 'pedidos', pedidoId), snap = await t.get(ref);
      if (!snap.exists) throw Object.assign(new Error('Pedido não encontrado.'), { status: 404 });
      const ped = snap.data();
      // o dono vem do login anônimo do aparelho que fez o pedido (o mesmo que a regra do banco usa para deixar ler)
      if (!ped.userId || ped.userId === 'anonimo' || ped.userId !== uid) throw Object.assign(new Error('Este pedido não pertence a esta sessão.'), { status: 403 });
      if (desfazer) {
        if (ped.pixInformado) t.update(ref, { pixInformado: null });
        return { pixInformado: null };
      }
      const trava = Senha.travaDoPixInformado(ped); if (trava) throw new Error(trava);
      const pixInformado = { em: new Date().toISOString(), total: Number(ped.total) || 0 };
      t.update(ref, { pixInformado });
      return { pixInformado };
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    if (P.ehFalhaInterna(e)) return res.status(500).json({ error: 'Não consegui avisar a banca agora.' });
    return res.status(400).json({ error: (e && e.message) || 'Não foi possível avisar a banca.' });
  }
};
