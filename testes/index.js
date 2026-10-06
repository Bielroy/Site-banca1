'use strict';
// =====================================================================
//  testes/index.js — roda com:  npm test
//  Não precisa de internet nem do Firebase: usa um banco de mentira
//  (testes/banco-falso.js). Cada teste diz em português o que garante.
// =====================================================================
const path = require('path');
const assert = require('assert');
const { criarBanco, criarAdmin, chamar, carregarApi } = require('./banco-falso');
const raiz = (p) => path.join(__dirname, '..', p);
const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

process.env.FIREBASE_PROJECT_ID = 'x'; process.env.FIREBASE_CLIENT_EMAIL = 'x'; process.env.FIREBASE_PRIVATE_KEY = 'x';
process.env.CRON_SECRET = 'segredo-cron';

// ---------- dados de exemplo: duas lojas com o MESMO id de produto e preços diferentes ----------
const semente = () => ({
  'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', cat: 'legumes', ativo: true },
  'loja/config': { wpp: '5562999990000', lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6] },
  'cupons/BANCA10': { ativo: true, percentual: 10 },
  'tenants/espetinhos': { nome: 'Espetinhos do Zé', ativo: true },
  'tenants/espetinhos/produtos/tomate': { nome: 'Espeto de tomate', preco: 3, unidade: 'un', cat: 'espetos', ativo: true },
  'tenants/espetinhos/loja/config': { wpp: '5562988880000', lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6] },
  'tenants/fechada': { nome: 'Loja bloqueada', ativo: false },
  'analytics_previsoes/painel': { meta: { dono: 'banca' }, dashboard: {} },
  'tenants/espetinhos/analytics_previsoes/painel': { meta: { dono: 'espetinhos' }, dashboard: {} },
});
const TOKENS = {
  'dona-banca': { uid: 'u1', admin: true },                                  // conta antiga
  'dono-espetinhos': { uid: 'u2', tenants: { espetinhos: 'proprietario' } },
  'caixa-espetinhos': { uid: 'u3', tenants: { espetinhos: 'caixa' } },
  'plataforma': { uid: 'u4', plataforma: true },
  'cliente': { uid: 'c1' },
};
// custo e ficha técnica ficam em produtos_custos (privado): separa o que as sementes escrevem junto por comodidade
const criarBancoP = (semente) => {
  const out = {};
  for (const [k, v] of Object.entries(semente)) {
    const m = k.match(/^(.*)produtos\/([^/]+)$/);
    if (m && (v.custo !== undefined || v.ficha !== undefined)) { const { custo, ficha, ...pub } = v; out[k] = pub; out[`${m[1]}produtos_custos/${m[2]}`] = { ...(custo !== undefined ? { custo } : {}), ...(ficha !== undefined ? { ficha } : {}) }; }
    else out[k] = v;
  }
  return criarBanco(out);
};
const pedido = (extra = {}) => ({ nome: 'Ana', quadra: '5', lote: '3', condominio: 'Jardins Munique', pag: 'PIX', idempotencyKey: 'ped-' + Math.random().toString(36).slice(2, 12), itens: [{ id: 'tomate', qtd: 2, tipo: 'kg' }], ...extra });
let ipSeq = 0; const ip = () => ({ 'x-forwarded-for': `10.0.0.${++ipSeq}` });

// ------------------------------------------------------------------ lojas e caminhos
teste('loja original lê a raiz do banco; outra loja lê tenants/{id}', () => {
  const T = require(raiz('lib/tenant')); const db = criarBanco();
  assert.strictEqual(T.tdoc(db, 'banca', 'produtos', 'x').path, 'produtos/x');
  assert.strictEqual(T.tdoc(db, 'espetinhos', 'produtos', 'x').path, 'tenants/espetinhos/produtos/x');
  assert.strictEqual(T.docDe(db, 'espetinhos', 'loja/config').path, 'tenants/espetinhos/loja/config');
  assert.strictEqual(T.escopo(db, 'espetinhos').doc('analytics_global/atual').path, 'tenants/espetinhos/analytics_global/atual');
  assert.strictEqual(T.escopo(db, 'banca'), db);
});
teste('id de loja malformado é recusado (não vira caminho no banco)', () => {
  const T = require(raiz('lib/tenant'));
  for (const ruim of ['../pedidos', 'a/b', 'A', 'x', 'loja com espaço', '-comeca-com-traco']) assert.strictEqual(T.tenantDaRequisicao({ headers: { 'x-loja': ruim } }), null, ruim);
  assert.strictEqual(T.tenantDaRequisicao({ headers: {} }), 'banca');
  assert.strictEqual(T.tenantDaRequisicao({ headers: { 'x-loja': 'Espetinhos' } }), 'espetinhos');
});
teste('papel vale só na loja em que foi dado', () => {
  const T = require(raiz('lib/tenant'));
  assert.strictEqual(T.papelDe(TOKENS['dono-espetinhos'], 'espetinhos'), 'proprietario');
  assert.strictEqual(T.papelDe(TOKENS['dono-espetinhos'], 'banca'), null);
  assert.strictEqual(T.papelDe(TOKENS['dona-banca'], 'banca'), 'proprietario');
  assert.strictEqual(T.papelDe(TOKENS['dona-banca'], 'espetinhos'), null);
  assert.strictEqual(T.temPapel(TOKENS['caixa-espetinhos'], 'espetinhos'), false, 'caixa não é gestor');
  assert.strictEqual(T.temPapel(TOKENS['caixa-espetinhos'], 'espetinhos', ['caixa']), true);
  assert.strictEqual(T.temPapel(TOKENS['plataforma'], 'qualquer-loja'), true);
  assert.strictEqual(T.papelDe({ tenants: { espetinhos: 'papel-inventado' } }, 'espetinhos'), null);
  assert.strictEqual(T.papelDe(TOKENS['cliente'], 'banca'), null);
});

// ------------------------------------------------------------------ checkout
teste('pedido da loja original fica na raiz e usa o preço do SERVIDOR', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const p = pedido({ itens: [{ id: 'tomate', qtd: 2, tipo: 'kg', precoOriginal: 0.01, preco: 0.01 }], clientTotal: 0.02 });
  const r = await chamar(api, { headers: ip(), body: p });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.strictEqual(r.corpo.pedido.total, 17.8, 'preço enviado pelo navegador (R$ 0,01) tem de ser ignorado');
  assert.ok(db._dados.has(`pedidos/${p.idempotencyKey}`));
  assert.strictEqual(db._dados.get(`pedidos/${p.idempotencyKey}`).condominio, 'Jardins Munique');
});
teste('pedido de outra loja fica DENTRO dela, com o preço dela', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const p = pedido({ itens: [{ id: 'tomate', qtd: 4, tipo: 'un' }] });
  const r = await chamar(api, { headers: { ...ip(), 'X-Loja': 'espetinhos' }, body: p });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.strictEqual(r.corpo.pedido.total, 12);
  assert.ok(db._dados.has(`tenants/espetinhos/pedidos/${p.idempotencyKey}`));
  assert.ok(!db._dados.has(`pedidos/${p.idempotencyKey}`), 'não pode vazar para a loja original');
  assert.ok(r.corpo.pedido.whatsappMsg.includes('5562988880000'), 'vai para o WhatsApp da própria loja');
  assert.strictEqual(db._dados.get('tenants/espetinhos/analytics/dashboard').totalPedidos, 1);
  assert.ok(!db._dados.has('analytics/dashboard'));
});
teste('cupom de uma loja não vale em outra', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const r = await chamar(api, { headers: { ...ip(), 'X-Loja': 'espetinhos' }, body: pedido({ cupom: 'BANCA10', itens: [{ id: 'tomate', qtd: 1, tipo: 'un' }] }) });
  assert.strictEqual(r.status, 400); assert.match(r.corpo.error, /Cupom/);
});
teste('loja inexistente, bloqueada ou com id malformado não recebe pedido', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  assert.strictEqual((await chamar(api, { headers: { ...ip(), 'X-Loja': 'nao-existe' }, body: pedido() })).status, 404);
  assert.strictEqual((await chamar(api, { headers: { ...ip(), 'X-Loja': 'fechada' }, body: pedido() })).status, 403);
  assert.strictEqual((await chamar(api, { headers: { ...ip(), 'X-Loja': '../pedidos' }, body: pedido() })).status, 400);
});

// ------------------------------------------------------------------ cancelamento
teste('cliente não cancela pedido de outra pessoa nem pedido de outra loja', async () => {
  const db = criarBanco(semente()); const adm = criarAdmin(db, TOKENS);
  const checkout = carregarApi(raiz('api/checkout.js'), adm);
  const p = pedido({ itens: [{ id: 'tomate', qtd: 1, tipo: 'un' }] });
  await chamar(checkout, { headers: { ...ip(), 'X-Loja': 'espetinhos', Authorization: 'Bearer cliente' }, body: p });
  const cancelar = carregarApi(raiz('api/cancelar-pedido.js'), adm);
  const outro = await chamar(cancelar, { headers: { 'X-Loja': 'espetinhos', Authorization: 'Bearer dona-banca' }, body: { pedidoId: p.idempotencyKey } });
  assert.notStrictEqual(outro.status, 200, 'outra pessoa não cancela');
  const lojaErrada = await chamar(cancelar, { headers: { Authorization: 'Bearer cliente' }, body: { pedidoId: p.idempotencyKey } });
  assert.notStrictEqual(lojaErrada.status, 200, 'na loja original esse pedido não existe');
  const certo = await chamar(cancelar, { headers: { 'X-Loja': 'espetinhos', Authorization: 'Bearer cliente' }, body: { pedidoId: p.idempotencyKey } });
  assert.strictEqual(certo.status, 200, JSON.stringify(certo.corpo));
  assert.strictEqual(db._dados.get(`tenants/espetinhos/pedidos/${p.idempotencyKey}`).status, 'cancelado');
});

// ------------------------------------------------------------------ painel / previsão
teste('gestor de uma loja não lê a previsão de outra, mesmo pedindo direto à API', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/analytics.js'), criarAdmin(db, TOKENS));
  const ver = (token, loja) => chamar(api, { headers: { Authorization: `Bearer ${token}`, ...(loja ? { 'X-Loja': loja } : {}) }, body: { acao: 'painel' } });
  let r = await ver('dono-espetinhos', 'espetinhos'); assert.strictEqual(r.status, 200); assert.strictEqual(r.corpo.meta.dono, 'espetinhos');
  r = await ver('dona-banca'); assert.strictEqual(r.status, 200); assert.strictEqual(r.corpo.meta.dono, 'banca');
  assert.strictEqual((await ver('dono-espetinhos')).status, 403, 'dono dos espetinhos na loja original');
  assert.strictEqual((await ver('dona-banca', 'espetinhos')).status, 403, 'dona da banca nos espetinhos');
  assert.strictEqual((await ver('caixa-espetinhos', 'espetinhos')).status, 403, 'caixa não vê o painel de previsão');
  assert.strictEqual((await ver('cliente', 'espetinhos')).status, 403);
  assert.strictEqual((await chamar(api, { headers: { 'X-Loja': 'espetinhos' }, body: { acao: 'painel' } })).status, 401, 'sem login');
  r = await ver('plataforma', 'espetinhos'); assert.strictEqual(r.status, 200); assert.strictEqual(r.corpo.meta.dono, 'espetinhos');
});
teste('rotina diária recalcula cada loja no lugar certo e exige o segredo', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/analytics.js'), criarAdmin(db, TOKENS));
  assert.strictEqual((await chamar(api, { method: 'GET', headers: {} })).status, 401);
  const r = await chamar(api, { method: 'GET', headers: { Authorization: 'Bearer segredo-cron' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.deepStrictEqual(Object.keys(r.corpo.lojas).sort(), ['banca', 'espetinhos']);   // a bloqueada fica de fora
  assert.ok(db._dados.has('tenants/espetinhos/analytics_global/atual'));
  assert.ok(db._dados.has('analytics_global/atual'));
});

// ------------------------------------------------------------------ aviso de pagamento
teste('referência do PIX separa loja e pedido, e recusa formato estranho', () => {
  const T = require(raiz('lib/tenant'));
  const ler = (ref) => { const [a, b] = ref.includes('~') ? ref.split('~') : [T.TENANT_PADRAO, ref]; return T.idValido(a) && /^[\w-]{6,80}$/.test(b || '') ? { tid: a, id: b } : null; };
  assert.deepStrictEqual(ler('abc123-def'), { tid: 'banca', id: 'abc123-def' });
  assert.deepStrictEqual(ler('espetinhos~abc123-def'), { tid: 'espetinhos', id: 'abc123-def' });
  assert.strictEqual(ler('../x~abc123'), null); assert.strictEqual(ler('espetinhos~a/b/c/d/e'), null);
});

// ------------------------------------------------------------------ endereço e motor
teste('endereço em uma linha: quadra/lote, rua/número e pedido antigo', () => {
  const { linhaEndereco } = require(raiz('lib/endereco'));
  assert.strictEqual(linhaEndereco({ quadra: '5', lote: '3' }), 'Quadra 5 • Lote 3');
  assert.strictEqual(linhaEndereco({ condominio: 'Jardins Munique', quadra: 'Das Alpineas', lote: '12', formatoEndereco: 'rua' }), 'Jardins Munique — Das Alpineas, nº 12');
});
teste('motor: mesma quadra e lote em condomínios diferentes são clientes diferentes', () => {
  const N = require(raiz('analytics/normalize'));
  const it = [{ id: 'b', nome: 'B', qtd: 1, unidade: 'un', preco: 1 }], d = (n) => new Date(Date.UTC(2026, 8, n, 15)).toISOString();
  const r = N.normalizarPedidos([
    { id: '1', data: d(1), nome: 'Ana', quadra: '5', lote: '3', itens: it },
    { id: '2', data: d(8), nome: 'Ana', quadra: 'Qd 05', lote: '3', condominio: 'Jardins Munique', itens: it },
    { id: '3', data: d(9), nome: 'Caio', quadra: '5', lote: '3', condominio: 'Outro', itens: it },
  ], []);
  assert.strictEqual(r.clientes.length, 3, 'com 2 condomínios para o mesmo endereço, o pedido antigo fica separado');
  const r2 = N.normalizarPedidos([{ id: '1', data: d(1), nome: 'Ana', quadra: '5', lote: '3', itens: it }, { id: '2', data: d(8), nome: 'Ana', quadra: '5', lote: '3', condominio: 'Jardins Munique', itens: it }], []);
  assert.strictEqual(r2.clientes.length, 1, 'com 1 condomínio só, o pedido antigo é da mesma casa');
});
teste('motor: dia com falta de produto sobe a previsão; métricas novas batem com a conta à mão', () => {
  const D = require(raiz('analytics/demandForecast')), E = require(raiz('analytics/evaluation'));
  const abertos = new Set([1, 2, 3, 4, 5, 6]), vendas = new Map(), faltas = new Set();
  for (let d = 20000; d < 20060; d++) { vendas.set(d, 10); if (d % 3 === 0) faltas.add(d); }
  const sem = D.nucleo(D.montarSerie(vendas, 20059, abertos), 20060).pred, com = D.nucleo(D.montarSerie(vendas, 20059, abertos, faltas), 20060).pred;
  assert.ok(com > sem, `com falta ${com} deveria passar de ${sem}`);
  const m = E.metricas([{ previsto: 10, real: 12, q10: 7, q90: 13, ingenuo: 6 }, { previsto: 5, real: 4, q10: 3, q90: 8, ingenuo: 4 }]);
  assert.strictEqual(m.mase, 0.5); assert.strictEqual(m.mae, 1.5);
});

// ------------------------------------------------------------------ estoque
const sementeEstoque = () => ({ ...semente(),
  'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', cat: 'legumes', ativo: true, estoqueFisico: 11, custo: 4 },
  'produtos/ovos': { nome: 'Ovos', preco: 14, unidade: 'un', cat: 'artesanais', ativo: true, estoqueFisico: 10, custo: 9 },
  'tenants/espetinhos/produtos/tomate': { nome: 'Espeto de tomate', preco: 3, unidade: 'un', cat: 'espetos', ativo: true, estoqueFisico: 50 },
});
const TOKENS_E = { ...TOKENS, 'estoquista-espetinhos': { uid: 'u5', tenants: { espetinhos: 'estoque' } } };
const movs = (db, prefixo = '') => [...db._dados.entries()].filter(([k]) => k.startsWith(prefixo + 'estoque_mov/')).map(([, v]) => v);

teste('estoque: conta de cada tipo de movimentação', () => {
  const E = require(raiz('lib/estoque'));
  assert.deepStrictEqual(E.calcularMovimento({ atual: 11, tipo: 'compra', qtd: 24 }), { delta: 24, novo: 35 });
  assert.deepStrictEqual(E.calcularMovimento({ atual: 11, tipo: 'perda', qtd: 3 }), { delta: -3, novo: 8 });
  assert.deepStrictEqual(E.calcularMovimento({ atual: 11, tipo: 'ajuste', contagem: 9.5 }), { delta: -1.5, novo: 9.5 });
  assert.deepStrictEqual(E.calcularMovimento({ atual: null, tipo: 'ajuste', contagem: 20 }), { delta: 20, novo: 20 });
  assert.deepStrictEqual(E.calcularMovimento({ atual: 0.3, tipo: 'saida', qtd: 0.1 }), { delta: -0.1, novo: 0.2 }, 'sem erro de arredondamento');
  assert.throws(() => E.calcularMovimento({ atual: 2, tipo: 'perda', qtd: 3 }), /mais do que tem/);
  for (const ruim of [0, -1, 'abc', NaN, Infinity]) assert.throws(() => E.calcularMovimento({ atual: 5, tipo: 'compra', qtd: ruim }));
  assert.throws(() => E.calcularMovimento({ atual: 5, tipo: 'ajuste', contagem: -1 }));
  assert.throws(() => E.calcularMovimento({ atual: 5, tipo: 'venda', qtd: 1 }), /inválido/, 'venda não pode ser lançada à mão');
});
teste('estoque: perda muda o produto e o histórico juntos, com o custo', async () => {
  const db = criarBancoP(sementeEstoque()); const api = carregarApi(raiz('api/estoque.js'), criarAdmin(db, TOKENS_E));
  const r = await chamar(api, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'movimentar', produtoId: 'tomate', tipo: 'perda', qtd: 3, motivo: 'maturacao', chave: 'chave-0001' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.saldo, 8);
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 8);
  const m = movs(db); assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].qtd, -3); assert.strictEqual(m[0].saldo, 8); assert.strictEqual(m[0].motivo, 'maturacao'); assert.strictEqual(m[0].valor, 12, '3 kg × R$ 4 de custo');
  // o mesmo toque chegando duas vezes não tira de novo
  const de_novo = await chamar(api, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'movimentar', produtoId: 'tomate', tipo: 'perda', qtd: 3, motivo: 'maturacao', chave: 'chave-0001' } });
  assert.strictEqual(de_novo.corpo.repetido, true); assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 8);
});
teste('estoque: compra atualiza o custo; zerar tira da venda; tirar mais do que tem é recusado', async () => {
  const db = criarBancoP(sementeEstoque()); const api = carregarApi(raiz('api/estoque.js'), criarAdmin(db, TOKENS_E));
  const ir = (body) => chamar(api, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'movimentar', produtoId: 'tomate', ...body } });
  await ir({ tipo: 'compra', qtd: 24, custoUnit: 5.5 });
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 35); assert.strictEqual(db._dados.get('produtos_custos/tomate').custo, 5.5);
  assert.strictEqual(db._dados.get('produtos/tomate').custo, undefined, 'o custo NÃO pode ficar no produto, que é de leitura pública');
  assert.strictEqual((await ir({ tipo: 'perda', qtd: 99 })).status, 400); assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 35);
  await ir({ tipo: 'ajuste', contagem: 0 });
  assert.strictEqual(db._dados.get('produtos/tomate').ativo, false);
  assert.strictEqual((await ir({ tipo: 'venda', qtd: 1 })).status, 400);
  assert.strictEqual((await chamar(api, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'movimentar', produtoId: '../loja/config', tipo: 'compra', qtd: 1 } })).status, 400);
});
teste('estoque: só a equipe certa da PRÓPRIA loja movimenta', async () => {
  const db = criarBancoP(sementeEstoque()); const api = carregarApi(raiz('api/estoque.js'), criarAdmin(db, TOKENS_E));
  const ir = (token, loja) => chamar(api, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(loja ? { 'X-Loja': loja } : {}) }, body: { acao: 'movimentar', produtoId: 'tomate', tipo: 'compra', qtd: 1 } });
  assert.strictEqual((await ir(null)).status, 401);
  assert.strictEqual((await ir('cliente')).status, 403);
  assert.strictEqual((await ir('dono-espetinhos')).status, 403, 'dono de outra loja na loja original');
  assert.strictEqual((await ir('dona-banca', 'espetinhos')).status, 403);
  assert.strictEqual((await ir('caixa-espetinhos', 'espetinhos')).status, 403, 'caixa não mexe no estoque');
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 11); assert.strictEqual(db._dados.get('tenants/espetinhos/produtos/tomate').estoqueFisico, 50);
  assert.strictEqual((await ir('estoquista-espetinhos', 'espetinhos')).status, 200);
  assert.strictEqual(db._dados.get('tenants/espetinhos/produtos/tomate').estoqueFisico, 51);
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 11, 'a loja original não mudou');
  assert.strictEqual(movs(db, 'tenants/espetinhos/').length, 1); assert.strictEqual(movs(db).length, 0);
});
teste('estoque: venda baixa e registra; cancelamento devolve e registra', async () => {
  const db = criarBancoP(sementeEstoque()); const adm = criarAdmin(db, TOKENS_E);
  const checkout = carregarApi(raiz('api/checkout.js'), adm);
  const p = pedido({ itens: [{ id: 'ovos', qtd: 3, tipo: 'un' }] });
  const r = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 7);
  let m = movs(db); assert.strictEqual(m.length, 1); assert.strictEqual(m[0].tipo, 'venda'); assert.strictEqual(m[0].qtd, -3); assert.strictEqual(m[0].pedidoId, p.idempotencyKey);
  const demais = await chamar(checkout, { headers: ip(), body: pedido({ itens: [{ id: 'ovos', qtd: 8, tipo: 'un' }] }) });
  assert.strictEqual(demais.status, 400, 'não vende mais do que tem'); assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 7);
  const cancelar = carregarApi(raiz('api/cancelar-pedido.js'), adm);
  const c = await chamar(cancelar, { headers: { Authorization: 'Bearer cliente' }, body: { pedidoId: p.idempotencyKey } });
  assert.strictEqual(c.status, 200, JSON.stringify(c.corpo));
  assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 10);
  m = movs(db); assert.strictEqual(m.length, 2); assert.ok(m.some((x) => x.tipo === 'cancelamento' && x.qtd === 3 && x.saldo === 10));
});
teste('estoque: sugestão de compra (mínimo, ideal e previsão do motor)', async () => {
  const L = await import(raiz('js/estoque-lib.js'));
  assert.strictEqual(L.sugestaoCompra({ atual: 11, min: 15, ideal: 35, unidade: 'kg' }).comprar, 24, 'o exemplo do pedido: 11, 15, 35 → 24');
  assert.strictEqual(L.sugestaoCompra({ atual: 20, min: 15, ideal: 35, unidade: 'kg' }).comprar, 0, 'acima do mínimo não compra');
  assert.strictEqual(L.sugestaoCompra({ atual: 20, min: 15, ideal: 35, previsto: 28.2, unidade: 'kg' }).comprar, 15, 'abaixo da previsão: compra até o ideal');
  const r = L.sugestaoCompra({ atual: 11, min: 15, ideal: 35, previsto: 41.2, unidade: 'kg' });
  assert.strictEqual(r.comprar, 30.5); assert.match(r.motivo, /previsão/);
  assert.strictEqual(L.sugestaoCompra({ atual: 3, min: 10, ideal: 24.5, unidade: 'un' }).comprar, 22, 'unidade arredonda para cima, inteiro');
  assert.strictEqual(L.sugestaoCompra({ atual: null, min: 10, ideal: 20 }).comprar, 0, 'sem controle não sugere');
  assert.strictEqual(L.sugestaoCompra({ atual: 4, min: 10, unidade: 'un' }).comprar, 6, 'sem ideal: até o mínimo');
  assert.strictEqual(L.situacao({ estoqueFisico: 0, estoqueMin: 5 }), 'zerado'); assert.strictEqual(L.situacao({ estoqueFisico: 3, estoqueMin: 5 }), 'baixo');
  assert.strictEqual(L.situacao({ estoqueFisico: 9, estoqueMin: 5, estoqueMax: 8 }), 'sobrando'); assert.strictEqual(L.situacao({}), 'sem-controle');
});

