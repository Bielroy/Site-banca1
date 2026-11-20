// =====================================================================
//  js/qr-lib.js — GERADOR DE QR CODE (puro: entra texto, sai a grade de quadradinhos).
//
//  Para o cartaz de cada feira (Plataforma → Feiras → Cartaz). Sem internet e sem
//  biblioteca de fora. Modo "bytes" (UTF-8), correção de erro M (aguenta ~15% de sujeira
//  ou rasgo), versões 1 a 10 (até 213 letras): sobra para um link de feira.
//  O teste confere decodificando com um leitor de QR de verdade (testes/index.js).
// =====================================================================

// por versão (1..10), nível M: [bytes de correção por bloco, [qtd de blocos, bytes de dados por bloco], ...]
const BLOCOS_M = [null,
    [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
    [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]],
];
const ALINHAMENTO = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_BYTES = 213;

const dadosDaVersao = (v) => BLOCOS_M[v].slice(1).reduce((s, [n, d]) => s + n * d, 0);

// ---- Reed-Solomon (GF(256), polinômio 0x11D) ----
const EXP = new Array(512), LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mult = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function correcao(dados, n) {
    let gen = [1];
    for (let i = 0; i < n; i++) { const prox = new Array(gen.length + 1).fill(0); gen.forEach((c, j) => { prox[j] ^= c; prox[j + 1] ^= mult(c, EXP[i]); }); gen = prox; }
    const resto = new Array(n).fill(0);
    for (const b of dados) { const f = b ^ resto.shift(); resto.push(0); if (f) gen.slice(1).forEach((c, j) => { resto[j] ^= mult(c, f); }); }
    return resto;
}

function paraBytes(texto) { return Array.from(new TextEncoder().encode(String(texto))); }

function montarCodewords(bytes, versao) {
    const cap = dadosDaVersao(versao), bits = [];
    const poe = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
    poe(0b0100, 4); poe(bytes.length, versao < 10 ? 8 : 16);
    bytes.forEach((b) => poe(b, 8));
    poe(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < cap * 8; pad ^= 0xec ^ 0x11) poe(pad, 8);
    const dados = []; for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    // reparte em blocos, calcula a correção e entrelaça
    const [nEc, ...grupos] = BLOCOS_M[versao], blocos = []; let pos = 0;
    for (const [qtd, tam] of grupos) for (let i = 0; i < qtd; i++) { const d = dados.slice(pos, pos + tam); pos += tam; blocos.push({ d, e: correcao(d, nEc) }); }
    const saida = [], maxD = Math.max(...blocos.map((b) => b.d.length));
    for (let i = 0; i < maxD; i++) blocos.forEach((b) => { if (i < b.d.length) saida.push(b.d[i]); });
    for (let i = 0; i < nEc; i++) blocos.forEach((b) => saida.push(b.e[i]));
    return saida;
}

function bch(valor, gerador) { const gl = 31 - Math.clz32(gerador); let r = valor; for (let i = 31 - Math.clz32(valor); i >= gl; i--) if ((r >>> i) & 1) r ^= gerador << (i - gl); return r; }

