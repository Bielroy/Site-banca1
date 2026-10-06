// =====================================================================
//  lib/prudencia.js — o que protege a loja no dia ruim.
//
//  1. LIMITE DE ABUSO (limitar): conta as tentativas no BANCO, não na memória
//     do servidor. A memória zera a cada "acordada" da Vercel e não é dividida
//     entre as cópias do servidor, então quem quisesse encher a loja de
//     pedidos falsos passava. No banco, a conta vale para todos.
//  2. ALERTA DE FALHA (avisarFalha): se o servidor falhar por dentro (não é
//     erro de preenchimento do cliente), a equipe recebe um aviso no celular.
//     No máximo um a cada 30 min por assunto, para não virar barulho.
//  3. CÓPIA DE SEGURANÇA (copiar/exportar): uma vez por dia, cada loja ganha
//     uma cópia dos seus dados em `backups/`, e as últimas 7 ficam guardadas.
//     O proprietário também baixa a cópia na hora, pelo painel.
//
//  Nada aqui pode derrubar um pedido: toda falha destas funções é engolida.
// =====================================================================
const crypto = require('crypto');
const T = require('./tenant');
const Avisos = require('./avisos');

const curto = (texto) => crypto.createHash('sha256').update(String(texto)).digest('hex').slice(0, 32);

/**
 * Pode passar? Conta `quem` dentro de uma janela de tempo. Devolve true/false.
 * Se o banco falhar, deixa passar: o limite nunca pode impedir uma venda de verdade.
 */
async function limitar(db, assunto, quem, maximo, janelaSeg, agora = Date.now()) {
  try {
    const ref = db.collection('limites').doc(`${assunto}_${curto(quem)}`);
    return await db.runTransaction(async (t) => {
      const s = await t.get(ref), d = s.exists ? s.data() : null;
      if (!d || !(d.ate > agora)) { t.set(ref, { n: 1, ate: agora + janelaSeg * 1000, assunto }); return true; }
      if (d.n >= maximo) return false;
      t.set(ref, { n: d.n + 1, ate: d.ate, assunto });
      return true;
    });
  } catch (e) { console.error('[limite]', e && e.message); return true; }
}

/** Faxina diária das contagens vencidas. */
async function limparLimites(db, agora = Date.now()) {
  try {
    const s = await db.collection('limites').where('ate', '<', agora).limit(400).get();
    await Promise.all(s.docs.filter((d) => !(d.data().ate > agora)).map((d) => d.ref.delete().catch(() => {})));
    return s.docs.length;
  } catch (e) { console.error('[limite] faxina', e && e.message); return 0; }
}

/** É falha NOSSA (banco fora, erro de programa) e não um aviso para o cliente ("produto esgotado")? */
const ehFalhaInterna = (e) => !!e && (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || (e.code !== undefined && e.status === undefined));

const ESPERA_MS = 30 * 60 * 1000;
/** Avisa a equipe da loja (e a da loja original, onde fica o dono da plataforma) que algo quebrou. */
async function avisarFalha(db, tid, onde, erro, agora = Date.now()) {
  try {
    console.error(`[falha] ${onde} (${tid}):`, erro && (erro.stack || erro.message || erro));
    const ref = db.collection('plataforma').doc('alertas'), campo = `${tid}_${onde}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const pode = await db.runTransaction(async (t) => {
      const s = await t.get(ref), ultimo = s.exists ? Number((s.data() || {})[campo] || 0) : 0;
      if (agora - ultimo < ESPERA_MS) return false;
      t.set(ref, { [campo]: agora }, { merge: true });
      return true;
    });
    if (!pode) return { avisou: false };
    const dados = { titulo: 'Problema no site', corpo: `${onde} falhou agora há pouco. Faça um pedido de teste; se continuar, avise quem cuida do sistema.`, url: tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`, tag: `falha-${campo}` };
    const lojas = [...new Set([tid, T.TENANT_PADRAO])];
    const r = await Promise.all(lojas.map((l) => Avisos.avisarLoja(db, l, dados)));
    return { avisou: true, enviados: r.reduce((n, x) => n + (x.enviados || 0), 0) };
  } catch (e) { console.error('[falha] não consegui avisar:', e && e.message); return { avisou: false }; }
}

// ---------------------------------------------------------------------
//  CÓPIA DE SEGURANÇA
// ---------------------------------------------------------------------
const COLECOES = ['produtos', 'produtos_custos', 'categorias', 'loja', 'cupons', 'crm', 'calendario', 'equipe'];
const DIAS_DE_PEDIDOS = 90, MAX_PEDIDOS = 3000, GUARDAR = 7, TAM_PARTE = 700000;

/** Junta os dados de uma loja num objeto só. Pedidos: os últimos 90 dias. */
async function exportar(db, tid, agora = new Date()) {
  const saida = { loja: tid, feitaEm: agora.toISOString(), versao: 1, colecoes: {} };
  for (const nome of COLECOES) {
    const s = await T.tcol(db, tid, nome).get();
    saida.colecoes[nome] = Object.fromEntries(s.docs.map((d) => [d.id, d.data()]));
  }
  const desde = new Date(agora.getTime() - DIAS_DE_PEDIDOS * 86400000).toISOString();
  const p = await T.tcol(db, tid, 'pedidos').where('data', '>=', desde).limit(MAX_PEDIDOS).get();
  saida.colecoes.pedidos = Object.fromEntries(p.docs.filter((d) => String(d.data().data || '') >= desde).map((d) => [d.id, d.data()]));
  if (tid !== T.TENANT_PADRAO) { const f = await db.collection('tenants').doc(tid).get(); saida.ficha = f.exists ? f.data() : null; }
  saida.contagem = Object.fromEntries(Object.entries(saida.colecoes).map(([k, v]) => [k, Object.keys(v).length]));
  return saida;
}

