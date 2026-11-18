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
  const copiaOk = { em: new Date(agora - 3 * 3600e3).toISOString(), ok: true, lojas: 2, enviadas: 3 };
  const tudo = (extra) => ({ versao: 'aaaaaaa', rotina: rotinaOk, copia: copiaOk, ...extra });
  assert.deepStrictEqual(A.avisosDeVersao(site, tudo(), agora), [], 'tudo igual: nada');
  assert.match(A.avisosDeVersao(site, tudo({ versao: 'bbbbbbb' }), agora)[0], /versões diferentes.*aaaaaaa.*bbbbbbb/);
  assert.deepStrictEqual(A.avisosDeVersao({ ...site, em: new Date(agora - 5 * 60e3).toISOString() }, tudo({ versao: 'bbbbbbb' }), agora), [], 'site publicado há 5 min: o servidor ainda pode estar atualizando');
  assert.match(A.avisosDeVersao(site, { ok: true }, agora)[0], /não informa a versão/, 'servidor de antes desta mudança');
  assert.match(A.avisosDeVersao(site, tudo({ rotina: undefined }), agora)[0], /ainda não rodou/);
  assert.match(A.avisosDeVersao(site, tudo({ rotina: { ...rotinaOk, em: new Date(agora - 40 * 3600e3).toISOString() } }), agora)[0], /não roda desde/);
  assert.match(A.avisosDeVersao(site, tudo({ rotina: { ...rotinaOk, ok: false, status: 500 } }), agora)[0], /falhou.*500/);
  // cópia fora da máquina: parada há mais de 30 h, nunca rodou, desligada ou com falha
  assert.match(A.avisosDeVersao(site, tudo({ copia: { ...copiaOk, em: new Date(agora - 31 * 3600e3).toISOString() } }), agora)[0], /fora da máquina não roda desde/);
  assert.match(A.avisosDeVersao(site, tudo({ copia: undefined }), agora)[0], /fora da máquina \(R2\) ainda não rodou/);
  assert.match(A.avisosDeVersao(site, tudo({ copia: { ...copiaOk, ok: false, desligada: true } }), agora)[0], /SÓ no servidor/);
  assert.match(A.avisosDeVersao(site, tudo({ copia: { ...copiaOk, ok: false, enviadas: 1 } }), agora)[0], /teve falha.*1 de 2/);
  assert.deepStrictEqual(A.avisosDeVersao(null, null, agora), [], 'servidor fora do ar: o painel já mostra o erro dele');
  assert.deepStrictEqual(A.avisosDeVersao(null, tudo(), agora), [], 'site sem versao.json (prévia): não compara');
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
  assert.ok(/::error title=Servidor NÃO foi atualizado::[\s\S]*?exit 1/.test(deploy) && !/ligado=false/.test(deploy), 'sem segredos: VERMELHO, com o que falta');
  assert.ok(/branches: \[rota-cloudflare\]/.test(deploy) && /cancel-in-progress: false/.test(deploy));
  assert.ok(/SO_SE_MUDOU=1 bash ~\/loja\/scripts\/atualizar-servidor\.sh/.test(deploy));
  const linhaCron = ler('scripts/ligar-backup.sh').split('\n').find((l) => l.startsWith('LINHA='));
  assert.ok(linhaCron && !/\/dev\/null/.test(linhaCron) && /agendador\.log/.test(linhaCron), 'a saída do agendador não some');
  assert.ok(/^LINHA="10 9 /.test(linhaCron), 'a cópia roda às 09:10 UTC, depois da rotina da noite (08:00 UTC)');
  const bk = ler('scripts/backup-diario.sh');
  assert.ok(/node server\/backup\.js "\$@"/.test(bk) && /--loja "\$loja"/.test(bk) && /banco\/\$dia\/\$nome\.json\.gz/.test(bk), 'um arquivo por loja, no disco e no R2');
  assert.ok(/backup-ferramentas\.js marcar/.test(bk), 'anota quando a cópia terminou (o painel avisa se parar)');
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
  // a máquina perdida não depende de uma pessoa só: o RUNBOOK tem o passo a passo e as seções que ele mesmo cita
  const rb = ler('RUNBOOK.md');
  assert.ok(/## \(v\) Máquina nova do zero/.test(rb) && /## Atualizar o servidor/.test(rb), 'RUNBOOK com "Máquina nova do zero" e "Atualizar o servidor"');
  assert.ok(/segredos\.env.{0,40}INTEIRO/s.test(rb) && /segredos\.env.{0,40}INTEIRO/s.test(ler('PUBLICAR.md')), 'o ~/segredos.env inteiro vai para o cofre compartilhado');
  assert.ok(/duas vezes|2 vezes/i.test(rb) && /duas vezes|2 vezes/i.test(ler("PUBLICAR.md")), 'a primeira atualização à mão roda 2 vezes');
});

// rodada 2: LGPD (achar a pessoa inteira, não tocar no vizinho, não desfazer pagamento), restauração por pasta e marca de LGPD
require('./infra-processo-lgpd')({ teste, criarBanco, raiz, semente, comChaveDoCofre, path, assert });

};
