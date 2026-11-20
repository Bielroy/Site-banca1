// =====================================================================
//  js/foto-termica-lib.js — FOTO no papel da térmica (tela "Impressora" → "Foto").
//
//  A térmica só tem preto e branco. Este arquivo transforma a foto (em cinza, um número
//  por ponto: 0 preto … 255 branco) em pontos pretos, de dois jeitos:
//    texto  lista escrita à mão ou print de conversa. Tira a sombra e o papel amarelado
//           (cada ponto é comparado com o fundo em volta) e fica só a tinta, bem nítida.
//    foto   imagem com tons. Estica o contraste e usa pontilhado (os tons viram pontinhos).
//  "clareza" (0 a 100, meio = 50) clareia ou escurece o resultado.
//  Os comandos para a impressora saem de rasterEscPos (js/rotulo-lib.js).
//  Sem tela nem navegador aqui: dá para testar no Node.
// =====================================================================
import { pontilhar } from './rotulo-lib.js';

/** Pontos por linha de cada bobina (8 pontos por mm, área útil de 48 e 72 mm). */
export const PONTOS = { 58: 384, 80: 576 };
/** Altura máxima: 2400 pontos = 30 cm de papel. Foto mais comprida é reduzida inteira. */
export const ALTURA_MAX = 2400;
export const pontosDaLargura = (largura) => PONTOS[largura] || PONTOS[80];

/** Tamanho em pontos para uma foto w0 × h0 na bobina. Nunca passa da largura nem de ALTURA_MAX. */
export function tamanhoNoPapel(w0, h0, largura) {
    const max = pontosDaLargura(largura), W = Math.max(1, Number(w0) || 1), H = Math.max(1, Number(h0) || 1);
    let w = max, h = Math.round(H * (max / W));
    if (h > ALTURA_MAX) { w = Math.max(8, Math.round(W * (ALTURA_MAX / H))); h = ALTURA_MAX; }
    return { w, h: Math.max(1, h) };
}

const limitar = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clarezaOk = (c) => { const n = Number(c); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50; };

/** Média do cinza em volta de cada ponto (quadrado de lado 2r+1), com a soma acumulada: rápido em foto grande. */
export function fundoEmVolta(cinza, w, h, r) {
    const soma = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        let linha = 0;
        for (let x = 0; x < w; x++) { linha += cinza[y * w + x]; soma[(y + 1) * (w + 1) + x + 1] = soma[y * (w + 1) + x + 1] + linha; }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
            const s = soma[y1 * (w + 1) + x1] - soma[y0 * (w + 1) + x1] - soma[y1 * (w + 1) + x0] + soma[y0 * (w + 1) + x0];
            out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
        }
    }
    return out;
}

/** Lista escrita / print de conversa: tinta preta sobre papel branco, sem a sombra da foto. */
function comoTexto(cinza, w, h, clareza) {
    const fundo = fundoEmVolta(cinza, w, h, Math.max(8, Math.round(w / 24)));
    const corte = 0.9 - (clareza - 50) * 0.004;            // 50 → 0.90 do fundo; mais clareza, menos tinta
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = cinza[i] < fundo[i] * corte - 4 ? 1 : 0;
    return out;
}

/** Foto com tons: contraste esticado (2% mais escuros viram preto, 2% mais claros viram branco) e pontilhado. */
function comoFoto(cinza, w, h, clareza) {
    const hist = new Uint32Array(256); for (let i = 0; i < w * h; i++) hist[cinza[i] | 0]++;
    const corte = Math.floor(w * h * 0.02); let baixo = 0, alto = 255;
    for (let a = 0, v = 0; v < 256; v++) { a += hist[v]; if (a > corte) { baixo = v; break; } }
    for (let a = 0, v = 255; v >= 0; v--) { a += hist[v]; if (a > corte) { alto = v; break; } }
    if (alto - baixo < 16) { baixo = Math.max(0, baixo - 8); alto = Math.min(255, alto + 8); }
    const gama = 2 ** ((clareza - 50) / 50);                  // 0 → mais escuro, 100 → mais claro
    const ajust = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) ajust[i] = 255 * ((limitar((cinza[i] - baixo) * 255 / (alto - baixo)) / 255) ** (1 / gama));
    return pontilhar(ajust, w, h);
}

/**
 * Cinza → pontos pretos (Uint8Array, 1 = preto).
 * modo: 'texto' (padrão) | 'foto'.  clareza: 0 a 100 (50 = como veio).
 */
export function prepararFoto(cinza, w, h, { modo = 'texto', clareza = 50 } = {}) {
    if (!cinza || w < 1 || h < 1 || cinza.length < w * h) return new Uint8Array(0);
    const c = clarezaOk(clareza);
    return modo === 'foto' ? comoFoto(cinza, w, h, c) : comoTexto(cinza, w, h, c);
}

/** Quanto do papel ficou preto (0 a 1). Mais de 60%: foto escura demais, gasta a bobina e não se lê. */
export function tintaUsada(pontos) {
    if (!pontos || !pontos.length) return 0;
    let n = 0; for (let i = 0; i < pontos.length; i++) n += pontos[i]; return n / pontos.length;
}
