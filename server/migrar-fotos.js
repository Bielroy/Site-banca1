'use strict';
// =====================================================================
//  server/migrar-fotos.js — MIGRAÇÃO DAS FOTOS DO IMGBB PARA O CLOUDFLARE R2 (rodar no servidor da AWS).
//
//  No terminal da AWS, com o servidor já atualizado (bash ~/loja/scripts/atualizar-servidor.sh):
//      docker exec loja node server/migrar-fotos.js              1º: SIMULAÇÃO (não grava nada, só conta)
//      docker exec loja node server/migrar-fotos.js --gravar     2º: copia para o R2 e troca os links
//  Opções: --pedidos (inclui as fotos dos pedidos antigos)  --limite=50 (só as primeiras N fotos, para testar)
//          --desfazer (volta os links para o ImgBB; as cópias continuam no R2)
//  Pode rodar quantas vezes quiser: o que já foi copiado é pulado.
//  O trabalho está em lib/migrar-fotos.js.
// =====================================================================
const admin = require('firebase-admin');
const M = require('../lib/migrar-fotos');
const R2 = require('../lib/r2');

const args = process.argv.slice(2);
const tem = (x) => args.includes(x);
const limite = Number((args.find((a) => a.startsWith('--limite=')) || '').split('=')[1]) || Infinity;
const chavePrivada = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');

async function principal() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: chavePrivada(process.env.FIREBASE_PRIVATE_KEY) }) });
  const db = admin.firestore();
  const log = (t) => console.log(t);

  if (tem('--desfazer')) { await M.desfazer(db, { log }); return; }

  const gravar = tem('--gravar');
  if (!R2.config()) {
    console.log(`Atenção: o R2 não está configurado neste servidor (falta: ${R2.faltando().join(', ')}).`);
    if (gravar) { console.log('Nada foi gravado. Acerte o ~/segredos.env e rode bash ~/loja/scripts/atualizar-servidor.sh.'); process.exitCode = 1; return; }
    console.log('A simulação roda mesmo assim (só confere se as fotos ainda abrem no ImgBB).\n');
  }
  console.log(gravar ? '=== MIGRAÇÃO DE VERDADE: copiando para o R2 e trocando os links ===' : '=== SIMULAÇÃO: nada será gravado ===');
  const r = await M.migrar(db, { gravar, pedidos: tem('--pedidos'), limite, log });

  console.log('\n----- RESULTADO -----');
  console.log(`Documentos lidos:              ${r.documentos}`);
  console.log(`Fotos diferentes do ImgBB:     ${r.unicos} (usadas ${r.links} vezes)`);
  console.log(`Já copiadas numa rodada antes: ${r.jaMigrados}`);
  console.log(`${gravar ? 'Copiadas agora para o R2:     ' : 'Dá para copiar:               '} ${r.copiados}${r.resgatados ? ` (${r.resgatados} pela miniatura guardada no site, em 828 px)` : ''}`);
  console.log(`Sem cópia possível:            ${r.perdidas.length}`);
  if (gravar) console.log(`Documentos com link trocado:   ${r.documentosTrocados}`);
  if (r.perdidas.length) {
    console.log('\nFotos que não deu para salvar (a loja precisa enviar de novo):');
    for (const p of r.perdidas.slice(0, 60)) console.log(`  - ${p.onde.join(' | ')}  →  ${p.motivo}`);
    if (r.perdidas.length > 60) console.log(`  ... e mais ${r.perdidas.length - 60}.`);
  }
  if (r.paginas.length) {
    console.log('\nLinks da PÁGINA do ImgBB (não da foto), que não dá para copiar:');
    for (const p of r.paginas.slice(0, 20)) console.log(`  - ${p.onde.join(' | ')}  →  ${p.link}`);
  }
  if (!gravar) console.log('\nNada foi gravado. Se os números estiverem bons, rode de novo com --gravar.');
  if (!tem('--pedidos')) console.log('(Pedidos antigos não entram. Para incluir as fotos deles: --pedidos)');
}

principal().catch((e) => { console.error('Parou com erro:', (e && e.message) || e); process.exitCode = 1; });
