'use strict';
// =====================================================================
//  lib/r2.js — FOTOS NO CLOUDFLARE R2 (o lugar das fotos no lugar do ImgBB).
//
//  O R2 fala a mesma "língua" do S3 da Amazon. Em vez de instalar o pacote da Amazon (pesado, e o servidor
//  só precisa de duas operações), a assinatura dos pedidos é feita aqui com o crypto do Node ("AWS
//  Signature Version 4"). Um teste confere a conta com o exemplo publicado pela própria Amazon.
//
//  Variáveis (no ~/segredos.env do servidor, nunca no GitHub nem no navegador):
//     R2_ACCOUNT_ID         ID da conta Cloudflare (32 letras/números; não é segredo)
//     R2_ACCESS_KEY_ID      chave de acesso do token do R2
//     R2_SECRET_ACCESS_KEY  chave secreta do token do R2
//     R2_BUCKET             nome do bucket (fotos-bancas)
//     R2_URL_PUBLICA        endereço público do bucket (https://fotos.usebanca.com)
//  Faltou alguma? config() devolve null e o envio de fotos segue pelo ImgBB, como antes.
// =====================================================================
const crypto = require('crypto');

const CACHE = 'public, max-age=31536000, immutable';      // arquivo nunca muda com o mesmo nome
const VAZIO = crypto.createHash('sha256').update('').digest('hex');
const NOMES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_URL_PUBLICA'];

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
// "Codificação de URI" do S3: tudo menos letras, números e - _ . ~ vira %XX (a "/" do caminho fica)
const codificar = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const caminhoCodificado = (p) => p.split('/').map(codificar).join('/');

/**
 * Cabeçalhos assinados de um pedido S3 (Signature V4).
 * caminho: já codificado (ex.: /fotos-bancas/lojas/x.webp). Devolve os cabeçalhos a mandar (com authorization).
 */
function assinar({ metodo, host, caminho, consulta = '', cabecalhos = {}, corpoHash = VAZIO, chave, segredo, regiao = 'auto', servico = 's3', quando = new Date() }) {
  const amzData = quando.toISOString().replace(/[:-]|\.\d{3}/g, '');           // 20130524T000000Z
  const dia = amzData.slice(0, 8);
  const hs = {};
  for (const [k, v] of Object.entries(cabecalhos)) hs[k.toLowerCase()] = String(v);
  Object.assign(hs, { host, 'x-amz-content-sha256': corpoHash, 'x-amz-date': amzData });
  const nomes = Object.keys(hs).sort();
  const assinados = nomes.join(';');
  const pedidoCanonico = [metodo, caminho, consulta, nomes.map((n) => `${n}:${hs[n].trim().replace(/\s+/g, ' ')}\n`).join(''), assinados, corpoHash].join('\n');
  const escopo = `${dia}/${regiao}/${servico}/aws4_request`;
  const texto = ['AWS4-HMAC-SHA256', amzData, escopo, sha256hex(pedidoCanonico)].join('\n');
  const k = hmac(hmac(hmac(hmac('AWS4' + segredo, dia), regiao), servico), 'aws4_request');
  const assinatura = crypto.createHmac('sha256', k).update(texto).digest('hex');
  return { cabecalhos: { ...hs, authorization: `AWS4-HMAC-SHA256 Credential=${chave}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}` }, assinatura };
}

const ler = (n) => String(process.env[n] || '').trim();
/** Quais variáveis do R2 estão faltando ou com formato errado (só os NOMES, nunca os valores). */
function faltando() {
  const f = [];
  if (!/^[a-f0-9]{32}$/i.test(ler('R2_ACCOUNT_ID'))) f.push('R2_ACCOUNT_ID');
  if (!/^[A-Za-z0-9]{16,128}$/.test(ler('R2_ACCESS_KEY_ID'))) f.push('R2_ACCESS_KEY_ID');
  if (ler('R2_SECRET_ACCESS_KEY').length < 16) f.push('R2_SECRET_ACCESS_KEY');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(ler('R2_BUCKET'))) f.push('R2_BUCKET');
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(ler('R2_URL_PUBLICA'))) f.push('R2_URL_PUBLICA');
  return f;
}
/** Nenhuma variável do R2 foi posta (≠ posta pela metade, que merece aviso). */
const nenhuma = () => NOMES.every((n) => !ler(n));

