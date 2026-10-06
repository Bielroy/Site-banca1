// Pequenos acabamentos de interface: tela de entrada e botões "ocupados".
// Não mexe em dados nem em regra de negócio.

// ---- Tela de entrada (some assim que os produtos aparecem) ----
// Ela cobre a loja desde o início (fundo claro) e mostra o verde com a folha depois de 0,35 s;
// o CSS a esconde sozinho aos 10 s.
const splash = document.getElementById('splash-feira');
const grid = document.getElementById('lista-produtos');
let splashFechada = false;
const fecharSplash = () => {
    if (splashFechada || !splash) return;
    splashFechada = true;
    if (performance.now() < 400) { splash.remove(); return; }     // carregou rápido: nem chegou a aparecer
    splash.classList.add('saindo');
    setTimeout(() => splash.remove(), 500);
};
if (grid) {
    // animação de entrada dos cards: só nesta primeira carga
    grid.classList.add('primeira-carga');
    const obs = new MutationObserver(() => {
        if (!grid.querySelector('.produto-card[data-id], .empty-state')) return;
        obs.disconnect();
        setTimeout(fecharSplash, 150);
        setTimeout(() => grid.classList.remove('primeira-carga'), 1200);
    });
    obs.observe(grid, { childList: true, subtree: true });
}
if (splash) setTimeout(fecharSplash, 6000);   // nunca prende o cliente fora da loja

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
