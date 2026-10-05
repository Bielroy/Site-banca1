'use strict';
// =====================================================================
//  lib/avisos.js — AVISO DE PEDIDO NOVO no celular da equipe (Web Push).
//
//  Padrão aberto dos navegadores (RFC 8030, 8291 e 8292), feito só com o
//  que o Node já tem: nenhuma biblioteca nova e nada para configurar no
//  Firebase. O celular que ligou os avisos fica guardado em
//  {loja}/avisos/{id}; quando chega pedido, o servidor manda a mensagem
//  cifrada para o serviço de avisos do navegador (Google, Apple, Mozilla).
//
//  Variáveis (Vercel):  VAPID_PRIVATE_KEY  (segredo, assina os envios)
//                       VITE_VAPID_PUBLIC_KEY  (pública, vai no navegador)
//  Sem elas, os avisos ficam desligados e o resto do site segue igual.
// =====================================================================
const crypto = require('crypto');
const T = require('./tenant');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const MAX_POR_LOJA = 40;

// Só serviços de aviso conhecidos: o endereço vem do navegador, e o servidor não deve
// sair chamando qualquer lugar da internet que alguém escrever ali.
const HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];
function assinaturaValida(a) {
  if (!a || typeof a.endpoint !== 'string' || a.endpoint.length > 1000) return false;
  let u; try { u = new URL(a.endpoint); } catch (_) { return false; }
  if (u.protocol !== 'https:' || !HOSTS.some((h) => h.test(u.hostname))) return false;
  const k = a.keys || {};
  return typeof k.p256dh === 'string' && deB64u(k.p256dh).length === 65 && typeof k.auth === 'string' && deB64u(k.auth).length === 16;
}

const chaves = () => {
  const priv = (process.env.VAPID_PRIVATE_KEY || '').trim(), pub = (process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '').trim();
  return priv && pub && deB64u(priv).length === 32 && deB64u(pub).length === 65 ? { priv, pub } : null;
};
const ligado = () => !!chaves();

/** Cifra o texto para UM aparelho (RFC 8291, aes128gcm). `efemera` e `sal` só são passados nos testes. */
function cifrar(texto, p256dh, auth, efemera, sal) {
  const ua = deB64u(p256dh), segredo = deB64u(auth);
  const ecdh = efemera || crypto.createECDH('prime256v1'); if (!efemera) ecdh.generateKeys();
  const as = ecdh.getPublicKey(), comum = ecdh.computeSecret(ua), salt = sal || crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', comum, segredo, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const corpo = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const cab = Buffer.alloc(21); salt.copy(cab, 0); cab.writeUInt32BE(4096, 16); cab[20] = as.length;
  return Buffer.concat([cab, as, corpo]);
}

/** Crachá do servidor para o serviço de avisos (RFC 8292): diz quem está mandando, assinado com a chave privada. */
function cracha(endpoint, { priv, pub }, agora = Date.now()) {
  const x = deB64u(pub);
  const chave = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(x.subarray(1, 33)), y: b64u(x.subarray(33, 65)) } });
  const base = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(agora / 1000) + 12 * 3600, sub: 'mailto:avisos@site-banca1.vercel.app' }))}`;
  const ass = crypto.sign('sha256', Buffer.from(base), { key: chave, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${base}.${b64u(ass)}, k=${pub}`;
}

async function enviar(a, dados) {
  const k = chaves(); if (!k) return { ok: false, status: 0 };
  const ctl = new AbortController(), relogio = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(a.endpoint, { method: 'POST', signal: ctl.signal, body: cifrar(JSON.stringify(dados), a.keys.p256dh, a.keys.auth),
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high', Authorization: cracha(a.endpoint, k) } });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch (_) { return { ok: false, status: 0 }; }
  finally { clearTimeout(relogio); }
}

const idDe = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

async function ligar(db, tid, dec, assinatura) {
  if (!assinaturaValida(assinatura)) throw Object.assign(new Error('Este aparelho não devolveu um endereço de aviso válido.'), { status: 400 });
  const ref = T.tdoc(db, tid, 'avisos', idDe(assinatura.endpoint));
  if (!(await ref.get()).exists && (await T.tcol(db, tid, 'avisos').get()).size >= MAX_POR_LOJA) throw Object.assign(new Error(`A loja chegou ao limite de ${MAX_POR_LOJA} aparelhos com aviso.`), { status: 400 });
  await ref.set({ uid: dec.uid, email: dec.email || '', endpoint: assinatura.endpoint, keys: { p256dh: assinatura.keys.p256dh, auth: assinatura.keys.auth }, em: new Date().toISOString() });
}
async function desligar(db, tid, endpoint) {
  if (typeof endpoint === 'string' && endpoint) await T.tdoc(db, tid, 'avisos', idDe(endpoint)).delete();
}

/**
 * Avisa todos os aparelhos da loja. Nunca lança erro e nunca demora mais que ~3 s:
 * um aviso que falha não pode derrubar o pedido que acabou de ser gravado.
 */
async function avisarLoja(db, tid, dados) {
  if (!ligado()) return { enviados: 0 };
  try {
    const s = await T.tcol(db, tid, 'avisos').get();
    const res = await Promise.all(s.docs.map(async (d) => ({ d, r: await enviar(d.data(), dados) })));
    // 404/410 = o aparelho desligou os avisos ou desinstalou: sai da lista
    await Promise.all(res.filter((x) => x.r.status === 404 || x.r.status === 410).map((x) => x.d.ref.delete().catch(() => {})));
    return { enviados: res.filter((x) => x.r.ok).length };
  } catch (e) { console.error('[avisos]', e && e.message); return { enviados: 0 }; }
}

module.exports = { ligado, ligar, desligar, avisarLoja, assinaturaValida, cifrar, cracha, idDe, b64u, deB64u };