// ------------------------------------------------------------------ ficha técnica e produção
// Molho de tomate (o exemplo do pedido): 1 kg tomate, 150 g cebola, 20 ml azeite, 10 g alho, 5 g sal → rende 4 potes
const sementeMolho = () => ({ ...semente(),
  'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', cat: 'legumes', ativo: true, estoqueFisico: 11, custo: 4 },
  'produtos/cebola': { nome: 'Cebola', preco: 6, unidade: 'kg', cat: 'legumes', ativo: true, estoqueFisico: 2, custo: 3 },
  'produtos/azeite': { nome: 'Azeite', preco: 0, unidade: 'l', cat: 'insumos', ativo: true, soInsumo: true, estoqueFisico: 1, custo: 40 },
  'produtos/alho': { nome: 'Alho', preco: 30, unidade: 'kg', cat: 'legumes', ativo: true, custo: 20 },          // sem estoque controlado
  'produtos/sal': { nome: 'Sal', preco: 0, unidade: 'kg', cat: 'insumos', ativo: true, soInsumo: true, estoqueFisico: 1, custo: 2 },
  'produtos/molho': { nome: 'Molho de tomate 350 g', preco: 18, unidade: 'un', cat: 'artesanais', ativo: true,
    ficha: { rende: 4, validadeDias: 30, itens: [{ id: 'tomate', qtd: 1 }, { id: 'cebola', qtd: 0.15 }, { id: 'azeite', qtd: 0.02 }, { id: 'alho', qtd: 0.01 }, { id: 'sal', qtd: 0.005 }] } },
});
teste('ficha técnica: custo da receita e por unidade, igual no servidor e no painel', async () => {
  const E = require(raiz('lib/estoque')), L = await import(raiz('js/estoque-lib.js'));
  const dados = sementeMolho(), mapa = new Map(Object.entries(dados).filter(([k]) => k.startsWith('produtos/')).map(([k, v]) => [k.slice(9), v]));
  const s = E.custoDaFicha(dados['produtos/molho'].ficha, mapa), c = L.custoDaFicha(dados['produtos/molho'].ficha, mapa);
  // 1×4 + 0,15×3 + 0,02×40 + 0,01×20 + 0,005×2 = 4 + 0,45 + 0,80 + 0,20 + 0,01 = 5,46
  assert.strictEqual(s.total, 5.46); assert.strictEqual(s.porUnidade, 1.37); assert.strictEqual(s.completo, true);
  assert.deepStrictEqual({ t: c.total, u: c.porUnidade, v: c.valida }, { t: s.total, u: s.porUnidade, v: s.valida });
  const m = L.margem(18, s.porUnidade); assert.strictEqual(m.lucro, 16.63); assert.ok(Math.abs(m.pct - 0.9239) < 0.001);
  assert.strictEqual(L.paraEstoque(150, 0.001), 0.15, '150 g de cebola = 0,15 kg');
  assert.strictEqual(E.custoDaFicha({ rende: 0, itens: [{ id: 'tomate', qtd: 1 }] }, mapa).valida, false);
  assert.strictEqual(E.custoDaFicha({ rende: 4, itens: [{ id: 'nao-existe', qtd: 1 }] }, mapa).valida, false);
  mapa.get('sal').custo = null; assert.strictEqual(E.custoDaFicha(dados['produtos/molho'].ficha, mapa).completo, false, 'ingrediente sem custo: custo incompleto');
});
teste('produção: baixa ingredientes, soma o produto, grava lote, validade e custo', async () => {
  const db = criarBancoP(sementeMolho()); const api = carregarApi(raiz('api/estoque.js'), criarAdmin(db, TOKENS_E));
  const produzir = (unidades, chave) => chamar(api, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'produzir', produtoId: 'molho', unidades, chave } });
  const r = await produzir(20, 'producao-0001');
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  const g = (id) => db._dados.get(`produtos/${id}`);
  assert.strictEqual(g('molho').estoqueFisico, 20); assert.strictEqual(db._dados.get('produtos_custos/molho').custo, 1.37);
  assert.ok(g('molho').custo === undefined && g('molho').ficha === undefined, 'custo e receita não vazam para o produto público');
  assert.strictEqual(g('tomate').estoqueFisico, 6, '20 potes = 5 receitas = 5 kg de tomate');
  assert.strictEqual(g('cebola').estoqueFisico, 1.25); assert.strictEqual(g('azeite').estoqueFisico, 0.9); assert.strictEqual(g('sal').estoqueFisico, 0.975);
  assert.strictEqual(g('alho').estoqueFisico, undefined, 'ingrediente sem controle não ganha estoque negativo');
  assert.match(r.corpo.lote, /^\d{6}-01$/); assert.strictEqual(r.corpo.custoTotal, 27.4); assert.strictEqual(r.corpo.ingredientes.length, 5);
  const fab = new Date(`${r.corpo.fabricadoEm}T12:00:00Z`), val = new Date(`${r.corpo.validade}T12:00:00Z`);
  assert.strictEqual(Math.round((val - fab) / 86400000), 30);
  const m = movs(db); assert.strictEqual(m.length, 5, '4 ingredientes controlados + o produto pronto');
  assert.ok(m.some((x) => x.produtoId === 'molho' && x.qtd === 20 && x.tipo === 'producao'));
  // toque repetido não produz de novo; nova produção no mesmo dia ganha o lote -02
  assert.strictEqual((await produzir(20, 'producao-0001')).corpo.repetido, true); assert.strictEqual(g('molho').estoqueFisico, 20);
  assert.match((await produzir(4, 'producao-0002')).corpo.lote, /-02$/);
  const resumo = [...db._dados.entries()].find(([k]) => k.startsWith('estoque_resumo/'))[1];
  assert.strictEqual(resumo.p.molho.entrou, 24); assert.strictEqual(resumo.p.tomate.usou, 6);
});
teste('produção: faltando ingrediente nada é gravado e a mensagem diz o que falta', async () => {
  const db = criarBancoP(sementeMolho()); const api = carregarApi(raiz('api/estoque.js'), criarAdmin(db, TOKENS_E));
  const ir = (body, token = 'dona-banca', loja) => chamar(api, { headers: { Authorization: `Bearer ${token}`, ...(loja ? { 'X-Loja': loja } : {}) }, body: { acao: 'produzir', produtoId: 'molho', chave: 'producao-000' + Math.random().toString(36).slice(2, 6), ...body } });
  const r = await ir({ unidades: 80 });            // 80 potes = 20 kg de tomate (tem 11) e 3 kg de cebola (tem 2)
  assert.strictEqual(r.status, 400); assert.match(r.corpo.error, /Tomate/); assert.match(r.corpo.error, /Cebola/);
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 11); assert.strictEqual(db._dados.get('produtos/molho').estoqueFisico, undefined); assert.strictEqual(movs(db).length, 0);
  for (const ruim of [0, -5, 2.5, 'dez', 99999]) assert.strictEqual((await ir({ unidades: ruim })).status, 400, String(ruim));
  assert.strictEqual((await ir({ unidades: 4, produtoId: 'tomate' })).status, 400, 'produto sem ficha');
  assert.strictEqual((await ir({ unidades: 4 }, 'dono-espetinhos')).status, 403, 'dono de outra loja não produz aqui');
  assert.strictEqual((await ir({ unidades: 4 }, 'caixa-espetinhos', 'espetinhos')).status, 403);
});
teste('loja: ingrediente de receita não pode ser comprado pelo cliente', async () => {
  const db = criarBancoP(sementeMolho()); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const r = await chamar(api, { headers: ip(), body: pedido({ itens: [{ id: 'azeite', qtd: 1, tipo: 'un' }] }) });
  assert.strictEqual(r.status, 400); assert.match(r.corpo.error, /não está à venda/);
});

