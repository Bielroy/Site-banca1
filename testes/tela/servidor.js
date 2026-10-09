'use strict';
// =====================================================================
//  testes/tela/servidor.js — o SITE DE VERDADE (arquivos do projeto) com um
//  Firebase DE MENTIRA, para os testes de tela (tela.test.js).
//
//  Cada teste escolhe um "cenário" (lojas, produtos, feira, quem está logado)
//  pondo window.__CENARIO antes da página abrir. As chamadas a /api/ também são
//  de mentira e ficam anotadas em `chamadas` para o teste conferir.
//  Nada aqui toca no Firebase, na Vercel ou no site que está no ar.
// =====================================================================
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

// Firebase de mentira (substitui js/firebase.js). Lê o cenário de window.__CENARIO.
const FIREBASE_FALSO = `
const C = window.__CENARIO || {};
const nada = () => {};
const conta = C.conta || { uid: 'cli-anonimo', isAnonymous: true, claims: {} };
const usuario = { uid: conta.uid, email: conta.email || null, isAnonymous: !!conta.isAnonymous, emailVerified: !conta.isAnonymous,
  getIdToken: async () => 'token-' + conta.uid, getIdTokenResult: async () => ({ claims: { email_verified: !conta.isAnonymous, ...(conta.claims || {}) } }) };
export const db = {}, storage = {};
export const auth = { currentUser: usuario };
export const collection = (_d, ...p) => ({ path: p.join('/'), tipo: 'colecao' }), doc = (_d, ...p) => ({ path: p.join('/'), tipo: 'doc' });
export const onAuthStateChanged = (a, fn) => { setTimeout(() => fn(usuario), 0); return nada; };
export const signInAnonymously = async () => ({ user: usuario });
const lojaDe = (p) => { const m = /^tenants\\/([^/]+)\\/(.+)$/.exec(p); return m ? { loja: m[1], resto: m[2] } : { loja: 'banca', resto: p }; };
const L = (id) => (C.lojas || {})[id] || null;
const bloqueada = (id) => { const f = L(id); return !!(f && f.ficha && f.ficha.ativo === false); };
function ler(p) {
  if (/^feiras\\/[^/]+$/.test(p)) return (C.feiras || {})[p.split('/')[1]] || null;
  if (/^tenants\\/[^/]+$/.test(p)) { const f = L(p.split('/')[1]); return f ? f.ficha || null : null; }
  const { loja, resto } = lojaDe(p), f = L(loja);
  if (!f) return null;
  if (resto === 'loja/config') return f.config || { lojaAberta: true, diasAbertos: [0,1,2,3,4,5,6], minimo: 0, wpp: '5562999990000' };
  if (resto.startsWith('loja/')) return null;
  return null;
}
function lista(p) {
  const { loja, resto } = lojaDe(p), f = L(loja) || {};
  if (resto === 'produtos') return Object.entries(f.produtos || {}).map(([id, d]) => ({ id, data: () => d }));
  if (resto === 'categorias') return (f.categorias || []).map((c, i) => ({ id: c.chave || 'c' + i, data: () => c }));
  return [];
}
// atraso (ms) para imitar a internet: C.atraso = { ficha, feira, produtos } (padrão: na hora)
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms || 0));
const atrasoDe = (p) => { const a = C.atraso || {}; if (/^tenants\\/[^/]+$/.test(p)) return a.ficha; if (/^feiras\\//.test(p)) return a.feira; return a.produtos; };
const negado = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const ehVitrine = (p) => { const { resto } = lojaDe(p); return resto === 'produtos' || resto === 'categorias' || resto === 'loja/config' || resto === 'loja/comunicados'; };
const snapDoc = (d, id = 'x') => ({ exists: () => !!d, data: () => d || {}, id });
const snapLista = (docs) => ({ docs, empty: !docs.length, size: docs.length, forEach(f) { docs.forEach(f); }, docChanges: () => [] });
export const onSnapshot = (ref, cb, erro) => { setTimeout(() => {
  const { loja } = lojaDe(ref.path);
  if (ehVitrine(ref.path) && bloqueada(loja) && conta.isAnonymous) { if (erro) erro(negado()); return; }
  if (ref.tipo === 'doc') cb(snapDoc(ler(ref.path), ref.path.split('/').pop())); else cb(snapLista(lista(ref.path)));
}, 20 + (atrasoDe(ref.path) || 0)); return nada; };
export const getDoc = async (ref) => { await esperar(atrasoDe(ref.path)); const { loja } = lojaDe(ref.path); if (ehVitrine(ref.path) && bloqueada(loja) && conta.isAnonymous) throw negado(); return snapDoc(ler(ref.path), ref.path.split('/').pop()); };
export const getDocs = async (ref) => snapLista(lista((ref && ref.path) || ''));
export const setDoc = async (ref, dados) => { (window.__gravados = window.__gravados || []).push({ path: ref.path, dados }); };
export const deleteDoc = async () => {}, addDoc = async () => ({ id: 'novo' }), updateDoc = async () => {};
export const query = (r) => r, orderBy = nada, limit = nada, where = nada, startAfter = nada;
export const writeBatch = () => ({ set: nada, update: nada, delete: nada, commit: async () => {} });
export const sendSignInLinkToEmail = async () => {}, isSignInWithEmailLink = () => false, signInWithEmailLink = async () => {}, signOut = async () => {}, deleteField = () => null, serverTimestamp = () => new Date().toISOString(), increment = (n) => n;
export const ref = nada, uploadBytes = nada, getDownloadURL = async () => '', terminate = async () => {}, clearIndexedDbPersistence = async () => {};
`;

