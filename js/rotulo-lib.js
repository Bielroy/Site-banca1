// =====================================================================
//  js/rotulo-lib.js — RÓTULOS ADESIVOS PERSONALIZADOS (regras puras, testadas).
//
//  Cada produto pode ter o SEU rótulo guardado (produto.rotulo): o nome que
//  vai no adesivo ("Tomatinhos"), uma linha de baixo ("Tomate seco · 200 g"),
//  a imagem que o dono escolher (foto, desenho, logo), e se mostra preço,
//  validade e a loja. Na hora de imprimir: escolhe o produto, diz quantos
//  (15 milhos → 15 rótulos) e o tamanho do adesivo.
//
//  O desenho é feito UMA vez (js/rotulo-arte.js, num <canvas>) e sai:
//   • na impressora do aparelho: página com o rótulo colorido (folha A4 de
//     etiquetas ou rolo de adesivo) → paginaDeRotulos
//   • na térmica (Bluetooth, cabo, app): a imagem em preto e branco
//     pontilhado, em comandos ESC/POS → pontilhar + rasterEscPos
// =====================================================================

/**
 * Tamanhos de adesivo. mm = tamanho de UM rótulo. termica = sai na térmica de bobina.
 * Folhas A4: medidas do padrão de mercado (21 e 14 por folha, as mais vendidas nas papelarias).
 */
export const TAMANHOS = {
    'rolo58': { nome: 'Térmica 58 mm (bobina adesiva)', mm: [48, 32], termica: 58 },
    'rolo80': { nome: 'Térmica 80 mm (bobina adesiva)', mm: [72, 40], termica: 80 },
    '50x30': { nome: 'Adesivo em rolo 50 × 30 mm', mm: [50, 30] },
    '40x40': { nome: 'Adesivo em rolo 40 × 40 mm (quadrado)', mm: [40, 40] },
    '60x40': { nome: 'Adesivo em rolo 60 × 40 mm', mm: [60, 40] },
    '100x50': { nome: 'Adesivo em rolo 100 × 50 mm', mm: [100, 50] },
    'a4-21': { nome: 'Folha A4 com 21 etiquetas (63,5 × 38,1 mm)', mm: [63.5, 38.1], folha: { colunas: 3, linhas: 7, topo: 15.1, esquerda: 7.2, vaoX: 2.5, vaoY: 0 } },
    'a4-14': { nome: 'Folha A4 com 14 etiquetas (99,1 × 38,1 mm)', mm: [99.1, 38.1], folha: { colunas: 2, linhas: 7, topo: 15.1, esquerda: 4.7, vaoX: 2.5, vaoY: 0 } },
};
export const TAMANHO_PADRAO = 'a4-21';
export const BORDAS = { feira: 'De feira (com toldo)', simples: 'Contorno simples', nenhuma: 'Sem contorno' };
export const MAX_COPIAS = 200;

