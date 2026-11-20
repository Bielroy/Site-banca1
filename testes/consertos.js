'use strict';
// =====================================================================
//  testes/consertos.js — as falhas achadas no teste de estresse (servidor e segurança), uma por teste.
//  Roda junto com o resto: npm test (testes/index.js chama este arquivo).
// =====================================================================
const assert = require('assert');

module.exports = function ({ teste, raiz, criarBanco, criarAdmin, chamar, carregarApi, prepararAvisos }) {
  const TOK = {
    cliente: { uid: 'c1' }, 'cliente-2': { uid: 'c2' },
    func: { uid: 'f1', email: 'func@banca', tenants: { banca: 'funcionario' } },
    dona: { uid: 'u1', admin: true },
  };
  let ipSeq = 0; const ip = () => ({ 'x-forwarded-for': `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` });
  const comFetch = async (falso, fn) => { const real = global.fetch; global.fetch = falso; try { return await fn(); } finally { global.fetch = real; } };
  const zerarFreios = () => { require(raiz('lib/http'))._usos.clear(); require(raiz('lib/prudencia'))._reserva.clear(); };

  // ------------------------------------------------------------------ 1. frete no ajuste e na pesagem
  teste('CONSERTO · frete: pedido de R$ 20 + R$ 12 de frete; tirar item de R$ 10 dá R$ 22 (antes dava R$ 15, com a taxa normal)', async () => {
    const A = require(raiz('lib/ajuste.js'));
    const itens = [{ id: 'a', nome: 'Alface', qtd: 1, tipo: 'un', preco: 10, subtotal: 10 }, { id: 'b', nome: 'Bolo', qtd: 1, tipo: 'un', preco: 10, subtotal: 10 }];
    const ped = { status: 'pendente', itens, total: 32, entrega: { taxa: 0, taxaCheia: 5, gratisAcima: 0, frete: { valor: 12, km: 3, rota: 1 } } };
    assert.strictEqual(A.contaDoPedido(ped, itens).total, 32, 'a conta do pedido com frete é 20 + 12');
    const r = A.tirarItem(ped, 0);
    assert.strictEqual(r.conta.total, 22, 'R$ 10 de item + R$ 12 de frete');
    assert.strictEqual(r.conta.entrega.taxa, 0, 'a taxa normal continua zero (o frete fica em entrega.frete)');
    assert.strictEqual(r.conta.entrega.frete.valor, 12);
    // frete não tem "grátis acima de": passar do valor não tira o frete
    assert.strictEqual(A.contaDoPedido({ ...ped, entrega: { ...ped.entrega, gratisAcima: 15 } }, itens).total, 32);
    // cupom de 100% (cortesia): sem frete, como no checkout
    assert.strictEqual(A.contaDoPedido({ ...ped, cupom: { codigo: 'FAMILIA', percentual: 100 } }, itens).total, 0);
    // sem frete continua como era: taxa cheia, que sai acima do valor de entrega grátis
    const semFrete = { ...ped, entrega: { taxa: 5, taxaCheia: 5, gratisAcima: 0 } };
    assert.strictEqual(A.tirarItem(semFrete, 0).conta.total, 15);
    assert.strictEqual(A.contaDoPedido({ ...semFrete, entrega: { ...semFrete.entrega, gratisAcima: 15 } }, itens).total, 20);

    // pelo painel de verdade (api/pdv.js): pesagem e depois "tirar item"
    const db = criarBanco({
      'loja/config': { wpp: '5562999990000', lojaAberta: true },
      'pedidos/frete-000001': { userId: 'c1', nome: 'Ana', status: 'aguardando_pesagem', data: new Date().toISOString(), entregaDia: '2026-11-18', total: 22, temItensAPesar: true,
        itens: [{ id: 'manga', nome: 'Manga', qtd: 2, tipo: 'un', aPesar: true, unidade: 'kg', precoOriginal: 10, subtotal: 0 }, { id: 'bolo', nome: 'Bolo', qtd: 1, tipo: 'un', preco: 10, precoOriginal: 10, subtotal: 10 }],
        entrega: { taxa: 0, taxaCheia: 5, gratisAcima: 0, frete: { valor: 12, km: 3, rota: 1 } } },
    });
    const api = carregarApi(raiz('api/pdv.js'), criarAdmin(db, TOK));
    const pdv = (body) => chamar(api, { headers: { Authorization: 'Bearer func' }, body });
    const ped2 = () => db._dados.get('pedidos/frete-000001');
    let x = await pdv({ acao: 'pesagem', pedidoId: 'frete-000001', pesos: [{ i: 0, peso: 1 }] });
    assert.strictEqual(x.status, 200, JSON.stringify(x.corpo));
    assert.strictEqual(ped2().total, 32, 'pesagem: 10 da manga + 10 do bolo + 12 de frete');
    assert.strictEqual(x.corpo.entrega, 12); assert.strictEqual(ped2().entrega.taxa, 0); assert.strictEqual(ped2().entrega.frete.valor, 12);
    x = await pdv({ acao: 'ajuste', op: 'tirar', pedidoId: 'frete-000001', indice: 0, itemId: 'manga' });
    assert.strictEqual(x.status, 200, JSON.stringify(x.corpo));
    assert.strictEqual(ped2().total, 22, 'tirar o item de R$ 10: R$ 22, o frete continua');
  });

  // ------------------------------------------------------------------ 2. gerente e o WhatsApp dos pedidos (as regras rodam no emulador: testes/regras)
  teste('CONSERTO · regras: o gerente não troca os números extras de WhatsApp nem o número de cada categoria', () => {
    const r = require('fs').readFileSync(raiz('firestore.rules'), 'utf8');
    assert.ok(/hasAny\(\['pix', 'pixAutomatico', 'wpp', 'numeros'\]\)/.test(r), 'numeros entrou no bloqueio do gerente');
    assert.ok(/match \/categorias\/\{id\}\s*\{ allow read: if vitrine\(tid\); allow write: if podeGravarCategoria\(tid\); \}/.test(r), 'categorias das lojas: wppId protegido');
    assert.ok(/match \/categorias\/\{id\}\s*\{ allow read: if vitrine\('banca'\); allow write: if podeGravarCategoria\('banca'\); \}/.test(r), 'categorias da loja original: wppId protegido');
    assert.ok(/request\.resource\.data\.get\('wppId', ''\) == resource\.data\.get\('wppId', ''\)/.test(r), 'o gerente não muda o número da categoria');
    assert.ok(/gerente não desvia os pedidos para outro WhatsApp/.test(require('fs').readFileSync(raiz('testes/regras/regras.test.js'), 'utf8')), 'o teste no emulador existe');
  });

  // ------------------------------------------------------------------ 3. PIX automático depois de ajuste
  teste('CONSERTO · PIX: o QR velho só é reaproveitado com o mesmo valor do total e dentro da validade; senão sai um novo', async () => {
    const PB = require(raiz('lib/pagbank.js'));
    const agora = Date.parse('2026-11-18T12:00:00Z');
    assert.strictEqual(PB.qrAindaServe({ qrC: 2000, totalC: 2000, agora }), true);
    assert.strictEqual(PB.qrAindaServe({ qrC: 2000, totalC: 1500, agora }), false, 'o pedido mudou de valor');
    assert.strictEqual(PB.qrAindaServe({ qrC: undefined, totalC: 1500, agora }), false);
    assert.strictEqual(PB.qrAindaServe({ qrC: 1500, totalC: 1500, expira: '2026-11-18T12:30:00Z', agora }), true);
    assert.strictEqual(PB.qrAindaServe({ qrC: 1500, totalC: 1500, expira: '2026-11-18T12:01:00Z', agora }), false, 'vence em menos de 2 min: não dá tempo de pagar');
    assert.strictEqual(PB.qrAindaServe({ qrC: 1500, totalC: 1500, expira: 'lixo', agora }), false);

    process.env.PAGBANK_API_TOKEN = 'token-teste'; process.env.PUBLIC_BASE_URL = 'https://www.exemplo.com.br';
    const futuro = new Date(Date.now() + 25 * 60000).toISOString(), passado = new Date(Date.now() - 60000).toISOString();
    const cenario = (valorC, total) => criarBanco({ 'loja/config': { wpp: '5562999990000', pixAutomatico: true },
      'pedidos/pix-ajuste-01': { userId: 'c1', nome: 'Ana', total, status: 'aguardando_pagamento', pagamento: { provedor: 'pagbank', orderId: 'ORDE_VELHA-1', ordens: ['ORDE_VELHA-1'], valorC, status: 'WAITING' } } });
    const rodar = async (db, expira) => {
      const idas = [];
      const falso = async (url, o) => {
        const metodo = (o && o.method) || 'GET'; idas.push({ url: String(url), metodo, corpo: o && o.body ? JSON.parse(o.body) : null });
        if (metodo === 'GET') return { ok: true, status: 200, json: async () => ({ id: 'ORDE_VELHA-1', qr_codes: [{ text: 'qr-velho', amount: { value: db._dados.get('pedidos/pix-ajuste-01').pagamento.valorC }, expiration_date: expira, links: [] }] }) };
        const corpo = JSON.parse(o.body);
        return { ok: true, status: 200, json: async () => ({ id: 'ORDE_NOVA-1', qr_codes: [{ text: 'qr-novo', amount: { value: corpo.qr_codes[0].amount.value }, links: [] }] }) };
      };
      const api = carregarApi(raiz('api/pagamento-pix.js'), criarAdmin(db, TOK)); zerarFreios();
      const r = await comFetch(falso, () => chamar(api, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: { pedidoId: 'pix-ajuste-01' } }));
      return { r, idas };
    };
    // a equipe tirou um item: o pedido foi de R$ 20 para R$ 15. O QR de R$ 20 NÃO volta
    let db = cenario(2000, 15), { r, idas } = await rodar(db, futuro);
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.qr_code, 'qr-novo'); assert.strictEqual(r.corpo.orderId, 'ORDE_NOVA-1');
    const criou = idas.find((i) => i.metodo === 'POST');
    assert.ok(criou, 'criou um QR novo'); assert.strictEqual(criou.corpo.qr_codes[0].amount.value, 1500, 'com o valor de agora');
    let pg = db._dados.get('pedidos/pix-ajuste-01').pagamento;
    assert.strictEqual(pg.valorC, 1500); assert.deepStrictEqual(pg.ordens, ['ORDE_VELHA-1', 'ORDE_NOVA-1'], 'o QR velho continua reconhecido se alguém pagar');
    // mesmo valor e dentro da validade: reaproveita (sem criar ordem)
    db = cenario(1500, 15); ({ r, idas } = await rodar(db, futuro));
    assert.strictEqual(r.corpo.qr_code, 'qr-velho'); assert.ok(idas.every((i) => i.metodo === 'GET'));
    // mesmo valor, mas o QR venceu: sai um novo
    db = cenario(1500, 15); ({ r, idas } = await rodar(db, passado));
    assert.strictEqual(r.corpo.qr_code, 'qr-novo'); assert.ok(idas.some((i) => i.metodo === 'POST'));
  });

  teste('CONSERTO · PIX: pagou valor diferente do total (a mais ou a menos) marca o pedido para conferir e avisa a equipe', async () => {
    const ordem = (valor) => ({ id: 'ORDE_X-0001', reference_id: 'pix-dif-0001', charges: [{ status: 'PAID', amount: { value: valor, summary: { paid: valor } } }] });
    const cenario = (total) => criarBanco({ 'pedidos/pix-dif-0001': { userId: 'c1', nome: 'Ana', total, status: 'aguardando_pagamento', pagamento: { provedor: 'pagbank', orderId: 'ORDE_X-0001', ordens: ['ORDE_X-0001'], valorC: 2000, status: 'WAITING' } } });
    // pagou o QR velho de R$ 20 depois que o pedido caiu para R$ 15: entrou dinheiro A MAIS
    let db = cenario(15); let PB = carregarApi(raiz('lib/pagbank.js'), criarAdmin(db, {}));
    let aviso = await PB.aplicarOrdem(db, ordem(2000)), ped = db._dados.get('pedidos/pix-dif-0001');
    assert.strictEqual(ped.pagamento.status, 'PAID', 'o dinheiro entrou: o pedido segue');
    assert.deepStrictEqual([ped.conferirPagamento.motivo, ped.conferirPagamento.recebidoC, ped.conferirPagamento.totalC], ['a-mais', 2000, 1500]);
    assert.strictEqual(aviso.titulo, 'PIX maior que o pedido'); assert.match(aviso.corpo, /devolva a diferença/);
    // pagou o QR velho de R$ 20 depois que o pedido subiu para R$ 25: A MENOS
    db = cenario(25); PB = carregarApi(raiz('lib/pagbank.js'), criarAdmin(db, {}));
    aviso = await PB.aplicarOrdem(db, ordem(2000)); ped = db._dados.get('pedidos/pix-dif-0001');
    assert.strictEqual(ped.pagamento.status, 'PAGO_PARCIAL'); assert.strictEqual(ped.status, 'aguardando_pagamento');
    assert.strictEqual(ped.conferirPagamento.motivo, 'a-menos'); assert.strictEqual(aviso.titulo, 'PIX menor que o pedido');
    // valor certo: nada para conferir
    db = cenario(20); PB = carregarApi(raiz('lib/pagbank.js'), criarAdmin(db, {}));
    aviso = await PB.aplicarOrdem(db, ordem(2000)); ped = db._dados.get('pedidos/pix-dif-0001');
    assert.strictEqual(ped.pagamento.status, 'PAID'); assert.strictEqual(ped.conferirPagamento, undefined); assert.strictEqual(aviso.titulo, 'PIX recebido');
  });

  // ------------------------------------------------------------------ 4. avaliação
  teste('CONSERTO · avaliação: só pedido entregue recebe nota; cancelado depois, a nota sai da média (uma vez só)', async () => {
    const api0 = carregarApi(raiz('api/cancelar-pedido.js'), criarAdmin(criarBanco(), {}));
    assert.deepStrictEqual(api0.retirarDaMedia({ soma: 52, n: 11 }, { nota: 5 }), { soma: 47, n: 10, media: 4.7 });
    assert.deepStrictEqual(api0.retirarDaMedia({ soma: 5, n: 1 }, { nota: 5 }), { soma: 0, n: 0, media: 0 });
    assert.strictEqual(api0.retirarDaMedia({ soma: 5, n: 1 }, { nota: 5, foraDaMedia: true }), null, 'já tirada: não tira de novo');
    assert.strictEqual(api0.retirarDaMedia({ soma: 5, n: 1 }, null), null);

    const db = criarBanco({ 'loja/config': { wpp: '5562999990000' }, 'loja/avaliacoes': { soma: 47, n: 10, media: 4.7 },
      'pedidos/aval-000001': { userId: 'c1', nome: 'Ana', status: 'pendente', data: new Date().toISOString(), total: 20, itens: [] } });
    const api = carregarApi(raiz('api/cancelar-pedido.js'), criarAdmin(db, TOK));
    const pedir = (tk, body) => { zerarFreios(); return chamar(api, { headers: { ...ip(), Authorization: `Bearer ${tk}` }, body }); };
    const ped = () => db._dados.get('pedidos/aval-000001'), media = () => db._dados.get('loja/avaliacoes');
    // pedido que nem saiu: recusa (antes era só fazer o pedido, dar a nota e cancelar)
    for (const status of ['pendente', 'aguardando_pagamento', 'preparando', 'enviado']) {
      db._dados.set('pedidos/aval-000001', { ...ped(), status });
      const r = await pedir('cliente', { acao: 'avaliar', pedidoId: 'aval-000001', nota: 1 });
      assert.strictEqual(r.status, 400, status); assert.match(r.corpo.error, /entregue/);
    }
    assert.strictEqual(media().n, 10, 'nada entrou na média');
    // entregue: vale
    db._dados.set('pedidos/aval-000001', { ...ped(), status: 'arquivado' });
    assert.strictEqual((await pedir('cliente', { acao: 'avaliar', pedidoId: 'aval-000001', nota: 5 })).status, 200);
    assert.deepStrictEqual([media().n, media().soma, media().media], [11, 52, 4.7]);
    // a equipe cancela o pedido entregue (por exemplo, devolução): a nota sai da média
    let r = await pedir('func', { pedidoId: 'aval-000001', motivo: 'devolvido' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.notaRetirada, true);
    assert.deepStrictEqual([media().n, media().soma, media().media], [10, 47, 4.7]);
    assert.strictEqual(ped().avaliacao.foraDaMedia, true); assert.strictEqual(ped().avaliacao.nota, 5, 'a nota continua no pedido (a equipe vê)');
    // alguém tira o pedido de "cancelado" por fora e cancela de novo: a nota não sai duas vezes
    db._dados.set('pedidos/aval-000001', { ...ped(), status: 'arquivado' });
    r = await pedir('func', { pedidoId: 'aval-000001' }); assert.strictEqual(r.status, 200);
    assert.strictEqual(media().n, 10); assert.strictEqual(media().soma, 47);
    // pedido cancelado não recebe nota
    assert.strictEqual((await pedir('cliente', { acao: 'avaliar', pedidoId: 'aval-000001', nota: 5 })).status, 400);
  });

  // ------------------------------------------------------------------ 5. forma de pagamento
  teste('CONSERTO · checkout: forma de pagamento só PIX, Cartão ou Dinheiro (maiúsculas e acentos não importam); forma desligada é recusada', async () => {
    const V = require(raiz('lib/venda.js'));
    assert.deepStrictEqual(['PIX', 'pix', ' Pix ', 'Cartão', 'cartao', 'CARTÃO', 'Dinheiro', 'DINHEIRO'].map(V.formaDePagamento), ['PIX', 'PIX', 'PIX', 'Cartão', 'Cartão', 'Cartão', 'Dinheiro', 'Dinheiro']);
    for (const ruim of ['Fiado', '', 'pago já', '<b>PIX</b>', null, undefined, 3, { x: 1 }, ['PIX'], 'PIX automático']) assert.strictEqual(V.formaDePagamento(ruim), '', String(ruim));
    // a loja e o balcão mandam exatamente estes valores
    const html = require('fs').readFileSync(raiz('index.html'), 'utf8');
    for (const f of V.FORMAS_PAGAMENTO) assert.ok(html.includes(`<option value="${f}">`), `a loja oferece ${f}`);
    assert.ok(/PAGAMENTOS = \['PIX', 'Dinheiro', 'Cartão'\]/.test(require('fs').readFileSync(raiz('api/pdv.js'), 'utf8')), 'o balcão usa a mesma lista');

    const db = criarBanco({ 'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', cat: 'legumes', ativo: true },
      'loja/config': { wpp: '5562999990000', lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], formasPagamento: { pix: true, cartao: false, dinheiro: true } } });
    const api = carregarApi(raiz('api/checkout.js'), criarAdmin(db, TOK));
    const pedir = (pag) => { const chave = 'pag-' + Math.random().toString(36).slice(2, 12); return chamar(api, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: { nome: 'Ana', quadra: '5', lote: '3', condominio: 'Jardins', pag, idempotencyKey: chave, itens: [{ id: 'tomate', qtd: 1, tipo: 'kg' }] } }).then((r) => ({ ...r, chave })); };
    let r = await pedir('pix'); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(db._dados.get(`pedidos/${r.chave}`).pag, 'PIX', 'gravado do jeito certo');
    r = await pedir(' dinheiro '); assert.strictEqual(r.status, 200); assert.strictEqual(db._dados.get(`pedidos/${r.chave}`).pag, 'Dinheiro');
    for (const ruim of ['Fiado', '', undefined, 'Pago <script>', { a: 1 }]) {
      r = await pedir(ruim); assert.strictEqual(r.status, 400, String(ruim)); assert.match(r.corpo.error, /forma de pagamento/i); assert.ok(!db._dados.has(`pedidos/${r.chave}`));
    }
    r = await pedir('CARTAO'); assert.strictEqual(r.status, 400); assert.match(r.corpo.error, /não está aceitando cartão/);
  });

  // ------------------------------------------------------------------ 6. aba Clientes
  teste('CONSERTO · aba Clientes: pela aba, no máximo um recálculo por hora por loja; fora disso mostra o cálculo existente e a hora dele', async () => {
    const pedido = (ms) => ({ nome: 'Ana Teste', quadra: '7', lote: '2', condominio: 'Jardins', total: 12, data: new Date(Date.now() + ms).toISOString(), itens: [{ id: 'tomate', nome: 'Tomate', qtd: 1, tipo: 'kg', unidade: 'kg', preco: 8.9 }] });
    const db = criarBanco({ 'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', ativo: true }, 'pedidos/n1': pedido(-60000) });
    const api = carregarApi(raiz('api/analytics.js'), criarAdmin(db, TOK));
    const ver = (body) => chamar(api, { headers: { Authorization: 'Bearer dona' }, body: { acao: 'painel', ...body } });
    const real = Date.now;
    try {
      let r = await ver({ atualizar: true }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.atualizou, true);
      const hora = r.corpo.calculadoEm; assert.ok(hora && hora === r.corpo.meta.geradoEm, 'a resposta diz de quando é o cálculo');
      // pedido novo 1 minuto depois: a aba NÃO recalcula de novo (antes recalculava a cada abertura, até 20 por hora)
      db._dados.set('pedidos/n2', pedido(30000));
      Date.now = () => real() + 60000;
      r = await ver({ atualizar: true }); assert.strictEqual(r.corpo.atualizou, false); assert.strictEqual(r.corpo.calculadoEm, hora, 'mostra o cálculo que já existe');
      Date.now = () => real() + 30 * 60000;
      r = await ver({ atualizar: true }); assert.strictEqual(r.corpo.atualizou, false, 'meia hora depois: ainda não');
      // o botão "recalcular" continua funcionando
      Date.now = () => real() + 31 * 60000;
      r = await chamar(api, { headers: { Authorization: 'Bearer dona' }, body: { acao: 'recalcular' } }); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      // passou a hora: a aba volta a recalcular se houver pedido novo
      db._dados.set('pedidos/n3', pedido(2 * 3600000));
      Date.now = () => real() + 61 * 60000;
      r = await ver({ atualizar: true }); assert.strictEqual(r.corpo.atualizou, true);
    } finally { Date.now = real; }
  });

  // ------------------------------------------------------------------ 7. lembretes
  teste('CONSERTO · lembretes: pedido parado há dias nem é lido; duas voltas nunca rodam ao mesmo tempo', async () => {
    const A = require(raiz('lib/avisos')); const { assinatura, envios, fim } = prepararAvisos(A);
    try {
      const L = require(raiz('lib/lembretes'));
      const agora = Date.parse('2026-11-03T15:00:00Z'), atras = (m) => new Date(agora - m * 60000).toISOString();
      const db = criarBanco({ 'pedidos/p-agora': { status: 'pendente', data: atras(20), total: 10 }, 'pedidos/p-3dias': { status: 'pendente', data: atras(3 * 24 * 60), total: 10 },
        'pedidos/p-50h': { status: 'aguardando_pesagem', data: atras(50 * 60), total: 10 }, 'pedidos/p-feito': { status: 'arquivado', data: atras(30), total: 10 } });
      // espia: quais pedidos a consulta trouxe do banco
      const lidos = [], original = db.collection;
      db.collection = (c) => {
        const col = original(c); if (c !== 'pedidos') return col;
        const embrulha = (q) => ({ ...q, where: (...a) => embrulha(q.where(...a)), limit: (...a) => embrulha(q.limit(...a)), get: async () => { const s = await q.get(); s.docs.forEach((d) => lidos.push(d.id)); return s; } });
        return embrulha(col);
      };
      const achados = await L.pedidosEsperando(db, 'banca', agora);
      assert.deepStrictEqual(achados.map((a) => a.ref.id), ['p-agora']);
      assert.ok(!lidos.includes('p-3dias') && !lidos.includes('p-50h'), 'pedido parado há mais de 48 h nem sai do banco: ' + lidos.join(','));
      db.collection = original;

      // TRAVA: a volta anterior ainda está rodando (banco lento): a próxima é pulada
      await A.ligar(db, 'banca', { uid: 'u6' }, assinatura(1));
      let soltar; const portao = new Promise((ok) => { soltar = ok; });
      db.collection = (c) => (c === 'tenants' ? { get: async () => { await portao; return original('tenants').get(); } } : original(c));
      const primeira = L.rodar(db, agora);
      assert.deepStrictEqual(await L.rodar(db, agora), { lojas: 0, pulou: true }, 'a segunda volta não começa por cima da primeira');
      soltar(); const r1 = await primeira; assert.strictEqual(r1.lojas, 1);
      db.collection = original;
      const r3 = await L.rodar(db, agora + 3 * 60000); assert.ok(!r3.pulou, 'terminada a volta, a próxima roda normal');
      assert.ok(envios.length >= 1);
      assert.ok(/a trava fica em lib\/lembretes\.js/.test(require('fs').readFileSync(raiz('server/index.js'), 'utf8')));
    } finally { fim(); }
  });

  // ------------------------------------------------------------------ 8. chat de IA
  teste('CONSERTO · chat de IA: teto de 300 mensagens por dia na loja (a plataforma muda) e 30 por login anônimo', async () => {
    const api0 = carregarApi(raiz('api/assistente.js'), criarAdmin(criarBanco(), {}));
    const antes = process.env.CHAT_LIMITE_DIA; delete process.env.CHAT_LIMITE_DIA;
    try {
      assert.strictEqual(api0.tetoDoChat({}), 300, 'o padrão caiu de 1.500 para 300');
      assert.strictEqual(api0.tetoDoChat({ limiteChatDia: 50 }), 50, 'campo da ficha (só a plataforma grava)');
      assert.strictEqual(api0.tetoDoChat({ limiteChatDia: 'muito' }), 300); assert.strictEqual(api0.tetoDoChat({ limiteChatDia: -1 }), 300);
      process.env.CHAT_LIMITE_DIA = '800'; assert.strictEqual(api0.tetoDoChat({}), 800, 'variável do servidor');
    } finally { if (antes === undefined) delete process.env.CHAT_LIMITE_DIA; else process.env.CHAT_LIMITE_DIA = antes; }
    assert.ok(/Authorization = `Bearer \$\{tk\}`/.test(require('fs').readFileSync(raiz('js/ia.js'), 'utf8')), 'a loja manda o login anônimo junto');

    process.env.GEMINI_API_KEY = 'chave-de-teste';
    const db = criarBanco({ 'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', ativo: true } });
    const api = carregarApi(raiz('api/assistente.js'), criarAdmin(db, TOK));
    const sse = () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"oi"}]}}]}\n\n', { status: 200 });
    function chat(cab) {
      return new Promise((resolve, reject) => {
        const res = { _status: 200, setHeader() {}, status(c) { this._status = c; return this; }, json(j) { resolve({ status: this._status, corpo: j }); return this; }, writeHead(c) { this._status = c; }, write() {}, end() { resolve({ status: this._status }); }, flushHeaders() {} };
        Promise.resolve(api({ method: 'POST', headers: cab, body: { action: 'chat_stream', mensagemCliente: 'oi' }, query: {}, socket: {} }, res)).catch(reject);
      });
    }
    await comFetch(async () => sse(), async () => {
      // a mesma pessoa, trocando de conexão a cada mensagem (o freio por conexão não pega): para na 31ª
      let ultimo;
      for (let i = 0; i < 31; i++) { zerarFreios(); ultimo = await chat({ ...ip(), authorization: 'Bearer cliente' }); if (i < 30) assert.strictEqual(ultimo.status, 200, `mensagem ${i + 1}`); }
      assert.strictEqual(ultimo.status, 429); assert.match(ultimo.corpo.error, /WhatsApp/);
      // outra pessoa continua sendo atendida
      zerarFreios(); assert.strictEqual((await chat({ ...ip(), authorization: 'Bearer cliente-2' })).status, 200);
      // teto da loja: chegou a 300 no dia, para para todo mundo
      const k = [...db._dados.keys()].find((x) => x.startsWith('uso_ia/'));
      db._dados.set(k, { ...db._dados.get(k), chat: 300 });
      zerarFreios(); const r = await chat({ ...ip(), authorization: 'Bearer cliente-2' }); assert.strictEqual(r.status, 429); assert.match(r.corpo.error, /limite de hoje/);
    });
  });

  // ================================================================== RODADA 2
  // ------------------------------------------------------------------ R3. PIX: QR antigo, pagamento em dobro, pago em parte
  const comPagBank = async (db, fn) => {
    process.env.PAGBANK_API_TOKEN = 'token-teste'; process.env.PUBLIC_BASE_URL = 'https://www.exemplo.com.br';
    const criadas = []; let n = 0;
    const falso = async (url, o) => {
      const metodo = (o && o.method) || 'GET';
      if (metodo === 'POST') { const corpo = JSON.parse(o.body); criadas.push(corpo); return { ok: true, status: 200, json: async () => ({ id: `ORDE_Q${++n}-000`, qr_codes: [{ text: `qr-${n}`, amount: corpo.qr_codes[0].amount, expiration_date: corpo.qr_codes[0].expiration_date, links: [] }] }) }; }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const api = carregarApi(raiz('api/pagamento-pix.js'), criarAdmin(db, TOK));
    const gerar = () => { zerarFreios(); return comFetch(falso, () => chamar(api, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: { pedidoId: 'pix-rod2-001' } })); };
    return fn({ gerar, criadas, PB: carregarApi(raiz('lib/pagbank.js'), criarAdmin(db, {})) });
  };
  const pago = (id, valor) => ({ id, reference_id: 'pix-rod2-001', charges: [{ status: 'PAID', amount: { value: valor, summary: { paid: valor } } }] });
  const pedidoPix = (total) => criarBanco({ 'loja/config': { wpp: '5562999990000', pixAutomatico: true }, 'pedidos/pix-rod2-001': { userId: 'c1', nome: 'Ana', total, status: 'pendente' } });

  teste('CONSERTO 2 · PIX roteiro A: QR de R$ 60, ajuste para R$ 50, QR novo; pagou os dois → "em dobro" com a soma e aviso', async () => {
    for (const ordemDosPagamentos of [['A', 'B'], ['B', 'A']]) {
      const db = pedidoPix(60), ped = () => db._dados.get('pedidos/pix-rod2-001');
      await comPagBank(db, async ({ gerar, criadas, PB }) => {
        assert.strictEqual((await gerar()).status, 200); assert.strictEqual(criadas[0].qr_codes[0].amount.value, 6000);
        const validade = Date.parse(criadas[0].qr_codes[0].expiration_date) - Date.now();
        assert.ok(validade > 14 * 60000 && validade <= 15 * 60000, 'QR do PagBank vale 15 min (não dá para cancelar o antigo)');
        db._dados.set('pedidos/pix-rod2-001', { ...ped(), total: 50 });           // a equipe tirou um item
        const B = await gerar(); assert.strictEqual(B.status, 200); assert.strictEqual(criadas[1].qr_codes[0].amount.value, 5000, 'QR novo com o valor novo');
        assert.deepStrictEqual(ped().pagamento.ordens, ['ORDE_Q1-000', 'ORDE_Q2-000'], 'o QR antigo continua registrado');
        assert.deepStrictEqual(ped().pagamento.valores, { 'ORDE_Q1-000': 6000, 'ORDE_Q2-000': 5000 });
        const ids = { A: ['ORDE_Q1-000', 6000], B: ['ORDE_Q2-000', 5000] };
        const primeiro = await PB.aplicarOrdem(db, pago(...ids[ordemDosPagamentos[0]]));
        assert.strictEqual(ped().pagamento.status, 'PAID');
        if (ordemDosPagamentos[0] === 'A') assert.strictEqual(ped().conferirPagamento.motivo, 'a-mais'); else { assert.strictEqual(primeiro.titulo, 'PIX recebido'); assert.ok(!ped().conferirPagamento); }
        const segundo = await PB.aplicarOrdem(db, pago(...ids[ordemDosPagamentos[1]]));
        assert.strictEqual(segundo.titulo, 'PIX pago duas vezes', ordemDosPagamentos.join('>')); assert.match(segundo.corpo, /Devolva/);
        assert.deepStrictEqual([ped().conferirPagamento.motivo, ped().conferirPagamento.recebidoC, ped().conferirPagamento.totalC], ['em-dobro', 11000, 5000], 'a marca tem a soma final');
        assert.strictEqual(ped().pagamento.valorPagoC, 11000);
        // o banco repete o aviso: nada muda, nenhum aviso novo
        const antes = JSON.stringify(ped()); assert.strictEqual(await PB.aplicarOrdem(db, pago(...ids[ordemDosPagamentos[1]])), null); assert.strictEqual(JSON.stringify(ped()), antes);
        // depois de pago, não sai QR novo
        assert.strictEqual((await gerar()).status, 409);
      });
    }
  });

  teste('CONSERTO 2 · PIX roteiro B: pagou R$ 50 de R$ 60 → o QR novo é de R$ 10; pagou o resto, a marca "a menos" sai', async () => {
    const db = pedidoPix(60), ped = () => db._dados.get('pedidos/pix-rod2-001');
    await comPagBank(db, async ({ gerar, criadas, PB }) => {
      await gerar();
      let aviso = await PB.aplicarOrdem(db, pago('ORDE_Q1-000', 5000));
      assert.strictEqual(ped().pagamento.status, 'PAGO_PARCIAL'); assert.strictEqual(aviso.titulo, 'PIX menor que o pedido'); assert.match(aviso.corpo, /Falta R\$\s?10,00/);
      assert.deepStrictEqual([ped().conferirPagamento.motivo, ped().conferirPagamento.recebidoC], ['a-menos', 5000]);
      const r = await gerar(); assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(criadas[1].qr_codes[0].amount.value, 1000, 'cobra só a diferença');
      assert.deepStrictEqual([ped().pagamento.valorPagoC, ped().pagamento.ordensPagas], [5000, ['ORDE_Q1-000']], 'o que já entrou continua guardado');
      aviso = await PB.aplicarOrdem(db, pago(r.corpo.orderId, 1000));
      assert.strictEqual(ped().pagamento.status, 'PAID'); assert.strictEqual(ped().pagamento.valorPagoC, 6000); assert.strictEqual(ped().status, 'pendente');
      assert.strictEqual(ped().conferirPagamento, null, 'a soma fechou: a marca "a menos" saiu'); assert.match(aviso.corpo, /o que faltava/);
      // repetir o aviso do primeiro PIX (o parcial) não muda nada
      assert.strictEqual(await PB.aplicarOrdem(db, pago('ORDE_Q1-000', 5000)), null); assert.strictEqual(ped().pagamento.valorPagoC, 6000);
    });
    // pedido pago em parte antes desta versão (sem a lista de ordens pagas): também cobra só a diferença
    const velho = criarBanco({ 'loja/config': { wpp: '5562999990000', pixAutomatico: true }, 'pedidos/pix-rod2-001': { userId: 'c1', nome: 'Ana', total: 60, status: 'aguardando_pagamento', pagamento: { provedor: 'pagbank', orderId: 'ORDE_V-0001', ordens: ['ORDE_V-0001'], valorC: 6000, valorPagoC: 5000, status: 'PAGO_PARCIAL' } } });
    await comPagBank(velho, async ({ gerar, criadas }) => { assert.strictEqual((await gerar()).status, 200); assert.strictEqual(criadas[0].qr_codes[0].amount.value, 1000); });
  });

  teste('CONSERTO 2 · PIX pelo Asaas: cobrança nova (valor mudou) apaga a cobrança antiga que ainda não foi paga', async () => {
    const antes = { k: process.env.ASAAS_API_KEY, p: process.env.PAGBANK_API_TOKEN, e: process.env.ASAAS_ESPERA_QR_MS };
    process.env.ASAAS_API_KEY = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjAwMDA'; process.env.ASAAS_ESPERA_QR_MS = '1'; delete process.env.PAGBANK_API_TOKEN;
    const chamadas = [];
    const falso = async (url, o = {}) => {
      const u = String(url), metodo = o.method || 'GET'; chamadas.push({ u, metodo });
      const resp = (status, dados) => ({ ok: status < 300, status, json: async () => dados });
      if (u.endsWith('/customers')) return resp(200, { id: 'cus_000001' });
      if (u.endsWith('/payments') && metodo === 'POST') return resp(200, { id: 'pay_novo01' });
      if (/pixQrCode$/.test(u)) return resp(200, { payload: '00020126580014br.gov.bcb.pix0136abc-copia-e-cola', encodedImage: 'iVBORw0KGgo=' });
      if (metodo === 'DELETE') return resp(200, { deleted: true, id: 'pay_velho1' });
      return resp(404, {});
    };
    try {
      require(raiz('lib/segredos'))._zerar();
      const db = criarBanco({ 'loja/config': { pixAutomatico: true }, 'pedidos/pix-rod2-001': { userId: 'c1', nome: 'Ana', total: 50, status: 'aguardando_pagamento', pagamento: { provedor: 'asaas', orderId: 'pay_velho1', ordens: ['pay_velho1'], valorC: 6000, status: 'WAITING' } } });
      const api = carregarApi(raiz('api/pagamento-pix.js'), criarAdmin(db, TOK)); zerarFreios();
      const r = await comFetch(falso, () => chamar(api, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: { pedidoId: 'pix-rod2-001', cpf: '52998224725' } }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo)); assert.strictEqual(r.corpo.orderId, 'pay_novo01');
      assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.u.endsWith('/payments/pay_velho1')), 'a cobrança antiga foi apagada no Asaas');
      assert.deepStrictEqual(db._dados.get('pedidos/pix-rod2-001').pagamento.ordens, ['pay_velho1', 'pay_novo01'], 'e continua registrada, por garantia');
    } finally {
      for (const [k, v] of [['ASAAS_API_KEY', antes.k], ['PAGBANK_API_TOKEN', antes.p], ['ASAAS_ESPERA_QR_MS', antes.e]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      require(raiz('lib/segredos'))._zerar();
    }
  });

  // ------------------------------------------------------------------ R14. teto do chat
  teste('CONSERTO 2 · chat de IA: teto por conexão vale sempre (logins novos não passam dele) e 1/3 do teto da loja fica para cliente conhecido', async () => {
    const api0 = carregarApi(raiz('api/assistente.js'), criarAdmin(criarBanco(), {}));
    assert.strictEqual(api0.livreDoChat(300), 200); assert.strictEqual(api0.livreDoChat(10), 6);
    process.env.GEMINI_API_KEY = 'chave-de-teste';
    const tokens = { ...TOK, antigo: { uid: 'c-antigo', auth_time: Math.floor(Date.now() / 1000) - 3 * 86400 }, freguesa: { uid: 'c-freguesa', auth_time: Math.floor(Date.now() / 1000) - 60 } };
    const db = criarBanco({ 'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', ativo: true }, 'pedidos/ped-freguesa': { userId: 'c-freguesa', total: 10, status: 'arquivado' } });
    const api = carregarApi(raiz('api/assistente.js'), criarAdmin(db, tokens));
    const chat = (cab) => new Promise((resolve, reject) => {
      const res = { _status: 200, setHeader() {}, status(c) { this._status = c; return this; }, json(j) { resolve({ status: this._status, corpo: j }); return this; }, writeHead(c) { this._status = c; }, write() {}, end() { resolve({ status: this._status }); }, flushHeaders() {} };
      Promise.resolve(api({ method: 'POST', headers: cab, body: { action: 'chat_stream', mensagemCliente: 'oi' }, query: {}, socket: {} }, res)).catch(reject);
    });
    const real = Date.now;
    await comFetch(async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"oi"}]}}]}\n\n', { status: 200 }), async () => {
      try {
        // uma conexão só, um login anônimo NOVO a cada mensagem (e esperando o freio de 10 min): para na 91ª
        const mesmaConexao = { 'x-forwarded-for': '10.77.0.1' }; let ultimo;
        for (let i = 0; i < 91; i++) {
          if (i % 35 === 0) { const d = i / 35; Date.now = () => real() + d * 11 * 60000; }
          tokens[`anon-${i}`] = { uid: `anon-${i}` }; zerarFreios();
          ultimo = await chat({ ...mesmaConexao, authorization: `Bearer anon-${i}` });
          if (i < 90) assert.strictEqual(ultimo.status, 200, `mensagem ${i + 1}: ${JSON.stringify(ultimo.corpo)}`);
        }
        assert.strictEqual(ultimo.status, 429, 'com login novo a cada mensagem, a conexão para em 90 por dia');
      } finally { Date.now = real; }
      // reserva: depois de 200 (2/3 de 300), login novo sem pedido não é atendido; cliente conhecido é
      const k = [...db._dados.keys()].find((x) => x.startsWith('uso_ia/')); db._dados.set(k, { ...db._dados.get(k), chat: 200 });
      zerarFreios(); let r = await chat({ ...ip(), authorization: 'Bearer cliente' }); assert.strictEqual(r.status, 429, 'login de hoje, sem pedido: a reserva não é dele');
      zerarFreios(); r = await chat({ ...ip() }); assert.strictEqual(r.status, 429, 'sem login: também não');
      zerarFreios(); r = await chat({ ...ip(), authorization: 'Bearer antigo' }); assert.strictEqual(r.status, 429, 'login com mais de 1 dia, sem pedido, não é "conhecido" (rodada 3)');
      db._dados.set('pedidos/ped-antigo', { userId: 'c-antigo', total: 10, status: 'pendente' });
      zerarFreios(); r = await chat({ ...ip(), authorization: 'Bearer antigo' }); assert.strictEqual(r.status, 429, 'pedido só feito (não pago nem entregue) também não');
      zerarFreios(); r = await chat({ ...ip(), authorization: 'Bearer freguesa' }); assert.strictEqual(r.status, 200, 'cliente com pedido entregue na loja');
      db._dados.set(k, { ...db._dados.get(k), chat: 300 });
      zerarFreios(); r = await chat({ ...ip(), authorization: 'Bearer freguesa' }); assert.strictEqual(r.status, 429, 'no teto, para para todos');
    });
  });

  // ================================================================== RODADA 3
  teste('CONSERTO 3 · PIX: QR antigo pago enquanto o QR novo era criado → 409 sem QR, ordem nova registrada (PagBank) ou apagada (Asaas)', async () => {
    // PagBank: o aviso do QR antigo chega no meio da criação do QR novo
    process.env.PAGBANK_API_TOKEN = 'token-teste'; process.env.PUBLIC_BASE_URL = 'https://www.exemplo.com.br';
    const db = criarBanco({ 'loja/config': { wpp: '5562999990000', pixAutomatico: true }, 'pedidos/pix-rod3-001': { userId: 'c1', nome: 'Ana', total: 50, status: 'aguardando_pagamento',
      pagamento: { provedor: 'pagbank', orderId: 'ORDE_A-00001', ordens: ['ORDE_A-00001'], valores: { 'ORDE_A-00001': 6000 }, valorC: 6000, status: 'WAITING' } } });
    const ped = () => db._dados.get('pedidos/pix-rod3-001');
    const PB = carregarApi(raiz('lib/pagbank.js'), criarAdmin(db, {}));
    const falso = async (url, o) => {
      if ((o && o.method) !== 'POST') return { ok: false, status: 404, json: async () => ({}) };
      await PB.aplicarOrdem(db, { id: 'ORDE_A-00001', reference_id: 'pix-rod3-001', charges: [{ status: 'PAID', amount: { value: 6000, summary: { paid: 6000 } } }] });   // a corrida
      return { ok: true, status: 200, json: async () => ({ id: 'ORDE_B-00001', qr_codes: [{ text: 'qr-B', amount: { value: 5000 }, links: [] }] }) };
    };
    const api = carregarApi(raiz('api/pagamento-pix.js'), criarAdmin(db, TOK)); zerarFreios();
    const r = await comFetch(falso, () => chamar(api, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: { pedidoId: 'pix-rod3-001' } }));
    assert.strictEqual(r.status, 409); assert.match(r.corpo.error, /já foi pago/); assert.ok(!r.corpo.qr_code && !r.corpo.orderId, 'o QR novo não vai para a cliente');
    assert.strictEqual(ped().pagamento.status, 'PAID'); assert.strictEqual(ped().pagamento.orderId, 'ORDE_A-00001', 'o pagamento continua o do QR pago');
    assert.ok(ped().pagamento.ordens.includes('ORDE_B-00001'), 'a ordem nova fica registrada');
    // se mesmo assim o QR novo for pago, a equipe fica sabendo
    const aviso = await PB.aplicarOrdem(db, { id: 'ORDE_B-00001', reference_id: 'pix-rod3-001', charges: [{ status: 'PAID', amount: { value: 5000, summary: { paid: 5000 } } }] });
    assert.strictEqual(aviso.titulo, 'PIX pago duas vezes'); assert.strictEqual(ped().conferirPagamento.motivo, 'em-dobro');

    // ordem paga que o pedido nem tem na lista (registro perdido): não é ignorada nem quita o pedido; vira conferência com aviso
    db._dados.set('pedidos/pix-rod3-002', { userId: 'c1', nome: 'Bia', total: 30, status: 'pendente', pagamento: { provedor: 'pagbank', orderId: 'ORDE_C-00001', ordens: ['ORDE_C-00001'], valorC: 3000, status: 'PAID', ordensPagas: ['ORDE_C-00001'], valorPagoC: 3000 } });
    let a = await PB.aplicarOrdem(db, { id: 'ORDE_SUMIDA-01', reference_id: 'pix-rod3-002', charges: [{ status: 'PAID', amount: { value: 3000 } }] });
    let p2 = db._dados.get('pedidos/pix-rod3-002');
    assert.strictEqual(a.titulo, 'PIX pago duas vezes'); assert.deepStrictEqual([p2.conferirPagamento.motivo, p2.conferirPagamento.recebidoC], ['em-dobro', 6000]);
    assert.deepStrictEqual(p2.pagamento.ordensEstranhas, ['ORDE_SUMIDA-01']); assert.strictEqual(p2.pagamento.valorPagoC, 3000, 'não entra na soma "oficial"');
    assert.strictEqual(await PB.aplicarOrdem(db, { id: 'ORDE_SUMIDA-01', reference_id: 'pix-rod3-002', charges: [{ status: 'PAID', amount: { value: 3000 } }] }), null, 'aviso repetido: nada');
    // num pedido ainda não pago: não quita (a equipe confere no banco), mas avisa
    db._dados.set('pedidos/pix-rod3-003', { userId: 'c1', nome: 'Caio', total: 30, status: 'aguardando_pagamento', pagamento: { provedor: 'pagbank', orderId: 'ORDE_D-00001', ordens: ['ORDE_D-00001'], valorC: 3000, status: 'WAITING' } });
    a = await PB.aplicarOrdem(db, { id: 'ORDE_SUMIDA-02', reference_id: 'pix-rod3-003', charges: [{ status: 'PAID', amount: { value: 3000 } }] });
    p2 = db._dados.get('pedidos/pix-rod3-003');
    assert.strictEqual(a.titulo, 'PIX para conferir'); assert.strictEqual(p2.conferirPagamento.motivo, 'ordem-desconhecida'); assert.strictEqual(p2.pagamento.status, 'WAITING');

    // Asaas: a mesma corrida apaga a cobrança recém-criada
    const antes = { k: process.env.ASAAS_API_KEY, p: process.env.PAGBANK_API_TOKEN, e: process.env.ASAAS_ESPERA_QR_MS };
    process.env.ASAAS_API_KEY = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjAwMDA'; process.env.ASAAS_ESPERA_QR_MS = '1'; delete process.env.PAGBANK_API_TOKEN;
    try {
      require(raiz('lib/segredos'))._zerar();
      const dbA = criarBanco({ 'loja/config': { pixAutomatico: true }, 'pedidos/pix-rod3-001': { userId: 'c1', nome: 'Ana', total: 50, status: 'aguardando_pagamento', pagamento: { provedor: 'asaas', orderId: 'pay_velho1', ordens: ['pay_velho1'], valorC: 6000, status: 'WAITING' } } });
      const PBA = carregarApi(raiz('lib/pagbank.js'), criarAdmin(dbA, {}));
      const chamadas = [];
      const fa = async (url, o = {}) => {
        const u = String(url), metodo = o.method || 'GET'; chamadas.push({ u, metodo });
        const resp = (status, dados) => ({ ok: status < 300, status, json: async () => dados });
        if (u.endsWith('/customers')) return resp(200, { id: 'cus_000001' });
        if (u.endsWith('/payments') && metodo === 'POST') { await PBA.aplicarOrdem(dbA, { id: 'pay_velho1', reference_id: 'banca~pix-rod3-001', charges: [{ status: 'PAID', amount: { value: 6000 } }] }); return resp(200, { id: 'pay_novo01' }); }
        if (/pixQrCode$/.test(u)) return resp(200, { payload: '00020126580014br.gov.bcb.pix0136abc-copia-e-cola', encodedImage: 'iVBORw0KGgo=' });
        if (metodo === 'DELETE') return resp(200, { deleted: true });
        return resp(404, {});
      };
      const apiA = carregarApi(raiz('api/pagamento-pix.js'), criarAdmin(dbA, TOK)); zerarFreios();
      const rA = await comFetch(fa, () => chamar(apiA, { headers: { ...ip(), Authorization: 'Bearer cliente' }, body: { pedidoId: 'pix-rod3-001', cpf: '52998224725' } }));
      assert.strictEqual(rA.status, 409, JSON.stringify(rA.corpo)); assert.ok(!rA.corpo.qr_code);
      assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.u.endsWith('/payments/pay_novo01')), 'a cobrança que sobrou foi apagada no Asaas');
      assert.ok(!chamadas.some((c) => c.metodo === 'DELETE' && c.u.endsWith('/payments/pay_velho1')), 'a paga não é apagada');
    } finally {
      for (const [k, v] of [['ASAAS_API_KEY', antes.k], ['PAGBANK_API_TOKEN', antes.p], ['ASAAS_ESPERA_QR_MS', antes.e]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      require(raiz('lib/segredos'))._zerar();
    }
  });

  teste('CONSERTO 3 · chat: IPv6 conta pelo bloco /64 (trocar o final do endereço não escapa) e "conhecido" é só quem tem pedido pago ou entregue', async () => {
    const api0 = carregarApi(raiz('api/assistente.js'), criarAdmin(criarBanco(), {}));
    const C = api0.conexaoDoChat;
    assert.strictEqual(C('2804:14c:5b80:8a1f:1111:2222:3333:4444'), '2804:14c:5b80:8a1f::/64');
    assert.strictEqual(C('2804:14c:5b80:8a1f:aaaa::1'), '2804:14c:5b80:8a1f::/64', 'mesmo bloco, outro final');
    assert.strictEqual(C('2804:014c:5b80:8a1f::9'), '2804:14c:5b80:8a1f::/64', 'zeros à esquerda não mudam o bloco');
    assert.strictEqual(C('2804:14c::5'), '2804:14c:0:0::/64'); assert.strictEqual(C('[2804:14c:5b80:8a1f::1]'), '2804:14c:5b80:8a1f::/64');
    assert.strictEqual(C('201.17.33.4'), '201.17.33.4'); assert.strictEqual(C('::ffff:201.17.33.4'), '201.17.33.4');
    assert.notStrictEqual(C('2804:14c:5b80:8a1f::1'), C('2804:14c:5b80:8a20::1'), 'blocos diferentes contam separado');
    assert.strictEqual(api0.pedidoQueConta({ status: 'arquivado' }), true); assert.strictEqual(api0.pedidoQueConta({ status: 'preparando', pagamento: { status: 'PAID' } }), true);
    assert.strictEqual(api0.pedidoQueConta({ status: 'pendente' }), false); assert.strictEqual(api0.pedidoQueConta({ status: 'cancelado', pagamento: { status: 'PAID' } }), false);

    // pelo chat: a mesma casa trocando o final do IPv6 (e o login) a cada mensagem para na 91ª
    process.env.GEMINI_API_KEY = 'chave-de-teste';
    const db = criarBanco({ 'produtos/tomate': { nome: 'Tomate', preco: 8.9, unidade: 'kg', ativo: true } });
    const tokens = { ...TOK }, api = carregarApi(raiz('api/assistente.js'), criarAdmin(db, tokens));
    const chat = (cab) => new Promise((resolve, reject) => {
      const res = { _status: 200, setHeader() {}, status(c) { this._status = c; return this; }, json(j) { resolve({ status: this._status, corpo: j }); return this; }, writeHead(c) { this._status = c; }, write() {}, end() { resolve({ status: this._status }); }, flushHeaders() {} };
      Promise.resolve(api({ method: 'POST', headers: cab, body: { action: 'chat_stream', mensagemCliente: 'oi' }, query: {}, socket: {} }, res)).catch(reject);
    });
    const real = Date.now;
    await comFetch(async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"oi"}]}}]}\n\n', { status: 200 }), async () => {
      try {
        let ultimo;
        for (let i = 0; i < 91; i++) {
          if (i % 35 === 0) { const d = i / 35; Date.now = () => real() + d * 11 * 60000; }
          tokens[`v6-${i}`] = { uid: `v6-${i}` }; zerarFreios();
          ultimo = await chat({ 'x-forwarded-for': `2804:14c:5b80:8a1f:${(i + 1).toString(16)}::1`, authorization: `Bearer v6-${i}` });
          if (i < 90) assert.strictEqual(ultimo.status, 200, `mensagem ${i + 1}`);
        }
        assert.strictEqual(ultimo.status, 429);
      } finally { Date.now = real; }
    });
  });

  // ------------------------------------------------------------------ R12. lembretes: só o que gera lembrete; lojas na memória
  teste('CONSERTO 2 · lembretes: a consulta pede status e data juntos (índice publicado), cai para só a data sem o índice, e a lista de lojas fica 1 h na memória', async () => {
    const idx = JSON.parse(require('fs').readFileSync(raiz('firestore.indexes.json'), 'utf8'));
    assert.deepStrictEqual(idx.indexes[0].fields.map((f) => f.fieldPath), ['status', 'data']); assert.strictEqual(idx.indexes[0].collectionGroup, 'pedidos');
    assert.strictEqual(JSON.parse(require('fs').readFileSync(raiz('firebase.json'), 'utf8')).firestore.indexes, 'firestore.indexes.json');
    const A0 = require(raiz('lib/avisos')); const { assinatura, fim } = prepararAvisos(A0);
    try {
      const agora = Date.parse('2026-11-03T15:00:00Z'), atras = (m) => new Date(agora - m * 60000).toISOString();
      const db = criarBanco({ 'pedidos/p-espera': { status: 'pendente', data: atras(20), total: 10 }, 'pedidos/p-feito': { status: 'arquivado', data: atras(30), total: 10 }, 'pedidos/p-separando': { status: 'preparando', data: atras(40), total: 10 } });
      const filtros = [], lidos = [], leiturasDeLojas = [], original = db.collection; let semIndice = false;
      db.collection = (c) => {
        const col = original(c);
        if (c === 'tenants') return { ...col, get: async () => { leiturasDeLojas.push(1); return col.get(); } };
        if (c !== 'pedidos') return col;
        const embrulha = (q, fs) => ({ ...q, where: (...a) => embrulha(q.where(...a), [...fs, a]), limit: (...a) => embrulha(q.limit(...a), fs),
          get: async () => { if (semIndice && fs.some((f) => f[1] === 'in')) throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index'), { code: 9 }); filtros.push(fs.map((f) => f[0]).join('+')); const s = await q.get(); s.docs.forEach((d) => lidos.push(d.id)); return s; } });
        return embrulha(col, []);
      };
      const L = require(raiz('lib/lembretes'));
      assert.deepStrictEqual((await L.pedidosEsperando(db, 'banca', agora)).map((a) => a.ref.id), ['p-espera']);
      assert.deepStrictEqual(filtros, ['status+data+data']); assert.deepStrictEqual(lidos, ['p-espera'], 'pedido que já andou nem sai do banco');
      // sem o índice publicado: continua funcionando, só pela data
      const L2 = carregarApi(raiz('lib/lembretes.js'), criarAdmin(db, {})); semIndice = true; filtros.length = 0;
      assert.deepStrictEqual((await L2.pedidosEsperando(db, 'banca', agora)).map((a) => a.ref.id), ['p-espera']);
      assert.deepStrictEqual(filtros, ['data+data']);
      semIndice = false;
      // lista de lojas com aviso: lida uma vez e guardada por 1 h; aparelho novo refaz na hora
      const A = require(raiz('lib/avisos')), L3 = require(raiz('lib/lembretes'));
      await A.ligar(db, 'banca', { uid: 'u6' }, assinatura(1));
      assert.deepStrictEqual(await L3.lojasComAviso(db, agora), ['banca']); assert.strictEqual(leiturasDeLojas.length, 1);
      await L3.lojasComAviso(db, agora + 3 * 60000); await L3.lojasComAviso(db, agora + 50 * 60000);
      assert.strictEqual(leiturasDeLojas.length, 1, 'nas voltas seguintes, da memória');
      await L3.lojasComAviso(db, agora + 61 * 60000); assert.strictEqual(leiturasDeLojas.length, 2, 'passou 1 h: lê de novo');
      await A.ligar(db, 'banca', { uid: 'u7' }, assinatura(2)); await L3.lojasComAviso(db, agora + 62 * 60000);
      assert.strictEqual(leiturasDeLojas.length, 3, 'aparelho novo ligado: refaz na hora');
      await A.ligar(db, 'banca', { uid: 'u7' }, assinatura(2)); await L3.lojasComAviso(db, agora + 63 * 60000);
      assert.strictEqual(leiturasDeLojas.length, 3, 'o painel renovando o mesmo aparelho não refaz');
    } finally { fim(); }
  });
};
