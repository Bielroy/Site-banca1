'use strict';
// =====================================================================
//  server/ver-condominios.js — COMO CADA CONDOMÍNIO FUNCIONA E QUANTO ELE PEDE (rodar no servidor da AWS).
//      docker exec loja node server/ver-condominios.js              últimos 90 dias, todas as lojas
//      docker exec loja node server/ver-condominios.js 60           últimos 60 dias
//      docker exec loja node server/ver-condominios.js 90 nome-loja só uma loja
//  Não grava nada. Não abre dado pessoal (nome, telefone, endereço ficam cifrados e nem são lidos):
//  usa só condomínio, dia, valor, taxa, modo (entrega/retirada) e o código do cliente.
//
//  Para cada FEIRA: dias de entrega e condomínios. Para cada CONDOMÍNIO: quantos pedidos, quantos clientes,
//  ticket médio, taxa cobrada, entrega x retirada, e a pergunta que importa para "entrega fora do dia":
//  quantos pedidos foram feitos EM DIAS SEM ENTREGA (o cliente quis e teve que esperar a próxima).
// =====================================================================
const admin = require('firebase-admin');

const chavePrivada = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dinheiro = (n) => `R$ ${(Number(n) || 0).toFixed(2).replace('.', ',')}`;
const dowBR = (iso) => new Date(Date.parse(iso) - 3 * 3600000).getUTCDay();   // dia da semana em Brasília
const dowDia = (dia) => new Date(`${dia}T12:00:00Z`).getUTCDay();

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function principal() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: chavePrivada(process.env.FIREBASE_PRIVATE_KEY) }) });
  const db = admin.firestore();
  const dias = Math.min(365, Math.max(7, parseInt(process.argv[2], 10) || 90));
  const so = process.argv[3];
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  // ---- feiras: dias de entrega e condomínios atendidos
  const feiras = {};
  (await db.collection('feiras').get()).docs.forEach((d) => { feiras[d.id] = { id: d.id, ...d.data() }; });
  console.log(`\n##### FEIRAS (${Object.keys(feiras).length}) #####`);
  for (const f of Object.values(feiras)) {
    const nomes = (Array.isArray(f.conds) && f.conds.length ? f.conds.map((c) => c.nome) : f.condominios) || [];
    console.log(`- ${f.nome || f.id}: dias ${(f.dias || []).map((d) => DIAS[d]).join(', ') || '(todos)'} · limite ${f.horaLimite || '-'} · lojas ${(f.lojas || []).map((l) => l.id).join(', ') || '-'}`);
    console.log(`  condomínios: ${nomes.join(' | ') || '(nenhum)'}`);
  }

  const lojas = so ? [{ id: so }] : [{ id: 'banca' }, ...(await db.collection('tenants').select().get()).docs.map((d) => ({ id: d.id }))];
  for (const l of lojas) {
    const raiz = l.id === 'banca' ? db : db.collection('tenants').doc(l.id);
    const cfg = (await raiz.doc('loja/config').get()).data() || {};
    const ent = cfg.entrega || {};
    const peds = (await raiz.collection('pedidos').where('data', '>=', desde).select('data', 'entregaDia', 'total', 'clientTotal', 'status', 'condominio', 'condominioId', 'clienteId', 'userId', 'modo', 'feiraId', 'entrega', 'origem').get()).docs.map((d) => d.data());
    const validos = peds.filter((p) => p.status !== 'cancelado' && p.origem !== 'balcao');
    if (!validos.length && !ent.taxa) continue;

    console.log(`\n=================== LOJA ${l.id} — últimos ${dias} dias ===================`);
    console.log(`Regra de entrega: taxa ${dinheiro(ent.taxa)} (única, igual para todos os condomínios) · grátis acima de ${ent.gratisAcima ? dinheiro(ent.gratisAcima) : '(não tem)'}`);
    if (ent.retirada && ent.retirada.ativa) console.log(`Retirada: ligada${ent.retirada.local ? ` · local: ${ent.retirada.local}` : ''}`);
    for (const a of Array.isArray(ent.agenda) ? ent.agenda : []) {
      console.log(`  agenda ${a.feira || '(todas)'} · ${DIAS[a.dia]}: entrega ${a.entrega === false ? 'NÃO' : 'sim'}${a.retirada ? ' · retirada sim' : ''}${a.local ? ` · local ${a.local}` : ''}`);
    }
    console.log(`Pedidos válidos: ${validos.length} (de ${peds.length}, sem cancelados nem balcão)`);

    // ---- agrupa por condomínio
    const porCondo = new Map();
    for (const p of validos) {
      const nome = (p.condominio || '').trim() || (p.modo === 'retirada' ? '(retirada, sem condomínio)' : '(sem condomínio)');
      const chave = normalizar(nome);
      if (!porCondo.has(chave)) porCondo.set(chave, { nome, ped: [] });
      porCondo.get(chave).ped.push(p);
    }
    const linhas = [...porCondo.values()].sort((a, b) => b.ped.length - a.ped.length);
    for (const c of linhas) {
      const ps = c.ped, n = ps.length;
      const total = ps.reduce((s, p) => s + (Number(p.total) || Number(p.clientTotal) || 0), 0);
      const entregas = ps.filter((p) => p.modo !== 'retirada');
      const taxas = entregas.map((p) => Number(p.entrega && p.entrega.taxa) || 0);
      const comTaxa = taxas.filter((t) => t > 0).length;
      const clientes = new Map();
      for (const p of ps) { const k = p.clienteId || p.userId || '?'; clientes.set(k, (clientes.get(k) || 0) + 1); }
      const repetem = [...clientes.values()].filter((v) => v > 1).length;
      const porDiaPedido = Array(7).fill(0), porDiaEntrega = Array(7).fill(0);
      let feitosForaDoDia = 0, comFeira = 0;
      for (const p of ps) {
        porDiaPedido[dowBR(p.data)]++;
        if (p.entregaDia) porDiaEntrega[dowDia(p.entregaDia)]++;
        const f = p.feiraId && feiras[p.feiraId];
        if (f && Array.isArray(f.dias) && f.dias.length) { comFeira++; if (!f.dias.includes(dowBR(p.data))) feitosForaDoDia++; }
      }
      const semanas = Math.max(1, dias / 7);
      console.log(`\n▸ ${c.nome}`);
      console.log(`  ${n} pedidos (${(n / semanas).toFixed(1)}/semana) · ${clientes.size} clientes (${repetem} pediram mais de 1 vez) · ticket médio ${dinheiro(total / n)} · total ${dinheiro(total)}`);
      console.log(`  entrega ${entregas.length} · retirada ${n - entregas.length} · entregas com taxa cobrada ${comTaxa}/${entregas.length} (taxa média ${dinheiro(entregas.length ? taxas.reduce((s, t) => s + t, 0) / entregas.length : 0)})`);
      console.log(`  dia em que o cliente FEZ o pedido: ${DIAS.map((d, i) => `${d} ${porDiaPedido[i]}`).join(' · ')}`);
      console.log(`  dia PARA o qual foi marcado:       ${DIAS.map((d, i) => `${d} ${porDiaEntrega[i]}`).join(' · ')}`);
      if (comFeira) console.log(`  pediu num dia SEM entrega (esperou a próxima): ${feitosForaDoDia} de ${comFeira} (${Math.round((feitosForaDoDia / comFeira) * 100)}%)`);
    }
  }
  console.log('\nPronto. (nada foi gravado)');
}

principal().catch((e) => { console.error('Parou com erro:', (e && e.message) || e); process.exitCode = 1; });
