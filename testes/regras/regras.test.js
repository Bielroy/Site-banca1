'use strict';
// =====================================================================
//  testes/regras/regras.test.js — AS REGRAS DO BANCO, TESTADAS DE VERDADE.
//
//  Roda firestore.rules e storage.rules no EMULADOR oficial do Firebase e
//  tenta, com cada tipo de conta, ler e gravar o que não pode. É o mesmo
//  programa de regras que o Firebase usa no ar.
//
//  Como roda (o GitHub faz sozinho a cada mudança, ver .github/workflows):
//     npm install --prefix testes/regras
//     testes/regras/node_modules/.bin/firebase emulators:exec --only firestore,storage \
//         --project demo-banca "node testes/regras/regras.test.js"
//
//  Convenção: `pode(...)` = a regra tem de DEIXAR; `nega(...)` = tem de BARRAR.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch, setLogLevel } = require('firebase/firestore');
const { ref, uploadBytes, getBytes, listAll, deleteObject } = require('firebase/storage');

const raiz = (p) => path.join(__dirname, '..', '..', p);
const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
const pode = (p) => assertSucceeds(p);
const nega = (p) => assertFails(p);

const PAPEIS = ['proprietario', 'administrador', 'funcionario', 'caixa', 'producao', 'estoque'];
const TEMA = { primaria: '#1a3a2a', secundaria: '#4a9467', destaque: '#c4773a', fundo: '#faf7f2', superficie: '#ffffff', texto: '#1a1a18', sobrePrimaria: '#ffffff', fonteTitulo: 'Fraunces', fonteTexto: 'Figtree', raio: 14, etiqueta: 'barbante' };
const VENENO = '"><img src=x onerror=alert(document.domain)>';