/**
 * Sobe o servidor numa porta livre.
 * `respostas[caminho] = (corpo) => objeto` muda o que uma /api/ responde (padrão: {}).
 */
function subir(respostas = {}) {
  const chamadas = [];
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    if (u.startsWith('/api/')) {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        let json = {}; try { json = corpo ? JSON.parse(corpo) : {}; } catch (_) { /* corpo não é JSON */ }
        chamadas.push({ caminho: u, corpo: json, cabecalhos: req.headers });
        const fn = respostas[u];
        Promise.resolve(fn ? fn(json) : {}).then((saida) => {           // a resposta pode demorar (Promise)
          res.setHeader('Content-Type', 'application/json');
          if (saida && saida.__status) { res.statusCode = saida.__status; delete saida.__status; }
          res.end(JSON.stringify(saida || {}));
        });
      });
      return;
    }
    if (u === '/js/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(FIREBASE_FALSO); }
    if (u === '/js/firebase-arquivos.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end("export const storage = {}; export const ref = () => ({}); export const uploadBytes = async () => {}; export const getDownloadURL = async () => '';"); }
    // mesmas reescritas do vercel.json
    let arq = u === '/' || u === '/previa' ? 'index.html' : u.slice(1);
    if (/^\/feira\/[^/]+$/.test(u)) { res.statusCode = 307; res.setHeader('Location', `/?feira=${u.split('/')[2]}&entrar=1`); return res.end(); }
    const caminho = path.join(RAIZ, arq);
    if (!caminho.startsWith(RAIZ) || !fs.existsSync(caminho) || fs.statSync(caminho).isDirectory()) { res.statusCode = 404; return res.end('não achei'); }
    res.setHeader('Content-Type', TIPOS[path.extname(caminho)] || 'application/octet-stream');
    res.end(fs.readFileSync(caminho));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, base: `http://127.0.0.1:${srv.address().port}`, chamadas })));
}

// Cenário padrão: a banca e a Pães da Lúcia na mesma feira.
const PRODUTOS_BANCA = {
  tomate: { nome: 'Tomate italiano', preco: 9.9, unidade: 'kg', cat: 'legumes', ativo: true, pesoMedio: 120 },
  alface: { nome: 'Alface crespa', preco: 4.5, unidade: 'un', cat: 'verduras', ativo: true },
  banana: { nome: 'Banana prata', preco: 6.9, unidade: 'kg', cat: 'frutas', ativo: true },
  ovos: { nome: 'Ovos caipira (dúzia)', preco: 14, unidade: 'dz', cat: 'outros', ativo: true },
  escondido: { nome: 'Produto desligado', preco: 1, unidade: 'un', cat: 'outros', ativo: false },
};
const CATS = [{ chave: 'frutas', nome: 'Frutas', ordem: 1 }, { chave: 'legumes', nome: 'Legumes', ordem: 2 }, { chave: 'verduras', nome: 'Verduras', ordem: 3 }, { chave: 'outros', nome: 'Outros', ordem: 4 }];
function cenarioPadrao(extra = {}) {
  return {
    lojas: {
      banca: { ficha: { nome: 'Banca Adair e Pedrina', ativo: true, feiras: ['florenca'] }, produtos: PRODUTOS_BANCA, categorias: CATS,
        config: { lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], minimo: 0, wpp: '5562999990000', condominios: ['Jardins Florença'] } },
      'paes-da-lucia': { ficha: { nome: 'Pães da Lúcia', ativo: true, feiras: ['florenca'], tipo: 'padaria', tema: { primaria: '#5a3a22', fundo: '#fbf5ec' } },
        produtos: { pao: { nome: 'Pão francês', preco: 1.2, unidade: 'un', cat: 'paes', ativo: true } }, categorias: [{ chave: 'paes', nome: 'Pães', ordem: 1 }] },
      'loja-off': { ficha: { nome: 'Loja desligada', ativo: false }, produtos: { x: { nome: 'Não devia aparecer', preco: 1, unidade: 'un', cat: 'a', ativo: true } } },
    },
    feiras: { florenca: { nome: 'Feira Florença', dias: [2], lojas: [{ id: 'banca', nome: 'Banca Adair e Pedrina', cor: '#1a3a2a' }, { id: 'paes-da-lucia', nome: 'Pães da Lúcia', cor: '#5a3a22' }] } },
    ...extra,
  };
}

module.exports = { subir, cenarioPadrao, RAIZ };