// ------------------------------------------------------------------ desperdício e margens
teste('desperdício: taxa de perda e folga na compra', async () => {
  const L = await import(raiz('js/estoque-lib.js'));
  const t = L.taxasDePerda([{ p: { tomate: { entrou: 60, perdeu: 5.22, perdeuValor: 20.88 }, alface: { entrou: 40 } } }, { p: { tomate: { entrou: 40, perdeu: 3.48, perdeuValor: 13.92 }, ovo: { perdeu: 2 } } }]);
  assert.ok(Math.abs(t.tomate.taxa - 0.087) < 1e-9, 'tomate: 8,7 ÷ 100 = 8,7%'); assert.strictEqual(t.tomate.valor, 34.8);
  assert.strictEqual(t.alface, undefined, 'sem perda não aparece'); assert.strictEqual(t.ovo.taxa, null, 'perda sem entrada registrada: sem taxa');
  assert.strictEqual(L.comFolgaDePerda(24, 0.087, 'kg'), 26.5, '24 ÷ (1 − 0,087) = 26,3 → 26,5 kg');
  assert.strictEqual(L.comFolgaDePerda(24, 0.01, 'kg'), 24, 'perda abaixo de 2% não muda a compra');
  assert.strictEqual(L.comFolgaDePerda(10, 0.9, 'un'), 15, 'folga limitada a 30%');
  assert.strictEqual(L.comFolgaDePerda(0, 0.2, 'un'), 0);
});
teste('margens: mais vendido e mais lucrativo são listas diferentes; prejuízo e sem custo aparecem', async () => {
  const M = await import(raiz('js/margens-lib.js'));
  const produtos = [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', custo: 7 }, { id: 'molho', nome: 'Molho', unidade: 'un', custo: 1.37 }, { id: 'banana', nome: 'Banana', unidade: 'kg', custo: 8 }, { id: 'ovos', nome: 'Ovos', unidade: 'un' }];
  const pedidos = [
    { status: 'arquivado', total: 107, itens: [{ id: 'tomate', qtd: 10, preco: 8.9, subtotal: 89 }, { id: 'molho', qtd: 1, preco: 18, subtotal: 18 }] },
    { status: 'pendente', total: 62.9, itens: [{ id: 'molho', qtd: 2, preco: 18, subtotal: 36 }, { id: 'banana', qtd: 3, aPesar: false, pesoFinal: 0.4, precoOriginal: 6.9, subtotal: 2.76 }, { id: 'ovos', qtd: 2, preco: 14, subtotal: 28 }, { id: 'banana', qtd: 5, aPesar: true, precoOriginal: 6.9, subtotal: 0 }] },
    { status: 'cancelado', total: 999, itens: [{ id: 'molho', qtd: 50, preco: 18, subtotal: 900 }] },
  ];
  const r = M.resumoMargens(pedidos, produtos);
  assert.strictEqual(r.nPedidos, 2, 'cancelado fica de fora'); assert.strictEqual(r.faturamento, 169.9); assert.strictEqual(r.ticketMedio, 84.95);
  assert.strictEqual(r.maisVendidos[0].id, 'tomate', 'tomate traz mais dinheiro (R$ 89)');
  assert.strictEqual(r.maisLucrativos[0].id, 'molho', 'mas o molho deixa mais lucro');
  assert.strictEqual(r.maisLucrativos[0].lucro, 49.89, '54 − 3 × 1,37'); assert.strictEqual(r.maisVendidos[0].lucro, 19, '89 − 10 × 7');
  assert.deepStrictEqual(r.prejuizo.map((l) => l.id), ['banana'], 'banana vendida a 6,90 com custo 8'); assert.strictEqual(r.prejuizo[0].qtd, 0.4, 'usa o peso da balança; item ainda a pesar não conta');
  assert.deepStrictEqual(r.semCusto.map((l) => l.id), ['ovos']);
  assert.strictEqual(r.lucroEstimado, 68.45, '19 + 49,89 − 0,44'); assert.ok(r.coberturaCusto < 1);
  assert.strictEqual(M.resumoMargens([], produtos).lucroEstimado, null);
});

// ------------------------------------------------------------------ lista de compras
teste('compras: junta mínimo/ideal, previsão, prazo, perda, produção e fechamento', async () => {
  const C = await import(raiz('js/compras-lib.js')), L = await import(raiz('js/estoque-lib.js'));
  const produtos = [
    { id: 'tomate', nome: 'Tomate', unidade: 'kg', estoqueFisico: 11, estoqueMin: 15, estoqueIdeal: 35, custo: 4 },
    { id: 'cebola', nome: 'Cebola', unidade: 'kg', estoqueFisico: 2, estoqueMin: 1, estoqueIdeal: 5, custo: 3 },
    { id: 'azeite', nome: 'Azeite', unidade: 'l', estoqueFisico: 1, soInsumo: true, custo: 40 },
    { id: 'alho', nome: 'Alho', unidade: 'kg', custo: 20 },                                   // sem estoque controlado
    { id: 'alface', nome: 'Alface', unidade: 'maço', estoqueFisico: 30, estoqueMin: 8, estoqueIdeal: 20 },
    { id: 'banana', nome: 'Banana', unidade: 'kg', estoqueFisico: 20, estoqueMin: 10, estoqueIdeal: 30, prazoDias: 2, custo: 5 },
    { id: 'couve', nome: 'Couve', unidade: 'maço' },                                          // sem controle, acabou no fechamento
    { id: 'molho', nome: 'Molho', unidade: 'un', preco: 18, estoqueFisico: 3, estoqueMin: 6, estoqueIdeal: 23,
      ficha: { rende: 4, itens: [{ id: 'tomate', qtd: 1 }, { id: 'cebola', qtd: 0.15 }, { id: 'azeite', qtd: 0.02 }, { id: 'alho', qtd: 0.01 }] } },
  ];
  const r = C.listaDeCompras({ produtos, previsto: { banana: { alvo: 18, vende: 14 }, couve: { alvo: 11.2, vende: 9 } }, perdas: { tomate: { taxa: 0.087 } }, acabou: ['couve', 'alface'] });
  const de = (id) => r.comprar.find((l) => l.id === id);
  assert.deepStrictEqual(r.produzir.map((l) => [l.id, l.qtd]), [['molho', 20]], 'molho: tem 3, mínimo 6, ideal 23 → produzir 20');
  // 20 potes = 5 receitas → 5 kg de tomate, 0,75 kg de cebola, 0,1 l de azeite, 0,05 kg de alho
  assert.strictEqual(de('tomate').qtd, 32, 'sobra 11 − 5 = 6 → até 35 = 29 → com 8,7% de perda = 31,8 → 32');
  assert.match(de('tomate').motivo, /perda/); assert.match(de('tomate').motivo, /produção/); assert.strictEqual(de('tomate').custo, 128);
  assert.strictEqual(de('cebola'), undefined, 'cebola: sobra 1,25, acima do mínimo 1');
  assert.strictEqual(de('azeite'), undefined, 'azeite: tem 1 l, usa 0,1');
  assert.strictEqual(de('alho').qtd, 0.5, 'sem controle, mas a produção precisa: compra o que vai usar (arredondado)');
  assert.strictEqual(de('alface'), undefined, 'acima do mínimo; "acabou" só vale para quem não tem estoque controlado');
  assert.strictEqual(de('banana').qtd, 10, 'previsão 18 + 2 dias de prazo (14 ÷ 7 × 2 = 4) = 22 > 20 em estoque → compra até o ideal 30');
  assert.deepStrictEqual(r.conferir.map((l) => [l.id, l.qtd]), [['couve', 12]]);
  assert.strictEqual(r.total, 188, '128 + 10 de alho + 50 de banana');
  const txt = C.textoDaLista(r, 'segunda', L.fmtQtd); assert.match(txt, /☐ Tomate: 32 kg/); assert.match(txt, /Molho: 20 un/);
  const vazio = C.listaDeCompras({ produtos: [{ id: 'x', nome: 'X', unidade: 'un' }] }); assert.strictEqual(vazio.comprar.length + vazio.produzir.length + vazio.conferir.length, 0);
});

// ------------------------------------------------------------------ balcão (PDV) e pesagem
const TOKENS_P = { ...TOKENS_E, 'func-banca': { uid: 'u6', email: 'ana@banca', tenants: { banca: 'funcionario' } } };
teste('balcão: venda usa o preço do cadastro, baixa estoque (inclusive por quilo) e entra no caixa', async () => {
  const db = criarBancoP(sementeEstoque()); const api = carregarApi(raiz('api/pdv.js'), criarAdmin(db, TOKENS_P));
  const vender = (body, token = 'func-banca', loja) => chamar(api, { headers: { Authorization: `Bearer ${token}`, ...(loja ? { 'X-Loja': loja } : {}) }, body: { acao: 'venda', pag: 'Dinheiro', chave: 'venda-' + Math.random().toString(36).slice(2, 10), ...body } });
  const r = await vender({ chave: 'venda-00000001', itens: [{ id: 'tomate', qtd: 1.25, preco: 0.01 }, { id: 'ovos', qtd: 2 }], cliente: { nome: 'Dona Lia', condominio: 'Jardins Munique', quadra: '5', lote: '3' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.strictEqual(r.corpo.total, 39.13, '1,25 × 8,90 = 11,125 → 11,13; + 2 × 14');
  const ped = db._dados.get('pedidos/venda-00000001');
  assert.strictEqual(ped.origem, 'balcao'); assert.strictEqual(ped.status, 'arquivado'); assert.strictEqual(ped.nome, 'Dona Lia'); assert.strictEqual(ped.vendedor, 'ana@banca');
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 9.75); assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 8);
  assert.strictEqual(movs(db).filter((m) => m.tipo === 'venda').length, 2);
  assert.strictEqual(db._dados.get('analytics/dashboard').receitaTotal, 39.13);
  assert.strictEqual((await vender({ chave: 'venda-00000001', itens: [{ id: 'ovos', qtd: 2 }] })).corpo.repetido, true, 'toque repetido não vende de novo');
  assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 8);
  // o motor de demanda enxerga a venda de balcão como qualquer outra
  const N = require(raiz('analytics/normalize')), n = N.normalizarPedidos([ped], [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', preco: 8.9 }, { id: 'ovos', nome: 'Ovos', unidade: 'un', preco: 14 }]);
  assert.strictEqual(n.nPedidos, 1); assert.strictEqual([...n.vendasDia.get('tomate').values()][0], 1.25);
});
teste('balcão: vender mais do que o sistema tinha não trava a venda; entradas inválidas são recusadas', async () => {
  const db = criarBancoP(sementeEstoque()); const api = carregarApi(raiz('api/pdv.js'), criarAdmin(db, TOKENS_P));
  const vender = (body, token = 'func-banca', loja) => chamar(api, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(loja ? { 'X-Loja': loja } : {}) }, body: { acao: 'venda', pag: 'PIX', chave: 'venda-' + Math.random().toString(36).slice(2, 10), itens: [{ id: 'ovos', qtd: 1 }], ...body } });
  const r = await vender({ itens: [{ id: 'ovos', qtd: 12 }] });
  assert.strictEqual(r.status, 200); assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 0);
  assert.strictEqual(movs(db)[0].qtd, -10, 'o histórico registra o que saiu de fato do saldo'); assert.match(movs(db)[0].obs, /sistema tinha 10/);
  for (const itens of [[], [{ id: 'ovos', qtd: 0 }], [{ id: 'ovos', qtd: -1 }], [{ id: 'ovos', qtd: 1.5 }], [{ id: 'ovos', qtd: 'x' }], [{ id: 'nao-existe', qtd: 1 }], [{ id: '../x', qtd: 1 }], [{ id: 'ovos', qtd: 1 }, { id: 'ovos', qtd: 1 }]]) assert.strictEqual((await vender({ itens })).status, 400, JSON.stringify(itens));
  assert.strictEqual((await vender({ pag: 'Fiado' })).status, 400);
  assert.strictEqual((await vender({}, null)).status, 401);
  assert.strictEqual((await vender({}, 'cliente')).status, 403);
  assert.strictEqual((await vender({}, 'func-banca', 'espetinhos')).status, 403, 'funcionária da banca não vende nos espetinhos');
  assert.strictEqual((await vender({}, 'estoquista-espetinhos', 'espetinhos')).status, 403, 'estoquista não opera o caixa');
  assert.strictEqual((await vender({ itens: [{ id: 'tomate', qtd: 2 }] }, 'caixa-espetinhos', 'espetinhos')).status, 200);
  assert.strictEqual(db._dados.get('tenants/espetinhos/produtos/tomate').estoqueFisico, 48); assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 11);
});
teste('pesagem: calcula pelo peso, MANTÉM o cupom, baixa o estoque por quilo e não baixa duas vezes', async () => {
  const db = criarBancoP({ ...sementeEstoque(), 'cupons/BANCA10': { ativo: true, valorFixo: 5 } }); const adm = criarAdmin(db, TOKENS_P);
  const checkout = carregarApi(raiz('api/checkout.js'), adm);
  const p = pedido({ cupom: 'BANCA10', itens: [{ id: 'tomate', qtd: 4, tipo: 'un' }, { id: 'ovos', qtd: 1, tipo: 'un' }] });
  const c = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p });
  assert.strictEqual(c.status, 200, JSON.stringify(c.corpo)); assert.strictEqual(c.corpo.pedido.total, 9, 'ovos 14 − cupom 5; o tomate ainda vai pesar');
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 11, 'a pesar: ainda não baixou');
  const api = carregarApi(raiz('api/pdv.js'), adm);
  const pesar = (pesos, token = 'func-banca') => chamar(api, { headers: { Authorization: `Bearer ${token}` }, body: { acao: 'pesagem', pedidoId: p.idempotencyKey, pesos } });
  assert.strictEqual((await pesar([])).status, 400, 'sem o peso não fecha');
  const r = await pesar([{ i: 0, peso: 0.62 }]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.strictEqual(r.corpo.total, 14.52, '0,62 × 8,90 = 5,52; + 14 − 5 de cupom'); assert.strictEqual(r.corpo.desconto, 5);
  const ped = db._dados.get(`pedidos/${p.idempotencyKey}`);
  assert.strictEqual(ped.status, 'preparando'); assert.strictEqual(ped.temItensAPesar, false); assert.strictEqual(ped.itens[0].subtotal, 5.52);
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 10.38);
  assert.strictEqual(db._dados.get('analytics/dashboard').receitaTotal, 14.52, 'caixa: 9 do pedido + 5,52 da pesagem');
  await pesar([{ i: 0, peso: 0.7 }]);              // corrigiu o peso: baixa só a diferença
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 10.3); assert.strictEqual(db._dados.get(`pedidos/${p.idempotencyKey}`).total, 15.23);
  await pesar([]);                                  // salvar de novo sem mudar nada não baixa outra vez
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 10.3);
  assert.strictEqual((await pesar([{ i: 0, peso: 1 }], 'cliente')).status, 403, 'cliente não muda o valor do próprio pedido');
  assert.strictEqual((await pesar([{ i: 0, peso: 1 }], 'dono-espetinhos')).status, 403);
  // cancelar pelo painel, depois da pesagem: devolve os quilos pesados e os ovos, e tira a venda do caixa
  const cancelar = carregarApi(raiz('api/cancelar-pedido.js'), adm);
  const canc = (token) => chamar(cancelar, { headers: { Authorization: `Bearer ${token}` }, body: { pedidoId: p.idempotencyKey } });
  assert.notStrictEqual((await canc('cliente')).status, 200, 'cliente não cancela depois que a loja começou a preparar');
  assert.notStrictEqual((await canc('dono-espetinhos')).status, 200, 'gente de outra loja não cancela');
  const ovosAntes = db._dados.get('produtos/ovos').estoqueFisico;
  const ok = await canc('func-banca'); assert.strictEqual(ok.status, 200, JSON.stringify(ok.corpo));
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 11, 'voltou o que foi pesado');
  assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, ovosAntes + 1);
  const cancelado = db._dados.get(`pedidos/${p.idempotencyKey}`);
  assert.strictEqual(cancelado.status, 'cancelado'); assert.strictEqual(cancelado.canceladoPor, 'loja');
  assert.ok(Math.abs(db._dados.get('analytics/dashboard').receitaTotal) < 0.001, 'o caixa voltou a zero');
  assert.strictEqual((await canc('func-banca')).corpo.jaEstava, true, 'cancelar de novo não devolve em dobro');
  assert.strictEqual(db._dados.get('produtos/tomate').estoqueFisico, 11);
});

// ------------------------------------------------------------------ clientes (CRM)
teste('clientes: segmentos, filtro por produto e regra para mandar mensagem', async () => {
  const C = await import(raiz('js/crm-lib.js')), hoje = '2026-10-05';
  const cli = (id, extra) => ({ id, nome: id, n: 1, ult: hoje, pri: hoje, gasto: 50, ...extra });
  const base = [
    cli('nova', { ult: '2026-10-01', pri: '2026-10-01' }),
    cli('fiel', { n: 12, ult: '2026-10-01', pri: '2026-05-01', cada: 7, gasto: 900, tp: ['tomate', 'molho'], tel: '62999990001', oferta: true }),
    cli('atrasada', { n: 6, ult: '2026-09-15', pri: '2026-05-01', cada: 7, gasto: 300, tp: ['tomate'] }),
    cli('sumida', { n: 5, ult: '2026-08-20', pri: '2026-04-01', cada: 10, gasto: 400, tel: '62999990002', oferta: true }),
    cli('umavez', { ult: '2026-07-01', pri: '2026-07-01' }),
    cli('media1', { n: 3, ult: '2026-10-02', pri: '2026-06-01', cada: 14, gasto: 120 }), cli('media2', { n: 2, ult: '2026-10-03', pri: '2026-08-01', gasto: 80 }),
  ];
  const s = C.segmentar(base, hoje), de = (id) => s.lista.find((c) => c.id === id).seg;
  assert.deepStrictEqual(de('nova'), ['novos']); assert.deepStrictEqual(de('fiel'), ['recorrentes', 'altoValor'], 'maior gasto entre os 5 com 2+ compras');
  assert.deepStrictEqual(de('atrasada'), ['atrasados'], '20 dias sem comprar, costuma a cada 7'); assert.deepStrictEqual(de('sumida'), ['inativos']); assert.deepStrictEqual(de('umavez'), ['inativos']);
  assert.deepStrictEqual(s.contagem, { todos: 7, novos: 1, recorrentes: 2, atrasados: 1, inativos: 2, altoValor: 1 });
  assert.deepStrictEqual(C.filtrar(s, { produtoId: 'tomate' }).map((c) => c.id), ['fiel', 'atrasada']);
  assert.deepStrictEqual(C.filtrar(s, { segmento: 'inativos' }).map((c) => c.id), ['umavez', 'sumida'], 'quem sumiu há mais tempo primeiro');
  const agora = Date.parse('2026-10-05T15:00:00Z'), fiel = s.lista.find((c) => c.id === 'fiel');
  assert.strictEqual(C.podeContatar(fiel, null, agora).pode, true);
  assert.strictEqual(C.podeContatar(s.lista.find((c) => c.id === 'atrasada'), null, agora).pode, false, 'não aceitou ofertas: sem mensagem');
  assert.match(C.podeContatar(fiel, '2026-10-02T12:00:00Z', agora).motivo, /há 3 dia/, 'já recebeu há 3 dias: espera');
  assert.strictEqual(C.podeContatar(fiel, '2026-09-15T12:00:00Z', agora).pode, true);
  assert.match(C.mensagemSugerida(s.lista.find((c) => c.id === 'sumida'), 'Banca'), /Faz um tempinho/);
});
teste('clientes: o motor guarda gasto e ticket, e só entrega telefone de quem aceitou ofertas', () => {
  const { executarMotor } = require(raiz('analytics/engine'));
  const it = [{ id: 'b', nome: 'B', qtd: 1, unidade: 'un', preco: 10 }], d = (n) => new Date(Date.UTC(2026, 8, n, 15)).toISOString();
  const ped = (id, dia, nome, lote, total, extra) => ({ id, data: d(dia), nome, quadra: '1', lote, condominio: 'Jardins', total, telefone: '6299999000' + lote, itens: it, ...extra });
  const r = executarMotor({ pedidos: [ped('1', 1, 'Ana', '1', 40, { aceitaOfertas: true }), ped('2', 8, 'Ana', '1', 60, { aceitaOfertas: true }), ped('3', 2, 'Bia', '2', 30), ped('4', 9, 'Caio', '3', 20, { aceitaOfertas: true }), ped('5', 16, 'Caio', '3', 20, { aceitaOfertas: false })],
    catalogo: [{ id: 'b', nome: 'B', unidade: 'un', preco: 10, ativo: true }], agregados: [], parametros: {}, eventos: [], snapshots: [], agora: Date.UTC(2026, 8, 20, 15) });
  const de = (nome) => r.indiceClientes.find((c) => c.nome === nome);
  assert.strictEqual(de('Ana').gasto, 100); assert.strictEqual(de('Ana').ticket, 50); assert.strictEqual(de('Ana').ped, 2); assert.deepStrictEqual(de('Ana').tp, ['b']);
  assert.strictEqual(de('Ana').tel, '62999990001'); assert.strictEqual(de('Bia').tel, '', 'não marcou: telefone não sai do motor'); assert.strictEqual(de('Bia').oferta, false);
  assert.strictEqual(de('Caio').tel, '', 'desmarcou no pedido mais recente: deixa de valer');
});

// ------------------------------------------------------------------ copiloto de IA
teste('copiloto: a sugestão de compra do servidor é igual à do painel', async () => {
  const C = require(raiz('lib/copiloto')), L = await import(raiz('js/estoque-lib.js'));
  for (const c of [{ atual: 11, min: 15, ideal: 35, unidade: 'kg' }, { atual: 20, min: 15, ideal: 35, unidade: 'kg' }, { atual: 20, min: 15, ideal: 35, previsto: 28.2, unidade: 'kg' }, { atual: 11, min: 15, ideal: 35, previsto: 41.2, unidade: 'kg' }, { atual: 3, min: 10, ideal: 24.5, unidade: 'un' }, { atual: null, min: 10, ideal: 20 }, { atual: 4, min: 10, unidade: 'un' }, { atual: 0, min: '', ideal: '', previsto: 7.3, unidade: 'maço' }])
    assert.strictEqual(C.necessidade(c), L.sugestaoCompra(c).comprar, JSON.stringify(c));
});
teste('copiloto: o resumo traz margem, lucro, vendas e compra; produto mais vendido ≠ mais lucrativo', () => {
  const C = require(raiz('lib/copiloto')), agora = Date.parse('2026-10-05T15:00:00Z');
  const r = C.resumir({ loja: 'Banca', agora,
    produtos: [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', preco: 8.9, custo: 7, estoqueFisico: 11, estoqueMin: 15, estoqueIdeal: 35 }, { id: 'molho', nome: 'Molho', unidade: 'un', preco: 18, custo: 1.37, estoqueFisico: 3, ficha: { rende: 4, itens: [] } }, { id: 'ovos', nome: 'Ovos', unidade: 'un', preco: 14 }],
    vendasDia: [{ dia: '2026-10-03', produtos: { tomate: 30, molho: 10 } }, { dia: '2026-09-25', produtos: { tomate: 20 } }, { dia: '2026-10-05', produtos: { tomate: 99 } }, { dia: '2026-08-01', produtos: { tomate: 500 } }],
    resumos: [{ dia: '2026-10-03', receita: 447, pedidos: 9 }, { dia: '2026-09-25', receita: 178, pedidos: 4 }],
    perdas: [{ p: { tomate: { entrou: 100, perdeu: 8.7, perdeuValor: 60.9 } } }], painel: { meta: { geradoEm: 'x' }, indiceClientes: [{ ult: '2026-10-01', pri: '2026-09-20' }, { ult: '2026-08-01', pri: '2026-05-01' }] }, previsoes: {} });
  const de = (n) => r.produtos.find((p) => p.nome === n);
  assert.strictEqual(de('Tomate').vendeu28d, 50, 'hoje (dia incompleto) e venda antiga ficam de fora'); assert.strictEqual(de('Tomate').vendeu7d, 30); assert.strictEqual(de('Tomate').vendeu7dAntes, 20, '25/09 cai nos 7 dias anteriores');
  assert.strictEqual(de('Tomate').receita28d, 445); assert.strictEqual(de('Tomate').lucro28d, 95); assert.strictEqual(de('Molho').lucro28d, 166.3);
  assert.ok(de('Tomate').receita28d > de('Molho').receita28d && de('Molho').lucro28d > de('Tomate').lucro28d);
  assert.strictEqual(de('Tomate').comprar, 24); assert.strictEqual(de('Tomate').perdaPct, 8.7); assert.strictEqual(de('Ovos').custo, undefined); assert.strictEqual(de('Molho').produzidoAqui, true);
  assert.deepStrictEqual(r.faturamento.ultimos7dias, { receita: 447, pedidos: 9 }); assert.strictEqual(r.faturamento.melhorDia28d.dia, '2026-10-03'); assert.strictEqual(r.faturamento.melhorDia28d.semana, 'sábado');
  assert.deepStrictEqual(r.clientes, { total: 2, novos30d: 1, semComprarHaMaisDe30d: 1 });
  assert.match(C.resumir({ produtos: [{ id: 'x', nome: 'X', preco: 1 }], agora }).avisos.join(' '), /custo cadastrado/);
});
teste('copiloto: a IA recebe SÓ os dados da loja de quem pergunta, e só gestores perguntam', async () => {
  const db = criarBancoP({ ...sementeMolho(), 'tenants/espetinhos/produtos/picanha': { nome: 'Espeto de picanha secreto', preco: 15, custo: 9, unidade: 'un', ativo: true } });
  process.env.GEMINI_API_KEY = 'chave-de-teste';
  const enviados = [], fetchReal = global.fetch;
  global.fetch = async (url, o) => { enviados.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Compre 24 kg de tomate.' }] } }] }) }; };
  try {
    const api = carregarApi(raiz('api/assistente.js'), criarAdmin(db, TOKENS_P));
    const perguntar = (token, loja, pergunta = 'O que preciso comprar amanhã?') => chamar(api, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(loja ? { 'X-Loja': loja } : {}), 'x-forwarded-for': '9.9.9.9' }, body: { action: 'copiloto', pergunta } });
    const r = await perguntar('dona-banca');
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.resposta, 'Compre 24 kg de tomate.');
    const texto = JSON.stringify(enviados[0]);
    assert.ok(texto.includes('Molho de tomate 350 g') && texto.includes('O que preciso comprar'), 'a pergunta e os produtos da banca vão para a IA');
    assert.ok(!texto.includes('picanha') && !texto.includes('Espeto de tomate'), 'produto de OUTRA loja não pode aparecer');
    const e = await perguntar('dono-espetinhos', 'espetinhos'); assert.strictEqual(e.status, 200);
    const textoE = JSON.stringify(enviados[1]); assert.ok(textoE.includes('picanha') && !textoE.includes('Molho de tomate 350 g'));
    const antes = enviados.length;
    assert.strictEqual((await perguntar(null)).status, 401); assert.strictEqual((await perguntar('cliente')).status, 403);
    assert.strictEqual((await perguntar('dono-espetinhos')).status, 403, 'dono de outra loja perguntando sobre a banca');
    assert.strictEqual((await perguntar('dona-banca', 'espetinhos')).status, 403); assert.strictEqual((await perguntar('func-banca')).status, 403, 'funcionária não vê dados financeiros');
    assert.strictEqual((await perguntar('dona-banca', null, 'a')).status, 400); assert.strictEqual((await perguntar('dona-banca', null, 'x'.repeat(501))).status, 400);
    assert.strictEqual(enviados.length, antes, 'nenhuma pergunta recusada chegou a gastar a IA');
    const uso = [...db._dados.entries()].find(([k]) => k.startsWith('uso_ia/')); assert.strictEqual(uso[1].copiloto, 1, 'conta o uso do dia por loja');
    process.env.COPILOTO_LIMITE_DIA = '1';
    assert.strictEqual((await perguntar('dona-banca')).status, 429, 'teto diário atingido'); assert.strictEqual(enviados.length, antes);
  } finally { global.fetch = fetchReal; delete process.env.COPILOTO_LIMITE_DIA; }
});

