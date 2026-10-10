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
teste('loja sem WhatsApp cadastrado não recebe pedido (nada de número de mentira) e a equipe é avisada', async () => {
  const antes = process.env.WHATSAPP_FALLBACK; delete process.env.WHATSAPP_FALLBACK;
  try {
    for (const wpp of [undefined, '', '123']) {
      const sem = semente(); sem['tenants/espetinhos/loja/config'] = { ...sem['tenants/espetinhos/loja/config'], wpp };
      const db = criarBanco(sem); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
      const p = pedido({ itens: [{ id: 'tomate', qtd: 1, tipo: 'un' }] });
      const r = await chamar(api, { headers: { ...ip(), 'X-Loja': 'espetinhos' }, body: p });
      assert.strictEqual(r.status, 503, String(wpp)); assert.strictEqual(r.corpo.codigo, 'sem-whatsapp');
      assert.ok(!db._dados.has(`tenants/espetinhos/pedidos/${p.idempotencyKey}`), 'o pedido não é gravado');
      assert.ok(![...db._dados.keys()].some((k) => k.startsWith('tenants/espetinhos/resumos/')), 'nem entra no caixa');
      assert.ok(!JSON.stringify(r.corpo).includes('5562999999999'));
    }
  } finally { if (antes !== undefined) process.env.WHATSAPP_FALLBACK = antes; }
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
teste('painel: quem cuida de duas bancas vê as duas no seletor; e-mail não confirmado não vê nenhuma', async () => {
  const P = await import(raiz('js/papeis-lib.js'));
  assert.deepStrictEqual(P.bancasDaConta({ tenants: { 'pastel-jardins': 'proprietario', 'pastel-parque': 'proprietario' } }), ['pastel-jardins', 'pastel-parque']);
  assert.deepStrictEqual(P.bancasDaConta({ admin: true, tenants: { banca: 'proprietario', 'x-y': 'caixa' } }), ['banca', 'x-y'], 'conta antiga + papel: sem repetir');
  assert.deepStrictEqual(P.bancasDaConta({ email_verified: false, tenants: { a1: 'proprietario' } }), []);
  assert.deepStrictEqual(P.bancasDaConta({ tenants: { 'ok-1': 'inventado', '../x': 'proprietario' } }), [], 'papel inventado ou id estranho fica de fora');
  assert.deepStrictEqual(P.bancasDaConta(null), []);
});
teste('feira do cliente: o link e o condomínio escolhem a feira; banca de outra feira não aparece; sem feira, vale o jeito antigo', async () => {
  const L = await import(raiz('js/plataforma-lib.js'));
  const pai = { id: 'quarta-pai', nome: 'Quarta do pai', dias: [3], lojas: [{ id: 'banca', nome: 'Banca' }, { id: 'pastel', nome: 'Pastel' }], condominios: ['Jardins Munique'] };
  const dele = { id: 'quarta-pastel', nome: 'Feira do pastel', dias: [3], lojas: [{ id: 'pastel', nome: 'Pastel' }, { id: 'queijo', nome: 'Queijo' }], condominios: ['Parque das Flores'] };
  assert.strictEqual(L.feiraDoCliente([pai, dele], 'quarta-pastel', 3).feira.id, 'quarta-pastel', 'na quarta, o cliente do pastel vê a feira do pastel, não a primeira');
  assert.strictEqual(L.feiraDoCliente([pai, dele], '', 3).doCliente, false, 'sem feira do cliente: jeito antigo');
  assert.strictEqual(L.feiraDoCliente([pai], 'quarta-pastel', 3).doCliente, false, 'feira do cliente que não é desta banca não vale aqui');
  assert.deepStrictEqual(L.feirasDoCondominio([pai, dele], '  JARDINS munique ').map((f) => f.id), ['quarta-pai']);
  assert.deepStrictEqual(L.feirasDoCondominio([pai, dele], 'Outro'), []);
  assert.strictEqual(L.feiraDoEndereco({ pathname: '/feira/quarta-pai' }), 'quarta-pai');
  assert.strictEqual(L.feiraDoEndereco({ pathname: '/', search: '?loja=x&feira=quarta-pai' }), 'quarta-pai');
  assert.strictEqual(L.feiraDoEndereco({ pathname: '/feira/../admin' }), '');
  assert.strictEqual(L.feiraDoEndereco({ search: '?feira=<script>' }), '');
  assert.strictEqual(L.comFeira('/?loja=pastel', 'quarta-pai'), '/?loja=pastel&feira=quarta-pai');
  assert.strictEqual(L.comFeira('https://pastel.site.com/', 'quarta-pai'), 'https://pastel.site.com/?feira=quarta-pai');
  assert.deepStrictEqual(L.limparCondominios(['Jardins  Munique', 'jardins munique', '', '<b>x</b>']), ['Jardins Munique', 'b x /b']);
  assert.strictEqual(L.diasDaFeira([3]), 'Toda quarta'); assert.strictEqual(L.diasDaFeira([6]), 'Todo sábado'); assert.strictEqual(L.diasDaFeira([2, 5]), 'Terça e sexta'); assert.strictEqual(L.diasDaFeira([]), 'Todos os dias');
});
teste('plataforma: a feira guarda os condomínios (limpos) e o app da feira abre a feira', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/plataforma.js'), criarAdmin(db, TOKENS));
  const r = await chamar(api, { headers: { Authorization: 'Bearer plataforma' }, body: { acao: 'feira', fid: 'quarta-pai', nome: 'Quarta do pai', dias: [3], lojas: ['banca', 'espetinhos'], condominios: ['Jardins Munique', 'jardins  munique', 'Parque'] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.deepStrictEqual(db._dados.get('feiras/quarta-pai').condominios, ['Jardins Munique', 'Parque']);
  const naoPode = await chamar(api, { headers: { Authorization: 'Bearer dono-espetinhos' }, body: { acao: 'feira', fid: 'x-y', nome: 'X', lojas: ['espetinhos'] } });
  assert.notStrictEqual(naoPode.status, 200, 'só a plataforma monta feira');
  const M = carregarApi(raiz('api/manifest.js'), criarAdmin(db, TOKENS));
  const m = M.manifestoDaFeira('quarta-pai', { nome: 'Quarta do pai', lojas: [{ id: 'banca', cor: '#123456' }] });
  assert.strictEqual(m.start_url, '/feira/quarta-pai'); assert.strictEqual(m.theme_color, '#123456');
});
teste('feira: a data da entrega é a mesma na loja e no servidor (dias, horário limite, dia sem feira, Brasília)', async () => {
  const F = require(raiz('lib/feira')), L = await import(raiz('js/plataforma-lib.js'));
  // 13/10/2026 é terça. 12h no horário de Brasília = 15h UTC.
  const t = (iso) => Date.parse(iso);
  const quarta = { dias: [3] }, terca = { dias: [2], horaLimite: '11:00' };
  assert.deepStrictEqual(F.proximaEntrega(quarta, t('2026-10-13T15:00:00Z')), { dia: '2026-10-14', hoje: false, dow: 3 }, 'terça → a feira de quarta');
  assert.strictEqual(F.proximaEntrega(terca, t('2026-10-13T13:59:00Z')).hoje, true, 'terça 10h59 em Brasília: hoje');
  assert.strictEqual(F.proximaEntrega(terca, t('2026-10-13T14:00:00Z')).dia, '2026-10-20', 'terça 11h: passou do limite, próxima terça');
  assert.strictEqual(F.proximaEntrega(terca, t('2026-10-14T02:30:00Z')).dia, '2026-10-20', 'terça 23h30 em Brasília (já quarta em UTC): próxima terça');
  assert.strictEqual(F.proximaEntrega({ dias: [3], semFeira: ['2026-10-14'] }, t('2026-10-13T15:00:00Z')).dia, '2026-10-21', 'quarta marcada sem feira: a seguinte');
  assert.strictEqual(F.proximaEntrega({ dias: [] }, t('2026-10-13T15:00:00Z')).hoje, true, 'feira sem dia marcado (ferragista): todo dia');
  assert.strictEqual(F.textoDoDia('2026-10-14'), 'quarta, 14/10');
  // a loja e o servidor dão SEMPRE a mesma resposta
  const feiras = [quarta, terca, { dias: [0, 6], horaLimite: '09:30', semFeira: ['2026-10-17'] }, { dias: [] , horaLimite: '23:59' }, { dias: [1, 3, 5] }];
  for (let h = 0; h < 24 * 21; h += 1.25) for (const f of feiras) {
    const ag = t('2026-10-10T00:00:00Z') + h * 3600000;
    assert.deepStrictEqual(L.proximaEntrega(f, ag), F.proximaEntrega(f, ag), `diferença em ${new Date(ag).toISOString()} ${JSON.stringify(f)}`);
  }
  assert.deepStrictEqual(F.limparDatas(['2026-10-20', 'lixo', '2026-10-20', '2020-01-01', '2026-02-31x'], t('2026-10-13T15:00:00Z')), ['2026-10-20'], 'datas: só válidas, de hoje em diante, sem repetir');
  assert.strictEqual(F.limparHora('7:30'), ''); assert.strictEqual(F.limparHora('07:30'), '07:30'); assert.strictEqual(F.limparHora('24:00'), '');
});
teste('feira: pedido fora do dia vai para a próxima feira (caixa do dia certo, mensagem com a data); loja fora da feira segue como sempre', async () => {
  const hojeDow = new Date(Date.now() - 3 * 3600000).getUTCDay(), outroDia = (hojeDow + 2) % 7;
  const base = semente();
  base['loja/config'] = { ...base['loja/config'], diasAbertos: [outroDia] };               // a loja "não abre hoje" pelos dias dela
  base['feiras/feira-x'] = { nome: 'Feira X', dias: [outroDia], lojas: [{ id: 'banca' }] };
  base['feiras/sem-a-banca'] = { nome: 'Outra', dias: [hojeDow], lojas: [{ id: 'espetinhos' }] };
  const db = criarBanco(base); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const F = require(raiz('lib/feira')), esperado = F.proximaEntrega(base['feiras/feira-x']).dia;
  // sem feira: a regra antiga continua (hoje a loja não abre)
  assert.notStrictEqual((await chamar(api, { headers: ip(), body: pedido() })).status, 200, 'sem feira: loja fechada hoje');
  // feira de outra loja não vale aqui
  assert.notStrictEqual((await chamar(api, { headers: ip(), body: pedido({ feira: 'sem-a-banca' }) })).status, 200, 'feira da qual a loja não faz parte não abre a loja');
  const p = pedido({ feira: 'feira-x' }), r = await chamar(api, { headers: ip(), body: p });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  const g = db._dados.get(`pedidos/${p.idempotencyKey}`);
  assert.strictEqual(g.feiraId, 'feira-x'); assert.strictEqual(g.entregaDia, esperado); assert.strictEqual(g.paraHoje, false);
  assert.strictEqual(r.corpo.pedido.paraHoje, false); assert.strictEqual(r.corpo.pedido.entregaDia, esperado);
  assert.strictEqual(db._dados.get(`resumos/${esperado}`).receita, g.total, 'o caixa soma no dia da entrega');
  assert.ok(decodeURIComponent(r.corpo.pedido.whatsappMsg).includes(`📅 Para: *${F.textoDoDia(esperado)}*`), 'a mensagem diz para quando é');
  // cancelar tira do caixa do MESMO dia
  const can = carregarApi(raiz('api/cancelar-pedido.js'), criarAdmin(db, TOKENS));
  const c = await chamar(can, { headers: { Authorization: 'Bearer dona-banca' }, body: { pedidoId: p.idempotencyKey } });
  assert.strictEqual(c.status, 200, JSON.stringify(c.corpo));
  assert.strictEqual(db._dados.get(`resumos/${esperado}`).receita, 0);
  // "fechar a loja" continua fechando, com feira ou sem
  db._dados.set('loja/config', { ...db._dados.get('loja/config'), lojaAberta: false });
  assert.notStrictEqual((await chamar(api, { headers: ip(), body: pedido({ feira: 'feira-x' }) })).status, 200);
  // motor: a venda conta no dia da entrega
  const N = require(raiz('analytics/normalize'));
  const n = N.normalizarPedidos([{ id: 'a', data: new Date().toISOString(), entregaDia: esperado, quadra: '1', lote: '1', itens: [{ id: 'tomate', qtd: 1, tipo: 'kg', unidade: 'kg' }] }]);
  assert.strictEqual(n.vendasDia.get('tomate').has(N.diaDeIso(esperado)), true);
});
teste('pedido sem feira: entrega é hoje (Brasília), como sempre', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  const p = pedido(), r = await chamar(api, { headers: ip(), body: p });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  const g = db._dados.get(`pedidos/${p.idempotencyKey}`), hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  assert.strictEqual(g.entregaDia, hoje); assert.strictEqual(g.feiraId, undefined);
  assert.ok(db._dados.has(`resumos/${hoje}`)); assert.ok(!decodeURIComponent(r.corpo.pedido.whatsappMsg).includes('📅'));
});
teste('plataforma: horário limite e dias sem feira ficam guardados (limpos)', async () => {
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/plataforma.js'), criarAdmin(db, TOKENS));
  const futuro = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const r = await chamar(api, { headers: { Authorization: 'Bearer plataforma' }, body: { acao: 'feira', fid: 'f-1', nome: 'Feira 1', dias: [3], lojas: ['banca'], horaLimite: '11:30', semFeira: [futuro, '2001-01-01', 'x'] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  const f = db._dados.get('feiras/f-1'); assert.strictEqual(f.horaLimite, '11:30'); assert.deepStrictEqual(f.semFeira, [futuro]);
});
teste('preço por dia: a loja e o servidor dão o mesmo preço; oferta vence; dia sem preço usa o normal', async () => {
  const F = require(raiz('lib/feira')), O = await import(raiz('js/oferta-lib.js'));
  const casos = [
    { preco: 10, precosDia: { 2: 12.5, 3: 8 } }, { preco: 10, precoDe: 15, precosDia: { 2: 12 } }, { preco: 10, precosDia: { 2: 'lixo', 3: -1, 4: 0 } },
    { preco: 10, precosDia: null }, { preco: 10, precosDia: [1, 2, 3] }, { preco: 10, precosDia: { 5: 9.999 } }, null,
  ];
  for (const p of casos) for (const d of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 2.5, undefined]) assert.deepStrictEqual(O.precoDoDia(p, d), F.precoDoDia(p, d), `diferença: ${JSON.stringify(p)} dia ${d}`);
  assert.strictEqual(F.precoDoDia(casos[0], 2), 12.5); assert.strictEqual(F.precoDoDia(casos[0], 3), 8); assert.strictEqual(F.precoDoDia(casos[0], 4), 10);
  assert.strictEqual(F.precoDoDia(casos[1], 2), 10, 'oferta ligada vale em todos os dias');
  assert.strictEqual(F.precoDoDia(casos[2], 3), 10, 'valor estranho: preço normal');
  assert.strictEqual(F.precoDoDia(casos[5], 5), 10, 'arredonda em centavos');
  assert.deepStrictEqual(O.limparPrecosDia({ 0: '7,5', 3: 8, 7: 9, x: 1, 2: '' }), { 0: 7.5, 3: 8 });
});
teste('preço por dia: o pedido cobra o preço do dia da ENTREGA (feira) ou de hoje; o navegador não escolhe preço', async () => {
  const hoje = new Date(Date.now() - 3 * 3600000).getUTCDay(), outro = (hoje + 3) % 7;
  const base = semente();
  base['produtos/tomate'] = { ...base['produtos/tomate'], precosDia: { [hoje]: 7, [outro]: 12 } };
  base['feiras/f-outro'] = { nome: 'Feira', dias: [outro], lojas: [{ id: 'banca' }] };
  const db = criarBanco(base); const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS));
  // sem feira: preço de HOJE
  let r = await chamar(api, { headers: ip(), body: pedido({ itens: [{ id: 'tomate', qtd: 2, tipo: 'kg', preco: 0.01 }] }) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.pedido.total, 14, 'hoje: 2 kg × R$ 7');
  // cliente da feira de outro dia: preço do dia da feira
  const p = pedido({ feira: 'f-outro', itens: [{ id: 'tomate', qtd: 2, tipo: 'kg' }] });
  r = await chamar(api, { headers: ip(), body: p });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.pedido.total, 24, 'dia da feira: 2 kg × R$ 12');
  assert.strictEqual(db._dados.get(`pedidos/${p.idempotencyKey}`).itens[0].preco, 12);
  // oferta ligada: vale a oferta, em qualquer dia
  db._dados.set('produtos/tomate', { ...db._dados.get('produtos/tomate'), preco: 5, precoDe: 9 });
  r = await chamar(api, { headers: ip(), body: pedido({ feira: 'f-outro', itens: [{ id: 'tomate', qtd: 2, tipo: 'kg' }] }) });
  assert.strictEqual(r.corpo.pedido.total, 10, 'oferta: 2 kg × R$ 5');
});
teste('preço por dia: o balcão cobra o preço de hoje', async () => {
  const hoje = new Date(Date.now() - 3 * 3600000).getUTCDay();
  const sem = sementeEstoque(); sem['produtos/ovos'] = { ...sem['produtos/ovos'], precosDia: { [hoje]: 11 } };
  const db = criarBancoP(sem); const api = carregarApi(raiz('api/pdv.js'), criarAdmin(db, TOKENS_P));
  const chave = 'bal-' + Math.random().toString(36).slice(2, 12);
  const v = await chamar(api, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'venda', chave, pag: 'Dinheiro', itens: [{ id: 'ovos', qtd: 2 }] } });
  assert.strictEqual(v.status, 200, JSON.stringify(v.corpo));
  assert.strictEqual(db._dados.get(`pedidos/${chave}`).total, 22);
});
teste('motor: preço por dia de propósito (terça cara, quarta barata) não vira promoção; promoção de verdade continua aparecendo', async () => {
  const EF = require(raiz('analytics/externalFactors'));
  const mp = new Map(); const base = 20000;          // um dia qualquer (número de dias desde 1970)
  for (let k = 0; k < 60; k++) { const d = base + k, terca = ((d + 4) % 7) === 2; mp.set(d, { p: terca ? 12 : 8, de: null }); }
  const umaTerca = [...mp.keys()].reverse().find((d) => ((d + 4) % 7) === 2), umaQuarta = umaTerca + 1;
  assert.strictEqual(EF.precoRelativo(mp, umaTerca, true), 1, 'terça no preço de sempre da terça');
  assert.strictEqual(EF.precoRelativo(mp, umaQuarta, true), 1, 'quarta no preço de sempre da quarta');
  assert.notStrictEqual(EF.precoRelativo(mp, umaTerca, false), 1, 'sem saber do preço por dia, toda terça parecia aumento de preço');
  mp.set(umaQuarta, { p: 5, de: null });
  assert.ok(EF.precoRelativo(mp, umaQuarta, true) < 1, 'quarta mais barata que as outras quartas: promoção de verdade');
});
teste('previsão e clientes por feira: uma aba para o próximo dia de cada feira; o cliente fica com a feira do último pedido (ou a do condomínio)', async () => {
  const { executarMotor, aplicarParametros } = require(raiz('analytics/engine')); aplicarParametros({});
  const dia = (n) => new Date(Date.UTC(2026, 7, n, 15)).toISOString();
  const pedidos = []; let k = 0;
  for (let n = 1; n <= 40; n++) for (let c = 1; c <= 4; c++) pedidos.push({ id: 'p' + (++k), data: dia(n), nome: 'Cliente ' + c, quadra: '1', lote: String(c), condominio: c <= 2 ? 'Jardins' : 'Parque', total: 20, ...(c === 1 && n === 40 ? { feiraId: 'quarta-jd' } : {}), itens: [{ id: 'tomate', nome: 'Tomate', qtd: 2, tipo: 'kg', unidade: 'kg', preco: 8.9 }] });
  const catalogo = [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', preco: 8.9, cat: 'legumes', ativo: true, precosDia: { 3: 7 } }];
  const feiras = [{ id: 'quarta-jd', nome: 'Feira de quarta', dias: [3], condominios: ['Jardins'] }, { id: 'sabado-pq', nome: 'Feira de sábado', dias: [6], condominios: ['Parque'] }];
  const agora = Date.UTC(2026, 8, 10, 15);                       // 10/09/2026, quinta
  const r = executarMotor({ pedidos, catalogo, agregados: [], parametros: {}, eventos: [], snapshots: [], feiras, agora });
  assert.deepStrictEqual(r.meta.feiras.map((f) => [f.id, f.dia]), [['quarta-jd', '2026-09-16'], ['sabado-pq', '2026-09-12']]);
  assert.ok(r.previsoes.tomate.horizontes['feira_quarta-jd'] && r.previsoes.tomate.horizontes['feira_quarta-jd'].previsto != null, 'previsão do dia da feira de quarta');
  const c1 = r.indiceClientes.find((c) => c.lote === '1'), c3 = r.indiceClientes.find((c) => c.lote === '3');
  assert.strictEqual(c1.fe, 'quarta-jd', 'feira do último pedido');
  const L = await import(raiz('js/plataforma-lib.js'));
  assert.strictEqual(L.feiraDeUmCliente(c1, r.meta.feiras), 'quarta-jd');
  assert.strictEqual(L.feiraDeUmCliente(c3, r.meta.feiras), 'sabado-pq', 'comprou antes do link: a feira do condomínio dele');
  assert.strictEqual(L.feiraDeUmCliente({ condominio: 'Outro' }, r.meta.feiras), '');
});
teste('mensalidade: só a plataforma define; o proprietário vê só a da banca dele; caixa e dono de outra banca não veem', async () => {
  const db = criarBanco(semente()); const adm = criarAdmin(db, TOKENS);
  const pf = carregarApi(raiz('api/plataforma.js'), adm);
  const def = (token, body) => chamar(pf, { headers: { Authorization: `Bearer ${token}` }, body: { acao: 'assinatura', ...body } });
  assert.strictEqual((await def('plataforma', { id: 'espetinhos', valor: '59,90', dia: 10, obs: 'Plano feira <b>' })).status, 200);
  assert.deepStrictEqual(db._dados.get('assinaturas/espetinhos').valor, 59.9); assert.strictEqual(db._dados.get('assinaturas/espetinhos').obs, 'Plano feira b', 'sem HTML');
  assert.notStrictEqual((await def('dono-espetinhos', { id: 'espetinhos', valor: '1' })).status, 200, 'o feirante não muda a própria mensalidade');
  assert.strictEqual(db._dados.get('assinaturas/espetinhos').valor, 59.9);
  const lista = await chamar(pf, { headers: { Authorization: 'Bearer plataforma' }, body: { acao: 'lojas' } });
  assert.strictEqual(lista.corpo.lojas.find((l) => l.id === 'espetinhos').assinatura.valor, 59.9, 'a plataforma vê todas');
  const eq = carregarApi(raiz('api/equipe.js'), criarAdmin(db, TOKENS));
  const ver = (token, loja) => chamar(eq, { headers: { Authorization: `Bearer ${token}`, ...(loja ? { 'X-Loja': loja } : {}) }, body: { acao: 'minha-assinatura' } });
  let r = await ver('dono-espetinhos', 'espetinhos'); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.deepStrictEqual(r.corpo.assinatura, { valor: 59.9, dia: 10, obs: 'Plano feira b' });
  assert.strictEqual((await ver('caixa-espetinhos', 'espetinhos')).status, 403, 'caixa não vê');
  assert.strictEqual((await ver('dona-banca', 'espetinhos')).status, 403, 'dona de outra banca não vê');
  r = await ver('dona-banca'); assert.strictEqual(r.status, 200); assert.strictEqual(r.corpo.assinatura, null, 'a banca original sem mensalidade');
  assert.strictEqual((await def('plataforma', { id: 'espetinhos', valor: '' })).status, 200);
  assert.ok(!db._dados.has('assinaturas/espetinhos'), 'valor vazio tira a mensalidade');
});
teste('feira: pesagem de pedido para a próxima feira soma no caixa do dia da entrega; o dia que a loja mostrou é conferido; reenvio devolve a data', async () => {
  const hojeDow = new Date(Date.now() - 3 * 3600000).getUTCDay(), outro = (hojeDow + 2) % 7;
  const sem = { ...sementeEstoque(), 'feiras/fx': { nome: 'Feira X', dias: [outro], lojas: [{ id: 'banca' }] } };
  const db = criarBancoP(sem); const adm = criarAdmin(db, TOKENS_P);
  const checkout = carregarApi(raiz('api/checkout.js'), adm), pdv = carregarApi(raiz('api/pdv.js'), adm);
  const F = require(raiz('lib/feira')), esperado = F.proximaEntrega(sem['feiras/fx']);
  // a loja mostrou outro dia (tela aberta desde antes do limite / relógio errado): recusa, sem criar pedido
  const errado = pedido({ feira: 'fx', diaPreco: (outro + 1) % 7, entregaDia: esperado.dia, itens: [{ id: 'tomate', qtd: 4, tipo: 'un' }, { id: 'ovos', qtd: 1, tipo: 'un' }] });
  let c = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: errado });
  assert.strictEqual(c.status, 409, JSON.stringify(c.corpo)); assert.strictEqual(c.corpo.codigo, 'dia-mudou'); assert.strictEqual(c.corpo.entregaDia, esperado.dia); assert.strictEqual(c.corpo.diaPreco, outro);
  assert.ok(Number.isFinite(c.corpo.agora)); assert.ok(!db._dados.has(`pedidos/${errado.idempotencyKey}`), 'nenhum pedido criado');
  const outraData = pedido({ feira: 'fx', diaPreco: outro, entregaDia: '2099-01-01', itens: [{ id: 'ovos', qtd: 1, tipo: 'un' }] });
  assert.strictEqual((await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: outraData })).status, 409, 'data diferente da mostrada também é recusada');
  // o mesmo dia que a loja mostrou: segue
  const p = pedido({ feira: 'fx', diaPreco: outro, entregaDia: esperado.dia, itens: [{ id: 'tomate', qtd: 4, tipo: 'un' }, { id: 'ovos', qtd: 1, tipo: 'un' }] });
  c = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p });
  assert.strictEqual(c.status, 200, JSON.stringify(c.corpo));
  const antes = db._dados.get(`resumos/${esperado.dia}`).receita;
  const r = await chamar(pdv, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'pesagem', pedidoId: p.idempotencyKey, pesos: [{ i: 0, peso: 0.5 }] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.ok(db._dados.get(`resumos/${esperado.dia}`).receita > antes, 'a pesagem soma no dia da entrega');
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  if (hoje !== esperado.dia) assert.ok(!db._dados.has(`resumos/${hoje}`) || !db._dados.get(`resumos/${hoje}`).receita, 'e não no dia em que o cliente pediu');
  // reenvio do mesmo pedido (internet caiu): volta com a data
  const de_novo = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p });
  assert.strictEqual(de_novo.status, 200); assert.strictEqual(de_novo.corpo.pedido.entregaDia, esperado.dia); assert.strictEqual(de_novo.corpo.pedido.paraHoje, false);
});
teste('motor: feira sem dia marcado não faz o motor prever venda em dia que a banca não abre', async () => {
  const { executarMotor, aplicarParametros } = require(raiz('analytics/engine')); aplicarParametros({});
  const dia = (n) => new Date(Date.UTC(2026, 7, n, 15)).toISOString();
  const pedidos = []; for (let n = 1; n <= 30; n++) pedidos.push({ id: 'p' + n, data: dia(n), nome: 'A', quadra: '1', lote: '1', total: 10, itens: [{ id: 'tomate', nome: 'Tomate', qtd: 1, tipo: 'kg', unidade: 'kg', preco: 9 }] });
  const r = executarMotor({ pedidos, catalogo: [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', preco: 9, cat: 'legumes', ativo: true }], agregados: [], parametros: {}, eventos: [], snapshots: [],
    diasAbertos: [1, 2, 3, 4, 5], feiras: [{ id: 'todo-dia', nome: 'Sem dia', dias: [] }, { id: 'sab', nome: 'Sábado', dias: [6] }], agora: Date.UTC(2026, 8, 5, 15) });   // 05/09/2026 é sábado
  const doms = (r.meta.hz.prox7 || []).filter((iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 0);
  assert.strictEqual(doms.length, 0, 'domingo continua fechado'); assert.ok((r.meta.hz.prox7 || []).some((iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 6), 'sábado (dia marcado da feira) abre');
});
teste('plataforma: cadastro de condomínios nasce do que já existe; a feira marca do cadastro; renomear atualiza a feira; não tira o que está em uso', async () => {
  const sem = { ...semente(), 'loja/config': { ...semente()['loja/config'], condominios: [{ id: 'a', nome: 'Jardins Munique', formato: 'ql' }, { id: 'b', nome: 'Parque', formato: 'rua', ativo: false }] },
    'feiras/f-velha': { nome: 'Velha', dias: [3], condominios: ['JARDINS munique', 'Vila Nova'], lojas: [{ id: 'banca' }] } };
  const db = criarBanco(sem); const api = carregarApi(raiz('api/plataforma.js'), criarAdmin(db, TOKENS));
  const pf = (body) => chamar(api, { headers: { Authorization: 'Bearer plataforma' }, body });
  let r = await pf({ acao: 'lojas' }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.deepStrictEqual(r.corpo.condominios.map((c) => c.nome), ['Jardins Munique', 'Vila Nova'], 'loja + feira antiga, sem repetir e sem o desligado');
  assert.deepStrictEqual(r.corpo.feiras.find((f) => f.id === 'f-velha').condominiosIds.sort(), ['jardins-munique', 'vila-nova'], 'feira antiga reconhecida pelo nome');
  assert.strictEqual((await pf({ acao: 'condominio', nome: 'Aldeia', formato: 'livre' })).status, 200);
  assert.strictEqual((await pf({ acao: 'condominio', nome: 'aldeia' })).status, 409, 'nome repetido');
  r = await pf({ acao: 'feira', fid: 'f-nova', nome: 'Nova', dias: [5], lojas: ['banca', 'espetinhos'], condominiosIds: ['aldeia', 'inventado', 'jardins-munique'] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  const f = db._dados.get('feiras/f-nova');
  assert.deepStrictEqual(f.conds, [{ id: 'aldeia', nome: 'Aldeia', formato: 'livre' }, { id: 'jardins-munique', nome: 'Jardins Munique', formato: 'ql' }], 'id inventado é ignorado');
  assert.deepStrictEqual(f.condominios, ['Aldeia', 'Jardins Munique']);
  assert.strictEqual((await pf({ acao: 'condominio', id: 'aldeia', remover: true })).status, 409, 'em uso numa feira: não sai');
  assert.strictEqual((await pf({ acao: 'condominio', id: 'aldeia', nome: 'Aldeia do Vale', formato: 'ql' })).status, 200);
  assert.deepStrictEqual(db._dados.get('feiras/f-nova').conds[0], { id: 'aldeia', nome: 'Aldeia do Vale', formato: 'ql', apelidos: ['Aldeia'] }, 'renomear atualiza a feira (o nome antigo fica de apelido)');
  assert.ok(db._dados.get('feiras/f-nova').condominios.includes('Aldeia do Vale') && db._dados.get('feiras/f-nova').condominios.includes('Aldeia'), 'cliente com o nome antigo guardado continua caindo na feira');
  r = await pf({ acao: 'feira', nova: true, fid: 'f-nova', nome: 'Nova', lojas: ['banca'], condominiosIds: [] });
  assert.strictEqual(r.status, 409, 'feira nova não substitui outra com o mesmo endereço');
  assert.strictEqual(db._dados.get('feiras/f-nova').lojas.length, 2, 'a feira que já existia ficou como estava');
  r = await pf({ acao: 'feira', fid: 'f-nova', nome: 'Nova', lojas: ['banca'], condominiosIds: Array.from({ length: 41 }, (_, i) => 'c' + i) });
  assert.strictEqual(r.status, 400, 'mais de 40 condomínios: avisa em vez de cortar calado');
  assert.strictEqual((await pf({ acao: 'assinatura', id: 'espetinhos', valor: '59,90' })).status, 200);
  assert.strictEqual((await pf({ acao: 'assinatura', id: 'espetinhos', valor: 'abc' })).status, 400, 'valor ilegível não apaga a mensalidade');
  assert.strictEqual(db._dados.get('assinaturas/espetinhos').valor, 59.9);
  assert.strictEqual((await pf({ acao: 'condominio', id: 'vila-nova', remover: true })).status, 409, 'Vila Nova ainda está na feira velha (pelo nome)');
  assert.notStrictEqual((await chamar(api, { headers: { Authorization: 'Bearer dono-espetinhos' }, body: { acao: 'condominio', nome: 'X y' } })).status, 200, 'só a plataforma mexe no cadastro');
  const C = require(raiz('lib/condominios'));
  assert.deepStrictEqual(C.limparLista([{ nome: 'A b' }, { nome: 'a  B' }, { nome: '<x>y', formato: 'rua' }, { nome: '' }]).map((c) => [c.id, c.nome, c.formato]), [['a-b', 'A b', 'ql'], ['x-y', 'x y', 'rua']]);
});
teste('loja: os condomínios das feiras entram na lista de endereço (cliente da feira vê os da feira dele)', async () => {
  const src = require('fs').readFileSync(raiz('js/loja.js'), 'utf8');
  assert.ok(/condominiosDasFeiras\(\)/.test(src) && /feiras-da-loja/.test(src), 'a loja junta os condomínios das feiras na lista');
});
teste('loja bloqueada: o proprietário ainda vê a mensalidade (para pagar); o resto do painel continua recusado', async () => {
  const db = criarBanco({ ...semente(), 'assinaturas/fechada': { valor: 79, dia: 5, obs: 'Pix para a plataforma' } });
  const tokens = { ...TOKENS, 'dono-fechada': { uid: 'u9', tenants: { fechada: 'proprietario' } }, 'caixa-fechada': { uid: 'u10', tenants: { fechada: 'caixa' } } };
  const eq = carregarApi(raiz('api/equipe.js'), criarAdmin(db, tokens));
  const pedir = (token, acao) => chamar(eq, { headers: { Authorization: `Bearer ${token}`, 'X-Loja': 'fechada' }, body: { acao } });
  const r = await pedir('dono-fechada', 'minha-assinatura');
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.bloqueada, true); assert.strictEqual(r.corpo.assinatura.valor, 79);
  assert.strictEqual((await pedir('caixa-fechada', 'minha-assinatura')).status, 403, 'caixa não vê');
  assert.strictEqual((await pedir('dono-espetinhos', 'minha-assinatura')).status, 403, 'dono de outra loja não vê');
  assert.strictEqual((await pedir('dono-fechada', 'listar')).status, 403, 'o resto do painel continua fechado');
  const src = require('fs').readFileSync(raiz('js/admin-guard.js'), 'utf8');
  assert.ok(src.includes('Sua assinatura foi interrompida por falta de pagamento'), 'o aviso que o proprietário vê');
});
teste('aba Clientes: pedido novo aparece na hora (recalcula só quando há pedido depois do último cálculo)', async () => {
  const db = criarBanco({ ...semente(), 'pedidos/n1': { nome: 'Ana Teste', quadra: '7', lote: '2', condominio: 'Jardins', total: 12, data: new Date().toISOString(), itens: [{ id: 'tomate', nome: 'Tomate', qtd: 1, tipo: 'kg', unidade: 'kg', preco: 8.9 }] } });
  const api = carregarApi(raiz('api/analytics.js'), criarAdmin(db, TOKENS));
  const ver = (extra) => chamar(api, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'painel', ...extra } });
  let r = await ver({}); assert.strictEqual(r.status, 200); assert.strictEqual(r.corpo.atualizou, false, 'sem "atualizar" não recalcula');
  r = await ver({ atualizar: true }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  assert.strictEqual(r.corpo.atualizou, true, 'pedido depois do cálculo: recalcula');
  assert.ok((r.corpo.indiceClientes || []).some((c) => /Ana/.test(c.nome || c.n || JSON.stringify(c))), 'a cliente nova está na lista');
  r = await ver({ atualizar: true }); assert.strictEqual(r.corpo.atualizou, false, 'nada novo: não recalcula de novo');
  // pedido de outra loja não faz esta recalcular
  db._dados.set('tenants/espetinhos/pedidos/e1', { nome: 'Zé', quadra: '1', lote: '1', total: 5, data: new Date(Date.now() + 5000).toISOString(), itens: [{ id: 'x', nome: 'X', qtd: 1, unidade: 'un', preco: 5 }] });
  r = await ver({ atualizar: true }); assert.strictEqual(r.corpo.atualizou, false);
  assert.strictEqual((await chamar(api, { headers: { Authorization: 'Bearer caixa-espetinhos', 'X-Loja': 'espetinhos' }, body: { acao: 'painel', atualizar: true } })).status, 403, 'caixa não dispara cálculo');
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

// ------------------------------------------------------------------ motor: clima, preço, dias fechados, aprender mais rápido
teste('motor: aprende o efeito da chuva só com evidência e usa na previsão do dia', () => {
  const D = require(raiz('analytics/demandForecast')), EF = require(raiz('analytics/externalFactors')), { aplicarParametros } = require(raiz('analytics/engine'));
  aplicarParametros({});
  const abertos = new Set([0, 1, 2, 3, 4, 5, 6]), d0 = 20000, N = 70;
  const chove = (t) => t % 6 === 2;                                        // chuva espalhada pelos dias da semana
  const clima = new Map(); for (let t = 0; t <= N + 1; t++) clima.set(d0 + t, { chuva: t === N ? 20 : t === N + 1 ? 0 : (chove(t) ? 15 : 0), tmax: 30 });
  const produtos = new Map([['a', { cat: 'folhas', preco: 5 }], ['b', { cat: 'frutas', preco: 8 }], ['c', { cat: 'frutas', preco: 3 }]]);
  const vendas = (seca, comChuva) => new Map([...produtos.keys()].map((id, i) => [id, new Map(Array.from({ length: N }, (_, t) => [d0 + t, (chove(t) ? comChuva : seca) * (i + 1) + (t % 3) - 1]))]));
  const preparar = (vd, cl) => D.prepararSeries({ vendasDia: vd, produtos, ids: [...produtos.keys()], asOfD: d0 + N - 1, abertos, atividade: new Map(Array.from({ length: N }, (_, t) => [d0 + t, 9])), contexto: { estadosClima: EF.estadosDoClima(cl), precos: new Map() } });
  const prever = (prep, dia) => D.preverSerie({ serie: prep.series.get('a'), hoje: dia, hz: { hoje: [dia] }, abertos, extras: [], unidade: 'un', fracEstimada: 0, fatorFuturo: (d) => EF.fator(prep.modelo, 'a', 'folhas', d) }).horizontes.hoje;
  const prep = preparar(vendas(20, 12), clima), r = EF.resumo(prep.modelo);
  assert.strictEqual(r.chuva.confiavel, true); assert.ok(r.chuva.fator > 0.55 && r.chuva.fator < 0.75, 'efeito verdadeiro 0,6: ' + r.chuva.fator);
  const chuvoso = prever(prep, d0 + N), seco = prever(prep, d0 + N + 1);
  assert.ok(chuvoso.previsto < seco.previsto * 0.8, `dia de chuva ${chuvoso.previsto} tem de ficar bem abaixo do dia seco ${seco.previsto}`);
  assert.ok(Math.abs(seco.previsto - 20) < 2.5 && Math.abs(chuvoso.previsto - 12) < 2.5, 'os dois perto da verdade (20 e 12)');
  // a série guardada é a "de um dia comum": os dias de chuva foram trazidos de volta para perto de 20
  const pts = prep.series.get('a').filter((o) => o.f); assert.ok(pts.length >= 8 && pts.every((o) => o.y > 15), 'dias de chuva corrigidos na série');
  // sem diferença nas vendas, não inventa efeito; sem clima, nem tenta
  const igual = EF.resumo(preparar(vendas(20, 20), clima).modelo); assert.strictEqual(igual.chuva.confiavel, false, 'chuva sem efeito não vira regra');
  const semClima = preparar(vendas(20, 12), new Map()); assert.strictEqual(EF.resumo(semClima.modelo).chuva.n, 0); assert.strictEqual(EF.fator(semClima.modelo, 'a', 'folhas', d0 + N).f, 1);
  // poucos dias de chuva: ainda não usa
  const pouco = new Map([...clima].map(([d, c]) => [d, { ...c, chuva: d - d0 < 60 ? 0 : c.chuva }]));
  assert.strictEqual(EF.resumo(preparar(vendas(20, 12), pouco).modelo).chuva.confiavel, false, 'com 2 dias de chuva o motor espera mais');
});

teste('motor: oferta declarada sobe a previsão, e a elasticidade passa a ser a medida na loja', () => {
  const D = require(raiz('analytics/demandForecast')), EF = require(raiz('analytics/externalFactors')), { aplicarParametros } = require(raiz('analytics/engine'));
  aplicarParametros({});
  const abertos = new Set([0, 1, 2, 3, 4, 5, 6]), d0 = 20000, N = 60, produtos = new Map([['a', { cat: 'frutas', preco: 10 }]]);
  const emOferta = (t) => t >= 20 && t < 26 || t >= 40 && t < 45;       // duas ofertas de 20%
  const precos = (comOfertas) => new Map([['a', new Map(Array.from({ length: N }, (_, t) => [d0 + t, comOfertas && emOferta(t) ? { p: 8, de: 10 } : { p: 10, de: null }]))]]);
  const vd = (lift) => new Map([['a', new Map(Array.from({ length: N }, (_, t) => [d0 + t, Math.round(30 * (emOferta(t) ? lift : 1)) + (t % 2)]))]]);
  const prep = (vendas, pr) => D.prepararSeries({ vendasDia: vendas, produtos, ids: ['a'], asOfD: d0 + N - 1, abertos, atividade: new Map(Array.from({ length: N }, (_, t) => [d0 + t, 9])), contexto: { estadosClima: new Map(), precos: pr } });
  // 1) loja que nunca fez oferta: vale a elasticidade de partida (1) → 20% mais barato ≈ ×1,25
  const semHist = prep(vd(1), precos(false));
  const f0 = EF.fator(semHist.modelo, 'a', 'frutas', d0 + N, { p: 8, de: 10 });
  assert.ok(Math.abs(f0.f - 1.25) < 0.01, 'partida: ' + f0.f); assert.ok(/abaixo do normal/.test(EF.explicar(f0.partes)[0]) && /estimativa de partida/.test(EF.explicar(f0.partes)[0]));
  assert.strictEqual(EF.fator(semHist.modelo, 'a', 'frutas', d0 + N, { p: 10, de: null }).f, 1, 'preço normal: sem ajuste');
  // 2) loja em que a oferta de 20% dobrou a venda: a elasticidade medida fica bem acima da de partida
  const forte = prep(vd(2), precos(true)), e = EF.resumo(forte.modelo).preco;
  assert.ok(e.n >= 10 && e.elasticidade > 1.8, 'elasticidade medida: ' + JSON.stringify(e));
  const h = (p, info) => D.preverSerie({ serie: p.series.get('a'), hoje: d0 + N, hz: { hoje: [d0 + N] }, abertos, extras: [], unidade: 'un', fracEstimada: 0, fatorFuturo: (d) => EF.fator(p.modelo, 'a', 'frutas', d, info) }).horizontes.hoje.previsto;
  const normal = h(forte, { p: 10, de: null }), comOferta = h(forte, { p: 8, de: 10 });
  assert.ok(Math.abs(normal - 30.5) < 3, 'fora da oferta a previsão não fica inflada pelos dias de oferta: ' + normal);
  assert.ok(comOferta > normal * 1.5, `com oferta ${comOferta} × sem ${normal}`);
  // preço relativo: diferença pequena é ignorada; sem histórico e sem "de", não há referência
  assert.strictEqual(EF.precoRelativo(new Map([[1, { p: 10 }], [2, { p: 10 }], [3, { p: 10 }], [4, { p: 9.7 }]]), 4), 1);
  assert.strictEqual(EF.precoRelativo(new Map([[4, { p: 7 }]]), 4), 1); assert.strictEqual(EF.precoRelativo(new Map([[4, { p: 7, de: 10 }]]), 4), 0.7);
});

teste('motor: dia em que a loja não funcionou sai da conta, e venda de balcão sem endereço não vira cliente', () => {
  const { executarMotor, aplicarParametros } = require(raiz('analytics/engine')); aplicarParametros({});
  const dia = (n) => new Date(Date.UTC(2026, 7, n, 15)).toISOString();     // agosto + n dias
  const pedidos = []; let k = 0;
  for (let n = 1; n <= 40; n++) {
    if (n === 20) continue;                                               // a loja não abriu
    for (let c = 1; c <= 5; c++) pedidos.push({ id: 'p' + (++k), data: dia(n), nome: 'Cliente ' + c, quadra: '1', lote: String(c), condominio: 'Jardins', total: 20, itens: [{ id: 'tomate', nome: 'Tomate', qtd: 2, tipo: 'kg', unidade: 'kg', preco: 8.9, precoOriginal: 8.9 }] });
    for (let b = 0; b < 3; b++) pedidos.push({ id: 'b' + (++k), data: dia(n), nome: 'Balcão', origem: 'balcao', userId: 'equipe:x', total: 9, itens: [{ id: 'tomate', nome: 'Tomate', qtd: 1, tipo: 'kg', unidade: 'kg', preco: 8.9, precoOriginal: 8.9 }] });
  }
  const catalogo = [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', preco: 7.5, precoDe: 8.9, cat: 'legumes', ativo: true }, { id: 'jilo', nome: 'Jiló', unidade: 'kg', preco: 6, cat: 'legumes', ativo: false }];
  const r = executarMotor({ pedidos, catalogo, agregados: [], parametros: {}, eventos: [], snapshots: [], agora: Date.UTC(2026, 7, 41, 15) });
  assert.strictEqual(r.meta.nClientes, 5, 'só as 5 casas; as 117 vendas de balcão não são clientes'); assert.strictEqual(r.indiceClientes.length, 5); assert.strictEqual(r.clientes.length, 5);
  assert.strictEqual(r.meta.diasFechados, 1);
  const hoje = r.previsoes.tomate.horizontes.hoje;
  // todo dia vende 13 kg (5×2 + 3×1); hoje o tomate está 16% mais barato → previsão acima de 13, e o dia fechado não puxou a média para baixo
  assert.ok(hoje.previsto > 13.5 && hoje.previsto < 17, 'previsto ' + hoje.previsto); assert.ok(hoje.explicacao.some((x) => /abaixo do normal/.test(x)), hoje.explicacao.join(' | '));
  assert.ok(Math.abs(r.previsoes.tomate.horizontes.prox30.previsto / 30 - 13) < 1.2, 'depois de uma semana a oferta de hoje não vale mais');
  // retrato de hoje para o histórico de preços
  assert.deepStrictEqual(r.contextoNovo.precos.tomate, [7.5, 8.9]); assert.strictEqual(r.contextoNovo.precos.jilo, 6); assert.deepStrictEqual(r.contextoNovo.fora, ['jilo']);
  assert.strictEqual(r.esperados.hoje.clientes[0].diasDesdeUltima, 1, 'comprou ontem = há 1 dia');
  // estoque que zerou numa venda conta como dia de falta
  const r2 = executarMotor({ pedidos, catalogo, agregados: [], parametros: {}, eventos: [], snapshots: [], faltasEstoque: [{ produtoId: 'tomate', dia: '2026-09-08' }, { produtoId: 'tomate', dia: '2026-09-09' }], agora: Date.UTC(2026, 7, 41, 15) });
  assert.strictEqual(r2.meta.diasComFalta, 2);
});

teste('clima: lê a resposta do serviço, guarda por loja e segue com o guardado quando a internet falha', async () => {
  const Cl = require(raiz('lib/clima'));
  assert.deepStrictEqual(Cl.lerDias({ daily: { time: ['2026-10-05', '2026-10-06', 'lixo'], precipitation_sum: [0, 12.34, 1], temperature_2m_max: [33.26, null, 2] } }), { '2026-10-05': [0, 33.3], '2026-10-06': [12.3, null] });
  assert.deepStrictEqual(Cl.lerDias(null), {}); assert.deepStrictEqual(Cl.lerDias({ daily: {} }), {});
  assert.strictEqual(Cl.escolherLugar({ results: [{ name: 'Goiania', latitude: 1, longitude: 2, country_code: 'US', population: 9e6 }, { name: 'Goiânia', latitude: -16.67861, longitude: -49.25389, country_code: 'BR', admin1: 'Goiás' }] }, 'GOIANIA').lugar, 'Goiânia, Goiás');
  assert.strictEqual(Cl.escolherLugar({}, 'x'), null); assert.strictEqual(Cl.cidadeDaLoja({ pix: { cidade: 'Goiania' } }), 'Goiania'); assert.strictEqual(Cl.cidadeDaLoja({ cidade: 'Anápolis', pix: { cidade: 'X' } }), 'Anápolis'); assert.strictEqual(Cl.cidadeDaLoja({}), '');
  const db = criarBanco({}), antigo = global.fetch, chamadas = [];
  try {
    global.fetch = async (url) => { chamadas.push(String(url)); return { ok: true, json: async () => (String(url).includes('geocoding') ? { results: [{ name: 'Goiânia', latitude: -16.68, longitude: -49.25, country_code: 'BR', admin1: 'Goiás' }] } : { daily: { time: ['2026-10-05', '2026-10-06', '2026-10-07'], precipitation_sum: [0, 14, 2], temperature_2m_max: [33, 28, 31] } }) }; };
    const agora = Date.UTC(2026, 9, 6, 15);
    assert.strictEqual((await Cl.atualizar(db, {}, agora)).motivo, 'sem cidade'); assert.strictEqual(chamadas.length, 0, 'sem cidade não chama ninguém');
    const r = await Cl.atualizar(db, { cidade: 'Goiânia' }, agora);
    assert.strictEqual(r.atualizado, true); assert.strictEqual(r.lugar, 'Goiânia, Goiás'); assert.deepStrictEqual(r.dias['2026-10-06'], [14, 28]);
    assert.ok(chamadas[0].includes('name=Goi%C3%A2nia') && chamadas[1].includes('latitude=-16.68') && chamadas[1].includes('past_days=92'));
    assert.strictEqual(db._dados.get('analytics_config/clima').lat, -16.68);
    chamadas.length = 0; await Cl.atualizar(db, { cidade: 'Goiânia' }, agora); assert.strictEqual(chamadas.length, 1, 'cidade já localizada: só busca o tempo');
    global.fetch = async () => { throw new Error('sem internet'); };
    const f = await Cl.atualizar(db, { cidade: 'Goiânia' }, agora); assert.strictEqual(f.atualizado, false); assert.deepStrictEqual(f.dias['2026-10-06'], [14, 28], 'usa o que estava guardado');
    global.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
    const n = await Cl.atualizar(db, { cidade: 'Cidade Que Nao Existe' }, agora); assert.strictEqual(n.motivo, 'cidade não encontrada'); assert.deepStrictEqual(n.dias, {}, 'o tempo de outra cidade não é aproveitado');
  } finally { global.fetch = antigo; }
});

teste('rotina diária: guarda o retrato de preços do dia sem apagar as vendas do mesmo dia', async () => {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const db = criarBanco({ ...semente(), [`pedidos/x1`]: { nome: 'Ana', quadra: '5', lote: '3', condominio: 'Jardins', total: 10, data: new Date().toISOString(), itens: [{ id: 'tomate', nome: 'Tomate', qtd: 2, tipo: 'kg', unidade: 'kg', preco: 8.9 }] } });
  const api = carregarApi(raiz('api/analytics.js'), criarAdmin(db, TOKENS));
  const cron = () => chamar(api, { method: 'GET', headers: { Authorization: 'Bearer segredo-cron' } });
  assert.strictEqual((await cron()).status, 200);
  const doc1 = db._dados.get(`analytics_vendas/${hoje}`);
  assert.ok(doc1 && doc1.precos && Object.keys(doc1.precos).length > 0, 'retrato de preços guardado'); assert.strictEqual(doc1.produtos.tomate, 2, 'vendas do dia no mesmo documento');
  // muda o preço no meio do dia e recalcula: as vendas atualizam, o retrato da madrugada fica
  const prod = db._dados.get('produtos/tomate'); db._dados.set('produtos/tomate', { ...prod, preco: 1 });
  db._dados.set('pedidos/x2', { nome: 'Bia', quadra: '5', lote: '4', condominio: 'Jardins', total: 10, data: new Date().toISOString(), itens: [{ id: 'tomate', nome: 'Tomate', qtd: 3, tipo: 'kg', unidade: 'kg', preco: 1 }] });
  db._dados.delete('analytics_meta/execucao'); assert.strictEqual((await cron()).status, 200);
  const doc2 = db._dados.get(`analytics_vendas/${hoje}`);
  assert.strictEqual(doc2.produtos.tomate, 5); assert.deepStrictEqual(doc2.precos, doc1.precos, 'o primeiro retrato do dia é o que vale');
  assert.ok(!db._dados.has('analytics_config/clima'), 'loja sem cidade: não guarda clima');
});

teste('motor: na loja simulada, a regulagem atual erra bem menos que a simples e não piora onde não há o que aprender', () => {
  const { gerar } = require(raiz('testes/mundo-simulado')), M = require(raiz('scripts/medir-motor'));
  const erro = (r, k) => { const f = r[k].slice(2); return f.reduce((s, x) => s + x.erro, 0) / f.reduce((s, x) => s + x.mu, 0); };   // do 15º dia em diante
  const com = M.medir(gerar({ seed: 7, dias: 75, nProd: 12, efeitos: true })), sem = M.medir(gerar({ seed: 107, dias: 75, nProd: 12, efeitos: false }));
  const gCom = erro(com, 'atual') / erro(com, 'simples'), gSem = erro(sem, 'atual') / erro(sem, 'simples');
  assert.ok(gCom < 0.85, `com chuva, oferta e pagamento o erro tem de cair pelo menos 15%: ${gCom.toFixed(3)}`);
  assert.ok(gSem < 1.03, `sem efeito nenhum, não pode piorar: ${gSem.toFixed(3)}`);
  assert.ok(com.atual[0].sem / com.atual[0].tot < 0.15 && com.simples[0].sem / com.simples[0].tot > 0.25, 'na primeira semana a atual já prevê quase tudo');
});

teste('estoque: "Tirar da loja" não é desfeito por venda, perda ou entrada; só o esgotado automático volta sozinho', async () => {
  const E = require(raiz('lib/estoque'));
  assert.strictEqual(E.ativoDepois({ ativo: false, estoqueFisico: 10 }, 9), false, 'escondido à mão, com estoque: continua escondido');
  assert.strictEqual(E.ativoDepois({ ativo: true, estoqueFisico: 10 }, 9), true);
  assert.strictEqual(E.ativoDepois({ ativo: true, estoqueFisico: 1 }, 0), false, 'zerou: sai da loja');
  assert.strictEqual(E.ativoDepois({ ativo: false, estoqueFisico: 0 }, 5), true, 'estava zerado e chegou mercadoria: volta');
  assert.strictEqual(E.ativoDepois({ ativo: false, estoqueFisico: '' }, 5), false, 'sem controle de estoque e escondido: a primeira contagem não religa');
  assert.strictEqual(E.ativoDepois({ ativo: true, estoqueFisico: null }, 5), true);
  // de ponta a ponta: produto escondido com estoque, venda no balcão e perda lançada
  const db = criarBancoP({ ...sementeEstoque(), 'produtos/ovos': { ...sementeEstoque()['produtos/ovos'], ativo: false, estoqueFisico: 10 } }); const adm = criarAdmin(db, TOKENS_P);
  const pdv = carregarApi(raiz('api/pdv.js'), adm), est = carregarApi(raiz('api/estoque.js'), adm);
  const v = await chamar(pdv, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'venda', chave: 'bal-' + Math.random().toString(36).slice(2, 12), pag: 'Dinheiro', itens: [{ id: 'ovos', qtd: 1 }] } });
  assert.strictEqual(v.status, 200, JSON.stringify(v.corpo));
  assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 9); assert.strictEqual(db._dados.get('produtos/ovos').ativo, false, 'vendeu no balcão e continua fora da loja');
  const pd = await chamar(est, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'movimentar', produtoId: 'ovos', tipo: 'perda', qtd: 1, motivo: 'quebra', chave: 'mv-' + Math.random().toString(36).slice(2, 12) } });
  assert.strictEqual(pd.status, 200, JSON.stringify(pd.corpo));
  assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 8); assert.strictEqual(db._dados.get('produtos/ovos').ativo, false, 'lançou perda e continua fora da loja');
  const M = await import(raiz('js/margens-lib.js'));
  const r = M.resumoMargens([{ status: 'pendente', total: 28, itens: [{ id: 'a', nome: 'A', qtd: 2, preco: 10, subtotal: 20 }] }], [{ id: 'a', nome: 'A', custo: 4 }]);
  assert.strictEqual(r.coberturaCusto, 1, 'entrega de R$ 8 no total não vira "produto sem custo"');
});

teste('balcão: resumo de várias vendas entra no caixa, no estoque e na previsão, no dia certo, sem virar cliente nem "leva junto"', async () => {
  const db = criarBancoP(sementeEstoque()); const adm = criarAdmin(db, TOKENS_P), pdv = carregarApi(raiz('api/pdv.js'), adm);
  const vender = (extra) => { const chave = 'bal-' + Math.random().toString(36).slice(2, 12); return chamar(pdv, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'venda', chave, pag: 'Dinheiro', itens: [{ id: 'tomate', qtd: 6.5 }, { id: 'ovos', qtd: 4 }], ...extra } }).then((r) => ({ r, ped: db._dados.get(`pedidos/${chave}`) })); };
  const brt = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(0, 10), hoje = brt(Date.now()), ontem = brt(Date.now() - 86400000);
  const a = await vender({ resumo: true, dia: 'ontem', cliente: { nome: 'Fulano', quadra: '1', lote: '2' } });
  assert.strictEqual(a.r.status, 200, JSON.stringify(a.r.corpo));
  assert.strictEqual(a.ped.resumoDoDia, true); assert.strictEqual(a.ped.nome, 'Balcão (resumo do dia)'); assert.strictEqual(a.ped.quadra, '', 'resumo não fica no nome de uma casa');
  assert.strictEqual(brt(Date.parse(a.ped.data)), ontem, 'a data do pedido é a de ontem'); assert.ok(db._dados.get(`resumos/${ontem}`).receita > 0, 'caixa de ontem');
  assert.strictEqual(db._dados.get('produtos/ovos').estoqueFisico, 6, 'baixou o estoque');
  const b = await vender({ resumo: true }); assert.strictEqual(brt(Date.parse(b.ped.data)), hoje);
  const c = await vender({ dia: 'ontem' }); assert.strictEqual(brt(Date.parse(c.ped.data)), hoje, 'venda comum nunca é lançada para trás'); assert.ok(!c.ped.resumoDoDia);
  // no motor: as quantidades contam no dia; o resumo não é cliente e não cria associação entre os produtos
  const { executarMotor, aplicarParametros } = require(raiz('analytics/engine')); aplicarParametros({});
  const catalogo = [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', preco: 8.9, ativo: true }, { id: 'ovos', nome: 'Ovos', unidade: 'un', preco: 14, ativo: true }];
  const dia = (n) => new Date(Date.UTC(2026, 7, n, 15)).toISOString();
  const itens = [{ id: 'tomate', nome: 'Tomate', qtd: 6, tipo: 'kg', unidade: 'kg', preco: 8.9 }, { id: 'ovos', nome: 'Ovos', qtd: 4, tipo: 'un', unidade: 'un', preco: 14 }];
  const resumos = Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, data: dia(i + 1), nome: 'Balcão (resumo do dia)', origem: 'balcao', resumoDoDia: true, total: 100, itens }));
  const m = executarMotor({ pedidos: resumos, catalogo, agregados: [], parametros: {}, eventos: [], snapshots: [], agora: Date.UTC(2026, 7, 13, 15) });
  assert.strictEqual(m.meta.nClientes, 0); assert.ok(Math.abs(m.previsoes.tomate.horizontes.hoje.previsto - 6) < 0.5, 'a previsão aprende com o resumo: ' + m.previsoes.tomate.horizontes.hoje.previsto);
  assert.ok(!Object.keys((m.global.assoc || {}).tomate || {}).length, 'resumo não ensina que tomate e ovos saem juntos');
  const avulsas = resumos.map((p) => ({ ...p, resumoDoDia: false }));
  const m2 = executarMotor({ pedidos: avulsas, catalogo, agregados: [], parametros: {}, eventos: [], snapshots: [], agora: Date.UTC(2026, 7, 13, 15) });
  assert.ok(JSON.stringify(m2.global.assoc || {}).includes('ovos'), 'venda de balcão de UMA pessoa ensina');
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
teste('cupom vale até 23:59 (Brasília) do último dia, inclusive o especial (fora da previsão); recriar o código não herda usos', async () => {
  const RealDate = Date;
  const fixar = (iso) => { const t = new RealDate(iso).getTime(); global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; };
  try {
    for (const [quando, ok] of [['2026-10-09T23:30:00-03:00', true], ['2026-10-10T00:01:00-03:00', false]]) {
      fixar(quando);
      const db = criarBancoP({ ...sementeEstoque(), 'cupons/FAMILIA': { ativo: true, percentual: 100, foraDaPrevisao: true, validoAte: '2026-10-09', limiteUsos: 5, usos: 0 } });
      const checkout = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOKENS_P));
      const r = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: pedido({ cupom: 'familia', itens: [{ id: 'ovos', qtd: 1, tipo: 'un' }] }) });
      if (ok) assert.strictEqual(r.status, 200, `${quando}: ${JSON.stringify(r.corpo)}`);
      else assert.ok(r.status >= 400 && /venceu/.test(r.corpo.error), `${quando}: ${JSON.stringify(r.corpo)}`);
    }
  } finally { global.Date = RealDate; }
  // o painel pergunta antes de salvar um código que já existe e, por padrão, zera a contagem
  const adminJs = require('fs').readFileSync(raiz('js/admin.js'), 'utf8');
  assert.ok(/zerarUsos \? \{ usos: 0 \}/.test(adminJs) && /já existe/.test(adminJs), 'recriar cupom zera os usos (com pergunta)');
  assert.ok(/validade < hojeBRCupom\(\)/.test(adminJs) && /action === 'editar-cupom'/.test(adminJs), 'painel recusa validade que já passou e deixa editar o cupom');
  // fotos: sempre pelo redutor do site (o i.ibb.co direto não abre em algumas redes)
  const lojaJs = require('fs').readFileSync(raiz('js/loja.js'), 'utf8');
  assert.ok(!/src="\$\{escapeHTML\([a-z]+\.fotoMini \|\|/.test(lojaJs) && /fotoPequena = \(p, largura\) => miniatura\(p\.fotoMini \|\| p\.foto, largura\)/.test(lojaJs), 'foto da vitrine passa pelo redutor');
});
teste('cupom em %: vale também para o que vai para a balança, e o de 100% zera o pedido com a entrega', async () => {
  const db = criarBancoP({ ...sementeEstoque(), 'loja/config': { ...(sementeEstoque()['loja/config'] || {}), status: 'aberta', entrega: { taxa: 6, gratisAcima: 80 } },
    'cupons/FAMILIA': { ativo: true, percentual: 100, foraDaPrevisao: true }, 'cupons/DEZ': { ativo: true, percentual: 10 } }); const adm = criarAdmin(db, TOKENS_P);
  const checkout = carregarApi(raiz('api/checkout.js'), adm), api = carregarApi(raiz('api/pdv.js'), adm);
  const fazer = async (cupom) => { const p = pedido({ cupom, itens: [{ id: 'tomate', qtd: 4, tipo: 'un' }, { id: 'ovos', qtd: 1, tipo: 'un' }] });
    const c = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p }); assert.strictEqual(c.status, 200, JSON.stringify(c.corpo));
    const r = await chamar(api, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'pesagem', pedidoId: p.idempotencyKey, pesos: [{ i: 0, peso: 0.62 }] } }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    return { c: c.corpo.pedido, r: r.corpo, ped: db._dados.get(`pedidos/${p.idempotencyKey}`) }; };
  const f = await fazer('FAMILIA');
  assert.strictEqual(f.c.total, 0, 'ovos de graça e sem taxa de entrega');
  assert.strictEqual(f.r.total, 0, 'depois da balança continua zero'); assert.strictEqual(f.r.desconto, 19.52); assert.strictEqual(f.r.entrega, 0);
  assert.strictEqual(f.ped.total, 0); assert.strictEqual(f.ped.cupom.desconto, 19.52); assert.strictEqual(db._dados.get('cupons/FAMILIA').usos, 1);
  // cupom especial: o pedido leva a marca e o motor de previsão não aprende com ele
  assert.strictEqual(f.ped.foraDaPrevisao, true); 
  const N = require(raiz('analytics/normalize')), cat = [{ id: 'tomate', nome: 'Tomate', unidade: 'kg', preco: 8.9 }, { id: 'ovos', nome: 'Ovos', unidade: 'un', preco: 14 }];
  const conta = (lista) => N.normalizarPedidos(lista, cat).nPedidos;
  assert.strictEqual(conta([f.ped]), 0, 'pedido especial fora do motor'); assert.ok(conta([{ ...f.ped, foraDaPrevisao: false }]) > 0, 'o mesmo pedido, sem a marca, entraria');
  const d = await fazer('DEZ');
  assert.strictEqual(d.ped.foraDaPrevisao, undefined, 'cupom comum entra na previsão');
  assert.strictEqual(d.c.total, 18.6, 'ovos 14 − 10% = 12,60; + 6 de entrega'); assert.strictEqual(d.r.desconto, 1.95, '10% de 19,52');
  assert.strictEqual(d.r.total, 23.57, '19,52 − 1,95 + 6'); assert.strictEqual(d.ped.cupom.percentual, 10);
  // só itens a pesar: o cupom em % fica guardado e entra na balança
  const p = pedido({ cupom: 'FAMILIA', itens: [{ id: 'tomate', qtd: 2, tipo: 'un' }] });
  const c = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p }); assert.strictEqual(c.status, 200, JSON.stringify(c.corpo));
  const r = await chamar(api, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'pesagem', pedidoId: p.idempotencyKey, pesos: [{ i: 0, peso: 0.3 }] } });
  assert.strictEqual(r.corpo.total, 0, JSON.stringify(r.corpo));
});

