'use strict';
// =====================================================================
//  server/backup.js — CÓPIA DE SEGURANÇA FORA DO FIREBASE (no disco do servidor da AWS).
//
//  Como roda (todo dia, pelo agendador do servidor; scripts/ligar-backup.sh instala):
//     docker exec loja node server/backup.js | gzip > ~/backups/banco-AAAA-MM-DD.json.gz
//
//  Gasta quase nada do plano do Firebase: em vez de ler o banco inteiro de novo, pega a cópia do dia
//  que o próprio sistema já guarda em `backups/` (lib/prudencia.js, rotina da noite). Se essa cópia
//  estiver faltando ou tiver mais de 30 horas (rotina da noite parada), faz uma na hora.
//
//  Sai em JSON pela saída padrão: { feitaEm, lojas: { id: cópia }, feiras: {...}, falhas: [...] }.
//  Segredos da plataforma (chaves de pagamento etc.) NÃO entram: ficam só no ~/segredos.env.
//  Se alguma loja falhar, ela aparece em "falhas" e o comando termina com código 1 (o agendador avisa).
// =====================================================================
const T = require('../lib/tenant');
const P = require('../lib/prudencia');

const VELHA_MS = 30 * 3600 * 1000;
const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');

async function fazerBackup(db, { agora = Date.now(), log = (m) => process.stderr.write(m + '\n') } = {}) {
  const saida = { versao: 1, feitaEm: new Date(agora).toISOString(), lojas: {}, feiras: {}, falhas: [] };
  const lojas = await T.listarLojas(db);
  for (const tid of lojas) {
    try {
      let ultima = await P.ultimaCopia(db, tid);
      if (!ultima || !ultima.feitaEm || agora - Date.parse(ultima.feitaEm) > VELHA_MS) {
        log(`[backup] ${tid}: cópia do dia faltando ou velha, fazendo agora`);
        await P.copiar(db, tid, new Date(agora));
        ultima = await P.ultimaCopia(db, tid);
      }
      const dados = ultima && await P.lerCopia(db, tid, ultima.dia);
      if (!dados) throw new Error('cópia incompleta');
      saida.lojas[tid] = dados;
      log(`[backup] ${tid}: ok (${ultima.dia}) ${JSON.stringify(dados.contagem || {})}`);
    } catch (e) {
      saida.falhas.push({ loja: tid, erro: String((e && e.message) || e).slice(0, 200) });
      log(`[backup] ${tid}: FALHOU ${e && e.message}`);
    }
  }
  try { const f = await db.collection('feiras').get(); saida.feiras = Object.fromEntries(f.docs.map((d) => [d.id, d.data()])); }
  catch (e) { saida.falhas.push({ loja: 'feiras', erro: String(e && e.message).slice(0, 200) }); }
  return saida;
}

module.exports = { fazerBackup };

if (require.main === module) {
  (async () => {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
    const saida = await fazerBackup(admin.firestore());
    process.stdout.write(JSON.stringify(saida));
    process.exitCode = saida.falhas.length ? 1 : 0;
  })().catch((e) => { process.stderr.write(`[backup] não consegui fazer a cópia: ${e && e.message}\n`); process.exitCode = 2; });
}
