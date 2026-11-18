'use strict';
// =====================================================================
//  scripts/apagar-cliente.js — APAGA OS DADOS DE UM CLIENTE QUE PEDIU (LGPD), POR TELEFONE, NUMA LOJA.
//
//  Roda NO SERVIDOR, dentro do contêiner (usa as mesmas chaves dele, inclusive a DADOS_CHAVE para abrir os
//  telefones cifrados). No terminal da AWS:
//
//    1. ver o que seria apagado (não muda nada):
//         docker exec -it loja node scripts/apagar-cliente.js --loja banca --telefone 62999990000
//    2. apagar de verdade (pergunta antes; digite APAGAR):
//         docker exec -it loja node scripts/apagar-cliente.js --loja banca --telefone 62999990000 --gravar
//
//  O que muda e o que fica: lib/apagar-cliente.js. Prazo para responder ao cliente: 15 dias (privacidade.html).
//  Fica anotado na trilha de auditoria da loja (sem o telefone).
// =====================================================================
const { apagarCliente } = require('../lib/apagar-cliente');

function lerOpcoes(argv) {
  const o = { loja: '', telefone: '', gravar: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--loja') o.loja = String(argv[++i] || '').trim();
    else if (argv[i] === '--telefone') o.telefone = String(argv[++i] || '').trim();
    else if (argv[i] === '--gravar') o.gravar = true;
    else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  if (!o.loja || !o.telefone) throw new Error('Uso: node scripts/apagar-cliente.js --loja <id-da-loja> --telefone <DDD+número> [--gravar]');
  return o;
}

function mostrar(r) {
  console.log(`Loja ${r.loja}, telefone ${r.telefone}:`);
  console.log(`  pedidos a anonimizar:      ${r.pedidos.length}${r.pedidos.length ? ` (${r.pedidos.slice(0, 10).join(', ')}${r.pedidos.length > 10 ? ', ...' : ''})` : ''}`);
  console.log(`  contas a apagar:           ${r.contas.length}`);
  console.log(`  perfis da previsão:        ${r.perfis.length} (+ ${r.uids} ligação(ões) de aparelho)`);
  console.log(`  pontos de frete no mapa:   ${r.fretes}`);
  console.log(`  "me avise quando chegar":  ${r.espera}`);
}

async function principal(argv, { db, perguntar } = {}) {
  const o = lerOpcoes(argv);
  if (!require('../lib/cofre').ligado()) console.warn('ATENÇÃO: DADOS_CHAVE não está ligada aqui: telefones cifrados não podem ser abertos e NÃO serão encontrados. Rode dentro do contêiner (docker exec -it loja ...).');
  let banco = db;
  if (!banco) {
    const admin = require('firebase-admin');
    const k = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: k }) });
    banco = admin.firestore();
  }
  const previa = await apagarCliente(banco, o.loja, o.telefone);
  mostrar(previa);
  const nada = !previa.pedidos.length && !previa.contas.length && !previa.perfis.length && !previa.espera;
  if (nada) { console.log('Nada encontrado com esse telefone nessa loja. Confira o número e a loja.'); return 0; }
  if (!o.gravar) { console.log('\nSimulação: nada foi mudado. Para apagar de verdade, repita com --gravar.'); return 0; }
  const ask = perguntar || ((t) => new Promise((ok) => { const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout }); rl.question(t, (x) => { rl.close(); ok(String(x || '').trim()); }); }));
  if (await ask('\nIsto NÃO tem volta. Digite APAGAR para continuar: ') !== 'APAGAR') { console.log('Nada foi mudado.'); return 1; }
  const r = await apagarCliente(banco, o.loja, o.telefone, { gravar: true });
  await require('../lib/prudencia').registrar(banco, o.loja, { acao: 'lgpd-apagar', quem: 'servidor (scripts/apagar-cliente.js)', detalhe: `${r.pedidos.length} pedido(s) anonimizados, ${r.contas.length} conta(s), ${r.perfis.length} perfil(is)` });
  console.log(`\nPronto: dados apagados na loja ${r.loja}.`);
  console.log('Diga ao cliente: as cópias de segurança já feitas (no Firebase até 7 dias, no servidor e no R2 até 60 dias) expiram sozinhas;');
  console.log('as mensagens no WhatsApp da loja precisam ser apagadas no aparelho; registros de pagamento (Asaas/PagBank) a lei manda guardar.');
  return 0;
}

module.exports = { principal, lerOpcoes };

if (require.main === module) {
  principal(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => { console.error(`Não apaguei: ${e && e.message}`); process.exitCode = 2; });
}