let env;
const conta = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@teste.com`, email_verified: true, ...claims });
const de = (loja, papel) => conta(`${loja}-${papel}`, { tenants: { [loja]: papel } });
const anonimo = () => env.unauthenticatedContext();
const cliente = (uid = 'cli-1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } });   // login anônimo da loja: sem e-mail
const plataforma = () => conta('dono-plataforma', { plataforma: true });
const donaAntiga = () => conta('dona-antiga', { admin: true });
// caminho de um dado: loja original fica na raiz; as outras, em tenants/{id}
const cam = (loja, resto) => (loja === 'banca' ? resto : `tenants/${loja}/${resto}`);
// cada conta de teste abre o banco UMA vez (a biblioteca não deixa abrir duas vezes a mesma conta)
const bancos = new WeakMap(), gavetas = new WeakMap();
const bancoDe = (ctx) => { if (!bancos.has(ctx)) bancos.set(ctx, ctx.firestore()); return bancos.get(ctx); };
const gavetaDe = (ctx) => { if (!gavetas.has(ctx)) gavetas.set(ctx, ctx.storage()); return gavetas.get(ctx); };
const d = (ctx, caminho) => doc(bancoDe(ctx), caminho);
const c = (ctx, caminho) => collection(bancoDe(ctx), caminho);

async function semear() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore(), lote = writeBatch(db), por = (caminho, dados) => lote.set(doc(db, caminho), dados);
    for (const loja of ['banca', 'loja-a', 'loja-b']) {
      por(`tenants/${loja}`, { nome: `Loja ${loja}`, subtitulo: 'frase', ativo: true, tipo: 'hortifruti', modulos: { ia: false }, feiraId: '', tema: TEMA });
      por(cam(loja, 'produtos/p1'), { nome: 'Pão', preco: 5, unidade: 'un', cat: 'paes', ativo: true, estoqueFisico: 10, estoqueMin: 2 });
      por(cam(loja, 'produtos_custos/p1'), { custo: 2.5, ficha: { rende: 10, validadeDias: 3, itens: [{ id: 'p2', qtd: 1 }] } });
      por(cam(loja, 'categorias/paes'), { chave: 'paes', nome: 'Pães', ordem: 1, visivel: true });
      por(cam(loja, 'loja/config'), { wpp: '5562999990000', lojaAberta: true });
      por(cam(loja, 'loja/comunicados'), { dias: [] });
      por(cam(loja, 'loja/avaliacoes'), { soma: 47, n: 10, media: 4.7 });
      por(cam(loja, 'loja/fotos'), { itens: [{ url: 'https://i.ibb.co/x/a.jpg', nome: 'foto-da-familia.jpg' }] });
      por(cam(loja, 'pedidos/ped-1'), { userId: 'cli-1', nome: 'Ana', telefone: '62999990000', quadra: '1', lote: '2', total: 20, status: 'pendente', itens: [] });
      por(cam(loja, 'pedidos/ped-2'), { userId: 'cli-2', nome: 'Bia', total: 30, status: 'preparando', itens: [] });
      por(cam(loja, 'pedidos/ped-enviado'), { userId: 'cli-2', total: 30, status: 'enviado', itens: [] });
      por(cam(loja, 'pedidos/ped-arquivado'), { userId: 'cli-2', total: 30, status: 'arquivado', itens: [] });
      por(cam(loja, 'pedidos/ped-cancelado'), { userId: 'cli-2', total: 30, status: 'cancelado', estornadoEm: 'x', itens: [] });
      por(cam(loja, 'pedidos/ped-pix'), { userId: 'cli-2', total: 30, status: 'aguardando_pagamento', itens: [] });
      por(cam(loja, 'cupons/DEZ'), { ativo: true, percentual: 10 });
      por(cam(loja, 'crm/contatos'), { c1: '2026-10-01' });
      por(cam(loja, 'equipe/u1'), { email: 'x@x', papel: 'caixa' });
      por(cam(loja, 'resumos/2026-10-01'), { receita: 100, pedidos: 3 });
      por(cam(loja, 'analytics/dashboard'), { receitaTotal: 100 });
      por(cam(loja, 'estoque_mov/m1'), { produtoId: 'p1', delta: 5 });
      por(cam(loja, 'estoque_resumo/2026-10'), { p: {} });
      por(cam(loja, 'producoes/l1'), { lote: 'x' });
      por(cam(loja, 'fechamentos/2026-10-01'), { dia: '2026-10-01', atualizadoEm: 'x', itens: {} });
      por(cam(loja, 'calendario/e1'), { data: '2026-10-12', titulo: 'feriado' });
      por(cam(loja, 'auditoria/a1'), { acao: 'x', quem: 'y' });
      por(cam(loja, 'avisos/ap1'), { uid: 'u', endpoint: 'https://fcm.googleapis.com/x', keys: {} });
      por(cam(loja, 'uso_ia/2026-10-01'), { chat: 3 });
      por(cam(loja, 'maquininha/2026-10-01'), { total: 10 });
      por(cam(loja, 'analytics_clientes/c1'), { nome: 'Ana', quadra: '1' });
    }
    por('feiras/feira-1', { nome: 'Feira', lojas: [{ id: 'loja-a', nome: 'Loja A' }, { id: 'loja-b', nome: 'Loja B' }] });
    por('plataforma/segredos', { pagbank: 'token-secreto', imgbb: 'chave-secreta' });
    por('plataforma/maquininha_loja-a', { estabelecimento: '123', token: 'segredo' });
    por('plataforma/dono', { uid: 'dono-plataforma' });
    por('backups/loja-a_2026-10-01', { loja: 'loja-a' });
    por('limites/pedido_x', { n: 1 });
    por('auditoria_plataforma/a1', { acao: 'login-recusado', quem: 'x@x' });
    await lote.commit();
  });
}

// ====================================================================== PÚBLICO (sem login)
teste('visitante sem login lê só a vitrine', async () => {
  const v = anonimo();
  for (const loja of ['banca', 'loja-a']) {
    await pode(getDoc(d(v, cam(loja, 'produtos/p1')))); await pode(getDocs(c(v, cam(loja, 'produtos'))));
    await pode(getDocs(c(v, cam(loja, 'categorias')))); await pode(getDoc(d(v, `tenants/${loja}`)));
    await pode(getDoc(d(v, cam(loja, 'loja/config')))); await pode(getDoc(d(v, cam(loja, 'loja/comunicados')))); await pode(getDoc(d(v, cam(loja, 'loja/avaliacoes'))));
    // o banco de fotos (com os nomes originais dos arquivos) não é da vitrine
    await nega(getDoc(d(v, cam(loja, 'loja/fotos'))));
    for (const privado of ['pedidos/ped-1', 'cupons/DEZ', 'crm/contatos', 'equipe/u1', 'resumos/2026-10-01', 'analytics/dashboard', 'estoque_mov/m1', 'estoque_resumo/2026-10', 'producoes/l1', 'produtos_custos/p1',
      'fechamentos/2026-10-01', 'calendario/e1', 'auditoria/a1', 'avisos/ap1', 'uso_ia/2026-10-01', 'maquininha/2026-10-01', 'analytics_clientes/c1']) await nega(getDoc(d(v, cam(loja, privado))));
    for (const colecao of ['pedidos', 'cupons', 'crm', 'equipe', 'produtos_custos', 'fechamentos', 'auditoria', 'avisos']) await nega(getDocs(c(v, cam(loja, colecao))));
  }
  await pode(getDoc(d(v, 'feiras/feira-1')));
  for (const servidor of ['plataforma/segredos', 'plataforma/maquininha_loja-a', 'plataforma/dono', 'backups/loja-a_2026-10-01', 'limites/pedido_x', 'auditoria_plataforma/a1']) await nega(getDoc(d(v, servidor)));
  await nega(getDocs(c(v, 'plataforma'))); await nega(getDocs(c(v, 'backups'))); await nega(getDocs(c(v, 'auditoria_plataforma')));
});

teste('visitante sem login (e cliente com login anônimo) não grava NADA', async () => {
  for (const v of [anonimo(), cliente()]) for (const loja of ['banca', 'loja-a']) {
    await nega(setDoc(d(v, cam(loja, 'produtos/novo')), { nome: 'x', preco: 0.01 })); await nega(updateDoc(d(v, cam(loja, 'produtos/p1')), { preco: 0.01 })); await nega(deleteDoc(d(v, cam(loja, 'produtos/p1'))));
    await nega(setDoc(d(v, cam(loja, 'pedidos/novo')), { userId: 'cli-1', total: 0, status: 'arquivado', pagamento: { status: 'PAID' } }));
    await nega(setDoc(d(v, cam(loja, 'loja/config')), { wpp: '5500000000000' }, { merge: true })); await nega(setDoc(d(v, cam(loja, 'loja/avaliacoes')), { media: 5 }));
    await nega(setDoc(d(v, cam(loja, 'cupons/GRATIS')), { ativo: true, percentual: 100 })); await nega(setDoc(d(v, cam(loja, 'categorias/x')), { nome: 'x' }));
    await nega(updateDoc(d(v, `tenants/${loja}`), { nome: 'Invadida' })); await nega(setDoc(d(v, cam(loja, 'equipe/eu')), { papel: 'proprietario' }));
    await nega(setDoc(d(v, cam(loja, 'fechamentos/2026-10-02')), { dia: '2026-10-02', itens: {} })); await nega(setDoc(d(v, cam(loja, 'auditoria/x')), { acao: 'x' }));
  }
  await nega(setDoc(d(anonimo(), 'tenants/loja-nova'), { nome: 'Nova', ativo: true })); await nega(setDoc(d(anonimo(), 'plataforma/dono'), { uid: 'eu' })); await nega(setDoc(d(cliente(), 'feiras/f'), { nome: 'x' }));
});

// ====================================================================== CLIENTE
teste('cliente lê só o PRÓPRIO pedido, não lista e não muda nada nele', async () => {
  for (const loja of ['banca', 'loja-a']) {
    const eu = cliente('cli-1');
    await pode(getDoc(d(eu, cam(loja, 'pedidos/ped-1'))));
    await nega(getDoc(d(eu, cam(loja, 'pedidos/ped-2'))));                  // pedido de outra pessoa
    await nega(getDocs(c(eu, cam(loja, 'pedidos'))));                       // listar todos
    await nega(getDocs(query(c(eu, cam(loja, 'pedidos')), where('status', '==', 'pendente'))));
    await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { status: 'arquivado' })); await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { total: 0.01 }));
    await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { 'pagamento.status': 'PAID' })); await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { userId: 'cli-2' }));
    await nega(deleteDoc(d(eu, cam(loja, 'pedidos/ped-1'))));
  }
});

// ====================================================================== ISOLAMENTO ENTRE LOJAS
teste('ninguém da loja A lê dado privado da loja B nem da loja original', async () => {
  for (const papel of PAPEIS) for (const outra of ['loja-b', 'banca']) {
    const eu = de('loja-a', papel);
    for (const privado of ['pedidos/ped-1', 'cupons/DEZ', 'crm/contatos', 'equipe/u1', 'resumos/2026-10-01', 'analytics/dashboard', 'estoque_mov/m1', 'estoque_resumo/2026-10', 'producoes/l1', 'produtos_custos/p1',
      'fechamentos/2026-10-01', 'calendario/e1', 'loja/fotos', 'auditoria/a1']) await nega(getDoc(d(eu, cam(outra, privado))));
    for (const colecao of ['pedidos', 'cupons', 'crm', 'equipe', 'produtos_custos', 'fechamentos', 'calendario', 'estoque_mov']) await nega(getDocs(c(eu, cam(outra, colecao))));
  }
});

teste('ninguém da loja A grava, muda ou apaga NADA da loja B nem da loja original', async () => {
  for (const papel of PAPEIS) for (const outra of ['loja-b', 'banca']) {
    const eu = de('loja-a', papel);
    await nega(setDoc(d(eu, cam(outra, 'produtos/novo')), { nome: 'x', preco: 1 })); await nega(updateDoc(d(eu, cam(outra, 'produtos/p1')), { preco: 0.01 }));
    await nega(updateDoc(d(eu, cam(outra, 'produtos/p1')), { estoqueMin: 1 })); await nega(deleteDoc(d(eu, cam(outra, 'produtos/p1'))));
    await nega(setDoc(d(eu, cam(outra, 'produtos_custos/p1')), { custo: 1 })); await nega(setDoc(d(eu, cam(outra, 'categorias/x')), { nome: 'x' })); await nega(deleteDoc(d(eu, cam(outra, 'categorias/paes'))));
    await nega(setDoc(d(eu, cam(outra, 'loja/config')), { wpp: '5500000000000' }, { merge: true })); await nega(setDoc(d(eu, cam(outra, 'cupons/GRATIS')), { ativo: true, percentual: 100 }));
    await nega(updateDoc(d(eu, cam(outra, 'pedidos/ped-1')), { status: 'preparando' })); await nega(deleteDoc(d(eu, cam(outra, 'pedidos/ped-1'))));
    await nega(updateDoc(d(eu, `tenants/${outra}`), { nome: 'Invadida' })); await nega(updateDoc(d(eu, `tenants/${outra}`), { tema: TEMA }));
    await nega(setDoc(d(eu, cam(outra, 'fechamentos/2026-10-02')), { dia: '2026-10-02', atualizadoEm: 'x', itens: {} })); await nega(setDoc(d(eu, cam(outra, 'calendario/x')), { data: '2026-10-12' }));
    await nega(setDoc(d(eu, cam(outra, 'crm/contatos')), { c9: 'x' }, { merge: true }));
  }
  // e quem é da loja B faz o que é dela (prova de que o teste acima não passa "por acaso")
  const donoB = de('loja-b', 'proprietario');
  await pode(updateDoc(d(donoB, cam('loja-b', 'produtos/p1')), { preco: 6 })); await pode(getDoc(d(donoB, cam('loja-b', 'pedidos/ped-1')))); await pode(updateDoc(d(donoB, 'tenants/loja-b'), { nome: 'Loja B nova' }));
});

teste('papel de uma loja escrito de jeito torto não vale em outra (mapa vazio, lista, texto, loja "banca" sem papel)', async () => {
  const tortos = [conta('t1', { tenants: {} }), conta('t2', { tenants: ['proprietario'] }), conta('t3', { tenants: 'proprietario' }), conta('t4', { tenants: { 'loja-a': '' } }), conta('t5', { tenants: { 'loja-a': 'dono-de-tudo' } }),
    conta('t6', { tenants: { 'loja-a': true } }), conta('t7', { tenants: { 'loja-b': 'proprietario' } }), conta('t8', { admin: 'true' }), conta('t9', { plataforma: 'true' }), conta('t10', { plataforma: 1 })];
  for (const eu of tortos) {
    await nega(getDoc(d(eu, cam('loja-a', 'pedidos/ped-1')))); await nega(updateDoc(d(eu, cam('loja-a', 'produtos/p1')), { preco: 1 })); await nega(getDoc(d(eu, cam('loja-a', 'cupons/DEZ'))));
    await nega(getDoc(d(eu, 'pedidos/ped-1'))); await nega(updateDoc(d(eu, 'produtos/p1'), { preco: 1 }));
  }
});

// ====================================================================== PAPÉIS DENTRO DA PRÓPRIA LOJA
teste('quem administra (proprietário, administrador) cuida do cadastro, mas não do que é do servidor nem da plataforma', async () => {
  for (const loja of ['loja-a', 'banca']) for (const papel of ['proprietario', 'administrador']) {
    const eu = de(loja, papel);
    await pode(setDoc(d(eu, cam(loja, 'produtos/novo')), { nome: 'Bolo', preco: 12, unidade: 'un', ativo: true })); await pode(updateDoc(d(eu, cam(loja, 'produtos/p1')), { preco: 6, nome: 'Pão francês' }));
    await pode(deleteDoc(d(eu, cam(loja, 'produtos/novo')))); await pode(setDoc(d(eu, cam(loja, 'categorias/doces')), { chave: 'doces', nome: 'Doces', ordem: 2, visivel: true }));
    await pode(setDoc(d(eu, cam(loja, 'loja/config')), { minimo: 10 }, { merge: true })); await pode(setDoc(d(eu, cam(loja, 'loja/fotos')), { itens: [] }, { merge: true })); await pode(getDoc(d(eu, cam(loja, 'loja/fotos'))));
    await pode(setDoc(d(eu, cam(loja, 'cupons/NOVO')), { ativo: true, percentual: 5 })); await pode(deleteDoc(d(eu, cam(loja, 'cupons/NOVO')))); await pode(setDoc(d(eu, cam(loja, 'crm/contatos')), { c2: 'x' }, { merge: true }));
    await pode(setDoc(d(eu, cam(loja, 'calendario/novo')), { data: '2026-12-25', tipo: 'fechado', titulo: 'Natal' })); await pode(getDoc(d(eu, cam(loja, 'resumos/2026-10-01')))); await pode(getDoc(d(eu, cam(loja, 'equipe/u1'))));
    await pode(getDocs(c(eu, cam(loja, 'pedidos')))); await pode(getDoc(d(eu, cam(loja, 'produtos_custos/p1'))));
    // só o servidor: criar/apagar pedido, mexer em valor, caixa, previsão, histórico de estoque, equipe, nota média, trilha
    await nega(setDoc(d(eu, cam(loja, 'pedidos/falso')), { userId: 'x', total: 999, status: 'arquivado' })); await nega(deleteDoc(d(eu, cam(loja, 'pedidos/ped-1'))));
    await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { total: 0 })); await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { status: 'preparando', total: 0 }));
    await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { 'pagamento.status': 'PAID' })); await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { itens: [] }));
    await nega(setDoc(d(eu, cam(loja, 'resumos/2026-10-01')), { receita: 0 })); await nega(setDoc(d(eu, cam(loja, 'analytics/dashboard')), { receitaTotal: 0 })); await nega(setDoc(d(eu, cam(loja, 'estoque_mov/falso')), { delta: 99 }));
    await nega(setDoc(d(eu, cam(loja, 'equipe/eu')), { papel: 'proprietario' })); await nega(deleteDoc(d(eu, cam(loja, 'equipe/u1')))); await nega(setDoc(d(eu, cam(loja, 'loja/avaliacoes')), { soma: 500, n: 100, media: 5 }));
    await nega(getDoc(d(eu, cam(loja, 'auditoria/a1')))); await nega(deleteDoc(d(eu, cam(loja, 'auditoria/a1')))); await nega(setDoc(d(eu, cam(loja, 'producoes/x')), { lote: 'x' }));
    await nega(getDoc(d(eu, 'plataforma/segredos'))); await nega(getDoc(d(eu, `plataforma/maquininha_${loja}`))); await nega(getDoc(d(eu, `backups/${loja}_2026-10-01`)));
    // só a plataforma: ligar/desligar a loja, módulos, tipo, feira; criar ou apagar loja
    for (const campo of [{ ativo: false }, { modulos: { ia: true } }, { tipo: 'outro' }, { feiraId: 'feira-1' }, { feiras: ['feira-1'] }, { criadoEm: 'x' }, { campoNovo: 1 }]) await nega(updateDoc(d(eu, `tenants/${loja}`), campo));
    await nega(deleteDoc(d(eu, `tenants/${loja}`))); await nega(setDoc(d(eu, 'tenants/loja-nova'), { nome: 'Nova', ativo: true })); await nega(setDoc(d(eu, 'feiras/f2'), { nome: 'x', lojas: [] }));
  }
});

teste('funcionário e caixa atendem pedidos, mas não mexem em cadastro, cupom, clientes nem números da loja', async () => {
  for (const loja of ['loja-a', 'banca']) for (const papel of ['funcionario', 'caixa']) {
    const eu = de(loja, papel);
    const [qual, para] = papel === 'funcionario' ? ['ped-1', 'preparando'] : ['ped-2', 'enviado'];        // cada papel avança um pedido diferente
    await pode(getDocs(c(eu, cam(loja, 'pedidos')))); await pode(getDoc(d(eu, cam(loja, 'pedidos/ped-1')))); await pode(updateDoc(d(eu, cam(loja, `pedidos/${qual}`)), { status: para }));
    await pode(getDoc(d(eu, cam(loja, 'calendario/e1'))));
    await nega(updateDoc(d(eu, cam(loja, 'produtos/p1')), { preco: 0.01 })); await nega(updateDoc(d(eu, cam(loja, 'produtos/p1')), { estoqueMin: 1 })); await nega(deleteDoc(d(eu, cam(loja, 'produtos/p1'))));
    await nega(setDoc(d(eu, cam(loja, 'loja/config')), { wpp: '5500000000000' }, { merge: true })); await nega(getDoc(d(eu, cam(loja, 'cupons/DEZ')))); await nega(setDoc(d(eu, cam(loja, 'cupons/MEU')), { ativo: true, percentual: 100 }));
    await nega(getDoc(d(eu, cam(loja, 'crm/contatos')))); await nega(getDoc(d(eu, cam(loja, 'resumos/2026-10-01')))); await nega(getDoc(d(eu, cam(loja, 'analytics/dashboard')))); await nega(getDoc(d(eu, cam(loja, 'equipe/u1'))));
    await nega(getDoc(d(eu, cam(loja, 'produtos_custos/p1')))); await nega(getDoc(d(eu, cam(loja, 'estoque_mov/m1')))); await nega(getDoc(d(eu, cam(loja, 'loja/fotos')))); await nega(setDoc(d(eu, cam(loja, 'calendario/x')), { data: 'x' }));
    await nega(updateDoc(d(eu, `tenants/${loja}`), { nome: 'Outro nome' }));
  }
  // fechamento da feira: funcionário sim, caixa não
  await pode(getDoc(d(de('loja-a', 'funcionario'), cam('loja-a', 'fechamentos/2026-10-01')))); await nega(getDoc(d(de('loja-a', 'caixa'), cam('loja-a', 'fechamentos/2026-10-01'))));
  await nega(setDoc(d(de('loja-a', 'caixa'), cam('loja-a', 'fechamentos/2026-10-03')), { dia: '2026-10-03', atualizadoEm: 'x', itens: {} }));
});

teste('estoque e produção não veem pedidos (nome, telefone e endereço de cliente) e só mexem nos limites e nos custos', async () => {
  for (const loja of ['loja-a', 'banca']) for (const papel of ['estoque', 'producao']) {
    const eu = de(loja, papel);
    await nega(getDoc(d(eu, cam(loja, 'pedidos/ped-1')))); await nega(getDocs(c(eu, cam(loja, 'pedidos')))); await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { status: 'preparando' }));
    await nega(getDoc(d(eu, cam(loja, 'cupons/DEZ')))); await nega(getDoc(d(eu, cam(loja, 'crm/contatos')))); await nega(getDoc(d(eu, cam(loja, 'resumos/2026-10-01')))); await nega(getDoc(d(eu, cam(loja, 'equipe/u1'))));
    await pode(getDoc(d(eu, cam(loja, 'produtos_custos/p1')))); await pode(getDoc(d(eu, cam(loja, 'estoque_mov/m1')))); await pode(getDoc(d(eu, cam(loja, 'estoque_resumo/2026-10')))); await pode(getDoc(d(eu, cam(loja, 'producoes/l1'))));
    // limites do produto: número (ou vazio) passa
    await pode(setDoc(d(eu, cam(loja, 'produtos/p1')), { estoqueMin: 3, estoqueIdeal: 10, estoqueMax: null, prazoDias: 2 }, { merge: true }));
    // ...texto (era por aqui que um funcionário do estoque plantava código para rodar na tela do dono) não passa
    for (const campo of ['estoqueMin', 'estoqueIdeal', 'estoqueMax', 'prazoDias']) {
      await nega(updateDoc(d(eu, cam(loja, 'produtos/p1')), { [campo]: VENENO })); await nega(updateDoc(d(eu, cam(loja, 'produtos/p1')), { [campo]: { x: 1 } })); await nega(updateDoc(d(eu, cam(loja, 'produtos/p1')), { [campo]: -1 }));
    }
    // ...e nada além dos limites
    for (const campo of [{ preco: 0.01 }, { nome: 'x' }, { estoqueFisico: 999 }, { ativo: false }, { foto: 'https://x' }, { estoqueMin: 1, preco: 0.01 }, { descricao: VENENO }]) await nega(updateDoc(d(eu, cam(loja, 'produtos/p1')), campo));
    await nega(setDoc(d(eu, cam(loja, 'produtos/novo')), { nome: 'x', preco: 1 })); await nega(deleteDoc(d(eu, cam(loja, 'produtos/p1'))));
    // custo e ficha técnica: só no formato certo
    await pode(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { custo: 3.2 }, { merge: true })); await pode(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { custo: null }, { merge: true }));
    await pode(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { ficha: { rende: 12, validadeDias: null, itens: [{ id: 'p2', qtd: 0.5 }] } }, { merge: true })); await pode(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { ficha: null }, { merge: true }));
    await pode(setDoc(d(eu, cam(loja, 'produtos_custos/novo')), { custo: 1 }));
    await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { custo: VENENO }, { merge: true })); await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { custo: -3 }, { merge: true }));
    await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { ficha: { rende: VENENO, itens: [] } }, { merge: true })); await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { ficha: { rende: 10, validadeDias: VENENO, itens: [] } }, { merge: true }));
    await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { ficha: { rende: 10, itens: VENENO } }, { merge: true })); await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { ficha: VENENO }, { merge: true }));
    await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { ficha: { rende: 10, itens: [], extra: VENENO } })); await nega(setDoc(d(eu, cam(loja, 'produtos_custos/p1')), { outroCampo: VENENO }, { merge: true }));
    await nega(setDoc(d(eu, cam(loja, 'produtos_custos/novo2')), { custo: 1, extra: VENENO })); await nega(deleteDoc(d(eu, cam(loja, 'produtos_custos/p1'))));
  }
  // fechamento da feira: estoque sim (com o formato certo), produção não
  const est = de('loja-a', 'estoque');
  await pode(setDoc(d(est, cam('loja-a', 'fechamentos/2026-10-05')), { dia: '2026-10-05', atualizadoEm: '2026-10-05T12:00:00Z', itens: { p1: { tem: true, obs: '', nome: 'Pão', cat: 'paes' } } }, { merge: true }));
  await pode(setDoc(d(est, cam('loja-a', 'fechamentos/2026-10-01')), { dia: '2026-10-01', atualizadoEm: 'y', itens: { p1: { tem: false } } }, { merge: true }));
  await nega(setDoc(d(est, cam('loja-a', 'fechamentos/qualquer-nome')), { dia: 'qualquer-nome', atualizadoEm: 'x', itens: {} })); await nega(setDoc(d(est, cam('loja-a', 'fechamentos/2026-10-06')), { dia: '2026-10-07', atualizadoEm: 'x', itens: {} }));
  await nega(setDoc(d(est, cam('loja-a', 'fechamentos/2026-10-06')), { dia: '2026-10-06', atualizadoEm: 'x', itens: {}, extra: VENENO })); await nega(setDoc(d(est, cam('loja-a', 'fechamentos/2026-10-06')), { dia: '2026-10-06', atualizadoEm: 'x', itens: VENENO }));
  await nega(deleteDoc(d(est, cam('loja-a', 'fechamentos/2026-10-01')))); await nega(getDoc(d(de('loja-a', 'producao'), cam('loja-a', 'fechamentos/2026-10-01'))));
});

// ====================================================================== PEDIDO: MÁQUINA DE ESTADOS
teste('status do pedido só anda para frente; "cancelado" é só do servidor e pedido encerrado não volta', async () => {
  for (const loja of ['loja-a', 'banca']) {
    await semear();
    const eu = de(loja, 'caixa'), ped = (id) => d(eu, cam(loja, `pedidos/${id}`));
    // proibidos
    await nega(updateDoc(ped('ped-1'), { status: 'cancelado' }));                  // cancelar por fora não devolve estoque
    await nega(updateDoc(ped('ped-cancelado'), { status: 'pendente' }));           // reabrir cancelado (era o começo do golpe do estoque em dobro)
    await nega(updateDoc(ped('ped-cancelado'), { status: 'arquivado' })); await nega(updateDoc(ped('ped-arquivado'), { status: 'pendente' })); await nega(updateDoc(ped('ped-arquivado'), { status: 'enviado' }));
    await nega(updateDoc(ped('ped-enviado'), { status: 'preparando' })); await nega(updateDoc(ped('ped-2'), { status: 'pendente' })); await nega(updateDoc(ped('ped-2'), { status: 'aguardando_pagamento' }));
    await nega(updateDoc(ped('ped-1'), { status: 'aguardando_pagamento' })); await nega(updateDoc(ped('ped-1'), { status: 'pendente' }));
    for (const lixo of ['pago', 'PAID', '', 'entregue', VENENO, 5, null, true, { x: 1 }, ['preparando']]) await nega(updateDoc(ped('ped-1'), { status: lixo }));
    await nega(updateDoc(ped('ped-1'), { status: 'preparando', total: 1 })); await nega(updateDoc(ped('ped-1'), { status: 'preparando', estornadoEm: null }));
    // permitidos (o caminho normal do painel)
    await pode(updateDoc(ped('ped-1'), { status: 'preparando' })); await pode(updateDoc(ped('ped-1'), { status: 'enviado' })); await pode(updateDoc(ped('ped-1'), { status: 'arquivado' }));
    await pode(updateDoc(ped('ped-pix'), { status: 'preparando' }));                // "Recebi o PIX"
    await pode(setDoc(ped('ped-2'), { status: 'arquivado' }, { merge: true }));     // "Concluir e arquivar" direto
    // lote do "arquivar tudo"
    await semear(); const lote = writeBatch(bancoDe(eu));
    for (const id of ['ped-1', 'ped-2', 'ped-enviado', 'ped-pix']) lote.update(ped(id), { status: 'arquivado' });
    await pode(lote.commit());
  }
});

// ====================================================================== APARÊNCIA
teste('aparência da loja: só nome de verdade, texto curto e cor no formato #rrggbb', async () => {
  for (const loja of ['loja-a', 'banca']) {
    await semear();
    const eu = de(loja, 'administrador'), ficha = d(eu, `tenants/${loja}`);
    await pode(setDoc(ficha, { nome: 'Banca do Zé', subtitulo: 'Na brasa', tema: { ...TEMA, primaria: '#B3261E', raio: 8, fotoFormato: 'alta', fotoEncaixe: 'inteira' }, atualizadoEm: 1 }, { merge: true }));
    for (const cor of [VENENO, 'red', '#fff', '#12345g', 'url(//x)', '#123456;x', 123456, null, ['#123456']]) await nega(setDoc(ficha, { tema: { primaria: cor } }, { merge: true }));
    for (const campo of ['secundaria', 'destaque', 'fundo', 'superficie', 'texto', 'sobrePrimaria']) await nega(setDoc(ficha, { tema: { [campo]: VENENO } }, { merge: true }));
    await nega(setDoc(ficha, { tema: { raio: VENENO } }, { merge: true })); await nega(setDoc(ficha, { tema: { raio: 999 } }, { merge: true })); await nega(setDoc(ficha, { tema: { fonteTitulo: 'x'.repeat(41) } }, { merge: true }));
    await nega(setDoc(ficha, { tema: { fonteTexto: { x: 1 } } }, { merge: true })); await nega(updateDoc(ficha, { tema: VENENO })); await nega(updateDoc(ficha, { tema: [VENENO] }));
    // nome vazio fazia a loja aparecer com o nome e a cara da Banca original
    for (const nome of ['', 'a', 'x'.repeat(61), 5, null, { x: 1 }]) await nega(updateDoc(ficha, { nome }));
    await nega(updateDoc(ficha, { subtitulo: 'x'.repeat(121) })); await nega(updateDoc(ficha, { subtitulo: 5 })); await nega(updateDoc(ficha, { nota: 'x'.repeat(201) })); await nega(updateDoc(ficha, { busca: ['x'] }));
  }
});

// ====================================================================== CONTAS ESPECIAIS
teste('conta com e-mail NÃO confirmado não tem papel nenhum, mesmo com o papel escrito no login', async () => {
  const falsos = [env.authenticatedContext('f1', { email: 'dono@loja.com', email_verified: false, tenants: { 'loja-a': 'proprietario' } }), env.authenticatedContext('f2', { email: 'x@x', email_verified: false, plataforma: true }),
    env.authenticatedContext('f3', { email: 'x@x', email_verified: false, admin: true }), env.authenticatedContext('f4', { tenants: { 'loja-a': 'proprietario' }, plataforma: true, admin: true })];
  for (const eu of falsos) {
    await nega(getDoc(d(eu, cam('loja-a', 'pedidos/ped-1')))); await nega(getDocs(c(eu, cam('loja-a', 'pedidos')))); await nega(updateDoc(d(eu, cam('loja-a', 'produtos/p1')), { preco: 0.01 }));
    await nega(getDoc(d(eu, 'pedidos/ped-1'))); await nega(updateDoc(d(eu, 'produtos/p1'), { preco: 0.01 })); await nega(updateDoc(d(eu, 'tenants/loja-a'), { ativo: false })); await nega(setDoc(d(eu, 'tenants/nova'), { nome: 'x' }));
  }
});

teste('conta antiga (admin: true) é dona só da loja original', async () => {
  const eu = donaAntiga();
  await pode(updateDoc(d(eu, 'produtos/p1'), { preco: 7 })); await pode(getDocs(c(eu, 'pedidos'))); await pode(updateDoc(d(eu, 'pedidos/ped-1'), { status: 'preparando' })); await pode(getDoc(d(eu, 'cupons/DEZ')));
  await pode(setDoc(d(eu, 'tenants/banca'), { nome: 'Banca Adair e Pedrina', tema: TEMA, atualizadoEm: 2 }, { merge: true }));
  await nega(updateDoc(d(eu, 'tenants/banca'), { ativo: false })); await nega(updateDoc(d(eu, 'tenants/banca'), { modulos: { ia: true } }));
  await nega(updateDoc(d(eu, cam('loja-a', 'produtos/p1')), { preco: 7 })); await nega(getDocs(c(eu, cam('loja-a', 'pedidos')))); await nega(updateDoc(d(eu, 'tenants/loja-a'), { nome: 'Minha agora' }));
  await nega(setDoc(d(eu, 'tenants/loja-nova'), { nome: 'Nova' })); await nega(getDoc(d(eu, 'plataforma/segredos'))); await nega(setDoc(d(eu, 'plataforma/dono'), { uid: 'dona-antiga' }));
  // loja original ainda sem ficha: a dona cria a dela, só com os campos de aparência
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'tenants/banca')));
  await nega(setDoc(d(eu, 'tenants/banca'), { nome: 'Banca', ativo: true, modulos: { ia: true } })); await nega(setDoc(d(eu, 'tenants/banca'), { nome: 'Banca', tema: { primaria: VENENO } }));
  await pode(setDoc(d(eu, 'tenants/banca'), { nome: 'Banca Adair e Pedrina', subtitulo: 'x', tema: TEMA, atualizadoEm: 3 }));
});

teste('dono da plataforma cuida de todas as lojas, mas segredos, pedidos novos e trilha continuam só do servidor', async () => {
  const eu = plataforma();
  for (const loja of ['banca', 'loja-a', 'loja-b']) {
    await pode(getDocs(c(eu, cam(loja, 'pedidos')))); await pode(updateDoc(d(eu, cam(loja, 'produtos/p1')), { preco: 8 })); await pode(updateDoc(d(eu, `tenants/${loja}`), { ativo: false, modulos: { ia: true } }));
    await pode(getDoc(d(eu, cam(loja, 'resumos/2026-10-01')))); await pode(getDoc(d(eu, cam(loja, 'equipe/u1'))));
    await nega(setDoc(d(eu, cam(loja, 'pedidos/falso')), { total: 1, status: 'arquivado' })); await nega(deleteDoc(d(eu, cam(loja, 'pedidos/ped-1')))); await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-1')), { total: 0 }));
    await nega(updateDoc(d(eu, cam(loja, 'pedidos/ped-cancelado')), { status: 'pendente' })); await nega(setDoc(d(eu, cam(loja, 'equipe/eu')), { papel: 'proprietario' })); await nega(setDoc(d(eu, cam(loja, 'resumos/2026-10-01')), { receita: 0 }));
    await nega(getDoc(d(eu, cam(loja, 'auditoria/a1')))); await nega(deleteDoc(d(eu, cam(loja, 'auditoria/a1'))));
  }
  await pode(setDoc(d(eu, 'tenants/loja-c'), { nome: 'Loja C', ativo: true })); await pode(setDoc(d(eu, 'feiras/f9'), { nome: 'Feira', lojas: [] }));
  for (const servidor of ['plataforma/segredos', 'plataforma/maquininha_loja-a', 'backups/loja-a_2026-10-01', 'limites/pedido_x', 'auditoria_plataforma/a1']) { await nega(getDoc(d(eu, servidor))); await nega(setDoc(d(eu, servidor), { x: 1 })); await nega(deleteDoc(d(eu, servidor))); }
});

// ====================================================================== ARMAZENAMENTO (fotos)
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const arq = (ctx, caminho) => ref(gavetaDe(ctx), caminho);
teste('fotos: qualquer um vê pelo link; só quem administra a loja envia, e só JPG, PNG ou WebP de até 2 MB', async () => {
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const g = ctx.storage();
    await uploadBytes(ref(g, 'tenants/loja-a/fotos_produtos/existente.png'), png(), { contentType: 'image/png' });
    await uploadBytes(ref(g, 'tenants/loja-b/fotos_produtos/existente.png'), png(), { contentType: 'image/png' });
    await uploadBytes(ref(g, 'fotos_produtos/existente.png'), png(), { contentType: 'image/png' });
    await uploadBytes(ref(g, 'segredos/arquivo.txt'), png(), { contentType: 'text/plain' });
  });
  const visitante = anonimo(), dono = de('loja-a', 'proprietario'), admin = de('loja-a', 'administrador');
  // ver pelo link: sim. Listar a pasta: não (nem a loja vizinha).
  await pode(getBytes(arq(visitante, 'tenants/loja-a/fotos_produtos/existente.png'))); await pode(getBytes(arq(visitante, 'fotos_produtos/existente.png')));
  await nega(listAll(arq(visitante, 'tenants/loja-a/fotos_produtos'))); await nega(listAll(arq(visitante, 'fotos_produtos'))); await nega(listAll(arq(dono, 'tenants/loja-b/fotos_produtos')));
  await nega(getBytes(arq(visitante, 'segredos/arquivo.txt'))); await nega(getBytes(arq(dono, 'segredos/arquivo.txt')));
  await pode(listAll(arq(dono, 'tenants/loja-a/fotos_produtos')));
  // enviar: só gestor da própria loja
  await pode(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/p1-abc.png'), png(), { contentType: 'image/png' })); await pode(uploadBytes(arq(admin, 'tenants/loja-a/fotos_produtos/p1-abc-m.webp'), png(), { contentType: 'image/webp' }));
  await pode(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/banco-xyz.jpg'), png(), { contentType: 'image/jpeg' }));
  for (const quem of [visitante, cliente(), de('loja-a', 'funcionario'), de('loja-a', 'caixa'), de('loja-a', 'estoque'), de('loja-a', 'producao'), de('loja-b', 'proprietario'), donaAntiga(),
    env.authenticatedContext('falso', { email: 'x@x', email_verified: false, tenants: { 'loja-a': 'proprietario' } })]) await nega(uploadBytes(arq(quem, 'tenants/loja-a/fotos_produtos/invasor.png'), png(), { contentType: 'image/png' }));
  await nega(uploadBytes(arq(dono, 'tenants/loja-b/fotos_produtos/invasor.png'), png(), { contentType: 'image/png' })); await nega(uploadBytes(arq(dono, 'fotos_produtos/invasor.png'), png(), { contentType: 'image/png' }));
  // tipo e nome do arquivo
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/desenho.svg'), png(), { contentType: 'image/svg+xml' }));          // SVG pode carregar código
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/disfarce.png'), png(), { contentType: 'image/svg+xml' })); await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/disfarce.svg'), png(), { contentType: 'image/png' }));
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/pagina.html'), png(), { contentType: 'text/html' })); await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/pagina.png'), png(), { contentType: 'text/html' }));
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/programa.exe'), png(), { contentType: 'application/octet-stream' })); await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/sem-extensao'), png(), { contentType: 'image/png' }));
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/animado.gif'), png(), { contentType: 'image/gif' }));
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/gigante.png'), new Uint8Array(2 * 1024 * 1024 + 10), { contentType: 'image/png' }));
  // fora da pasta de fotos, ou em subpasta: negado
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/outra-pasta/x.png'), png(), { contentType: 'image/png' })); await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/sub/x.png'), png(), { contentType: 'image/png' }));
  await nega(uploadBytes(arq(dono, 'x.png'), png(), { contentType: 'image/png' }));
  // trocar o conteúdo de um link que já está na vitrine: negado. Apagar: só gestor.
  await nega(uploadBytes(arq(dono, 'tenants/loja-a/fotos_produtos/existente.png'), png(), { contentType: 'image/png' }));
  await nega(deleteObject(arq(de('loja-a', 'caixa'), 'tenants/loja-a/fotos_produtos/existente.png'))); await nega(deleteObject(arq(dono, 'tenants/loja-b/fotos_produtos/existente.png'))); await nega(deleteObject(arq(visitante, 'fotos_produtos/existente.png')));
  await pode(deleteObject(arq(dono, 'tenants/loja-a/fotos_produtos/existente.png')));
  // loja original: a conta antiga e a plataforma
  await pode(uploadBytes(arq(donaAntiga(), 'fotos_produtos/tomate-1.webp'), png(), { contentType: 'image/webp' })); await pode(uploadBytes(arq(plataforma(), 'tenants/loja-b/fotos_produtos/x-1.jpg'), png(), { contentType: 'image/jpeg' }));
  await pode(uploadBytes(arq(de('banca', 'administrador'), 'fotos_produtos/ovo-1.png'), png(), { contentType: 'image/png' })); await nega(uploadBytes(arq(de('banca', 'estoque'), 'fotos_produtos/ovo-2.png'), png(), { contentType: 'image/png' }));
});

(async () => {
  setLogLevel('silent');
  env = await initializeTestEnvironment({
    projectId: 'demo-banca',
    firestore: { rules: fs.readFileSync(raiz('firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(raiz('storage.rules'), 'utf8') },
  });
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await semear(); await fn(); console.log('  ok   ', nome); }
    catch (e) { falhas++; console.log('  FALHOU', nome, '\n        ', String((e && e.stack) || e).split('\n').slice(0, 8).join('\n         ')); }
  }
  await env.cleanup();
  console.log(`\n${testes.length - falhas} de ${testes.length} testes das regras passaram.`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('Não consegui rodar os testes das regras:', e); process.exit(1); });
