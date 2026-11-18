'use strict';
// =====================================================================
//  server/backup-ferramentas.js — AJUDANTES DA CÓPIA DIÁRIA (quem chama é scripts/backup-diario.sh).
//  Rodam DENTRO do contêiner, com as mesmas chaves do servidor (nenhuma chave passa pela linha de comando).
//
//    docker exec -i loja node server/backup-ferramentas.js enviar banco/AAAA-MM-DD.json.gz < arquivo.json.gz
//        manda a cópia para o bucket FECHADO do R2 (lib/r2.js → enviarCopia). Saída: 0 ok, 3 = faltam variáveis, 1 = erro.
//    docker exec loja node server/backup-ferramentas.js alertar "texto"
//        avisa o celular da equipe da loja original (onde fica o dono da plataforma), pelo mesmo aviso de sempre
//        (lib/prudencia.js → alertar: no máximo 1 a cada 30 min).
// =====================================================================
const R2 = require('../lib/r2');

const lerEntrada = () => new Promise((ok, nao) => { const p = []; process.stdin.on('data', (c) => p.push(c)); process.stdin.on('end', () => ok(Buffer.concat(p))); process.stdin.on('error', nao); });

async function enviar(nome, opcoes = {}) {
  const corpo = opcoes.corpo || await lerEntrada();
  try {
    const r = await R2.enviarCopia(nome, corpo, opcoes);
    console.log(`[backup] fora da máquina: ${r.nome} (${Math.round(r.bytes / 1024)} KB) no R2`);
    return 0;
  } catch (e) {
    if (e && e.codigo === 'sem-config') { console.error(`[backup] cópia fora da máquina DESLIGADA: faltam ${e.falta.join(', ')} no ~/segredos.env (PUBLICAR.md, "Cópia fora da máquina")`); return 3; }
    console.error(`[backup] não consegui mandar para o R2: ${e && e.message}`);
    return 1;
  }
}

async function alertar(texto, { db } = {}) {
  const P = require('../lib/prudencia'), T = require('../lib/tenant');
  let banco = db;
  if (!banco) {
    const admin = require('firebase-admin');
    const k = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: k }) });
    banco = admin.firestore();
  }
  const corpo = String(texto || 'A cópia de segurança de hoje falhou.').replace(/[\u0000-\u001f]/g, ' ').slice(0, 180);
  const r = await P.alertar(banco, T.TENANT_PADRAO, 'backup-diario', { titulo: 'Cópia de segurança com problema', corpo: `${corpo} Veja: tail -n 30 ~/backups/backup.log` });
  console.log(`[backup] alerta: ${r.avisou ? `enviado (${r.enviados || 0} aparelho(s))` : 'não enviado (já houve um há menos de 30 min, ou ninguém ligou os avisos)'}`);
  return 0;
}

module.exports = { enviar, alertar };

if (require.main === module) {
  const [acao, arg] = process.argv.slice(2);
  const feito = acao === 'enviar' ? enviar(arg) : acao === 'alertar' ? alertar(arg) : Promise.resolve((console.error('Uso: enviar <banco/AAAA-MM-DD.json.gz> | alertar "<texto>"'), 2));
  feito.then((c) => { process.exitCode = c; }).catch((e) => { console.error('[backup]', e && e.message); process.exitCode = 1; });
}
