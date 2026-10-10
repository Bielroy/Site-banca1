'use strict';
// =====================================================================
//  server/index.js — O SERVIDOR PARA O GOOGLE CLOUD RUN.
//
//  Liga os arquivos de api/ (os MESMOS que a Vercel usa) a um servidor comum.
//  Nenhum arquivo de api/ muda: cada um continua sendo
//      module.exports = async function handler(req, res) { ... }
//  e este arquivo só entrega o que a Vercel entregava de graça:
//      req.body    o corpo já lido (JSON, formulário ou texto)
//      req.query   os parâmetros do endereço
//      res.status(n).json(obj) / res.send(x)
//  Sem nenhuma biblioteca nova: só o que já vem no Node.
//
//  IP E ENDEREÇO DE QUEM CHAMOU
//  O site fala com este servidor pelo Cloudflare (functions/api/[[caminho]].js), então o que chega
//  aqui é o endereço do Cloudflare, não o do cliente. O Cloudflare manda o IP real e o endereço
//  original do site em cabeçalhos próprios, junto com um segredo (PROXY_SEGREDO) que só os dois
//  conhecem. Só com o segredo certo esses cabeçalhos valem; sem ele (alguém chamando o servidor
//  direto) o IP vem da conexão e os cabeçalhos de endereço escritos pelo visitante são jogados fora.
//  Isso importa: os freios por IP (login, pedido) dependem dele.
//
//  Variáveis: as mesmas da Vercel (FIREBASE_*, PAGBANK_*, GEMINI_API_KEY...) + PROXY_SEGREDO + PORT (o Cloud Run põe).
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIMITE_CORPO = 6 * 1024 * 1024;        // a Vercel aceita 4,5 MB; a foto do painel chega a 1,5 MB em base64
const LIMITE_ABSOLUTO = 40 * 1024 * 1024;     // passou disso, fecha a conexão (o Cloud Run já corta em 32 MB)
const PASTA_API = path.join(__dirname, '..', 'api');

const igualSeguro = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const ehIp = (s) => /^[0-9a-fA-F:.]{3,45}$/.test(s);

/** Decide qual IP e qual endereço valem para esta chamada e escreve nos cabeçalhos que lib/http.js e lib/tenant.js leem. */
function confiarNoCabecalho(req, segredo) {
  const h = req.headers;
  const doProxy = !!segredo && igualSeguro(h['x-proxy-segredo'], segredo);
  const conexao = (req.socket && req.socket.remoteAddress) || '';
  // direto no Cloud Run, o último IP do X-Forwarded-For é o que o Google viu de verdade (os da frente podem ser escritos por quem chama)
  const ultimoXff = String(h['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).pop() || '';
  let ip = ultimoXff || conexao;
  if (doProxy) {
    const dele = String(h['x-cliente-ip'] || '').trim();
    if (ehIp(dele)) ip = dele;
    const host = String(h['x-host-original'] || '').trim().toLowerCase();
    if (/^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(host)) h['x-forwarded-host'] = host; else delete h['x-forwarded-host'];
  } else {
    delete h['x-forwarded-host'];
  }
  h['x-real-ip'] = ip || 'desconhecido';
  for (const k of ['x-proxy-segredo', 'x-cliente-ip', 'x-host-original']) delete h[k];
  return doProxy;
}

/** res.status(n), res.json(obj), res.send(x): o que as funções esperam. */
function enfeitarResposta(res) {
  res.status = (codigo) => { res.statusCode = codigo; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (corpo) => {
    if (corpo !== null && typeof corpo === 'object' && !Buffer.isBuffer(corpo)) return res.json(corpo);
    if (typeof corpo === 'string' && !res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(corpo == null ? undefined : corpo);
    return res;
  };
  return res;
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = []; let bytes = 0, estourou = false;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > LIMITE_ABSOLUTO) { try { req.destroy(); } catch (_) { /* já fechou */ } return; }
      if (bytes > LIMITE_CORPO) { estourou = true; partes.length = 0; return; }       // joga fora o resto: a resposta 413 chega sem derrubar a conexão
      if (!estourou) partes.push(c);
    });
    req.on('end', () => (estourou ? reject(Object.assign(new Error('corpo grande demais'), { status: 413 })) : resolve(Buffer.concat(partes).toString('utf8'))));
    req.on('error', reject);
  });
}

