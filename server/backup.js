'use strict';
// =====================================================================
//  server/backup.js — CÓPIA DE SEGURANÇA FORA DO FIREBASE, UM ARQUIVO POR LOJA.
//
//  Quem chama é scripts/backup-diario.sh (todo dia às 09:10 UTC, DEPOIS da rotina da noite das 08:00 UTC):
//     docker exec loja node server/backup.js --listar             → os ids das lojas, um por linha
//     docker exec loja node server/backup.js --loja <id>          → a cópia COMPLETA daquela loja (JSON)
//     docker exec loja node server/backup.js --plataforma         → feiras + marcas de LGPD (JSON)
//  O script grava cada saída em ~/backups/AAAA-MM-DD/<loja>.json.gz e manda para o R2 (banco/AAAA-MM-DD/<loja>.json.gz),
//  uma loja de cada vez: com muitas lojas, nada precisa caber num JSON só na memória.
//
//  O QUE VAI: lib/prudencia.js → exportarCompleto (cadastro, configurações, equipe, contas, pedidos e histórico de
//  estoque de 400 dias, caixa, fechamentos, produção, maquininha, histórico de vendas). Segredos da plataforma (chaves de
//  pagamento etc.) NÃO entram: ficam só no ~/segredos.env. Nome/telefone/endereço vão como estão no banco (cifrados).
//  Formato de cada arquivo: { versao: 2, tipo: 'loja', loja, feitaEm, copia } ou { versao: 2, tipo: 'plataforma', feitaEm, feiras, lgpd }.
// =====================================================================
const T = require('../lib/tenant');
const P = require('../lib/prudencia');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');

const listarLojas = (db) => T.listarLojas(db);
async function copiaDaLoja(db, tid, agora = Date.now()) {
  if (!(tid === T.TENANT_PADRAO || T.idValido(tid))) throw new Error('Loja inválida.');
  return { versao: 2, tipo: 'loja', loja: tid, feitaEm: new Date(agora).toISOString(), copia: await P.exportarCompleto(db, tid, new Date(agora)) };
}
async function copiaDaPlataforma(db, agora = Date.now()) {
  const f = await db.collection('feiras').get();
  const l = await db.doc('plataforma/lgpd_apagados').get();
  return { versao: 2, tipo: 'plataforma', feitaEm: new Date(agora).toISOString(), feiras: Object.fromEntries(f.docs.map((d) => [d.id, d.data()])), lgpd: l.exists ? l.data() : {} };
}

/** Tudo num objeto só (usado pelos testes e pelo ensaio no emulador): { versao: 1, feitaEm, lojas, feiras, lgpd, falhas }. */
async function fazerBackup(db, { agora = Date.now(), log = (m) => process.stderr.write(m + '\n') } = {}) {
  const saida = { versao: 1, feitaEm: new Date(agora).toISOString(), lojas: {}, feiras: {}, lgpd: {}, falhas: [] };
  for (const tid of await listarLojas(db)) {
    try { saida.lojas[tid] = (await copiaDaLoja(db, tid, agora)).copia; log(`[backup] ${tid}: ok ${JSON.stringify(saida.lojas[tid].contagem || {})}`); }
    catch (e) { saida.falhas.push({ loja: tid, erro: String((e && e.message) || e).slice(0, 200) }); log(`[backup] ${tid}: FALHOU ${e && e.message}`); }
  }
  try { const p = await copiaDaPlataforma(db, agora); saida.feiras = p.feiras; saida.lgpd = p.lgpd; }
  catch (e) { saida.falhas.push({ loja: 'plataforma', erro: String(e && e.message).slice(0, 200) }); }
  return saida;
}

module.exports = { fazerBackup, listarLojas, copiaDaLoja, copiaDaPlataforma };

if (require.main === module) {
  (async () => {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
    const db = admin.firestore(), [acao, arg] = process.argv.slice(2);
    if (acao === '--listar') { process.stdout.write((await listarLojas(db)).join('\n') + '\n'); return; }
    if (acao === '--loja') { const c = await copiaDaLoja(db, arg); process.stdout.write(JSON.stringify(c)); process.stderr.write(`[backup] ${arg}: ok ${JSON.stringify(c.copia.contagem || {})}\n`); return; }
    if (acao === '--plataforma') { process.stdout.write(JSON.stringify(await copiaDaPlataforma(db))); return; }
    // sem opção: o formato antigo, tudo num JSON só (para quem ainda chama assim)
    const saida = await fazerBackup(db);
    process.stdout.write(JSON.stringify(saida));
    process.exitCode = saida.falhas.length ? 1 : 0;
  })().catch((e) => { process.stderr.write(`[backup] não consegui fazer a cópia: ${e && e.message}\n`); process.exitCode = 2; });
}
