#!/usr/bin/env node
'use strict';
// =====================================================================
//  scripts/plataforma.js — tarefas do DONO DA PLATAFORMA, pelo terminal.
//  Usa a conta de serviço do Firebase (as mesmas variáveis da Vercel):
//    FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//
//  Criar uma loja:
//    node scripts/plataforma.js criar-loja espetinhos-do-ze "Espetinhos do Zé" espetinhos
//        (o último é o modelo de aparência: hortifruti | espetinhos | jantinha)
//  Dar um papel a uma pessoa (ela precisa ter entrado no painel ao menos uma vez):
//    node scripts/plataforma.js papel ze@email.com espetinhos-do-ze proprietario
//    node scripts/plataforma.js papel ze@email.com espetinhos-do-ze remover
//  Montar a feira (lojas que aparecem juntas na faixa do topo):
//    node scripts/plataforma.js feira jardins "Feira do Jardins" banca espetinhos-do-ze
//  Bloquear / liberar uma loja:
//    node scripts/plataforma.js bloquear espetinhos-do-ze      |  liberar espetinhos-do-ze
//  Dar (ou tirar) o acesso de DONO DA PLATAFORMA, que abre /plataforma.html e vê todas as lojas:
//    node scripts/plataforma.js dono-da-plataforma voce@email.com      |  dono-da-plataforma voce@email.com remover
//  Ver quem é quem:
//    node scripts/plataforma.js ver ze@email.com
//
//  Depois de mudar um papel, a pessoa precisa sair e entrar de novo no painel.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');

const { MODELOS: TEMAS } = require('../lib/modelos');
const erro = (m) => { console.error('ERRO: ' + m); process.exit(1); };
const exigirId = (id) => { if (!T.idValido(id)) erro(`id de loja inválido: "${id}". Use letras minúsculas, números e hífen (2 a 40 caracteres).`); return id; };

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (!cmd) erro('diga o que fazer. Veja os exemplos no começo deste arquivo.');
  const projectId = process.env.FIREBASE_PROJECT_ID, clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
  if (!projectId || !clientEmail || !privateKey) erro('faltam as variáveis FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY.');
  admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  const db = admin.firestore();

  if (cmd === 'criar-loja') {
    const id = exigirId(a[0]), nome = a[1], modelo = a[2] || 'hortifruti';
    if (!nome) erro('faltou o nome da loja, entre aspas.');
    if (!TEMAS[modelo]) erro(`modelo desconhecido: ${modelo}. Use hortifruti, espetinhos ou jantinha.`);
    const ref = db.collection('tenants').doc(id);
    if ((await ref.get()).exists) erro(`a loja "${id}" já existe.`);
    await ref.set({ nome, tipo: modelo, ativo: true, tema: TEMAS[modelo], modulos: { ia: false }, criadoEm: new Date().toISOString() });
    if (id !== T.TENANT_PADRAO) await T.docDe(db, id, 'loja/config').set({ lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], minimo: 0, wpp: '' }, { merge: true });
    console.log(`Loja criada. Endereço: /?loja=${id}   Painel: /admin.html?loja=${id}`);
    console.log('Falta: dar o papel de proprietário a alguém (comando "papel") e cadastrar o WhatsApp no painel.');
  } else if (cmd === 'papel') {
    const [email, idLoja, papel] = a; const id = exigirId(idLoja);
    if (!email) erro('faltou o e-mail.');
    if (papel !== 'remover' && !T.PAPEIS.includes(papel)) erro(`papel inválido. Use: ${T.PAPEIS.join(', ')} ou remover.`);
    if (id !== T.TENANT_PADRAO && !(await db.collection('tenants').doc(id).get()).exists) erro(`a loja "${id}" não existe.`);
    const u = await admin.auth().getUserByEmail(email).catch(() => null);
    if (!u) erro(`não achei a conta ${email}. A pessoa precisa entrar no painel uma vez antes.`);
    const claims = { ...(u.customClaims || {}) }, tenants = { ...(claims.tenants || {}) };
    if (papel === 'remover') delete tenants[id]; else tenants[id] = papel;
    await admin.auth().setCustomUserClaims(u.uid, { ...claims, tenants });
    console.log(papel === 'remover' ? `${email} não tem mais acesso à loja ${id}.` : `${email} agora é ${papel} da loja ${id}.`);
    console.log('A pessoa precisa sair e entrar de novo no painel para valer.');
  } else if (cmd === 'feira') {
    const [fid, nome, ...lojas] = a; exigirId(fid);
    if (!nome || lojas.length < 2) erro('use: feira <id> "<nome>" <loja1> <loja2> ...');
    const lista = [];
    for (const id of lojas) {
      exigirId(id);
      const s = await db.collection('tenants').doc(id).get();
      if (!s.exists && id !== T.TENANT_PADRAO) erro(`a loja "${id}" não existe.`);
      const f = s.exists ? s.data() : {};
      lista.push({ id, nome: f.nome || (id === T.TENANT_PADRAO ? 'Banca Adair e Pedrina' : id), cor: (f.tema && f.tema.primaria) || '#1a3a2a' });
      await db.collection('tenants').doc(id).set({ feiraId: fid, ...(s.exists ? {} : { nome: 'Banca Adair e Pedrina', ativo: true }) }, { merge: true });
    }
    await db.collection('feiras').doc(fid).set({ nome, lojas: lista, atualizadoEm: new Date().toISOString() });
    console.log(`Feira "${nome}" com ${lista.length} lojas: ${lista.map((l) => l.nome).join(', ')}.`);
  } else if (cmd === 'bloquear' || cmd === 'liberar') {
    const id = exigirId(a[0]);
    await db.collection('tenants').doc(id).set({ ativo: cmd === 'liberar' }, { merge: true });
    console.log(`Loja ${id} ${cmd === 'liberar' ? 'liberada' : 'bloqueada (não recebe pedidos)'}.`);
  } else if (cmd === 'dono-da-plataforma') {
    const [email, acao] = a;
    if (!email) erro('faltou o e-mail.');
    const u = await admin.auth().getUserByEmail(email).catch(() => null);
    if (!u) erro(`não achei a conta ${email}. Entre no painel uma vez com esse e-mail antes.`);
    const claims = { ...(u.customClaims || {}) };
    if (acao === 'remover') delete claims.plataforma; else claims.plataforma = true;
    await admin.auth().setCustomUserClaims(u.uid, claims);
    console.log(acao === 'remover' ? `${email} não é mais dono da plataforma.` : `${email} agora é dono da plataforma: abre /plataforma.html e o painel de todas as lojas.`);
    console.log('Saia e entre de novo no painel para valer.');
  } else if (cmd === 'ver') {
    const u = await admin.auth().getUserByEmail(a[0] || '').catch(() => null);
    if (!u) erro('conta não encontrada.');
    console.log(JSON.stringify(u.customClaims || {}, null, 2));
  } else erro(`comando desconhecido: ${cmd}`);
}
main().then(() => process.exit(0)).catch((e) => erro(e.message));
