// =====================================================================
//  functions/_vercel/image.js — REDUTOR DE FOTOS no Cloudflare (no lugar do /_vercel/image da Vercel).
//
//  O site pede /_vercel/image?url=<foto>&w=128|384&q=75 (js/foto-lib.js). Aqui a foto é buscada pelo
//  servidor do Cloudflare e devolvida reduzida (WebP) quando o Cloudflare oferece a redução de imagens.
//  Se não oferecer (plano ou endereço sem o recurso), devolve a foto original: a loja funciona igual,
//  só com foto mais pesada. Como a busca é de servidor para servidor, também funciona em redes que
//  bloqueiam o endereço das fotos no celular do cliente.
//
//  Só aceita as mesmas larguras e os mesmos sites de fotos do vercel.json (um teste confere).
//  Qualquer outro endereço é recusado: sem isso este caminho serviria de "abridor de qualquer site".
// =====================================================================
export const LARGURAS = [128, 384];
export const SITES_DE_FOTO = [
  { host: 'i.ibb.co' }, { sufixo: '.ibb.co' }, { host: 'firebasestorage.googleapis.com' }, { sufixo: '.firebasestorage.app' }, { host: 'storage.googleapis.com' },
];
const MAX_BYTES = 8 * 1024 * 1024;
const UM_MES = 2678400;

export const siteDeFotoValido = (u) => {
  let x; try { x = new URL(u); } catch (_) { return null; }
  if (x.protocol !== 'https:' || x.username || x.password || (x.port && x.port !== '443')) return null;
  const h = x.hostname.toLowerCase();
  return SITES_DE_FOTO.some((s) => (s.host ? h === s.host : h.endsWith(s.sufixo) && h.length > s.sufixo.length)) ? x : null;
};

const recusa = (status, msg) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const largura = Number(q.get('w'));
  const foto = siteDeFotoValido(q.get('url') || '');
  if (!foto) return recusa(400, 'Endereço de foto não permitido.');
  if (!LARGURAS.includes(largura)) return recusa(400, 'Largura não permitida.');

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const chaveCache = new Request(`${new URL(request.url).origin}/_vercel/image?url=${encodeURIComponent(foto.href)}&w=${largura}`);
  if (cache) { const guardada = await cache.match(chaveCache); if (guardada) return guardada; }

  let r;
  try {
    r = await fetch(foto.href, { redirect: 'follow', cf: { image: { width: largura, quality: 75, format: 'webp', fit: 'scale-down' }, cacheEverything: true, cacheTtl: UM_MES } });
  } catch (_) { return recusa(502, 'Não consegui buscar a foto.'); }
  const tipo = r.headers.get('content-type') || '';
  if (!r.ok || !/^image\//i.test(tipo)) return recusa(r.ok ? 415 : 502, 'A foto não está disponível.');
  if (Number(r.headers.get('content-length')) > MAX_BYTES) return recusa(413, 'Foto grande demais.');

  const saida = new Response(r.body, { status: 200, headers: { 'Content-Type': tipo, 'Cache-Control': `public, max-age=${UM_MES}, immutable`, 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
  if (cache) { try { await cache.put(chaveCache, saida.clone()); } catch (_) { /* sem cache: só a próxima busca é mais lenta */ } }
  return saida;
}
