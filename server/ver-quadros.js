'use strict';
// =====================================================================
//  server/ver-quadros.js — CONFERE AS FOTOS DOS QUADROS DA VITRINE (rodar no servidor da AWS).
//      docker exec loja node server/ver-quadros.js              todas as lojas
//      docker exec loja node server/ver-quadros.js nome-da-loja só uma
//  Para cada foto em loja/config.vitrine (quadros e "quem escolhe seu pedido") mostra o link e se ele abre,
//  direto e pelo redutor do site (o caminho que o celular do cliente usa). Não grava nada.
// =====================================================================
const admin = require('firebase-admin');

const chavePrivada = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
const SITE = process.env.SITE_URL || 'https://usebanca.com';

/** Todos os textos http(s) de um objeto, com o caminho em que estão. */
function links(o, caminho = '', saida = []) {
  if (typeof o === 'string') { if (/^https?:\/\//i.test(o.trim())) saida.push({ onde: caminho, url: o.trim() }); }
  else if (Array.isArray(o)) o.forEach((x, i) => links(x, `${caminho}[${i}]`, saida));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) links(v, caminho ? `${caminho}.${k}` : k, saida);
  return saida;
}

async function ver(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await r.arrayBuffer());
    return `${r.status} ${(r.headers.get('content-type') || '?').split(';')[0]} ${buf.length} bytes${r.redirected ? ' (redirecionou)' : ''}`;
  } catch (e) { return `falhou: ${(e && e.message) || e}`; }
}

async function principal() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: chavePrivada(process.env.FIREBASE_PRIVATE_KEY) }) });
  const db = admin.firestore();
  const so = process.argv[2];
  const lojas = so ? [{ id: so }] : (await db.collection('tenants').select().get()).docs;
  for (const l of lojas) {
    const snap = await db.doc(`tenants/${l.id}/loja/config`).get();
    const v = snap.exists ? (snap.data() || {}).vitrine : null;
    if (!v) continue;
    const lista = links(v, 'vitrine');
    if (!lista.length) continue;
    console.log(`\n=== ${l.id} ===`);
    for (const { onde, url } of lista) {
      console.log(`${onde}\n  link:     ${url}`);
      console.log(`  direto:   ${await ver(url)}`);
      console.log(`  redutor:  ${await ver(`${SITE}/_vercel/image?url=${encodeURIComponent(url)}&w=828&q=75&v=4`)}`);
    }
  }
  console.log('\nPronto.');
}

principal().catch((e) => { console.error('Parou com erro:', (e && e.message) || e); process.exitCode = 1; });
