'use strict';
// =====================================================================
//  lib/passkey.js — ENTRAR NO PAINEL COM FACE ID / DIGITAL (passkey, WebAuthn).
//
//  Por que existe: o link de entrada chega por e-mail, vence em pouco tempo e, no spam, o Gmail e o iCloud
//  desligam o link. Depois da PRIMEIRA entrada pelo link, o aparelho guarda uma "chave de acesso" (passkey)
//  protegida pelo Face ID, pela digital ou pelo bloqueio de tela. Nas próximas vezes: um toque e pronto.
//  No iPhone a chave fica no Chaves do iCloud e vale também no iPad e no Mac da mesma conta Apple.
//
//  Só a verificação mora aqui, sem biblioteca de fora (crypto do Node): o aparelho assina um desafio com a
//  chave privada (que nunca sai dele); aqui conferimos a assinatura com a chave pública guardada no cadastro.
//  Algoritmos aceitos: ES256 (-7, o do iPhone/Android/Windows) e RS256 (-257, Windows antigo).
//
//  O DESAFIO não fica no banco: é um texto assinado pelo servidor (HMAC) com tipo, conta e validade.
//  O uso único é garantido na entrada (api/passkey.js grava o desafio usado e recusa repetir).
// =====================================================================
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const deB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const falha = (msg) => Object.assign(new Error(msg), { status: 400 });
const VALIDADE_MS = 5 * 60 * 1000;
const ALGS = [-7, -257];

// ---------------------------------------------------------------- CBOR mínimo (só o que a WebAuthn usa)
function lerCbor(buf, inicio = 0) {
  let i = inicio;
  const byte = () => { if (i >= buf.length) throw falha('Resposta do aparelho incompleta.'); return buf[i++]; };
  const item = (prof) => {
    if (prof > 8) throw falha('Resposta do aparelho estranha.');
    const ib = byte(), mt = ib >> 5, ai = ib & 31;
    const arg = () => {
      if (ai < 24) return ai;
      if (ai === 24) return byte();
      if (ai === 25) { const v = buf.readUInt16BE(i); i += 2; return v; }
      if (ai === 26) { const v = buf.readUInt32BE(i); i += 4; return v; }
      if (ai === 27) { const v = Number(buf.readBigUInt64BE(i)); i += 8; return v; }
      throw falha('Resposta do aparelho estranha.');
    };
    switch (mt) {
      case 0: return arg();
      case 1: return -1 - arg();
      case 2: case 3: {
        const n = arg(); if (i + n > buf.length) throw falha('Resposta do aparelho incompleta.');
        const v = buf.subarray(i, i + n); i += n; return mt === 2 ? Buffer.from(v) : v.toString('utf8');
      }
      case 4: { const n = arg(); if (n > 64) throw falha('Resposta do aparelho estranha.'); const a = []; for (let k = 0; k < n; k++) a.push(item(prof + 1)); return a; }
      case 5: { const n = arg(); if (n > 64) throw falha('Resposta do aparelho estranha.'); const m = new Map(); for (let k = 0; k < n; k++) { const ch = item(prof + 1); m.set(ch, item(prof + 1)); } return m; }
      case 7: if (ai === 20) return false; if (ai === 21) return true; if (ai === 22) return null; throw falha('Resposta do aparelho estranha.');
      default: throw falha('Resposta do aparelho estranha.');
    }
  };
  const valor = item(0);
  return { valor, fim: i };
}

// ---------------------------------------------------------------- dados do aparelho
/** authenticatorData: hash do site, sinais (presença, verificação), contador e, no cadastro, a chave pública. */
function lerAuthData(ad) {
  if (!Buffer.isBuffer(ad) || ad.length < 37) throw falha('Resposta do aparelho incompleta.');
  const sinais = ad[32], out = { rpIdHash: ad.subarray(0, 32), presente: !!(sinais & 1), verificado: !!(sinais & 4), contador: ad.readUInt32BE(33) };
  if (sinais & 0x40) {
    if (ad.length < 55) throw falha('Resposta do aparelho incompleta.');
    const n = ad.readUInt16BE(53);
    if (n < 16 || n > 1023 || ad.length < 55 + n) throw falha('Resposta do aparelho estranha.');
    out.credId = Buffer.from(ad.subarray(55, 55 + n));
    out.cose = lerCbor(ad, 55 + n).valor;
  }
  return out;
}