teste('PIX: CPF, máscara e quando o botão de pagar aparece', async () => {
  const P = await import(raiz('js/pix-lib.js'));
  assert.strictEqual(P.cpfValido('529.982.247-25'), true); assert.strictEqual(P.cpfValido('52998224725'), true);
  for (const ruim of ['529.982.247-26', '111.111.111-11', '123', '', null, '5299822472a']) assert.strictEqual(P.cpfValido(ruim), false, String(ruim));
  assert.strictEqual(P.mascararCpf('52998224725'), '529.982.247-25'); assert.strictEqual(P.mascararCpf('5299'), '529.9'); assert.strictEqual(P.mascararCpf('529982247259999'), '529.982.247-25');
  const ped = { pag: 'PIX', status: 'pendente' };
  assert.strictEqual(P.podePagarPix(true, ped), true);
  assert.strictEqual(P.podePagarPix(false, ped), false, 'loja não ligou');
  assert.strictEqual(P.podePagarPix(true, { ...ped, pag: 'Dinheiro' }), false);
  assert.strictEqual(P.podePagarPix(true, { ...ped, temItensAPesar: true }), false, 'o valor ainda muda na balança');
  assert.strictEqual(P.podePagarPix(true, { ...ped, pagamento: { status: 'PAID' } }), false);
  assert.strictEqual(P.podePagarPix(true, { ...ped, status: 'cancelado' }), false);
  assert.strictEqual(P.podePagarPix(true, { ...ped, status: 'preparando' }), true, 'depois da pesagem pode pagar');
});

teste('quantidade: o campo só aceita número (letra não entra, nem colada)', async () => {
  const Q = await import(raiz('js/quantidade-lib.js'));
  const casos = [['x', ''], ['X', ''], ['1x5', '15'], ['1,5kg', '1,5'], ['1.2.3', '1.23'], ['12,3456', '12,345'], ['abc', ''], ['-3', '3'], ['2', '2'], ['0,5', '0,5'], [',5', ',5'], ['123456', '1234'], [null, '']];
  for (const [entra, sai] of casos) assert.strictEqual(Q.limparQuantidade(entra), sai, String(entra));
  assert.strictEqual(Q.limparQuantidade('1,5', true), '15', 'por unidade não tem vírgula'); assert.strictEqual(Q.limparQuantidade('x3', true), '3');
});

// ------------------------------------------------------------------ versão nova entra sozinha
teste('versão: percebe que a página no ar mudou, ignora resposta estranha e não recarrega sem parar', async () => {
  const V = await import(raiz('js/versao-lib.js'));
  const eu = V.arquivoDaPagina(['./js/busca-voz.js', '/assets/main-B_XEcaEF.js']); assert.strictEqual(eu, '/assets/main-B_XEcaEF.js');
  assert.strictEqual(V.arquivoDaPagina(['./js/loja.js']), '', 'sem build não confere nada');
  const pagina = (arq) => `<html><head><script type="module" crossorigin src="${arq}"></script></head></html>`;
  assert.strictEqual(V.estaDesatualizada(eu, pagina('/assets/main-B_XEcaEF.js')), false, 'mesma versão');
  assert.strictEqual(V.estaDesatualizada(eu, pagina('/assets/main-D4SNZK6U.js')), true, 'saiu versão nova');
  for (const estranho of ['', '<html>Entre na rede Wi-Fi</html>', 'Internal Server Error', null]) assert.strictEqual(V.estaDesatualizada(eu, estranho), false, String(estranho));
  assert.strictEqual(V.estaDesatualizada('', pagina('/assets/main-D4SNZK6U.js')), false);
  const agora = 1e12;
  assert.strictEqual(V.podeRecarregar([], agora), true);
  assert.strictEqual(V.podeRecarregar([agora - 10000], agora), false, 'acabou de recarregar');
  assert.strictEqual(V.podeRecarregar([agora - 60000], agora), true);
  assert.strictEqual(V.podeRecarregar([agora - 60000, agora - 120000], agora), false, 'duas em 10 minutos: para');
  assert.strictEqual(V.podeRecarregar([agora - 11 * 60000, agora - 12 * 60000], agora), true, 'as antigas não contam');
  // as páginas não podem voltar para a cópia guardada no aparelho
  const cfg = require('fs').readFileSync(raiz('vite.config.js'), 'utf8');
  assert.ok(!/globPatterns:[^\n]*html/.test(cfg), 'html fora da cópia guardada'); assert.ok(cfg.includes("request.mode === 'navigate'") && cfg.includes('navigateFallback: null'));
});

// ------------------------------------------------------------------ entrega (taxa e horário)
teste('entrega: taxa calculada no servidor, grátis acima de um valor, horário conferido e pesagem reavalia', async () => {
  const Ent = require(raiz('lib/entrega')), L = await import(raiz('js/entrega-lib.js'));
  const cfg = Ent.lerConfig({ entrega: { taxa: 5, gratisAcima: 20, horarios: [' Manhã (8h às 12h) ', 'Tarde', 'Tarde', '<b>x</b>', ''] } });
  assert.deepStrictEqual(cfg, { taxaC: 500, gratisAcimaC: 2000, horarios: ['Manhã (8h às 12h)', 'Tarde', 'b x /b'] });
  assert.strictEqual(Ent.taxaC(cfg, 1999), 500); assert.strictEqual(Ent.taxaC(cfg, 2000), 0); assert.strictEqual(Ent.taxaC(Ent.lerConfig({}), 100), 0);
  assert.strictEqual(Ent.taxaC(Ent.lerConfig({ entrega: { taxa: -3 } }), 100), 0); assert.strictEqual(Ent.taxaC(Ent.lerConfig({ entrega: { taxa: 'abc' } }), 100), 0);
  assert.throws(() => Ent.horarioValido(cfg, 'Madrugada'), /horário/); assert.throws(() => Ent.horarioValido(cfg, ''), /horário/);
  assert.strictEqual(Ent.horarioValido(cfg, 'Tarde'), 'Tarde'); assert.strictEqual(Ent.horarioValido(Ent.lerConfig({}), 'qualquer coisa'), '', 'loja que não pergunta ignora o campo');
  // prévia do navegador = mesma conta
  const fmtT = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`, c2 = L.lerEntrega({ entrega: { taxa: 5, gratisAcima: 20 } });
  assert.deepStrictEqual(L.previaDaEntrega(c2, 14, fmtT), { taxa: 5, gratis: false, falta: 6, texto: 'Entrega R$ 5,00 · faltam R$ 6,00 para entrega grátis' });
  assert.strictEqual(L.previaDaEntrega(c2, 20, fmtT).texto, 'Entrega grátis'); assert.strictEqual(L.previaDaEntrega(L.lerEntrega({}), 20, fmtT).texto, '');
  assert.deepStrictEqual(L.horariosDoTexto(' Manhã \n\nTarde\nTarde\n'), ['Manhã', 'Tarde']);

  const db = criarBancoP({ ...sementeEstoque(), 'loja/config': { ...(sementeEstoque()['loja/config'] || {}), entrega: { taxa: 5, gratisAcima: 20, horarios: ['Manhã', 'Tarde'] } } }); const adm = criarAdmin(db, TOKENS_P);
  const checkout = carregarApi(raiz('api/checkout.js'), adm);
  const pedir = (extra) => chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: pedido(extra) });
  assert.strictEqual((await pedir({ itens: [{ id: 'ovos', qtd: 1, tipo: 'un' }] })).status, 400, 'sem escolher o horário');
  assert.strictEqual((await pedir({ itens: [{ id: 'ovos', qtd: 1, tipo: 'un' }], horarioEntrega: 'Madrugada' })).status, 400);
  // ovos 14: abaixo de 20 → paga 5. O navegador mandar "total" ou "taxa" não muda nada.
  let p = pedido({ itens: [{ id: 'ovos', qtd: 1, tipo: 'un' }], horarioEntrega: 'Tarde', taxaEntrega: 0, entrega: { taxa: 0 } });
  let r = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.pedido.total, 19);
  let g = db._dados.get(`pedidos/${p.idempotencyKey}`); assert.deepStrictEqual(g.entrega, { taxa: 5, taxaCheia: 5, gratisAcima: 20, horario: 'Tarde' });
  assert.ok(decodeURIComponent(r.corpo.pedido.whatsappMsg).includes('Entrega: R$') && decodeURIComponent(r.corpo.pedido.whatsappMsg).includes('Entrega: Tarde'));
  // 2 ovos = 28: entrega grátis
  r = await pedir({ itens: [{ id: 'ovos', qtd: 2, tipo: 'un' }], horarioEntrega: 'Manhã' }); assert.strictEqual(r.corpo.pedido.total, 28);
  // item a pesar: cobra a taxa agora (14 < 20); depois da balança passa de 20 e a taxa sai
  p = pedido({ itens: [{ id: 'tomate', qtd: 4, tipo: 'un' }, { id: 'ovos', qtd: 1, tipo: 'un' }], horarioEntrega: 'Tarde' });
  r = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p }); assert.strictEqual(r.corpo.pedido.total, 19);
  const pdv = carregarApi(raiz('api/pdv.js'), adm), pesar = (peso) => chamar(pdv, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'pesagem', pedidoId: p.idempotencyKey, pesos: [{ i: 0, peso }] } });
  r = await pesar(0.5); assert.strictEqual(r.corpo.total, 23.45, '0,5 × 8,90 = 4,45 + 14 = 18,45 (< 20) + 5 de entrega'); assert.strictEqual(r.corpo.entrega, 5);
  r = await pesar(1); assert.strictEqual(r.corpo.total, 22.9, '8,90 + 14 = 22,90 (≥ 20): entrega grátis'); assert.strictEqual(r.corpo.entrega, 0);
  g = db._dados.get(`pedidos/${p.idempotencyKey}`); assert.strictEqual(g.entrega.taxa, 0); assert.strictEqual(g.entrega.horario, 'Tarde');
  // cupom com taxa e impressão
  const I = await import(raiz('js/impressao-lib.js'));
  const txt = I.paraTexto(I.cupomDoPedido({ itens: [{ nome: 'Ovos', qtd: 1, unidade: 'un', tipo: 'un', subtotal: 14 }], total: 19, entrega: { taxa: 5, horario: 'Tarde' } }), 32);
  assert.ok(txt.includes('Subtotal') && txt.includes('Entrega') && txt.includes('R$ 5,00') && txt.includes('Entregar: Tarde') && txt.includes('R$ 19,00'), txt);
});

// ------------------------------------------------------------------ avisos de pedido (Web Push)
teste('avisos: a mensagem cifrada abre só com a chave do aparelho, e o crachá do servidor confere', () => {
  const crypto = require('crypto'), A = require(raiz('lib/avisos'));
  const aparelho = crypto.createECDH('prime256v1'); aparelho.generateKeys(); const auth = crypto.randomBytes(16);
  const corpo = A.cifrar('{"titulo":"Pedido novo","corpo":"Maria · R$ 49,35"}', A.b64u(aparelho.getPublicKey()), A.b64u(auth));
  // abre do jeito que o navegador abre (RFC 8291)
  const salt = corpo.subarray(0, 16), n = corpo[20], as = corpo.subarray(21, 21 + n), cifra = corpo.subarray(21 + n);
  assert.strictEqual(corpo.readUInt32BE(16), 4096); assert.strictEqual(n, 65);
  const comum = aparelho.computeSecret(as);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', comum, auth, Buffer.concat([Buffer.from('WebPush: info\0'), aparelho.getPublicKey(), as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(cifra.subarray(cifra.length - 16));
  const claro = Buffer.concat([d.update(cifra.subarray(0, cifra.length - 16)), d.final()]);
  assert.strictEqual(claro[claro.length - 1], 2); assert.strictEqual(JSON.parse(claro.subarray(0, -1).toString('utf8')).corpo, 'Maria · R$ 49,35');
  // outro aparelho não abre
  const outro = crypto.createECDH('prime256v1'); outro.generateKeys();
  assert.notDeepStrictEqual(outro.computeSecret(as), comum);
  // crachá (VAPID): assinatura confere com a chave pública e o destino é o serviço do aparelho
  const srv = crypto.createECDH('prime256v1'); srv.generateKeys(); const k = { priv: A.b64u(srv.getPrivateKey()), pub: A.b64u(srv.getPublicKey()) };
  const cab = A.cracha('https://fcm.googleapis.com/fcm/send/abc', k); const [, jwt, pub] = cab.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, p, ass] = jwt.split('.'); assert.strictEqual(pub, k.pub);
  const x = srv.getPublicKey(), chavePub = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: A.b64u(x.subarray(1, 33)), y: A.b64u(x.subarray(33)) } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: chavePub, dsaEncoding: 'ieee-p1363' }, A.deB64u(ass)));
  const carga = JSON.parse(A.deB64u(p).toString()); assert.strictEqual(carga.aud, 'https://fcm.googleapis.com'); assert.ok(carga.exp - Date.now() / 1000 <= 24 * 3600, 'validade de no máximo 24 h');
  // endereços: só serviços de aviso conhecidos, com as duas chaves do tamanho certo
  const boa = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: A.b64u(aparelho.getPublicKey()), auth: A.b64u(auth) } };
  assert.strictEqual(A.assinaturaValida(boa), true); assert.strictEqual(A.assinaturaValida({ ...boa, endpoint: 'https://web.push.apple.com/x' }), true);
  for (const ruim of [{ ...boa, endpoint: 'https://meu-servidor.com/x' }, { ...boa, endpoint: 'http://fcm.googleapis.com/x' }, { ...boa, endpoint: 'https://fcm.googleapis.com.golpe.com/x' }, { ...boa, keys: { p256dh: 'abc', auth: boa.keys.auth } }, { endpoint: boa.endpoint }, null])
    assert.strictEqual(A.assinaturaValida(ruim), false, JSON.stringify(ruim));
});
teste('avisos: a equipe liga o aparelho, o pedido novo dispara o aviso e uma falha não derruba o pedido', async () => {
  const crypto = require('crypto'), A = require(raiz('lib/avisos'));
  const srv = crypto.createECDH('prime256v1'); srv.generateKeys(); const ap = crypto.createECDH('prime256v1'); ap.generateKeys();
  const assinatura = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/aparelho-${n}`, keys: { p256dh: A.b64u(ap.getPublicKey()), auth: A.b64u(crypto.randomBytes(16)) } });
  const db = criarBancoP(sementeEstoque()); const adm = criarAdmin(db, TOKENS_P);
  const equipe = carregarApi(raiz('api/equipe.js'), adm), checkout = carregarApi(raiz('api/checkout.js'), adm);
  const ch = (token, body, loja) => chamar(equipe, { headers: { Authorization: `Bearer ${token}`, ...(loja ? { 'X-Loja': loja } : {}) }, body });
  const fetchReal = global.fetch, envios = []; let resposta = 201;
  global.fetch = async (url, o) => { envios.push({ url: String(url), h: o.headers, tam: o.body.length }); if (resposta === 'cai') throw new Error('sem rede'); return { status: resposta }; };
  try {
    delete process.env.VAPID_PRIVATE_KEY; delete process.env.VITE_VAPID_PUBLIC_KEY;
    assert.strictEqual((await ch('func-banca', { acao: 'aviso-ligar', assinatura: assinatura(1) })).status, 503, 'sem chave no servidor fica desligado');
    process.env.VAPID_PRIVATE_KEY = A.b64u(srv.getPrivateKey()); process.env.VITE_VAPID_PUBLIC_KEY = A.b64u(srv.getPublicKey());
    assert.strictEqual((await ch('cliente', { acao: 'aviso-ligar', assinatura: assinatura(1) })).status, 403, 'cliente não recebe aviso da loja');
    assert.strictEqual((await ch('dono-espetinhos', { acao: 'aviso-ligar', assinatura: assinatura(1) })).status, 403, 'gente de outra loja também não');
    assert.strictEqual((await ch('func-banca', { acao: 'aviso-ligar', assinatura: { endpoint: 'https://golpe.com/x', keys: assinatura(1).keys } })).status, 400);
    assert.strictEqual((await ch('func-banca', { acao: 'aviso-ligar', assinatura: assinatura(1) })).status, 200);
    assert.strictEqual((await ch('func-banca', { acao: 'aviso-ligar', assinatura: assinatura(1) })).status, 200, 'ligar duas vezes não duplica');
    assert.strictEqual((await ch('func-banca', { acao: 'aviso-ligar', assinatura: assinatura(2) })).status, 200);
    const guardados = () => [...db._dados.keys()].filter((k) => k.startsWith('avisos/'));
    assert.strictEqual(guardados().length, 2);
    const pedir = () => chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: pedido({ itens: [{ id: 'ovos', qtd: 1, tipo: 'un' }] }) });
    let r = await pedir(); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.strictEqual(envios.length, 2); assert.ok(envios[0].url.includes('fcm.googleapis.com')); assert.strictEqual(envios[0].h['Content-Encoding'], 'aes128gcm'); assert.match(envios[0].h.Authorization, /^vapid t=/);
    assert.ok(envios[0].tam > 100 && envios[0].tam < 4096, 'cabe no limite do serviço de avisos');
    resposta = 410; r = await pedir(); assert.strictEqual(r.status, 200); assert.strictEqual(guardados().length, 0, 'aparelho que saiu é tirado da lista');
    await ch('func-banca', { acao: 'aviso-ligar', assinatura: assinatura(3) }); resposta = 'cai';
    r = await pedir(); assert.strictEqual(r.status, 200, 'o serviço de avisos fora do ar não derruba o pedido'); assert.strictEqual(guardados().length, 1);
    assert.strictEqual((await ch('func-banca', { acao: 'aviso-desligar', endpoint: assinatura(3).endpoint })).status, 200); assert.strictEqual(guardados().length, 0);
  } finally { global.fetch = fetchReal; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VITE_VAPID_PUBLIC_KEY; }
});
teste('avisos: situação do aparelho e conversão da chave', async () => {
  const L = await import(raiz('js/avisos-lib.js'));
  const base = { temSW: true, temPush: true, temNotificacao: true, permissao: 'default', assinado: false, chave: 'abc', ios: false, instalado: false };
  assert.strictEqual(L.situacaoDosAvisos(base), 'desligado');
  assert.strictEqual(L.situacaoDosAvisos({ ...base, permissao: 'granted', assinado: true }), 'ligado');
  assert.strictEqual(L.situacaoDosAvisos({ ...base, permissao: 'granted', assinado: false }), 'desligado');
  assert.strictEqual(L.situacaoDosAvisos({ ...base, permissao: 'denied' }), 'bloqueado');
  assert.strictEqual(L.situacaoDosAvisos({ ...base, chave: '' }), 'sem-chave');
  assert.strictEqual(L.situacaoDosAvisos({ ...base, temPush: false }), 'sem-suporte');
  assert.strictEqual(L.situacaoDosAvisos({ ...base, ios: true }), 'ios-instalar'); assert.strictEqual(L.situacaoDosAvisos({ ...base, ios: true, instalado: true }), 'desligado');
  assert.deepStrictEqual([...L.chaveParaBytes('AQID-_8')], [1, 2, 3, 251, 255]);
});