/** Grava a cópia do dia em backups/{loja}_{dia} (em partes, porque um documento tem limite de tamanho) e apaga as mais velhas que 7. */
async function copiar(db, tid, agora = new Date(), sufixo = '') {
  const dados = await exportar(db, tid, agora), texto = JSON.stringify(dados), dia = agora.toISOString().slice(0, 10) + sufixo;
  const partes = []; for (let i = 0; i < texto.length; i += TAM_PARTE) partes.push(texto.slice(i, i + TAM_PARTE));
  const ref = db.collection('backups').doc(`${tid}_${dia}`);
  await Promise.all(partes.map((t, i) => ref.collection('partes').doc(String(i).padStart(3, '0')).set({ t })));
  await ref.set({ loja: tid, dia, feitaEm: dados.feitaEm, partes: partes.length, tamanho: texto.length, contagem: dados.contagem });
  // guarda só as últimas: as mais antigas saem (a lista vem em ordem de nome, que é a ordem de data)
  const todas = (await db.collection('backups').where('loja', '==', tid).get()).docs.filter((d) => d.data().loja === tid).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const velha of todas.slice(0, Math.max(0, todas.length - GUARDAR))) {
    const ps = await velha.ref.collection('partes').get();
    await Promise.all(ps.docs.map((d) => d.ref.delete().catch(() => {})));
    await velha.ref.delete().catch(() => {});
  }
  return { dia, partes: partes.length, tamanho: texto.length, contagem: dados.contagem };
}

/** Quando foi a última cópia guardada desta loja? (para a tela mostrar) */
async function ultimaCopia(db, tid) {
  const todas = (await db.collection('backups').where('loja', '==', tid).get()).docs.filter((d) => d.data().loja === tid).sort((a, b) => (a.id < b.id ? 1 : -1));
  return todas.length ? { dia: todas[0].data().dia, feitaEm: todas[0].data().feitaEm, guardadas: todas.length, contagem: todas[0].data().contagem || {} } : null;
}

/** As cópias guardadas desta loja, da mais nova para a mais velha. */
async function listarCopias(db, tid) {
  const todas = (await db.collection('backups').where('loja', '==', tid).get()).docs.filter((d) => d.data().loja === tid).sort((a, b) => (a.id < b.id ? 1 : -1));
  return todas.map((d) => ({ dia: d.data().dia, feitaEm: d.data().feitaEm, contagem: d.data().contagem || {} }));
}

/** Remonta uma cópia guardada (ela fica em partes). Devolve null se não existir ou estiver incompleta. */
async function lerCopia(db, tid, dia) {
  if (!/^[\d]{4}-[\d]{2}-[\d]{2}[a-z-]{0,20}$/.test(String(dia))) return null;
  const ref = db.collection('backups').doc(`${tid}_${dia}`), meta = await ref.get();
  if (!meta.exists || meta.data().loja !== tid) return null;
  const ps = (await ref.collection('partes').get()).docs.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (ps.length !== meta.data().partes) return null;
  try { const dados = JSON.parse(ps.map((d) => d.data().t).join('')); return dados && dados.loja === tid && dados.colecoes ? dados : null; }
  catch (e) { return null; }
}

// O que o botão "Restaurar" devolve: o CADASTRO. Pedidos, equipe e clientes ficam como estão,
// porque voltar pedidos no tempo apagaria vendas de verdade.
const RESTAURAVEIS = ['produtos', 'produtos_custos', 'categorias', 'loja', 'cupons'];

/**
 * Volta o cadastro da loja para o que estava na cópia do dia escolhido.
 *  - antes de mexer, guarda uma cópia do estado ATUAL ("...-antes"), para dar para desfazer;
 *  - regrava os documentos da cópia por cima dos atuais;
 *  - NÃO apaga o que foi criado depois da cópia (produto novo continua lá).
 */
async function restaurar(db, tid, dia, agora = new Date()) {
  const dados = await lerCopia(db, tid, dia);
  if (!dados) throw Object.assign(new Error('Não achei essa cópia, ou ela está incompleta.'), { status: 404 });
  const antes = await copiar(db, tid, agora, '-antes');
  const escritas = [];
  // dentro de `loja`, a média das avaliações e o banco de fotos são histórico, não cadastro: ficam como estão
  const FICA = { loja: ['avaliacoes', 'fotos'] };
  for (const nome of RESTAURAVEIS) for (const [id, doc] of Object.entries(dados.colecoes[nome] || {})) { if ((FICA[nome] || []).includes(id)) continue; escritas.push([T.tdoc(db, tid, nome, id), doc]); }
  for (let i = 0; i < escritas.length; i += 400) {
    const lote = db.batch(); escritas.slice(i, i + 400).forEach(([ref, doc]) => lote.set(ref, doc)); await lote.commit();
  }
  return { dia, restaurados: escritas.length, contagem: Object.fromEntries(RESTAURAVEIS.map((n) => [n, Object.keys(dados.colecoes[n] || {}).length])), copiaDeAntes: antes.dia };
}

module.exports = { limitar, limparLimites, ehFalhaInterna, avisarFalha, exportar, copiar, ultimaCopia, listarCopias, lerCopia, restaurar, COLECOES, RESTAURAVEIS, GUARDAR };
