// =====================================================================
//  /api/set-admin.js  —  CONCEDER PERMISSÃO DE ADMINISTRADOR
//
//  Roda UMA VEZ para marcar sua conta como admin. Depois disso, você
//  DEVE apagar este arquivo (ou deixar a variável SETUP_SECRET vazia),
//  porque um endpoint que distribui poder de admin não pode ficar vivo.
//
//  POR QUE PRECISA DISSO:
//  O custom claim `admin: true` só pode ser gravado pelo Admin SDK, que
//  roda no servidor. Não existe jeito de fazer isso pelo navegador — e é
//  exatamente essa a proteção: nem você nem um invasor consegue forjar
//  esse campo pelo lado do cliente.
//
//  COMO USAR (pelo celular mesmo):
//   1) Crie sua conta no painel admin normalmente (e-mail + senha),
//      pelo Firebase Console > Authentication > Add user, se preferir.
//   2) Copie o UID dessa conta (aparece na lista de usuários do Console).
//   3) Na Vercel, crie a variável de ambiente:
//        SETUP_SECRET = uma-senha-longa-e-aleatoria-que-so-voce-sabe
//   4) Faça deploy e abra no navegador (troque os valores):
//        https://SEU-DOMINIO/api/set-admin?uid=SEU_UID&secret=SUA_SENHA
//   5) Deve responder: {"sucesso":true,...}
//   6) APAGUE este arquivo do GitHub e remova a variável SETUP_SECRET.
//   7) No painel, saia da conta e entre de novo (o token é renovado).
// =====================================================================

const admin = require('firebase-admin');
const crypto = require('crypto');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');

const bootFirebase = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      }),
    });
  }
};

// Comparação em tempo constante evita descobrir a senha por tentativa/erro
const segredoConfere = (recebido) => {
  const esperado = process.env.SETUP_SECRET;
  if (!esperado || !recebido) return false;
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(String(esperado));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

module.exports = async function handler(req, res) {
  // Trava principal: sem SETUP_SECRET configurado, o endpoint fica morto.
  if (!process.env.SETUP_SECRET) {
    return res.status(404).json({ error: 'Não encontrado.' });
  }

  const { uid, secret } = req.query || {};

  if (!segredoConfere(secret)) {
    return res.status(403).json({ error: 'Não autorizado.' });
  }
  if (!uid) {
    return res.status(400).json({ error: 'Informe o parâmetro uid.' });
  }

  try {
    bootFirebase();
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    const user = await admin.auth().getUser(uid);

    return res.status(200).json({
      sucesso: true,
      uid,
      email: user.email || null,
      aviso: 'Permissão concedida. APAGUE este arquivo e a variável SETUP_SECRET agora. Saia e entre de novo no painel.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
