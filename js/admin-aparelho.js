// =====================================================================
//  js/admin-aparelho.js — ESTE APARELHO NO PAINEL (o servidor guarda e confere em lib/aparelhos.js).
//
//  Cada navegador ganha um número aleatório (fica só nele). Ao entrar e de 5 em 5 minutos o painel avisa o
//  servidor "este aparelho está aqui". Se o proprietário desconectou este aparelho, a resposta é "bloqueado"
//  e o painel sai na hora, apagando a cópia dos dados guardada no aparelho.
//  Também conta COMO a pessoa entrou (link do e-mail neste aparelho, link aberto em OUTRO aparelho, Face ID):
//  link aberto num aparelho diferente do que pediu = link encaminhado, e o dono é avisado.
// =====================================================================
import { auth } from './firebase.js';
import { sairELimpar } from './admin-guard.js';
import { showToast } from './utils.js';

const CHAVE = 'painel_aparelho', COMO = 'painel_como';
const A_CADA_MS = 5 * 60000;

/** O número deste aparelho (cria na primeira vez). */
export function numeroDoAparelho() {
    let id = null;
    try { id = localStorage.getItem(CHAVE); } catch (_) { /* sem armazenamento */ }
    if (!id || !/^[A-Za-z0-9_-]{16,80}$/.test(id)) {
        const b = new Uint8Array(18); crypto.getRandomValues(b);
        id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        try { localStorage.setItem(CHAVE, id); } catch (_) { /* sem armazenamento: vale só nesta visita */ }
    }
    return id;
}
/** Anota como a pessoa acabou de entrar ('link' | 'link-outro-aparelho' | 'passkey'); vai junto no próximo aviso. */
export function anotarComoEntrou(como) { try { sessionStorage.setItem(COMO, como); } catch (_) { /* sem armazenamento */ } }

let relogio = null, saindo = false, ligado = false;
async function avisar() {
    const u = auth.currentUser;
    if (!u || u.isAnonymous || saindo) return;
    let como = '';
    try { como = sessionStorage.getItem(COMO) || ''; } catch (_) { /* sem armazenamento */ }
    try {
        const token = await u.getIdToken();
        const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'aparelho', aparelho: numeroDoAparelho(), ...(como ? { como } : {}) }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && como) { try { sessionStorage.removeItem(COMO); } catch (_) { /* segue */ } }
        if (r.ok && j.bloqueado) {
            saindo = true; clearInterval(relogio);
            showToast('Este aparelho foi desconectado do painel pelo proprietário.', true);
            setTimeout(() => sairELimpar(), 1800);
        }
    } catch (_) { /* sem internet: tenta na próxima */ }
}

/** Liga a conferência (chamado depois que o painel abriu). */
export function vigiarEsteAparelho() {
    avisar();
    clearInterval(relogio);
    relogio = setInterval(avisar, A_CADA_MS);
    if (!ligado) { ligado = true; document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') avisar(); }); }
}
