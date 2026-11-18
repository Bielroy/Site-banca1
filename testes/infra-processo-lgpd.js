'use strict';
// =====================================================================
//  testes/infra-processo-lgpd.js — cópia (marca de "terminou"), restauração por pasta, --conferir-chave e
//  o pedido de apagar dados (LGPD), inclusive depois de restaurar uma cópia. Entra no `npm test` por testes/infra-processo.js.
// =====================================================================
module.exports = function registrar({ teste, criarBanco, raiz, semente, comChaveDoCofre, path, assert }) {

teste('alerta de falha do backup e marca de "cópia terminou": aviso no celular (1 a cada 30 min) e /api/saude mostra a idade da cópia', async () => {
  const F = require(raiz('server/backup-ferramentas.js')), V = require(raiz('lib/versao')), { criarServidor } = require(raiz('server'));
  const db = criarBanco({});
  const log = console.log; const vistos = []; console.log = (m) => vistos.push(String(m));
  try {
    assert.strictEqual(await F.alertar('A cópia de hoje saiu vazia.', { db }), 0);
    assert.strictEqual(await F.marcar('falha', '3', '2', '1', { db }), 0);
  } finally { console.log = log; }
  const marca = db._dados.get('plataforma/alertas') || {};
  assert.ok(Object.keys(marca).some((k) => /backup-diario/.test(k)), 'o alerta passou pelo freio de 30 min (lib/prudencia.js alertar)');
  const c = db._dados.get(V.DOC_COPIA);
  assert.deepStrictEqual({ ok: c.ok, lojas: c.lojas, enviadas: c.enviadas, falhas: c.falhas }, { ok: false, lojas: 3, enviadas: 2, falhas: 1 });
  V._zerar();
  const srv = criarServidor({ funcoes: {}, obterDb: () => db });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const s = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/saude`)).json();
    assert.strictEqual(s.copia.ok, false); assert.strictEqual(s.copia.enviadas, 2); assert.ok(Date.parse(s.copia.em) > 0);
  } finally { srv.close(); V._zerar(); }
});

// loja de mentira com cliente cifrado (precisa da DADOS_CHAVE ligada)
const lojaComCliente = (Cofre, agora) => ({
  'pedidos/p1': Cofre.fecharCampos({ nome: 'Ana', telefone: '62999990000', quadra: '5', lote: '3', total: 10, status: 'entregue', userId: 'uidAna', data: agora.toISOString(), itens: [] }, 'banca'),
  'pedidos/p2': Cofre.fecharCampos({ nome: 'Bia', telefone: '62988887777', quadra: '1', lote: '1', total: 20, status: 'entregue', data: agora.toISOString(), itens: [] }, 'banca'),
  'contas/contaAna0000000a': { id: 'contaAna0000000a', ...Cofre.fecharCampos({ nome: 'Ana', telefone: '62999990000' }, 'banca'), uids: ['uidAna'] },
});

teste('restaurar cópia: pasta do dia (um arquivo por loja) e arquivo antigo voltam iguais; nunca na produção por padrão; --conferir-chave', async () => {
  await comChaveDoCofre(async () => {
    const P = require(raiz('lib/prudencia')), B = require(raiz('server/backup.js')), R = require(raiz('server/restaurar-backup.js')), Cofre = require(raiz('lib/cofre'));
    const fs = require('fs'), os = require('os'), zlib = require('zlib');
    const agora = new Date();
    const origem = criarBanco({ ...semente(), ...lojaComCliente(Cofre, agora), 'tenants/espetinhos': { nome: 'Espetinhos', ativo: true }, 'tenants/espetinhos/produtos/carne': { nome: 'Espeto', preco: 9, ativo: true },
      'resumos/2026-11-01': { receita: 30 }, 'feiras/f1': { nome: 'Feira Munique' } });
    // como o backup-diario.sh grava hoje: uma pasta por dia, um arquivo por loja + _plataforma
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurar-'));
    for (const tid of await B.listarLojas(origem)) fs.writeFileSync(path.join(pasta, `${tid}.json.gz`), zlib.gzipSync(JSON.stringify(await B.copiaDaLoja(origem, tid, agora.getTime()))));
    fs.writeFileSync(path.join(pasta, '_plataforma.json.gz'), zlib.gzipSync(JSON.stringify(await B.copiaDaPlataforma(origem, agora.getTime()))));
    const dados = R.lerArquivo(pasta);
    assert.deepStrictEqual(Object.keys(dados.lojas).sort(), ['banca', 'espetinhos']);
    const destino = criarBanco({});
    const contagem = await R.restaurarDados(null, dados, { simular: true });
    assert.ok(contagem.documentos > 0); assert.strictEqual(destino._dados.size, 0, 'simular não grava');
    const r = await R.restaurarDados(destino, dados);
    assert.strictEqual(r.documentos, contagem.documentos);
    for (const tid of ['banca', 'espetinhos']) {
      const a = await P.exportarCompleto(origem, tid, agora), b = await P.exportarCompleto(destino, tid, agora);
      assert.deepStrictEqual(b.colecoes, a.colecoes, `${tid}: igual (cadastro e movimento)`); assert.deepStrictEqual(b.ficha, a.ficha);
    }
    assert.strictEqual(destino._dados.get('resumos/2026-11-01').receita, 30, 'caixa voltou');
    assert.strictEqual(destino._dados.get('feiras/f1').nome, 'Feira Munique');
    // arquivo antigo (tudo junto) continua aceito
    const velho = `${pasta}-velho.json.gz`;
    fs.writeFileSync(velho, zlib.gzipSync(JSON.stringify(await B.fazerBackup(origem, { log: () => {} }))));
    assert.deepStrictEqual(Object.keys(R.lerArquivo(velho).lojas).sort(), ['banca', 'espetinhos']);
    const so = criarBanco({}); await R.restaurarDados(so, dados, { lojas: ['espetinhos'] });
    assert.ok(so._dados.has('tenants/espetinhos/produtos/carne') && !so._dados.has('produtos/tomate') && !so._dados.has('feiras/f1'), 'só a loja pedida');
    class Ts { constructor(x, n) { this.s = x; this.n = n; } }
    const v = R.reviver({ a: { _seconds: 5, _nanoseconds: 0 }, b: [{ seconds: 1, nanoseconds: 2, type: 'firestore/timestamp/1.1.0' }], c: { _seconds: 1 } }, Ts);
    assert.ok(v.a instanceof Ts && v.b[0] instanceof Ts && !(v.c instanceof Ts), 'datas do Firestore voltam como datas');
    assert.throws(() => R.lerArquivo(raiz('package.json')), /cópia/, 'arquivo que não é cópia é recusado');
    // --conferir-chave: a chave certa abre; outra chave, não
    const ok = R.conferirChave(dados);
    assert.strictEqual(ok.ok, true); assert.strictEqual(ok.loja, 'banca');
    const certa = process.env.DADOS_CHAVE;
    process.env.DADOS_CHAVE = Buffer.alloc(32, 9).toString('base64');
    try { assert.strictEqual(R.conferirChave(dados).ok, false, 'chave errada: ERRADA'); } finally { process.env.DADOS_CHAVE = certa; }
    assert.deepStrictEqual(R.conferirChave({ lojas: { banca: { colecoes: { pedidos: { x: { nome: 'sem cifra' } } } } } }), { semCifrado: true });
    assert.ok(R.lerOpcoes([pasta, '--conferir-chave'], {}).conferirChave, '--conferir-chave não precisa de destino (não grava)');
    // SEGURANÇA: nunca na produção por padrão
    const semEmu = { FIREBASE_PROJECT_ID: 'projeto-da-producao' };
    assert.throws(() => R.lerOpcoes([pasta], semEmu), /destino/, 'sem destino: recusa');
    assert.throws(() => R.lerOpcoes([pasta, '--projeto', 'banca-adair-e-pedrina', '--credenciais', velho], semEmu), /PRODUÇÃO/);
    assert.throws(() => R.lerOpcoes([pasta, '--projeto', 'projeto-da-producao', '--credenciais', velho], semEmu), /PRODUÇÃO/, 'o projeto das chaves do servidor também é produção');
    assert.ok(R.lerOpcoes([pasta, '--projeto', 'banca-adair-e-pedrina', '--credenciais', velho, '--producao'], semEmu).producao, 'com --producao passa (e ainda pergunta o nome na hora)');
    assert.throws(() => R.lerOpcoes([pasta, '--projeto', 'banca-teste', '--credenciais', velho, '--sim'], semEmu), /só vale no emulador/);
    assert.throws(() => R.lerOpcoes([pasta, '--emulador'], semEmu), /emulador ligado/);
    assert.throws(() => R.lerOpcoes([pasta, '--projeto', 'x', '--credenciais', velho], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /use --emulador/);
    assert.strictEqual(R.lerOpcoes([pasta, '--emulador', '--sim'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).projeto, 'demo-restauro');
    assert.throws(() => R.lerOpcoes([pasta, '--emulador', '--projeto', 'banca-adair-e-pedrina'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /PRODUÇÃO/);
    fs.rmSync(pasta, { recursive: true, force: true }); fs.rmSync(velho, { force: true });
  });
});

teste('LGPD + restauração: quem pediu para apagar NÃO volta com a cópia (marca HMAC, nunca o telefone em claro)', async () => {
  await comChaveDoCofre(async () => {
    const A = require(raiz('lib/apagar-cliente')), B = require(raiz('server/backup.js')), R = require(raiz('server/restaurar-backup.js')), Cofre = require(raiz('lib/cofre'));
    const agora = new Date();
    const db = criarBanco({ ...semente(), ...lojaComCliente(Cofre, agora) });
    const copiaDeAntes = await B.fazerBackup(db, { log: () => {} });          // a cópia de ONTEM ainda tem a Ana
    const r = await A.apagarCliente(db, 'banca', '62999990000', { gravar: true });
    assert.ok(r.marcas >= 2, 'marca do telefone e do aparelho'); assert.match(r.aviso, /7 dias.*60 dias/);
    const marcas = db._dados.get(A.DOC_MARCAS);
    assert.ok(!/62999990000|99990000|uidAna/.test(JSON.stringify(marcas)), 'nada em claro na marca');
    // o dia ruim: volta a cópia de ontem, por cima (as marcas estão no banco e também na cópia de hoje)
    const dados = JSON.parse(JSON.stringify(copiaDeAntes)); dados.lgpd = marcas;
    const res = await R.restaurarDados(db, dados);
    assert.strictEqual(res.lgpd.semChave, false); assert.strictEqual(res.lgpd.reaplicado.banca, 1, 'a Ana foi apagada de novo');
    assert.strictEqual(db._dados.get('pedidos/p1').nome, A.ANONIMO); assert.strictEqual(db._dados.get('pedidos/p1').total, 10);
    assert.ok(!db._dados.has('contas/contaAna0000000a'), 'a conta dela some de novo');
    assert.strictEqual(Cofre.abrir(db._dados.get('pedidos/p2').nome, 'banca', 'nome'), 'Bia', 'a outra cliente continua');
    // restaurar num banco NOVO (máquina e Firebase perdidos): as marcas vêm na própria cópia
    const novo = criarBanco({}), d2 = JSON.parse(JSON.stringify(copiaDeAntes)); d2.lgpd = marcas;
    await R.restaurarDados(novo, d2);
    assert.strictEqual(novo._dados.get('pedidos/p1').nome, A.ANONIMO, 'banco novo: apagada também');
    assert.ok(novo._dados.has(A.DOC_MARCAS), 'e as marcas voltam junto');
    // sem a DADOS_CHAVE: avisa (o script sai com código 3) em vez de deixar passar calado
    const chave = process.env.DADOS_CHAVE; delete process.env.DADOS_CHAVE;
    try { const r3 = await R.restaurarDados(criarBanco({}), d2); assert.strictEqual(r3.lgpd.semChave, true); }
    finally { process.env.DADOS_CHAVE = chave; }
  });
});

teste('LGPD, apagar cliente: acha pelo telefone, pela conta e pelos aparelhos; troca só os campos pessoais; não toca no vizinho de outro condomínio', async () => {
  await comChaveDoCofre(async () => {
    const Cofre = require(raiz('lib/cofre')), A = require(raiz('lib/apagar-cliente')), N = require(raiz('analytics/normalize'));
    const fecha = (o, tid = 'banca') => Cofre.fecharCampos(o, tid);
    const casa = { quadra: '5', lote: '3', condominio: 'Jardins Munique' };
    const perfilId = N.idDeChave(N.chaveCliente({ ...casa, id: 'x' }));
    const vizinhoSemCond = N.idDeChave(N.chaveCliente({ quadra: '5', lote: '3', id: 'x' }, ''));            // quadra 5 lote 3, sem condomínio
    const vizinhoOutroCond = N.idDeChave(N.chaveCliente({ quadra: '5', lote: '3', condominio: 'Aldeia', id: 'x' }));
    const db = criarBanco({
      'pedidos/p1': fecha({ nome: 'Ana', telefone: '62999990000', ...casa, obs: 'portão azul', total: 17.8, pag: 'PIX', status: 'entregue', clienteId: 'contaAna0000000a', userId: 'uidAna', aceitaOfertas: true, entregaDia: '2026-11-10', entrega: { taxa: 5, frete: { valor: 7, km: 3, rota: 'polilinha' } }, itens: [{ id: 'tomate', qtd: 2 }] }),
      'pedidos/p2': fecha({ nome: 'Ana', telefone: '5562999990000', quadra: '', lote: '', total: 5, status: 'pendente' }),
      'pedidos/p4': fecha({ nome: 'Ana', telefone: '', ...casa, total: 8, status: 'entregue', userId: 'uidAna2' }),          // sem telefone, aparelho dela
      'pedidos/p5': fecha({ nome: 'A.', telefone: '', ...casa, total: 4, status: 'entregue' }),                             // sem telefone, listado na conta
      'pedidos/p3': fecha({ nome: 'Bia', telefone: '62988887777', quadra: '1', lote: '1', total: 30, status: 'entregue' }),
      'pedidos/v1': fecha({ nome: 'Vizinho', telefone: '62911112222', quadra: '5', lote: '3', condominio: 'Aldeia', total: 9, status: 'entregue' }),
      'contas/contaAna0000000a': { id: 'contaAna0000000a', ...fecha({ nome: 'Ana', telefone: '62999990000' }), uids: ['uidAna', 'uidAna2'], pedidos: ['p1', 'p5'], crm: perfilId },
      'contas/contaBia0000000b': { id: 'contaBia0000000b', ...fecha({ nome: 'Bia', telefone: '62988887777' }) },
      [`analytics_clientes/${perfilId}`]: { id: perfilId, ...fecha({ nome: 'Ana', ...casa }), uids: ['uidAna'] },
      [`analytics_clientes/${vizinhoSemCond}`]: { id: vizinhoSemCond, ...fecha({ nome: 'Seu Zé', quadra: '5', lote: '3' }), uids: ['uidZe'] },
      [`analytics_clientes/${vizinhoOutroCond}`]: { id: vizinhoOutroCond, ...fecha({ nome: 'Vizinho', quadra: '5', lote: '3', condominio: 'Aldeia' }) },
      'analytics_uid/uidAna': { clienteId: perfilId }, 'analytics_uid/uidAna2': { clienteId: perfilId }, 'analytics_uid/uidZe': { clienteId: vizinhoSemCond },
      'analytics_previsoes/painel': { meta: {}, indiceClientes: Cofre.fecharJSON([{ id: perfilId, nome: 'Ana' }, { id: vizinhoSemCond, nome: 'Seu Zé' }, { id: vizinhoOutroCond, nome: 'Vizinho' }], 'banca', 'indiceClientes') },
      'crm/contatos': { [perfilId]: 1, [vizinhoSemCond]: 2, [vizinhoOutroCond]: 3 },
      'fretes/2026-11-10': { pedidos: { p1: { lat: -16.6, lng: -49.2 }, p9: { lat: 1, lng: 1 } } },
      'espera/tomate': { clientes: [{ nome: 'Ana', tel: Cofre.fechar('62999990000', 'banca', 'telefone') }, { nome: 'Bia', tel: Cofre.fechar('62988887777', 'banca', 'telefone') }] },
      'tenants/espetinhos/pedidos/x1': fecha({ nome: 'Ana', telefone: '62999990000', total: 9 }, 'espetinhos'),     // outra loja, MESMO telefone
    });
    const fotoAntes = JSON.stringify([...db._dados.entries()]);
    const previa = await A.apagarCliente(db, 'banca', '(62) 99999-0000');
    assert.deepStrictEqual(previa.pedidos.sort(), ['p1', 'p2', 'p4', 'p5'], 'telefone (com e sem 55) + aparelho dela (p4) + listado na conta (p5)');
    assert.deepStrictEqual(previa.contas, ['contaAna0000000a']);
    assert.deepStrictEqual(previa.perfis, [perfilId], 'só o perfil COM condomínio: os vizinhos de quadra 5 lote 3 ficam');
    assert.strictEqual(previa.espera, 1); assert.strictEqual(previa.painel, 1); assert.strictEqual(previa.gravado, false);
    assert.ok(!previa.telefone.includes('9999'), 'o relatório não mostra o telefone inteiro');
    assert.strictEqual(JSON.stringify([...db._dados.entries()]), fotoAntes, 'sem gravar: nada muda');

    // um pagamento chega NO MEIO do apagamento: não pode ser desfeito (só os campos pessoais mudam, em transação)
    const original = db.runTransaction; let uma = true;
    db.runTransaction = async (fn) => { if (uma) { uma = false; await db.doc('pedidos/p1').update({ status: 'pago', pagoEm: 'agora' }); } return original(fn); };
    const r = await A.apagarCliente(db, 'banca', '62999990000', { gravar: true });
    db.runTransaction = original;
    assert.strictEqual(r.gravado, true);
    const p1 = db._dados.get('pedidos/p1');
    assert.strictEqual(p1.status, 'pago', 'o pagamento que chegou no meio continua lá'); assert.strictEqual(p1.pagoEm, 'agora');
    assert.strictEqual(p1.nome, A.ANONIMO);
    for (const k of ['telefone', 'quadra', 'lote', 'obs', 'condominio', 'clienteId', 'userId']) assert.strictEqual(p1[k], '', `pedido sem ${k}`);
    assert.strictEqual(p1.aceitaOfertas, false); assert.ok(p1.dadosApagadosEm);
    assert.strictEqual(p1.total, 17.8); assert.strictEqual(p1.pag, 'PIX'); assert.deepStrictEqual(p1.itens, [{ id: 'tomate', qtd: 2 }], 'valores e itens ficam (caixa)');
    assert.deepStrictEqual(p1.entrega, { taxa: 5, frete: { valor: 7, km: 3 } }, 'a rota do frete sai, o resto da entrega fica');
    for (const id of ['p4', 'p5']) assert.strictEqual(db._dados.get(`pedidos/${id}`).nome, A.ANONIMO, `${id} (sem telefone) também`);
    assert.strictEqual(Cofre.abrir(db._dados.get('pedidos/p3').telefone, 'banca', 'telefone'), '62988887777', 'pedido de outra pessoa intacto');
    assert.strictEqual(Cofre.abrir(db._dados.get('pedidos/v1').nome, 'banca', 'nome'), 'Vizinho', 'vizinho de outro condomínio intacto');
    assert.ok(!db._dados.has('contas/contaAna0000000a') && db._dados.has('contas/contaBia0000000b'));
    assert.ok(!db._dados.has(`analytics_clientes/${perfilId}`) && db._dados.has(`analytics_clientes/${vizinhoSemCond}`) && db._dados.has(`analytics_clientes/${vizinhoOutroCond}`));
    assert.ok(!db._dados.has('analytics_uid/uidAna') && !db._dados.has('analytics_uid/uidAna2') && db._dados.has('analytics_uid/uidZe'), 'aparelho do vizinho fica');
    assert.deepStrictEqual(db._dados.get('crm/contatos'), { [vizinhoSemCond]: 2, [vizinhoOutroCond]: 3 }, '"já contatado" do vizinho fica');
    assert.deepStrictEqual(Cofre.abrirJSON(db._dados.get('analytics_previsoes/painel').indiceClientes, 'banca', 'indiceClientes', []).map((c) => c.nome), ['Seu Zé', 'Vizinho'], 'lista de clientes do painel sem ela');
    assert.deepStrictEqual(Object.keys(db._dados.get('fretes/2026-11-10').pedidos), ['p9']);
    assert.deepStrictEqual(db._dados.get('espera/tomate').clientes.map((c) => c.nome), ['Bia']);
    assert.strictEqual(Cofre.abrir(db._dados.get('tenants/espetinhos/pedidos/x1').telefone, 'espetinhos', 'telefone'), '62999990000', 'a outra loja não é tocada');
    await assert.rejects(A.apagarCliente(db, 'banca', '123'), /Telefone inválido/);
    await assert.rejects(A.apagarCliente(db, '../x', '62999990000'), /Loja inválida/);
    assert.ok(A.mesmoTelefone('6299990000', '62999990000'), 'cadastro antigo sem o 9 do celular');
    assert.deepStrictEqual(A.idsDoPerfil({ quadra: '5', lote: '3' }), [vizinhoSemCond], 'pedido sem condomínio: chave sem condomínio');
    assert.deepStrictEqual(A.idsDoPerfil(casa), [perfilId], 'pedido com condomínio: só a chave com condomínio');

    // o script: sem --gravar só mostra; com --gravar pergunta, e sem "APAGAR" não muda nada
    const S = require(raiz('scripts/apagar-cliente.js'));
    const db2 = criarBanco({ 'pedidos/q1': fecha({ nome: 'Caio', telefone: '62977776666', total: 3 }) });
    const log = console.log; const saiu = []; console.log = (m) => saiu.push(String(m));
    try {
      assert.strictEqual(await S.principal(['--loja', 'banca', '--telefone', '62977776666'], { db: db2 }), 0);
      assert.strictEqual(Cofre.abrir(db2._dados.get('pedidos/q1').nome, 'banca', 'nome'), 'Caio', 'simulação');
      assert.strictEqual(await S.principal(['--loja', 'banca', '--telefone', '62977776666', '--gravar'], { db: db2, perguntar: async () => 'nao' }), 1);
      assert.strictEqual(Cofre.abrir(db2._dados.get('pedidos/q1').nome, 'banca', 'nome'), 'Caio', 'sem APAGAR, nada muda');
      assert.strictEqual(await S.principal(['--loja', 'banca', '--telefone', '62977776666', '--gravar'], { db: db2, perguntar: async () => 'APAGAR' }), 0);
      assert.strictEqual(db2._dados.get('pedidos/q1').nome, A.ANONIMO);
      assert.ok(saiu.some((m) => /7 dias/.test(m) && /60 dias/.test(m)), 'avisa que as cópias expiram (7 dias no Firebase, 60 no R2)');
      const aud = [...db2._dados.entries()].filter(([k]) => k.startsWith('auditoria/'));
      assert.ok(aud.length, 'fica na trilha de auditoria');
      assert.ok(!aud.some(([, x]) => JSON.stringify(x).includes('62977776666')), 'sem o telefone na auditoria');
    } finally { console.log = log; }
  });
});

};
