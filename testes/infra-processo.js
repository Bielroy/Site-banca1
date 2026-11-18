'use strict';
// =====================================================================
//  testes/infra-processo.js — testes da "infra e processo": versão do servidor, rotina da noite, cópia fora da
//  máquina, restauração, pedido de LGPD e os scripts/fluxos do GitHub. Entram no `npm test` por testes/index.js
//  (ficam num arquivo à parte para não embolar com os testes do resto).
// =====================================================================
module.exports = function registrar({ teste, criarBanco, raiz, semente, comR2, R2_TESTE, comChaveDoCofre, path, assert }) {

teste('versão do servidor: lê o commit do arquivo (ou da imagem), /api/saude mostra versão e rotina, e a rotina da noite fica anotada', async () => {
  const fs = require('fs'), os = require('os');
  const V = require(raiz('lib/versao')), { criarServidor } = require(raiz('server'));
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'versao-')), 'VERSAO');
  const antes = { a: process.env.VERSAO_ARQUIVO, c: process.env.VERSAO_COMMIT };
  process.env.VERSAO_ARQUIVO = arq; process.env.VERSAO_COMMIT = 'abcdef1234567890';
  V._zerar();
  try {
    assert.strictEqual(V.commit(), 'abcdef1234567890', 'sem arquivo: vale o commit da imagem');
    fs.writeFileSync(arq, '0123456789abcdef0123456789abcdef01234567\n'); V._zerar();
    assert.strictEqual(V.commit(), '0123456789abcdef0123456789abcdef01234567', 'o arquivo vale mais (muda sem reiniciar)');
    fs.writeFileSync(arq, 'lixo; rm -rf /'); V._zerar();
    assert.strictEqual(V.commit(), 'abcdef1234567890', 'arquivo estranho é ignorado');
    fs.writeFileSync(arq, '0123456789abcdef0123456789abcdef01234567\n'); V._zerar();

    const db = criarBanco({});
    let rodou = 0;
    const analytics = async (req, res) => { rodou++; res.status(200).json({ sucesso: true }); };
    const srv = criarServidor({ funcoes: { analytics }, segredo: 'segredo-do-proxy', segredoCron: 'cron-123', obterDb: () => db });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      let s = await (await fetch(base + '/api/saude')).json();
      assert.strictEqual(s.versao, '0123456', 'versão curta (7 letras), nunca segredo');
      assert.strictEqual(s.rotina, undefined, 'rotina ainda não rodou');
      await fetch(base + '/api/analytics');
      assert.ok(!db._dados.has(V.DOC), 'chamada sem o CRON_SECRET não conta como rotina');
      const r = await fetch(base + '/api/analytics', { headers: { Authorization: 'Bearer cron-123', 'X-Rotina-Commit': 'fedcba9876543210fedcba9876543210fedcba98' } });
      assert.strictEqual(r.status, 200); assert.strictEqual(rodou, 2);
      const anotado = db._dados.get(V.DOC);
      assert.strictEqual(anotado.ok, true); assert.strictEqual(anotado.servidor, '0123456'); assert.strictEqual(anotado.disparo, 'fedcba9');
      s = await (await fetch(base + '/api/saude')).json();
      assert.strictEqual(s.rotina.ok, true); assert.strictEqual(s.rotina.disparo, 'fedcba9');
      await fetch(base + '/api/analytics', { headers: { Authorization: 'Bearer cron-123', 'X-Rotina-Commit': '<script>' } });
      assert.strictEqual(db._dados.get(V.DOC).disparo, '', 'lixo no cabeçalho não vai para o banco');
    } finally { srv.close(); }
    // função que quebra: anotada como falha (500), não como sucesso
    const db2 = criarBanco({});
    const quebra = criarServidor({ funcoes: { analytics: async () => { throw new Error('x'); } }, segredoCron: 'cron-123', obterDb: () => db2 });
    await new Promise((ok) => quebra.listen(0, '127.0.0.1', ok));
    const err = console.error; console.error = () => {};
    try { await fetch(`http://127.0.0.1:${quebra.address().port}/api/analytics`, { headers: { Authorization: 'Bearer cron-123' } }); }
    finally { console.error = err; quebra.close(); }
    assert.strictEqual(db2._dados.get(V.DOC).ok, false); assert.strictEqual(db2._dados.get(V.DOC).status, 500);
  } finally {
    V._zerar();
    for (const [k, v] of [['VERSAO_ARQUIVO', antes.a], ['VERSAO_COMMIT', antes.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

teste('aviso de versão no painel: avisa site ≠ servidor (com folga de 20 min), servidor velho e rotina parada; quieto quando está tudo certo', async () => {
  const A = await import(raiz('js/aviso-versao-lib.js'));
  const agora = Date.UTC(2026, 10, 18, 12);
  const site = { commit: 'aaaaaaa111111111111111111111111111111111', em: new Date(agora - 3600e3).toISOString() };
  const rotinaOk = { em: new Date(agora - 5 * 3600e3).toISOString(), ok: true, status: 200 };
  assert.deepStrictEqual(A.avisosDeVersao(site, { versao: 'aaaaaaa', rotina: rotinaOk }, agora), [], 'tudo igual: nada');
  assert.match(A.avisosDeVersao(site, { versao: 'bbbbbbb', rotina: rotinaOk }, agora)[0], /versões diferentes.*aaaaaaa.*bbbbbbb/);
  assert.deepStrictEqual(A.avisosDeVersao({ ...site, em: new Date(agora - 5 * 60e3).toISOString() }, { versao: 'bbbbbbb', rotina: rotinaOk }, agora), [], 'site publicado há 5 min: o servidor ainda pode estar atualizando');
  assert.match(A.avisosDeVersao(site, { ok: true }, agora)[0], /não informa a versão/, 'servidor de antes desta mudança');
  assert.match(A.avisosDeVersao(site, { versao: 'aaaaaaa' }, agora)[0], /ainda não rodou/);
  assert.match(A.avisosDeVersao(site, { versao: 'aaaaaaa', rotina: { ...rotinaOk, em: new Date(agora - 40 * 3600e3).toISOString() } }, agora)[0], /não roda desde/);
  assert.match(A.avisosDeVersao(site, { versao: 'aaaaaaa', rotina: { ...rotinaOk, ok: false, status: 500 } }, agora)[0], /falhou.*500/);
  assert.deepStrictEqual(A.avisosDeVersao(null, null, agora), [], 'servidor fora do ar: o painel já mostra o erro dele');
  assert.deepStrictEqual(A.avisosDeVersao(null, { versao: 'aaaaaaa', rotina: rotinaOk }, agora), [], 'site sem versao.json (prévia): não compara');
  assert.ok(/<script type="module" src="\.\/js\/aviso-versao\.js"><\/script>/.test(require('fs').readFileSync(raiz('admin.html'), 'utf8')), 'o painel carrega a faixa');
});

teste('cópia fora da máquina (R2): bucket próprio e fechado, avisa o que falta, confere o MD5 e nunca usa o bucket das fotos', async () => {
  const R2 = require(raiz('lib/r2')), crypto = require('crypto');
  const NOMES_B = ['R2_BACKUP_BUCKET', 'R2_BACKUP_ACCESS_KEY_ID', 'R2_BACKUP_SECRET_ACCESS_KEY'];
  const antes = Object.fromEntries(NOMES_B.map((k) => [k, process.env[k]]));
  try {
    await comR2(R2_TESTE, async () => {
      NOMES_B.forEach((k) => delete process.env[k]);
      assert.deepStrictEqual(R2.configBackup().falta, ['R2_BACKUP_BUCKET'], 'sem bucket próprio: desligado, e diz o NOME do que falta');
      await assert.rejects(R2.enviarCopia('banco/2026-11-18.json.gz', Buffer.from('x')), (e) => e.codigo === 'sem-config');
      process.env.R2_BACKUP_BUCKET = 'fotos-bancas';
      assert.ok(R2.configBackup().falta[0].includes('público'), 'o bucket das fotos é aberto: recusado');
      process.env.R2_BACKUP_BUCKET = 'copias-banca';
      const c = R2.configBackup();
      assert.strictEqual(c.balde, 'copias-banca'); assert.strictEqual(c.chave, R2_TESTE.R2_ACCESS_KEY_ID, 'sem token próprio, usa o das fotos');
      process.env.R2_BACKUP_ACCESS_KEY_ID = 'CHAVEDOBACKUP0123456'; process.env.R2_BACKUP_SECRET_ACCESS_KEY = 'segredo-do-backup-0123456789';
      assert.strictEqual(R2.configBackup().chave, 'CHAVEDOBACKUP0123456', 'token próprio do bucket das cópias vale mais');
      const corpo = require('zlib').gzipSync(Buffer.from('{"versao":1}'));
      const md5 = crypto.createHash('md5').update(corpo).digest('hex');
      let pedido = null;
      const fetchFalso = (etag) => async (url, o) => { pedido = { url, o }; return new Response('', { status: 200, headers: { etag: `"${etag}"` } }); };
      const r = await R2.enviarCopia('banco/2026-11-18.json.gz', corpo, { fetch: fetchFalso(md5) });
      assert.deepStrictEqual(r, { nome: 'banco/2026-11-18.json.gz', bytes: corpo.length });
      assert.strictEqual(pedido.url, `https://${R2_TESTE.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/copias-banca/banco/2026-11-18.json.gz`);
      assert.strictEqual(pedido.o.method, 'PUT'); assert.ok(/Credential=CHAVEDOBACKUP0123456\//.test(pedido.o.headers.authorization));
      assert.ok(!('cache-control' in pedido.o.headers), 'cópia não é marcada como pública/guardável');
      await assert.rejects(R2.enviarCopia('banco/2026-11-18.json.gz', corpo, { fetch: fetchFalso('0'.repeat(32)) }), (e) => e.codigo === 'conferencia', 'chegou diferente: erro');
      await assert.rejects(R2.enviarCopia('../fotos/x.json.gz', corpo, { fetch: fetchFalso(md5) }), (e) => e.codigo === 'nome');
      await assert.rejects(R2.enviarCopia('banco/2026-11-18.json.gz', corpo, { fetch: async () => new Response('<Code>AccessDenied</Code>', { status: 403 }) }), (e) => e.codigo === 'r2' && /403 AccessDenied/.test(e.message));
      // a ferramenta que o script chama: 0 = ok, 3 = faltam variáveis (o script avisa e alerta)
      const F = require(raiz('server/backup-ferramentas.js'));
      const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
      try {
        assert.strictEqual(await F.enviar('banco/2026-11-18.json.gz', { corpo, fetch: fetchFalso(md5) }), 0);
        delete process.env.R2_BACKUP_BUCKET;
        assert.strictEqual(await F.enviar('banco/2026-11-18.json.gz', { corpo, fetch: fetchFalso(md5) }), 3);
      } finally { console.log = log; console.error = err; }
    });
  } finally { NOMES_B.forEach((k) => { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }); }
});

teste('alerta de falha do backup: vai para os aparelhos da loja original, no máximo 1 a cada 30 min', async () => {
  const F = require(raiz('server/backup-ferramentas.js'));
  const db = criarBanco({});
  const log = console.log; const vistos = []; console.log = (m) => vistos.push(String(m));
  try { assert.strictEqual(await F.alertar('A cópia de hoje saiu vazia.', { db }), 0); }
  finally { console.log = log; }
  const marca = db._dados.get('plataforma/alertas') || {};
  assert.ok(Object.keys(marca).some((k) => /backup-diario/.test(k)), 'o alerta passou pelo freio de 30 min (lib/prudencia.js alertar)');
  assert.ok(vistos.some((m) => /alerta:/.test(m)));
});

teste('restaurar cópia: backup → arquivo .gz → banco vazio volta igual (2 lojas, pedidos, ficha, feiras); nunca na produção por padrão', async () => {
  const P = require(raiz('lib/prudencia')), { fazerBackup } = require(raiz('server/backup.js')), R = require(raiz('server/restaurar-backup.js'));
  const fs = require('fs'), os = require('os'), zlib = require('zlib');
  const agora = new Date();
  const origem = criarBanco({ ...semente(), 'tenants/espetinhos': { nome: 'Espetinhos', ativo: true }, 'tenants/espetinhos/produtos/carne': { nome: 'Espeto', preco: 9, ativo: true },
    'pedidos/p1': { nome: 'c1:x', total: 10, data: agora.toISOString(), itens: [] }, 'feiras/f1': { nome: 'Feira Munique' } });
  const copia = await fazerBackup(origem, { log: () => {} });
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'restaurar-')), 'banco-teste.json.gz');
  fs.writeFileSync(arq, zlib.gzipSync(JSON.stringify(copia)));
  const dados = R.lerArquivo(arq);
  const destino = criarBanco({});
  const contagem = await R.restaurarDados(null, dados, { simular: true });
  assert.ok(contagem.documentos > 0); assert.strictEqual(destino._dados.size, 0, 'simular não grava');
  const r = await R.restaurarDados(destino, dados);
  assert.strictEqual(r.documentos, contagem.documentos);
  for (const tid of ['banca', 'espetinhos']) {
    const a = await P.exportar(origem, tid, agora), b = await P.exportar(destino, tid, agora);
    assert.deepStrictEqual(b.colecoes, a.colecoes, `${tid}: igual`); assert.deepStrictEqual(b.ficha, a.ficha);
  }
  assert.ok(Object.keys((await P.exportar(destino, 'banca', agora)).colecoes.pedidos).includes('p1'), 'pedido voltou');
  assert.strictEqual(destino._dados.get('feiras/f1').nome, 'Feira Munique');
  const so = criarBanco({}); await R.restaurarDados(so, dados, { lojas: ['espetinhos'] });
  assert.ok(so._dados.has('tenants/espetinhos/produtos/carne') && !so._dados.has('produtos/tomate') && !so._dados.has('feiras/f1'), 'só a loja pedida');
  class Ts { constructor(s, n) { this.s = s; this.n = n; } }
  const v = R.reviver({ a: { _seconds: 5, _nanoseconds: 0 }, b: [{ seconds: 1, nanoseconds: 2, type: 'firestore/timestamp/1.1.0' }], c: { _seconds: 1 } }, Ts);
  assert.ok(v.a instanceof Ts && v.b[0] instanceof Ts && !(v.c instanceof Ts), 'datas do Firestore voltam como datas');
  assert.throws(() => R.lerArquivo(raiz('package.json')), /cópia/, 'arquivo que não é cópia é recusado');
  // SEGURANÇA: nunca na produção por padrão
  const semEmu = { FIREBASE_PROJECT_ID: 'projeto-da-producao' };
  assert.throws(() => R.lerOpcoes([arq], semEmu), /destino/, 'sem destino: recusa');
  assert.throws(() => R.lerOpcoes([arq, '--projeto', 'banca-adair-e-pedrina', '--credenciais', arq], semEmu), /PRODUÇÃO/);
  assert.throws(() => R.lerOpcoes([arq, '--projeto', 'projeto-da-producao', '--credenciais', arq], semEmu), /PRODUÇÃO/, 'o projeto das chaves do servidor também é produção');
  assert.ok(R.lerOpcoes([arq, '--projeto', 'banca-adair-e-pedrina', '--credenciais', arq, '--producao'], semEmu).producao, 'com --producao passa (e ainda pergunta o nome na hora)');
  assert.throws(() => R.lerOpcoes([arq, '--projeto', 'banca-teste', '--credenciais', arq, '--sim'], semEmu), /só vale no emulador/);
  assert.throws(() => R.lerOpcoes([arq, '--emulador'], semEmu), /emulador ligado/);
  assert.throws(() => R.lerOpcoes([arq, '--projeto', 'x', '--credenciais', arq], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /use --emulador/);
  assert.strictEqual(R.lerOpcoes([arq, '--emulador', '--sim'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).projeto, 'demo-restauro');
  assert.throws(() => R.lerOpcoes([arq, '--emulador', '--projeto', 'banca-adair-e-pedrina'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /PRODUÇÃO/);
  assert.ok(R.lerOpcoes([arq, '--simular'], semEmu).simular, 'só contar não precisa de destino');
});

teste('LGPD, apagar cliente por telefone: anonimiza os pedidos (mantém valores), apaga conta, perfil e lista de espera, não toca nos outros', async () => {
  await comChaveDoCofre(async () => {
    const Cofre = require(raiz('lib/cofre')), A = require(raiz('lib/apagar-cliente')), N = require(raiz('analytics/normalize'));
    const fecha = (o, tid = 'banca') => Cofre.fecharCampos(o, tid);
    const casa = { quadra: '5', lote: '3', condominio: 'Jardins Munique' };
    const perfilId = N.idDeChave(N.chaveCliente({ ...casa, id: 'x' }));
    const db = criarBanco({
      'pedidos/p1': fecha({ nome: 'Ana', telefone: '62999990000', ...casa, obs: 'portão azul', total: 17.8, pag: 'PIX', status: 'entregue', clienteId: 'contaAna0000000a', userId: 'uidAna', aceitaOfertas: true, entregaDia: '2026-11-10', entrega: { taxa: 5, frete: { valor: 7, km: 3, rota: 'polilinha' } }, itens: [{ id: 'tomate', qtd: 2 }] }),
      'pedidos/p2': fecha({ nome: 'Ana', telefone: '5562999990000', quadra: '', lote: '', total: 5, status: 'pendente' }),
      'pedidos/p3': fecha({ nome: 'Bia', telefone: '62988887777', quadra: '1', lote: '1', total: 30, status: 'entregue' }),
      'contas/contaAna0000000a': { id: 'contaAna0000000a', ...fecha({ nome: 'Ana', telefone: '62999990000' }), uids: ['uidAna', 'uidAna2'], crm: perfilId },
      'contas/contaBia0000000b': { id: 'contaBia0000000b', ...fecha({ nome: 'Bia', telefone: '62988887777' }) },
      [`analytics_clientes/${perfilId}`]: { id: perfilId, ...fecha({ nome: 'Ana', ...casa }), uids: ['uidAna'] },
      'analytics_clientes/c_outra000000': { id: 'c_outra000000', ...fecha({ nome: 'Bia', quadra: '1', lote: '1' }) },
      'analytics_uid/uidAna': { clienteId: perfilId }, 'analytics_uid/uidAna2': { clienteId: perfilId }, 'analytics_uid/uidBia': { clienteId: 'c_outra000000' },
      'crm/contatos': { [perfilId]: 1, c_outra000000: 2 },
      'fretes/2026-11-10': { pedidos: { p1: { lat: -16.6, lng: -49.2 }, p9: { lat: 1, lng: 1 } } },
      'espera/tomate': { clientes: [{ nome: 'Ana', tel: Cofre.fechar('62999990000', 'banca', 'telefone') }, { nome: 'Bia', tel: Cofre.fechar('62988887777', 'banca', 'telefone') }] },
      'tenants/espetinhos/pedidos/x1': fecha({ nome: 'Ana', telefone: '62999990000', total: 9 }, 'espetinhos'),     // outra loja, MESMO telefone
    });
    const fotoAntes = JSON.stringify([...db._dados.entries()]);
    const previa = await A.apagarCliente(db, 'banca', '(62) 99999-0000');
    assert.deepStrictEqual(previa.pedidos.sort(), ['p1', 'p2'], 'acha com e sem o 55');
    assert.deepStrictEqual(previa.contas, ['contaAna0000000a']); assert.deepStrictEqual(previa.perfis, [perfilId]);
    assert.strictEqual(previa.espera, 1); assert.strictEqual(previa.gravado, false);
    assert.ok(!previa.telefone.includes('9999'), 'o relatório não mostra o telefone inteiro');
    assert.strictEqual(JSON.stringify([...db._dados.entries()]), fotoAntes, 'sem gravar: nada muda');

    const r = await A.apagarCliente(db, 'banca', '62999990000', { gravar: true });
    assert.strictEqual(r.gravado, true);
    const p1 = db._dados.get('pedidos/p1');
    assert.strictEqual(p1.nome, A.ANONIMO);
    for (const k of ['telefone', 'quadra', 'lote', 'obs', 'condominio', 'clienteId', 'userId']) assert.strictEqual(p1[k], '', `pedido sem ${k}`);
    assert.strictEqual(p1.aceitaOfertas, false); assert.ok(p1.dadosApagadosEm);
    assert.strictEqual(p1.total, 17.8); assert.strictEqual(p1.pag, 'PIX'); assert.strictEqual(p1.status, 'entregue'); assert.deepStrictEqual(p1.itens, [{ id: 'tomate', qtd: 2 }], 'valores e itens ficam (caixa)');
    assert.deepStrictEqual(p1.entrega.frete, { valor: 7, km: 3 }, 'a rota do frete sai, o valor fica');
    assert.strictEqual(Cofre.abrir(db._dados.get('pedidos/p3').telefone, 'banca', 'telefone'), '62988887777', 'pedido de outra pessoa intacto');
    assert.ok(!db._dados.has('contas/contaAna0000000a') && db._dados.has('contas/contaBia0000000b'));
    assert.ok(!db._dados.has(`analytics_clientes/${perfilId}`) && db._dados.has('analytics_clientes/c_outra000000'));
    assert.ok(!db._dados.has('analytics_uid/uidAna') && !db._dados.has('analytics_uid/uidAna2') && db._dados.has('analytics_uid/uidBia'));
    assert.deepStrictEqual(db._dados.get('crm/contatos'), { c_outra000000: 2 });
    assert.deepStrictEqual(Object.keys(db._dados.get('fretes/2026-11-10').pedidos), ['p9']);
    assert.deepStrictEqual(db._dados.get('espera/tomate').clientes.map((c) => c.nome), ['Bia']);
    assert.strictEqual(Cofre.abrir(db._dados.get('tenants/espetinhos/pedidos/x1').telefone, 'espetinhos', 'telefone'), '62999990000', 'a outra loja não é tocada');
    await assert.rejects(A.apagarCliente(db, 'banca', '123'), /Telefone inválido/);
    await assert.rejects(A.apagarCliente(db, '../x', '62999990000'), /Loja inválida/);
    assert.ok(A.mesmoTelefone('6299990000', '62999990000'), 'cadastro antigo sem o 9 do celular');

    // o script: sem --gravar só mostra; com --gravar pergunta, e sem "APAGAR" não muda nada
    const S = require(raiz('scripts/apagar-cliente.js'));
    const db2 = criarBanco({ 'pedidos/q1': fecha({ nome: 'Caio', telefone: '62977776666', total: 3 }) });
    const log = console.log; console.log = () => {};
    try {
      assert.strictEqual(await S.principal(['--loja', 'banca', '--telefone', '62977776666'], { db: db2 }), 0);
      assert.strictEqual(Cofre.abrir(db2._dados.get('pedidos/q1').nome, 'banca', 'nome'), 'Caio', 'simulação');
      assert.strictEqual(await S.principal(['--loja', 'banca', '--telefone', '62977776666', '--gravar'], { db: db2, perguntar: async () => 'nao' }), 1);
      assert.strictEqual(Cofre.abrir(db2._dados.get('pedidos/q1').nome, 'banca', 'nome'), 'Caio', 'sem APAGAR, nada muda');
      assert.strictEqual(await S.principal(['--loja', 'banca', '--telefone', '62977776666', '--gravar'], { db: db2, perguntar: async () => 'APAGAR' }), 0);
      assert.strictEqual(db2._dados.get('pedidos/q1').nome, A.ANONIMO);
      const aud = [...db2._dados.entries()].filter(([k]) => k.startsWith('auditoria/'));
      assert.ok(aud.length, 'fica na trilha de auditoria');
      assert.ok(!aud.some(([, x]) => JSON.stringify(x).includes('62977776666')), 'sem o telefone na auditoria');
    } finally { console.log = log; }
  });
});

teste('processo: rotina da noite falha à vista sem segredos, atualização do servidor desligada com aviso, backup sem /dev/null, scripts sem erro de sintaxe', () => {
  const fs = require('fs'), { spawnSync } = require('child_process');
  const ler = (p) => fs.readFileSync(raiz(p), 'utf8');
  const rotina = ler('.github/workflows/rotina-noite.yml');
  assert.ok(/::error title=Rotina da noite NÃO rodou::[\s\S]*?exit 1/.test(rotina), 'faltou segredo: vermelho, não "sucesso"');
  assert.ok(!/exit 0/.test(rotina), 'nenhum caminho termina verde sem chamar a rotina');
  assert.ok(/X-Rotina-Commit: \$GITHUB_SHA/.test(rotina), 'o disparo diz de qual commit veio');
  assert.ok(!('crons' in JSON.parse(ler('vercel.json'))), 'sem "crons" na Vercel: ao mesclar na main, a rotina velha da Vercel para no mesmo dia');
  const deploy = ler('.github/workflows/deploy-servidor.yml');
  for (const s of ['SSH_HOST', 'SSH_USER', 'SSH_KEY']) assert.ok(deploy.includes(`secrets.${s}`), s);
  assert.ok(/::warning title=Servidor NÃO foi atualizado::/.test(deploy), 'sem segredos: aviso claro');
  assert.ok(/branches: \[rota-cloudflare\]/.test(deploy) && /cancel-in-progress: false/.test(deploy));
  assert.ok(/SO_SE_MUDOU=1 bash ~\/loja\/scripts\/atualizar-servidor\.sh/.test(deploy));
  const linhaCron = ler('scripts/ligar-backup.sh').split('\n').find((l) => l.startsWith('LINHA='));
  assert.ok(linhaCron && !/\/dev\/null/.test(linhaCron) && /agendador\.log/.test(linhaCron), 'a saída do agendador não some');
  const bk = ler('scripts/backup-diario.sh');
  assert.ok(/backup-ferramentas\.js enviar/.test(bk) && /backup-ferramentas\.js alertar/.test(bk), 'cópia fora da máquina e alerta');
  const at = ler('scripts/atualizar-servidor.sh');
  assert.ok(/--build-arg VERSAO_COMMIT=/.test(at) && /\/app\/VERSAO:ro/.test(at), 'a versão chega ao servidor');
  assert.ok(/COPY scripts\/apagar-cliente\.js/.test(ler('Dockerfile')) && /!scripts\/apagar-cliente\.js/.test(ler('.dockerignore')), 'o script de LGPD vai para dentro da imagem');
  for (const s of ['scripts/atualizar-servidor.sh', 'scripts/backup-diario.sh', 'scripts/ligar-backup.sh', 'scripts/restaurar-backup.sh']) {
    const r = spawnSync('bash', ['-n', raiz(s)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${s}: ${r.stderr}`);
  }
  const pv = ler('privacidade.html');
  assert.ok(!/AVISO PARA O DONO/.test(pv) && !/Vercel/.test(pv), 'sem rascunho e sem hospedagem errada');
  for (const f of ['Amazon Web Services', 'Cloudflare', 'Firebase', 'Gemini', 'Asaas', 'PagBank', 'WhatsApp', 'CPF', '15 dias', '[NOME/CNPJ DO CONTROLADOR]', '[E-MAIL DO ENCARREGADO]']) assert.ok(pv.includes(f), `privacidade cita ${f}`);
});

};
