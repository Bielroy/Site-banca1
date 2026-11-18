'use strict';
// =====================================================================
//  testes/regras/backup-restaurar.test.js — ENSAIO DE RESTAURAÇÃO NO EMULADOR DO FIREBASE (roda no GitHub).
//
//  O ciclo inteiro, com o Firestore de verdade (emulador) e os scripts de verdade:
//    1. põe duas lojas de mentira no banco (com data do Firestore, pedido, ficha, feira);
//    2. faz a cópia como o servidor faz toda madrugada (server/backup.js) e grava o arquivo .json.gz;
//    3. APAGA o banco inteiro;
//    4. restaura com scripts/restaurar-backup.sh --emulador;
//    5. confere que o banco voltou igual ao de antes.
//  Também confere que o script recusa a produção sem --producao.
//
//  Como roda (.github/workflows/seguranca.yml, trabalho "regras"):
//    firebase emulators:exec --only firestore --project demo-banca "node testes/regras/backup-restaurar.test.js"
//  Precisa do firebase-admin da raiz (npm ci). O emulador está em modo de projeto único: tudo no demo-banca.
// =====================================================================
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const raiz = (p) => path.join(__dirname, '..', '..', p);
const PROJETO = 'demo-banca';

(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(host, 'rode dentro de "firebase emulators:exec"');
  const admin = require('firebase-admin');
  const P = require(raiz('lib/prudencia'));
  const { fazerBackup } = require(raiz('server/backup.js'));
  const db = admin.initializeApp({ projectId: PROJETO }, 'ensaio').firestore();
  const agora = new Date();
  const criado = admin.firestore.Timestamp.fromMillis(Date.UTC(2026, 10, 1, 12));

  // 1. dados de mentira
  await db.doc('produtos/tomate').set({ nome: 'Tomate', preco: 8.9, ativo: true, criadoEm: criado });
  await db.doc('loja/config').set({ wpp: '5562999990000', lojaAberta: true });
  await db.doc('pedidos/p1').set({ nome: 'c1:cifrado-de-mentira', total: 17.8, status: 'entregue', data: agora.toISOString(), itens: [{ id: 'tomate', qtd: 2 }] });
  await db.doc('cupons/BANCA10').set({ ativo: true, percentual: 10 });
  await db.doc('tenants/espetinhos').set({ nome: 'Espetinhos do Zé', ativo: true });
  await db.doc('tenants/espetinhos/produtos/carne').set({ nome: 'Espeto', preco: 9, ativo: true });
  await db.doc('feiras/f1').set({ nome: 'Feira Munique', lojas: ['espetinhos'] });
  const antes = { banca: await P.exportar(db, 'banca', agora), espetinhos: await P.exportar(db, 'espetinhos', agora) };
  assert.ok(antes.banca.colecoes.pedidos.p1 && antes.espetinhos.colecoes.produtos.carne, 'dados de mentira no lugar');

  // 2. a cópia da madrugada, em arquivo
  const copia = await fazerBackup(db, { log: () => {} });
  assert.deepStrictEqual(copia.falhas, []);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ensaio-'));
  const arq = path.join(pasta, `banco-${agora.toISOString().slice(0, 10)}.json.gz`);
  fs.writeFileSync(arq, zlib.gzipSync(JSON.stringify(copia)));

  // 3. o dia ruim: o banco some
  const r0 = await fetch(`http://${host}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(r0.ok, `apagar o emulador: ${r0.status}`);
  assert.strictEqual((await db.doc('produtos/tomate').get()).exists, false, 'banco apagado');

  // a produção é recusada sem --producao (e nada é gravado)
  const recusa = spawnSync('bash', [raiz('scripts/restaurar-backup.sh'), arq, '--emulador', '--projeto', 'banca-adair-e-pedrina', '--sim'], { encoding: 'utf8', env: process.env });
  assert.notStrictEqual(recusa.status, 0, 'produção sem --producao tem de ser recusada');
  assert.match(recusa.stdout + recusa.stderr, /PRODUÇÃO/);
  // fora do emulador, "--sim" (sem perguntar) não vale
  const semPergunta = spawnSync('bash', [raiz('scripts/restaurar-backup.sh'), arq, '--projeto', 'banca-teste', '--credenciais', arq, '--sim'], { encoding: 'utf8', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '' } });
  assert.notStrictEqual(semPergunta.status, 0, '--sim fora do emulador é recusado');
  assert.strictEqual((await db.doc('produtos/tomate').get()).exists, false, 'as recusas não gravaram nada');

  // 4. restaurar com o script de verdade
  const r = spawnSync('bash', [raiz('scripts/restaurar-backup.sh'), arq, '--emulador', '--projeto', PROJETO, '--sim'], { encoding: 'utf8', env: process.env });
  assert.strictEqual(r.status, 0, `o script falhou:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Pronto: \d+ documento/);

  // 5. voltou igual
  for (const tid of ['banca', 'espetinhos']) {
    const depois = await P.exportar(db, tid, agora);
    assert.deepStrictEqual(depois.colecoes, antes[tid].colecoes, `${tid}: coleções iguais às de antes`);
    assert.deepStrictEqual(depois.ficha, antes[tid].ficha, `${tid}: ficha igual`);
  }
  const tomate = (await db.doc('produtos/tomate').get()).data();
  assert.ok(tomate.criadoEm instanceof admin.firestore.Timestamp, 'a data do Firestore voltou como data (não como texto)');
  assert.strictEqual(tomate.criadoEm.toMillis(), criado.toMillis());
  assert.strictEqual((await db.doc('feiras/f1').get()).data().nome, 'Feira Munique', 'feiras voltaram');

  fs.rmSync(pasta, { recursive: true, force: true });
  console.log('ok: backup → apagar → restaurar no emulador, banco igual ao de antes (2 lojas, pedidos, ficha, feiras, datas).');
  process.exit(0);
})().catch((e) => { console.error('FALHOU o ensaio de restauração:', e && (e.stack || e.message)); process.exit(1); });
