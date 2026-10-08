'use strict';
// =====================================================================
//  lib/tenant.js — VÁRIAS LOJAS NO MESMO SISTEMA (lado do servidor)
//
//  Cada loja ("tenant") tem um id curto, ex.: "banca", "espetinhos-do-ze".
//
//  ONDE FICAM OS DADOS
//    Loja original ("banca")  → na raiz do banco, como sempre foi:
//                                produtos/…, pedidos/…, loja/config …
//    Qualquer outra loja       → dentro de tenants/{id}/…:
//                                tenants/{id}/produtos/…, tenants/{id}/pedidos/… …
//  A loja original ficou na raiz DE PROPÓSITO: nada precisou ser migrado e o
//  site que já está no ar continua lendo os mesmos lugares.
//
//  A ficha pública de TODA loja (nome, tema, módulos) fica em tenants/{id}.
//
//  QUEM PODE O QUÊ
//    O papel da pessoa em cada loja vem DENTRO do token de login (custom
//    claims), gravado só pelo servidor (scripts/plataforma.js):
//        { tenants: { "espetinhos-do-ze": "proprietario" }, plataforma: true? }
//    Compatibilidade: o antigo { admin: true } vale como proprietário da "banca".
//    A loja de cada chamada NUNCA dá permissão por si só: ela diz ONDE olhar,
//    e o token diz se a pessoa PODE.
// =====================================================================

const TENANT_PADRAO = 'banca';
const PAPEIS = ['proprietario', 'administrador', 'funcionario', 'caixa', 'producao', 'estoque'];
const GESTORES = ['proprietario', 'administrador'];

const idValido = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(id);

/** Raiz dos dados da loja: o próprio banco (loja original) ou tenants/{id}. */
const raiz = (db, tid) => (tid === TENANT_PADRAO ? db : db.collection('tenants').doc(tid));
const tcol = (db, tid, nome) => raiz(db, tid).collection(nome);
const tdoc = (db, tid, nome, id) => tcol(db, tid, nome).doc(String(id));

/** docDe(db, tid, 'produtos/abc') → o mesmo documento, dentro da loja certa. */
const docDe = (db, tid, caminho) => db.doc(tid === TENANT_PADRAO ? caminho : `tenants/${tid}/${caminho}`);

// Subdomínio e domínio próprio (mesma regra de js/enderecos-lib.js; um teste confere as duas).
// Variáveis da Vercel: VITE_DOMINIO_LOJAS e VITE_DOMINIOS_PROPRIOS ("dominio.com=id, outro.com.br=id2").
const RESERVADOS = ['www', 'app', 'api', 'admin', 'painel', 'plataforma', 'loja', 'lojas', 'mail', 'ftp', 'static', 'cdn'];
function lojaDoHost(host, env = process.env) {
  const limpar = (h) => String(h || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, ''), semWww = (h) => h.replace(/^www\./, '');
  const h = limpar(host), base = semWww(limpar(env.VITE_DOMINIO_LOJAS || env.DOMINIO_LOJAS));
  for (const par of String(env.VITE_DOMINIOS_PROPRIOS || env.DOMINIOS_PROPRIOS || '').split(',')) {
    const [d, id] = par.split('=').map((s) => semWww(limpar(s)));
    if (d && d.includes('.') && d === semWww(h) && idValido(id)) return id;
  }
  if (base && h.endsWith(`.${base}`)) { const sub = h.slice(0, -base.length - 1); if (!sub.includes('.') && idValido(sub) && !RESERVADOS.includes(sub)) return sub; }
  return null;
}

/** Loja pedida pelo navegador: o endereço (subdomínio/domínio próprio) manda; depois cabeçalho X-Loja, corpo e, por fim, a original. */
function tenantDaRequisicao(req) {
  // Endereço de uma loja nunca serve outra: se o site foi aberto em loja-a.dominio, a chamada é da loja-a.
  const doHost = lojaDoHost(req && req.headers ? (req.headers['x-forwarded-host'] || req.headers.host) : '');
  if (doHost) return doHost;
  const h = req && req.headers ? (req.headers['x-loja'] || req.headers['X-Loja']) : '';
  const b = req && req.body && typeof req.body === 'object' ? req.body.tenantId : '';
  const q = req && req.query ? req.query.loja : '';
  const bruto = String(h || b || q || '').trim().toLowerCase();
  if (!bruto) return TENANT_PADRAO;
  return idValido(bruto) ? bruto : null;        // null = id malformado → 400
}

