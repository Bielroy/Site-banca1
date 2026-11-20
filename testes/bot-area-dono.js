'use strict';
// =====================================================================
//  testes/bot-area-dono.js — a ÁREA DO DONO do app da ponte (lib/bot.js, api/bot.js): só o dono da plataforma,
//  código de uma vez, token conferido pelo hash, dono trocado derruba o celular, cardápio fechado e a sensível
//  aprovada só no trabalho certo (marca única). O GitHub é de mentira (fetch falso).
// =====================================================================
module.exports = function registrar({ teste, criarBanco, raiz, assert, carregarApi, criarAdmin }) {
const B = require(raiz('lib/bot'));
const DONO = { uid: 'uid-dono', email: 'dono@usebanca.com' };

function githubFalso({ esperando = true, outroTrabalho = false, recusa = 0 } = {}) {
  const chamadas = [];
  let pedido = null;
  const fetchFn = async (url, op) => {
    const corpo = op.body ? JSON.parse(op.body) : null;
    chamadas.push({ metodo: op.method, url, corpo, auth: op.headers.Authorization });
    const resp = (status, j) => ({ ok: status < 300, status, text: async () => (j == null ? '' : JSON.stringify(j)) });
    if (recusa) return resp(recusa, { message: 'Bad credentials' });
    if (url.endsWith('/dispatches')) { pedido = corpo.inputs.pedido; return resp(204, null); }
    if (url.includes('/runs?')) {
      const runs = [{ id: 7, display_title: 'limpar-historico  app-00000000', created_at: new Date().toISOString(), status: 'waiting', html_url: 'https://x/7' }];
      if (!outroTrabalho) runs.unshift({ id: 9, display_title: `${pedido ? 'x  ' + pedido : 'estado'}`, created_at: new Date().toISOString(), status: esperando ? 'waiting' : 'completed', conclusion: 'success', html_url: 'https://x/9' });
      return resp(200, { workflow_runs: runs });
    }
    if (url.endsWith('/pending_deployments') && op.method === 'GET') return resp(200, esperando ? [{ environment: { id: 55, name: 'producao' } }] : []);
    if (url.endsWith('/pending_deployments') && op.method === 'POST') return resp(200, []);
    return resp(404, {});
  };
  return { fetchFn, chamadas };
}
const ENV = { BOT_GITHUB_TOKEN: 'ghp_teste', BOT_REPO: 'Bielroy/Site-banca1' };
const RAPIDO = { espera: 1, tentativas: 3 };

async function ligado(db) {
  const { codigo } = await B.criarCodigo(db, DONO);
  return (await B.entrar(db, { codigo, app: { modelo: 'Moto G' } })).token;
}

teste('área do dono: só o dono da plataforma gera código; o código vale uma vez; o banco guarda só o hash', async () => {
  const db = criarBanco({ 'plataforma/dono': DONO });
  await assert.rejects(B.criarCodigo(db, { uid: 'outra-conta' }), /Só o dono/);
  await assert.rejects(B.criarCodigo(criarBanco({}), DONO), /Só o dono/, 'plataforma sem dono: ninguém');
  const { codigo } = await B.criarCodigo(db, DONO);
  const r = await B.entrar(db, { codigo: codigo.toLowerCase(), app: { modelo: 'Moto G' } });
  assert.match(r.token, /^bd1\.bd[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
  await assert.rejects(B.entrar(db, { codigo }), /vencido ou já usado/, 'segunda vez não');
  const [id, seg] = r.token.split('.').slice(1);
  const doc = db._dados.get(`botAparelhos/${id}`);
  assert.ok(doc && !JSON.stringify(doc).includes(seg), 'o segredo nunca vai para o banco');
  assert.ok(await B.aparelhoDoToken(db, r.token));
  assert.strictEqual(await B.aparelhoDoToken(db, r.token.slice(0, -1) + (r.token.endsWith('A') ? 'B' : 'A')), null, 'segredo errado');
  assert.strictEqual(await B.aparelhoDoToken(db, 'pb1.banca.pt0000000000000000.' + 'x'.repeat(43)), null, 'token da ponte de impressão não serve aqui');
});

teste('área do dono: trocou o dono da plataforma ou desligou o celular → o token para de valer', async () => {
  const db = criarBanco({ 'plataforma/dono': DONO });
  const t = await ligado(db);
  db._dados.set('plataforma/dono', { uid: 'novo-dono' });
  assert.strictEqual(await B.aparelhoDoToken(db, t), null);
  db._dados.set('plataforma/dono', DONO);
  const ap = await B.aparelhoDoToken(db, t);
  assert.strictEqual((await B.listarAparelhos(db)).length, 1);
  await B.removerAparelho(db, ap.id);
  assert.strictEqual(await B.aparelhoDoToken(db, t), null);
});

teste('área do dono: tarefa normal só pede; sensível é aprovada no trabalho com a marca certa (nunca no de outro)', async () => {
  const db = criarBanco({ 'plataforma/dono': DONO });
  const ap = await B.aparelhoDoToken(db, await ligado(db));
  await assert.rejects(B.pedirTarefa(db, ap, { tarefa: 'trocar-segredo' }, { env: ENV, fetchFn: githubFalso().fetchFn, ...RAPIDO }), /fora do cardápio/);
  await assert.rejects(B.pedirTarefa(db, ap, { tarefa: 'rm -rf' }, { env: ENV, fetchFn: githubFalso().fetchFn, ...RAPIDO }), /fora do cardápio/);
  await assert.rejects(B.pedirTarefa(db, ap, { tarefa: 'estado' }, { env: {}, fetchFn: githubFalso().fetchFn, ...RAPIDO }), /BOT_GITHUB_TOKEN/);

  const n = githubFalso({ esperando: false });
  const rn = await B.pedirTarefa(db, ap, { tarefa: 'estado' }, { env: ENV, fetchFn: n.fetchFn, ...RAPIDO });
  assert.strictEqual(rn.sensivel, false); assert.strictEqual(rn.link, 'https://x/9');
  assert.deepStrictEqual(n.chamadas[0].corpo.inputs.tarefa, 'estado');
  assert.ok(n.chamadas.every((c) => !(c.metodo === 'POST' && c.url.endsWith('/pending_deployments'))), 'normal nunca aprova nada');
  assert.ok(n.chamadas.every((c) => c.url.startsWith('https://api.github.com/repos/Bielroy/Site-banca1/') && c.auth === 'Bearer ghp_teste'));

  const s = githubFalso();
  const rs = await B.pedirTarefa(db, ap, { tarefa: 'limpar-historico' }, { env: ENV, fetchFn: s.fetchFn, ...RAPIDO });
  assert.strictEqual(rs.aprovada, true);
  const aprov = s.chamadas.filter((c) => c.metodo === 'POST' && c.url.endsWith('/pending_deployments'));
  assert.strictEqual(aprov.length, 1); assert.ok(aprov[0].url.includes('/runs/9/'), 'aprovou o trabalho com a marca deste pedido');
  assert.deepStrictEqual(aprov[0].corpo.environment_ids, [55]);

  const o = githubFalso({ outroTrabalho: true });
  const ro = await B.pedirTarefa(db, ap, { tarefa: 'limpar-disco' }, { env: ENV, fetchFn: o.fetchFn, ...RAPIDO });
  assert.strictEqual(ro.aprovada, false, 'sem o trabalho com a marca: não aprova nada');
  assert.ok(o.chamadas.every((c) => !(c.metodo === 'POST' && c.url.endsWith('/pending_deployments'))), 'nunca aprova o trabalho de outra pessoa');
});

teste('área do dono (/api/bot): sem token 401; cardápio e tarefa com token; GitHub recusou vira mensagem clara', async () => {
  const db = criarBanco({ 'plataforma/dono': DONO });
  const t = await ligado(db);
  const s = githubFalso();
  const h = carregarApi(raiz('api/bot.js'), criarAdmin(db, {})).criarHandler({ obterDb: () => db, env: ENV, fetchFn: s.fetchFn, opcoesTarefa: RAPIDO });
  const chamar = async (corpo, token) => {
    const r = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { this.body = j; return this; }, end() { return this; } };
    await h({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: corpo, socket: { remoteAddress: '1.2.3.4' } }, r);
    return r;
  };
  assert.strictEqual((await chamar({ op: 'cardapio' })).code, 401);
  const c = await chamar({ op: 'cardapio' }, t);
  assert.strictEqual(c.code, 200); assert.ok(c.body.sensiveis.includes('limpar-historico') && !c.body.sensiveis.includes('trocar-segredo'));
  const r = await chamar({ op: 'tarefa', tarefa: 'limpar-historico' }, t);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.aprovada, true);
  const ruim = carregarApi(raiz('api/bot.js'), criarAdmin(db, {})).criarHandler({ obterDb: () => db, env: ENV, fetchFn: githubFalso({ recusa: 401 }).fetchFn, opcoesTarefa: RAPIDO });
  const rr = { code: 0, body: null, setHeader() {}, status(x) { this.code = x; return this; }, json(j) { this.body = j; return this; }, end() { return this; } };
  await ruim({ method: 'POST', headers: { authorization: `Bearer ${t}` }, body: { op: 'tarefa', tarefa: 'estado' }, socket: { remoteAddress: '1.2.3.5' } }, rr);
  assert.strictEqual(rr.code, 502); assert.match(rr.body.error, /recusou o BOT_GITHUB_TOKEN/);
  assert.ok(!JSON.stringify(rr.body).includes('ghp_teste'), 'o token nunca volta na resposta');
});
};
