// =====================================================================
//  js/admin-aparelho.js — ESTE APARELHO NO PAINEL (o servidor guarda e confere em lib/aparelhos.js).
//
//  Cada navegador ganha um número aleatório (fica só nele). Ao entrar e de 5 em 5 minutos o painel avisa o
//  servidor "este aparelho está aqui". Se o proprietário desconectou este aparelho, a resposta é "bloqueado"
//  e o painel sai na hora, apagando a cópia dos dados guardada no aparelho.
//  Também conta COMO a pessoa entrou (link do e-mail neste aparelho, link aberto em OUTRO aparelho, Face ID):
//  link aberto num aparelho diferente do que pediu = link encaminhado, e o dono é avisado.
//
//  APROVAÇÃO DE APARELHO (lib/aprovacao.js): na loja que exige, o login do link do e-mail não abre nada sozinho.
//  garantirAparelho() troca esse login pelo login preso a este aparelho (dado pelo servidor só se ele foi
//  aprovado) ou mostra "Aguardando aprovação do proprietário" e confere de 10 em 10 segundos.
// =====================================================================
import { auth, signInWithCustomToken } from './firebase.js';
import { TENANT } from './tenant.js';
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
        } else if (r.ok && (j.trocar || j.aprovacao === 'pendente')) {
            // a loja passou a exigir aparelho aprovado com o painel aberto: troca o login (ou mostra a espera)
            clearInterval(relogio);
            if (await garantirAparelho(u, { forcar: true })) relogio = setInterval(avisar, A_CADA_MS);   // loja não exige mais: segue conferindo
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

// ---------------------------------------------------------------- APROVAÇÃO DE APARELHO
const TELA = 'tela-aguardando-aparelho';
/** O login de agora já serve nesta loja? (mesma conta de lib/tenant.js faltaAparelho e firestore.rules aparelhoOk) */
const faltaAparelho = (c) => !!(c && c.plataforma !== true && c.apr && c.apr[TENANT] === true) && !(Array.isArray(c.apl) && c.apl.includes(TENANT));

async function pedirSessao(u) {
    const token = await u.getIdToken();
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'sessao-aparelho', aparelho: numeroDoAparelho() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não consegui conferir este aparelho.');
    return j;
}
async function trocarLogin(token) {
    // evita ficar recarregando sem fim se algo der errado na troca
    let n = 0; try { n = Number(sessionStorage.getItem('painel_troca') || 0); } catch (_) { /* segue */ }
    if (n >= 3) throw new Error('Não consegui abrir o painel neste aparelho. Saia e entre de novo.');
    try { sessionStorage.setItem('painel_troca', String(n + 1)); setTimeout(() => sessionStorage.removeItem('painel_troca'), 60000); } catch (_) { /* segue */ }
    await signInWithCustomToken(auth, token);
}
function mostrarEspera(dono, aoSair) {
    if (document.getElementById(TELA)) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="${TELA}" class="tela-espera-aparelho" role="alertdialog" aria-modal="true" aria-labelledby="espera-tit">
            <div class="tea-caixa">
                <h1 id="espera-tit">Aguardando aprovação</h1>
                <p>Esta loja só abre o painel em aparelhos aprovados. ${dono
                    ? 'Aprove este aparelho por outro aparelho seu que já entra no painel (Equipe → Aparelhos). Se não tiver nenhum, peça à plataforma para aprovar.'
                    : 'O proprietário recebeu um aviso no celular. Assim que ele aprovar em Equipe → Aparelhos, o painel abre aqui sozinho.'}</p>
                <p class="tea-conferindo" aria-live="polite">Conferindo de 10 em 10 segundos...</p>
                <button type="button" class="btn-outline" id="tea-sair">Sair</button>
            </div>
        </div>`);
    document.getElementById('tea-sair')?.addEventListener('click', aoSair);
}

/**
 * Antes de abrir o painel: na loja que exige aparelho aprovado, garante o login certo.
 * Devolve true = pode abrir agora (ou já trocou o login e é para recarregar); false = está esperando / bloqueado.
 */
export async function garantirAparelho(u, { forcar = false } = {}) {
    if (!u || u.isAnonymous) return false;
    let claims = {};
    try { claims = (await u.getIdTokenResult()).claims || {}; } catch (_) { /* segue com vazio */ }
    if (!forcar && !faltaAparelho(claims)) return true;
    let j;
    try { j = await pedirSessao(u); } catch (e) { showToast(e.message, true); return false; }
    if (j.livre) return true;
    if (j.bloqueado) { showToast('Este aparelho foi desconectado do painel pelo proprietário.', true); setTimeout(() => sairELimpar(), 1800); return false; }
    if (j.token) { try { await trocarLogin(j.token); } catch (e) { showToast(e.message, true); return false; } location.reload(); return false; }
    // aguardando: confere de 10 em 10 segundos até o dono aprovar
    let parar = false;
    mostrarEspera(!!j.dono, () => { parar = true; sairELimpar(); });
    const conferir = async () => {
        if (parar) return;
        try {
            const k = await pedirSessao(u);
            if (k.token) { parar = true; await trocarLogin(k.token); location.reload(); return; }
            if (k.livre) { parar = true; location.reload(); return; }
            if (k.bloqueado) { parar = true; showToast('O proprietário negou este aparelho.', true); setTimeout(() => sairELimpar(), 1800); return; }
        } catch (_) { /* sem internet: tenta de novo */ }
        setTimeout(conferir, 10000);
    };
    setTimeout(conferir, 10000);
    return false;
}
