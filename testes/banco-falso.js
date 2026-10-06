'use strict';
// Banco de mentira, em memória, só para os testes. Imita o pedaço do Firestore
// (Admin SDK) que as APIs usam: doc, collection, get, set, update, transação, lote.
const INC = Symbol('increment');
let seq = 0;
function criarBanco(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const aplicar = (atual, novo, fundo = false) => {
    const out = { ...(atual || {}) };
    for (const [k, v] of Object.entries(novo)) {
      if (v && v[INC] !== undefined) out[k] = Math.round(((Number(out[k]) || 0) + v[INC]) * 1000) / 1000;
      else if (fundo && v && typeof v === 'object' && !Array.isArray(v)) out[k] = aplicar(out[k] && typeof out[k] === 'object' ? out[k] : {}, v, true);
      else out[k] = v && typeof v === 'object' && !Array.isArray(v) ? aplicar({}, v, true) : v;
    }
    return out;
  };
  const snapDoc = (caminho) => ({ exists: dados.has(caminho), id: caminho.split('/').pop(), ref: doc(caminho), data: () => (dados.has(caminho) ? JSON.parse(JSON.stringify(dados.get(caminho))) : undefined) });
  function doc(caminho) {
    return {
      path: caminho, id: caminho.split('/').pop(),
      collection: (nome) => collection(`${caminho}/${nome}`),
      get: async () => snapDoc(caminho),
      set: async (v, o) => { dados.set(caminho, o && o.merge ? aplicar(dados.get(caminho), v, true) : aplicar({}, v)); },
      update: async (v) => { if (!dados.has(caminho)) throw new Error('NOT_FOUND ' + caminho); dados.set(caminho, aplicar(dados.get(caminho), v)); },
      delete: async () => { dados.delete(caminho); },
    };
  }
  function collection(caminho) {
    const filhos = () => [...dados.keys()].filter((k) => k.startsWith(caminho + '/') && !k.slice(caminho.length + 1).includes('/'));
    const consulta = (filtros) => ({
      where: (campo, op, valor) => consulta([...filtros, [campo, op, valor]]),
      orderBy: () => consulta(filtros), limit: () => consulta(filtros),
      get: async () => {
        const docs = filhos().map(snapDoc).filter((s) => filtros.every(([campo, op, valor]) => {
          const x = typeof campo === 'string' ? s.data()[campo] : s.id;
          return op === '>=' ? x >= valor : op === '<=' ? x <= valor : op === '<' ? x < valor : op === '==' ? x === valor : true;
        }));
        return { docs, size: docs.length, empty: !docs.length };
      },
    });
    return { path: caminho, doc: (id) => doc(`${caminho}/${id || 'auto' + (++seq)}`), ...consulta([]) };
  }
  const db = {
    doc, collection, settings() {},
    batch: () => { const ops = []; return { set: (r, v, o) => ops.push(() => r.set(v, o)), update: (r, v) => ops.push(() => r.update(v)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const f of ops) await f(); } }; },
    runTransaction: async (fn) => {
      const ops = [];
      const t = { get: (r) => r.get(), set: (r, v, o) => ops.push(() => r.set(v, o)), update: (r, v) => ops.push(() => r.update(v)), delete: (r) => ops.push(() => r.delete()) };
      const saida = await fn(t); for (const f of ops) await f(); return saida;
    },
    _dados: dados,
  };
  return db;
}
/** firebase-admin de mentira. tokens = { "texto-do-token": { uid, tenants, admin, plataforma } } */
function criarAdmin(db, tokens = {}, usuarios = []) {
  // contas de mentira para testar a equipe: [{ uid, email, customClaims }]
  const naoAchei = () => Object.assign(new Error('sem usuário'), { code: 'auth/user-not-found' });
  const contas = {
    getUserByEmail: async (e) => { const u = usuarios.find((x) => x.email === e); if (!u) throw naoAchei(); return u; },
    getUser: async (id) => { const u = usuarios.find((x) => x.uid === id); if (!u) throw naoAchei(); return u; },
    createUser: async ({ email }) => { const u = { uid: `novo-${usuarios.length + 1}-conta`, email }; usuarios.push(u); return u; },
    setCustomUserClaims: async (id, c) => { usuarios.find((x) => x.uid === id).customClaims = c; },
    revokeRefreshTokens: async (id) => { usuarios.find((x) => x.uid === id).revogado = true; },
  };
  const firestore = () => db;
  firestore.FieldValue = { increment: (n) => ({ [INC]: n }), serverTimestamp: () => new Date().toISOString() };
  firestore.FieldPath = { documentId: () => ({ __id: true }) };
  return { apps: [1], initializeApp() {}, credential: { cert: () => ({}) }, firestore, auth: () => ({ ...contas, verifyIdToken: async (t) => { if (!tokens[t]) throw new Error('token inválido'); return tokens[t]; } }) };
}
/** Requisição e resposta de mentira no formato da Vercel. */
function chamar(handler, { method = 'POST', headers = {}, body = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = { _status: 200, setHeader() {}, status(c) { this._status = c; return this; }, json(j) { resolve({ status: this._status, corpo: j }); return this; }, send(t) { resolve({ status: this._status, corpo: t }); return this; }, end() { resolve({ status: this._status, corpo: null }); } };
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    Promise.resolve(handler({ method, headers: h, body, query, socket: {} }, res)).catch(reject);
  });
}
/** Carrega um arquivo de api/ usando o firebase-admin de mentira. */
function carregarApi(arquivo, adminFalso) {
  const Module = require('module'), original = Module._load;
  Module._load = function (pedido, ...resto) { if (pedido === 'firebase-admin') return adminFalso; if (pedido === '@vercel/kv') throw new Error('sem kv'); return original.call(this, pedido, ...resto); };
  try { for (const k of Object.keys(require.cache)) if (/[\\/](api|analytics|lib)[\\/]/.test(k)) delete require.cache[k]; return require(arquivo); }
  finally { Module._load = original; }
}
module.exports = { criarBanco, criarAdmin, chamar, carregarApi };
