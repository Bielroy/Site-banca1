'use strict';
// =====================================================================
//  lib/cofre.js — DADOS DO CLIENTE CIFRADOS NO BANCO.
//
//  O QUE PROTEGE
//    Nome, telefone, endereço (quadra/rua e lote/número) e observação do
//    cliente vão para o banco CIFRADOS (AES-256-GCM). Quem conseguir ler o
//    banco, uma cópia de segurança baixada ou um print do console do
//    Firebase vê só "c1:Xk9…". A chave NÃO fica no Google: fica só no
//    servidor (variável DADOS_CHAVE).
//
//  QUEM LÊ
//    - O servidor, para montar o aviso do pedido, o PIX, a previsão, etc.
//    - O painel de quem ATENDE a loja (dono, gerente, funcionário, caixa):
//      depois do login, ele pede a chave da loja ao servidor (/api/equipe,
//      acao 'chave-dados') e abre os campos no próprio aparelho. A chave fica
//      só na memória da página; sair da equipe corta o acesso na hora.
//    - O cliente vê os próprios dados pela conta dele (o servidor abre).
//
//  CHAVES
//    DADOS_CHAVE = 32 bytes em base64 (openssl rand -base64 32). Dela sai
//    uma chave para CADA loja (HKDF com o id da loja): a equipe de uma loja
//    não abre os dados de outra.
//    SEM DADOS_CHAVE o sistema segue igual a antes (grava sem cifra), e
//    o que já estava cifrado aparece como "(protegido)". PERDER A CHAVE =
//    PERDER esses dados: guarde uma cópia fora do servidor.
//
//  FORMATO   "c1:" + base64url( iv(12) | texto cifrado | etiqueta(16) )
//    O nome do campo entra como dado autenticado: o telefone cifrado não
//    pode ser colado no lugar do nome. O mesmo formato é aberto no
//    navegador por js/cofre-lib.js (WebCrypto).
//  Dado antigo, sem o prefixo, continua sendo lido como está.
// =====================================================================
const crypto = require('crypto');

const PREFIXO = 'c1:';
const CAMPOS = ['nome', 'telefone', 'quadra', 'lote', 'obs'];
const PROTEGIDO = '(protegido)';
const SAL = Buffer.from('banca-cofre-v1');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

let _mestra = { bruto: null, chave: null };
let _avisou = false;
function mestra() {
  const bruto = String(process.env.DADOS_CHAVE || '').trim();
  if (_mestra.bruto === bruto) return _mestra.chave;
  let chave = null;
  if (bruto) {
    const b = Buffer.from(bruto, 'base64');
    if (b.length === 32) chave = b;
    else console.error('[cofre] DADOS_CHAVE inválida (precisa de 32 bytes em base64). Os dados seguem SEM cifra.');
  }
  _mestra = { bruto, chave };
  _porLoja.clear();
  return chave;
}
const ligado = () => !!mestra();

const _porLoja = new Map();
function chaveDaLoja(tid) {
  const m = mestra(); if (!m) return null;
  const id = String(tid || 'banca');
  if (!_porLoja.has(id)) _porLoja.set(id, Buffer.from(crypto.hkdfSync('sha256', m, SAL, Buffer.from(id), 32)));
  return _porLoja.get(id);
}

const cifrado = (v) => typeof v === 'string' && v.startsWith(PREFIXO);

function cifrarTexto(texto, chave, campo) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  c.setAAD(Buffer.from(String(campo)));
  const corpo = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return PREFIXO + b64u(Buffer.concat([iv, corpo, c.getAuthTag()]));
}
function decifrarTexto(valor, chave, campo) {
  const b = deB64u(valor.slice(PREFIXO.length));
  if (b.length < 28) throw new Error('curto');
  const d = crypto.createDecipheriv('aes-256-gcm', chave, b.subarray(0, 12));
  d.setAAD(Buffer.from(String(campo)));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8');
}

/** Cifra um valor. Vazio, já cifrado ou sem chave configurada: devolve como veio. */
function fechar(valor, tid, campo) {
  if (valor === undefined || valor === null || valor === '' || cifrado(valor)) return valor;
  const k = chaveDaLoja(tid); if (!k) return valor;
  return cifrarTexto(valor, k, campo);
}
/** Abre um valor. Sem prefixo (dado antigo): devolve como está. Sem chave ou chave errada: "(protegido)". */
function abrir(valor, tid, campo) {
  if (!cifrado(valor)) return valor;
  const k = chaveDaLoja(tid);
  if (!k) { if (!_avisou) { _avisou = true; console.error('[cofre] há dados cifrados e o servidor está SEM DADOS_CHAVE.'); } return PROTEGIDO; }
  try { return decifrarTexto(valor, k, campo); } catch (_) { return PROTEGIDO; }
}

/** Cópia do objeto com os campos do cliente cifrados (não altera o original). */
function fecharCampos(obj, tid, campos = CAMPOS) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const c of campos) if (c in out) out[c] = fechar(out[c], tid, c);
  return out;
}
/** Cópia do objeto com os campos do cliente abertos. */
function abrirCampos(obj, tid, campos = CAMPOS) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const c of campos) if (c in out) out[c] = abrir(out[c], tid, c);
  return out;
}

/** Cifra um pedaço inteiro (lista de clientes da previsão, por exemplo) como JSON. Sem chave: devolve como veio. */
function fecharJSON(valor, tid, campo) {
  if (valor === undefined || valor === null) return valor;
  const k = chaveDaLoja(tid); if (!k) return valor;
  return cifrarTexto(JSON.stringify(valor), k, campo);
}
/** Abre o que fecharJSON guardou. Dado antigo (objeto) volta como está; sem chave volta `padrao`. */
function abrirJSON(valor, tid, campo, padrao = null) {
  if (!cifrado(valor)) return valor === undefined ? padrao : valor;
  const k = chaveDaLoja(tid); if (!k) return padrao;
  try { return JSON.parse(decifrarTexto(valor, k, campo)); } catch (_) { return padrao; }
}

/** A chave DESTA loja, para o painel abrir os pedidos no aparelho (só para quem atende). */
function chaveParaPainel(tid) {
  const k = chaveDaLoja(tid);
  return k ? k.toString('base64') : '';
}

module.exports = { PREFIXO, CAMPOS, PROTEGIDO, ligado, cifrado, fechar, abrir, fecharCampos, abrirCampos, fecharJSON, abrirJSON, chaveParaPainel };
