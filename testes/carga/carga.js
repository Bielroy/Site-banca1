'use strict';
// =====================================================================
//  testes/carga/carga.js — TESTE DE CARGA do servidor de pedidos.
//
//  Roda:  node testes/carga/carga.js
//
//  Sobe o servidor de verdade (server/index.js) com o /api/checkout de verdade, numa porta local,
//  e manda pedidos de muitos clientes ao mesmo tempo para 3 lojas. O banco é o de mentira (em memória)
//  com um atraso imitando o Firestore, então o número mede o NOSSO código e a fila do servidor,
//  não a velocidade do Google. Confere:
//    1) pico de pedidos em 3 lojas ao mesmo tempo: nenhum erro, nenhum pedido perdido, tempo de resposta;
//    2) muitos clientes atrás do MESMO endereço (operadora/feira): quantos passam antes do freio; feira com 3 bancas
//       no mesmo Wi-Fi (ninguém barrado); rajada do mesmo endereço;
//    3) o fusível da loja (pedidos demais em 10 min) segura sem derrubar as outras lojas;
//    4) toque repetido no botão (mesma chave) não cria pedido em dobro.
// =====================================================================
const path = require('path');
const http = require('http');
const assert = require('assert');
const { criarBanco, criarAdmin, carregarApi } = require('../banco-falso');
const raiz = (p) => path.join(__dirname, '..', '..', p);

process.env.FIREBASE_PROJECT_ID = 'x'; process.env.FIREBASE_CLIENT_EMAIL = 'x'; process.env.FIREBASE_PRIVATE_KEY = 'x';
process.env.CATALOGO_DESLIGADO = '1';
const SEGREDO = 'segredo-carga';
const ATRASO_MS = Number(process.env.ATRASO_MS) || 40;     // cada ida ao banco de mentira demora isto (o Firestore fica entre 20 e 100 ms)

const LOJAS = ['banca', 'pastel', 'acai'];
function sementeCarga() {
  const s = {};
  for (const l of LOJAS) {
    const pre = l === 'banca' ? '' : `tenants/${l}/`;
    if (l !== 'banca') s[`tenants/${l}`] = { nome: l, ativo: true };
    s[`${pre}loja/config`] = { wpp: '5561999990000', lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], minimo: 0 };
    for (let i = 0; i < 40; i++) s[`${pre}produtos/p${i}`] = { nome: `Produto ${i}`, preco: 5 + i, unidade: 'un', cat: 'geral', ativo: true };
  }
  return s;
}
// o banco de mentira responde na hora; aqui ele ganha o atraso de um banco de verdade
function comAtraso(db) {
  const dorme = () => new Promise((r) => setTimeout(r, ATRASO_MS * (0.5 + Math.random())));
  const rt = db.runTransaction;
  db.runTransaction = async (fn) => { await dorme(); const r = await rt(fn); await dorme(); return r; };
  const doc0 = db.doc;
  db.doc = (c) => { const d = doc0(c), g = d.get, st = d.set; d.get = async () => { await dorme(); return g(); }; d.set = async (...a) => { await dorme(); return st(...a); }; return d; };
  return db;
}

function postar(porta, corpo, ipCliente, loja) {
  return new Promise((ok) => {
    const dados = JSON.stringify(corpo), t0 = Date.now();
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/checkout', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), 'x-proxy-segredo': SEGREDO, 'x-cliente-ip': ipCliente, ...(loja !== 'banca' ? { 'x-loja': loja } : {}) } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => ok({ status: res.statusCode, ms: Date.now() - t0, corpo: (() => { try { return JSON.parse(b); } catch (_) { return b; } })() }));
    });
    req.on('error', (e) => ok({ status: 0, ms: Date.now() - t0, corpo: String(e) }));
    req.end(dados);
  });
}
const pedido = (i, extra = {}) => ({ nome: `Cliente ${i}`, quadra: String(1 + (i % 30)), lote: String(1 + (i % 20)), condominio: 'Jardins', pag: 'Dinheiro', idempotencyKey: `carga-${i}-${Math.random().toString(36).slice(2, 10)}`,
  itens: [{ id: `p${i % 40}`, qtd: 1 + (i % 3), tipo: 'un' }, { id: `p${(i + 7) % 40}`, qtd: 1, tipo: 'un' }], ...extra });
const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0; };

async function subir() {
  const db = comAtraso(criarBanco(sementeCarga()));
  const adm = criarAdmin(db, {});
  const checkout = carregarApi(raiz('api/checkout.js'), adm);
  const { criarServidor } = require(raiz('server/index.js'));
  const srv = criarServidor({ funcoes: { checkout }, segredo: SEGREDO, exigirProxy: true });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { db, srv, porta: srv.address().port };
}
const zerarMemoria = () => require(raiz('lib/http'))._usos.clear();
const pedidosNoBanco = (db) => [...db._dados.keys()].filter((k) => /(^|\/)pedidos\/[^/]+$/.test(k)).length;

