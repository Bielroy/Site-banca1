// =====================================================================
//  js/rotulo-arte.js — DESENHA o rótulo num <canvas> (navegador).
//
//  Recebe o conteúdo pronto (js/rotulo-lib.js, conteudoDoRotulo) e as
//  imagens já abertas, e desenha no tamanho do adesivo:
//   • adesivo deitado (mais largo que alto): imagem à esquerda, texto à direita;
//   • quadrado ou em pé: imagem em cima, texto embaixo, centralizado.
//  O nome encolhe sozinho até caber (no máximo 2 linhas).
//  Borda "de feira": contorno arredondado com a franja do toldo em cima.
// =====================================================================

const FONTE_TITULO = '"Fraunces", Georgia, "Times New Roman", serif';
const FONTE_TEXTO = '"Figtree", "Segoe UI", Roboto, Arial, sans-serif';
const VERDE = '#1a3a2a';

/**
 * Abre uma imagem para desenhar no canvas sem "sujar" o canvas (precisamos ler os pontos para a térmica
 * e gerar o arquivo da impressão). Primeiro pelo redutor do próprio site (mesmo endereço), depois direto.
 * Devolve null se não der: o rótulo sai sem a imagem, mas sai.
 */
export async function abrirImagem(url, { reduzida = '' } = {}) {
    if (!url) return null;
    for (const endereco of [reduzida, url].filter(Boolean)) {
        try {
            const r = await fetch(endereco, { mode: 'cors', credentials: 'omit' });
            if (!r.ok) continue;
            const blob = await r.blob();
            if (!/^image\//.test(blob.type)) continue;
            try { return await createImageBitmap(blob); }
            catch (_) {           // SVG (logo desenhada) não abre assim: abre como <img>, a partir do próprio arquivo baixado
                const local = URL.createObjectURL(blob);
                try { const img = new Image(); img.decoding = 'async'; img.src = local; await img.decode(); if (img.naturalWidth) return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight }); }
                finally { setTimeout(() => URL.revokeObjectURL(local), 5000); }
            }
        } catch (_) { /* tenta o próximo caminho */ }
    }
    return null;
}

