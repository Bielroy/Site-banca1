'use strict';
// =====================================================================
//  testes/infra-processo-r3.js — rodada 3: pedido de balcão/mensagem ("equipe:") não leva clientes dos outros,
//  DADOS_CHAVE errada trava o cofre em vez de passar calada, e cópia diária incremental + completa semanal.
//  Entra no `npm test` por testes/infra-processo.js.
// =====================================================================
module.exports = function registrar({ teste, criarBanco, raiz, semente, comChaveDoCofre, path, assert }) {

const CHAVE_7 = Buffer.alloc(32, 7).toString('base64');        // a de comChaveDoCofre
const CHAVE_9 = Buffer.alloc(32, 9).toString('base64');        // "a chave errada"

teste('LGPD: apagar a Ana não leva os pedidos de Bia e Caio registrados pelo mesmo funcionário (userId "equipe:..."), nem na restauração', async () => {
  await comChaveDoCofre(async () => {
    const A = require(raiz('lib/apagar-cliente')), B = require(raiz('server/backup.js')), R = require(raiz('server/restaurar-backup.js')), Cofre = require(raiz('lib/cofre'));
    const crypto = require('crypto');
    const agoraIso = new Date().toISOString();
    const fecha = (o) => Cofre.fecharCampos({ data: agoraIso, ...o }, 'banca');
    const joao = 'equipe:uidJoao';
    const db = criarBanco({ ...semente(),
      'pedidos/ana-msg': fecha({ nome: 'Ana', telefone: '62999990000', total: 10, status: 'entregue', userId: joao, origem: 'mensagem' }),
      'pedidos/bia-msg': fecha({ nome: 'Bia', telefone: '62988887777', total: 20, status: 'entregue', userId: joao, origem: 'mensagem' }),
      'pedidos/caio-msg': fecha({ nome: 'Caio', telefone: '62977776666', total: 30, status: 'entregue', userId: joao, origem: 'mensagem' }),
      'pedidos/balcao': fecha({ nome: 'Balcão', telefone: '', total: 5, status: 'entregue', userId: joao, origem: 'balcao' }),
      // aparelho dividido: a Bia pediu no celular da Ana (mesmo uid, OUTRO telefone) → não é da Ana
      'pedidos/ana-site': fecha({ nome: 'Ana', telefone: '62999990000', total: 12, status: 'entregue', userId: 'uidAna' }),
      'pedidos/bia-no-celular-da-ana': fecha({ nome: 'Bia', telefone: '62988887777', total: 7, status: 'entregue', userId: 'uidAna' }),
      'contas/contaJoao000000x': { id: 'contaJoao000000x', ...fecha({ nome: 'Caio', telefone: '62977776666' }), uids: [joao] },
    });
    assert.strictEqual(A.uidValido(joao), false, '"equipe:..." nunca é aparelho de cliente');
    assert.strictEqual(A.uidValido('anonimo'), false);
    const previa = await A.apagarCliente(db, 'banca', '62999990000');
    assert.deepStrictEqual(previa.pedidos.sort(), ['ana-msg', 'ana-site'], 'só os da Ana');
    assert.deepStrictEqual(previa.contas, [], 'a conta ligada ao funcionário não é dela');
    const copia = await B.fazerBackup(db, { log: () => {} });
    assert.ok(copia.lojas.banca.colecoes.pedidos['ana-msg'], 'a cópia de antes tem a Ana');
    const r = await A.apagarCliente(db, 'banca', '62999990000', { gravar: true });
    assert.strictEqual(r.marcas, 2, 'marca do telefone e do aparelho uidAna; nenhuma de "equipe:"');
    for (const id of ['bia-msg', 'caio-msg', 'balcao', 'bia-no-celular-da-ana']) assert.notStrictEqual(db._dados.get(`pedidos/${id}`).nome, A.ANONIMO, `${id} intacto`);
    // uma marca ANTIGA de "equipe:..." (feita antes deste conserto) já no banco: o reaplicar ignora
    const k = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(CHAVE_7, 'base64'), Buffer.from('banca-lgpd-v1'), Buffer.from('marcas'), 32));
    const velha = crypto.createHmac('sha256', k).update(`banca|uid|${joao}`).digest('hex').slice(0, 40);
    await db.doc(A.DOC_MARCAS).set({ [velha]: { loja: 'banca', tipo: 'uid' } }, { merge: true });
    // dia ruim: volta a cópia de antes; a Ana some de novo, os outros ficam
    const dados = JSON.parse(JSON.stringify(copia)); dados.lgpd = db._dados.get(A.DOC_MARCAS);
    const res = await R.restaurarDados(db, dados);
    assert.strictEqual(res.lgpd.reaplicado.banca, 2, 'os 2 pedidos da Ana apagados de novo');
    assert.strictEqual(db._dados.get('pedidos/ana-msg').nome, A.ANONIMO);
    for (const id of ['bia-msg', 'caio-msg', 'balcao', 'bia-no-celular-da-ana']) assert.strictEqual(['Bia', 'Caio', 'Balcão'].includes(Cofre.abrir(db._dados.get(`pedidos/${id}`).nome, 'banca', 'nome')), true, `${id} intacto depois de restaurar`);
    assert.ok(db._dados.has('contas/contaJoao000000x'));
  });
});