const texto = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const ehUrlImagem = (v) => typeof v === 'string' && v.length >= 12 && v.length <= 500 && /^https:\/\/[A-Za-z0-9._~:/?#@!$&*+,;=%-]+$/.test(v);

/** O rótulo guardado num produto, conferido. Campo estranho some; o que falta volta ao padrão. */
export function rotuloSeguro(bruto) {
    const r = bruto && typeof bruto === 'object' ? bruto : {};
    const dias = Math.round(Number(r.validadeDias));
    const saida = {
        titulo: texto(r.titulo, 40), sub: texto(r.sub, 60),
        preco: r.preco === true, loja: r.loja !== false,
        validadeDias: Number.isFinite(dias) && dias > 0 && dias <= 730 ? dias : null,
        borda: Object.prototype.hasOwnProperty.call(BORDAS, r.borda) ? r.borda : 'feira',
    };
    if (ehUrlImagem(r.img)) saida.img = r.img;
    return saida;
}

const reais = (v) => `R$ ${(Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',')}`;
const UNIDADES = { kg: 'o quilo', un: 'a unidade', 'maço': 'o maço', maco: 'o maço', bdj: 'a bandeja', kit: 'o kit', dz: 'a dúzia', l: 'o litro' };
const dataBr = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/**
 * O que vai escrito no rótulo, já pronto para desenhar.
 * hoje = data de fabricação (dia em que imprime, no Brasil). loja = nome da loja.
 */
export function conteudoDoRotulo(rotulo, produto = {}, { agora = Date.now(), loja = '' } = {}) {
    const r = rotuloSeguro(rotulo);
    const titulo = r.titulo || texto(produto.nome, 40) || 'Produto';
    const linhas = [];
    if (r.preco && Number(produto.preco) > 0) linhas.push(`${reais(produto.preco)} ${UNIDADES[String(produto.unidade || '').toLowerCase()] || ''}`.trim());
    if (r.validadeDias) {
        const fab = new Date(agora - 3 * 3600000), val = new Date(fab.getTime() + r.validadeDias * 86400000);
        linhas.push(`Fab. ${dataBr(fab)} · Val. ${dataBr(val)}`);
    }
    return { titulo, sub: r.sub, linhas, loja: r.loja ? texto(loja, 40) : '', img: r.img || '', borda: r.borda };
}

/** Quantas cópias: número de 1 a 200 (o que vier estranho vira 1). */
export const copiasValidas = (n) => Math.min(Math.max(parseInt(n, 10) || 1, 1), MAX_COPIAS);

/** Tamanho do rótulo em pontos. Térmica: 8 pontos por mm (203 dpi). Papel comum: 12 por mm (~300 dpi). */
export function pixelsDo(tamanho) {
    const t = TAMANHOS[tamanho] || TAMANHOS[TAMANHO_PADRAO], pmm = t.termica ? 8 : 12;
    let w = Math.round(t.mm[0] * pmm), h = Math.round(t.mm[1] * pmm);
    if (t.termica) w = Math.floor(w / 8) * 8;              // a térmica recebe a largura em bytes inteiros (8 pontos cada)
    return { w, h, pmm };
}

// ---------------------------------------------------------------------
// TÉRMICA: imagem em preto e branco pontilhado (Atkinson) e comandos ESC/POS
// ---------------------------------------------------------------------
/**
 * Cinza (0 preto … 255 branco, um número por ponto) → pontos pretos, com pontilhado de Atkinson:
 * foto vira textura de pontinhos (fica reconhecível na térmica); texto preto continua preto.
 * Devolve Uint8Array com 1 = preto.
 */
export function pontilhar(cinza, w, h) {
    const v = Float32Array.from(cinza), out = new Uint8Array(w * h);
    const espalhar = (x, y, e) => { if (x >= 0 && x < w && y < h) v[y * w + x] += e; };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x, velho = v[i], novo = velho < 128 ? 0 : 255;
            out[i] = novo === 0 ? 1 : 0;
            const e = (velho - novo) / 8;
            espalhar(x + 1, y, e); espalhar(x + 2, y, e); espalhar(x - 1, y + 1, e); espalhar(x, y + 1, e); espalhar(x + 1, y + 1, e); espalhar(x, y + 2, e);
        }
    }
    return out;
}

/** Cor RGBA (do canvas) → cinza. Fundo transparente conta como branco. */
export function paraCinza(rgba, w, h) {
    const g = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
        const a = rgba[i * 4 + 3] / 255, l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
        g[i] = Math.round(l * a + 255 * (1 - a));
    }
    return g;
}

/**
 * Pontos pretos → comandos ESC/POS "GS v 0" (imagem), em faixas de até 128 linhas
 * (impressora barata com pouca memória engasga com imagem inteira de uma vez).
 * Cada rótulo: imagem, um espaço e o corte (quem não tem guilhotina ignora).
 */