// ------------------------------------------------------------------ auditoria de segurança
teste('PIX: só o dono do pedido (ou a equipe) gera o QR, e só na loja original', async () => {
  const db = criarBancoP({ ...semente(), 'loja/config': { ...(semente()['loja/config'] || {}), pixAutomatico: true }, 'pedidos/pedido-0001': { userId: 'c1', total: 20, status: 'pendente' }, 'tenants/espetinhos/pedidos/pedido-0002': { userId: 'c1', total: 20, status: 'pendente' } });
  process.env.PAGBANK_API_TOKEN = 'token-teste'; process.env.PUBLIC_BASE_URL = 'https://www.exemplo.com.br';
  const chamadas = [], fetchReal = global.fetch;
  global.fetch = async (url) => { chamadas.push(String(url)); return { ok: true, status: 200, json: async () => ({ id: 'ORDE_1', qr_codes: [{ text: 'pix-copia-e-cola', links: [] }] }) }; };
  try {
    const api = carregarApi(raiz('api/pagamento-pix.js'), criarAdmin(db, TOKENS_P));
    const pix = (token, pedidoId, loja) => chamar(api, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(loja ? { 'X-Loja': loja } : {}) }, body: { pedidoId } });
    assert.strictEqual((await pix(null, 'pedido-0001')).status, 401, 'sem login');
    assert.strictEqual((await pix('dono-espetinhos', 'pedido-0001')).status, 404, 'outra pessoa não gera PIX do pedido alheio (nem descobre que ele existe)');
    assert.strictEqual((await pix('cliente', 'pedido-0002', 'espetinhos')).status, 400, 'outra loja: o dinheiro iria para a conta errada');
    assert.strictEqual((await pix('cliente', '../../x')).status, 400);
    assert.strictEqual(chamadas.length, 0, 'nenhuma dessas chegou ao PagBank');
    const ok = await pix('cliente', 'pedido-0001'); assert.strictEqual(ok.status, 200, JSON.stringify(ok.corpo)); assert.strictEqual(chamadas.length, 1);
    assert.strictEqual((await pix('func-banca', 'pedido-0001')).status, 200, 'a equipe da loja também pode');
    // desligado no painel, ou sem a conta do banco no servidor: recusa sem chamar o PagBank
    const antes = chamadas.length;
    db._dados.set('loja/config', { ...db._dados.get('loja/config'), pixAutomatico: false });
    assert.strictEqual((await pix('cliente', 'pedido-0001')).status, 503, 'a loja desligou');
    db._dados.set('loja/config', { ...db._dados.get('loja/config'), pixAutomatico: true }); delete process.env.PAGBANK_API_TOKEN;
    assert.strictEqual((await pix('cliente', 'pedido-0001')).status, 503, 'sem a conta do banco');
    assert.strictEqual(chamadas.length, antes);
    process.env.PAGBANK_API_TOKEN = 'token-teste';
    const cpfRuim = await chamar(api, { headers: { Authorization: 'Bearer cliente' }, body: { pedidoId: 'pedido-0001', cpf: '123' } });
    assert.ok([400, 200].includes(cpfRuim.status));
  } finally { global.fetch = fetchReal; }
});
teste('chat público: loja sem o módulo de IA não gasta a cota; entradas grandes são recusadas', async () => {
  const db = criarBancoP({ ...semente(), 'tenants/comia': { nome: 'Com IA', ativo: true, modulos: { ia: true } } });
  process.env.GEMINI_API_KEY = 'chave-de-teste';
  let n = 0; const fetchReal = global.fetch; global.fetch = async () => { n++; return { ok: false, status: 400, json: async () => ({ error: { message: 'parou aqui' } }) }; };
  try {
    const api = carregarApi(raiz('api/assistente.js'), criarAdmin(db, TOKENS));
    const chat = (loja, extra = {}) => chamar(api, { headers: { 'x-forwarded-for': '7.7.7.' + Math.floor(Math.random() * 250), ...(loja ? { 'X-Loja': loja } : {}) }, body: { action: 'chat_stream', mensagemCliente: 'oi', ...extra } });
    assert.strictEqual((await chat('espetinhos')).status, 403, 'módulo desligado'); assert.strictEqual((await chat('nao-existe')).status, 404); assert.strictEqual((await chat('fechada')).status, 403);
    assert.strictEqual((await chat(null, { imagem: { data: 'x'.repeat(2000001), mimeType: 'image/jpeg' } })).status, 400, 'foto grande demais');
    assert.strictEqual((await chat(null, { imagem: { data: 'abc', mimeType: 'text/html' } })).status, 400, 'tipo de arquivo não aceito');
    assert.strictEqual(n, 0, 'nada disso chegou à IA');
    await chat('comia'); assert.ok(n > 0, 'loja com o módulo ligado é atendida');
    assert.strictEqual(db._dados.get([...db._dados.keys()].find((k) => k.startsWith('tenants/comia/uso_ia/'))).chat, 1, 'uso contado por loja');
  } finally { global.fetch = fetchReal; }
});
teste('textos do cadastro não viram HTML (unidade com marcação é limpa)', async () => {
  const L = await import(raiz('js/estoque-lib.js'));
  const sujo = L.fmtQtd(2, '<img src=x onerror=alert(1)>'); assert.ok(!/[<>"'&]/.test(sujo), sujo); assert.strictEqual(sujo, '2 img src=x on'); assert.strictEqual(L.fmtQtd(1.5, 'kg'), '1,5 kg');
});

// ------------------------------------------------------------------ calendário operacional
teste('calendário: repetições, feriados nacionais e grade do mês', async () => {
  const C = await import(raiz('js/calendario-lib.js'));
  const entradas = [
    { id: 'a', data: '2026-09-29', tipo: 'compra', titulo: 'Ceasa', repete: 'semanal' },            // toda terça
    { id: 'b', data: '2025-06-20', tipo: 'evento', titulo: 'Festa junina do condomínio', repete: 'anual' },
    { id: 'c', data: '2026-10-09', tipo: 'promocao', titulo: 'Sexta da fruta' },
    { id: 'd', data: '2024-02-29', tipo: 'especial', titulo: 'Dia raro', repete: 'anual' },
    { id: 'x', data: '2026-13-40', tipo: 'compra' }, { id: 'y', data: '2026-10-01', tipo: 'inventado' },
  ];
  const out = C.ocorrencias(entradas, '2026-10-01', '2026-10-31');
  assert.deepStrictEqual(out.filter((o) => o.tipo === 'compra').map((o) => o.data), ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'], 'toda terça de outubro');
  assert.deepStrictEqual(out.filter((o) => o.nacional).map((o) => [o.data, o.titulo]), [['2026-10-12', 'N. Sra. Aparecida']]);
  assert.deepStrictEqual(out.filter((o) => o.id === 'c').map((o) => o.data), ['2026-10-09']);
  assert.deepStrictEqual(C.ocorrencias(entradas, '2025-01-01', '2027-12-31', { nacionais: false }).filter((o) => o.id === 'b').map((o) => o.data), ['2025-06-20', '2026-06-20', '2027-06-20']);
  assert.deepStrictEqual(C.ocorrencias(entradas, '2024-01-01', '2028-12-31', { nacionais: false }).filter((o) => o.id === 'd').map((o) => o.data), ['2024-02-29', '2028-02-29'], '29/02 só em ano bissexto');
  assert.strictEqual(C.ocorrencias(entradas, '2026-09-01', '2026-09-28', { nacionais: false }).filter((o) => o.id === 'a').length, 0, 'a repetição semanal não volta para antes do começo');
  const g = C.gradeDoMes(2026, 10); assert.strictEqual(g[0].data, '2026-09-27'); assert.strictEqual(g.length, 35); assert.strictEqual(g.filter((x) => !x.foraDoMes).length, 31);
  assert.strictEqual(C.gradeDoMes(2026, 8).length, 42, 'agosto de 2026 ocupa 6 semanas');
  assert.match(C.validarEntrada({ data: '2026-10-09', tipo: 'promocao', titulo: '' }), /nome/); assert.strictEqual(C.validarEntrada({ data: '2026-10-06', tipo: 'compra' }), '');
  assert.match(C.validarEntrada({ data: '2026-02-30', tipo: 'compra' }), /data/);
});
teste('calendário: painel e servidor concordam, e os feriados são os mesmos do motor', async () => {
  const C = await import(raiz('js/calendario-lib.js')), L = require(raiz('lib/calendario')), SZ = require(raiz('analytics/seasonality')), N = require(raiz('analytics/normalize'));
  const entradas = [{ data: '2026-09-29', tipo: 'compra', titulo: 'Ceasa', repete: 'semanal' }, { data: '2025-06-20', tipo: 'evento', titulo: 'Festa junina', repete: 'anual' }, { data: '2026-10-09', tipo: 'promocao', titulo: 'Sexta da fruta' }, { data: '2024-02-29', tipo: 'especial', titulo: 'Dia raro', repete: 'anual' }];
  const limpar = (l) => l.map((o) => `${o.data}|${o.tipo}|${o.titulo}`).sort();
  assert.deepStrictEqual(limpar(L.ocorrencias(entradas, '2024-01-01', '2028-12-31')), limpar(C.ocorrencias(entradas, '2024-01-01', '2028-12-31', { nacionais: false })));
  for (const ano of [2025, 2026, 2027]) assert.deepStrictEqual(C.feriadosDoAno(ano).map((f) => `${f.data}|${f.titulo}`).sort(), SZ.eventosDoAno(ano).map((e) => `${N.isoDeDia(e.dia)}|${e.nome}`).sort(), String(ano));
});
teste('calendário → previsão: só evento com nome vai para o motor, e o motor aprende depois de 2 vezes', () => {
  const L = require(raiz('lib/calendario')), SZ = require(raiz('analytics/seasonality')), N = require(raiz('analytics/normalize'));
  const entradas = [{ data: '2026-09-29', tipo: 'compra', titulo: 'Ceasa', repete: 'semanal' }, { data: '2026-03-14', tipo: 'evento', titulo: 'Feira de sábado no clube' }, { data: '2026-05-16', tipo: 'evento', titulo: 'Feira de sábado no clube' },
    { data: '2026-07-10', tipo: 'promocao', titulo: 'Sexta da fruta', repete: 'semanal' }, { data: '2026-08-01', tipo: 'evento', titulo: '   ' }];
  const ev = L.paraMotor(entradas, '2026-01-01', '2026-12-31');
  assert.deepStrictEqual(ev, [{ data: '2026-03-14', nome: 'Feira de sábado no clube' }, { data: '2026-05-16', nome: 'Feira de sábado no clube' }], 'rotina, repetição semanal e evento sem nome ficam de fora');
  // vendas normais = 10 por dia; nos dias em volta do evento = 20. Com 2 ocorrências, o motor reconhece o efeito.
  const serie = []; const d0 = N.diaDeIso('2026-01-01'), alvo = ev.map((e) => N.diaDeIso(e.data));
  for (let d = d0; d < d0 + 200; d++) serie.push({ dia: d, y: alvo.some((a) => Math.abs(a - d) <= 3) ? 20 : 10 });
  const efeitos = SZ.aprenderEfeitosEvento(serie, ev), f = efeitos['Feira de sábado no clube'];
  assert.ok(f && f.n === 2, JSON.stringify(efeitos)); assert.ok(f.fator > 1.2, 'fator acima de 1: vende mais perto do evento');
  const um = SZ.aprenderEfeitosEvento(serie, ev.slice(0, 1))['Feira de sábado no clube'];
  assert.ok(!um || um.confiavel === false || um.n < 2, 'com uma ocorrência só, o motor ainda não confia');
});
teste('calendário → copiloto: a agenda dos próximos 14 dias entra no resumo da loja', () => {
  const C = require(raiz('lib/copiloto'));
  const r = C.resumir({ produtos: [], agora: Date.parse('2026-10-05T15:00:00Z'), calendario: [{ data: '2026-09-29', tipo: 'compra', titulo: 'Ceasa', repete: 'semanal' }, { data: '2026-10-09', tipo: 'promocao', titulo: 'Sexta da fruta' }, { data: '2026-11-30', tipo: 'evento', titulo: 'Longe' }] });
  assert.deepStrictEqual(r.agenda14dias.map((a) => `${a.data} ${a.semana} ${a.tipo}`), ['2026-10-06 terça compra', '2026-10-09 sexta promocao', '2026-10-13 terça compra']);
});

// ------------------------------------------------------------------ papéis e equipe
teste('papéis: cada um vê só as suas abas, e a tela não libera mais do que o servidor', async () => {
  const P = await import(raiz('js/papeis-lib.js')), T = require(raiz('lib/tenant'));
  const todas = ['produtos', 'pdv', 'estoque', 'compras', 'crm', 'copiloto', 'calendario', 'relatorios', 'balanco', 'fechamento', 'categorias', 'previsao', 'comunicados', 'cupons', 'aparencia', 'equipe', 'config'];
  assert.deepStrictEqual(P.abasDoPapel('proprietario', todas), todas);
  assert.ok(!P.abasDoPapel('administrador', todas).includes('equipe') && P.abasDoPapel('administrador', todas).length === todas.length - 1);
  assert.deepStrictEqual(P.abasDoPapel('caixa', todas), ['pdv', 'relatorios']);
  assert.deepStrictEqual(P.abasDoPapel('producao', todas), ['estoque', 'calendario']);
  assert.deepStrictEqual(P.abasDoPapel('estoque', todas), ['estoque', 'compras', 'fechamento', 'calendario']);
  assert.deepStrictEqual(P.abasDoPapel('inventado', todas), []); assert.deepStrictEqual(P.abasDoPapel(null, todas), []);
  for (const papel of ['funcionario', 'caixa', 'producao', 'estoque']) for (const proibida of ['produtos', 'balanco', 'crm', 'copiloto', 'cupons', 'config', 'equipe', 'aparencia']) assert.ok(!P.podeAbrir(papel, proibida, todas), `${papel} × ${proibida}`);
  // a tela e o servidor falam dos mesmos papéis
  assert.deepStrictEqual(Object.keys(P.PAPEIS).sort(), [...T.PAPEIS].sort());
  // quem vê o Balcão na tela é aceito pelo /api/pdv; quem vê o Estoque é aceito pelo /api/estoque
  const fonte = (f) => require('fs').readFileSync(raiz(f), 'utf8'), podem = (f) => JSON.parse(fonte(f).match(/const PODEM = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const papel of T.PAPEIS) { if (P.podeAbrir(papel, 'pdv', todas)) assert.ok(podem('api/pdv.js').includes(papel), `pdv ${papel}`); if (P.podeAbrir(papel, 'estoque', todas)) assert.ok(podem('api/estoque.js').includes(papel), `estoque ${papel}`); }
});
teste('equipe: só o proprietário dá papel, só na própria loja, e nunca o de proprietário', async () => {
  const db = criarBanco({ 'tenants/espetinhos': { nome: 'Espetinhos', ativo: true }, 'tenants/outra': { nome: 'Outra', ativo: true } });
  const usuarios = [{ uid: 'dono-espeto-1', email: 'dono@x.com', customClaims: { tenants: { espetinhos: 'proprietario' } } }, { uid: 'joao-conta-1', email: 'joao@x.com', customClaims: { tenants: { outra: 'caixa' } } }, { uid: 'socio-conta-1', email: 'socio@x.com', customClaims: { tenants: { espetinhos: 'proprietario' } } }];
  const tokens = { dono: { uid: 'dono-espeto-1', tenants: { espetinhos: 'proprietario' } }, adm: { uid: 'adm-1', tenants: { espetinhos: 'administrador' } }, caixa: { uid: 'cx-1', tenants: { espetinhos: 'caixa' } } };
  const api = carregarApi(raiz('api/equipe.js'), criarAdmin(db, tokens, usuarios));
  const ch = (tk, body, loja = 'espetinhos') => chamar(api, { headers: { authorization: `Bearer ${tk}`, 'x-loja': loja }, body });
  assert.strictEqual((await ch('adm', { acao: 'listar' })).status, 403, 'administrador não mexe na equipe');
  assert.strictEqual((await ch('caixa', { acao: 'definir', email: 'a@b.com', papel: 'administrador' })).status, 403);
  assert.strictEqual((await ch('dono', { acao: 'listar' }, 'outra')).status, 403, 'dono de uma loja não mexe na equipe de outra');
  assert.strictEqual((await ch('', { acao: 'listar' })).status, 401);
  assert.strictEqual((await ch('dono', { acao: 'definir', email: 'joao@x.com', papel: 'proprietario' })).status, 400, 'proprietário não se dá por aqui');
  assert.strictEqual((await ch('dono', { acao: 'definir', email: 'joao@x.com', papel: 'plataforma' })).status, 400);
  assert.strictEqual((await ch('dono', { acao: 'definir', email: 'dono@x.com', papel: 'caixa' })).status, 400, 'ninguém muda o próprio papel');
  assert.strictEqual((await ch('dono', { acao: 'definir', email: 'socio@x.com', papel: 'caixa' })).status, 400, 'não rebaixa outro proprietário');
  assert.strictEqual((await ch('dono', { acao: 'definir', email: 'isso nao e email', papel: 'caixa' })).status, 400);
  // dá o papel: mantém o que a pessoa já tinha em OUTRA loja
  const r = await ch('dono', { acao: 'definir', email: 'JOAO@x.com', papel: 'caixa' }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.deepStrictEqual(usuarios[1].customClaims, { tenants: { outra: 'caixa', espetinhos: 'caixa' } });
  // conta que ainda não existe é criada (a pessoa entra depois pelo link do e-mail)
  const n = await ch('dono', { acao: 'definir', email: 'nova@x.com', papel: 'producao' }); assert.strictEqual(n.status, 200);
  assert.deepStrictEqual(usuarios.find((u) => u.email === 'nova@x.com').customClaims, { tenants: { espetinhos: 'producao' } });
  assert.deepStrictEqual((await ch('dono', { acao: 'listar' })).corpo.equipe.map((m) => `${m.email}:${m.papel}`), ['joao@x.com:caixa', 'nova@x.com:producao']);
  assert.ok(db._dados.has('tenants/espetinhos/equipe/joao-conta-1') && !db._dados.has('equipe/joao-conta-1'), 'a lista fica dentro da loja');
  // tira o acesso: some desta loja, continua na outra, e é obrigada a entrar de novo
  assert.strictEqual((await ch('dono', { acao: 'remover', uid: 'socio-conta-1' })).status, 400);
  assert.strictEqual((await ch('dono', { acao: 'remover', uid: 'dono-espeto-1' })).status, 400);
  assert.strictEqual((await ch('dono', { acao: 'remover', uid: 'joao-conta-1' })).status, 200);
  assert.deepStrictEqual(usuarios[1].customClaims, { tenants: { outra: 'caixa' } }); assert.strictEqual(usuarios[1].revogado, true);
  assert.ok(!db._dados.has('tenants/espetinhos/equipe/joao-conta-1'));
});

// ------------------------------------------------------------------ plataforma (super admin)
teste('plataforma: só o dono da plataforma entra; cria loja, dono, módulos, bloqueio e feira', async () => {
  const db = criarBanco({ 'tenants/espetinhos': { nome: 'Espetinhos', ativo: true, tema: { primaria: '#b3261e' } }, 'tenants/espetinhos/resumos/2020-01-05': { receita: 999, pedidos: 9 },
    [`tenants/espetinhos/resumos/${new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7)}-02`]: { receita: 150.5, pedidos: 4 }, 'tenants/espetinhos/produtos/carne': { nome: 'Espeto', preco: 9, unidade: 'un', ativo: true } });
  const usuarios = [{ uid: 'ze-conta-01', email: 'ze@x.com', customClaims: { tenants: { outra: 'caixa' } } }];
  const tokens = { super: { uid: 'sup-1', plataforma: true }, dono: { uid: 'd-1', tenants: { espetinhos: 'proprietario' } }, antigo: { uid: 'a-1', admin: true }, ze: { uid: 'ze-conta-01', tenants: { 'jantinha-da-lu': 'proprietario' } } };
  const adm = criarAdmin(db, tokens, usuarios), api = carregarApi(raiz('api/plataforma.js'), adm);
  const ch = (tk, body) => chamar(api, { headers: { authorization: `Bearer ${tk}` }, body });
  for (const tk of ['dono', 'antigo']) for (const acao of ['lojas', 'criar-loja', 'ativo', 'modulos', 'proprietario', 'feira']) assert.strictEqual((await ch(tk, { acao, id: 'espetinhos', ativo: false })).status, 403, `${tk} × ${acao}`);
  assert.strictEqual((await ch('', { acao: 'lojas' })).status, 401);
  assert.strictEqual(db._dados.get('tenants/espetinhos').ativo, true, 'ninguém de fora bloqueou a loja');
  // primeiro acesso pela tela: só o dono da loja original assume, e só uma vez
  usuarios.push({ uid: 'a-1', email: 'antigo@x.com', customClaims: { admin: true } }, { uid: 'a-2', email: 'outro@x.com', customClaims: { admin: true } });
  tokens.antigo2 = { uid: 'a-2', admin: true };
  assert.strictEqual((await ch('dono', { acao: 'assumir' })).status, 403, 'dono de outra loja não assume');
  assert.strictEqual((await ch('antigo', { acao: 'assumir' })).status, 200);
  assert.deepStrictEqual(usuarios.find((u) => u.uid === 'a-1').customClaims, { admin: true, plataforma: true });
  assert.strictEqual((await ch('antigo', { acao: 'assumir' })).status, 200, 'repetir não quebra');
  assert.strictEqual((await ch('antigo2', { acao: 'assumir' })).status, 403, 'a segunda conta não assume');
  assert.strictEqual(usuarios.find((u) => u.uid === 'a-2').customClaims.plataforma, undefined);
  // lista: a loja original aparece mesmo sem ficha; o movimento é só o do mês
  const l = (await ch('super', { acao: 'lojas' })).corpo;
  assert.deepStrictEqual(l.lojas.map((x) => x.id), ['banca', 'espetinhos']); assert.deepStrictEqual(l.lojas[1].mes, { receita: 150.5, pedidos: 4 });
  assert.strictEqual(l.lojas[1].modulos.pdv, true); assert.strictEqual(l.lojas[1].modulos.ia, false); assert.strictEqual(l.lojas[0].modulos.ia, true);
  // criar loja
  for (const ruim of [{ id: 'banca', nome: 'X loja' }, { id: 'Com Espaço', nome: 'X loja' }, { id: 'admin', nome: 'X loja' }, { id: 'ok-loja', nome: '' }, { id: 'ok-loja', nome: 'Loja', modelo: 'padaria' }, { id: 'espetinhos', nome: 'Outra' }])
    assert.ok([400, 409].includes((await ch('super', { acao: 'criar-loja', ...ruim })).status), JSON.stringify(ruim));
  const c = await ch('super', { acao: 'criar-loja', id: 'jantinha-da-lu', nome: 'Jantinha da <b>Lu</b>', modelo: 'jantinha', emailDono: 'ZE@x.com' }); assert.strictEqual(c.status, 200, JSON.stringify(c.corpo));
  const ficha = db._dados.get('tenants/jantinha-da-lu'); assert.strictEqual(ficha.tema.fonteTitulo, 'Lora'); assert.ok(!/[<>]/.test(ficha.nome)); assert.deepStrictEqual(ficha.modulos, { ia: false });
  assert.ok(db._dados.has('tenants/jantinha-da-lu/loja/config'));
  // tipo de negócio escrito à mão: no cadastro (com a aparência de um modelo) e depois, pelo cartão da loja
  assert.strictEqual(ficha.tipo, 'jantinha');
  assert.strictEqual((await ch('super', { acao: 'criar-loja', id: 'pao-da-vila', nome: 'Pão da Vila', modelo: 'jantinha', tipoNome: ' Padaria <b> ' })).status, 200);
  const pao = db._dados.get('tenants/pao-da-vila'); assert.ok(/^Padaria/.test(pao.tipo) && !/[<>]/.test(pao.tipo), pao.tipo); assert.strictEqual(pao.tema.fonteTitulo, 'Lora');
  assert.strictEqual((await ch('super', { acao: 'tipo', id: 'pao-da-vila', tipo: 'Padaria e confeitaria' })).status, 200); assert.strictEqual(db._dados.get('tenants/pao-da-vila').tipo, 'Padaria e confeitaria');
  assert.strictEqual((await ch('super', { acao: 'tipo', id: 'pao-da-vila', tipo: ' ' })).status, 400); assert.strictEqual((await ch('super', { acao: 'tipo', id: 'nao-existe', tipo: 'Padaria' })).status, 404);
  assert.strictEqual((await ch('dono', { acao: 'tipo', id: 'pao-da-vila', tipo: 'Outra' })).status, 403);
  db._dados.delete('tenants/pao-da-vila'); db._dados.delete('tenants/pao-da-vila/loja/config');
  assert.deepStrictEqual(usuarios[0].customClaims, { tenants: { outra: 'caixa', 'jantinha-da-lu': 'proprietario' } }, 'vira dono sem perder o que tinha em outra loja');
  assert.deepStrictEqual((await ch('super', { acao: 'lojas' })).corpo.lojas.find((x) => x.id === 'jantinha-da-lu').donos, ['ze@x.com']);
  // módulos: desligado → o servidor recusa
  assert.strictEqual((await ch('super', { acao: 'modulos', id: 'espetinhos', modulos: { inventado: true } })).status, 400);
  assert.strictEqual((await ch('super', { acao: 'modulos', id: 'espetinhos', modulos: { pdv: false, estoque: false } })).status, 200);
  const venda = { acao: 'venda', chave: 'chave-de-teste-1', pag: 'PIX', itens: [{ id: 'carne', qtd: 1 }] }, cab = { authorization: 'Bearer dono', 'x-loja': 'espetinhos' };
  const pdv = carregarApi(raiz('api/pdv.js'), adm); let r = await chamar(pdv, { headers: cab, body: venda }); assert.strictEqual(r.status, 403); assert.match(r.corpo.error, /Balcão/);
  r = await chamar(carregarApi(raiz('api/estoque.js'), adm), { headers: cab, body: { acao: 'movimentar' } }); assert.strictEqual(r.status, 403); assert.match(r.corpo.error, /estoque/);
  await chamar(carregarApi(raiz('api/plataforma.js'), adm), { headers: { authorization: 'Bearer super' }, body: { acao: 'modulos', id: 'espetinhos', modulos: { pdv: true } } });
  assert.strictEqual((await chamar(carregarApi(raiz('api/pdv.js'), adm), { headers: cab, body: venda })).status, 200, 'religado, volta a vender');
  // bloquear
  const api2 = carregarApi(raiz('api/plataforma.js'), adm), ch2 = (body) => chamar(api2, { headers: { authorization: 'Bearer super' }, body });
  assert.strictEqual((await ch2({ acao: 'ativo', id: 'espetinhos', ativo: false })).status, 200);
  assert.strictEqual((await chamar(carregarApi(raiz('api/pdv.js'), adm), { headers: cab, body: { ...venda, chave: 'chave-de-teste-2' } })).status, 403, 'loja bloqueada não vende');
  const api3 = carregarApi(raiz('api/plataforma.js'), adm), ch3 = (body) => chamar(api3, { headers: { authorization: 'Bearer super' }, body });
  assert.strictEqual((await ch3({ acao: 'ativo', id: 'nao-existe', ativo: false })).status, 404);
  // feira
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'Feira', lojas: ['banca'] })).status, 400);
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'Feira', lojas: ['banca', 'fantasma'] })).status, 404);
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'Feira do Jardins', lojas: ['banca', 'espetinhos', 'jantinha-da-lu'] })).status, 200);
  assert.deepStrictEqual(db._dados.get('feiras/jardins').lojas.map((x) => `${x.id}|${x.cor}`), ['banca|#1a3a2a', 'espetinhos|#b3261e', 'jantinha-da-lu|#7a2e12']);
  assert.strictEqual(db._dados.get('tenants/banca').feiraId, 'jardins'); assert.strictEqual(db._dados.get('tenants/banca').nome, 'Banca Adair e Pedrina');
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'Feira do Jardins', lojas: ['banca', 'espetinhos'] })).status, 200);
  assert.strictEqual(db._dados.get('tenants/jantinha-da-lu').feiraId, '', 'quem saiu da feira deixa de apontar para ela');
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: '', lojas: [] })).status, 200); assert.ok(!db._dados.has('feiras/jardins')); assert.strictEqual(db._dados.get('tenants/banca').feiraId, '');
  // tirar o proprietário
  assert.strictEqual((await ch3({ acao: 'proprietario', id: 'jantinha-da-lu', email: 'ze@x.com', remover: true })).status, 200);
  assert.deepStrictEqual(usuarios[0].customClaims, { tenants: { outra: 'caixa' } }); assert.strictEqual(usuarios[0].revogado, true);
});
teste('oferta: só vale com preço antigo maior; o desconto nunca promete a mais', async () => {
  const O = await import(raiz('js/oferta-lib.js'));
  assert.strictEqual(O.emOferta({ preco: 8, precoDe: 10 }), true);
  for (const nao of [{ preco: 8 }, { preco: 8, precoDe: 8 }, { preco: 8, precoDe: 6 }, { preco: 8, precoDe: 'x' }, { preco: 0, precoDe: 5 }, null]) assert.strictEqual(O.emOferta(nao), false, JSON.stringify(nao));
  assert.strictEqual(O.desconto({ preco: 8, precoDe: 10 }), 20); assert.strictEqual(O.desconto({ preco: 6.99, precoDe: 9.99 }), 30, '30,03% vira 30, não 31'); assert.strictEqual(O.desconto({ preco: 8 }), 0);
  assert.strictEqual(O.precoDeValido('12,50', 10), 12.5); assert.strictEqual(O.precoDeValido('', 10), null); assert.strictEqual(O.precoDeValido(10, 10), null); assert.strictEqual(O.precoDeValido(9, 10), null); assert.strictEqual(O.precoDeValido('abc', 10), null);
  const lista = O.ofertasDe([{ id: 'a', preco: 9, precoDe: 10 }, { id: 'b', preco: 5, precoDe: 10 }, { id: 'c', preco: 5 }]); assert.deepStrictEqual(lista.map((p) => p.id), ['b', 'a'], 'maior desconto primeiro, sem quem não é oferta');
  // o servidor continua cobrando `preco`: o preço antigo é só vitrine
  const db = criarBanco({ ...semente(), 'produtos/tomate': { ...semente()['produtos/tomate'], precoDe: 99 } }); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const r = await chamar(api, { headers: ip(), body: pedido({ itens: [{ id: 'tomate', qtd: 2, tipo: 'kg' }] }) }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.pedido.total, 17.8);
});