// A ficha da loja muda pouco: guarda por 60 s para não ler o banco a cada pedido.
const cacheFichas = new Map();
async function fichaDaLoja(db, tid) {
  const c = cacheFichas.get(tid);
  if (c && Date.now() - c.em < 60000) return c.ficha;
  const s = await db.collection('tenants').doc(tid).get();
  const ficha = s.exists ? s.data() : null;
  cacheFichas.set(tid, { em: Date.now(), ficha });
  return ficha;
}

/**
 * Confere se a loja existe e está ativa. Devolve { tid, ficha } ou lança erro com .status.
 * A loja original vale mesmo sem ficha cadastrada.
 */
async function resolverLoja(db, req) {
  const tid = tenantDaRequisicao(req);
  const falha = (status, msg) => Object.assign(new Error(msg), { status });
  if (!tid) throw falha(400, 'Loja inválida.');
  const ficha = await fichaDaLoja(db, tid);
  if (tid !== TENANT_PADRAO && !ficha) throw falha(404, 'Loja não encontrada.');
  if (ficha && ficha.ativo === false) throw falha(403, 'Esta loja está temporariamente fora do ar.');
  return { tid, ficha: ficha || {} };
}

/** Papel da pessoa (token já verificado) NESTA loja, ou null. */
function papelDe(tokenDecodificado, tid) {
  const t = tokenDecodificado || {};
  // Conta com e-mail NÃO confirmado não tem papel nenhum. Quem entra pelo link do e-mail sempre tem o e-mail
  // confirmado; isto barra quem criou, por fora do site, uma conta com senha usando o e-mail de alguém da equipe.
  if (t.email_verified === false) return null;
  if (t.plataforma === true) return 'plataforma';
  const mapa = t.tenants && typeof t.tenants === 'object' && !Array.isArray(t.tenants) ? t.tenants : null;
  if (mapa && Object.prototype.hasOwnProperty.call(mapa, tid) && PAPEIS.includes(mapa[tid])) return mapa[tid];
  if (tid === TENANT_PADRAO && t.admin === true) return 'proprietario';     // conta antiga
  return null;
}
const temPapel = (token, tid, permitidos = GESTORES) => {
  const p = papelDe(token, tid);
  return p === 'plataforma' || (!!p && permitidos.includes(p));
};

/** Módulo ligado nesta loja? Sem ficha/sem campo = ligado (comportamento atual). */
const moduloAtivo = (ficha, nome) => !(ficha && ficha.modulos && ficha.modulos[nome] === false);

/**
 * "Banco com escopo": mesmo jeito de usar (doc, collection, batch, runTransaction),
 * mas tudo cai dentro da loja. Usado pelo motor de demanda (analytics/store.js).
 */
function escopo(db, tid) {
  if (tid === TENANT_PADRAO) return db;
  const base = db.collection('tenants').doc(tid);
  return {
    doc: (caminho) => db.doc(`${base.path}/${caminho}`),
    collection: (nome) => base.collection(nome),
    batch: () => db.batch(),
    runTransaction: (fn) => db.runTransaction(fn),
    raiz: db,                       // o banco inteiro (ex.: feiras/, que é da plataforma e não de uma loja)
    _tenant: tid,
  };
}

/** Todas as lojas ativas (para a rotina diária). A original entra sempre. */
async function listarLojas(db) {
  const s = await db.collection('tenants').get();
  const ids = s.docs.filter((d) => d.data().ativo !== false && idValido(d.id)).map((d) => d.id);
  return [...new Set([TENANT_PADRAO, ...ids])];
}

module.exports = { lojaDoHost, TENANT_PADRAO, PAPEIS, GESTORES, idValido, raiz, tcol, tdoc, docDe, tenantDaRequisicao, resolverLoja, fichaDaLoja, papelDe, temPapel, moduloAtivo, escopo, listarLojas, _cacheFichas: cacheFichas };
