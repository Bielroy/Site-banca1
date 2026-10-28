// =====================================================================
//  functions/_vercel/image.js — REDUTOR DE FOTOS no Cloudflare (no lugar do /_vercel/image da Vercel).
//
//  O site pede /_vercel/image?url=<foto>&w=128|384|828&q=75 (js/foto-lib.js). Aqui a foto é buscada pelo
//  servidor do Cloudflare e devolvida reduzida (WebP) quando o Cloudflare oferece a redução de imagens.
//  Se não oferecer (plano ou endereço sem o recurso), devolve a foto original: a loja funciona igual,
//  só com foto mais pesada. Como a busca é de servidor para servidor, também funciona em redes que
//  bloqueiam o endereço das fotos no celular do cliente.
//
//  Só aceita as mesmas larguras e os mesmos sites de fotos do vercel.json (um teste confere).
//  Qualquer outro endereço é recusado: sem isso este caminho serviria de "abridor de qualquer site".
// =====================================================================
export const LARGURAS = [128, 384, 640, 828];
export const SITES_DE_FOTO = [
  { host: 'i.ibb.co' }, { sufixo: '.ibb.co' }, { host: 'firebasestorage.googleapis.com' }, { sufixo: '.firebasestorage.app' }, { host: 'storage.googleapis.com' },
];
const MAX_BYTES = 8 * 1024 * 1024;
const UM_MES = 2678400;
// Quanto tempo a miniatura (e a busca da foto) fica guardada. Antes era 1 mês "para sempre": quando o ImgBB falhou por
// algumas horas e devolveu a imagem de erro ("imgbb.com service unavailable"), ela ficou guardada no Cloudflare e no
// celular de cada cliente por 30 dias. Agora são poucos dias, e o que parece imagem de erro nem é guardado.
const GUARDAR = 3 * 86400;
const MUITO_PEQUENA = 2048;         // miniatura de verdade de uma foto nunca é menor que isso; imagem de erro com texto, sim

export const siteDeFotoValido = (u) => {
  let x; try { x = new URL(u); } catch (_) { return null; }
  if (x.protocol !== 'https:' || x.username || x.password || (x.port && x.port !== '443')) return null;
  const h = x.hostname.toLowerCase();
  return SITES_DE_FOTO.some((s) => (s.host ? h === s.host : h.endsWith(s.sufixo) && h.length > s.sufixo.length)) ? x : null;
};

const GRANDE = 350 * 1024;          // miniatura de 384/828 px nunca passa disso; acima, a foto veio sem reduzir
/** A foto veio do tamanho original e pesada? (sem o aviso "reduzida" do Cloudflare e grande, ou de tamanho desconhecido) */
export const precisaDeReserva = (r) => {
  if (/internal=ok/i.test(r.headers.get('cf-resized') || '')) return false;
  const n = Number(r.headers.get('content-length'));
  return !(n > 0) || n > GRANDE;
};
/** Miniatura pelo wsrv.nl (redutor público e gratuito). Só para os mesmos sites de foto. null = não deu. */
export async function reduzirPorFora(url, largura) {
  try {
    const r = await fetch(`https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${largura}&q=80&output=webp&we`, { redirect: 'follow', cf: { cacheEverything: true, cacheTtl: GUARDAR } });
    const tipo = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//i.test(tipo)) return null;
    const n = Number(r.headers.get('content-length'));
    if (n > MAX_BYTES) return null;
    return r;
  } catch (_) { return null; }
}

const recusa = (status, msg) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