function desenhar(versao, codewords, mascara) {
    const n = 17 + versao * 4, m = Array.from({ length: n }, () => new Array(n).fill(false)), fixo = Array.from({ length: n }, () => new Array(n).fill(false));
    const poe = (x, y, v) => { if (x >= 0 && y >= 0 && x < n && y < n) { m[y][x] = v; fixo[y][x] = true; } };
    // marcas de busca (3 cantos) com a borda clara
    for (const [cx, cy] of [[0, 0], [n - 7, 0], [0, n - 7]]) for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
        const ex = Math.max(Math.abs(dx - 3), Math.abs(dy - 3)); poe(cx + dx, cy + dy, ex !== 2 && ex !== 4);
    }
    for (let i = 8; i < n - 8; i++) { poe(i, 6, i % 2 === 0); poe(6, i, i % 2 === 0); }      // linhas de sincronia
    const al = ALINHAMENTO[versao];
    for (const cy of al) for (const cx of al) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === n - 7) || (cx === n - 7 && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) poe(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // reserva as áreas de formato (preenchidas depois) e o módulo escuro
    for (let i = 0; i < 9; i++) { fixo[8][i] = true; fixo[i][8] = true; }
    for (let i = 0; i < 8; i++) { fixo[8][n - 1 - i] = true; fixo[n - 1 - i][8] = true; }
    poe(8, n - 8, true);
    if (versao >= 7) {
        const info = (versao << 12) | bch(versao << 12, 0x1f25);
        for (let i = 0; i < 18; i++) { const b = ((info >>> i) & 1) === 1, a = n - 11 + (i % 3), c = Math.floor(i / 3); poe(a, c, b); poe(c, a, b); }
    }
    // dados em zigue-zague, de baixo para cima, de 2 em 2 colunas
    const bits = []; codewords.forEach((c) => { for (let i = 7; i >= 0; i--) bits.push((c >>> i) & 1); });
    const regra = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
        (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mascara];
    let k = 0, sobe = true;
    for (let x = n - 1; x > 0; x -= 2) {
        if (x === 6) x = 5;
        for (let i = 0; i < n; i++) {
            const y = sobe ? n - 1 - i : i;
            for (const xx of [x, x - 1]) { if (fixo[y][xx]) continue; let b = k < bits.length ? bits[k] === 1 : false; k++; if (regra(xx, y)) b = !b; m[y][xx] = b; }
        }
        sobe = !sobe;
    }
    // informação de formato (correção M = 00 + máscara)
    const dado = (0b00 << 3) | mascara, fmt = ((dado << 10) | bch(dado << 10, 0x537)) ^ 0x5412, bit = (i) => ((fmt >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
    m[n - 8][8] = true;
    return m;
}

function pontos(m) {                       // quanto pior a grade (blocos iguais, faixas parecidas com a marca de busca), maior a nota
    const n = m.length; let p = 0;
    const linha = (get) => { for (let a = 0; a < n; a++) { let ig = 1; for (let b = 1; b < n; b++) { if (get(a, b) === get(a, b - 1)) { ig++; if (ig === 5) p += 3; else if (ig > 5) p++; } else ig = 1; } } };
    linha((a, b) => m[a][b]); linha((a, b) => m[b][a]);
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    const padrao = [1, 0, 1, 1, 1, 0, 1], acha = (get) => { for (let a = 0; a < n; a++) for (let b = 0; b + 10 < n; b++) { let ok = true; for (let i = 0; i < 7; i++) if ((get(a, b + 4 + i) ? 1 : 0) !== padrao[i]) { ok = false; break; } if (ok && [0, 1, 2, 3].every((i) => !get(a, b + i))) p += 40; } };
    acha((a, b) => m[a][b]); acha((a, b) => m[b][a]);
    const escuros = m.flat().filter(Boolean).length; p += Math.floor(Math.abs((escuros * 100) / (n * n) - 50) / 5) * 10;
    return p;
}

/** Texto → grade de quadradinhos [[true/false,...],...] (true = escuro), SEM a borda clara. null se não cabe (mais de 213 bytes). */
export function qrDe(texto) {
    const bytes = paraBytes(texto);
    let versao = 0;
    for (let v = 1; v <= 10; v++) if (bytes.length + (v < 10 ? 2 : 3) <= dadosDaVersao(v)) { versao = v; break; }
    if (!versao) return null;
    const cw = montarCodewords(bytes, versao);
    let melhor = null, nota = Infinity;
    for (let mascara = 0; mascara < 8; mascara++) { const g = desenhar(versao, cw, mascara), p = pontos(g); if (p < nota) { nota = p; melhor = g; } }
    return melhor;
}

/** A grade como caminho SVG (um só <path>; cada quadradinho 1×1; o desenho tem n×n). */
export function qrCaminho(grade) {
    let d = '';
    grade.forEach((linha, y) => { let x = 0; while (x < linha.length) { if (!linha[x]) { x++; continue; } let w = 0; while (x + w < linha.length && linha[x + w]) w++; d += `M${x} ${y}h${w}v1h-${w}z`; x += w; } });
    return d;
}