teste('pesagem com cupom especial de 100%: o pedido sai de "a pesar" e não volta para a balança', async () => {
  const db = criarBancoP({ ...sementeEstoque(), 'cupons/FAMILIA': { ativo: true, percentual: 100, foraDaPrevisao: true } }); const adm = criarAdmin(db, TOKENS_P);
  const checkout = carregarApi(raiz('api/checkout.js'), adm);
  const p = pedido({ cupom: 'FAMILIA', itens: [{ id: 'tomate', qtd: 4, tipo: 'un' }, { id: 'ovos', qtd: 1, tipo: 'un' }] });
  const c = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: p });
  assert.strictEqual(c.status, 200, JSON.stringify(c.corpo));
  const antes = db._dados.get(`pedidos/${p.idempotencyKey}`);
  const api = carregarApi(raiz('api/pdv.js'), adm);
  const r = await chamar(api, { headers: { Authorization: 'Bearer func-banca' }, body: { acao: 'pesagem', pedidoId: p.idempotencyKey, pesos: [{ i: 0, peso: 0.62 }] } });
  const ped = db._dados.get(`pedidos/${p.idempotencyKey}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(ped.status, 'preparando'); assert.strictEqual(ped.total, 0, 'cortesia: tudo de graça'); assert.ok(ped.itens.every((i) => !i.aPesar));
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
  // horário fora da lista (ou em branco) NUNCA barra o pedido: vira "a combinar". Cliente com tela antiga ficava preso sem ter o que escolher.
  assert.strictEqual(Ent.horarioValido(cfg, 'Madrugada'), ''); assert.strictEqual(Ent.horarioValido(cfg, ''), ''); assert.strictEqual(Ent.horarioValido(cfg, undefined), ''); assert.strictEqual(Ent.horarioValido(cfg, { a: 1 }), '');
  assert.strictEqual(Ent.horarioACombinar(cfg, ''), true); assert.strictEqual(Ent.horarioACombinar(cfg, 'Tarde'), false); assert.strictEqual(Ent.horarioACombinar(Ent.lerConfig({}), ''), false, 'loja que não pergunta não tem o que combinar');
  assert.strictEqual(Ent.horarioValido(cfg, 'Tarde'), 'Tarde'); assert.strictEqual(Ent.horarioValido(Ent.lerConfig({}), 'qualquer coisa'), '', 'loja que não pergunta ignora o campo');
  // prévia do navegador = mesma conta
  const fmtT = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`, c2 = L.lerEntrega({ entrega: { taxa: 5, gratisAcima: 20 } });
  assert.deepStrictEqual(L.previaDaEntrega(c2, 14, fmtT), { taxa: 5, gratis: false, falta: 6, texto: 'Entrega R$ 5,00 · faltam R$ 6,00 para entrega grátis' });
  assert.strictEqual(L.previaDaEntrega(c2, 20, fmtT).texto, 'Entrega grátis'); assert.strictEqual(L.previaDaEntrega(L.lerEntrega({}), 20, fmtT).texto, '');
  assert.deepStrictEqual(L.horariosDoTexto(' Manhã \n\nTarde\nTarde\n'), ['Manhã', 'Tarde']);

  const db = criarBancoP({ ...sementeEstoque(), 'loja/config': { ...(sementeEstoque()['loja/config'] || {}), entrega: { taxa: 5, gratisAcima: 20, horarios: ['Manhã', 'Tarde'] } } }); const adm = criarAdmin(db, TOKENS_P);
  const checkout = carregarApi(raiz('api/checkout.js'), adm);
  const pedir = (extra) => chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: pedido(extra) });
  // tela antiga (sem o campo) ou lista velha: o pedido ENTRA, e a loja combina o horário
  for (const [extra, caso] of [[{}, 'sem o campo'], [{ horarioEntrega: 'Madrugada' }, 'horário que não existe mais'], [{ horarioEntrega: '<b>x</b>' }, 'texto estranho']]) {
    const pp = pedido({ itens: [{ id: 'ovos', qtd: 1, tipo: 'un' }], ...extra });
    const rr = await chamar(checkout, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: pp }), gravado = db._dados.get(`pedidos/${pp.idempotencyKey}`);
    assert.strictEqual(rr.status, 200, `${caso}: ${JSON.stringify(rr.corpo)}`); assert.strictEqual(gravado.entrega.horario, '', caso); assert.strictEqual(gravado.entrega.horarioACombinar, true, caso);
    assert.ok(decodeURIComponent(rr.corpo.pedido.whatsappMsg).includes('Entrega: horário a combinar'), 'a loja fica sabendo pelo WhatsApp');
  }
  assert.ok(require('fs').readFileSync(raiz('js/loja.js'), 'utf8').includes("pintarHorariosDeEntrega();      // garante a lista"), 'a lista de horários é montada ao abrir a tela de entrega');
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
  const srv = crypto.createECDH('prime256v1'); do srv.generateKeys(); while (srv.getPrivateKey().length !== 32);   /* 1 em 256 chaves sai com 31 bytes e o servidor a recusa: o teste falhava de vez em quando */ const k = { priv: A.b64u(srv.getPrivateKey()), pub: A.b64u(srv.getPublicKey()) };
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
  const srv = crypto.createECDH('prime256v1'); do srv.generateKeys(); while (srv.getPrivateKey().length !== 32);   /* 1 em 256 chaves sai com 31 bytes e o servidor a recusa: o teste falhava de vez em quando */ const ap = crypto.createECDH('prime256v1'); ap.generateKeys();
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
  const sit = await ch('antigo2', { acao: 'situacao' }); assert.strictEqual(sit.status, 200); assert.strictEqual(sit.corpo.temDono, true, 'a tela fica sabendo que já tem dono e não oferece o botão'); assert.strictEqual(sit.corpo.souEu, false);
  assert.ok(/acao: 'situacao'[\s\S]{0,200}temDono\) return aviso/.test(require('fs').readFileSync(raiz('js/plataforma.js'), 'utf8')), 'a tela pergunta antes de mostrar "Assumir"');
  assert.strictEqual(usuarios.find((u) => u.uid === 'a-2').customClaims.plataforma, undefined);
  // lista: a loja original aparece mesmo sem ficha; o movimento é só o do mês
  const l = (await ch('super', { acao: 'lojas' })).corpo;
  assert.deepStrictEqual(l.lojas.map((x) => x.id), ['banca', 'espetinhos']); assert.deepStrictEqual(l.lojas[1].mes, { receita: 150.5, pedidos: 4 });
  assert.strictEqual(l.lojas[1].modulos.pdv, true); assert.strictEqual(l.lojas[1].modulos.ia, false); assert.strictEqual(l.lojas[0].modulos.ia, true);
  // criar loja
  for (const ruim of [{ id: 'banca', nome: 'X loja' }, { id: 'Com Espaço', nome: 'X loja' }, { id: 'admin', nome: 'X loja' }, { id: 'ok-loja', nome: '' }, { id: 'ok-loja', nome: 'Loja', modelo: 'inexistente' }, { id: 'espetinhos', nome: 'Outra' }])
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
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'F', lojas: ['banca'] })).status, 400, 'feira sem nome não entra');
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'Feira', lojas: ['banca', 'fantasma'] })).status, 404);
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'Feira do Jardins', lojas: ['banca', 'espetinhos', 'jantinha-da-lu'] })).status, 200);
  assert.deepStrictEqual(db._dados.get('feiras/jardins').lojas.map((x) => `${x.id}|${x.cor}`), ['banca|#1a3a2a', 'espetinhos|#b3261e', 'jantinha-da-lu|#7a2e12']);
  assert.strictEqual(db._dados.get('tenants/banca').feiraId, 'jardins'); assert.strictEqual(db._dados.get('tenants/banca').nome, 'Banca Adair e Pedrina');
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: 'Feira do Jardins', lojas: ['banca', 'espetinhos'] })).status, 200);
  assert.strictEqual(db._dados.get('tenants/jantinha-da-lu').feiraId, '', 'quem saiu da feira deixa de apontar para ela');
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'jardins', nome: '', lojas: [] })).status, 200); assert.ok(!db._dados.has('feiras/jardins')); assert.strictEqual(db._dados.get('tenants/banca').feiraId, '');
  // FEIRA POR DIA: a mesma loja em duas feiras, cada uma no seu dia e com as suas lojas
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'atenas-quarta', nome: 'Atenas', dias: [3, 3, 9, '2', -1], lojas: ['banca'] })).status, 200, 'feira de uma loja só pode ser cadastrada');
  assert.deepStrictEqual(db._dados.get('feiras/atenas-quarta').dias, [3], 'só dia de 0 a 6, sem repetir');
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'munique-sabado', nome: 'Munique', dias: [6], lojas: ['banca', 'espetinhos'] })).status, 200);
  assert.deepStrictEqual(db._dados.get('tenants/banca').feiras, ['atenas-quarta', 'munique-sabado'], 'a loja fica nas duas feiras');
  assert.deepStrictEqual(db._dados.get('tenants/espetinhos').feiras, ['munique-sabado']);
  const lst = await ch3({ acao: 'lojas' }); assert.deepStrictEqual(lst.corpo.feiras.map((f) => `${f.id}:${f.dias}:${f.lojas}`).sort(), ['atenas-quarta:3:banca', 'munique-sabado:6:banca,espetinhos']);
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'atenas-quarta', nome: '', lojas: [] })).status, 200);
  assert.deepStrictEqual(db._dados.get('tenants/banca').feiras, ['munique-sabado'], 'desfazer uma feira não tira a loja da outra'); assert.strictEqual(db._dados.get('tenants/banca').feiraId, 'munique-sabado');
  assert.strictEqual((await ch3({ acao: 'feira', fid: 'munique-sabado', nome: '', lojas: [] })).status, 200); assert.deepStrictEqual(db._dados.get('tenants/banca').feiras, []);
  // tirar o proprietário
  assert.strictEqual((await ch3({ acao: 'proprietario', id: 'jantinha-da-lu', email: 'ze@x.com', remover: true })).status, 200);
  assert.deepStrictEqual(usuarios[0].customClaims, { tenants: { outra: 'caixa' } }); assert.strictEqual(usuarios[0].revogado, true);
});
teste('PIX copia e cola: código no padrão do Banco Central, com a chave da loja e o valor do pedido', async () => {
  const X = await import(raiz('js/pix-chave-lib.js'));
  // o exemplo do manual do Banco Central fecha com o verificador 1D3D
  assert.strictEqual(X.crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D');
  // chaves: cada tipo no formato que os bancos esperam
  assert.strictEqual(X.normalizarChave('celular', '(62) 99999-8888'), '+5562999998888'); assert.strictEqual(X.normalizarChave('celular', '+55 62 99999-8888'), '+5562999998888'); assert.strictEqual(X.normalizarChave('celular', '99999-8888'), '');
  assert.strictEqual(X.normalizarChave('cpf', '123.456.789-09'), '12345678909'); assert.strictEqual(X.normalizarChave('cpf', '123'), ''); assert.strictEqual(X.normalizarChave('cnpj', '12.345.678/0001-95'), '12345678000195');
  assert.strictEqual(X.normalizarChave('email', ' Adair@Banca.com.br '), 'adair@banca.com.br'); assert.strictEqual(X.normalizarChave('email', 'sem-arroba'), '');
  assert.strictEqual(X.normalizarChave('aleatoria', '123E4567-E12B-12D1-A456-426655440000'), '123e4567-e12b-12d1-a456-426655440000'); assert.strictEqual(X.normalizarChave('aleatoria', 'qualquer'), ''); assert.strictEqual(X.normalizarChave('outro', 'x'), '');
  // o código: valor com 2 casas, nome sem acento e no limite, número do pedido como identificação, verificador coerente
  const pix = { tipo: 'celular', chave: '(62) 99999-8888', nome: 'Adair José da Silva Pereira Santos', cidade: 'Goiânia' };
  const c = X.codigoPix(pix, 49.9, 'ped-9x7k2m4');
  assert.ok(c.startsWith('000201') && c.includes('0014br.gov.bcb.pix0114+5562999998888') && c.includes('540549.90') && c.includes('5802BR') && c.includes('6007Goiania') && c.includes('0510ped9x7k2m4'), c);
  assert.ok(c.includes('5925Adair Jose da Silva Perei'), 'nome cortado em 25, sem acento'); assert.strictEqual(c.slice(-4), X.crc16(c.slice(0, -4)), 'o verificador fecha');
  assert.ok(/^[\x20-\x7e]+$/.test(c), 'só caracteres simples');
  assert.ok(X.codigoPix(pix, 1234.5, '').includes('54071234.50') && X.codigoPix(pix, 10, '').includes('0503***'));
  for (const [px, v] of [[pix, 0], [pix, -5], [pix, 'abc'], [{ ...pix, chave: '123' }, 10], [null, 10]]) assert.strictEqual(X.codigoPix(px, v, 'x'), '', JSON.stringify([px && px.chave, v]));
  assert.strictEqual(X.pixDaLojaValido(pix), true); assert.strictEqual(X.pixDaLojaValido({ ...pix, nome: '' }), false); assert.strictEqual(X.pixDaLojaValido(null), false);
  assert.strictEqual(X.chaveBonita(pix), '(62) 99999-8888'); assert.strictEqual(X.chaveBonita({ tipo: 'cpf', chave: '12345678909', nome: 'A' }), '123.456.789-09');
});

teste('maquininha: só o proprietário liga; a busca soma as vendas do dia sem contar parcela duas vezes', async () => {
  const M = require(raiz('lib/maquininha'));
  // leitura das linhas: venda parcelada vem em 3 linhas e conta uma vez; cancelamento vai para estornos; campo estranho não quebra
  const linhas = [
    { tipo_evento: '1', codigo_transacao: 'A1', valor_total_transacao: 300, meio_pagamento: '3', parcela: 1 }, { tipo_evento: '1', codigo_transacao: 'A1', valor_total_transacao: 300, meio_pagamento: '3', parcela: 2 },
    { tipo_evento: '1', codigo_transacao: 'A1', valor_total_transacao: 300, meio_pagamento: '3', parcela: 3 }, { tipo_evento: '1', codigo_transacao: 'B2', valor_total_transacao: '45,50', meio_pagamento: '8' },
    { tipo_evento: '1', codigo_transacao: 'C3', valor_total_transacao: 20, meio_pagamento: '11' }, { tipo_evento: '1', codigo_transacao: 'D4', valor_total_transacao: 10, meio_pagamento: '99' },
    { tipo_evento: '6', codigo_transacao: 'B2', valor_total_transacao: -45.5, meio_pagamento: '8' }, { qualquer: 'coisa' }, null ];
  const r = M.resumir(linhas);
  assert.strictEqual(r.total, 375.5); assert.strictEqual(r.vendas, 4); assert.strictEqual(r.estornos, 45.5);
  assert.deepStrictEqual(r.porMeio, { credito: 300, debito: 45.5, pix: 20, outros: 10 });
  assert.strictEqual(M.resumir([{ a: 1 }]).reconhecidas, 0); assert.strictEqual(M.resumir(null).total, 0);

  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), ontem = new Date(Date.now() - 27 * 3600000).toISOString().slice(0, 10);
  const db = criarBanco({ ...semente(), [`resumos/${ontem}`]: { receita: 120, pedidos: 3 }, 'tenants/espetinhos': { nome: 'Espetinhos', ativo: true } });
  const eq = carregarApi(raiz('api/equipe.js'), criarAdmin(db, { dono: { uid: 'a-1', admin: true }, adm: { uid: 'b-1', tenants: { banca: 'administrador' } }, outro: { uid: 'o-1', tenants: { espetinhos: 'proprietario' } } }));
  const ce = (tk, body, loja) => chamar(eq, { headers: { authorization: `Bearer ${tk}`, ...(loja ? { 'x-loja': loja } : {}) }, body });
  const fetchReal = global.fetch, idas = []; let resposta = () => ({ ok: true, status: 200, headers: { get: () => 'TRUE' }, json: async () => ({ detalhes: linhas, pagination: { totalPages: 1 } }) });
  global.fetch = async (url, o) => { idas.push({ url: String(url), auth: o.headers.Authorization }); return resposta(); };
  try {
    assert.strictEqual((await ce('adm', { acao: 'maquininha-salvar', estabelecimento: '123456', token: 'tok-da-maquininha-0001' })).status, 403, 'administrador não mexe nas credenciais');
    assert.strictEqual((await ce('dono', { acao: 'maquininha-buscar' })).status, 400, 'sem credenciais, não busca');
    for (const ruim of [{ estabelecimento: 'abc', token: 'tok-da-maquininha-0001' }, { estabelecimento: '123456', token: 'curto' }, { estabelecimento: '123456', token: 'com espaço no meio aaaaaaaa' }])
      assert.strictEqual((await ce('dono', { acao: 'maquininha-salvar', ...ruim })).status, 400, JSON.stringify(ruim));
    const s = await ce('dono', { acao: 'maquininha-salvar', estabelecimento: '123456', token: 'tok-da-maquininha-0001' }); assert.strictEqual(s.status, 200); assert.strictEqual(s.corpo.ligada, true);
    assert.ok(!JSON.stringify(s.corpo).includes('tok-da-maquininha'), 'o token não volta para a tela'); assert.ok(db._dados.has('plataforma/maquininha_banca'));
    assert.strictEqual((await ce('dono', { acao: 'maquininha-buscar', dia: hoje })).status, 400, 'o dia de hoje ainda não existe no PagBank');
    const b = await ce('dono', { acao: 'maquininha-buscar' }); assert.strictEqual(b.status, 200, JSON.stringify(b.corpo));
    assert.strictEqual(b.corpo.buscado.total, 375.5); assert.strictEqual(b.corpo.buscado.dia, ontem);
    assert.ok(idas[0].url.endsWith(`/transactional/${ontem}?pageNumber=1&pageSize=1000`)); assert.strictEqual(idas[0].auth, 'Basic ' + Buffer.from('123456:tok-da-maquininha-0001').toString('base64'));
    const linha = b.corpo.dias.find((x) => x.dia === ontem); assert.strictEqual(linha.maquininha.total, 375.5); assert.strictEqual(linha.painel, 120, 'ao lado, o que o painel registrou no dia');
    assert.strictEqual(db._dados.get(`maquininha/${ontem}`).vendas, 4);
    // a credencial de uma loja não serve para outra
    assert.strictEqual((await ce('outro', { acao: 'maquininha-estado' }, 'espetinhos')).corpo.ligada, false); assert.strictEqual((await ce('outro', { acao: 'maquininha-buscar' }, 'espetinhos')).status, 400);
    // PagBank recusa a chave, ou cai: erro claro e nada gravado por cima
    resposta = () => ({ ok: false, status: 401, json: async () => ({}) }); const neg = await ce('dono', { acao: 'maquininha-buscar' }); assert.strictEqual(neg.status, 400); assert.ok(/recusou/.test(neg.corpo.error));
    assert.strictEqual(db._dados.get(`maquininha/${ontem}`).total, 375.5);
    // formato que o painel não conhece: guarda só os nomes dos campos, sem valor
    resposta = () => ({ ok: true, status: 200, json: async () => ({ detalhes: [{ campoNovo: 'segredo-123', outro: 5 }] }) });
    const des = (await ce('dono', { acao: 'maquininha-buscar' })).corpo.buscado; assert.deepStrictEqual(des.formatoDesconhecido, ['campoNovo', 'outro']); assert.ok(!JSON.stringify(des).includes('segredo-123'));
    // desligar: os dois campos vazios
    assert.strictEqual((await ce('dono', { acao: 'maquininha-salvar', estabelecimento: '', token: '' })).corpo.ligada, false); assert.ok(!db._dados.has('plataforma/maquininha_banca'));
  } finally { global.fetch = fetchReal; }
});

