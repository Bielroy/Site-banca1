// =====================================================================
//  js/texto-grande.js — A LETRA DO APARELHO VALE NO SITE.
//
//  • iPhone/iPad: o Safari NÃO aumenta a letra das páginas quando a pessoa
//    aumenta em Ajustes → Tela e Brilho → Tamanho do Texto (ou em Acessibilidade).
//    Ele só conta esse tamanho pela letra especial "-apple-system-body" (17 px no
//    tamanho padrão). Aqui medimos essa letra e, se a pessoa aumentou, a página
//    inteira cresce na mesma proporção (tudo é em rem: --escala-texto, css/encaixe.css).
//    Quem nunca mexeu continua vendo exatamente igual.
//  • Android e computador já aumentam sozinhos (letra do navegador / zoom).
//  • Em todos: com a letra grande, liga a classe .texto-grande no <html> para o
//    cabeçalho e os botões se arrumarem (quebrar linha em vez de cortar o texto).
// =====================================================================
const html = document.documentElement;

function escalaDoIphone() {
    try {
        if (!CSS.supports('font', '-apple-system-body')) return 1;
        const el = document.createElement('span');
        el.style.cssText = 'font: -apple-system-body; position: absolute; visibility: hidden; pointer-events: none;';
        el.textContent = 'A';
        (document.body || html).appendChild(el);
        const px = parseFloat(getComputedStyle(el).fontSize);
        el.remove();
        if (!Number.isFinite(px) || px <= 0) return 1;
        return Math.min(2.2, Math.max(1, px / 17));        // nunca diminui; até 2,2x (os maiores tamanhos de acessibilidade)
    } catch (_) { return 1; }
}

function aplicar() {
    const e = escalaDoIphone();
    if (e > 1.02) html.style.setProperty('--escala-texto', e.toFixed(3)); else html.style.removeProperty('--escala-texto');
    const raiz = parseFloat(getComputedStyle(html).fontSize) || 16;
    html.classList.toggle('texto-grande', raiz >= 18.5);
}

aplicar();
// voltou para o site depois de mexer nos Ajustes, girou a tela, deu zoom: confere de novo
addEventListener('pageshow', aplicar);
document.addEventListener('visibilitychange', () => { if (!document.hidden) aplicar(); });
let _t = 0; addEventListener('resize', () => { clearTimeout(_t); _t = setTimeout(aplicar, 200); }, { passive: true });