const quebrarEm = (ctx, texto, largura, maxLinhas) => {
    const palavras = String(texto || '').split(' '), linhas = [];
    let atual = '';
    for (const p of palavras) {
        const tenta = atual ? `${atual} ${p}` : p;
        if (ctx.measureText(tenta).width <= largura || !atual) atual = tenta;
        else { linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    if (linhas.length <= maxLinhas) return linhas;
    const corte = linhas.slice(0, maxLinhas);
    let ult = corte[maxLinhas - 1];
    while (ult.length > 1 && ctx.measureText(`${ult}…`).width > largura) ult = ult.slice(0, -1);
    corte[maxLinhas - 1] = `${ult.trimEnd()}…`;
    return corte;
};

/** Maior tamanho de letra (até `max`) em que o texto cabe em `linhas` linhas da largura dada. */
function caber(ctx, texto, largura, maxLinhas, max, min, fonte, peso) {
    for (let t = Math.floor(max); t >= min; t--) {
        ctx.font = `${peso} ${t}px ${fonte}`;
        const palavras = String(texto).split(' ');
        if (palavras.some((p) => ctx.measureText(p).width > largura)) continue;      // palavra sozinha maior que a linha
        const l = quebrarEm(ctx, texto, largura, 99);
        if (l.length <= maxLinhas) return { tamanho: t, linhas: l };
    }
    ctx.font = `${peso} ${min}px ${fonte}`;
    return { tamanho: min, linhas: quebrarEm(ctx, texto, largura, maxLinhas) };
}

function caminhoArredondado(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Imagem "cobrindo" a caixa (corta as sobras), com cantos arredondados. */
function desenharImagem(ctx, img, x, y, w, h, r) {
    ctx.save(); caminhoArredondado(ctx, x, y, w, h, r); ctx.clip();
    ctx.fillStyle = '#f3ecdc'; ctx.fillRect(x, y, w, h);
    const esc = Math.max(w / img.width, h / img.height), iw = img.width * esc, ih = img.height * esc;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    ctx.restore();
}

/**
 * Desenha o rótulo inteiro. c = conteúdo (conteudoDoRotulo). imagens = { img, logo } já abertas (ou null).
 * mono = true para a térmica: tudo em preto puro (cor fica para a impressora comum).
 */
export function desenharRotulo(canvas, c, imagens = {}, { w, h, mono = false } = {}) {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const cor = mono ? '#000' : VERDE, corSuave = mono ? '#000' : '#4a4a44';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    const base = Math.min(w, h), pad = Math.round(base * 0.06), linha = Math.max(2, Math.round(base * 0.018));
    let topo = pad, esq = pad, dir = w - pad, baixo = h - pad;

    // borda
    if (c.borda !== 'nenhuma') {
        ctx.lineWidth = linha; ctx.strokeStyle = cor;
        caminhoArredondado(ctx, linha / 2 + pad * 0.3, linha / 2 + pad * 0.3, w - linha - pad * 0.6, h - linha - pad * 0.6, base * 0.08); ctx.stroke();
        esq += pad * 0.35; dir -= pad * 0.35; topo += pad * 0.35; baixo -= pad * 0.35;
    }
    if (c.borda === 'feira') {           // franja do toldo: meias-luas penduradas no contorno de cima
        const y = pad * 0.3 + linha / 2, raio = Math.max(3, base * 0.035), x0 = pad * 0.3 + base * 0.1, x1 = w - pad * 0.3 - base * 0.1;
        const n = Math.max(3, Math.floor((x1 - x0) / (raio * 2.6)));
        ctx.fillStyle = cor;
        for (let i = 0; i <= n; i++) { const cx = x0 + ((x1 - x0) * i) / n; ctx.beginPath(); ctx.arc(cx, y, raio, 0, Math.PI); ctx.fill(); }
        topo += raio * 1.2;
    }

    const temImg = !!imagens.img, deitado = w / h >= 1.25;
    const lojaTxt = c.loja || '', temLogo = !!(imagens.logo && lojaTxt);
    const areaW = dir - esq, areaH = baixo - topo, vao = pad * 0.7;
    let tx = esq, ty = topo, tw = areaW, th = areaH, centro = !deitado;

    if (temImg && deitado) {
        const lado = Math.min(areaH, areaW * 0.42);
        desenharImagem(ctx, imagens.img, esq, topo + (areaH - lado) / 2, lado, lado, base * 0.06);
        tx = esq + lado + vao; tw = dir - tx;
    } else if (temImg) {
        const alt = areaH * 0.48;
        desenharImagem(ctx, imagens.img, esq, topo, areaW, alt, base * 0.06);
        ty = topo + alt + vao * 0.6; th = baixo - ty;
    }

    // tamanhos: título grande; o resto proporcional; tudo cabe na altura da área de texto
    const rodapeH = lojaTxt ? Math.max(10, th * 0.13) : 0;
    const blocos = (escala) => {
        const titulo = caber(ctx, c.titulo, tw, 2, th * 0.34 * escala, Math.max(9, th * 0.1), FONTE_TITULO, 800);
        const sub = c.sub ? caber(ctx, c.sub, tw, 1, titulo.tamanho * 0.5, 8, FONTE_TEXTO, 600) : null;
        const info = c.linhas.map((l) => caber(ctx, l, tw, 1, titulo.tamanho * 0.44, 7, FONTE_TEXTO, 700));
        const altura = titulo.linhas.length * titulo.tamanho * 1.05 + (sub ? sub.tamanho * 1.35 : 0) + info.reduce((t, i) => t + i.tamanho * 1.3, 0) + rodapeH * 1.2;
        return { titulo, sub, info, altura };
    };
    let b = blocos(1);
    for (let e = 0.9; b.altura > th && e > 0.35; e -= 0.08) b = blocos(e);

    const xTexto = centro ? tx + tw / 2 : tx;
    ctx.textAlign = centro ? 'center' : 'left'; ctx.textBaseline = 'top';
    let y = ty + Math.max(0, (th - b.altura) / 2);
    ctx.fillStyle = cor; ctx.font = `800 ${b.titulo.tamanho}px ${FONTE_TITULO}`;
    for (const l of b.titulo.linhas) { ctx.fillText(l, xTexto, y); y += b.titulo.tamanho * 1.05; }
    if (b.sub) { ctx.fillStyle = corSuave; ctx.font = `600 ${b.sub.tamanho}px ${FONTE_TEXTO}`; ctx.fillText(b.sub.linhas[0], xTexto, y + b.sub.tamanho * 0.15); y += b.sub.tamanho * 1.35; }
    for (const i of b.info) { ctx.fillStyle = cor; ctx.font = `700 ${i.tamanho}px ${FONTE_TEXTO}`; ctx.fillText(i.linhas[0], xTexto, y + i.tamanho * 0.15); y += i.tamanho * 1.3; }

    // loja: logo pequeno + nome, no pé
    if (lojaTxt) {
        const tam = Math.max(8, Math.min(rodapeH, b.titulo.tamanho * 0.4)), yRod = Math.min(baixo - tam * 1.1, y + tam * 0.4);
        ctx.font = `700 ${tam}px ${FONTE_TEXTO}`; ctx.fillStyle = corSuave;
        const nome = quebrarEm(ctx, lojaTxt, tw - (temLogo ? tam * 1.5 : 0), 1)[0], larg = ctx.measureText(nome).width + (temLogo ? tam * 1.5 : 0);
        let x = centro ? xTexto - larg / 2 : tx;
        if (temLogo) { desenharImagem(ctx, imagens.logo, x, yRod - tam * 0.1, tam * 1.2, tam * 1.2, tam * 0.3); x += tam * 1.5; }
        ctx.textAlign = 'left'; ctx.fillText(nome, x, yRod);
    }
    return canvas;
}

/** Garante as letras da loja antes de desenhar (sem elas o canvas usa a letra do sistema). */
export async function prepararLetras() {
    if (!document.fonts || !document.fonts.load) return;
    try { await Promise.all([document.fonts.load(`800 40px ${FONTE_TITULO}`), document.fonts.load(`700 20px ${FONTE_TEXTO}`), document.fonts.load(`600 20px ${FONTE_TEXTO}`)]); } catch (_) { /* segue com a do sistema */ }
}
