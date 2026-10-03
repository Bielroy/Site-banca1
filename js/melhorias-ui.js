// Pequenos acabamentos de interface: tela de entrada e botões "ocupados".
// Não mexe em dados nem em regra de negócio.

// ---- Tela de entrada (some assim que os produtos aparecem) ----
const splash = document.getElementById('splash-feira');
let splashFechada = false;
const fecharSplash = () => {
    if (splashFechada || !splash) return;
    splashFechada = true;
    splash.classList.add('saindo');
    setTimeout(() => splash.remove(), 600);
};
if (splash) {
    const grid = document.getElementById('lista-produtos');
    if (grid) {
        const obs = new MutationObserver(() => {
            if (grid.querySelector('.produto-card[data-id]')) { obs.disconnect(); setTimeout(fecharSplash, 250); }
        });
        obs.observe(grid, { childList: true, subtree: true });
    }
    setTimeout(fecharSplash, 6000);       // nunca prende o cliente fora da loja
}

// ---- Botão desabilitado com texto de "carregando" ganha spinner ----
const TEXTO_OCUPADO = /⏳|Enviando|Salvando|Calculando|Processando|Gerando|Carregando|\.\.\.|…/;
const marcar = (btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.classList.toggle('btn-carregando', btn.disabled && TEXTO_OCUPADO.test(btn.textContent));
};
new MutationObserver((muts) => {
    for (const m of muts) {
        if (m.type === 'attributes') marcar(m.target);
        else if (m.target.closest) marcar(m.target.closest('button'));
    }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'], childList: true, characterData: true });
