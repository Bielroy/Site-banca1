'use strict';
// =====================================================================
//  testes/bot-servidor.js — o BOT DO SERVIDOR (scripts/tarefas-servidor.sh e .github/workflows/tarefas-servidor.yml):
//  cardápio fechado, tarefa sensível só com a chave sensível, troca de chave sem vazar valor, DADOS_CHAVE intocável.
//  Entra no `npm test` por testes/index.js.
// =====================================================================
module.exports = function registrar({ teste, raiz, path, assert }) {
const fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');

function mundo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-'));
  fs.mkdirSync(path.join(d, 'scripts'));
  // atualizar-servidor.sh de mentira: só anota que foi chamado (e com SO_SE_MUDOU)
  fs.writeFileSync(path.join(d, 'scripts', 'atualizar-servidor.sh'), 'echo "chamou atualizar SO_SE_MUDOU=${SO_SE_MUDOU:-0}" >> "$PASTA/chamadas"\necho "Pronto: servidor no ar com a versão abc1234."\n');
  fs.writeFileSync(path.join(d, 'seg'), 'FIREBASE_PROJECT_ID=banca\nCRON_SECRET=velho\nDADOS_CHAVE=nao-mexe\n', { mode: 0o600 });
  fs.writeFileSync(path.join(d, 'hist'), 'ls\nexport DADOS_CHAVE=abc\ndocker ps\nR2_BACKUP_SECRET_ACCESS_KEY=xyz\n');
  return d;
}
function pedir(d, pedido, { sensivel = false, entrada = '', seco = false } = {}) {
  const env = { ...process.env, SSH_ORIGINAL_COMMAND: pedido, PASTA: d, SEGREDOS: path.join(d, 'seg'), HISTORICO: path.join(d, 'hist'),
    BACKUPS: path.join(d, 'backups'), VERSAO_ARQ: path.join(d, 'versao'), TAREFAS_SECO: seco ? '1' : '0' };
  const r = spawnSync('bash', [raiz('scripts/tarefas-servidor.sh'), ...(sensivel ? ['--sensivel'] : [])], { env, input: entrada, encoding: 'utf8' });
  return { rc: r.status, saida: (r.stdout || '') + (r.stderr || '') };
}

teste('bot do servidor: só o cardápio; nada de comando livre, encadeado ou com argumento estranho', () => {
  const d = mundo();
  for (const p of ['rm -rf /', 'estado; id', 'estado && cat ~/segredos.env', 'estado $(id)', 'bash', 'cat /etc/passwd', 'ESTADO', 'estado\nid', '', 'estado CRON_SECRET', 'trocar-segredo cron_secret', 'trocar-segredo A;B'])
    assert.strictEqual(pedir(d, p, { sensivel: true, seco: true }).rc, 2, `recusa: ${JSON.stringify(p)}`);
  assert.strictEqual(pedir(d, 'estado', { seco: true }).rc, 0);
  const leg = pedir(d, 'SO_SE_MUDOU=1 bash ~/loja/scripts/atualizar-servidor.sh');
  assert.strictEqual(leg.rc, 0, 'o pedido antigo do deploy-servidor.yml continua valendo');
  assert.match(fs.readFileSync(path.join(d, 'chamadas'), 'utf8'), /SO_SE_MUDOU=1/, 'e só atualiza se mudou');
  assert.match(leg.saida, /Pronto: servidor no ar com a versão/, 'a linha que o deploy procura passa adiante');
});

teste('bot do servidor: tarefa sensível sem a chave sensível é recusada e não mexe em nada', () => {
  const d = mundo(), antes = fs.readFileSync(path.join(d, 'seg'), 'utf8'), hist = fs.readFileSync(path.join(d, 'hist'), 'utf8');
  for (const p of ['trocar-segredo CRON_SECRET', 'limpar-historico', 'limpar-disco']) {
    const r = pedir(d, p, { entrada: 'novo\n' });
    assert.strictEqual(r.rc, 2, p); assert.match(r.saida, /aprovação do dono/);
  }
  assert.strictEqual(fs.readFileSync(path.join(d, 'seg'), 'utf8'), antes);
  assert.strictEqual(fs.readFileSync(path.join(d, 'hist'), 'utf8'), hist);
  assert.match(fs.readFileSync(path.join(d, 'backups', 'tarefas.log'), 'utf8'), /normal\ttrocar-segredo\trecusado/, 'a recusa fica anotada');
});

