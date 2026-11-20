// Pequenos acabamentos de interface: tela de entrada e botões "ocupados".
// Não mexe em dados nem em regra de negócio.

// ---- Tela de entrada (some assim que os produtos aparecem) ----
// Ela cobre a loja desde o início (fundo claro) e mostra o verde com a folha depois de 0,35 s;
// o CSS a esconde sozinho aos 10 s.
const splash = document.getElementById('splash-feira');
const grid = document.getElementById('lista-produtos');
let splashFechada = false;
// Enquanto a tela de entrada cobre a loja, o que está por baixo fica INVISÍVEL (body.montando): cabeçalho,
// faixa da feira e vitrine se ajeitam sem "pular" na frente de ninguém e aparecem já no lugar.
if (splash) document.body.classList.add('montando');
// espera o cabeçalho/faixa (js/tema.js avisa 'tema-pronto'), no máximo 1,2 s depois dos produtos
const esperarTema = () => new Promise((ok) => {
    if (window.__temaPronto) return ok();
    const t = setTimeout(ok, 1200);
    document.addEventListener('tema-pronto', () => { clearTimeout(t); ok(); }, { once: true });
});
const fecharSplash = () => {
    if (splashFechada || !splash) return;
    splashFechada = true;
    document.body.classList.remove('montando');
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
        esperarTema().then(() => setTimeout(fecharSplash, 150));
        setTimeout(() => grid.classList.remove('primeira-carga'), 1200);
    });
    obs.observe(grid, { childList: true, subtree: true });
}
if (splash) setTimeout(fecharSplash, 6000);   // nunca prende o cliente fora da loja

// ---- Rede de segurança do contraste: mede o CARD DE VERDADE ----
// Se o nome do produto não lê bem sobre o fundo do card (tema com cores que brigam, por qualquer motivo),
// os cards ganham uma cor de texto legível. Não mexe em cards de seção, pacote ou tempero (têm cor própria).
const rgb = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 4).map(Number);
const lumi = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const contr = (a, b) => { const [x, y] = [lumi(a), lumi(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export function conferirContrasteDosCards(doc = document) {
    const raiz = doc.documentElement;
    const card = [...doc.querySelectorAll('#lista-produtos .produto-card[data-id]')].find((c) => !/produto-card--(secao|pacote|tempero|imersivo)/.test(c.className));
    const nome = card && card.querySelector('.produto-nome');
    if (!nome) return false;
    const fundo = rgb(getComputedStyle(card).backgroundColor);
    if (fundo.length < 3 || (fundo.length === 4 && fundo[3] < 0.9)) return false;          // card transparente: quem manda é a página
    if (contr(rgb(getComputedStyle(nome).color), fundo) >= 4.5) return false;
    const claro = lumi(fundo) < 0.18, tinta = claro ? '#f5f5f2' : '#1a1a18', base = `rgb(${fundo.slice(0, 3).join(',')})`;
    const v = { '--tc-dark': tinta, '--tc-mid': `color-mix(in srgb, ${tinta} 78%, ${base})`, '--tc-light': `color-mix(in srgb, ${tinta} 62%, ${base})`, '--tc-linha': `color-mix(in srgb, ${tinta} 18%, ${base})`, '--tc-forest': tinta };
    Object.entries(v).forEach(([k, val]) => raiz.style.setProperty(k, val));
    raiz.classList.add('ap-card-contraste');
    return true;
}
if (grid) {
    const conferir = () => { try { conferirContrasteDosCards(); } catch (_) { /* só acabamento */ } };
    document.addEventListener('tema-pronto', () => setTimeout(conferir, 50));
    new MutationObserver(() => { if (grid.querySelector('.produto-card[data-id]')) { clearTimeout(grid._cc); grid._cc = setTimeout(conferir, 300); } }).observe(grid, { childList: true });
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