export function rasterEscPos(pontos, w, h, { copias = 1, cortar = true, espaco = 3 } = {}) {
    const bytesLinha = Math.ceil(w / 8), faixas = [];
    for (let y0 = 0; y0 < h; y0 += 128) {
        const alt = Math.min(128, h - y0), b = new Uint8Array(8 + bytesLinha * alt);
        b.set([0x1d, 0x76, 0x30, 0x00, bytesLinha & 0xff, bytesLinha >> 8, alt & 0xff, alt >> 8]);
        for (let y = 0; y < alt; y++) for (let x = 0; x < w; x++) if (pontos[(y0 + y) * w + x]) b[8 + y * bytesLinha + (x >> 3)] |= 0x80 >> (x & 7);
        faixas.push(b);
    }
    const fim = [...Array(espaco).fill(0x0a), ...(cortar ? [0x1d, 0x56, 0x42, 0x00] : [])];
    const um = [0x1b, 0x40, 0x1b, 0x61, 0x01];               // ESC @ (zera) e ESC a 1 (centraliza)
    const tam = um.length + faixas.reduce((t, f) => t + f.length, 0) + fim.length;
    const n = copiasValidas(copias), saida = new Uint8Array(tam * n);
    for (let c = 0, pos = 0; c < n; c++) {
        saida.set(um, pos); pos += um.length;
        for (const f of faixas) { saida.set(f, pos); pos += f.length; }
        saida.set(fim, pos); pos += fim.length;
    }
    return saida;
}

// ---------------------------------------------------------------------
// IMPRESSORA DO APARELHO: página com os rótulos (folha A4 ou rolo)
// ---------------------------------------------------------------------
/** Quantas folhas A4 uma quantidade gasta. `pular` = etiquetas já usadas no começo da 1ª folha. */
export function folhasNecessarias(tamanho, copias, pular = 0) {
    const t = TAMANHOS[tamanho]; if (!t || !t.folha) return 0;
    const porFolha = t.folha.colunas * t.folha.linhas;
    return Math.ceil((copiasValidas(copias) + Math.max(0, Math.min(porFolha - 1, pular | 0))) / porFolha);
}

/**
 * Página pronta para imprimir. `imagem` = o rótulo desenhado (data:image/png).
 * Folha A4: os rótulos nas posições exatas da folha de etiquetas (pode pular as já usadas).
 * Rolo: uma página do tamanho de um adesivo para cada cópia.
 */
export function paginaDeRotulos(imagem, tamanho, copias, { pular = 0 } = {}) {
    const t = TAMANHOS[tamanho] || TAMANHOS[TAMANHO_PADRAO], n = copiasValidas(copias), [w, h] = t.mm;
    // blob: (a imagem fica uma vez só na memória, mesmo com 200 cópias) ou data: (testes)
    if (!/^(blob:https?:\/\/[A-Za-z0-9.:\[\]-]+\/[A-Za-z0-9-]+|data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)$/.test(String(imagem))) throw new Error('imagem do rótulo inválida');
    const img = `<img src="${imagem}" alt="">`;
    let corpo, estilo;
    if (t.folha) {
        const f = t.folha, porFolha = f.colunas * f.linhas, vazias = Math.max(0, Math.min(porFolha - 1, pular | 0));
        const total = n + vazias, folhas = [];
        for (let k = 0; k < Math.ceil(total / porFolha); k++) {
            const itens = [];
            for (let i = 0; i < porFolha; i++) {
                const idx = k * porFolha + i; if (idx >= total) break;
                const col = i % f.colunas, lin = Math.floor(i / f.colunas);
                const x = f.esquerda + col * (w + f.vaoX), y = f.topo + lin * (h + f.vaoY);
                itens.push(`<div class="r" style="left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm">${idx < vazias ? '' : img}</div>`);
            }
            folhas.push(`<section class="folha">${itens.join('')}</section>`);
        }
        corpo = folhas.join('');
        estilo = `@page { size: A4; margin: 0; } .folha { position: relative; width: 210mm; height: 297mm; break-after: page; page-break-after: always; overflow: hidden; } .folha:last-child { break-after: auto; page-break-after: auto; } .r { position: absolute; width: ${w}mm; height: ${h}mm; }`;
    } else {
        corpo = Array.from({ length: n }, () => `<section class="rolo">${img}</section>`).join('');
        estilo = `@page { size: ${w}mm ${h}mm; margin: 0; } .rolo { width: ${w}mm; height: ${h}mm; break-after: page; page-break-after: always; overflow: hidden; } .rolo:last-child { break-after: auto; page-break-after: auto; }`;
    }
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Rótulos</title><style>
* { box-sizing: border-box; margin: 0; padding: 0; } html, body { background: #fff; }
img { display: block; width: 100%; height: 100%; object-fit: contain; }
${estilo}
</style></head><body>${corpo}</body></html>`;
}