function interpretarCorpo(texto, tipo) {
  if (!texto) return undefined;
  if (/json/i.test(tipo)) { try { return JSON.parse(texto); } catch (_) { throw Object.assign(new Error('JSON inválido'), { status: 400 }); } }
  if (/x-www-form-urlencoded/i.test(tipo)) return Object.fromEntries(new URLSearchParams(texto));
  return texto;
}

function lerParametros(url) {
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = k in q ? [].concat(q[k], v) : v;
  return q;
}

/** Acha as funções que existem em api/: { 'checkout': caminho, ... }. */
function listarFuncoes(pasta = PASTA_API) {
  const mapa = {};
  for (const arq of fs.readdirSync(pasta)) if (/^[a-z0-9-]+\.js$/.test(arq)) mapa[arq.slice(0, -3)] = path.join(pasta, arq);
  return mapa;
}

/**
 * Cria o servidor. `funcoes` troca a pasta api/ por outra coisa (os testes usam isso).
 * `segredo` é o PROXY_SEGREDO.
 */
function criarServidor({ funcoes = listarFuncoes(), segredo = process.env.PROXY_SEGREDO } = {}) {
  const carregadas = new Map();
  const carregar = (nome) => {
    if (!carregadas.has(nome)) carregadas.set(nome, typeof funcoes[nome] === 'function' ? { handler: funcoes[nome], config: funcoes[nome].config } : (() => { const m = require(funcoes[nome]); return { handler: m.default || m, config: m.config || (m.default && m.default.config) }; })());
    return carregadas.get(nome);
  };

  return http.createServer(async (req, res) => {
    enfeitarResposta(res);
    const dar = (codigo, obj) => { if (!res.headersSent) res.status(codigo).json(obj); else res.end(); };
    try {
      const url = new URL(req.url, 'http://servidor');
      if (url.pathname === '/' || url.pathname === '/saude') return dar(200, { ok: true });
      const m = /^\/api\/([a-z0-9-]+)\/?$/.exec(url.pathname);
      if (!m || !Object.prototype.hasOwnProperty.call(funcoes, m[1])) return dar(404, { error: 'Não encontrado.' });

      confiarNoCabecalho(req, segredo);
      const { handler, config } = carregar(m[1]);
      req.query = lerParametros(url);
      const cruo = config && config.api && config.api.bodyParser === false;      // o aviso de pagamento lê o corpo bruto sozinho (assinatura)
      if (!cruo) req.body = interpretarCorpo(await lerCorpo(req), String(req.headers['content-type'] || ''));
      await handler(req, res);
      if (!res.writableEnded && !res.headersSent) res.end();
    } catch (e) {
      if (e && e.status && e.status < 500) return dar(e.status, { error: e.status === 413 ? 'Pedido grande demais.' : 'Pedido inválido.' });
      console.error('[servidor] erro:', e && e.stack ? e.stack : e);
      dar(500, { error: 'Erro interno.' });
    }
  });
}

module.exports = { criarServidor, listarFuncoes, confiarNoCabecalho, interpretarCorpo };

if (require.main === module) {
  const porta = Number(process.env.PORT) || 8080;
  if (!process.env.PROXY_SEGREDO) console.warn('[servidor] PROXY_SEGREDO não definido: o IP vem só da conexão (os freios por IP veem o Cloudflare como um só visitante).');
  criarServidor().listen(porta, () => console.log(`[servidor] no ar na porta ${porta} com: ${Object.keys(listarFuncoes()).join(', ')}`));
  for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => process.exit(0));
}