teste('cópia: restaurar volta o cadastro, guarda o estado de antes e não mexe em pedidos nem no que é novo', async () => {
  const P = require(raiz('lib/prudencia'));
  const db = criarBanco({ ...semente(), 'pedidos/p1': { nome: 'Ana', total: 10, data: new Date().toISOString() }, 'loja/avaliacoes': { soma: 9, n: 2 } });
  const precoBom = db._dados.get('produtos/tomate').preco;
  await P.copiar(db, 'banca', new Date(Date.UTC(2026, 9, 5, 8)));
  // depois da cópia: preço estragado, produto novo, pedido novo, avaliação nova
  db._dados.set('produtos/tomate', { ...db._dados.get('produtos/tomate'), preco: 0.01 }); db._dados.set('produtos/novo', { nome: 'Caqui', preco: 7, ativo: true });
  db._dados.set('pedidos/p2', { nome: 'Bia', total: 20, data: new Date().toISOString() }); db._dados.set('loja/avaliacoes', { soma: 14, n: 3 });
  const eq = carregarApi(raiz('api/equipe.js'), criarAdmin(db, { dono: { uid: 'a-1', admin: true }, adm: { uid: 'b-1', tenants: { banca: 'administrador' } }, outro: { uid: 'o-1', tenants: { espetinhos: 'proprietario' } } }));
  const ce = (tk, body, loja) => chamar(eq, { headers: { authorization: `Bearer ${tk}`, ...(loja ? { 'x-loja': loja } : {}) }, body });
  assert.strictEqual((await ce('adm', { acao: 'copia-restaurar', dia: '2026-10-05' })).status, 403, 'só o proprietário restaura');
  assert.strictEqual((await ce('outro', { acao: 'copia-restaurar', dia: '2026-10-05' })).status, 403, 'dono de outra loja não restaura esta');
  for (const ruim of ['', '2026-10-06', '../x', 'banca_2026-10-05']) assert.strictEqual((await ce('dono', { acao: 'copia-restaurar', dia: ruim })).status, 404, ruim);
  assert.strictEqual(db._dados.get('produtos/tomate').preco, 0.01, 'tentativa recusada não mexe em nada');
  const r = await ce('dono', { acao: 'copia-restaurar', dia: '2026-10-05' }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.strictEqual(db._dados.get('produtos/tomate').preco, precoBom, 'o preço voltou');
  assert.ok(db._dados.has('produtos/novo'), 'produto criado depois continua'); assert.ok(db._dados.has('pedidos/p2'), 'pedido novo continua');
  assert.deepStrictEqual(db._dados.get('loja/avaliacoes'), { soma: 14, n: 3 }, 'a média das avaliações não volta no tempo');
  // dá para desfazer: a cópia "antes" guarda o estado estragado
  const antes = await P.lerCopia(db, 'banca', r.corpo.copiaDeAntes); assert.strictEqual(antes.colecoes.produtos.tomate.preco, 0.01); assert.ok(/-antes$/.test(r.corpo.copiaDeAntes));
  const lista = (await ce('dono', { acao: 'copia-estado' })).corpo.copias; assert.strictEqual(lista.length, 2); assert.ok(lista.some((c) => c.dia === '2026-10-05'));
  // a cópia de uma loja não restaura outra
  assert.strictEqual(await P.lerCopia(db, 'espetinhos', '2026-10-05'), null);
});

teste('app por loja: nome, cor e ícone próprios; a loja original e loja bloqueada não passam por aqui', async () => {
  const A = await import(raiz('js/arte-lib.js')), L = require(raiz('lib/artes'));
  assert.deepStrictEqual(L.ARTES, JSON.parse(JSON.stringify(A.ARTES)), 'js/arte-lib.js e lib/artes.js com os mesmos desenhos');
  for (const t of ['Padaria', 'hortifruti', 'Caldo de cana', 'Queijo, ovos e mel', 'espetinhos', 'Loja de presentes', '']) assert.strictEqual(L.arteDoTipo(t), A.arteDoTipo(t), t);
  const db = criarBanco({ 'tenants/pao-da-lu': { nome: 'Pães da <b>Lúcia</b>', tipo: 'Padaria', subtitulo: 'Pão quentinho', ativo: true, tema: { primaria: '#7a2e12', fundo: '#fbf3e7', sobrePrimaria: '#fff8ef' } },
    'tenants/horta': { nome: 'Horta do Zé', tipo: 'hortifruti', ativo: true }, 'tenants/fechada': { nome: 'Fechada', ativo: false }, 'tenants/ruim': { nome: 'X', ativo: true, tema: { primaria: 'red"/><script>' } } });
  const api = carregarApi(raiz('api/manifest.js'), criarAdmin(db, {})), ch = (query, method = 'GET') => chamar(api, { method, query });
  const m = JSON.parse((await ch({ loja: 'pao-da-lu' })).corpo);
  assert.strictEqual(m.name, 'Pães da b Lúcia /b'.replace(/\s+/g, ' ')); assert.strictEqual(m.theme_color, '#7a2e12'); assert.strictEqual(m.background_color, '#fbf3e7');
  assert.strictEqual(m.start_url, '/?loja=pao-da-lu'); assert.strictEqual(m.id, '/?loja=pao-da-lu'); assert.ok(m.icons.some((i) => i.purpose === 'maskable') && m.icons.every((i) => i.src === '/api/manifest?loja=pao-da-lu&icone=1'));
  const svg = (await ch({ loja: 'pao-da-lu', icone: '1' })).corpo; assert.ok(svg.startsWith('<svg') && svg.includes('fill="#7a2e12"') && svg.includes('stroke="#fff8ef"') && svg.includes(L.ARTES.pao));
  assert.ok((await ch({ loja: 'horta', icone: '1' })).corpo.includes('#E9A862'), 'hortifruti leva o caixote colorido');
  const ruim = (await ch({ loja: 'ruim', icone: '1' })).corpo; assert.ok(!ruim.includes('script') && ruim.includes('fill="#1a3a2a"'), 'cor inválida cai na padrão');
  for (const q of [{ loja: 'banca' }, { loja: 'fechada' }, { loja: 'nao-existe' }, { loja: '../x' }, {}]) assert.strictEqual((await ch(q)).status, 404, JSON.stringify(q));
  assert.strictEqual((await ch({ loja: 'pao-da-lu' }, 'POST')).status, 405);
});

teste('avaliação: só a dona do pedido, uma vez, de 1 a 5; entra na média da loja', async () => {
  const db = criarBanco(semente()); const adm = criarAdmin(db, { ...TOKENS, outra: { uid: 'c2' } });
  const checkout = carregarApi(raiz('api/checkout.js'), adm), api = carregarApi(raiz('api/cancelar-pedido.js'), adm);
  const fazer = async (loja) => { const p = pedido(); await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente', ...(loja ? { 'X-Loja': loja } : {}) }, body: p }); return p.idempotencyKey; };
  const av = (tk, body, loja) => chamar(api, { headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(loja ? { 'X-Loja': loja } : {}) }, body: { acao: 'avaliar', ...body } });
  const id = await fazer();
  assert.strictEqual((await av('', { pedidoId: id, nota: 5 })).status, 401);
  assert.notStrictEqual((await av('outra', { pedidoId: id, nota: 1 })).status, 200, 'outra pessoa não avalia o meu pedido');
  for (const ruim of [0, 6, 4.5, 'cinco', null]) assert.strictEqual((await av('cliente', { pedidoId: id, nota: ruim })).status, 400, String(ruim));
  assert.strictEqual(db._dados.get(`pedidos/${id}`).avaliacao, undefined);
  const ok = await av('cliente', { pedidoId: id, nota: 4, texto: '  Veio <b>ótimo</b>,\n só faltou a salsa ' }); assert.strictEqual(ok.status, 200, JSON.stringify(ok.corpo));
  const g = db._dados.get(`pedidos/${id}`).avaliacao; assert.strictEqual(g.nota, 4); assert.ok(!/[<>\n]/.test(g.texto) && g.texto.includes('salsa'), g.texto);
  assert.strictEqual(db._dados.get(`pedidos/${id}`).status, 'pendente', 'avaliar não mexe no pedido');
  assert.notStrictEqual((await av('cliente', { pedidoId: id, nota: 1 })).status, 200, 'não avalia duas vezes');
  // média pública: só soma e quantidade
  const id2 = await fazer(); await av('cliente', { pedidoId: id2, nota: 5 });
  const media = db._dados.get('loja/avaliacoes'); assert.strictEqual(media.n, 2); assert.strictEqual(media.soma, 9); assert.strictEqual(media.media, 4.5); assert.ok(!JSON.stringify(media).includes('salsa'));
  // pedido cancelado não recebe nota; e a nota de uma loja não entra na média de outra
  const id3 = await fazer(); await chamar(api, { headers: { Authorization: 'Bearer cliente' }, body: { pedidoId: id3 } });
  assert.notStrictEqual((await av('cliente', { pedidoId: id3, nota: 5 })).status, 200);
  const idE = await fazer('espetinhos'); assert.strictEqual((await av('cliente', { pedidoId: idE, nota: 2 }, 'espetinhos')).status, 200);
  assert.strictEqual(db._dados.get('tenants/espetinhos/loja/avaliacoes').n, 1); assert.strictEqual(db._dados.get('loja/avaliacoes').n, 2);
  assert.notStrictEqual((await av('cliente', { pedidoId: idE, nota: 2 })).status, 200, 'na loja errada o pedido não existe');
});

teste('atalhos: lista da semana, pedir de novo com o catálogo de hoje e convite para avaliar', async () => {
  const A = await import(raiz('js/atalhos-lib.js'));
  const quinta = new Date(2026, 9, 8, 9);
  const lista = A.listaDoCarrinho([{ id: 'tomate', qtd: 1.5, tipo: 'kg', nome: 'Tomate', preco: 8.9, foto: 'x' }, { id: 'ovos', qtd: 2, tipo: 'un', nome: 'Ovos' }], quinta);
  assert.deepStrictEqual(lista.itens, [{ id: 'tomate', qtd: 1.5, tipo: 'kg', nome: 'Tomate' }, { id: 'ovos', qtd: 2, tipo: 'un', nome: 'Ovos' }], 'guarda só o necessário, sem preço');
  assert.strictEqual(lista.dia, 4); assert.strictEqual(A.nomeDoDia(lista.dia), 'quinta');
  for (const ruim of [null, {}, { itens: [] }, { itens: [{ id: '', qtd: 1 }] }, { itens: [{ id: 'a', qtd: 0 }] }, { itens: 'x' }]) assert.strictEqual(A.listaValida(ruim), null, JSON.stringify(ruim));
  assert.strictEqual(A.listaValida({ itens: [{ id: 'a', qtd: 1 }], dia: 9 }).dia, null);
  // pôr no pedido: preço e dados de HOJE; o que saiu do catálogo ou está inativo vira "em falta"
  const hoje = [{ id: 'tomate', nome: 'Tomate italiano', preco: 9.9, unidade: 'kg', ativo: true }, { id: 'ovos', nome: 'Ovos', preco: 15, unidade: 'un', ativo: false }];
  const { entram, faltam } = A.separar([...lista.itens, { id: 'sumiu', qtd: 1, nome: 'Couve' }], hoje);
  assert.strictEqual(entram.length, 1); assert.strictEqual(entram[0].preco, 9.9); assert.strictEqual(entram[0].qtd, 1.5); assert.strictEqual(entram[0].tipo, 'kg');
  assert.deepStrictEqual(faltam, ['Ovos', 'Couve']);
  assert.strictEqual(A.mesmoConjunto([{ id: 'a', qtd: 1, tipo: 'un' }, { id: 'b', qtd: 2, tipo: 'kg' }], [{ id: 'b', qtd: 2, tipo: 'kg' }, { id: 'a', qtd: 1, tipo: 'un' }]), true);
  assert.strictEqual(A.mesmoConjunto([{ id: 'a', qtd: 1, tipo: 'un' }], [{ id: 'a', qtd: 2, tipo: 'un' }]), false);
  // convite para avaliar: nem cedo demais (ainda não chegou), nem tarde demais, nem duas vezes
  const agora = Date.parse('2026-10-08T12:00:00Z'), ha = (h) => ({ data: new Date(agora - h * 3600000).toISOString() });
  assert.strictEqual(A.podeConvidarAvaliar(ha(1), agora), false); assert.strictEqual(A.podeConvidarAvaliar(ha(5), agora), true); assert.strictEqual(A.podeConvidarAvaliar(ha(24 * 5), agora), false);
  assert.strictEqual(A.podeConvidarAvaliar({ ...ha(5), avaliado: 5 }, agora), false); assert.strictEqual(A.podeConvidarAvaliar({ ...ha(5), cancelado: true }, agora), false);
  assert.strictEqual(A.textoDaNota({ soma: 19, n: 4 }), '', 'com menos de 5 avaliações não mostra nota'); assert.strictEqual(A.textoDaNota({ soma: 47, n: 10 }), '4,7 de 5 em 10 avaliações'); assert.strictEqual(A.textoDaNota(null), '');
});

teste('prudência: limite contado no banco, alerta de falha com intervalo e cópia de segurança diária', async () => {
  const P = require(raiz('lib/prudencia')), T = require(raiz('lib/tenant'));
  // 1) LIMITE: 8 pedidos por conexão em 10 min; o 9º é barrado; outra conexão e outra loja não pagam por isso
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const mandar = (ipTxt, extra) => chamar(api, { headers: { 'x-forwarded-for': ipTxt }, body: pedido(extra) });
  // (o 2º endereço muda só para passar pela trava antiga de 5 s, que fica na memória; a conta nova usa o 1º, o de quem compra)
  for (let i = 0; i < 8; i++) assert.strictEqual((await mandar('200.1.1.1, 10.0.0.' + i)).status, 200, 'pedido ' + (i + 1));
  const nono = await mandar('200.1.1.1, 10.0.0.99'); assert.strictEqual(nono.status, 429); assert.ok(/Aguarde/.test(nono.corpo.error));
  assert.strictEqual((await mandar('200.2.2.2')).status, 200, 'outra conexão segue comprando');
  assert.strictEqual([...db._dados.keys()].filter((k) => k.startsWith('pedidos/')).length, 9, 'o pedido barrado não foi gravado');
  assert.ok([...db._dados.keys()].some((k) => k.startsWith('limites/pedido_')), 'a conta fica no banco');
  // a janela passa e a pessoa volta a comprar; a faxina apaga as contagens vencidas
  const depois = Date.now() + 601000;
  assert.strictEqual(await P.limitar(db, 'pedido', 'banca|200.1.1.1', 8, 600, depois), true);
  assert.ok((await P.limparLimites(db, depois + 601000)) >= 1); assert.ok(![...db._dados.keys()].some((k) => k.startsWith('limites/')));
  // banco fora do ar nunca impede venda
  assert.strictEqual(await P.limitar({ collection: () => { throw new Error('fora'); } }, 'pedido', 'x', 1, 60), true);

  // 2) ALERTA: só falha interna avisa, e no máximo uma vez a cada 30 min por assunto
  assert.strictEqual(P.ehFalhaInterna(new Error('Tomate esgotou.')), false); assert.strictEqual(P.ehFalhaInterna(new TypeError('x')), true);
  assert.strictEqual(P.ehFalhaInterna(Object.assign(new Error('UNAVAILABLE'), { code: 14 })), true); assert.strictEqual(P.ehFalhaInterna(Object.assign(new Error('Loja fechada'), { status: 403, code: 'x' })), false);
  const agora = Date.now();
  assert.strictEqual((await P.avisarFalha(db, 'banca', 'O envio de pedidos', new Error('caiu'), agora)).avisou, true);
  assert.strictEqual((await P.avisarFalha(db, 'banca', 'O envio de pedidos', new Error('caiu'), agora + 60000)).avisou, false, 'dentro de 30 min não repete');
  assert.strictEqual((await P.avisarFalha(db, 'banca', 'A venda no balcão', new Error('caiu'), agora + 60000)).avisou, true, 'outro assunto avisa');
  assert.strictEqual((await P.avisarFalha(db, 'banca', 'O envio de pedidos', new Error('caiu'), agora + 31 * 60000)).avisou, true);
  // falha interna no pedido: a cliente vê frase simples (não o erro técnico) e a equipe é avisada
  const dbRuim = criarBanco(semente()); const apiRuim = carregarApi(raiz('api/checkout.js'), criarAdmin(dbRuim, TOKENS));
  const tx = dbRuim.runTransaction.bind(dbRuim); let n = 0;
  dbRuim.runTransaction = async (fn) => { n++; if (n === 2) throw Object.assign(new Error('14 UNAVAILABLE: segredo interno'), { code: 14 }); return tx(fn); };   // a 1ª transação é a do limite
  const ruim = await chamar(apiRuim, { headers: ip(), body: pedido() });
  assert.strictEqual(ruim.status, 500); assert.ok(!/UNAVAILABLE|segredo/.test(ruim.corpo.error), ruim.corpo.error);
  assert.ok(dbRuim._dados.has('plataforma/alertas'), 'o alerta ficou registrado');

  // 3) CÓPIA: produtos, configuração e pedidos recentes; as mais velhas que 7 saem; a rotina diária faz sozinha
  const d2 = criarBanco({ ...semente(), 'pedidos/novo': { nome: 'Ana', total: 10, data: new Date().toISOString() }, 'pedidos/velho': { nome: 'Bia', total: 5, data: '2020-01-01T10:00:00.000Z' },
    'tenants/espetinhos': { nome: 'Espetinhos', ativo: true }, 'tenants/espetinhos/produtos/carne': { nome: 'Espeto', preco: 9, ativo: true } });
  const ex = await P.exportar(d2, 'banca'); assert.ok(ex.colecoes.produtos.tomate, 'produto na cópia'); assert.ok(ex.colecoes.pedidos.novo && !ex.colecoes.pedidos.velho, 'pedidos: só os últimos 90 dias');
  assert.ok(!JSON.stringify(ex).includes('Espeto'), 'a cópia de uma loja não leva dado de outra');
  const exE = await P.exportar(d2, 'espetinhos'); assert.strictEqual(exE.colecoes.produtos.carne.nome, 'Espeto'); assert.strictEqual(exE.ficha.nome, 'Espetinhos');
  for (let i = 0; i < 9; i++) await P.copiar(d2, 'banca', new Date(Date.UTC(2026, 9, 1 + i, 8)));
  const guardadas = [...d2._dados.keys()].filter((k) => /^backups\/banca_[\d-]+$/.test(k)).sort();
  assert.strictEqual(guardadas.length, P.GUARDAR); assert.strictEqual(guardadas[0], 'backups/banca_2026-10-03'); assert.ok(!d2._dados.has('backups/banca_2026-10-01/partes/000'), 'as partes da cópia velha saíram junto');
  const montada = JSON.parse([...d2._dados.keys()].filter((k) => k.startsWith('backups/banca_2026-10-09/partes/')).sort().map((k) => d2._dados.get(k).t).join(''));
  assert.strictEqual(montada.colecoes.produtos.tomate.nome, ex.colecoes.produtos.tomate.nome, 'a cópia guardada remonta inteira');
  assert.strictEqual((await P.ultimaCopia(d2, 'banca')).dia, '2026-10-09'); assert.strictEqual(await P.ultimaCopia(d2, 'espetinhos'), null);
  // o proprietário baixa pelo painel; caixa não
  const eq = carregarApi(raiz('api/equipe.js'), criarAdmin(d2, { dono: { uid: 'a-1', admin: true }, caixa: { uid: 'c-1', tenants: { banca: 'caixa' } } }));
  const ce = (tk, body) => chamar(eq, { headers: { authorization: `Bearer ${tk}` }, body });
  assert.strictEqual((await ce('caixa', { acao: 'copia-baixar' })).status, 403);
  const baixada = await ce('dono', { acao: 'copia-baixar' }); assert.strictEqual(baixada.status, 200); assert.ok(baixada.corpo.copia.colecoes.produtos.tomate);
  assert.strictEqual((await ce('dono', { acao: 'copia-estado' })).corpo.ultima.guardadas, P.GUARDAR);
});

teste('fotos: envio ao ImgBB só para gestor, só imagem de verdade, e a chave nunca volta para a tela', async () => {
  const db = criarBanco({ 'tenants/espetinhos': { nome: 'Espetinhos', ativo: true } });
  const tokens = { super: { uid: 's-1', plataforma: true }, dono: { uid: 'd-1', tenants: { espetinhos: 'proprietario' } }, caixa: { uid: 'c-1', tenants: { espetinhos: 'caixa' } }, antigo: { uid: 'a-1', admin: true } };
  const adm = criarAdmin(db, tokens), foto = carregarApi(raiz('api/foto.js'), adm), plat = carregarApi(raiz('api/plataforma.js'), adm);
  const ch = (tk, body, loja) => chamar(foto, { headers: { authorization: `Bearer ${tk}`, ...(loja ? { 'x-loja': loja } : {}) }, body });
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40, 7)]).toString('base64');
  const CHAVE = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', fetchReal = global.fetch, idas = []; let resposta = { ok: true, status: 200, corpo: { success: true, data: { url: 'https://i.ibb.co/abc/tomate.webp' } } };
  global.fetch = async (url, o) => { idas.push({ url: String(url), corpo: String(o.body) }); return { ok: resposta.ok, status: resposta.status, json: async () => resposta.corpo }; };
  try {
    delete process.env.IMGBB_API_KEY;
    assert.strictEqual((await ch('', { imagem: webp }, 'espetinhos')).status, 401);
    assert.strictEqual((await ch('caixa', { imagem: webp }, 'espetinhos')).status, 403, 'caixa não envia foto');
    assert.strictEqual((await ch('dono', { imagem: webp })).status, 403, 'dono de uma loja não envia na loja original');
    // sem chave: avisa com um código que o painel entende, e não chama ninguém
    const sem = await ch('dono', { imagem: webp }, 'espetinhos'); assert.strictEqual(sem.status, 503); assert.strictEqual(sem.corpo.codigo, 'sem-imgbb'); assert.strictEqual(idas.length, 0);
    assert.strictEqual((await ch('dono', { acao: 'estado' }, 'espetinhos')).corpo.ligado, false);
    // a chave entra pela tela Plataforma, só pelo dono da plataforma, e a lista só diz SE existe
    const cp = (tk, body) => chamar(plat, { headers: { authorization: `Bearer ${tk}` }, body });
    assert.strictEqual((await cp('dono', { acao: 'imgbb', chave: CHAVE })).status, 403);
    assert.strictEqual((await cp('super', { acao: 'imgbb', chave: 'curta' })).status, 400);
    assert.strictEqual((await cp('super', { acao: 'imgbb', chave: CHAVE })).status, 200);
    const lista = (await cp('super', { acao: 'lojas' })).corpo; assert.strictEqual(lista.fotos, true); assert.ok(!JSON.stringify(lista).includes(CHAVE), 'a chave não volta para a tela');
    foto._zerar();
    // agora envia: a foto segue para o ImgBB com a chave, e volta só o link
    const ok = await ch('dono', { imagem: webp, nome: 'Tomate Italiano!' }, 'espetinhos'); assert.strictEqual(ok.status, 200, JSON.stringify(ok.corpo)); assert.strictEqual(ok.corpo.url, 'https://i.ibb.co/abc/tomate.webp');
    assert.strictEqual(idas.length, 1); assert.ok(idas[0].url.startsWith('https://api.imgbb.com/1/upload')); assert.ok(idas[0].corpo.includes('key=' + CHAVE) && idas[0].corpo.includes('name=espetinhos-tomate-italiano'));
    assert.ok(!JSON.stringify(ok.corpo).includes(CHAVE));
    assert.strictEqual((await ch('antigo', { imagem: webp })).status, 200, 'a conta antiga envia na loja original');
    // o que não é imagem não passa (o servidor olha os bytes, não o nome)
    for (const ruim of ['', 'não é base64 !!!', Buffer.from('<script>alert(1)</script> isto não é imagem').toString('base64'), Buffer.alloc(1.6 * 1024 * 1024, 1).toString('base64')])
      assert.strictEqual((await ch('dono', { imagem: ruim }, 'espetinhos')).status, 400, ruim.slice(0, 20));
    assert.strictEqual(idas.length, 2, 'nada inválido chegou ao ImgBB');
    // ImgBB fora do ar, ou devolvendo link estranho: erro claro, sem gravar lixo
    resposta = { ok: false, status: 500, corpo: null }; assert.strictEqual((await ch('dono', { imagem: webp }, 'espetinhos')).status, 502);
    resposta = { ok: true, status: 200, corpo: { success: true, data: { url: 'javascript:alert(1)' } } }; assert.strictEqual((await ch('dono', { imagem: webp }, 'espetinhos')).status, 502);
    assert.strictEqual(foto.tipoDaImagem(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpg');
  } finally { global.fetch = fetchReal; }
});

