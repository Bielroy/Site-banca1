// =====================================================================
//  js/admin-passkey.js — ENTRADA RÁPIDA NO PAINEL (tela de login e aviso depois de entrar).
//
//  - Tela de login: o e-mail da última entrada já vem preenchido; com Face ID/digital ativado neste aparelho,
//    o botão "Entrar com Face ID ou digital" entra direto (e, no iPhone/Android, a chave também aparece como
//    sugestão ao tocar no campo de e-mail).
//  - Depois de entrar pelo link do e-mail: um aviso oferece ativar o Face ID/digital neste aparelho.
//    "Agora não" esconde o aviso por 30 dias.
// =====================================================================
import { auth, signInWithCustomToken } from './firebase.js';
import * as PK from './passkey-cliente.js';
import { showToast } from './utils.js';
import { anotarComoEntrou, numeroDoAparelho } from './admin-aparelho.js';

const CH_EMAIL = 'painel_ultimo_email';
const CH_APARELHO = 'pk_aparelho';          // este aparelho já entra com Face ID/digital: o botão vira o caminho principal
const chAtivo = (uid) => `pk_ativo:${uid}`, chNao = (uid) => `pk_nao:${uid}`;
const ler = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sem armazenamento */ } };
const $ = (id) => document.getElementById(id);
const TRINTA_DIAS = 30 * 86400000;

let sugestaoAtiva = null;
const avisar = (texto, cor = 'var(--text-dark)') => { const m = $('login-msg'); if (m) { m.textContent = texto; m.style.color = cor; } };

async function entrarComToken(token) {
    avisar('Entrando...');
    anotarComoEntrou('passkey');
    gravar(CH_APARELHO, '1');
    await signInWithCustomToken(auth, token);       // o resto (conferir o papel, abrir o painel) é o onAuthStateChanged de js/admin.js
}

// a chave aparece na sugestão do teclado ao tocar no campo de e-mail (sem abrir nada sozinha)
async function ligarSugestao() {
    if (sugestaoAtiva || !(await PK.temSugestaoNoCampo())) return;
    const ctrl = new AbortController(); sugestaoAtiva = ctrl;
    try { await entrarComToken(await PK.pedirEntrada({ condicional: true, sinal: ctrl.signal, aparelho: numeroDoAparelho() })); }
    catch (e) {
        if (ctrl.signal.aborted || (e && e.name === 'AbortError')) return;
        const m = PK.explicarErro(e); if (m) avisar(m, 'var(--danger)');
        setTimeout(() => { PK.prepararEntrada(true).then(ligarSugestao).catch(() => {}); }, 400);
    } finally { if (sugestaoAtiva === ctrl) sugestaoAtiva = null; }
}

/** Liga a tela de login: e-mail lembrado e o botão de Face ID/digital (se o aparelho tiver). */
export async function iniciarLoginRapido() {
    const email = $('email');
    const ultimo = ler(CH_EMAIL);
    if (email && ultimo && !email.value) email.value = ultimo;
    const caixa = $('login-passkey'), bt = $('btn-passkey');
    if (!caixa || !bt || !(await PK.temSuporte())) return false;
    caixa.hidden = false;
    // FACE ID COMO CAMINHO PRINCIPAL: neste aparelho já deu certo antes, então o e-mail fica guardado atrás de um botão
    if (ler(CH_APARELHO)) {
        const box = caixa.closest('.login-box'), outro = $('login-outro'), sub = box && box.querySelector('.login-sub');
        if (box && outro) {
            box.classList.add('com-faceid'); outro.hidden = false;
            if (sub) sub.textContent = 'Toque no botão e confirme com Face ID ou digital.';
            outro.addEventListener('click', () => { box.classList.add('mostrar-email'); $('email')?.focus(); });
        }
    }
    PK.prepararEntrada().then(ligarSugestao).catch(() => { /* sem servidor: o botão tenta de novo no toque */ });
    // o desafio vale 5 min: renova antes, para o toque no iPhone nunca esperar internet (o Safari exige o Face ID logo após o toque)
    const renovar = setInterval(() => { if (!document.getElementById('login-passkey') || $('login-screen')?.style.display === 'none') return clearInterval(renovar); if (!sugestaoAtiva) PK.prepararEntrada(true).then(ligarSugestao).catch(() => {}); }, 210000);
    bt.addEventListener('click', async () => {
        if (bt.disabled) return;
        if (sugestaoAtiva) { sugestaoAtiva.abort(); sugestaoAtiva = null; }
        bt.disabled = true; avisar('Confirme com Face ID ou digital...');
        try { await entrarComToken(await PK.pedirEntrada({ aparelho: numeroDoAparelho() })); }
        catch (e) {
            const m = PK.explicarErro(e); avisar(m || '', 'var(--danger)');
            PK.prepararEntrada(true).then(ligarSugestao).catch(() => {});
        } finally { bt.disabled = false; }
    });
    return true;
}

/** Depois de entrar: guarda o e-mail para a próxima vez e, se for o caso, oferece ativar o Face ID/digital. */
export async function depoisDeEntrar(user) {
    if (!user || user.isAnonymous) return;
    if (user.email) gravar(CH_EMAIL, user.email);
    if (ler(chAtivo(user.uid))) return;
    const nao = Number(ler(chNao(user.uid)) || 0);
    if (nao && Date.now() - nao < TRINTA_DIAS) return;
    if (!(await PK.temSuporte()) || $('pk-oferta')) return;
    const pegarToken = () => user.getIdToken();
    // só oferece se o servidor já tem o Face ID (servidor ainda não atualizado respondia "Não encontrado." no toque)
    try { await PK.prepararCadastro(await pegarToken()); } catch (_) { return; }
    if ($('pk-oferta')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="pk-oferta" id="pk-oferta" role="region" aria-label="Entrar mais rápido">
            <b>Entrar mais rápido neste aparelho</b>
            <span>Da próxima vez, entre com Face ID ou digital, sem esperar link no e-mail.</span>
            <div class="pk-oferta-bts"><button type="button" class="btn-salvar-config" data-pk="ativar">Ativar</button><button type="button" class="btn-outline" data-pk="agora-nao">Agora não</button></div>
        </div>`);
    const caixa = $('pk-oferta');
    const renovar = setInterval(() => { if (!document.body.contains(caixa)) return clearInterval(renovar); pegarToken().then((t) => PK.prepararCadastro(t)).catch(() => {}); }, 210000);
    caixa.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-pk]'); if (!b) return;
        if (b.dataset.pk === 'agora-nao') { gravar(chNao(user.uid), String(Date.now())); caixa.remove(); return; }
        b.disabled = true;
        try {
            await PK.ativar(pegarToken, numeroDoAparelho());
            gravar(chAtivo(user.uid), '1'); gravar(CH_APARELHO, '1'); caixa.remove();
            showToast('Pronto! Da próxima vez, toque em "Entrar com Face ID ou digital".');
        } catch (err) {
            if (err && err.name === 'InvalidStateError') { gravar(chAtivo(user.uid), '1'); caixa.remove(); showToast('Este aparelho já está com Face ID/digital ativado.'); return; }
            const m = PK.explicarErro(err); if (m && !(err && err.name === 'NotAllowedError')) showToast(m, true);
            PK.prepararCadastro(await pegarToken().catch(() => '')).catch(() => {});
        } finally { b.disabled = false; }
    });
}