/** { conta, chave, segredo, balde, publica, host } ou null quando falta alguma coisa. */
function config() {
  if (faltando().length) return null;
  const conta = ler('R2_ACCOUNT_ID').toLowerCase();
  return { conta, chave: ler('R2_ACCESS_KEY_ID'), segredo: ler('R2_SECRET_ACCESS_KEY'), balde: ler('R2_BUCKET'), publica: ler('R2_URL_PUBLICA').replace(/\/+$/, ''), host: `${conta}.r2.cloudflarestorage.com` };
}

/** Nome de arquivo aceito: letras minúsculas, números, - _ . e pastas com "/", sem ".." nem barra no começo. */
const nomeValido = (n) => typeof n === 'string' && n.length <= 300 && /^[a-z0-9][a-z0-9/_.-]*$/.test(n) && !n.includes('..') && !n.includes('//') && !n.endsWith('/');

async function pedir(metodo, nome, { corpo = null, tipo = '', fetch = global.fetch, tempo = 25000 } = {}) {
  const c = config();
  if (!c) throw Object.assign(new Error('O R2 não está configurado.'), { codigo: 'sem-r2' });
  if (!nomeValido(nome)) throw Object.assign(new Error('Nome de arquivo inválido.'), { codigo: 'nome' });
  const caminho = caminhoCodificado(`/${c.balde}/${nome}`);
  const extras = corpo ? { 'content-type': tipo, 'cache-control': CACHE } : {};
  const { cabecalhos } = assinar({ metodo, host: c.host, caminho, cabecalhos: extras, corpoHash: corpo ? sha256hex(corpo) : VAZIO, chave: c.chave, segredo: c.segredo });
  delete cabecalhos.host;                      // o fetch põe o host sozinho (o mesmo que foi assinado)
  const ctl = new AbortController(), relogio = setTimeout(() => ctl.abort(), tempo);
  try {
    return await fetch(`https://${c.host}${caminho}`, { method: metodo, headers: cabecalhos, ...(corpo ? { body: corpo } : {}), signal: ctl.signal });
  } finally { clearTimeout(relogio); }
}

/** Guarda o arquivo no bucket e devolve o endereço público. Erro com .status quando o R2 recusa. */
async function enviar(nome, corpo, tipo, opcoes = {}) {
  if (!Buffer.isBuffer(corpo) || !corpo.length) throw Object.assign(new Error('Arquivo vazio.'), { codigo: 'vazio' });
  if (!/^image\/(webp|jpeg|png|gif)$/.test(String(tipo))) throw Object.assign(new Error('Tipo de arquivo não aceito.'), { codigo: 'tipo' });
  const r = await pedir('PUT', nome, { ...opcoes, corpo, tipo });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const codigo = (t.match(/<Code>([^<]{1,60})<\/Code>/) || [])[1] || '';
    throw Object.assign(new Error(`O R2 recusou o arquivo (${r.status}${codigo ? ' ' + codigo : ''}).`), { status: r.status, codigo: codigo || 'r2' });
  }
  return urlPublica(nome);
}
/** O arquivo já está no bucket? (para a migração não enviar duas vezes) */
async function existe(nome, opcoes = {}) {
  const r = await pedir('HEAD', nome, opcoes);
  if (r.status === 404) return false;
  if (!r.ok) throw Object.assign(new Error(`O R2 não respondeu (${r.status}).`), { status: r.status });
  return true;
}
const urlPublica = (nome) => { const c = config(); return c ? `${c.publica}/${nome}` : ''; };

module.exports = { assinar, config, faltando, nenhuma, enviar, existe, urlPublica, nomeValido, caminhoCodificado, NOMES, CACHE };