teste('bot do servidor: trocar-segredo troca só aquela linha, guarda o antes, nunca mostra o valor e nunca toca a DADOS_CHAVE', () => {
  const d = mundo();
  const valor = 'n0v0-v@lor/com$simbolos&\\barra';
  const r = pedir(d, 'trocar-segredo CRON_SECRET', { sensivel: true, entrada: valor + '\n' });
  assert.strictEqual(r.rc, 0, r.saida);
  const seg = fs.readFileSync(path.join(d, 'seg'), 'utf8');
  assert.ok(seg.includes('CRON_SECRET=' + valor + '\n'), 'valor gravado exatamente (símbolos e barra intactos)');
  assert.ok(seg.includes('FIREBASE_PROJECT_ID=banca') && seg.includes('DADOS_CHAVE=nao-mexe'), 'o resto fica');
  assert.strictEqual((seg.match(/^CRON_SECRET=/gm) || []).length, 1, 'uma linha só');
  assert.ok(!r.saida.includes(valor), 'o valor nunca aparece na saída (o registro do GitHub é público)');
  assert.strictEqual(fs.statSync(path.join(d, 'seg')).mode & 0o777, 0o600, 'arquivo continua só do dono');
  const copias = fs.readdirSync(d).filter((f) => f.startsWith('seg.antes-'));
  assert.strictEqual(copias.length, 1, 'cópia do antes guardada');
  assert.match(fs.readFileSync(path.join(d, copias[0]), 'utf8'), /CRON_SECRET=velho/);
  assert.match(fs.readFileSync(path.join(d, 'chamadas'), 'utf8'), /SO_SE_MUDOU=1/, 'atualiza o servidor para ler o valor novo');
  assert.ok(!fs.readFileSync(path.join(d, 'backups', 'tarefas.log'), 'utf8').includes(valor), 'nem no registro do servidor');

  const novo = pedir(d, 'trocar-segredo R2_BACKUP_BUCKET', { sensivel: true, entrada: 'copias-banca\n' });
  assert.strictEqual(novo.rc, 0); assert.match(fs.readFileSync(path.join(d, 'seg'), 'utf8'), /\nR2_BACKUP_BUCKET=copias-banca\n$/, 'chave que não existia entra no fim');

  const dk = pedir(d, 'trocar-segredo DADOS_CHAVE', { sensivel: true, entrada: 'outra\n' });
  assert.strictEqual(dk.rc, 2); assert.match(fs.readFileSync(path.join(d, 'seg'), 'utf8'), /DADOS_CHAVE=nao-mexe/, 'DADOS_CHAVE intocável');
  const vazio = pedir(d, 'trocar-segredo CRON_SECRET', { sensivel: true, entrada: '' });
  assert.strictEqual(vazio.rc, 2, 'sem valor: nada muda');
});

teste('bot do servidor: limpar-historico tira só as linhas com nome de chave', () => {
  const d = mundo();
  const r = pedir(d, 'limpar-historico', { sensivel: true });
  assert.strictEqual(r.rc, 0, r.saida); assert.match(r.saida, /2 linha/);
  assert.strictEqual(fs.readFileSync(path.join(d, 'hist'), 'utf8'), 'ls\ndocker ps\n');
});

teste('bot do servidor: o fluxo do GitHub separa as chaves e nunca põe o que se digita direto no comando', () => {
  const yml = fs.readFileSync(raiz('.github/workflows/tarefas-servidor.yml'), 'utf8');
  const [, normal, sensivel] = yml.split(/\n  (?:normal|sensivel):\n/);
  assert.ok(normal && sensivel, 'dois trabalhos');
  assert.ok(!/SSH_KEY_SENSIVEL|VALOR_NOVO: \$\{\{/.test(normal), 'a chave sensível e o valor novo nunca vão para o trabalho normal');
  assert.match(sensivel, /environment: producao/, 'o sensível espera a aprovação do ambiente producao');
  assert.match(sensivel, /CHAVE: \$\{\{ secrets\.SSH_KEY_SENSIVEL \}\}/);
  assert.ok(!/run:[^\n]*\$\{\{/.test(yml), 'nenhum ${{ }} dentro de run: (entrada vai por variável de ambiente)');
  const tarefas = (s) => JSON.parse(s.match(/fromJSON\('(\[[^']+\])'\)/)[1]);
  const sh = fs.readFileSync(raiz('scripts/tarefas-servidor.sh'), 'utf8');
  const lista = (n) => sh.match(new RegExp(`^${n}=" ([^"]+) "`, 'm'))[1].split(' ');
  for (const t of tarefas(sensivel)) assert.ok(lista('SENSIVEIS').includes(t), `${t} é sensível no servidor também`);
  for (const t of tarefas(normal)) assert.ok(lista('NORMAIS').includes(t), `${t} é normal no servidor`);
  for (const s of ['scripts/tarefas-servidor.sh', '.github/tarefa-ssh.sh']) assert.strictEqual(spawnSync('bash', ['-n', raiz(s)]).status, 0, `${s} sem erro de sintaxe`);
});
};
