'use strict';
// =====================================================================
//  lib/conta.js — A CONTA DO CLIENTE (sem login, sem senha).
//
//  O PROBLEMA: o cliente não faz login. Tudo o que a loja lembrava dele
//  (nome, endereço, pedidos, sacola) ficava só no aparelho. O iPhone apaga
//  isso depois de 7 dias sem abrir o site, e trocar de celular perde tudo.
//
//  A SOLUÇÃO, EM TRÊS PEÇAS:
//   1. ID DE CLIENTE. No primeiro pedido o servidor cria uma conta
//      (contas/{id}) e liga cada pedido novo a ela (pedido.clienteId).
//   2. CRACHÁ. Um código secreto guardado num cookie que só o servidor lê
//      (HttpOnly). A limpeza de 7 dias do iPhone apaga o que a PÁGINA
//      guarda; cookie posto pelo servidor não entra nessa limpeza.
//   3. LINK PESSOAL. O mesmo código vai no fim da mensagem do WhatsApp
//      ("Meu acesso: ..."). Em outro aparelho, tocar no link devolve tudo.
//      Se o cliente perder até a mensagem, o dono gera um link novo no
//      painel (aba Clientes), e os links antigos param de valer.
//
//  SEGURANÇA
//   - O código tem 256 bits de sorteio: não dá para chutar.
//   - O banco guarda só o HASH do código (como senha). Nem o painel nem
//     quem ler o banco consegue montar o link de um cliente.
//   - QUEM VÊ O CÓDIGO: o próprio cliente e quem lê o WhatsApp da loja (o
//     link vai na mensagem do pedido). Por isso a conta só devolve o que a
//     loja já sabe. O cookie é fechado para a página, mas a página enxerga
//     o link dentro da mensagem que ela mesma abre no WhatsApp.
//   - LINK MANDADO POR ESTRANHO: o aparelho mostra de quem é a conta e
//     pergunta antes de entrar (prévia sem cookie), para ninguém passar a
//     pedir, sem saber, dentro da conta de outra pessoa.
//   - Nunca se acha uma conta por telefone ou endereço digitado pelo
//     cliente: só pelo código, ou pelo login anônimo do próprio aparelho.
//   - A conta devolve só o que a loja já sabe (nome, endereço, pedidos).
//     Não existe pagamento guardado aqui.
//   - As regras do banco negam `contas` para todo navegador: só o servidor lê.
//   - Cada loja tem as suas contas e o seu cookie: a conta de uma loja não
//     abre nada em outra.
// =====================================================================
const crypto = require('crypto');
const T = require('./tenant');
const H = require('./http');
const P = require('./prudencia');
const N = require('../analytics/normalize');

const COL = 'contas';
const MAX_CHAVES = 6;      // aparelhos/links válidos ao mesmo tempo
const MAX_UIDS = 10;
const MAX_PEDIDOS = 12;
const MAX_SACOLA = 60;
const DIAS_COOKIE = 400;   // o máximo que os navegadores aceitam
const RE_CODIGO = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

const sorteio = (n) => crypto.randomBytes(n).toString('base64url');
const hashDe = (segredo) => crypto.createHash('sha256').update(String(segredo)).digest('hex');
const novoSegredo = () => sorteio(32);                                                   // 43 letras
const novoId = () => { let id; do { id = sorteio(12); } while (/^__.*__$/.test(id)); return id; };   // 16 letras
const lerCodigo = (texto) => { const m = RE_CODIGO.exec(typeof texto === 'string' ? texto : ''); return m ? { cid: m[1], segredo: m[2] } : null; };
const refDe = (db, tid, cid) => T.tdoc(db, tid, COL, cid);

/** O código confere com alguma das chaves guardadas? (comparação sem vazar tempo) */
function confere(conta, segredo) {
  const h = Buffer.from(hashDe(segredo));
  return !!conta && Array.isArray(conta.chaves) && conta.chaves.some((c) => typeof c === 'string' && c.length === h.length && crypto.timingSafeEqual(Buffer.from(c), h));
}