teste('DADOS_CHAVE errada: impressão da chave; cofre TRAVA (não grava nem abre), apagar e reaplicar recusam, /api/saude e o painel avisam', async () => {
  await comChaveDoCofre(async () => {
    const Cofre = require(raiz('lib/cofre')), A = require(raiz('lib/apagar-cliente')), R = require(raiz('server/restaurar-backup.js')), { criarServidor } = require(raiz('server'));
    const db = criarBanco({ ...semente(), 'pedidos/p1': Cofre.fecharCampos({ nome: 'Ana', telefone: '62999990000', total: 10 }, 'banca') });
    assert.strictEqual(await Cofre.conferirImpressao(db), 'gravada', 'primeira vez: grava');
    const h = db._dados.get(Cofre.DOC_IMPRESSAO).h;
    assert.ok(/^[0-9a-f]{32}$/.test(h) && !h.includes(CHAVE_7), 'só o HMAC, nunca a chave');
    assert.strictEqual(await Cofre.conferirImpressao(db), 'ok');
    process.env.DADOS_CHAVE = CHAVE_9;                                  // servidor sobe com a chave errada
    try {
      assert.strictEqual(await Cofre.conferirImpressao(db), 'diferente');
      assert.strictEqual(Cofre.travado(), true);
      assert.throws(() => Cofre.fecharCampos({ nome: 'Novo cliente' }, 'banca'), /travado/, 'pedido novo NÃO é cifrado com a chave errada');
      assert.throws(() => Cofre.fecharJSON([1], 'banca', 'x'), /travado/);
      assert.strictEqual(Cofre.fecharCampos({ total: 3 }, 'banca').total, 3, 'sem campo de cliente, segue normal');
      assert.strictEqual(Cofre.abrir(db._dados.get('pedidos/p1').nome, 'banca', 'nome'), Cofre.PROTEGIDO);
      assert.strictEqual(Cofre.chaveParaPainel('banca'), '', 'o painel não recebe chave errada');
      await assert.rejects(A.apagarCliente(db, 'banca', '62999990000'), /DIFERENTE/, 'não diz "nada encontrado" com a chave errada');
      await db.doc(A.DOC_MARCAS).set({ ['b'.repeat(40)]: { loja: 'banca', tipo: 'tel' } });
      await assert.rejects(A.reaplicar(db, ['banca']), /DIFERENTE/, 'reaplicar não devolve zero calado');
      const srv = criarServidor({ funcoes: {} });
      await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
      try { assert.strictEqual((await (await fetch(`http://127.0.0.1:${srv.address().port}/api/saude`)).json()).chave, 'diferente'); } finally { srv.close(); }
      const Av = await import(raiz('js/aviso-versao-lib.js'));
      assert.match(Av.avisosDeVersao(null, { ok: true, chave: 'diferente' })[0], /URGENTE: a DADOS_CHAVE/);
      // --conferir-chave pela impressão que vem na cópia (_plataforma.json.gz)
      assert.strictEqual(R.conferirChave({ lojas: {}, chaveImpressao: h }).ok, false, 'a chave errada não confere');
    } finally { process.env.DADOS_CHAVE = CHAVE_7; }
    assert.strictEqual(Cofre.travado(), false, 'com a chave certa de volta, destrava');
    assert.strictEqual(R.conferirChave({ lojas: {}, chaveImpressao: h }).ok, true);
    assert.strictEqual(Cofre.abrir(db._dados.get('pedidos/p1').nome, 'banca', 'nome'), 'Ana');
  });
});