(async () => {
  const relatorio = [];
  // 1) PICO: 3 lojas, 360 pedidos de 360 clientes diferentes, 60 de cada vez
  {
    const { db, srv, porta } = await subir();
    const total = 360, lote = 60, tempos = [], erros = [];
    const t0 = Date.now();
    for (let ini = 0; ini < total; ini += lote) {
      const rs = await Promise.all(Array.from({ length: lote }, (_, k) => { const i = ini + k; return postar(porta, pedido(i), `177.${i >> 8}.${i & 255}.9`, LOJAS[i % 3]); }));
      rs.forEach((r) => { tempos.push(r.ms); if (r.status !== 200) erros.push(`${r.status} ${JSON.stringify(r.corpo).slice(0, 120)}`); });
    }
    const dur = (Date.now() - t0) / 1000;
    relatorio.push(`1) Pico: ${total} pedidos em 3 lojas (${lote} ao mesmo tempo) em ${dur.toFixed(1)} s → ${(total / dur).toFixed(0)} pedidos/s. Resposta: metade em até ${pct(tempos, 0.5)} ms, 95% em até ${pct(tempos, 0.95)} ms, pior ${Math.max(...tempos)} ms. Erros: ${erros.length}. Pedidos gravados: ${pedidosNoBanco(db)}.`);
    assert.strictEqual(erros.length, 0, 'nenhum erro no pico:\n' + erros.slice(0, 5).join('\n'));
    assert.strictEqual(pedidosNoBanco(db), total, 'nenhum pedido perdido');
    srv.close();
  }
  // 2) MESMO ENDEREÇO DE INTERNET (operadora/feira): 70 clientes diferentes, um depois do outro, na mesma loja
  {
    const { srv, porta } = await subir();
    const st = [];
    for (let i = 0; i < 70; i++) { zerarMemoria(); st.push((await postar(porta, pedido(1000 + i), '189.40.10.10', 'pastel')).status); }
    const ok = st.filter((s) => s === 200).length;
    relatorio.push(`2) 70 clientes atrás do MESMO endereço na mesma loja em poucos minutos: ${ok} passaram, ${70 - ok} receberam "aguarde" (e a loja oferece o WhatsApp a eles).`);
    assert.strictEqual(ok, 60); assert.ok(st.slice(60).every((s) => s === 429));
    // o mesmo endereço em OUTRA loja continua comprando
    zerarMemoria(); assert.strictEqual((await postar(porta, pedido(2000), '189.40.10.10', 'acai')).status, 200, 'outra loja não paga pelo freio desta');
    srv.close();
  }
  // 2b) FEIRA COM 3 BANCAS NO MESMO WI-FI: 20 clientes por banca em 10 min (60 no total), saindo em rajadas de 10 juntos
  //     (todo mundo apertando "enviar" no mesmo minuto). Ninguém pode ser barrado.
  {
    const { db, srv, porta } = await subir();
    const st = [];
    for (let r = 0; r < 6; r++) {
      zerarMemoria();       // cada rajada vem uns minutos depois da outra (a janela de 10 s da rajada já passou)
      const rs = await Promise.all(Array.from({ length: 10 }, (_, k) => { const i = 4000 + r * 10 + k; return postar(porta, pedido(i), '177.200.1.1', LOJAS[i % 3]); }));
      rs.forEach((x) => st.push(x.status));
    }
    const ok = st.filter((s) => s === 200).length;
    relatorio.push(`2b) Feira com 3 bancas no MESMO Wi-Fi: 60 clientes (20 por banca) em rajadas de 10 → ${ok} passaram, ${60 - ok} barrados.`);
    assert.strictEqual(ok, 60, 'nenhum cliente da feira barrado: ' + st.join(','));
    assert.strictEqual(pedidosNoBanco(db), 60);
    srv.close();
  }
  // 2c) RAJADA do mesmo endereço (sem esperar): 15 passam juntos, o 16º espera uns segundos
  {
    const { srv, porta } = await subir();
    zerarMemoria();
    const rs = await Promise.all(Array.from({ length: 16 }, (_, k) => postar(porta, pedido(4500 + k), '177.201.1.1', 'banca')));
    const ok = rs.filter((x) => x.status === 200).length;
    relatorio.push(`2c) Rajada de 16 pedidos do mesmo endereço no mesmo segundo: ${ok} passaram, ${16 - ok} receberam "aguarde alguns segundos".`);
    assert.strictEqual(ok, 15);
    srv.close();
  }
  // 3) FUSÍVEL DA LOJA: 160 pedidos de clientes diferentes em 10 min numa loja só
  {
    const { srv, porta } = await subir();
    let ok = 0, barrados = 0;
    for (let ini = 0; ini < 160; ini += 40) {
      const rs = await Promise.all(Array.from({ length: 40 }, (_, k) => postar(porta, pedido(3000 + ini + k), `200.${(ini + k) >> 8}.${(ini + k) & 255}.1`, 'banca')));
      rs.forEach((r) => { if (r.status === 200) ok++; else if (r.status === 429) barrados++; });
    }
    const outra = await postar(porta, pedido(9999), '201.1.1.1', 'pastel');
    relatorio.push(`3) Fusível: 160 pedidos numa loja em 10 min → ${ok} aceitos, ${barrados} barrados ("pedidos demais agora"; o WhatsApp entra). Outra loja no mesmo instante: ${outra.status === 200 ? 'normal' : 'FALHOU ' + outra.status}.`);
    assert.strictEqual(ok, 150); assert.strictEqual(barrados, 10); assert.strictEqual(outra.status, 200);
    srv.close();
  }
  // 4) TOQUE REPETIDO: a mesma chave 5 vezes seguidas (um depois do outro) → um pedido só
  {
    const { db, srv, porta } = await subir();
    const p = pedido(5000), sts = [];
    for (let i = 0; i < 5; i++) { zerarMemoria(); sts.push((await postar(porta, p, '187.1.1.1', 'acai')).status); }
    relatorio.push(`4) Toque repetido (mesma chave 5x): respostas ${sts.join(', ')}; pedidos gravados: ${pedidosNoBanco(db)}.`);
    assert.strictEqual(pedidosNoBanco(db), 1);
    srv.close();
  }
  console.log('\nTESTE DE CARGA (banco de mentira com ' + ATRASO_MS + ' ms por ida ao banco)\n' + relatorio.map((l) => '  ' + l).join('\n') + '\n\nTudo certo.');
  process.exit(0);
})().catch((e) => { console.error('\nFALHOU:', e && e.message ? e.message : e); process.exit(1); });
