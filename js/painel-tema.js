// =====================================================================
//  js/painel-tema.js — TEMA CLARO / ESCURO DO PAINEL (só do painel; a loja do cliente não muda).
//
//  O tema claro é o original e continua sendo o padrão. Quem escolhe "Tema escuro" no menu "Mais opções"
//  fica com ele NESTE aparelho (a escolha é guardada aqui, não na conta).
//  As cores do escuro estão em css/admin-escuro.css (gerado por scripts/gerar-tema-escuro.js) e só valem
//  quando o <html> tem data-painel-tema="escuro".
//  Carregado no <head> do admin.html para a tela já abrir na cor certa.
// =====================================================================
const CHAVE = 'painel-tema';
const COR_BARRA = { claro: '#1a3a2a', escuro: '#0f1612' };   // cor da barra do navegador/aparelho

export function temaGuardado() {
    try { return localStorage.getItem(CHAVE) === 'escuro' ? 'escuro' : 'claro'; } catch { return 'claro'; }
}
export const temaAtual = () => (document.documentElement.dataset.painelTema === 'escuro' ? 'escuro' : 'claro');

export function aplicarTema(tema) {
    const escuro = tema === 'escuro', raiz = document.documentElement;
    if (escuro) raiz.dataset.painelTema = 'escuro'; else delete raiz.dataset.painelTema;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = COR_BARRA[escuro ? 'escuro' : 'claro'];
    pintarBotao();
}
export function trocarTema() {
    const novo = temaAtual() === 'escuro' ? 'claro' : 'escuro';
    try { localStorage.setItem(CHAVE, novo); } catch { /* aparelho sem armazenamento: vale só até fechar */ }
    aplicarTema(novo);
    return novo;
}

// O botão do menu diz o que ele FAZ: no claro, "Tema escuro"; no escuro, "Tema claro".
function pintarBotao() {
    const b = document.getElementById('btn-tema'); if (!b) return;
    const escuro = temaAtual() === 'escuro';
    b.setAttribute('aria-pressed', String(escuro));
    const t = document.getElementById('btn-tema-texto'); if (t) t.textContent = escuro ? 'Tema claro' : 'Tema escuro';
    const i = b.querySelector('[data-i]'); if (i && i.dataset.i !== (escuro ? 'sol' : 'lua')) i.outerHTML = `<i class="ic" data-i="${escuro ? 'sol' : 'lua'}"></i>`;
}

aplicarTema(temaGuardado());
const ligar = () => { const b = document.getElementById('btn-tema'); if (b) b.addEventListener('click', trocarTema); pintarBotao(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();