teste('cópia diária: INCREMENTAL nos dias comuns (só o que mudou) e COMPLETA 1x por semana; restaurar monta completa + incrementais', async () => {
  const P = require(raiz('lib/prudencia')), B = require(raiz('server/backup.js')), R = require(raiz('server/restaurar-backup.js'));
  const fs = require('fs'), os = require('os'), zlib = require('zlib');
  const DIA = 86400000;
  // escolhe um começo em que os 2 dias seguintes NÃO são o dia da completa da banca
  let t0 = Date.UTC(2026, 10, 2, 9, 10);
  while ([1, 2].some((n) => new Date(t0 + n * DIA).getUTCDay() === P.diaDaCompleta('banca'))) t0 += DIA;
  const iso = (t) => new Date(t).toISOString();
  const db = criarBanco({ ...semente(),
    'produtos/alface': { nome: 'Alface', preco: 3, ativo: true },
    'pedidos/velho': { total: 1, data: iso(t0 - 30 * DIA), status: 'entregue' },
    'pedidos/ontem': { total: 2, data: iso(t0 - DIA), status: 'pendente' },
    'estoque_mov/m-velho': { em: iso(t0 - 60 * DIA) },
    'resumos/2026-01-01': { receita: 99 },
    'contas/c1': { id: 'c1', vistoEm: iso(t0 - 90 * DIA) },
  });
  // sem estado: completa
  assert.deepStrictEqual(P.tipoDeHoje('banca', null, t0), { tipo: 'completa' });
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'corrente-'));
  const gravar = async (t) => {
    const c = await B.copiaDaLoja(db, 'banca', t);
    const dir = path.join(pasta, iso(t).slice(0, 10)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'banca.json.gz'), zlib.gzipSync(JSON.stringify(c)));
    await B.confirmar(db, 'banca', c.copia.tipo, c.feitaEm);
    return c.copia;
  };
  const c0 = await gravar(t0);
  assert.strictEqual(c0.tipo, 'completa');
  assert.ok(c0.colecoes.pedidos.velho && c0.colecoes.estoque_mov['m-velho'] && c0.colecoes.resumos['2026-01-01'] && c0.colecoes.contas.c1, 'completa leva o histórico');
  // dia 1: pedido novo, o de ontem mudou de status, um produto saiu
  await db.doc('pedidos/novo').set({ total: 5, data: iso(t0 + 0.5 * DIA), status: 'pendente' });
  await db.doc('pedidos/ontem').set({ total: 2, data: iso(t0 - DIA), status: 'entregue' });
  await db.doc('estoque_mov/m1').set({ em: iso(t0 + 0.6 * DIA) });
  await db.doc('produtos/alface').delete();
  const c1 = await gravar(t0 + DIA);
  assert.strictEqual(c1.tipo, 'incremental', 'dia comum: incremental');
  assert.deepStrictEqual(Object.keys(c1.colecoes.pedidos).sort(), ['novo', 'ontem'], 'só os pedidos recentes (7 dias de margem): o de 30 dias não é relido');
  assert.deepStrictEqual(Object.keys(c1.colecoes.estoque_mov), ['m1'], 'estoque: só o novo');
  assert.ok(!c1.colecoes.resumos['2026-01-01'] && !c1.colecoes.contas.c1, 'caixa e contas antigos não são relidos');
  // dia 2: mais um pedido
  await db.doc('pedidos/dia2').set({ total: 7, data: iso(t0 + 1.5 * DIA), status: 'pendente' });
  assert.strictEqual((await gravar(t0 + 2 * DIA)).tipo, 'incremental');
  // restaurar a pasta do dia 2: completa (dia 0) + incremental (dia 1) + incremental (dia 2)
  const dados = R.lerArquivo(path.join(pasta, iso(t0 + 2 * DIA).slice(0, 10)));
  const cols = dados.lojas.banca.colecoes;
  assert.deepStrictEqual(Object.keys(cols.pedidos).sort(), ['dia2', 'novo', 'ontem', 'velho'], 'histórico inteiro');
  assert.strictEqual(cols.pedidos.ontem.status, 'entregue', 'vale a versão mais nova do pedido');
  assert.ok(!cols.produtos.alface, 'o cadastro é o da cópia mais nova (produto apagado não volta)');
  assert.ok(cols.resumos['2026-01-01'] && cols.contas.c1 && cols.estoque_mov['m-velho'] && cols.estoque_mov.m1);
  assert.strictEqual(dados.lojas.banca.corrente.incrementais, 2);
  // a completa sumiu (disco limpo, faltou baixar do R2): erro claro, não restauração pela metade
  fs.rmSync(path.join(pasta, iso(t0).slice(0, 10)), { recursive: true });
  assert.throws(() => R.lerArquivo(path.join(pasta, iso(t0 + 2 * DIA).slice(0, 10))), /COMPLETA anterior/);
  assert.throws(() => R.lerArquivo(path.join(pasta, iso(t0 + 2 * DIA).slice(0, 10), 'banca.json.gz')), /INCREMENTAL/, 'arquivo solto incremental: pede a pasta');
  fs.rmSync(pasta, { recursive: true, force: true });
  // semana: no dia da loja vira completa; e nunca passa de 7 dias sem completa
  const est = { completaEm: iso(t0), ultimaEm: iso(t0 + 2 * DIA) };
  let dia = t0 + DIA; while (new Date(dia).getUTCDay() !== P.diaDaCompleta('banca')) dia += DIA;
  assert.strictEqual(P.tipoDeHoje('banca', est, dia).tipo, 'completa', 'dia da semana da loja');
  assert.strictEqual(P.tipoDeHoje('banca', { completaEm: iso(t0), ultimaEm: iso(t0) }, t0 + 7 * DIA).tipo, 'completa', 'completa com 7 dias: refaz');
  // o limite por coleção corta os MAIS VELHOS (ordem decrescente), nunca os pedidos novos; e a releitura dos 31 dias saiu
  const src = fs.readFileSync(raiz('lib/prudencia.js'), 'utf8');
  assert.ok(/orderBy\(campo, 'desc'\)\.limit\(MAX_POR_COLECAO\)/.test(src));
  assert.ok(!/await exportar\(db, tid, agora\);\s+\/\/ cadastro/.test(src), 'a cópia não relê os 31 dias de pedidos do exportar()');
  assert.ok(/^DIAS="\$\{DIAS:-7\}"/m.test(fs.readFileSync(raiz('scripts/backup-diario.sh'), 'utf8')), 'disco guarda 7 dias');
  assert.ok(/--confirmar/.test(fs.readFileSync(raiz('scripts/backup-diario.sh'), 'utf8')), 'a corrente só anda depois do arquivo gravado inteiro');
});

};