/** Chave pública no formato COSE (do aparelho) → JWK (para o crypto do Node). */
function coseParaJwk(cose) {
  if (!(cose instanceof Map)) throw falha('Chave do aparelho estranha.');
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = cose.get(-2), y = cose.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw falha('Chave do aparelho estranha.');
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) } };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1), e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) throw falha('Chave do aparelho estranha.');
    return { alg: -257, jwk: { kty: 'RSA', n: b64u(n), e: b64u(e) } };
  }
  throw falha('Este aparelho usa um tipo de chave que o painel não aceita.');
}

/** clientDataJSON: confere o tipo (cadastro/entrada), o desafio e o site de onde veio. Devolve o desafio (texto). */
function conferirClientData(bruto, tipo, origens) {
  let cd; try { cd = JSON.parse(deB64u(bruto).toString('utf8')); } catch (_) { throw falha('Resposta do aparelho estranha.'); }
  if (!cd || cd.type !== tipo) throw falha('Resposta do aparelho fora de ordem.');
  if (!origens.includes(cd.origin)) throw falha('Esta chave é de outro site.');
  if (cd.crossOrigin === true) throw falha('Resposta do aparelho estranha.');
  return deB64u(cd.challenge).toString('utf8');
}

// ---------------------------------------------------------------- desafio assinado (sem banco)
const chaveHmac = (segredo) => sha256(Buffer.from(`passkey|${segredo || ''}`));
/** Novo desafio: texto "dados.assinatura". t = 'cadastro' | 'entrada'; u = conta (só no cadastro). */
function novoDesafio(segredo, t, u = '', agora = Date.now()) {
  const dados = b64u(JSON.stringify({ t, u, e: agora + VALIDADE_MS, n: b64u(crypto.randomBytes(16)) }));
  return `${dados}.${b64u(crypto.createHmac('sha256', chaveHmac(segredo)).update(dados).digest())}`;
}
/** Confere o desafio que o aparelho assinou: nosso, do tipo certo, da conta certa e dentro da validade. */
function conferirDesafio(segredo, texto, t, u = '', agora = Date.now()) {
  const [dados, ass] = String(texto || '').split('.');
  if (!dados || !ass) throw falha('Desafio inválido. Tente de novo.');
  const certa = crypto.createHmac('sha256', chaveHmac(segredo)).update(dados).digest(), veio = deB64u(ass);
  if (veio.length !== certa.length || !crypto.timingSafeEqual(veio, certa)) throw falha('Desafio inválido. Tente de novo.');
  let d; try { d = JSON.parse(deB64u(dados).toString('utf8')); } catch (_) { throw falha('Desafio inválido. Tente de novo.'); }
  if (d.t !== t || (u && d.u !== u)) throw falha('Desafio inválido. Tente de novo.');
  if (!(Number(d.e) > agora)) throw falha('Demorou demais. Toque de novo para entrar.');
  return d;
}

// ---------------------------------------------------------------- cadastro e entrada
/**
 * Cadastro (o aparelho criou uma chave nova). resposta = { id, rawId, response: { clientDataJSON, attestationObject } } em base64url.
 * Devolve { credId, jwk, alg, contador }.
 */
