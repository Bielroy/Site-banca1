// =====================================================================
//  js/erros-site.js — AVISA O SERVIDOR QUANDO ALGO QUEBRA NO NAVEGADOR.
//
//  Pega erro de código e promessa que falhou sem tratamento, e manda para
//  /api/analytics { acao: 'erro' }. A Plataforma mostra a lista (aba Erros).
//  Vai só o necessário para achar o defeito: mensagem, arquivo e linha, página
//  (sem os parâmetros do endereço) e a loja. Nada do que o cliente digitou.
//
//  Freios: no máximo 5 avisos por página aberta, o mesmo erro uma vez só, e nada
//  na prévia da aparência nem em localhost.
//  É o PRIMEIRO import de cada página, para pegar erro dos módulos que vêm depois.
// =====================================================================
const MAX_POR_PAGINA = 5;
const vistos = new Set();
let enviados = 0;

const desligado = (() => {
    try {
        if (window.__errosSiteTeste === true) return false;          // só os testes de tela ligam isto
        return /^\/previa\/?$/.test(location.pathname) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || navigator.webdriver === true;
    }
    catch (_) { return true; }
})();

// qual loja: ?loja=id, subdomínio, ou a original
function lojaAtual() {
    try { const q = new URLSearchParams(location.search).get('loja'); if (q && /^[a-z0-9][a-z0-9-]{1,39}$/.test(q)) return q; } catch (_) { /* segue */ }
    return 'banca';
}
// a "versão" do site é o nome do arquivo principal gerado no build (muda a cada publicação)
function versao() {
    try { const s = document.querySelector('script[type="module"][src*="/assets/"]'); return s ? s.getAttribute('src').split('/').pop().slice(0, 40) : ''; } catch (_) { return ''; }
}

export function avisarErro(dados) {
    if (desligado || enviados >= MAX_POR_PAGINA) return;
    const msg = String((dados && dados.msg) || '').slice(0, 300);
    if (!msg) return;
    const chave = `${msg}|${dados.arquivo || ''}|${dados.linha || ''}`;
    if (vistos.has(chave)) return;
    vistos.add(chave); enviados++;
    const corpo = JSON.stringify({ acao: 'erro', tipo: dados.tipo || 'erro', msg, arquivo: String(dados.arquivo || '').slice(0, 300), linha: dados.linha || 0, coluna: dados.coluna || 0,
        pilha: String(dados.pilha || '').slice(0, 1500), pagina: location.pathname, loja: lojaAtual(), versao: versao() });
    try {
        // keepalive: o aviso chega mesmo se a pessoa fechar a página logo depois
        fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, keepalive: true, credentials: 'same-origin' }).catch(() => { /* sem internet: deixa para lá */ });
    } catch (_) { /* navegador muito antigo */ }
}

if (!desligado && typeof window !== 'undefined' && !window.__errosSite) {
    window.__errosSite = true;
    window.addEventListener('error', (e) => {
        // erro de código (o de imagem/arquivo que não carregou chega aqui sem e.error e sem mensagem: ignorado)
        if (!e || !e.message) return;
        avisarErro({ tipo: 'erro', msg: e.message, arquivo: e.filename, linha: e.lineno, coluna: e.colno, pilha: e.error && e.error.stack });
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e && e.reason;
        // falha de internet não é defeito do site
        const msg = r && r.message ? r.message : typeof r === 'string' ? r : '';
        if (!msg || /Failed to fetch|NetworkError|Load failed|network error|unavailable|offline/i.test(msg)) return;
        avisarErro({ tipo: 'promessa', msg, pilha: r && r.stack });
    });
}