// ---------------------------------------------------------------------
// COOKIE (o crachá). Um por loja; só viaja para /api; a página não lê.
// ---------------------------------------------------------------------
const nomeCookie = (tid) => `cr_${tid}`;
function lerCookie(req, tid) {
  if (!T.idValido(tid)) return null;
  const bruto = String((req && req.headers && req.headers.cookie) || ''), nome = `${nomeCookie(tid)}=`;
  for (const parte of bruto.split(';')) { const p = parte.trim(); if (p.startsWith(nome)) return lerCodigo(p.slice(nome.length)); }
  return null;
}
const porCookie = (res, tid, codigo) => res.setHeader('Set-Cookie', `${nomeCookie(tid)}=${codigo}; Path=/api; Max-Age=${DIAS_COOKIE * 86400}; HttpOnly; Secure; SameSite=Lax`);
const tirarCookie = (res, tid) => res.setHeader('Set-Cookie', `${nomeCookie(tid)}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);

// ---------------------------------------------------------------------
// LINK PESSOAL. O código vai depois do "#": o navegador NÃO manda essa
// parte para servidor nenhum, então ela não aparece em registro de acesso.
// O endereço base só sai de lugares nossos (nunca do que o visitante escreveu).
// ---------------------------------------------------------------------
function baseDaLoja(req, tid) {
  const h = (req && req.headers) || {};
  const host = String(h['x-forwarded-host'] || h.host || '').trim().toLowerCase();
  if (host && /^[a-z0-9.-]+$/.test(host) && T.lojaDoHost(host) === tid) return `https://${host}/`;     // subdomínio ou domínio próprio da loja
  const nossas = H.origensPermitidas(), origem = String(h.origin || '');
  let propria = ''; try { const u = new URL(String(process.env.PUBLIC_BASE_URL || '')); if (u.protocol === 'https:') propria = u.origin; } catch (_) { /* sem endereço próprio */ }
  const base = nossas.includes(origem) ? origem : (propria || nossas[0]);
  return `${base}/${tid === T.TENANT_PADRAO ? '' : `?loja=${tid}`}`;
}
const linkDeAcesso = (req, tid, codigo) => `${baseDaLoja(req, tid)}#a=${codigo}`;

// ---------------------------------------------------------------------
// DADOS
// ---------------------------------------------------------------------
const texto = (v, max) => H.textoCurto(v, max);
const perfilDe = (p) => ({
  nome: texto(p.nome, 100), quadra: texto(p.quadra, 60), lote: texto(p.lote, 30),
  condominio: texto(p.condominio, 60), condominioId: String(p.condominioId || '').replace(/[^\w-]/g, '').slice(0, 40),
  formatoEndereco: ['rua', 'livre'].includes(p.formatoEndereco) ? p.formatoEndereco : 'ql',
  telefone: String(p.telefone || '').replace(/\D/g, '').slice(0, 13),
});
/** O mesmo id que a aba Clientes usa (condomínio + quadra + lote). '' quando não há endereço. */
function chaveCrm(p) {
  const k = N.chaveCliente({ quadra: p.quadra, lote: p.lote, condominio: p.condominio, id: 'x' });
  return k.startsWith('ped:') ? '' : N.idDeChave(k);
}
const mesmoEndereco = (a, b) => N.normEnd(a.quadra) === N.normEnd(b.quadra) && N.normEnd(a.lote) === N.normEnd(b.lote)
  && (!N.normCond(a.condominio) || !N.normCond(b.condominio) || N.normCond(a.condominio) === N.normCond(b.condominio));
const semRepetir = (lista, max) => [...new Set((Array.isArray(lista) ? lista : []).filter((x) => typeof x === 'string' && x))].slice(0, max);
const idDeItem = (v) => { const x = typeof v === 'number' ? String(v) : v; return typeof x === 'string' && x.length >= 1 && x.length <= 120 && !/[\/\u0000-\u001f]/.test(x) ? x : null; };

