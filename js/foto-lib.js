// =====================================================================
//  js/foto-lib.js — MINIATURA DAS FOTOS DA VITRINE.
//
//  Foto cadastrada por link (sem passar pelo envio do painel) chega no
//  tamanho original, às vezes com milhares de pixels, para aparecer num
//  quadradinho de 200. No celular isso pesa: ao rolar rápido o aparelho
//  joga fora as fotos grandes da memória e precisa abri-las de novo, e é
//  aí que elas "somem e voltam".
//
//  A Vercel sabe reduzir imagem sozinha (/_vercel/image). Aqui só montamos
//  o endereço. Se por qualquer motivo a miniatura falhar, a loja volta para
//  a foto original (ver o ouvinte de erro em js/loja.js).
//  Arquivo puro (sem navegador), para os testes poderem conferir.
// =====================================================================

/** Larguras aceitas — têm de ser as MESMAS de vercel.json ("images.sizes"). */
export const LARGURAS = [128, 384];

const LOCAL = /^(localhost|127\.|192\.168\.|10\.|\[::1\])/;

/**
 * De ONDE aceitamos reduzir foto: os serviços onde as lojas guardam as fotos (ImgBB e o armazenamento do Firebase).
 * Têm de ser os MESMOS de vercel.json ("images.remotePatterns"); um teste confere.
 * Antes o redutor aceitava qualquer endereço da internet: qualquer pessoa podia usar o site como atravessador
 * de imagens e gastar a cota de redução da loja. Foto guardada em outro lugar continua aparecendo, só que no
 * tamanho original.
 */
export const HOSTS_DAS_FOTOS = ['i.ibb.co', '**.ibb.co', 'firebasestorage.googleapis.com', '**.firebasestorage.app', 'storage.googleapis.com'];
const hostAceito = (h) => HOSTS_DAS_FOTOS.some((p) => (p.startsWith('**.') ? h.endsWith(p.slice(2)) && h.length > p.length - 2 : h === p));

/** Endereço da miniatura de uma foto. Devolve a própria foto quando não dá para reduzir. */
export function miniatura(url, largura = 384, host = (typeof location !== 'undefined' ? location.hostname : '')) {
    const u = String(url || '');
    if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;             // data:, blob:, http: ou vazio: fica como está
    if (!host || LOCAL.test(host)) return u;                       // no computador de quem desenvolve não existe o redutor
    if (/\.svg(\?|#|$)/i.test(u)) return u;                        // desenho vetorial já é leve
    let deOnde = ''; try { deOnde = new URL(u).hostname.toLowerCase(); } catch (_) { return u; }
    if (!hostAceito(deOnde)) return u;                             // guardada em outro lugar: aparece no tamanho original
    const w = LARGURAS.includes(largura) ? largura : 384;
    return `/_vercel/image?url=${encodeURIComponent(u)}&w=${w}&q=75`;
}