teste('fotos: miniatura só para link https em produção, nas larguras que a Vercel aceita', async () => {
  const F = await import(raiz('js/foto-lib.js')), V = JSON.parse(require('fs').readFileSync(raiz('vercel.json'), 'utf8'));
  assert.deepStrictEqual(V.images.sizes, F.LARGURAS, 'vercel.json e js/foto-lib.js com as mesmas larguras');
  const u = 'https://fotos.exemplo.com/a/tomate.jpg?x=1&y=2';
  assert.strictEqual(F.miniatura(u, 384, 'site-banca1.vercel.app'), '/_vercel/image?url=' + encodeURIComponent(u) + '&w=384&q=75');
  assert.ok(F.miniatura(u, 128, 'www.loja.com.br').includes('&w=128&'));
  assert.ok(F.miniatura(u, 999, 'www.loja.com.br').includes('&w=384&'), 'largura fora da lista cai na padrão');
  for (const host of ['localhost', '127.0.0.1', '192.168.0.10', '']) assert.strictEqual(F.miniatura(u, 384, host), u, host);
  for (const fica of ['', null, 'data:image/png;base64,AAAA', 'blob:https://x/1', 'http://sem-s.com/a.jpg', 'https://x.com/logo.svg', 'https://x.com/a.jpg" onerror="x']) assert.strictEqual(F.miniatura(fica, 384, 'www.loja.com.br'), String(fica || ''));
});

teste('cabeçalho: cada tipo de negócio tem o seu desenho', async () => {
  const A = await import(raiz('js/arte-lib.js'));
  const casos = { hortifruti: 'caixote', 'Feira de Frutas': 'caixote', espetinhos: 'espeto', jantinha: 'prato', Padaria: 'pao', 'Pães': 'pao', 'Açaí': 'tigela', Pizzaria: 'pizza', 'Hambúrgueres': 'burger', Confeitaria: 'doce', Doces: 'doce', Bolo: 'bolo', Bolos: 'bolo', 'Sucos e Cafés': 'copo', 'Creme e suco': 'copo', Crepe: 'crepe', Pastel: 'pastel', 'Pastéis': 'pastel', 'Macarrão': 'macarrao', 'Caldo de cana': 'cana', Caldos: 'tigela', 'Queijo/ovos/mel e doces da roça': 'queijo', 'Banca do queijo': 'queijo', Mel: 'queijo', Pamonha: 'pamonha', 'Cachorro quente': 'hotdog', 'Loja de Presentes': 'sacola', '': 'sacola' };
  for (const [tipo, esperado] of Object.entries(casos)) assert.strictEqual(A.arteDoTipo(tipo), esperado, tipo);
  for (const [nome, html] of Object.entries(A.ARTES)) assert.ok(html.length > 40 && !/<script|on\w+=|href/i.test(html), nome);
  assert.ok(Object.values(casos).every((q) => q === 'caixote' || A.ARTES[q]));
});

