// =====================================================================
//  js/ver-foto.js — VER A FOTO INTEIRA
//
//  Na janela do produto a foto aparece numa faixa, e parte dela fica de fora
//  (num pão embalado, justamente a etiqueta). Tocar na foto abre ela inteira,
//  em tela cheia. Tocar de novo aproxima no ponto tocado; arrastar passeia
//  pela foto; o X, a tecla Esc ou um toque fora fecham.
// =====================================================================
const AMPLIA = 2.6;
let tela = null, voltarFoco = null;

function montar() {
    if (tela) return tela;
    tela = document.createElement('div');
    tela.className = 'vf'; tela.hidden = true;
    tela.setAttribute('role', 'dialog'); tela.setAttribute('aria-modal', 'true'); tela.setAttribute('aria-label', 'Foto do produto');
    tela.innerHTML = '<div class="vf-palco"><img class="vf-img" alt=""></div><button type="button" class="vf-fechar" aria-label="Fechar a foto">&times;</button><p class="vf-dica" aria-hidden="true">Toque na foto para aproximar</p>';
    document.body.appendChild(tela);
    const palco = tela.querySelector('.vf-palco'), img = tela.querySelector('.vf-img');
    tela.querySelector('.vf-fechar').addEventListener('click', fechar);
    palco.addEventListener('click', (e) => {
        if (e.target !== img) return fechar();                      // tocou no escuro, fora da foto
        if (tela.classList.contains('perto')) { tela.classList.remove('perto'); img.style.width = ''; return; }
        const r = img.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        const larg = Math.round(r.width * AMPLIA);
        tela.classList.add('perto'); img.style.width = `${larg}px`;
        palco.scrollLeft = fx * larg - palco.clientWidth / 2;       // o ponto tocado vai para o meio da tela
        palco.scrollTop = fy * (larg * r.height / r.width) - palco.clientHeight / 2;
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tela && !tela.hidden) { e.stopPropagation(); fechar(); } }, true);
    return tela;
}

export function fechar() {
    if (!tela || tela.hidden) return;
    tela.hidden = true; tela.classList.remove('perto');
    const img = tela.querySelector('.vf-img'); img.style.width = ''; img.removeAttribute('src');
    if (voltarFoco && voltarFoco.focus) voltarFoco.focus();
    voltarFoco = null;
}

/** Abre a foto inteira. jaNaTela = o que já está carregado (aparece na hora); original = a foto completa. */
export function abrir(jaNaTela, original, nome = '') {
    if (!jaNaTela && !original) return;
    const t = montar(), img = t.querySelector('.vf-img');
    voltarFoco = document.activeElement;
    img.alt = nome; img.src = jaNaTela || original;
    if (original && original !== jaNaTela) {                         // troca pela completa só quando ela já chegou, para não piscar
        const g = new Image();
        g.onload = () => { if (!t.hidden && img.getAttribute('src') === (jaNaTela || original)) img.src = original; };
        g.src = original;
    }
    t.hidden = false; t.querySelector('.vf-fechar').focus();
}

// A foto da janela do produto vira um botão: toque (ou Enter) abre inteira.
export function ligarVerFoto() {
    const abrirDaJanela = (hero) => {
        const img = hero.querySelector('img');
        if (!img || !img.getAttribute('src') || img.style.visibility === 'hidden') return;
        abrir(img.currentSrc || img.src, img.dataset.original || '', img.alt || '');
    };
    document.addEventListener('click', (e) => { const h = e.target.closest('.md-hero'); if (h) abrirDaJanela(h); });
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('md-hero')) { e.preventDefault(); abrirDaJanela(e.target); }
    });
}
