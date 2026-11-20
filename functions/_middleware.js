// =====================================================================
//  functions/_middleware.js — O CARTÃO DO LINK DE CADA LOJA (Cloudflare Pages).
//
//  Quem colava no WhatsApp o link do Pastel & Açaí do Bié (usebanca.com/?loja=...) via o cartão da
//  Banca Adair e Pedrina: o WhatsApp não roda o JavaScript da loja, ele só lê as etiquetas <meta og:...>
//  do index.html, que são as da loja original.
//
//  Aqui, SÓ quando quem pede a página é o robô de prévia (WhatsApp, Facebook, Telegram...) e o endereço
//  é de outra loja, as etiquetas são trocadas pelas da loja: nome, frase e foto de capa (ou logo).
//  O cliente de verdade recebe a página igual, sem esperar nada a mais.
//  A ficha da loja é pública (firestore.rules: tenants/{id} "allow get: if true") e fica 10 minutos guardada.
// =====================================================================
const ROBOS = /whatsapp|facebookexternalhit|facebot|meta-externalagent|twitterbot|telegrambot|slackbot|discordbot|linkedinbot|skypeuripreview|pinterest|googlebot|bingbot|applebot|embedly|redditbot|iframely|vkshare|snapchat|ia_archiver|preview/i;
const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PROJETO_PADRAO = 'banca-adair-e-pedrina';

export const ehRobo = (ua) => ROBOS.test(String(ua || ''));
const limpo = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const urlFoto = (v) => { const u = String(v || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) && u.length < 1500 ? u : ''; };

/** Documento do Firestore (REST) → { nome, descricao, imagem } ou null (loja não existe ou está desligada). */
export function fichaParaCartao(doc) {
  const f = (doc && doc.fields) || {};
  const s = (x) => (x && typeof x.stringValue === 'string' ? x.stringValue : '');
  if (f.ativo && f.ativo.booleanValue === false) return null;
  const nome = limpo(s(f.nome), 70);
  if (!nome) return null;
  const tema = (f.tema && f.tema.mapValue && f.tema.mapValue.fields) || {};
  const sub = limpo(s(f.subtitulo), 150);
  return {
    nome,
    descricao: sub || `Peça na ${nome} pelo celular e receba sem complicação.`,
    imagem: urlFoto(s(tema.capa)) || urlFoto(s(tema.logo)) || urlFoto(s(f.foto)),
  };
}

async function fichaDaLoja(id, env, ctx) {
  const projeto = ID.test(String(env.FIREBASE_PROJECT_ID || '')) ? env.FIREBASE_PROJECT_ID : PROJETO_PADRAO;
  const endereco = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/tenants/${id}`;
  const cache = typeof caches !== 'undefined' ? caches.default : null, chave = new Request(`https://cartao.cache/${projeto}/${id}`);
  try {
    const guardado = cache && (await cache.match(chave));
    if (guardado) return fichaParaCartao(await guardado.json());
    const r = await fetch(endereco, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const doc = await r.json();
    if (cache) ctx.waitUntil(cache.put(chave, new Response(JSON.stringify(doc), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' } })));
    return fichaParaCartao(doc);
  } catch (_) { return null; }   // sem resposta: fica o cartão de sempre
}

const trocar = (valor) => ({ element(el) { el.setAttribute('content', valor); } });
const tirar = { element(el) { el.remove(); } };

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  if (request.method !== 'GET') return next();
  const url = new URL(request.url);
  if (url.pathname !== '/' && url.pathname !== '/index.html') return next();
  const id = (url.searchParams.get('loja') || '').toLowerCase();
  if (!ID.test(id) || id === 'banca' || !ehRobo(request.headers.get('user-agent'))) return next();

  const [resp, ficha] = await Promise.all([next(), fichaDaLoja(id, env, ctx)]);
  if (!ficha || !(resp.headers.get('content-type') || '').includes('text/html')) return resp;

  const link = `${url.origin}/?loja=${encodeURIComponent(id)}`, titulo = ficha.nome;
  let r = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(titulo); } })
    .on('meta[name="description"]', trocar(ficha.descricao))
    .on('meta[property="og:site_name"]', trocar(ficha.nome))
    .on('meta[property="og:title"]', trocar(titulo))
    .on('meta[property="og:description"]', trocar(ficha.descricao))
    .on('meta[property="og:url"]', trocar(link))
    .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', link); } })
    .on('meta[name="twitter:title"]', trocar(titulo))
    .on('meta[name="twitter:description"]', trocar(ficha.descricao));
  // sem foto da loja, SEM foto (nunca a foto da Banca Adair no cartão de outra loja)
  r = ficha.imagem
    ? r.on('meta[property="og:image"]', trocar(ficha.imagem)).on('meta[name="twitter:image"]', trocar(ficha.imagem))
       .on('meta[property="og:image:width"]', tirar).on('meta[property="og:image:height"]', tirar).on('meta[property="og:image:alt"]', tirar)
    : r.on('meta[property^="og:image"]', tirar).on('meta[name="twitter:image"]', tirar);
  const saida = r.transform(resp);
  const h = new Headers(saida.headers); h.set('Cache-Control', 'no-store'); h.append('Vary', 'User-Agent');
  return new Response(saida.body, { status: saida.status, headers: h });
}