teste('plataforma: modelos iguais nos dois lados, endereço sugerido e abas por módulo', async () => {
  const L = await import(raiz('js/plataforma-lib.js')), Tm = await import(raiz('js/tema.js')).catch(() => null), M = require(raiz('lib/modelos')), P = await import(raiz('js/papeis-lib.js')), T = require(raiz('lib/tenant'));
  if (Tm) assert.deepStrictEqual(JSON.parse(JSON.stringify(Tm.MODELOS)), M.MODELOS, 'js/tema.js e lib/modelos.js têm os mesmos modelos');
  else assert.ok(require('fs').readFileSync(raiz('js/tema.js'), 'utf8').includes(JSON.stringify(M.MODELOS.jantinha.primaria).replace(/"/g, "'")));
  assert.strictEqual(L.sugerirId('  Espetinhos do Zé!! '), 'espetinhos-do-ze'); assert.strictEqual(L.sugerirId('Açaí & Cia'), 'acai-cia'); assert.ok(T.idValido(L.sugerirId('Jantinha da Lú — Setor Bueno 2')));
  assert.strictEqual(L.idValido(L.sugerirId('x'.repeat(80))), true); assert.strictEqual(L.idValido(''), false);
  assert.deepStrictEqual(L.totais([{ ativo: true, mes: { receita: 10.1, pedidos: 2 } }, { ativo: false, mes: null }, { ativo: true, mes: { receita: 5.2, pedidos: 1 } }]), { lojas: 3, ativas: 2, receita: 15.3, pedidos: 3 });
  const todas = ['produtos', 'pdv', 'estoque', 'compras', 'crm', 'copiloto', 'calendario', 'relatorios', 'cupons', 'equipe'];
  assert.deepStrictEqual(P.abasDoPapel('proprietario', todas, { pdv: false, estoque: false }), ['produtos', 'crm', 'copiloto', 'calendario', 'relatorios', 'cupons', 'equipe']);
  assert.deepStrictEqual(P.abasDoPapel('caixa', todas, { pdv: false }), ['relatorios']); assert.deepStrictEqual(P.abasDoPapel('caixa', todas, null), ['pdv', 'relatorios']);
  for (const m of Object.values(P.MODULO_DA_ABA)) assert.ok(M.MODULOS[m], `módulo ${m} existe na plataforma`);
});

// ------------------------------------------------------------------ subdomínio e domínio próprio
teste('endereços: subdomínio e domínio próprio dizem a loja; o endereço de uma loja nunca abre outra', async () => {
  const E = await import(raiz('js/enderecos-lib.js')), T = require(raiz('lib/tenant'));
  const cfg = { base: 'MinhaPlataforma.com.br', proprios: E.lerProprios(' BancaAdairEPedrina.com.br = banca , www.espetinhosdoze.com.br=espetinhos-do-ze, lixo, a.com=ID INVALIDO') };
  assert.deepStrictEqual(cfg.proprios, { 'bancaadairepedrina.com.br': 'banca', 'espetinhosdoze.com.br': 'espetinhos-do-ze' });
  const env = { VITE_DOMINIO_LOJAS: 'minhaplataforma.com.br', VITE_DOMINIOS_PROPRIOS: 'bancaadairepedrina.com.br=banca, espetinhosdoze.com.br=espetinhos-do-ze' };
  const casos = [['acai-da-praca.minhaplataforma.com.br', 'acai-da-praca'], ['ACAI-da-praca.minhaplataforma.com.br:443', 'acai-da-praca'], ['www.espetinhosdoze.com.br', 'espetinhos-do-ze'], ['bancaadairepedrina.com.br', 'banca'],
    ['minhaplataforma.com.br', null], ['www.minhaplataforma.com.br', null], ['admin.minhaplataforma.com.br', null], ['api.minhaplataforma.com.br', null], ['a.b.minhaplataforma.com.br', null], ['x.minhaplataforma.com.br', null],
    ['site-banca1.vercel.app', null], ['localhost', null], ['acai.outraplataforma.com.br', null], ['minhaplataforma.com.br.golpe.com', null], ['fakeminhaplataforma.com.br', null], ['', null]];
  for (const [host, esperado] of casos) { assert.strictEqual(E.lojaDoHost(host, cfg), esperado, `navegador: ${host}`); assert.strictEqual(T.lojaDoHost(host, env), esperado, `servidor: ${host}`); }
  assert.deepStrictEqual([...E.RESERVADOS].sort(), [...require('fs').readFileSync(raiz('lib/tenant.js'), 'utf8').match(/const RESERVADOS = (\[[^\]]+\])/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort());
  // ?loja= só vale onde o endereço não é de uma loja
  assert.strictEqual(E.lojaDoEndereco({ hostname: 'minhaplataforma.com.br', search: '?loja=acai-da-praca' }, cfg), 'acai-da-praca');
  assert.strictEqual(E.lojaDoEndereco({ hostname: 'site-banca1.vercel.app', search: '?x=1&loja=Acai-da-praca' }, cfg), 'acai-da-praca');
  assert.strictEqual(E.lojaDoEndereco({ hostname: 'acai-da-praca.minhaplataforma.com.br', search: '?loja=espetinhos-do-ze' }, cfg), 'acai-da-praca', 'subdomínio manda');
  assert.strictEqual(E.lojaDoEndereco({ hostname: 'bancaadairepedrina.com.br', search: '?loja=espetinhos-do-ze' }, cfg), 'banca', 'domínio próprio manda');
  assert.strictEqual(E.lojaDoEndereco({ hostname: 'localhost', search: '?loja=<script>' }, cfg), 'banca');
  // desligado (sem variáveis): tudo como antes
  assert.strictEqual(E.lojaDoEndereco({ hostname: 'acai.qualquer.com', search: '?loja=acai-da-praca' }, { base: '', proprios: {} }), 'acai-da-praca');
  assert.strictEqual(E.enderecoDaLoja('acai-da-praca', '/', { hostname: 'bancaadairepedrina.com.br' }, { base: '', proprios: {} }), '/?loja=acai-da-praca');
  assert.strictEqual(E.enderecoDaLoja('banca', '/admin.html', { hostname: 'x.com' }, { base: '', proprios: {} }), '/admin.html');
  // ligado: endereço completo
  const de = (id, pag, host) => E.enderecoDaLoja(id, pag, { hostname: host }, cfg);
  assert.strictEqual(de('acai-da-praca', '/', 'www.minhaplataforma.com.br'), 'https://acai-da-praca.minhaplataforma.com.br/');
  assert.strictEqual(de('acai-da-praca', './admin.html', 'jantinha.minhaplataforma.com.br'), 'https://acai-da-praca.minhaplataforma.com.br/admin.html');
  assert.strictEqual(de('espetinhos-do-ze', '/', 'minhaplataforma.com.br'), 'https://espetinhosdoze.com.br/', 'quem tem domínio próprio usa o dele');
  assert.strictEqual(de('banca', './', 'acai-da-praca.minhaplataforma.com.br'), 'https://bancaadairepedrina.com.br/');
  assert.strictEqual(de('acai-da-praca', '/', 'bancaadairepedrina.com.br'), 'https://acai-da-praca.minhaplataforma.com.br/', 'a feira troca de loja a partir de um domínio próprio');
  assert.strictEqual(de('acai-da-praca', '/', 'site-banca1.vercel.app'), '/?loja=acai-da-praca', 'fora do domínio da plataforma, continua o jeito antigo');
  assert.strictEqual(de('admin', '/', 'minhaplataforma.com.br'), 'https://minhaplataforma.com.br/?loja=admin', 'id igual a nome reservado não vira subdomínio');
});
teste('endereços: no servidor, o subdomínio vence o cabeçalho X-Loja', () => {
  const antes = { a: process.env.VITE_DOMINIO_LOJAS, b: process.env.VITE_DOMINIOS_PROPRIOS };
  process.env.VITE_DOMINIO_LOJAS = 'minhaplataforma.com.br'; process.env.VITE_DOMINIOS_PROPRIOS = 'bancaadairepedrina.com.br=banca';
  try {
    const T = require(raiz('lib/tenant'));
    assert.strictEqual(T.tenantDaRequisicao({ headers: { host: 'loja-a.minhaplataforma.com.br', 'x-loja': 'loja-b' }, body: { tenantId: 'loja-b' } }), 'loja-a');
    assert.strictEqual(T.tenantDaRequisicao({ headers: { 'x-forwarded-host': 'loja-a.minhaplataforma.com.br', host: 'interno.vercel.app' } }), 'loja-a');
    assert.strictEqual(T.tenantDaRequisicao({ headers: { host: 'bancaadairepedrina.com.br', 'x-loja': 'loja-b' } }), 'banca');
    assert.strictEqual(T.tenantDaRequisicao({ headers: { host: 'www.minhaplataforma.com.br', 'x-loja': 'loja-b' } }), 'loja-b', 'no domínio da plataforma o cabeçalho continua valendo');
    assert.strictEqual(T.tenantDaRequisicao({ headers: { host: 'site-banca1.vercel.app' } }), 'banca');
  } finally { for (const [k, v] of [['VITE_DOMINIO_LOJAS', antes.a], ['VITE_DOMINIOS_PROPRIOS', antes.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

// ------------------------------------------------------------------ ícones do painel
teste('ícones: todo ícone pedido no painel existe, e nenhuma tela do painel voltou a usar emoji', async () => {
  const I = await import(raiz('js/icones-admin.js')), fs = require('fs');
  const arquivos = ['admin.html', 'plataforma.html'].concat(fs.readdirSync(raiz('js')).filter((f) => /^admin.*\.js$|^plataforma\.js$/.test(f)).map((f) => `js/${f}`));
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FF}]/u, sai = /L\.push\(|\['[a-z -]+', '|return achou/;   // mensagens de WhatsApp continuam com emoji
  let usados = 0;
  for (const f of arquivos) fs.readFileSync(raiz(f), 'utf8').split('\n').forEach((l, n) => {
    for (const m of l.matchAll(/data-i=["']([A-Za-z]+)["']/g)) { usados++; assert.ok(I.ico(m[1]).includes('<path') || I.ico(m[1]).includes('<circle'), `${f}:${n + 1} pede o ícone "${m[1]}", que não existe`); }
    const t = l.trim(); if (t.startsWith('//') || t.startsWith('<!--') || t.startsWith('*') || sai.test(l)) return;
    assert.ok(!emoji.test(l), `${f}:${n + 1} tem emoji: ${t.slice(0, 60)}`);
    assert.ok(!/=\s*"[^"\n]*<i class="ic"/.test(l), `${f}:${n + 1}: marca de ícone com aspas duplas dentro de texto com aspas duplas (quebra o arquivo)`);
  });
  assert.ok(usados > 60, `ícones em uso: ${usados}`);
  const abas = [...fs.readFileSync(raiz('admin.html'), 'utf8').matchAll(/class="tab[^"]*" data-aba="([a-z]+)"><span class="tab-ico" aria-hidden="true"><i class="ic" data-i="([a-z]+)">/g)];
  assert.strictEqual(abas.length, 17); abas.forEach((m) => assert.strictEqual(m[1], m[2], 'cada aba usa o ícone com o próprio nome'));
  for (const [nome, d] of Object.entries(I.ICONES)) { assert.ok(!/<script|on\w+=|href/i.test(d), nome); assert.ok((d.match(/class="s"/g) || []).length <= 3, `${nome}: semente demais`); }
});

// ------------------------------------------------------------------ impressão
teste('impressão: o cupom cabe na largura do papel e traz os valores do pedido', async () => {
  const I = await import(raiz('js/impressao-lib.js'));
  const p = { id: 'abcXYZ123456', data: '2026-10-05T15:30:00Z', nome: 'Maria Silva', condominio: 'Jardins Munique', formatoEndereco: 'rua', quadra: 'Alameda das Alpíneas', lote: '12', pag: 'Dinheiro', troco: 'R$ 100,00', obs: 'Tocar o interfone',
    itens: [{ nome: 'Tomate italiano', qtd: 1.5, unidade: 'kg', tipo: 'kg', subtotal: 13.35 }, { nome: 'Molho de tomate caseiro 350 g da casa especial', qtd: 2, unidade: 'un', tipo: 'un', subtotal: 36 }, { nome: 'Banana prata', qtd: 6, unidade: 'kg', tipo: 'un', aPesar: true, subtotal: 0 }], total: 44.35, cupom: { codigo: 'BEMVINDO', desconto: 5 } };
  for (const largura of [58, 80]) {
    const n = I.colunasDe(largura), linhas = I.compor(I.cupomDoPedido(p, { loja: 'Banca Adair e Pedrina' }), n);
    linhas.forEach((l) => { if (!l.corte) assert.ok(l.s.length <= (l.g ? Math.floor(n / 2) : n), `${largura} mm: "${l.s}"`); });
  }
  const t = I.paraTexto(I.cupomDoPedido(p, { loja: 'Banca Adair e Pedrina' }), 32);
  for (const pedaco of ['Pedido 123456', '05/10/2026 12:30', 'Maria Silva', 'nº 12', '1,5 kg Tomate italiano  R$ 13,35', 'a pesar', 'Subtotal                R$ 49,35', 'Cupom BEMVINDO          -R$ 5,00', 'PARCIAL R$ 44,35', 'Troco para: R$ 100,00', 'Obs: Tocar o interfone']) assert.ok(t.includes(pedaco), `falta "${pedaco}" em:\n${t}`);
  // total alto não quebra a palavra TOTAL no meio
  assert.ok(I.paraTexto(I.cupomDoPedido({ itens: [], total: 12345.6 }), 32).includes('TOTAL               R$ 12.345,60'));
  // texto do cliente não vira comando da impressora
  const sujo = I.paraEscPos(I.cupomDoPedido({ nome: 'A\u001b@\u001dV\u0000B', itens: [], total: 1 }), {});
  assert.strictEqual([...sujo].filter((x, i) => x === 0x1b && sujo[i + 1] === 0x40).length, 1, 'só o ESC @ do começo');
  const e = I.etiquetaDeEntrega({ ...p, pagamento: { status: 'PAID' } }, {}); assert.ok(I.paraTexto(e, 32).includes('JÁ PAGO') && !I.paraTexto(e, 32).includes('Troco'));
  const lote = I.paraTexto(I.etiquetaDeLote({ nome: 'Molho de tomate', lote: '261005-01', fabricadoEm: '2026-10-05', validade: '2026-11-04', preco: 18 }), 32);
  assert.ok(lote.includes('261005-01') && lote.includes('04/11/2026') && lote.includes('R$ 18,00'));
});
teste('impressão: comandos da térmica (ESC/POS), acentos e página comum', async () => {
  const I = await import(raiz('js/impressao-lib.js'));
  const linhas = [{ t: 'txt', v: 'Pão de açúcar', b: true }, { t: 'par', e: 'TOTAL', d: 'R$ 1,00', g: true }, { t: 'corte' }];
  const sem = [...I.paraEscPos(linhas, { largura: 58 })], txt = String.fromCharCode(...sem);
  assert.deepStrictEqual(sem.slice(0, 2), [0x1b, 0x40]); assert.ok(txt.includes('Pao de acucar') && sem.every((x) => x < 0x80), 'sem acento: só letras simples');
  assert.ok(txt.includes('\x1bE\x01') && txt.includes('\x1d!\x11') && txt.includes('\x1dVB\x00'), 'negrito, letra grande e corte');
  const com = [...I.paraEscPos(linhas, { largura: 58, acentos: true })];
  assert.deepStrictEqual(com.slice(2, 5), [0x1b, 0x74, 0x03], 'escolhe a tabela 860'); assert.ok(com.includes(0x84) && com.includes(0x87) && com.includes(0xa3), 'ã ç ú na tabela 860');
  assert.ok(!String.fromCharCode(...I.paraEscPos(linhas, { cortar: false })).includes('\x1dVB'));
  const partes = I.fatiar(Uint8Array.from(sem), 20); assert.ok(partes.every((x) => x.length <= 20)); assert.strictEqual(partes.reduce((t, x) => t + x.length, 0), sem.length);
  assert.strictEqual(Buffer.from(I.paraBase64(Uint8Array.from(sem)), 'base64').length, sem.length);
  const html = I.paraHtml([[{ t: 'txt', v: '<img src=x onerror=alert(1)>' }], linhas], { largura: 80 });
  assert.ok(html.includes('size: 80mm auto') && html.includes('&lt;img') && !html.includes('<img') && (html.match(/<section>/g) || []).length === 2);
  assert.ok(I.paraHtml([linhas], { largura: 'a4' }).includes('size: A4'));
});
teste('impressão: cada aparelho só oferece os caminhos que consegue usar', async () => {
  const M = await import(raiz('js/impressao-lib.js'));
  const iphone = M.suporte({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
  assert.strictEqual(iphone.sistema, ''); assert.ok(iphone.bluetooth && iphone.serial && iphone.app, 'no iPhone só a impressão do aparelho');
  const android = M.suporte({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', bluetooth: {} });
  assert.strictEqual(android.bluetooth, ''); assert.strictEqual(android.app, ''); assert.ok(android.serial);
  const pc = M.suporte({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', bluetooth: {}, serial: {} });
  assert.strictEqual(pc.serial, ''); assert.ok(pc.app);
});

// ------------------------------------------------------------------ fotos
teste('fotos: arquivo ruim é recusado com explicação; nome do arquivo acha o produto', async () => {
  const F = await import(raiz('js/fotos-lib.js'));
  assert.strictEqual(F.validarArquivo({ name: 'tomate.jpg', type: 'image/jpeg', size: 2400000 }), '');
  assert.match(F.validarArquivo({ name: 'IMG_0012.HEIC', type: '', size: 9 }), /HEIC/);
  assert.match(F.validarArquivo({ name: 'lista.pdf', type: 'application/pdf', size: 9 }), /Não é uma imagem/);
  assert.match(F.validarArquivo({ name: 'a.png', type: 'image/png', size: 0 }), /vazio/);
  assert.match(F.validarArquivo({ name: 'a.png', type: 'image/png', size: 30 * 1024 * 1024 }), /grande demais/);
  const prods = [{ id: 'a', nome: 'Tomate italiano' }, { id: 'b', nome: 'Tomate cereja' }, { id: 'c', nome: 'Alface crespa' }, { id: 'd', nome: 'Abacate' }];
  assert.strictEqual(F.produtoParecido('tomate-italiano.jpg', prods).id, 'a');
  assert.strictEqual(F.produtoParecido('Tomate Cereja (2).PNG', prods).id, 'b');
  assert.strictEqual(F.produtoParecido('ALFACE_CRESPA_final.webp', prods).id, 'c');
  assert.strictEqual(F.produtoParecido('abacate.jpg', prods).id, 'd');
  assert.strictEqual(F.produtoParecido('IMG_20261005_0934.jpg', prods), null, 'nome de câmera não casa com nada');
  assert.strictEqual(F.tamanhoBonito(2516582), '2,4 MB'); assert.strictEqual(F.tamanhoBonito(184320), '180 KB');
});
teste('fotos: envio que cai é repetido; fila respeita o limite de envios ao mesmo tempo', async () => {
  const F = await import(raiz('js/fotos-lib.js')); const semEspera = async () => {};
  let n = 0; assert.strictEqual(await F.comTentativas(async () => { if (++n < 3) throw new Error('caiu'); return 'ok'; }, 3, semEspera), 'ok'); assert.strictEqual(n, 3);
  n = 0; await assert.rejects(F.comTentativas(async () => { n++; throw new Error('caiu'); }, 3, semEspera), /caiu/); assert.strictEqual(n, 3);
  let ativos = 0, pico = 0; const feitos = [];
  await F.emFila([1, 2, 3, 4, 5, 6, 7], 3, async (x) => { pico = Math.max(pico, ++ativos); await new Promise((r) => setTimeout(r, 5)); ativos--; feitos.push(x); });
  assert.strictEqual(pico, 3); assert.strictEqual(feitos.length, 7);
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('  ok   ', nome); }
    catch (e) { falhas++; console.log('  FALHOU', nome, '\n        ', String(e.message).split('\n').slice(0, 6).join(' | '), (String(e.stack).match(/index\.js:\d+/) || [''])[0]); }
  }
  console.log(`\n${testes.length - falhas} de ${testes.length} testes passaram.`);
  process.exit(falhas ? 1 : 0);
})();
