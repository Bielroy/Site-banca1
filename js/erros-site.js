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

/** O texto de uma promessa recusada ('' quando ela não traz mensagem). */
export const mensagemDaRejeicao = (r) => (r && typeof r.message === 'string' && r.message ? r.message : typeof r === 'string' ? r : '');
/** Falha de internet: não é defeito do site. */
export const rejeicaoDeRede = (msg) => /Failed to fetch|NetworkError|Load failed|network error|unavailable|offline/i.test(String(msg || ''));
/** Recusa do PRÓPRIO NAVEGADOR que não atrapalha nada: animação de troca de tela cancelada (girou o celular, tocou de novo
 *  no meio, voltou de outro app) ou registro do aplicativo (service worker) recusado por alguns aparelhos. A loja segue igual. */
export function rejeicaoDoNavegador(r) {
    const msg = mensagemDaRejeicao(r), nome = String((r && r.name) || '');
    if ((nome === 'AbortError' || nome === 'InvalidStateError') && /transition/i.test(msg)) return true;
    if (/^(Transition was (aborted|skipped)|Skipping view transition)/i.test(msg) || /view ?transition/i.test(msg)) return true;
    if (/ServiceWorker|serviceWorker|^Rejected$/i.test(msg) && /registerSW|sw\.js|serviceWorker/i.test(`${String((r && r.stack) || '')} ${msg}`)) return true;
    return false;
}
/** Recusa SEM mensagem (um evento, undefined, um objeto qualquer): diz o que era, sem levar dado nenhum do cliente. */
export function descreverRejeicaoSemTexto(r) {
    if (r === undefined || r === null) return 'Promessa recusada sem motivo';
    try {
        if (typeof Event !== 'undefined' && r instanceof Event) { const alvo = r.target && r.target.tagName ? ` em <${String(r.target.tagName).toLowerCase()}>` : ''; return `Promessa recusada com evento "${r.type}"${alvo}`; }
    } catch (_) { /* segue */ }
    const tipo = (r && r.constructor && r.constructor.name) || typeof r;
    const campos = r && typeof r === 'object' ? Object.keys(r).slice(0, 6).join(', ') : '';
    return `Promessa recusada sem mensagem (${tipo}${campos ? `: ${campos}` : ''})`;
}

export function avisarErro(dados) {
    if (desligado || enviados >= MAX_POR_PAGINA) return;
    const msg = String((dados && dados.msg) || '').slice(0, 300);
    if (!msg) return;
    const chave = `${msg}|${dados.arquivo || ''}|${dados.linha || ''}`;
    if (vistos.has(chave)) return;
    vistos.add(chave); enviados++;
    const corpo = JSON.stringify({ acao: 'erro', tipo: dados.tipo || 'erro', msg, arquivo: String(dados.arquivo || '').slice(0, 300), linha: dados.linha || 0, coluna: dados.coluna || 0,
        pilha: String(dados.pilha || '').slice(0, 1500), pagina: location.pathname, loja: lojaAtual(), versao: versao(),
        ...(dados.tela ? { tela: String(dados.tela).slice(0, 40) } : {}) });   // defeito de tela (js/vigia-tela.js): "390px · letra 150%"
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
    // troca de página com animação (@view-transition no CSS): o aviso de animação cancelada fica tratado aqui
    const calar = (e) => { const t = e && e.viewTransition; if (t) { for (const k of ['ready', 'finished', 'updateCallbackDone']) t[k] && t[k].catch(() => {}); } };
    window.addEventListener('pageswap', calar); window.addEventListener('pagereveal', calar);
    window.addEventListener('unhandledrejection', (e) => {
        const r = e && e.reason, msg = mensagemDaRejeicao(r);
        if (rejeicaoDeRede(msg) || rejeicaoDoNavegador(r)) return;   // internet, animação cancelada, registro do app: não é defeito do site
        // sem mensagem: antes sumia sem deixar rastro. Agora entra na aba Erros dizendo O QUE era (evento, objeto), para dar para achar.
        avisarErro({ tipo: 'promessa', msg: msg || descreverRejeicaoSemTexto(r), pilha: r && r.stack });
    });
}