// ---- A IMAGEM DE ERRO DO IMGBB ("imgbb.com service unavailable") ----
// Quando o ImgBB não entrega um arquivo, ele responde com uma figura azul no lugar da foto. Para o navegador isso é
// "uma imagem que abriu", então a loja mostrava o erro como se fosse a foto. Sinais de que é a figura de erro:
//   - a resposta não é 2xx;
//   - o ImgBB mandou para OUTRO arquivo (redirecionou);
//   - o arquivo é .webp/.jpg/.png e veio de outro tipo (as fotos enviadas pelo painel são todas WebP);
//   - é minúscula.
const TIPO_DA_EXT = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };
export function pareceErro(foto, r) {
  if (!r || !r.ok) return true;
  const tipo = (r.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  if (!/^image\//.test(tipo)) return true;
  const n = Number(r.headers.get('content-length'));
  if (n > 0 && n < MUITO_PEQUENA) return true;
  if (!/\.ibb\.co$|^i\.ibb\.co$/i.test(foto.hostname)) return false;
  if (r.redirected && r.url) { try { if (new URL(r.url).pathname !== foto.pathname) return true; } catch (_) { /* segue */ } }
  if (/internal=ok/i.test(r.headers.get('cf-resized') || '')) return false;          // reduzida pelo Cloudflare: o tipo muda de propósito
  const ext = (foto.pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
  const esperado = ext && TIPO_DA_EXT[ext.toLowerCase()];
  return !!esperado && tipo !== esperado && !(esperado === 'image/jpeg' && tipo === 'image/jpg');
}

// ---- RESGATE: a foto sumiu do ImgBB, mas uma miniatura dela pode ter ficado guardada aqui antes ----
// (as miniaturas eram guardadas por até 1 mês com o endereço antigo, sem "v="). Vale qualquer largura guardada.
async function resgatar(cache, origem, foto, largura) {
  if (!cache) return null;
  const ordem = [largura, ...LARGURAS.filter((w) => w !== largura).sort((a, b) => b - a)];
  const ext = ((foto.pathname.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const chaves = ordem.flatMap((w) => [`${origem}/_vercel/image?url=${encodeURIComponent(foto.href)}&w=${w}`, `${origem}/_vercel/image?v=3&url=${encodeURIComponent(foto.href)}&w=${w}`]);
  for (const k of chaves) {
    let g = null;
    try { g = await cache.match(new Request(k)); } catch (_) { g = null; }
    if (!g) continue;
    const tipo = (g.headers.get('content-type') || '').toLowerCase();
    if (!/^image\//.test(tipo)) continue;
    if (ext === 'webp' && !tipo.startsWith('image/webp')) continue;      // foto WebP guardada em outro tipo = a figura de erro
    const corpo = await g.arrayBuffer().catch(() => null);
    if (!corpo || corpo.byteLength < MUITO_PEQUENA) continue;
    return { corpo, tipo };
  }
  return null;
}

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const largura = Number(q.get('w'));
  const foto = siteDeFotoValido(q.get('url') || '');
  if (!foto) return recusa(400, 'Endereço de foto não permitido.');
  if (!LARGURAS.includes(largura)) return recusa(400, 'Largura não permitida.');

  const origem = new URL(request.url).origin;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const chaveCache = new Request(`${origem}/_vercel/image?v=4&url=${encodeURIComponent(foto.href)}&w=${largura}`);
  if (cache) { const guardada = await cache.match(chaveCache); if (guardada) return guardada; }

  const guardar = async (saida) => { if (cache) { try { await cache.put(chaveCache, saida.clone()); } catch (_) { /* sem cache: só a próxima busca é mais lenta */ } } return saida; };
  const falhou = async () => {
    const salva = await resgatar(cache, origem, foto, largura);
    if (salva) return new Response(salva.corpo, { status: 200, headers: { 'Content-Type': salva.tipo, 'Cache-Control': 'public, max-age=3600', 'X-Foto': 'resgatada', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    return recusa(502, 'A foto não está disponível agora.');           // o navegador cai na reserva (outra versão da foto), nunca na figura de erro
  };

  let r;
  try {
    r = await fetch(foto.href, { redirect: 'follow', cf: { image: { width: largura, quality: 80, format: 'webp', fit: 'scale-down' }, cacheEverything: true, cacheTtl: GUARDAR } });
  } catch (_) { return falhou(); }
  if (pareceErro(foto, r)) { try { await r.body?.cancel(); } catch (_) { /* nada */ } return falhou(); }
  let tipo = r.headers.get('content-type') || '';
  if (Number(r.headers.get('content-length')) > MAX_BYTES) return recusa(413, 'Foto grande demais.');
  // O Cloudflare NÃO reduziu (zona sem "Images → Transformations") e a foto é grande: foto cadastrada por link
  // chega com milhares de pixels. No iPhone, várias dessas na vitrine (faixas + lista) estouram a memória de
  // desenho do Safari, e ele passa a pintar a foto esticada por cima dos vizinhos (o "tomate que cobriu a faixa").
  // Então pede a miniatura a um redutor público (wsrv.nl, servidor para servidor). Falhou? Fica a original, como antes.
  if (precisaDeReserva(r)) {
    const reserva = await reduzirPorFora(foto.href, largura);
    if (reserva && !(Number(reserva.headers.get('content-length')) > 0 && Number(reserva.headers.get('content-length')) < MUITO_PEQUENA)) {
      try { await r.body?.cancel(); } catch (_) { /* nada a cancelar */ } r = reserva; tipo = reserva.headers.get('content-type') || tipo;
    }
  }
  return guardar(new Response(r.body, { status: 200, headers: { 'Content-Type': tipo, 'Cache-Control': `public, max-age=${GUARDAR}`, 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } }));
}