/** Sacola que o aparelho mandou guardar: só id, quantidade e tipo. O preço NUNCA vem daqui. */
function limparSacola(lista) {
  const out = [], vistos = new Set();
  for (const i of Array.isArray(lista) ? lista.slice(0, 200) : []) {
    const id = i && typeof i === 'object' ? idDeItem(i.id) : null, qtd = Number(i && i.qtd);
    if (!id || vistos.has(id) || !Number.isFinite(qtd) || qtd <= 0 || qtd > 1000) continue;
    vistos.add(id); out.push({ id, qtd: Math.round(qtd * 1000) / 1000, tipo: i.tipo === 'kg' ? 'kg' : 'un' });
    if (out.length >= MAX_SACOLA) break;
  }
  return out;
}
/** Preferências: favoritos e "unidade ou quilo" de cada produto. */
function limparPrefs(p) {
  const out = { favs: [], modo: {} };
  if (!p || typeof p !== 'object') return out;
  out.favs = semRepetir((Array.isArray(p.favs) ? p.favs.slice(0, 400) : []).map(idDeItem).filter(Boolean), 150);
  if (p.modo && typeof p.modo === 'object' && !Array.isArray(p.modo)) {
    for (const [k, v] of Object.entries(p.modo).slice(0, 400)) { if (idDeItem(k) && !/[.`~*\[\]]/.test(k) && (v === 'un' || v === 'kg') && Object.keys(out.modo).length < 200) out.modo[k] = v; }
  }
  return out;
}

const descItens = (itens) => (Array.isArray(itens) ? itens : []).filter((i) => i && i.nome).map((i) => (i.aPesar ? `${i.qtd} un de ${i.nome} (A Pesar)` : `${i.qtd}x ${i.nome}`)).join(', ').slice(0, 600);
/** Resumo de um pedido, no formato que a tela "Meus pedidos" já usa. */
function resumoPedido(id, p) {
  return {
    id, data: String(p.data || ''), total: Number.isFinite(Number(p.total)) ? Number(p.total) : 0, status: String(p.status || 'pendente'),
    descItens: descItens(p.itens),
    itens: (Array.isArray(p.itens) ? p.itens : []).filter((i) => i && i.id).slice(0, 100).map((i) => ({ id: String(i.id), nome: String(i.nome || ''), qtd: Number(i.qtd) || 0, tipo: i.tipo === 'kg' ? 'kg' : 'un', aPesar: i.aPesar === true, precoOriginal: Number(i.precoOriginal) || 0 })),
    ...(p.status === 'cancelado' ? { cancelado: true } : {}),
    ...(p.avaliacao && Number(p.avaliacao.nota) ? { avaliado: Number(p.avaliacao.nota) } : {}),
  };
}
async function lerPedidos(db, tid, ids) {
  const snaps = await Promise.all(semRepetir(ids, MAX_PEDIDOS).map((id) => T.tdoc(db, tid, 'pedidos', id).get()));
  return snaps.filter((s) => s.exists && s.data().origem !== 'balcao').map((s) => resumoPedido(s.id, s.data())).sort((a, b) => String(b.data).localeCompare(String(a.data)));
}
/** O que a loja devolve ao aparelho do cliente. Nada de chave, hash ou id interno do login. */
async function retrato(db, tid, conta) {
  const prefs = limparPrefs(conta.prefs);
  return {
    id: conta.id, ...perfilDe(conta),
    pedidos: await lerPedidos(db, tid, conta.pedidos),
    favs: prefs.favs, modo: prefs.modo,
    sacola: limparSacola(conta.sacola), sacolaEm: String(conta.sacolaEm || ''),
  };
}

// ---------------------------------------------------------------------
// NO PEDIDO (chamado por api/checkout.js)
// ---------------------------------------------------------------------
/**
 * ANTES da transação: de onde pode vir a conta deste pedido?
 *   1. do crachá (cookie);  2. do login anônimo deste aparelho, se ele já fez pedido com conta.
 * Nunca do nome, telefone ou endereço digitado. Falha aqui não derruba a venda: segue sem conta.
 */
async function localizar(db, tid, req, uid) {
  const saida = { cracha: lerCookie(req, tid), cidDoUid: '', anteriores: [] };
  try {
    if (saida.cracha) {
      const c = await refDe(db, tid, saida.cracha.cid).get();
      if (c.exists && confere(c.data(), saida.cracha.segredo)) return saida;
      saida.cracha = null;                       // crachá que não vale mais (a loja gerou link novo): segue como aparelho sem crachá
    }
    if (!uid || uid === 'anonimo') return saida;
    const s = await T.tcol(db, tid, COL).where('uids', 'array-contains', uid).limit(3).get();
    const achadas = s.docs.map((d) => d.data()).filter((c) => Array.isArray(c.uids) && c.uids.includes(uid) && Array.isArray(c.chaves) && c.chaves.length)
      .sort((a, b) => String(b.vistoEm || '').localeCompare(String(a.vistoEm || '')));
    if (achadas.length) { saida.cidDoUid = achadas[0].id; return saida; }
    // conta nova: os pedidos que ESTE aparelho já tinha feito entram no histórico dela
    const p = await T.tcol(db, tid, 'pedidos').where('userId', '==', uid).limit(40).get();
    saida.anteriores = p.docs.filter((d) => d.data().userId === uid && d.data().origem !== 'balcao')
      .sort((a, b) => String(b.data().data || '').localeCompare(String(a.data().data || ''))).slice(0, MAX_PEDIDOS - 1).map((d) => d.id);
  } catch (e) { console.error('[conta] localizar', e && e.message); }
  return saida;
}
/** Documento da conta que a transação precisa LER (ou null). */
const refCandidata = (db, tid, achado) => (achado.cracha ? refDe(db, tid, achado.cracha.cid) : achado.cidDoUid ? refDe(db, tid, achado.cidDoUid) : null);

/**
 * DENTRO da transação, com a conta candidata já lida: decide entre usar a que existe ou criar uma.
 * Devolve { cid, codigo, escrever(t, pedido) }. `codigo` é o que vai no cookie e no link.
 */
function decidir(db, tid, achado, snap, uid, agoraIso = new Date().toISOString()) {
  const conta = snap && snap.exists ? snap.data() : null;
  const temUid = !!uid && uid !== 'anonimo';
  let cid, segredo, chaveNova = false, existente = null;
  if (conta && achado.cracha && confere(conta, achado.cracha.segredo)) { existente = conta; cid = achado.cracha.cid; segredo = achado.cracha.segredo; }
  else if (conta && !achado.cracha && temUid && Array.isArray(conta.uids) && conta.uids.includes(uid)) { existente = conta; cid = conta.id; segredo = novoSegredo(); chaveNova = true; }
  else { cid = novoId(); segredo = novoSegredo(); chaveNova = true; }
  const ref = refDe(db, tid, cid);
  const escrever = (t, pedido) => {
    const perfil = perfilDe(pedido), crm = chaveCrm(pedido);
    if (!perfil.telefone && existente && existente.telefone) perfil.telefone = existente.telefone;     // pedido sem telefone não apaga o que já havia
    const base = existente || { id: cid, criadoEm: agoraIso, origem: 'pedido', chaves: [], uids: [], pedidos: achado.anteriores || [] };
    t.set(ref, {
      id: cid, ...perfil, ...(crm ? { crm } : {}),
      chaves: chaveNova ? [...(base.chaves || []), hashDe(segredo)].slice(-MAX_CHAVES) : base.chaves,
      uids: semRepetir([...(temUid ? [uid] : []), ...(base.uids || [])], MAX_UIDS),
      pedidos: semRepetir([pedido.id, ...(base.pedidos || [])], MAX_PEDIDOS),
      sacola: [], sacolaEm: agoraIso,                       // o pedido saiu: a sacola guardada esvazia
      criadoEm: base.criadoEm || agoraIso, origem: base.origem || 'pedido', vistoEm: agoraIso,
    }, { merge: true });
  };
  return { cid, codigo: `${cid}.${segredo}`, escrever };
}

/**
 * O MESMO pedido reenviado (a resposta se perdeu no caminho). Devolve o código para o link e o cookie, ou ''.
 * Com o crachá certo, usa ele. Sem crachá, só quem é o dono do pedido (login do aparelho) ganha uma chave nova.
 */
async function codigoDoReenvio(t, db, tid, pedido, achado, uid) {
  if (!pedido || !H.idSeguro(pedido.clienteId, 16, 16)) return '';
  const ref = refDe(db, tid, pedido.clienteId), s = await t.get(ref);
  if (!s.exists) return '';
  const conta = s.data();
  if (achado.cracha && achado.cracha.cid === pedido.clienteId && confere(conta, achado.cracha.segredo)) return `${achado.cracha.cid}.${achado.cracha.segredo}`;
  // Chave nova só para o aparelho que AINDA faz parte da conta e para pedido recém-feito (a resposta se perdeu
  // no caminho). Sem isto, um aparelho cujo acesso a loja cancelou reenviaria um pedido antigo e voltaria a entrar.
  if (!uid || uid === 'anonimo' || pedido.userId !== uid) return '';
  const minutos = (Date.now() - Date.parse(pedido.data || 0)) / 60000;
  if (conta.fundidaEm || !Array.isArray(conta.uids) || !conta.uids.includes(uid) || !(minutos >= 0 && minutos <= 15)) return '';
  const segredo = novoSegredo();
  t.set(ref, { chaves: [...(conta.chaves || []), hashDe(segredo)].slice(-MAX_CHAVES) }, { merge: true });
  return `${pedido.clienteId}.${segredo}`;
}

/**
 * Este aparelho é dono do pedido PELO CRACHÁ? Usado no cancelamento e na avaliação quando o login do
 * aparelho mudou (celular novo, limpeza do iPhone): vale se o crachá confere e o pedido está na conta dele.
 */
async function donoPeloCracha(db, tid, req, pedidoId) {
  try {
    const cr = lerCookie(req, tid); if (!cr) return false;
    const s = await refDe(db, tid, cr.cid).get();
    return s.exists && confere(s.data(), cr.segredo) && Array.isArray(s.data().pedidos) && s.data().pedidos.includes(String(pedidoId));
  } catch (e) { console.error('[conta] dono', e && e.message); return false; }
}

// ---------------------------------------------------------------------
// AÇÕES (POST /api/checkout { acao: 'conta-...' })
// ---------------------------------------------------------------------
const MSG_LINK_VELHO = 'Este link de acesso não vale mais. Peça um novo para a loja pelo WhatsApp.';

async function uidDoToken(admin, req) {
  const token = H.tokenDe(req); if (!token) return { uid: '', dec: null };
  try { const dec = await admin.auth().verifyIdToken(token); return { uid: dec.uid || '', dec }; } catch (_) { return { uid: '', dec: null }; }
}

/** Entrou (pelo crachá ou pelo link): anota a visita, renova o cookie e devolve os dados. */
async function entrar(db, tid, res, conta, codigo, uid) {
  const agora = new Date().toISOString(), patch = {};
  const haHoras = (Date.now() - Date.parse(conta.vistoEm || 0)) / 3600000;
  if (!Number.isFinite(haHoras) || haHoras > 12) patch.vistoEm = agora;
  if (uid && !(conta.uids || []).includes(uid)) { patch.uids = semRepetir([uid, ...(conta.uids || [])], MAX_UIDS); patch.vistoEm = agora; }
  if (Object.keys(patch).length) await refDe(db, tid, conta.id).set(patch, { merge: true });
  porCookie(res, tid, codigo);
  return res.status(200).json({ sucesso: true, conta: await retrato(db, tid, conta) });
}

// ---- cliente da loja ----
async function ver(ctx) {
  const { db, tid, req, res, admin, ip } = ctx, cr = lerCookie(req, tid);
  if (!cr) return res.status(200).json({ sucesso: true, conta: null });
  if (H.passouNaMemoria(`conta:${ip}`, 30, 60000) || !(await P.limitar(db, 'conta', `${tid}|${ip}`, 60, 600))) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde um minuto.' });
  const s = await refDe(db, tid, cr.cid).get();
  if (!s.exists || !confere(s.data(), cr.segredo)) { tirarCookie(res, tid); return res.status(200).json({ sucesso: true, conta: null }); }
  return entrar(db, tid, res, s.data(), `${cr.cid}.${cr.segredo}`, (await uidDoToken(admin, req)).uid);
}

async function entrarPeloLink(ctx) {
  const { db, tid, req, res, admin, ip } = ctx;
  // chutar código é inútil (256 bits), mas cada tentativa custa uma leitura: 12 a cada 10 minutos por conexão
  if (H.passouNaMemoria(`conta-link:${ip}`, 8, 60000) || !(await P.limitar(db, 'conta-entrar', `${tid}|${ip}`, 12, 600))) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde alguns minutos.' });
  const cr = lerCodigo((req.body || {}).codigo);
  if (!cr) return res.status(400).json({ error: MSG_LINK_VELHO });
  const s = await refDe(db, tid, cr.cid).get();
  if (!s.exists || !confere(s.data(), cr.segredo)) return res.status(400).json({ error: MSG_LINK_VELHO });
  // PRÉVIA: diz de quem é a conta e NÃO entra (sem cookie, sem gravar nada). O aparelho mostra e pergunta antes.
  if ((req.body || {}).previa === true) {
    const c = perfilDe(s.data());
    return res.status(200).json({ sucesso: true, previa: { nome: c.nome.split(/\s+/)[0] || '', condominio: c.condominio, quadra: c.quadra, lote: c.lote, formatoEndereco: c.formatoEndereco } });
  }
  return entrar(db, tid, res, s.data(), `${cr.cid}.${cr.segredo}`, (await uidDoToken(admin, req)).uid);
}

/** "Esquecer meus dados neste aparelho": tira o crachá e desliga o login deste aparelho da conta. O link do WhatsApp continua valendo. */
async function sair(ctx) {
  const { db, tid, req, res, admin, ip } = ctx, cr = lerCookie(req, tid);
  tirarCookie(res, tid);
  if (cr && !H.passouNaMemoria(`conta:${ip}`, 30, 60000) && (await P.limitar(db, 'conta-sair', `${tid}|${ip}`, 20, 600))) {
    const { uid } = await uidDoToken(admin, req), s = await refDe(db, tid, cr.cid).get();
    if (uid && s.exists && confere(s.data(), cr.segredo) && (s.data().uids || []).includes(uid)) await s.ref.set({ uids: s.data().uids.filter((u) => u !== uid) }, { merge: true });
  }
  return res.status(200).json({ sucesso: true });
}

/** Guarda a sacola e as preferências na conta (para voltarem depois da limpeza do iPhone). */
async function guardar(ctx) {
  const { db, tid, req, res, ip } = ctx, cr = lerCookie(req, tid);
  if (!cr) return res.status(200).json({ sucesso: true, guardado: false });
  if (H.passouNaMemoria(`conta-guardar:${ip}`, 20, 60000) || !(await P.limitar(db, 'conta-guardar', `${tid}|${ip}`, 90, 600))) return res.status(429).json({ error: 'Aguarde um instante.' });
  const s = await refDe(db, tid, cr.cid).get();
  if (!s.exists || !confere(s.data(), cr.segredo)) { tirarCookie(res, tid); return res.status(200).json({ sucesso: true, guardado: false }); }
  const corpo = req.body || {}, atual = s.data(), patch = {};
  if (corpo.sacola !== undefined) { const nova = limparSacola(corpo.sacola); if (JSON.stringify(nova) !== JSON.stringify(limparSacola(atual.sacola))) { patch.sacola = nova; patch.sacolaEm = new Date().toISOString(); } }
  if (corpo.prefs !== undefined) { const novas = limparPrefs(corpo.prefs); if (JSON.stringify(novas) !== JSON.stringify(limparPrefs(atual.prefs))) patch.prefs = novas; }
  // `prefs` é trocado inteiro (mergeFields): com merge comum, um favorito tirado nunca sairia do banco
  if (Object.keys(patch).length) await s.ref.set(patch, { mergeFields: Object.keys(patch) });
  return res.status(200).json({ sucesso: true, guardado: Object.keys(patch).length > 0 });
}

// ---- painel (só dono e gerente) ----
const emPartes = (lista, n) => { const out = []; for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n)); return out; };

const soFone = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d; };
const uidDeCliente = (u) => (typeof u === 'string' && u && u !== 'anonimo' && !u.startsWith('equipe:') ? u : '');

/**
 * Ficha da aba Clientes. Lá o "cliente" é o ENDEREÇO, e endereço qualquer um digita. Por isso NADA aqui confia
 * só no endereço: quem manda é o TELEFONE que mais aparece nos pedidos daquela casa (empate: o mais antigo).
 *   - pedidos do cliente = os desse telefone (e os sem telefone feitos pelo mesmo aparelho ou conta);
 *   - contas do cliente  = as ligadas a esses pedidos, com esse telefone (ou sem telefone).
 * Um pedido feito por outra pessoa com o endereço do vizinho fica de fora: não entra no histórico, não escolhe
 * o número para onde o link vai, e a conta dela não é misturada.
 */
async function acharDoCrm(db, tid, crmId) {
  const m = await T.docDe(db, tid, `analytics_clientes/${crmId}`).get();
  if (!m.exists) return null;
  const modelo = m.data(), uidsModelo = semRepetir(modelo.uids, 30), col = T.tcol(db, tid, COL), pedidosCol = T.tcol(db, tid, 'pedidos');
  // A. pedidos candidatos: feitos pelos aparelhos conhecidos da casa + os listados nas contas que pediram para lá. Só os DESTE endereço.
  const cand = new Map();
  for (const parte of emPartes(uidsModelo, 10)) (await pedidosCol.where('userId', 'in', parte).limit(40).get()).docs.forEach((d) => { if (parte.includes(d.data().userId)) cand.set(d.id, d.data()); });
  const contasDaCasa = (await col.where('crm', '==', crmId).limit(10).get()).docs.map((d) => d.data()).filter((c) => c && c.crm === crmId && !c.fundidaEm);
  const idsDeContas = new Set(contasDaCasa.flatMap((c) => (Array.isArray(c.pedidos) ? c.pedidos : [])).filter((id) => H.idSeguro(id, 6, 80) && !cand.has(id)));
  (await Promise.all([...idsDeContas].slice(0, 60).map((id) => pedidosCol.doc(id).get()))).forEach((sn) => { if (sn.exists) cand.set(sn.id, sn.data()); });
  const daCasa = [...cand.entries()].filter(([, p]) => p && p.origem !== 'balcao' && mesmoEndereco(p, modelo)).map(([id, p]) => ({ id, p }));
  // B. o telefone do cliente: o que mais aparece; no empate, o que pediu primeiro
  const fones = new Map();
  for (const { p } of daCasa) { const f = soFone(p.telefone); if (!f) continue; const r = fones.get(f) || { n: 0, desde: '9' }; r.n++; if (String(p.data || '9') < r.desde) r.desde = String(p.data || '9'); fones.set(f, r); }
  const telefone = ([...fones.entries()].sort((a, b) => b[1].n - a[1].n || a[1].desde.localeCompare(b[1].desde))[0] || [''])[0];
  // C. pedidos de confiança
  let confiaveis = daCasa, cidsDeConta = contasDaCasa.map((c) => c.id);
  if (telefone) {
    const doFone = daCasa.filter(({ p }) => soFone(p.telefone) === telefone), idsDoFone = new Set(doFone.map(({ id }) => id));
    const uidsOk = new Set(doFone.map(({ p }) => uidDeCliente(p.userId)).filter(Boolean)), cidsOk = new Set(doFone.map(({ p }) => p.clienteId).filter(Boolean));
    // conta da casa que já tem um pedido desse telefone (e não tem OUTRO telefone) também é do cliente
    cidsDeConta = contasDaCasa.filter((c) => (c.pedidos || []).some((id) => idsDoFone.has(id)) && (!soFone(c.telefone) || soFone(c.telefone) === telefone)).map((c) => c.id);
    cidsDeConta.forEach((c) => cidsOk.add(c));
    confiaveis = daCasa.filter(({ p }) => soFone(p.telefone) === telefone || (!soFone(p.telefone) && (uidsOk.has(uidDeCliente(p.userId)) || cidsOk.has(p.clienteId))));
  }
  const uids = semRepetir(confiaveis.map(({ p }) => uidDeCliente(p.userId)).filter(Boolean), 30), cids = semRepetir([...cidsDeConta, ...confiaveis.map(({ p }) => p.clienteId)].filter((c) => H.idSeguro(c, 16, 16)), 20);
  // D. contas: as dos pedidos de confiança e as dos mesmos aparelhos (em qualquer endereço: quem mudou de casa continua sendo a mesma pessoa)
  const porId = new Map();
  (await Promise.all(cids.map((c) => col.doc(c).get()))).forEach((sn) => { if (sn.exists) porId.set(sn.id, sn.data()); });
  for (const parte of emPartes(uids, 10)) (await col.where('uids', 'array-contains-any', parte).limit(10).get()).docs.forEach((d) => { if ((d.data().uids || []).some((u) => parte.includes(u))) porId.set(d.id, d.data()); });
  const contas = [...porId.values()].filter((c) => !c.fundidaEm && (!telefone || !soFone(c.telefone) || soFone(c.telefone) === telefone))
    .sort((a, b) => ((b.chaves || []).length ? 1 : 0) - ((a.chaves || []).length ? 1 : 0) || (b.pedidos || []).length - (a.pedidos || []).length || String(b.vistoEm || '').localeCompare(String(a.vistoEm || '')));
  const pedidos = confiaveis.sort((a, b) => String(b.p.data || '').localeCompare(String(a.p.data || '')));
  return { modelo, contas, telefone, outrosTelefones: Math.max(0, fones.size - (telefone ? 1 : 0)), ultimo: pedidos[0] ? pedidos[0].p : null, pedidos: pedidos.map(({ id, p }) => resumoPedido(id, p)) };
}

async function gestorOuNada(ctx) {
  const { admin, req, res, tid } = ctx, { dec } = await uidDoToken(admin, req);
  if (!dec) { res.status(401).json({ error: 'Faça login no painel para continuar.' }); return null; }
  if (!T.temPapel(dec, tid, T.GESTORES)) { res.status(403).json({ error: 'Só o dono ou o gerente da loja pode fazer isto.' }); return null; }
  return dec;
}
const crmIdValido = (v) => typeof v === 'string' && /^c_[0-9a-f]{12}$/.test(v);

async function ficha(ctx) {
  const { db, tid, req, res } = ctx;
  if (!(await gestorOuNada(ctx))) return;
  const crmId = (req.body || {}).clienteId;
  if (!crmIdValido(crmId)) return res.status(400).json({ error: 'Cliente inválido.' });
  const a = await acharDoCrm(db, tid, crmId);
  if (!a) return res.status(404).json({ error: 'Cliente sem dados calculados ainda.' });
  const ativas = a.contas.filter((c) => (c.chaves || []).length);
  return res.status(200).json({ sucesso: true, temAcesso: ativas.length > 0, vistoEm: (ativas[0] && ativas[0].vistoEm) || '', temTelefone: !!a.telefone, outrosTelefones: a.outrosTelefones,
    pedidos: a.pedidos.slice(0, MAX_PEDIDOS).map(({ id, data, total, status, descItens: d }) => ({ id, data, total, status, descItens: d })) });
}

/**
 * GERAR LINK DE ACESSO (o cliente perdeu o aparelho E a mensagem).
 * Cria um código novo e INVALIDA todos os anteriores deste cliente, em todas as contas dele. Se o cliente ainda
 * não tinha conta (comprava antes desta novidade), ela nasce aqui, já com os pedidos antigos dele.
 */
async function gerarLink(ctx) {
  const { db, tid, req, res, ip } = ctx, dec = await gestorOuNada(ctx);
  if (!dec) return;
  const crmId = (req.body || {}).clienteId;
  if (!crmIdValido(crmId)) return res.status(400).json({ error: 'Cliente inválido.' });
  if (!(await P.limitar(db, 'conta-link', tid, 40, 3600))) return res.status(429).json({ error: 'Muitos links gerados em pouco tempo. Aguarde um pouco.' });
  const a = await acharDoCrm(db, tid, crmId);
  if (!a) return res.status(404).json({ error: 'Cliente sem dados calculados ainda. Abra a aba Previsão e recalcule.' });
  const agora = new Date().toISOString(), segredo = novoSegredo(), principal = a.contas[0] || null, cid = principal ? principal.id : novoId();
  // nome e endereço: do último pedido de confiança (ou do que a aba Clientes já mostra). O telefone é SEMPRE o apurado acima.
  const perfil = { ...perfilDe(a.ultimo || a.modelo), telefone: a.telefone };
  const lote = db.batch();
  lote.set(refDe(db, tid, cid), {
    id: cid, ...perfil, crm: crmId,
    chaves: [hashDe(segredo)],                                           // só o link novo vale
    uids: [],                                                            // nenhum aparelho antigo volta a entrar sozinho: só pelo link novo
    pedidos: a.pedidos.slice(0, MAX_PEDIDOS).map((p) => p.id),
    criadoEm: (principal && principal.criadoEm) || agora, origem: (principal && principal.origem) || 'painel', vistoEm: (principal && principal.vistoEm) || agora, linkGeradoEm: agora,
  }, { merge: true });
  // as outras contas do mesmo cliente (aparelho antigo, limpeza do iPhone): ficam sem chave e apontam para a principal
  a.contas.slice(1).forEach((c) => lote.set(refDe(db, tid, c.id), { chaves: [], uids: [], fundidaEm: cid }, { merge: true }));
  await lote.commit();
  await P.registrar(db, tid, { acao: 'conta-link', quem: dec.email || dec.uid, uid: dec.uid, ip, detalhe: `link de acesso novo para o cliente ${crmId}` });
  return res.status(200).json({ sucesso: true, link: linkDeAcesso(req, tid, `${cid}.${segredo}`), nome: perfil.nome, telefone: a.telefone, outrosTelefones: a.outrosTelefones, criada: !principal });
}

const ACOES = { 'conta-ver': ver, 'conta-entrar': entrarPeloLink, 'conta-sair': sair, 'conta-guardar': guardar, 'conta-ficha': ficha, 'conta-link': gerarLink };
const ehAcao = (acao) => typeof acao === 'string' && Object.prototype.hasOwnProperty.call(ACOES, acao);

/** Porta de entrada das ações. Erro nosso vira frase simples (e aviso à equipe), nunca detalhe técnico. */
async function tratar(ctx) {
  try { return await ACOES[ctx.acao]({ ...ctx, ip: H.ipDe(ctx.req) }); }
  catch (e) {
    console.error('[conta]', ctx.acao, e && e.message);
    if (P.ehFalhaInterna(e)) await P.avisarFalha(ctx.db, ctx.tid, 'A conta do cliente', e);
    return ctx.res.status(500).json({ error: 'Não consegui fazer isso agora. Tente de novo em instantes.' });
  }
}

module.exports = {
  COL, MAX_CHAVES, MAX_PEDIDOS, lerCodigo, hashDe, confere, nomeCookie, lerCookie, porCookie, tirarCookie, linkDeAcesso, baseDaLoja,
  perfilDe, chaveCrm, limparSacola, limparPrefs, resumoPedido, localizar, refCandidata, decidir, codigoDoReenvio, donoPeloCracha, ehAcao, tratar,
};
