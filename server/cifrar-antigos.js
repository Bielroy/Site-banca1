'use strict';
// =====================================================================
//  server/cifrar-antigos.js — CIFRA OS DADOS DE CLIENTE QUE JÁ ESTAVAM NO BANCO.
//
//  Pedidos e contas novos já nascem cifrados (lib/cofre.js). Este script passa
//  pelos ANTIGOS, de todas as lojas, e cifra nome, telefone, endereço e
//  observação. Depois recalcula a previsão de cada loja, que regrava a lista
//  de clientes já cifrada. Pode rodar mais de uma vez: o que já está cifrado fica como está.
//
//  No servidor (o contêiner precisa estar com a DADOS_CHAVE):
//     docker exec loja node server/cifrar-antigos.js            → só CONTA o que falta (não muda nada)
//     docker exec loja node server/cifrar-antigos.js --gravar   → cifra de verdade
// =====================================================================
const admin = require('firebase-admin');
const Store = require('../analytics/store');
const T = require('../lib/tenant');
const Cofre = require('../lib/cofre');

const GRAVAR = process.argv.includes('--gravar');
const COLECOES = ['pedidos', 'contas', 'analytics_clientes'];

async function cifrarColecao(db, tid, nome) {
  const col = T.tcol(db, tid, nome), idCampo = admin.firestore.FieldPath.documentId();
  let ultimo = null, total = 0, faltam = 0;
  for (;;) {
    let q = col.orderBy(idCampo).limit(300);
    if (ultimo) q = q.startAfter(ultimo);
    const s = await q.get();
    if (s.empty) break;
    const lote = db.batch(); let n = 0;
    for (const d of s.docs) {
      total++;
      const dados = d.data(), novo = Cofre.fecharCampos(dados, tid), patch = {};
      for (const c of Cofre.CAMPOS) if (c in dados && novo[c] !== dados[c]) patch[c] = novo[c];
      if (!Object.keys(patch).length) continue;
      faltam++;
      if (GRAVAR) { lote.update(d.ref, patch); n++; }
    }
    if (n) await lote.commit();
    ultimo = s.docs[s.docs.length - 1];
  }
  return { total, faltam };
}

async function main() {
  if (!Cofre.ligado()) { console.error('Falta a DADOS_CHAVE neste servidor. Nada foi feito.'); process.exit(1); }
  const db = Store.obterDb();
  const lojas = [...new Set([T.TENANT_PADRAO, ...(await db.collection('tenants').get()).docs.map((d) => d.id).filter(T.idValido)])];
  console.log(GRAVAR ? 'Cifrando os dados antigos...' : 'Só contando (nada vai mudar). Para cifrar, rode de novo com --gravar.');
  for (const tid of lojas) {
    for (const nome of COLECOES) {
      const r = await cifrarColecao(db, tid, nome);
      if (r.total) console.log(`  ${tid} · ${nome}: ${r.total} registros, ${r.faltam} ${GRAVAR ? 'cifrados agora' : 'ainda sem cifra'}`);
    }
    if (GRAVAR) {
      try { await Store.recalcular(T.escopo(db, tid), { forcar: true }); console.log(`  ${tid} · previsão recalculada (lista de clientes cifrada)`); }
      catch (e) { console.log(`  ${tid} · previsão não recalculada agora (${String(e && e.message).slice(0, 80)}). Toque em Recalcular na aba Previsão.`); }
    }
  }
  console.log(GRAVAR ? 'Pronto.' : 'Fim da contagem.');
  process.exit(0);
}

main().catch((e) => { console.error('Erro:', e && e.message); process.exit(1); });
