// =====================================================================
//  js/painel-menu.js — MENU "⋯" DO PAINEL (o que se usa de vez em quando sai do caminho).
//
//  Ideia do estudo de projetos abertos (Preline e Web Awesome): menu com o popover do próprio navegador
//  (<div popover> + <button popovertarget>). O navegador já cuida de abrir por cima de tudo, fechar com
//  Esc e com toque fora. Aqui só falta: (1) no computador, abrir colado no botão; no celular vira uma
//  folha embaixo, perto do polegar (CSS); (2) fechar ao tocar numa ação, para a janela dela abrir limpa.
//  Navegador sem popover (Android muito antigo): o CSS esconde o "⋯" e mostra os botões soltos, como antes.
// =====================================================================
const suporta = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

function posicionar(menu) {
    const botao = document.querySelector(`[popovertarget="${menu.id}"]`);
    if (!botao || window.matchMedia('(max-width: 560px)').matches) { menu.style.removeProperty('top'); menu.style.removeProperty('left'); return; }
    const r = botao.getBoundingClientRect(), largura = menu.offsetWidth || 260, altura = menu.offsetHeight || 0;
    const left = Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8));
    const embaixo = r.bottom + 6, top = embaixo + altura > window.innerHeight - 8 ? Math.max(8, r.top - altura - 6) : embaixo;
    menu.style.left = `${left}px`; menu.style.top = `${top}px`;
}

export function ligarMenus(raiz = document) {
    if (!suporta) return;
    raiz.querySelectorAll('.pn-menu[popover]').forEach((menu) => {
        if (menu.dataset.menuLigado) return; menu.dataset.menuLigado = '1';
        menu.setAttribute('role', 'menu');
        menu.addEventListener('toggle', (e) => {
            const botao = document.querySelector(`[popovertarget="${menu.id}"]`);
            if (botao) botao.setAttribute('aria-expanded', String(e.newState === 'open'));
            if (e.newState === 'open') { posicionar(menu); menu.querySelector('button:not([hidden])')?.focus({ preventScroll: true }); }
        });
        // tocou numa ação: fecha o menu (a janela da ação abre sem nada por cima)
        menu.addEventListener('click', (e) => { if (e.target.closest('button, a')) { try { menu.hidePopover(); } catch (_) { /* já fechado */ } } });
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ligarMenus()); else ligarMenus();
}
