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

/** Endereço da miniatura de uma foto. Devolve a própria foto quando não dá para reduzir. */
export function miniatura(url, largura = 384, host = (typeof location !== 'undefined' ? location.hostname : '')) {
    const u = String(url || '');
    if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;             // data:, blob:, http: ou vazio: fica como está
    if (!host || LOCAL.test(host)) return u;                       // no computador de quem desenvolve não existe o redutor
    if (/\.svg(\?|#|$)/i.test(u)) return u;                        // desenho vetorial já é leve
    const w = LARGURAS.includes(largura) ? largura : 384;
    return `/_vercel/image?url=${encodeURIComponent(u)}&w=${w}&q=75`;
}