function verificarCadastro({ resposta, segredo, uid, origens, rpId, agora = Date.now() }) {
  const r = (resposta && resposta.response) || {};
  conferirDesafio(segredo, conferirClientData(r.clientDataJSON, 'webauthn.create', origens), 'cadastro', uid, agora);
  const att = lerCbor(deB64u(r.attestationObject)).valor;
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw falha('Resposta do aparelho estranha.');
  const ad = lerAuthData(att.get('authData'));
  if (!ad.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw falha('Esta chave é de outro site.');
  if (!ad.presente || !ad.verificado) throw falha('O aparelho não confirmou com Face ID, digital ou senha da tela.');
  if (!ad.credId || !ad.cose) throw falha('O aparelho não mandou a chave.');
  if (resposta.id && b64u(ad.credId) !== resposta.id) throw falha('Resposta do aparelho estranha.');
  const { alg, jwk } = coseParaJwk(ad.cose);
  crypto.createPublicKey({ key: jwk, format: 'jwk' });            // chave que não abre = recusa já
  return { credId: b64u(ad.credId), jwk, alg, contador: ad.contador };
}

/**
 * Entrada (o aparelho assinou o desafio). chave = o que foi guardado no cadastro ({ jwk, alg, contador }).
 * Devolve { contador, desafio } (o desafio, para gravar como usado).
 */
function verificarEntrada({ resposta, segredo, chave, origens, rpId, agora = Date.now() }) {
  const r = (resposta && resposta.response) || {};
  const texto = conferirClientData(r.clientDataJSON, 'webauthn.get', origens);
  conferirDesafio(segredo, texto, 'entrada', '', agora);
  const adBruto = deB64u(r.authenticatorData), ad = lerAuthData(adBruto);
  if (!ad.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw falha('Esta chave é de outro site.');
  if (!ad.presente || !ad.verificado) throw falha('O aparelho não confirmou com Face ID, digital ou senha da tela.');
  if (!chave || !chave.jwk || !ALGS.includes(chave.alg)) throw falha('Chave não encontrada.');
  const dados = Buffer.concat([adBruto, sha256(deB64u(r.clientDataJSON))]);
  const pub = crypto.createPublicKey({ key: chave.jwk, format: 'jwk' }), ass = deB64u(r.signature);
  const ok = chave.alg === -257 ? crypto.verify('sha256', dados, pub, ass) : crypto.verify('sha256', dados, { key: pub, dsaEncoding: 'der' }, ass);
  if (!ok) throw falha('A assinatura do aparelho não confere.');
  // contador: aparelho que conta (chave física) não pode voltar para trás (seria uma cópia). iPhone e Android mandam sempre 0.
  const antes = Number(chave.contador) || 0;
  if ((ad.contador > 0 || antes > 0) && ad.contador <= antes) throw falha('Esta chave parece copiada. Entre pelo link do e-mail.');
  return { contador: ad.contador, desafio: texto };
}

/** O site (rpId) é o domínio de onde o painel foi aberto, se for um dos nossos; senão, o primeiro da lista. */
function siteDe(origem, permitidas) {
  const o = permitidas.includes(origem) ? origem : permitidas[0];
  try { return { origem: o, rpId: new URL(o).hostname }; } catch (_) { return { origem: o, rpId: 'localhost' }; }
}

/** Apaga as chaves de uma conta (usado por "Sair de todos os aparelhos" em api/equipe.js). Devolve quantas. */
async function apagarDaConta(db, uid) {
  const s = await db.collection('passkeys').where('uid', '==', uid).get();
  await Promise.all(s.docs.map((d) => d.ref.delete().catch(() => {})));
  return s.size;
}

/** Faxina da noite: o desafio já usado só precisa ficar enquanto ele ainda valeria (5 min); guarda 1 dia e apaga o resto (até 300 por rodada). */
async function limparUsados(db, agora = Date.now()) {
  try {
    const s = await db.collection('passkey_usados').where('em', '<', new Date(agora - 86400000).toISOString()).get();
    const velhos = s.docs.slice(0, 300);
    await Promise.all(velhos.map((d) => d.ref.delete().catch(() => {})));
    return velhos.length;
  } catch (e) { console.error('[passkey] faxina', e && e.message); return 0; }
}

module.exports = { apagarDaConta, limparUsados, lerCbor, lerAuthData, coseParaJwk, novoDesafio, conferirDesafio, verificarCadastro, verificarEntrada, siteDe, b64u, deB64u, sha256, VALIDADE_MS, ALGS };
