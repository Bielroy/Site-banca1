// =====================================================================
//  /api/estoque.js — entrada, compra, perda, saída e contagem de estoque.
//
//  POST { acao: 'movimentar', produtoId, tipo, qtd | contagem, motivo, obs, custoUnit, chave }
//    tipo: entrada | compra | perda | saida | ajuste (contagem)
//    chave: id único gerado pelo painel — se o mesmo toque chegar duas vezes
//           (internet ruim), a segunda vez não movimenta de novo.
//
//  Só a equipe DA LOJA com papel de proprietário, administrador, estoque ou
//  produção. O produto e o histórico mudam juntos, numa transação.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const E = require('../lib/estoque');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  }
  if (!db) db = admin.firestore();
};

const H = require('../lib/http');
const cors = H.cors;            // origem (CORS): lista única em lib/http.js

const texto = (v, max) => String(v == null ? '' : v).normalize('NFC').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const PODEM = ['proprietario', 'administrador', 'estoque', 'producao'];

// freio por pessoa: no máximo 40 movimentações por minuto
const passou = (uid) => H.passouNaMemoria(`estoque:${uid}`, 40, 60000);
const P = require('../lib/prudencia');

// ---------------------------------------------------------------------
// PRODUÇÃO: "produzi 20 unidades". Numa transação só:
//   baixa os ingredientes da ficha técnica · soma o produto pronto ao estoque ·
//   grava o lote, a validade e o custo · atualiza o custo do produto.
// Se faltar ingrediente, nada é gravado e a resposta diz o que falta.
// ---------------------------------------------------------------------
async function produzir(req, res, { tid, dec, produtoId, chave, unidades }) {
  if (!chave) return res.status(400).json({ error: 'Chave obrigatória.' });
  if (!Number.isInteger(unidades) || unidades < 1 || unidades > 10000) return res.status(400).json({ error: 'Informe quantas unidades produziu (número inteiro).' });
  try {
    const saida = await db.runTransaction(async (t) => {
      const prodRef = T.tdoc(db, tid, 'produtos', produtoId), regRef = T.tdoc(db, tid, 'producoes', chave), contRef = T.docDe(db, tid, 'estoque_meta/lotes'), privRef = T.tdoc(db, tid, 'produtos_custos', produtoId);
      const [prodSnap, regSnap, contSnap, privSnap] = await Promise.all([t.get(prodRef), t.get(regRef), t.get(contRef), t.get(privRef)]);
      if (regSnap.exists) return { repetido: true, ...regSnap.data() };
      if (!prodSnap.exists) throw new Error('Produto não encontrado.');
      // a ficha técnica e os custos ficam em produtos_custos (privado), não no produto público
      const p = { ...prodSnap.data(), ficha: privSnap.exists ? privSnap.data().ficha : null }, itens = (p.ficha && Array.isArray(p.ficha.itens) ? p.ficha.itens : []).slice(0, 40);
      if (itens.some((i) => !/^[\w-]{1,80}$/.test(String(i.id)) || String(i.id) === produtoId)) throw new Error('A ficha técnica deste produto tem um ingrediente inválido.');
      const [ingSnaps, ingCustos] = await Promise.all([Promise.all(itens.map((i) => t.get(T.tdoc(db, tid, 'produtos', i.id)))), Promise.all(itens.map((i) => t.get(T.tdoc(db, tid, 'produtos_custos', i.id))))]);
      const mapa = new Map(ingSnaps.map((s, n) => [s, ingCustos[n]]).filter(([s]) => s.exists).map(([s, c]) => [s.id, { ...s.data(), custo: c.exists ? c.data().custo : null }]));
      const c = E.custoDaFicha(p.ficha, mapa);
      if (!c.valida) throw new Error('Este produto não tem ficha técnica completa. Abra "Ficha" e confira os ingredientes.');

      const fator = unidades / c.rende, movs = [], usados = [], faltas = [];
      c.linhas.forEach((l) => {
        const ing = mapa.get(l.id), precisa = E.fix(l.qtd * fator);
        usados.push({ id: l.id, nome: l.nome, unidade: l.unidade, qtd: precisa, custo: l.custo });
        if (!E.temControle(ing.estoqueFisico)) return;                       // ingrediente sem estoque controlado: só registra o uso
        const novo = E.fix(Number(ing.estoqueFisico) - precisa);
        if (novo < 0) { faltas.push(`${l.nome}: precisa de ${String(precisa).replace('.', ',')} ${l.unidade}, tem ${String(ing.estoqueFisico).replace('.', ',')}`); return; }
        t.update(T.tdoc(db, tid, 'produtos', l.id), { estoqueFisico: novo, ativo: E.ativoDepois(ing, novo), ultimaModificacao: Date.now() });
        movs.push({ produtoId: l.id, nome: l.nome, unidade: l.unidade, tipo: 'producao', delta: -precisa, saldo: novo, motivo: 'consumo', obs: `Para ${unidades}× ${p.nome}`, custoUnit: l.custo, por: dec.email || dec.uid });
      });
      if (faltas.length) throw new Error(`Falta ingrediente. ${faltas.join('; ')}.`);

      // lote = AAMMDD-NN (NN recomeça todo dia) · validade = fabricação + dias da ficha
      const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), dia = hoje.slice(2).replace(/-/g, '');
      const seq = (((contSnap.exists && contSnap.data()[dia]) || 0) + 1);
      const lote = `${dia}-${String(seq).padStart(2, '0')}`;
      const dias = Number(p.ficha.validadeDias), validade = dias > 0 && dias <= 3650 ? new Date(new Date(`${hoje}T12:00:00Z`).getTime() + Math.round(dias) * 86400000).toISOString().slice(0, 10) : '';
      const custoUn = c.completo ? c.porUnidade : null;
      const saldo = E.fix((E.temControle(p.estoqueFisico) ? Number(p.estoqueFisico) : 0) + unidades);

      t.update(prodRef, { estoqueFisico: saldo, ativo: E.ativoDepois(p, saldo), ultimaModificacao: Date.now() });
      if (custoUn) t.set(privRef, { custo: custoUn }, { merge: true });
      movs.push({ chave, produtoId, nome: p.nome, unidade: p.unidade, tipo: 'producao', delta: unidades, saldo, motivo: `lote ${lote}`, custoUnit: custoUn, por: dec.email || dec.uid });
      E.registrarMovs(t, db, tid, movs, admin.firestore.FieldValue);
      t.set(contRef, { [dia]: seq }, { merge: true });
      const registro = { produtoId, nome: p.nome, unidade: p.unidade || 'un', unidades, lote, fabricadoEm: hoje, validade, custoTotal: c.completo ? Math.round(c.porUnidade * unidades * 100) / 100 : null, custoUn, ingredientes: usados, por: dec.email || dec.uid, em: new Date().toISOString() };
      t.set(regRef, registro);
      return { ...registro, saldo };
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (P.ehFalhaInterna(e)) { console.error('[estoque] produzir', e && e.message); return res.status(500).json({ error: 'Não consegui registrar a produção agora. Tente de novo em instantes.' }); }
    return res.status(400).json({ error: e.message || 'Não foi possível registrar a produção.' });
  }
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }

  let dec, tid;
  try {
    dec = await admin.auth().verifyIdToken(H.tokenDe(req), true);        // true = recusa login encerrado (pessoa tirada da equipe)
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  let ficha;
  try { ({ tid, ficha } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!T.moduloAtivo(ficha, 'estoque')) return res.status(403).json({ error: 'O controle de estoque não está ligado nesta loja.' });
  if (!T.temPapel(dec, tid, PODEM)) return res.status(403).json({ error: 'Sua conta não pode mexer no estoque desta loja.' });
  if (passou(dec.uid)) return res.status(429).json({ error: 'Muitas movimentações seguidas. Aguarde um minuto.' });

  const b = req.body || {};
  if (b.acao !== 'movimentar' && b.acao !== 'produzir') return res.status(400).json({ error: 'Ação desconhecida.' });
  const produtoId = String(b.produtoId || '');
  if (!/^[\w-]{1,80}$/.test(produtoId)) return res.status(400).json({ error: 'Produto inválido.' });
  const chave = b.chave ? String(b.chave) : '';
  if (chave && !/^[\w-]{8,80}$/.test(chave)) return res.status(400).json({ error: 'Chave inválida.' });
  if (b.acao === 'produzir') return produzir(req, res, { tid, dec, produtoId, chave, unidades: Number(b.unidades) });
  const tipo = String(b.tipo || '');
  const motivo = tipo === 'perda' ? (E.MOTIVOS_PERDA.includes(b.motivo) ? b.motivo : 'outro') : texto(b.motivo, 40);
  const custoInformado = Number(b.custoUnit);

  try {
    const saida = await db.runTransaction(async (t) => {
      const prodRef = T.tdoc(db, tid, 'produtos', produtoId);
      const movRef = chave ? T.tdoc(db, tid, 'estoque_mov', chave) : null;
      // custo fica num documento à parte (produtos_custos), que o cliente da loja não consegue ler
      const custoRef = T.tdoc(db, tid, 'produtos_custos', produtoId);
      const [prodSnap, movSnap, custoSnap] = await Promise.all([t.get(prodRef), movRef ? t.get(movRef) : null, t.get(custoRef)]);
      const custoAtual = custoSnap.exists ? Number(custoSnap.data().custo) || null : null;
      if (movSnap && movSnap.exists) return { repetido: true, saldo: movSnap.data().saldo };       // toque repetido
      if (!prodSnap.exists) throw new Error('Produto não encontrado.');
      const p = prodSnap.data();
      const { delta, novo } = E.calcularMovimento({ atual: p.estoqueFisico, tipo, qtd: b.qtd, contagem: b.contagem });
      if (delta === 0 && E.temControle(p.estoqueFisico)) return { semMudanca: true, saldo: novo };

      const custoUnit = tipo === 'compra' && Number.isFinite(custoInformado) && custoInformado > 0 && custoInformado < 1e6 ? custoInformado : custoAtual;
      const patch = { estoqueFisico: novo, ativo: E.ativoDepois(p, novo), ultimaModificacao: Date.now() };
      t.update(prodRef, patch);
      if (tipo === 'compra' && custoUnit && custoUnit !== custoAtual) t.set(custoRef, { custo: custoUnit }, { merge: true });   // último custo pago
      E.registrarMovs(t, db, tid, [{ chave, produtoId, nome: p.nome, unidade: p.unidade, tipo, delta, saldo: novo, motivo, obs: texto(b.obs, 140), custoUnit, por: dec.email || dec.uid }], admin.firestore.FieldValue);
      return { saldo: novo, delta };
    });
    return res.status(200).json({ sucesso: true, ...saida });
  } catch (e) {
    if (P.ehFalhaInterna(e)) { console.error('[estoque]', e && e.message); return res.status(500).json({ error: 'Não consegui registrar agora. Tente de novo em instantes.' }); }
    return res.status(400).json({ error: e.message || 'Não foi possível registrar.' });
  }
};
