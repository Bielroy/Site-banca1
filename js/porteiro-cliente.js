// =====================================================================
//  js/porteiro-cliente.js — O DESAFIO DO PORTEIRO NO NAVEGADOR (o servidor confere em lib/porteiro.js).
//
//  Ao abrir a tela de entrada, o painel pede um desafio e, quando a pessoa toca em "Receber link", procura um
//  número que, junto com o desafio e o e-mail, dá um resumo SHA-256 começando com N bits zero.
//  Leva de instantes a poucos segundos num celular, sem a pessoa fazer nada; para um robô que tenta milhares
//  de vezes, o custo soma. O resumo é feito aqui mesmo (sem biblioteca de fora), em pedaços, para a tela
//  não travar. A conta tem de dar igual à do servidor (um teste confere).
// =====================================================================

// ---------------------------------------------------------------- SHA-256 (texto ASCII/UTF-8)
const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** SHA-256 de bytes; devolve os 8 números de 32 bits do resumo. */
function sha256Palavras(bytes) {
    const n = bytes.length, total = (((n + 9) + 63) >> 6) << 6, m = new Uint8Array(total);
    m.set(bytes); m[n] = 0x80;
    const bits = n * 8;
    m[total - 4] = (bits >>> 24) & 255; m[total - 3] = (bits >>> 16) & 255; m[total - 2] = (bits >>> 8) & 255; m[total - 1] = bits & 255;
    m[total - 5] = Math.floor(bits / 2 ** 32) & 255;
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (let o = 0; o < total; o += 64) {
        for (let i = 0; i < 16; i++) W[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x >>> 0);
}
const utf8 = (t) => new TextEncoder().encode(t);
export const sha256Hex = (texto) => sha256Palavras(utf8(texto)).map((x) => x.toString(16).padStart(8, '0')).join('');
/** Bits zero no começo do resumo. */
function bitsZero(p) {
    let n = 0;
    for (const x of p) { if (x === 0) { n += 32; continue; } return n + Math.clz32(x); }
    return n;
}

/** Procura a resposta do desafio, em pedaços (a tela continua respondendo). */
export async function resolver(desafio, email, dificuldade, { pedaco = 4000 } = {}) {
    const prefixo = utf8(sha256Hex(`${desafio}|${String(email || '').trim().toLowerCase()}`));
    const buf = new Uint8Array(prefixo.length + 12); buf.set(prefixo);
    for (let n = 0; n < 2 ** 30;) {
        const fim = n + pedaco;
        for (; n < fim; n++) {
            const s = String(n);
            for (let i = 0; i < s.length; i++) buf[prefixo.length + i] = s.charCodeAt(i);
            if (bitsZero(sha256Palavras(buf.subarray(0, prefixo.length + s.length))) >= dificuldade) return s;
        }
        await new Promise((r) => setTimeout(r, 0));
    }
    return '';
}

// ---------------------------------------------------------------- conversa com o servidor
let guardado = null;          // { desafio, dificuldade, em, validade }
async function pedirDesafio(email = '', aparelho = '') {
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'porteiro', ...(email ? { email } : {}), ...(aparelho ? { aparelho } : {}) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Não consegui agora. Tente de novo.'), { status: r.status });
    return { desafio: j.desafio, dificuldade: j.dificuldade, em: Date.now(), validade: j.validade || 600000 };
}

/** Ao abrir a tela de entrada: já pede o desafio (o tempo desde a abertura também conta). */
export function prepararPorteiro() {
    pedirDesafio().then((d) => { guardado = d; }).catch(() => { guardado = null; });
}

/**
 * Resolve um desafio para este e-mail e devolve { desafio, solucao }.
 * maisPesado = { dificuldade } quando o servidor pediu outro (a pontuação subiu): pede um novo já com o e-mail.
 */
export async function provaPara(email, aparelho = '', maisPesado = null) {
    let d = guardado; guardado = null;
    const vencido = !d || Date.now() - d.em > d.validade - 60000;
    if (maisPesado || vencido) d = await pedirDesafio(email, aparelho);
    // servidor antigo (sem porteiro) ou resposta estranha: segue sem desafio; quem decide é o servidor
    if (!d || typeof d.desafio !== 'string' || !d.desafio || !(d.dificuldade >= 1 && d.dificuldade <= 24)) { prepararPorteiro(); return { desafio: '', solucao: '' }; }
    const solucao = await resolver(d.desafio, email, d.dificuldade);
    prepararPorteiro();                       // já deixa o próximo pronto (cada desafio vale uma vez)
    return { desafio: d.desafio, solucao };
}

export const _paraTeste = { sha256Palavras, bitsZero };
