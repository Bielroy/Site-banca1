'use strict';
// =====================================================================
//  lib/http.js — o que TODA função de api/ faz igual.
//
//  1. ORIGEM (CORS). O site e as funções moram no mesmo endereço, então o
//     navegador nem precisa de permissão de outra origem. Só respondemos
//     "pode" para os endereços que são NOSSOS. Antes cada arquivo tinha a
//     sua cópia da lista, com um domínio que não é da loja e um "*" nas
//     prévias. Agora a lista é uma só, aqui.
//  2. QUEM CHAMOU: IP (o que a Vercel informa, não o que o visitante
//     escreve) e o login (token do Firebase).
//  3. FREIO DE MEMÓRIA: barato, por cópia do servidor. Serve de primeira
//     barreira; o freio que vale para todas as cópias é lib/prudencia.limitar.
//  4. Comparação de segredo sem vazar tempo e leitura de corpo com limite.
// =====================================================================
const crypto = require('crypto');

const ORIGENS_FIXAS = ['https://site-banca1.vercel.app'];
const soOrigem = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.origin : ''; } catch (_) { return ''; } };

/** Endereços nossos: o fixo, o de PUBLIC_BASE_URL e os de ALLOWED_ORIGIN (separados por vírgula). */
function origensPermitidas() {
  const extras = String(process.env.ALLOWED_ORIGIN || '').split(',').map((s) => soOrigem(s.trim())).filter(Boolean);
  const base = soOrigem(process.env.PUBLIC_BASE_URL || '');
  return [...new Set(ORIGENS_FIXAS.concat(base ? [base] : [], extras))];
}

/** Cabeçalhos de origem. Endereço desconhecido NÃO recebe permissão (nem "*", nem um domínio padrão). */
function cors(req, res, metodos = 'OPTIONS,POST') {
  const origem = req && req.headers && req.headers.origin;
  if (origem && origensPermitidas().includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', metodos);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Loja');
  res.setHeader('Cache-Control', 'no-store');           // resposta de API nunca fica guardada em lugar nenhum
}

/** IP de quem chamou. Na Vercel estes cabeçalhos são escritos pela plataforma, não pelo visitante. */
function ipDe(req) {
  const h = (req && req.headers) || {};
  const real = String(h['x-real-ip'] || '').trim();
  const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return (real || xff || (req && req.socket && req.socket.remoteAddress) || 'desconhecido').slice(0, 64);
}

/** O login que veio no cabeçalho ("Bearer ..."), ou ''. */
function tokenDe(req) {
  const h = String((req && req.headers && req.headers.authorization) || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** Compara dois segredos sem deixar o tempo da resposta contar quantas letras acertaram. */
function igualSeguro(a, b) {
  const x = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const y = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(x, y) && String(a || '').length > 0;
}

// ---------------------------------------------------------------------
// Freio de memória: no máximo `max` chamadas de `chave` dentro de `janelaMs`.
// Devolve true quando PASSOU do limite.
// ---------------------------------------------------------------------
const usos = new Map();
function passouNaMemoria(chave, max, janelaMs = 60000, agora = Date.now()) {
  if (usos.size > 5000) for (const [k, v] of usos) if (agora - v.inicio > v.janela) usos.delete(k);
  let reg = usos.get(chave);
  if (!reg || agora - reg.inicio > janelaMs) reg = { inicio: agora, n: 0, janela: janelaMs };
  reg.n++; usos.set(chave, reg);
  return reg.n > max;
}

/** Texto de uma linha, sem sinais de marcação nem caracteres de controle, com tamanho máximo. */
const textoCurto = (v, max) => String(v == null ? '' : v).normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Identificador que pode virar nome de documento: letras, números, hífen e sublinhado. */
const idSeguro = (v, min = 1, max = 80) => typeof v === 'string' && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v);

module.exports = { cors, origensPermitidas, ipDe, tokenDe, igualSeguro, passouNaMemoria, textoCurto, idSeguro, _usos: usos };