teste('PIX: a chave do PagBank também entra pela tela Plataforma, e nunca volta para ela', async () => {
  const S = require(raiz('lib/segredos'));
  const db = criarBanco({}); const adm = criarAdmin(db, { super: { uid: 's-1', plataforma: true }, dono: { uid: 'd-1', admin: true } });
  const plat = carregarApi(raiz('api/plataforma.js'), adm), cp = (tk, body) => chamar(plat, { headers: { authorization: `Bearer ${tk}` }, body });
  const antes = process.env.PAGBANK_API_TOKEN; delete process.env.PAGBANK_API_TOKEN;
  try {
    assert.strictEqual(await S.pagbank(db), '');
    assert.strictEqual((await cp('dono', { acao: 'pagbank', chave: 'a'.repeat(40) })).status, 403);
    for (const ruim of ['curta', 'tem espaço dentro da chave aqui sim', 'x'.repeat(400)]) assert.strictEqual((await cp('super', { acao: 'pagbank', chave: ruim })).status, 400, ruim.slice(0, 12));
    const CHAVE = 'A1b2-C3d4.E5f6_G7h8=I9j0+K1l2/M3n4';
    assert.strictEqual((await cp('super', { acao: 'pagbank', chave: CHAVE })).status, 200);
    const lista = (await cp('super', { acao: 'lojas' })).corpo; assert.strictEqual(lista.pix, true); assert.ok(!JSON.stringify(lista).includes(CHAVE));
    S._zerar(); assert.strictEqual(await S.pagbank(db), CHAVE);
    process.env.PAGBANK_API_TOKEN = 'da-vercel'; assert.strictEqual(await S.pagbank(db), 'da-vercel', 'a variável da Vercel continua mandando'); delete process.env.PAGBANK_API_TOKEN;
    assert.strictEqual((await cp('super', { acao: 'pagbank', chave: '' })).status, 200); S._zerar(); assert.strictEqual(await S.pagbank(db), '');
  } finally { if (antes === undefined) delete process.env.PAGBANK_API_TOKEN; else process.env.PAGBANK_API_TOKEN = antes; }
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

teste('zerar: apaga o movimento e o que o motor aprendeu, guarda cópia antes e não toca no cadastro nem em outra loja', async () => {
  const P = require(raiz('lib/prudencia'));
  const base = { ...semente(), 'pedidos/p1': { nome: 'Ana', total: 10, data: new Date().toISOString() }, 'pedidos/p2': { nome: 'Bia', total: 20, data: new Date().toISOString() },
    'resumos/2026-10-05': { receita: 30, pedidos: 2 }, 'fechamentos/2026-10-05': { total: 30 }, 'analytics/dashboard': { x: 1 }, 'analytics_vendas/2026-10-05': { tomate: 3 }, 'analytics_clientes/c1': { n: 2 },
    'analytics_uid/u1': { cliente: 'c1' }, 'analytics_previsoes/painel': { p: 1 }, 'analytics_previsoes_chunks/0': { p: 1 }, 'analytics_meta/execucao': { em: 1 }, 'analytics_config/params': { margem: 0.3 },
    'estoque_mov/m1': { tipo: 'compra', qtd: 5 }, 'estoque_resumo/2026-10': { compras: 5 }, 'producoes/x1': { qtd: 2 }, 'crm/c1': { nota: 'ligar' }, 'maquininha/2026-10-05': { total: 99 },
    'loja/avaliacoes': { soma: 9, n: 2 }, 'loja/fotos': { itens: [{ url: 'https://i.ibb.co/a.webp' }] }, 'cupons/BEMVINDO': { percentual: 10, usos: 7, ativo: true }, 'calendario/e1': { titulo: 'Ceasa' }, 'equipe/u9': { papel: 'caixa' },
    'tenants/espetinhos': { nome: 'Espetinhos', ativo: true }, 'tenants/espetinhos/pedidos/pe1': { nome: 'Zé', total: 9 }, 'tenants/espetinhos/analytics_vendas/2026-10-05': { carne: 4 } };
  const db = criarBanco(base), produtosAntes = JSON.stringify(db._dados.get('produtos/tomate')), configAntes = JSON.stringify(db._dados.get('loja/config'));
  const eq = carregarApi(raiz('api/equipe.js'), criarAdmin(db, { dono: { uid: 'a-1', admin: true }, adm: { uid: 'b-1', tenants: { banca: 'administrador' } } }));
  const ce = (tk, body) => chamar(eq, { headers: { authorization: `Bearer ${tk}` }, body });
  assert.strictEqual((await ce('adm', { acao: 'zerar-movimento', confirmacao: 'ZERAR' })).status, 403, 'só o proprietário zera');
  for (const sem of [undefined, '', 'sim', 'zera']) assert.strictEqual((await ce('dono', { acao: 'zerar-movimento', confirmacao: sem })).status, 400, String(sem));
  assert.ok(db._dados.has('pedidos/p1'), 'sem a palavra, nada é apagado');
  const r = await ce('dono', { acao: 'zerar-movimento', confirmacao: 'zerar' }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  for (const foi of ['pedidos/p1', 'pedidos/p2', 'resumos/2026-10-05', 'fechamentos/2026-10-05', 'analytics/dashboard', 'analytics_vendas/2026-10-05', 'analytics_clientes/c1', 'analytics_uid/u1', 'analytics_previsoes/painel',
    'analytics_previsoes_chunks/0', 'analytics_meta/execucao', 'estoque_mov/m1', 'estoque_resumo/2026-10', 'producoes/x1', 'crm/c1', 'maquininha/2026-10-05', 'loja/avaliacoes']) assert.ok(!db._dados.has(foi), 'devia ter saído: ' + foi);
  assert.strictEqual(JSON.stringify(db._dados.get('produtos/tomate')), produtosAntes, 'produto intacto'); assert.strictEqual(JSON.stringify(db._dados.get('loja/config')), configAntes, 'configuração intacta');
  for (const fica of ['loja/fotos', 'calendario/e1', 'equipe/u9', 'analytics_config/params', 'tenants/espetinhos/pedidos/pe1', 'tenants/espetinhos/analytics_vendas/2026-10-05']) assert.ok(db._dados.has(fica), 'devia ter ficado: ' + fica);
  assert.strictEqual(db._dados.get('cupons/BEMVINDO').usos, 0); assert.strictEqual(db._dados.get('cupons/BEMVINDO').percentual, 10, 'o cupom fica, só a contagem zera');
  assert.ok(r.corpo.total >= 16, 'conta o que apagou'); assert.ok(/-antes-de-zerar$/.test(r.corpo.copiaDeAntes));
  const copia = await P.lerCopia(db, 'banca', r.corpo.copiaDeAntes); assert.ok(copia.colecoes.pedidos.p1 && copia.colecoes.pedidos.p2, 'os pedidos ficaram guardados na cópia de antes');
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
  const svg = (await ch({ loja: 'pao-da-lu', icone: '1' })).corpo; assert.ok(svg.startsWith('<svg') && svg.includes('fill="#7a2e12"') && svg.includes(L.ARTES.pao));
  assert.ok((await ch({ loja: 'horta', icone: '1' })).corpo.includes('#E9A862'), 'hortifruti leva o caixote colorido');
  const ruim = (await ch({ loja: 'ruim', icone: '1' })).corpo; assert.ok(!ruim.includes('script') && ruim.includes('fill="#1a3a2a"'), 'cor inválida cai na padrão');
  for (const q of [{ loja: 'banca' }, { loja: 'fechada' }, { loja: 'nao-existe' }, { loja: '../x' }, {}]) assert.strictEqual((await ch(q)).status, 404, JSON.stringify(q));
  assert.strictEqual((await ch({ loja: 'pao-da-lu' }, 'POST')).status, 405);
  // o PAINEL é outro aplicativo: abre o admin, tem outra identidade (não substitui o da loja) e outro ícone
  const mp = JSON.parse((await ch({ loja: 'pao-da-lu', painel: '1' })).corpo);
  assert.strictEqual(mp.start_url, '/admin.html?loja=pao-da-lu'); assert.strictEqual(mp.scope, '/admin.html'); assert.notStrictEqual(mp.id, m.id); assert.ok(mp.name.startsWith('Painel'));
  const svgP = (await ch({ loja: 'pao-da-lu', painel: '1', icone: '1' })).corpo; assert.ok(svgP.includes('fill="#F6F1E4"') && svgP.includes('rx="72" fill="#7a2e12"') && svgP !== svg);
  const fixo = JSON.parse(require('fs').readFileSync(raiz('admin.webmanifest'), 'utf8')), cfgVite = require('fs').readFileSync(raiz('vite.config.js'), 'utf8');
  assert.strictEqual(fixo.start_url, '/admin.html'); assert.strictEqual(fixo.id, '/admin.html'); assert.strictEqual(fixo.scope, '/admin.html');
  for (const i of fixo.icons) { assert.ok(require('fs').existsSync(raiz(i.src.slice(1))), i.src); assert.ok(cfgVite.includes(`'${i.src.slice(1)}'`), 'o build copia ' + i.src); }
  assert.ok(cfgVite.includes("'admin.webmanifest'")); assert.ok(require('fs').readFileSync(raiz('admin.html'), 'utf8').includes('href="/admin.webmanifest"'));
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
  // (a trava de rajada fica na memória e é zerada a cada envio: aqui o que se testa é a conta guardada no banco)
  const mandar = (ipTxt, extra) => { require(raiz('lib/http'))._usos.clear(); return chamar(api, { headers: { 'x-forwarded-for': ipTxt }, body: pedido(extra) }); };
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
  dbRuim.runTransaction = async (fn) => { n++; if (n === 3) throw Object.assign(new Error('14 UNAVAILABLE: segredo interno'), { code: 14 }); return tx(fn); };   // as 2 primeiras transações são as dos limites (conexão e loja)
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
  assert.deepStrictEqual(V.images.remotePatterns.map((p) => p.hostname), F.HOSTS_DAS_FOTOS, 'vercel.json e js/foto-lib.js aceitam fotos dos mesmos lugares');
  assert.ok(V.images.remotePatterns.every((p) => p.protocol === 'https' && p.hostname !== '**' && p.hostname !== '*'), 'o redutor de imagens não aceita qualquer endereço da internet');
  for (const fora of ['https://fotos.exemplo.com/a/tomate.jpg', 'https://ibb.co.site-do-mal.com/a.jpg', 'https://site-do-mal.com/i.ibb.co/a.jpg', 'https://xibb.co/a.jpg']) assert.strictEqual(F.miniatura(fora, 384, 'site-banca1.vercel.app'), fora, 'foto guardada em outro lugar aparece no tamanho original: ' + fora);
  assert.ok(F.miniatura('https://firebasestorage.googleapis.com/v0/b/x/o/a.webp?alt=media', 384, 'site-banca1.vercel.app').startsWith('/_vercel/image?url='));
  const u = 'https://i.ibb.co/a/tomate.jpg?x=1&y=2';
  assert.strictEqual(F.miniatura(u, 384, 'site-banca1.vercel.app'), '/_vercel/image?url=' + encodeURIComponent(u) + '&w=384&q=75');
  assert.ok(F.miniatura(u, 128, 'www.loja.com.br').includes('&w=128&'));
  assert.ok(F.miniatura(u, 999, 'www.loja.com.br').includes('&w=384&'), 'largura fora da lista cai na padrão');
  for (const host of ['localhost', '127.0.0.1', '192.168.0.10', '']) assert.strictEqual(F.miniatura(u, 384, host), u, host);
  for (const fica of ['', null, 'data:image/png;base64,AAAA', 'blob:https://x/1', 'http://sem-s.com/a.jpg', 'https://i.ibb.co/logo.svg', 'https://i.ibb.co/a.jpg" onerror="x']) assert.strictEqual(F.miniatura(fica, 384, 'www.loja.com.br'), String(fica || ''));
});

teste('cabeçalho: cada tipo de negócio tem o seu desenho', async () => {
  const A = await import(raiz('js/arte-lib.js'));
  const casos = { hortifruti: 'caixote', 'Feira de Frutas': 'caixote', espetinhos: 'espeto', jantinha: 'prato', Padaria: 'pao', 'Pães': 'pao', 'Açaí': 'tigela', Pizzaria: 'pizza', 'Hambúrgueres': 'burger', Confeitaria: 'doce', Doces: 'doce', Bolo: 'bolo', Bolos: 'bolo', 'Sucos e Cafés': 'copo', 'Creme e suco': 'copo', Crepe: 'crepe', Pastel: 'pastel', 'Pastéis': 'pastel', 'Macarrão': 'macarrao', 'Caldo de cana': 'cana', Caldos: 'tigela', 'Queijo/ovos/mel e doces da roça': 'queijo', 'Banca do queijo': 'queijo', Mel: 'queijo', Pamonha: 'pamonha', 'Cachorro quente': 'hotdog', 'Loja de Presentes': 'sacola', '': 'sacola' };
  for (const [tipo, esperado] of Object.entries(casos)) assert.strictEqual(A.arteDoTipo(tipo), esperado, tipo);
  for (const [nome, html] of Object.entries(A.ARTES)) assert.ok(html.length > 40 && !/<script|on\w+=|href/i.test(html), nome);
  assert.ok(Object.values(casos).every((q) => q === 'caixote' || A.ARTES[q]));
});

teste('plataforma: dono que veio pelo terminal fica registrado ao usar a tela, e ninguém mais assume', async () => {
  const db = criarBanco({});
  const usuarios = [{ uid: 'sup-1', email: 'eu@x.com', customClaims: { plataforma: true } }, { uid: 'pai-1', email: 'pai@x.com', customClaims: { tenants: { banca: 'proprietario' } } }];
  const tokens = { eu: { uid: 'sup-1', email: 'eu@x.com', plataforma: true }, pai: { uid: 'pai-1', email: 'pai@x.com', tenants: { banca: 'proprietario' } }, caixa: { uid: 'c-1', tenants: { banca: 'caixa' } } };
  const api = carregarApi(raiz('api/plataforma.js'), criarAdmin(db, tokens, usuarios));
  const ch = (tk, body) => chamar(api, { headers: { authorization: `Bearer ${tk}` }, body });
  assert.strictEqual((await ch('pai', { acao: 'situacao' })).corpo.temDono, false, 'antes de o dono abrir a tela, não há registro');
  assert.strictEqual((await ch('eu', { acao: 'lojas' })).status, 200);
  assert.strictEqual(db._dados.get('plataforma/dono').uid, 'sup-1', 'usar a tela grava quem é o dono');
  assert.strictEqual((await ch('pai', { acao: 'situacao' })).corpo.temDono, true);
  assert.strictEqual((await ch('pai', { acao: 'assumir' })).status, 403, 'o proprietário da loja não vira dono da plataforma');
  assert.deepStrictEqual(usuarios.find((u) => u.uid === 'pai-1').customClaims, { tenants: { banca: 'proprietario' } }, 'a conta dele não ganhou nada');
  assert.strictEqual((await ch('pai', { acao: 'lojas' })).status, 403); assert.strictEqual((await ch('pai', { acao: 'feira', fid: 'x1', nome: 'X', lojas: ['banca'] })).status, 403);
  assert.strictEqual((await ch('eu', { acao: 'situacao' })).corpo.souEu, true);
});

teste('card: produto de quilo tem os dois botões (unidade e quilo), cada um com o que põe no pedido e o preço', async () => {
  const M = await import(raiz('js/modo-lib.js')), fs = require('fs');
  const cebola = { id: 'cebola', nome: 'Cebola roxa', preco: 11.9, unidade: 'kg', pesoMedio: 100 }, batata = { id: 'batata', nome: 'Batata', preco: 7.5, unidade: 'Kg' };
  assert.strictEqual(M.temDoisModos(cebola), true); assert.strictEqual(M.temDoisModos(batata), true, 'maiúscula também é quilo');
  for (const u of ['un', 'maço', 'bdj', 'g', 'l', '', undefined]) assert.strictEqual(M.temDoisModos({ id: 'x', preco: 5, unidade: u }), false, `"${u}" continua com um botão só`);
  assert.strictEqual(M.temDoisModos({ id: 'x', preco: 0, unidade: 'kg' }), false); assert.strictEqual(M.temDoisModos(null), false);
  // ordem: unidade em cima, a não ser que a loja ou o cliente prefira o quilo
  assert.deepStrictEqual(M.botoesDoCard(cebola, {}).map((b) => `${b.modo}|${b.titulo}|${b.preco}`), ['un|+ 1 unidade|≈ R$ 1,19', 'kg|+ 1 kg|R$ 11,90']);
  assert.deepStrictEqual(M.botoesDoCard({ ...cebola, mostrarPrimeiro: 'kg' }, {}).map((b) => b.modo), ['kg', 'un'], 'a loja marcou "por quilo" no cadastro');
  assert.deepStrictEqual(M.botoesDoCard({ ...cebola, mostrarPrimeiro: 'kg' }, { cebola: 'un' }).map((b) => b.modo), ['un', 'kg'], 'o que o cliente escolheu ganha do cadastro');
  assert.deepStrictEqual(M.botoesDoCard(cebola, { cebola: 'kg' }).map((b) => b.modo), ['kg', 'un']);
  assert.strictEqual(M.botoesDoCard(batata, {})[0].preco, 'pesamos na hora', 'sem peso médio não se inventa preço de unidade');
  for (const ruim of [{ cebola: 'toneladas' }, { cebola: 1 }, null, 'kg', { toString: 'kg' }]) assert.strictEqual(M.modoPreferido(cebola, ruim), 'un', 'memória estranha não muda nada');
  assert.strictEqual(M.modoPreferido({ id: 'toString', nome: 'x', preco: 1, unidade: 'kg' }, {}), 'un', 'id com nome de coisa interna não confunde');
  assert.deepStrictEqual(M.limparMemoria({ cebola: 'kg', 'a b': 'kg', tomate: 'un', x: '<img>', y: null }), { cebola: 'kg', tomate: 'un' }); assert.deepStrictEqual(M.limparMemoria(['kg']), {}); assert.deepStrictEqual(M.limparMemoria('x'), {});
  // contador: unidade de 1 em 1, quilo de meio em meio; zero tira do pedido
  assert.strictEqual(M.proximaQtd({ tipo: 'un', qtd: 1 }, 1), 2); assert.strictEqual(M.proximaQtd({ tipo: 'un', qtd: 1 }, -1), 0);
  assert.strictEqual(M.proximaQtd({ tipo: 'kg', qtd: 1 }, 1), 1.5); assert.strictEqual(M.proximaQtd({ tipo: 'kg', qtd: 1 }, -1), 0.5); assert.strictEqual(M.proximaQtd({ tipo: 'kg', qtd: 0.5 }, -1), 0);
  assert.strictEqual(M.proximaQtd({ tipo: 'kg', qtd: 0.3 }, -1), 0, 'quantidade fina vinda da tela do produto não vira negativa'); assert.strictEqual(M.proximaQtd({ tipo: 'kg', qtd: 0.3 }, 1), 0.8);
  assert.deepStrictEqual(M.textoNoPedido(cebola, { tipo: 'un', qtd: 2 }), { titulo: '2 unidades', curto: '2 un', valor: '≈ R$ 2,38' });
  assert.deepStrictEqual(M.textoNoPedido(cebola, { tipo: 'un', qtd: 1 }), { titulo: '1 unidade', curto: '1 un', valor: '≈ R$ 1,19' });
  assert.deepStrictEqual(M.textoNoPedido(cebola, { tipo: 'kg', qtd: 1.5 }), { titulo: '1,5 kg', curto: '1,5 kg', valor: 'R$ 17,85' });
  assert.strictEqual(M.textoNoPedido(batata, { tipo: 'un', qtd: 3 }).valor, 'a pesar');
  // a loja e o painel usam estas regras
  const loja = fs.readFileSync(raiz('js/loja.js'), 'utf8'), painel = fs.readFileSync(raiz('js/admin.js'), 'utf8'), html = fs.readFileSync(raiz('admin.html'), 'utf8');
  assert.ok(/data-action="add" data-modo="\$\{b\.modo\}"/.test(loja) && loja.includes("data-action=\"trocar\""), 'o card desenha os dois botões e o "Trocar para"');
  assert.ok(loja.includes('modificarCarrinho(id, 1, true, modo)'), 'o toque põe exatamente 1 do jeito escrito no botão');
  assert.ok(loja.indexOf("const cardDoToque = actionTarget.closest('.produto-card');") > 0 && loja.indexOf("const cardDoToque = actionTarget.closest('.produto-card');") < loja.indexOf('modificarCarrinho(id, 1, true, modo)'), 'o card é achado antes de redesenhar os botões (senão o produto não voa para o pedido)');
  assert.ok(html.includes('id="edit-mostrar-primeiro"') && painel.includes("mostrarPrimeiro: document.getElementById('edit-mostrar-primeiro')"), 'o cadastro do produto grava qual botão vem em cima');
});

teste('iPhone e tela desatualizada: recarga busca no servidor, pedido não fica preso e o toque duplo não dá zoom', async () => {
  const V = await import(raiz('js/versao-lib.js')), fs = require('fs'), ler = (f) => fs.readFileSync(raiz(f), 'utf8');
  // recarregar com "?v=" novo: a página vem do servidor, não da cópia guardada; os outros parâmetros ficam
  assert.strictEqual(V.enderecoFresco('/', '', 123), '/?v=123'); assert.strictEqual(V.enderecoFresco('/', '?loja=paes', 123), '/?loja=paes&v=123');
  assert.strictEqual(V.enderecoFresco('/admin.html', '?v=1&loja=x', 9), '/admin.html?v=9&loja=x', 'troca o v antigo em vez de empilhar');
  assert.strictEqual(V.enderecoFresco('//outro-site.com/x', '', 5), '/?v=5', 'endereço que apontaria para outro site vira a página inicial'); assert.strictEqual(V.enderecoFresco('', '', 5), '/?v=5');
  const utils = ler('js/utils.js'), loja = ler('js/loja.js'), fb = ler('js/firebase.js'), css = ler('css/visual.css');
  assert.ok(/pendente = false; recarregarFresco\(\);/.test(utils) && !/window\.location\.reload\(\);\n  \};/.test(utils), 'a recarga automática busca a página no servidor');
  assert.ok(loja.includes('if (haVersaoNova()) return recarregarComPedidoGuardado('), 'tela velha se atualiza ANTES de abrir a tela de entrega');
  assert.ok(/conferirVersaoAgora\(\)\.then\(\(velha\)/.test(loja), 'pedido recusado numa tela velha: atualiza e deixa enviar de novo');
  assert.ok(/Promise\.race\(\[usuario\.getIdToken\(\)/.test(loja), 'renovar o login não segura o envio do pedido');
  assert.ok(/ehApple \? memoryLocalCache\(\) : persistentLocalCache/.test(fb), 'no iPhone o banco lê sempre da internet (sem cópia velha da configuração)');
  assert.ok(/touch-action: manipulation/.test(css), 'dois toques rápidos no + não dão zoom no iPhone');
  assert.ok(!/^\.card-add:hover/m.test(css), 'efeito de mouse não gruda no celular depois do toque');
  assert.ok(loja.includes("ehIphone() ? 'Pedido recebido! Agora toque no botão verde"), 'no iPhone a tela pede o toque no botão do WhatsApp em vez de prometer abrir sozinho');
});

teste('plataforma: modelos iguais nos dois lados, endereço sugerido e abas por módulo', async () => {
  const L = await import(raiz('js/plataforma-lib.js')), Ap = await import(raiz('js/aparencia-lib.js')), M = require(raiz('lib/modelos')), P = await import(raiz('js/papeis-lib.js')), T = require(raiz('lib/tenant'));
  for (const [k, m] of Object.entries(M.MODELOS)) assert.deepStrictEqual(m, JSON.parse(JSON.stringify(Ap.MODELOS[k])), `lib/modelos.js e js/aparencia-lib.js: o modelo ${k} é igual nos dois`);
  for (const k of ['hortifruti', 'espetinhos', 'jantinha']) assert.ok(M.MODELOS[k], k);
  assert.strictEqual(L.sugerirId('  Espetinhos do Zé!! '), 'espetinhos-do-ze'); assert.strictEqual(L.sugerirId('Açaí & Cia'), 'acai-cia'); assert.ok(T.idValido(L.sugerirId('Jantinha da Lú — Setor Bueno 2')));
  assert.strictEqual(L.idValido(L.sugerirId('x'.repeat(80))), true); assert.strictEqual(L.idValido(''), false);
  // feira do dia: quarta só tem a banca; sábado tem a banca e os pães; nos outros dias, nenhuma
  const qua = { nome: 'Atenas', dias: [3], lojas: [{ id: 'banca' }] }, sab = { nome: 'Munique', dias: [6], lojas: [{ id: 'banca' }, { id: 'paes' }] }, sempre = { nome: 'Antiga', lojas: [{ id: 'banca' }, { id: 'x' }] };
  assert.strictEqual(L.feiraDoDia([qua, sab], 3), qua); assert.strictEqual(L.feiraDoDia([qua, sab], 6), sab); assert.strictEqual(L.feiraDoDia([qua, sab], 4), null, 'dia sem feira: a faixa some');
  assert.strictEqual(L.feiraDoDia([sempre, qua], 3), qua, 'a feira do dia ganha da que vale sempre'); assert.strictEqual(L.feiraDoDia([sempre, qua], 1), sempre, 'feira sem dia marcado vale todo dia');
  assert.strictEqual(L.feiraDoDia(null, 3), null); assert.strictEqual(L.feiraDoDia([{ nome: 'quebrada' }, null], 3), null);
  assert.deepStrictEqual(L.limparDias([6, 3, 3, 7, -1, '2', 1.5]), [3, 6]); assert.strictEqual(L.diasEmTexto([3]), 'Qua'); assert.strictEqual(L.diasEmTexto([3, 6]), 'Qua e Sáb'); assert.strictEqual(L.diasEmTexto([]), 'Todos os dias');
  assert.deepStrictEqual(L.feirasDaFicha({ feiras: ['a1', 'b2', 'A!', 5], feiraId: 'b2' }), ['a1', 'b2']); assert.deepStrictEqual(L.feirasDaFicha({ feiraId: 'antiga' }), ['antiga']); assert.deepStrictEqual(L.feirasDaFicha(null), []);
  assert.ok(require('fs').readFileSync(raiz('plataforma.html'), 'utf8').includes('id="toast"'), 'a tela da plataforma tem a caixinha de aviso (sem ela, os avisos sumiam calados)');
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
  assert.strictEqual(abas.length, 17); abas.forEach((m) => assert.strictEqual(m[1] === 'relatorios' ? 'pedidos' : m[1], m[2], 'cada aba usa o ícone com o próprio nome (a de pedidos usa o de pedidos)'));
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

teste('conta do cliente (loja): junta o que voltou do servidor com o que já está no aparelho, sem perder nem inventar', async () => {
  const C = await import(raiz('js/conta-lib.js')), fs = require('fs');
  const cod = 'A'.repeat(16) + '.' + 'b'.repeat(43);
  assert.strictEqual(C.codigoDoEndereco(`#a=${cod}`), cod);
  for (const ruim of ['', '#', `#a=${cod}x`, `#a=${cod}&b=1`, `#b=${cod}`, '#a=<script>', `#modal-historico`, null, `#a=${'A'.repeat(16)}.${'b'.repeat(42)}`]) assert.strictEqual(C.codigoDoEndereco(ruim), '', 'recusa ' + ruim);
  // pedidos: sem repetir; o do servidor atualiza status e valor, e o que só existe no aparelho continua lá
  const locais = [{ id: 'p2', data: '2026-10-05T10:00:00Z', total: 10, descItens: '1x Ovos', itens: [{ id: 'ovos', qtd: 1 }] }, { id: 'so-local', data: '2026-10-01T10:00:00Z', total: 3 }];
  const j = C.juntarPedidos(locais, [{ id: 'p1', data: '2026-10-06T10:00:00Z', total: 20, status: 'enviado' }, { id: 'p2', data: '2026-10-05T10:00:00Z', total: 12.5, status: 'arquivado' }]);
  assert.deepStrictEqual(j.map((p) => p.id), ['p1', 'p2', 'so-local']); assert.strictEqual(j[1].total, 12.5); assert.strictEqual(j[1].status, 'arquivado'); assert.strictEqual(j[1].descItens, '1x Ovos');
  assert.strictEqual(C.juntarPedidos(Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, data: '2026-01-' + String(i + 1).padStart(2, '0') })), []).length, 10);
  assert.deepStrictEqual(C.juntarPedidos(null, 'lixo'), []); assert.deepStrictEqual(C.juntarPedidos([null, {}, { id: 'a' }], [undefined]).map((p) => p.id), ['a']);
  const p = C.perfilParaAparelho({ nome: ' Ana ', quadra: '5', lote: '3', condominio: 'Jardins Atenas', condominioId: 'atenas', formatoEndereco: 'ql', telefone: '(62) 98888-7777' });
  assert.deepStrictEqual(p.cliente, { nome: 'Ana', quadra: '5', lote: '3', tel: '62988887777' });
  assert.deepStrictEqual(p.endereco, { condominio: 'Jardins Atenas', condominioId: 'atenas', formatoEndereco: 'ql', quadra: '5', lote: '3' });
  assert.deepStrictEqual(C.perfilParaAparelho({}), { cliente: null, endereco: null }); assert.strictEqual(C.perfilParaAparelho({ nome: 'Ana', formatoEndereco: 'hack', quadra: '1' }).endereco.formatoEndereco, 'ql');
  assert.deepStrictEqual(C.unirFavs(['a', 'b'], ['b', 'c', 5, null]), ['a', 'b', 'c']);
  assert.deepStrictEqual(C.unirModo({ tomate: 'un' }, { tomate: 'kg', cebola: 'kg', x: 'banana' }), { tomate: 'un', cebola: 'kg' }, 'a escolha deste aparelho vence');
  assert.deepStrictEqual(C.sacolaParaGuardar([{ id: 7, qtd: 2, tipo: 'un', preco: 9, nome: 'x' }, { id: 'a', qtd: 0 }, null, { id: 'b', qtd: 1.5, tipo: 'kg' }]), [{ id: '7', qtd: 2, tipo: 'un' }, { id: 'b', qtd: 1.5, tipo: 'kg' }]);
  const agora = Date.parse('2026-10-08T12:00:00Z');
  assert.strictEqual(C.sacolaVale([{ id: 'a' }], '2026-10-01T12:00:00Z', agora), true); assert.strictEqual(C.sacolaVale([{ id: 'a' }], '2026-08-01T12:00:00Z', agora), false, 'sacola de dois meses atrás não volta');
  assert.strictEqual(C.sacolaVale([], '2026-10-01T12:00:00Z', agora), false); assert.strictEqual(C.sacolaVale([{ id: 'a' }], '', agora), false); assert.strictEqual(C.sacolaVale([{ id: 'a' }], '2027-01-01T00:00:00Z', agora), false);
  assert.strictEqual(C.foneParaWhats('(62) 98888-7777'), '5562988887777'); assert.strictEqual(C.foneParaWhats('5562988887777'), '5562988887777'); assert.strictEqual(C.foneParaWhats('5511'), ''); assert.strictEqual(C.foneParaWhats(''), '');
  const msg = C.mensagemDoLink('Ana Paula', 'Banca Adair e Pedrina', 'https://x/#a=1');
  assert.ok(msg.startsWith('Oi, Ana!') && msg.includes('https://x/#a=1') && /não repasse/.test(msg));
  // a loja: restaura ao abrir, guarda a sacola na conta, tem o botão de esquecer e a dica do link
  const loja = fs.readFileSync(raiz('js/loja.js'), 'utf8'), html = fs.readFileSync(raiz('index.html'), 'utf8'), crm = fs.readFileSync(raiz('js/admin-crm.js'), 'utf8');
  assert.ok(/buscarConta\(\{ semDados: !lerLista\('banca_clientes'\)\.length && !lerEnderecoSalvo\(\), confirmar: confirmarConta \}\)/.test(loja), 'só pergunta ao servidor quando o aparelho está sem dados (ou veio pelo link)');
  const cl = fs.readFileSync(raiz('js/conta-loja.js'), 'utf8');
  assert.ok(cl.indexOf("previa: true") > 0 && cl.indexOf("previa: true") < cl.indexOf("await confirmar(previa)") && cl.indexOf("await confirmar(previa)") < cl.indexOf("chamar({ acao: 'conta-entrar', codigo })"), 'link pessoal: primeiro a prévia, depois a pergunta, só então entra');
  assert.strictEqual(C.foneBonito('5562988887777'), '(62) 98888-7777'); assert.strictEqual(C.foneBonito('6232221111'), '(62) 3222-1111');
  assert.ok(/if \(STATE\.carrinho\.length\) return;\s+\/\/ a pessoa já começou outro pedido/.test(loja), 'a sacola guardada nunca passa por cima de um pedido em montagem');
  assert.ok(/data-action="esquecer-dados"/.test(html) && /id="sucesso-dica-acesso"[^>]*hidden/.test(html));
  assert.ok(/acao: 'conta-link'/.test(crm) && /customConfirm\('Gerar um link novo\?'/.test(crm) && !/window\.open\([^)]*j\.link/.test(crm), 'painel: confirma antes e o envio é um link tocado pela pessoa');
});

teste('horário de entrega é opcional na tela: sem escolha, o pedido segue como "a combinar"', () => {
  const fs = require('fs'), loja = fs.readFileSync(raiz('js/loja.js'), 'utf8'), html = fs.readFileSync(raiz('index.html'), 'utf8'), E = require(raiz('lib/entrega'));
  assert.ok(!/Escolha quando prefere receber/.test(loja), 'a tela não barra mais o envio sem horário');
  assert.ok(/<option value="">Tanto faz \(a combinar\)<\/option>/.test(loja) && /Quando prefere receber\? \(opcional\)/.test(html));
  const cfg = E.lerConfig({ entrega: { horarios: ['Manhã', 'Tarde'] } });
  assert.strictEqual(E.horarioValido(cfg, ''), ''); assert.strictEqual(E.horarioACombinar(cfg, ''), true); assert.strictEqual(E.horarioACombinar(cfg, 'Manhã'), false);
});

teste('aparência: os modelos prontos são legíveis, completos e passam pela conferência do tema', async () => {
  const A = await import(raiz('js/aparencia-lib.js'));
  const CORES = ['primaria', 'secundaria', 'destaque', 'fundo', 'superficie', 'texto', 'sobrePrimaria'];
  const cfg = { padrao: A.MODELOS.hortifruti, cores: CORES, fontesTitulo: A.FONTES.titulo, fontesTexto: A.FONTES.texto, formatos: A.FOTO_FORMATOS };
  assert.deepStrictEqual(Object.keys(A.MODELOS).sort(), Object.keys(A.NOMES_MODELOS).sort(), 'todo modelo tem nome no painel');
  for (const [nome, m] of Object.entries(A.MODELOS)) {
    assert.deepStrictEqual(A.temaSeguro(m, cfg), m, `${nome}: nada do modelo é descartado pela conferência`);
    for (const k of CORES) assert.ok(A.corValida(m[k]), `${nome}.${k}`);
    assert.deepStrictEqual(A.avisosDeContraste(m), [], `${nome}: o modelo não pode nascer com aviso de leitura`);
    assert.ok(A.FONTES.titulo[m.fonteTitulo] && A.FONTES.texto[m.fonteTexto], `${nome}: letras da lista`);
  }
  // toda letra da lista tem peso pedido certo (pedir peso que a fonte não tem derruba o carregamento)
  for (const f of Object.keys(A.PESOS)) assert.ok(A.FONTES.titulo[f] || A.FONTES.texto[f], f);
  // as opções do painel cabem na regra do banco (texto de até 20 letras) e o padrão de cada uma é o visual de sempre
  for (const [k, lista] of Object.entries(A.OPCOES)) { assert.ok(lista.length >= 2, k); for (const v of lista) assert.ok(/^[a-z-]{1,20}$/.test(v), `${k}=${v}`); }
  const regras = require('fs').readFileSync(raiz('firestore.rules'), 'utf8');
  for (const k of Object.keys(A.OPCOES)) assert.ok(new RegExp(`textoAte\\(t, '${k}', 20\\)`).test(regras), `regra do banco confere o campo ${k}`);
});

// ------------------------------------------------------------------ registro de erros do site
teste('erros do site: o navegador avisa sem login, o mesmo erro do dia é somado, dado pessoal não entra e só a plataforma lê', async () => {
  const E = require(raiz('lib/erros.js'));
  assert.strictEqual(E.navegadorResumido('Mozilla/5.0 (Linux; Android 14; SM-A15) AppleWebKit/537.36 Chrome/129.0.0.0 Mobile Safari/537.36'), 'Android · Chrome 129');
  assert.strictEqual(E.navegadorResumido('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'), 'iPhone · Safari 17');
  assert.strictEqual(E.semParametros('https://site-banca1.vercel.app/?loja=x&tel=62999#a'), '/', 'endereço sem parâmetros (podia ter telefone ou código)');
  assert.strictEqual(E.limparRelato({ msg: 'Script error.' }, ''), null, 'erro opaco de script de fora é barulho');
  assert.strictEqual(E.limparRelato({ msg: 'x', arquivo: 'chrome-extension://abc/c.js' }, ''), null, 'extensão do navegador é barulho');
  assert.strictEqual(E.limparRelato({ msg: '' }, ''), null);
  const db = criarBanco(semente()); const api = carregarApi(raiz('api/analytics.js'), criarAdmin(db, TOKENS));
  const ua = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile', 'x-forwarded-for': '10.0.0.9' };
  const erro = (n) => ({ acao: 'erro', tipo: 'erro', msg: `Cannot read properties of undefined (reading 'preco') item ${n}`, arquivo: 'https://site-banca1.vercel.app/assets/main-AB12.js?v=3', linha: 10, coluna: 5, pagina: '/?loja=paes-da-lucia&c=SEGREDO', loja: 'paes-da-lucia', pilha: 'at x (https://site-banca1.vercel.app/assets/main-AB12.js?t=1:10:5)' });
  let r = await chamar(api, { headers: ua, body: erro(1) }); assert.strictEqual(r.status, 204, 'aceita sem login');
  r = await chamar(api, { headers: ua, body: erro(2) }); assert.strictEqual(r.status, 204);
  const docs = [...db._dados.entries()].filter(([k]) => k.startsWith('erros_site/'));
  assert.strictEqual(docs.length, 1, 'mesmo erro (número diferente) no mesmo dia = um documento só');
  const d = docs[0][1];
  assert.strictEqual(d.vezes, 2); assert.strictEqual(d.onde, '/assets/main-AB12.js:10:5'); assert.deepStrictEqual(d.lojas, ['paes-da-lucia']);
  assert.ok(!JSON.stringify(d).includes('SEGREDO') && !JSON.stringify(d).includes('?'), 'nada dos parâmetros do endereço é guardado');
  assert.deepStrictEqual(d.navegadores, ['Android · Chrome 129']);
  // freio: 10 por minuto por endereço de internet
  let barrados = 0; for (let i = 0; i < 12; i++) if ((await chamar(api, { headers: ua, body: erro(i) })).status === 429) barrados++;
  assert.ok(barrados >= 2, 'freio por endereço de internet');
  // leitura: só a plataforma, pela API da plataforma
  const pf = carregarApi(raiz('api/plataforma.js'), criarAdmin(db, TOKENS));
  r = await chamar(pf, { headers: { Authorization: 'Bearer plataforma' }, body: { acao: 'erros' } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.corpo.erros.length, 1); assert.ok(r.corpo.erros[0].vezes >= 2);
  r = await chamar(pf, { headers: { Authorization: 'Bearer dona-banca' }, body: { acao: 'erros' } }); assert.strictEqual(r.status, 403, 'dona de loja não lê os erros da plataforma');
  // faxina: o que passou de 14 dias sai
  db._dados.set('erros_site/2000-01-01_x', { dia: '2000-01-01', msg: 'velho' });
  assert.strictEqual(await E.faxina(db), 1); assert.ok(!db._dados.has('erros_site/2000-01-01_x')); assert.strictEqual([...db._dados.keys()].filter((k) => k.startsWith('erros_site/')).length, 1);
  // as regras do banco não deixam navegador nenhum tocar em erros_site (cai na regra final que nega tudo)
  assert.ok(!/erros_site/.test(require('fs').readFileSync(raiz('firestore.rules'), 'utf8')));
});

teste('painel: item pedido por UNIDADE de produto de quilo mostra "un", não "kg"', async () => {
  // utils.js mexe na página ao carregar: uma página de mentira só para importar, e some depois
  const tinha = ['document', 'window', 'addEventListener'].filter((k) => k in globalThis);
  const vazio = () => null;
  Object.assign(globalThis, { document: { addEventListener: vazio, getElementById: vazio, querySelector: vazio, querySelectorAll: () => [], createElement: () => ({}), body: { appendChild: vazio } }, addEventListener: vazio });
  globalThis.window = globalThis;
  let U;
  try { U = await import(raiz('js/utils.js')); }
  finally { for (const k of ['document', 'window', 'addEventListener']) if (!tinha.includes(k)) delete globalThis[k]; }
  // como o servidor grava (api/checkout.js): unidade do PRODUTO + tipo que o cliente escolheu
  assert.strictEqual(U.qtdDoItem({ qtd: 3, tipo: 'un', unidade: 'kg', aPesar: true }), '3 un');
  assert.strictEqual(U.qtdDoItem({ qtd: 3, tipo: 'un', unidade: 'kg', aPesar: false, pesoFinal: 1.25 }), '3 un (1,25 kg)', 'depois de pesado mostra o peso junto');
  assert.strictEqual(U.qtdDoItem({ qtd: 1.5, tipo: 'kg', unidade: 'kg' }), '1,5 kg', 'pedido por quilo continua em kg');
  assert.strictEqual(U.qtdDoItem({ qtd: 2, tipo: 'un', unidade: 'un' }), '2x');
  assert.strictEqual(U.qtdDoItem({ qtd: 2, tipo: 'un', unidade: 'maço' }), '2x');
  // o painel não monta mais a quantidade do item só pela unidade do produto
  const admin = require('fs').readFileSync(raiz('js/admin.js'), 'utf8');
  assert.ok(!/formatarQtdRelatorio\(i(tem)?\.qtd, i(tem)?\.unidade\)/.test(admin), 'admin.js ainda usa a unidade do produto para a quantidade do pedido');
});

// ------------------------------------------------------------------ Rota A: servidor do Cloud Run + Cloudflare Pages
teste('cloud run: o servidor entrega body/query/status/json como a Vercel e confia no IP só com o segredo', async () => {
  const { criarServidor } = require(raiz('server'));
  const eco = async (req, res) => res.status(201).json({ metodo: req.method, body: req.body, query: req.query, ip: req.headers['x-real-ip'], host: req.headers['x-forwarded-host'] || null, vazou: ['x-proxy-segredo', 'x-cliente-ip', 'x-host-original'].filter((k) => k in req.headers) });
  const cru = async (req, res) => { let t = ''; for await (const c of req) t += c; res.status(200).json({ cru: t, body: req.body === undefined }); };
  cru.config = { api: { bodyParser: false } };
  const quebra = async () => { throw new Error('SEGREDO-INTERNO senha=123'); };
  const srv = criarServidor({ funcoes: { eco, cru, quebra }, segredo: 'segredo-do-proxy' });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const j = async (u, o) => { const r = await fetch(base + u, o); return { status: r.status, corpo: await r.json().catch(() => null) }; };
  try {
    assert.deepStrictEqual((await j('/saude')).corpo, { ok: true });
    assert.strictEqual((await j('/api/nao-existe')).status, 404);
    assert.strictEqual((await j('/api/..%2Fserver')).status, 404, 'só nomes simples de api/');
    // corpo JSON e parâmetros do endereço, status e json
    let r = await j('/api/eco?a=1&b=2&b=3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'x' }) });
    assert.strictEqual(r.status, 201); assert.deepStrictEqual(r.corpo.body, { acao: 'x' }); assert.deepStrictEqual(r.corpo.query, { a: '1', b: ['2', '3'] });
    assert.strictEqual((await j('/api/eco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{quebrado' })).status, 400);
    assert.strictEqual((await j('/api/eco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(6.5 * 1024 * 1024) }) })).status, 413, 'corpo grande demais');
    // corpo cru (aviso de pagamento): o servidor não lê antes da função
    r = await j('/api/cru', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a": 1}' });
    assert.deepStrictEqual(r.corpo, { cru: '{"a": 1}', body: true });
    // erro de dentro da função: 500 sem vazar a mensagem
    r = await j('/api/quebra'); assert.strictEqual(r.status, 500); assert.ok(!JSON.stringify(r.corpo).includes('SEGREDO'));
    // IP: direto no servidor, o que vale é o ÚLTIMO do X-Forwarded-For (os da frente o visitante escreve); x-real-ip do visitante é jogado fora
    r = await j('/api/eco', { headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9', 'X-Real-IP': '7.7.7.7', 'X-Forwarded-Host': 'loja-falsa.exemplo.com', 'X-Cliente-IP': '8.8.8.8' } });
    assert.strictEqual(r.corpo.ip, '203.0.113.9'); assert.strictEqual(r.corpo.host, null); assert.deepStrictEqual(r.corpo.vazou, []);
    // com o segredo certo (vindo do Cloudflare): vale o IP e o endereço que ele mandou
    const doProxy = { 'X-Proxy-Segredo': 'segredo-do-proxy', 'X-Cliente-IP': '198.51.100.7', 'X-Host-Original': 'Loja-Do-Ze.exemplo.com', 'X-Forwarded-For': '1.1.1.1, 104.16.0.1' };
    r = await j('/api/eco', { headers: doProxy });
    assert.strictEqual(r.corpo.ip, '198.51.100.7'); assert.strictEqual(r.corpo.host, 'loja-do-ze.exemplo.com'); assert.deepStrictEqual(r.corpo.vazou, [], 'os cabeçalhos de confiança não chegam à função');
    r = await j('/api/eco', { headers: { ...doProxy, 'X-Proxy-Segredo': 'errado' } });
    assert.strictEqual(r.corpo.ip, '104.16.0.1', 'segredo errado: ignora o que o "proxy" disse'); assert.strictEqual(r.corpo.host, null);
    r = await j('/api/eco', { headers: { ...doProxy, 'X-Cliente-IP': 'nao-e-ip; drop table' } });
    assert.strictEqual(r.corpo.ip, '104.16.0.1', 'IP inválido do proxy não vale');
  } finally { srv.close(); }
  // sem segredo configurado, nada é confiado (ninguém "acerta" um segredo vazio)
  const sem = criarServidor({ funcoes: { eco: async (req, res) => res.json({ ip: req.headers['x-real-ip'] }) }, segredo: '' });
  await new Promise((ok) => sem.listen(0, '127.0.0.1', ok));
  try { const r = await fetch(`http://127.0.0.1:${sem.address().port}/api/eco`, { headers: { 'X-Proxy-Segredo': '', 'X-Cliente-IP': '8.8.8.8' } }); assert.notStrictEqual((await r.json()).ip, '8.8.8.8'); } finally { sem.close(); }
});

teste('cloud run: o servidor enxerga as 12 funções de api/ e o Dockerfile leva o que elas usam', async () => {
  const { listarFuncoes } = require(raiz('server'));
  const fs = require('fs');
  assert.deepStrictEqual(Object.keys(listarFuncoes()).sort(), fs.readdirSync(raiz('api')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort());
  const docker = fs.readFileSync(raiz('Dockerfile'), 'utf8');
  for (const pasta of ['api', 'lib', 'analytics', 'server']) assert.ok(new RegExp(`COPY ${pasta} \\./${pasta}`).test(docker), `o Dockerfile precisa copiar ${pasta}/`);
  const ignorado = fs.readFileSync(raiz('.dockerignore'), 'utf8').split('\n').map((l) => l.trim().replace(/\/$/, ''));
  for (const pasta of ['api', 'lib', 'analytics', 'server', 'package.json', 'package-lock.json']) assert.ok(!ignorado.includes(pasta), `.dockerignore esconde ${pasta}, que o Dockerfile precisa copiar`);
  // tudo que api/ e lib/ importam de ../ existe nas pastas copiadas
  for (const arq of [...fs.readdirSync(raiz('api')).map((f) => 'api/' + f), ...fs.readdirSync(raiz('lib')).map((f) => 'lib/' + f)].filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(raiz(arq), 'utf8').matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
      const alvo = require('path').resolve(require('path').dirname(raiz(arq)), m[1]);
      assert.ok(/[/\\](api|lib|analytics|server)[/\\]/.test(alvo + '/'), `${arq} importa ${m[1]}, que não vai para a imagem`);
    }
  }
});

teste('cloudflare: _headers não soma cabeçalhos em nenhum endereço, /previa tem os dele e /api bate com o vercel.json', async () => {
  const C = require(raiz('lib/cloudflare-arquivos')), vercel = require(raiz('vercel.json'));
  const texto = C.gerarHeaders(vercel), trechos = texto.split('\n\n').slice(1).map((t) => { const [fim, ...hs] = t.split('\n'); return { padrao: fim.trim(), hs: Object.fromEntries(hs.map((l) => { const i = l.indexOf(':'); return [l.slice(2, i), l.slice(i + 2)]; })) }; });
  assert.ok(trechos.length < 100, 'o Cloudflare aceita até 100 trechos'); assert.ok(texto.split('\n').every((l) => l.length < 2000), 'linha de até 2000 letras');
  const caminhos = ['/', '/admin', '/admin.html', '/plataforma', '/feira', '/privacidade', '/assets/index-ab12.js', '/assets/x.css', '/sw.js', '/workbox-1a2b.js', '/registerSW.js', '/push-sw.js', '/manifest.webmanifest', '/admin.webmanifest', '/icon-192.png', '/icon-painel-512.png', '/og-image.png', '/robots.txt', '/sitemap.xml', '/previa'];
  for (const c of caminhos) {
    const vistos = {};
    for (const t of trechos.filter((x) => C.casa(x.padrao, c))) for (const k of Object.keys(t.hs)) vistos[k] = (vistos[k] || 0) + 1;
    assert.ok(Object.keys(vistos).length > 0, `${c} ficou sem cabeçalho de segurança`);
    for (const [k, n] of Object.entries(vistos)) assert.strictEqual(n, 1, `${c}: o cabeçalho ${k} cairia em ${n} trechos e seria somado`);
  }
  const de = (c) => Object.assign({}, ...trechos.filter((x) => C.casa(x.padrao, c)).map((x) => x.hs));
  assert.strictEqual(de('/previa')['X-Frame-Options'], 'SAMEORIGIN'); assert.ok(/frame-ancestors 'self'/.test(de('/previa')['Content-Security-Policy']));
  assert.strictEqual(de('/')['X-Frame-Options'], 'DENY'); assert.ok(/frame-ancestors 'none'/.test(de('/')['Content-Security-Policy']));
  assert.ok(/noindex/.test(de('/admin')['X-Robots-Tag']) && /noindex/.test(de('/plataforma')['X-Robots-Tag']) && !de('/')['X-Robots-Tag']);
  assert.deepStrictEqual(C.gerarRedirects(vercel).split('\n').slice(1, 3), ['/feira/:id /?feira=:id&entrar=1 302', '/previa /index.html 200']);
  // um bloco novo no vercel.json que o tradutor não conhece derruba o teste (em vez de ficar sem cabeçalho no Cloudflare)
  assert.throws(() => C.gerarHeaders({ ...vercel, headers: [...vercel.headers, { source: '/novo', headers: [{ key: 'X', value: 'y' }] }] }), /ensine/);
  // /api: as respostas da função têm os mesmos cabeçalhos que o vercel.json põe
  const F = await import(raiz('functions/api/[[caminho]].js')), bloco = Object.fromEntries(vercel.headers.find((b) => b.source === '/api/(.*)').headers.map((h) => [h.key, h.value]));
  const todas = Object.fromEntries(vercel.headers.find((b) => b.source === '/((?!previa).*)').headers.map((h) => [h.key, h.value]));
  for (const [k, v] of Object.entries(F.CABECALHOS_DA_API)) assert.strictEqual(v, bloco[k] || todas[k], `/api: ${k} difere do vercel.json`);
  assert.ok(F.CABECALHOS_DA_API['Cache-Control'] === 'no-store');
});

teste('cloudflare: /api/* é repassado ao servidor só com o necessário, com o segredo, o IP e o endereço do Cloudflare', async () => {
  const F = await import(raiz('functions/api/[[caminho]].js'));
  const antes = globalThis.fetch; let visto = null;
  globalThis.fetch = async (url, o) => { visto = { url, ...o, cab: Object.fromEntries(o.headers) }; const h = new Headers({ 'Content-Type': 'application/json', 'X-Vazou': 'sim' }); h.append('Set-Cookie', 'conta=1; HttpOnly; Secure'); h.append('Set-Cookie', 'outro=2'); return new Response('{"ok":true}', { status: 201, headers: h }); };
  const env = { API_ORIGEM: 'https://banca-api-abc.a.run.app/', PROXY_SEGREDO: 'seg' };
  try {
    const req = new Request('https://loja.exemplo.com/api/checkout?x=1&y=a b', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t', 'X-Loja': 'paes', 'X-Proxy-Segredo': 'falso', 'X-Cliente-IP': '6.6.6.6', 'X-Forwarded-For': '6.6.6.6', 'CF-Connecting-IP': '198.51.100.7', Cookie: 'conta=abc', Origin: 'https://loja.exemplo.com', 'X-Authenticity-Token': 'assinatura-pagbank', 'X-Real-IP': '9.9.9.9' }, body: '{"a":1}' });
    const r = await F.onRequest({ request: req, env, params: { caminho: ['checkout'] } });
    assert.strictEqual(visto.url, 'https://banca-api-abc.a.run.app/api/checkout?x=1&y=a%20b'); assert.strictEqual(visto.method, 'POST');
    assert.strictEqual(visto.cab['x-proxy-segredo'], 'seg'); assert.strictEqual(visto.cab['x-cliente-ip'], '198.51.100.7'); assert.strictEqual(visto.cab['x-host-original'], 'loja.exemplo.com');
    assert.strictEqual(visto.cab['authorization'], 'Bearer t'); assert.strictEqual(visto.cab['x-loja'], 'paes');
    assert.strictEqual(visto.cab['cookie'], 'conta=abc', 'a conta do cliente (cookie) segue'); assert.strictEqual(visto.cab['origin'], 'https://loja.exemplo.com');
    assert.strictEqual(visto.cab['x-authenticity-token'], 'assinatura-pagbank', 'sem a assinatura do PagBank nenhum PIX seria confirmado');
    assert.ok(!('x-forwarded-for' in visto.cab) && !('x-real-ip' in visto.cab), 'IP escrito pelo visitante não segue');
    assert.strictEqual(visto.redirect, 'manual');
    assert.strictEqual(r.status, 201); assert.strictEqual(r.headers.get('cache-control'), 'no-store', '/api sem Cache-Control próprio nunca fica guardada'); assert.ok(!r.headers.get('x-vazou'));
    assert.deepStrictEqual(r.headers.getSetCookie(), ['conta=1; HttpOnly; Secure', 'outro=2'], 'os cookies da conta voltam todos');
    assert.deepStrictEqual(await r.json(), { ok: true });
    // GET sem corpo
    await F.onRequest({ request: new Request('https://loja.exemplo.com/api/manifest?loja=x'), env, params: { caminho: ['manifest'] } });
    assert.strictEqual(visto.body, undefined);
    // sem configuração: 503 claro, sem tentar chamar nada
    visto = null; const sem = await F.onRequest({ request: new Request('https://loja.exemplo.com/api/pdv', { method: 'POST', body: '{}' }), env: {}, params: { caminho: ['pdv'] } });
    assert.strictEqual(sem.status, 503); assert.strictEqual(visto, null);
    const http = await F.onRequest({ request: new Request('https://l/api/x'), env: { API_ORIGEM: 'http://inseguro.exemplo.com', PROXY_SEGREDO: 's' }, params: { caminho: ['x'] } });
    assert.strictEqual(http.status, 503, 'só https');
    // servidor fora do ar: 502 com mensagem em português
    globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED 10.0.0.1'); };
    const caiu = await F.onRequest({ request: new Request('https://l/api/x'), env, params: { caminho: ['x'] } });
    assert.strictEqual(caiu.status, 502); assert.ok(!JSON.stringify(await caiu.json()).includes('10.0.0.1'));
  } finally { globalThis.fetch = antes; }
});

teste('cloudflare: o redutor de fotos só aceita os sites e as larguras do vercel.json e nunca vira abridor de site', async () => {
  const I = await import(raiz('functions/_vercel/image.js')), vercel = require(raiz('vercel.json'));
  assert.deepStrictEqual(I.LARGURAS, vercel.images.sizes);
  const dosSites = I.SITES_DE_FOTO.map((s) => s.host || '**' + s.sufixo).sort(), doVercel = vercel.images.remotePatterns.map((p) => p.hostname).filter((h, i, a) => a.indexOf(h) === i).sort();
  assert.deepStrictEqual(dosSites, doVercel, 'mesma lista de sites do vercel.json (images.remotePatterns)');
  for (const bom of ['https://i.ibb.co/abc/foto.jpg', 'https://a.b.ibb.co/x.png', 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media', 'https://loja.firebasestorage.app/x', 'https://storage.googleapis.com/b/o']) assert.ok(I.siteDeFotoValido(bom), bom);
  for (const ruim of ['http://i.ibb.co/x.jpg', 'https://evil-ibb.co/x.jpg', 'https://ibb.co.evil.com/x.jpg', 'https://i.ibb.co@evil.com/x.jpg', 'https://user:pw@i.ibb.co/x.jpg', 'https://i.ibb.co:8443/x.jpg', 'https://.firebasestorage.app/x', 'https://exemplo.com/x.jpg', 'javascript:alert(1)', '', 'https://169.254.169.254/latest']) assert.strictEqual(I.siteDeFotoValido(ruim), null, ruim);
  const antes = globalThis.fetch; let chamadas = 0;
  const pedir = (u, w) => I.onRequestGet({ request: new Request(`https://loja.exemplo.com/_vercel/image?url=${encodeURIComponent(u)}&w=${w}&q=75`) });
  try {
    globalThis.fetch = async (u, o) => { chamadas++; return new Response('IMG', { status: 200, headers: { 'Content-Type': 'image/webp', 'Content-Length': '3' } }); };
    const ok = await pedir('https://i.ibb.co/abc/foto.jpg', 128);
    assert.strictEqual(ok.status, 200); assert.strictEqual(ok.headers.get('content-type'), 'image/webp'); assert.ok(/max-age=2678400/.test(ok.headers.get('cache-control')));
    assert.strictEqual((await pedir('https://exemplo.com/x.jpg', 128)).status, 400); assert.strictEqual((await pedir('https://i.ibb.co/a.jpg', 999)).status, 400);
    assert.strictEqual(chamadas, 1, 'pedido recusado não busca nada');
    globalThis.fetch = async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    assert.strictEqual((await pedir('https://i.ibb.co/a.jpg', 128)).status, 415, 'só devolve imagem');
    globalThis.fetch = async () => new Response('x', { status: 404 });
    assert.strictEqual((await pedir('https://i.ibb.co/a.jpg', 128)).status, 502);
  } finally { globalThis.fetch = antes; }
});

// ------------------------------------------------------------------ testes de segurança (arquivo próprio)
require('./seguranca')({ teste, raiz, criarBanco, criarAdmin, chamar, carregarApi });

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('  ok   ', nome); }
    catch (e) { falhas++; console.log('  FALHOU', nome, '\n        ', String(e.message).split('\n').slice(0, 6).join(' | '), (String(e.stack).match(/index\.js:\d+/) || [''])[0]); }
  }
  console.log(`\n${testes.length - falhas} de ${testes.length} testes passaram.`);
  process.exit(falhas ? 1 : 0);
})();
