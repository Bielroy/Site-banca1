// =====================================================================
//  js/admin-equipe.js — aba "Equipe": o proprietário dá acesso por e-mail.
//  Quem grava o papel é o servidor (/api/equipe); a tela só pede.
// =====================================================================
import { auth } from './firebase.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';
import { PAPEIS, ATRIBUIVEIS } from './papeis-lib.js';

const S = { equipe: null, estado: 'carregando', ligado: false, enviando: false };
const el = () => document.getElementById('equipe-conteudo');
const $ = (id) => document.getElementById(id);

async function api(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não foi possível concluir.');
    return j;
}
const opcoes = (atual) => ATRIBUIVEIS.map((p) => `<option value="${p}"${p === atual ? ' selected' : ''}>${PAPEIS[p][0]}</option>`).join('');

function render() {
    if (!el()) return;
    const lista = S.estado === 'ok'
        ? (S.equipe.length ? `<ul class="eq-lista">${S.equipe.map((m) => `
            <li class="eq-item">
                <span><b>${escapeHTML(m.email)}</b><small>${escapeHTML((PAPEIS[m.papel] || ['', ''])[1])}</small></span>
                ${m.papel === 'proprietario' ? '<em class="eq-fixo">Proprietário</em>' : `<select data-eq-papel="${escapeHTML(m.uid)}" aria-label="Papel de ${escapeHTML(m.email)}">${opcoes(m.papel)}</select>
                <button type="button" class="cal-apagar" data-eq-remover="${escapeHTML(m.uid)}" aria-label="Tirar o acesso de ${escapeHTML(m.email)}">&times;</button>`}
            </li>`).join('')}</ul>` : '<p class="config-sub">Ninguém além de você por enquanto.</p>')
        : `<div class="cp-vazio"><b>${S.estado === 'carregando' ? 'Carregando a equipe...' : 'Não consegui carregar a equipe.'}</b><span>${S.estado === 'erro' ? escapeHTML(S.erro || '') : ''}</span></div>`;
    el().innerHTML = `
    <div class="es-topo"><div><h3>Equipe</h3><p class="config-sub">Cada pessoa entra com o próprio e-mail e vê só o que o papel dela permite.</p></div></div>
    <div class="eq-novo">
        <div class="form-group"><label for="eq-email">E-mail da pessoa</label><input type="email" id="eq-email" autocomplete="off" inputmode="email" placeholder="nome@email.com"></div>
        <div class="form-group"><label for="eq-papel">Papel</label><select id="eq-papel">${opcoes('funcionario')}</select><small class="dica-campo" id="eq-papel-dica">${PAPEIS.funcionario[1]}</small></div>
        <button class="btn-salvar-config" id="eq-adicionar">Dar acesso</button>
    </div>
    <h4 class="cp-sub">Quem tem acesso</h4>
    ${lista}
    <p class="config-sub cal-nota">A pessoa abre o painel, digita o e-mail e entra pelo link que chega na caixa de entrada. Mudança de papel vale quando ela entrar de novo. Ao tirar o acesso, o painel que já estiver aberto pode continuar funcionando por até 1 hora.</p>`;
}

async function carregar() {
    try { S.equipe = (await api({ acao: 'listar' })).equipe || []; S.estado = 'ok'; }
    catch (e) { S.estado = 'erro'; S.erro = e.message; }
    render();
}
async function definir(email, papel, botao) {
    if (S.enviando) return; S.enviando = true; if (botao) botao.disabled = true;
    try { await api({ acao: 'definir', email, papel }); showToast(`${email} agora é ${PAPEIS[papel][0]}.`); await carregar(); }
    catch (e) { showToast(e.message, true); render(); }
    finally { S.enviando = false; if (botao) botao.disabled = false; }
}
function ligar() {
    if (S.ligado) return; S.ligado = true;
    el().addEventListener('click', async (e) => {
        if (e.target.closest('#eq-adicionar')) {
            const email = $('eq-email').value.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return showToast('Confira o e-mail.', true);
            return definir(email, $('eq-papel').value, $('eq-adicionar'));
        }
        const r = e.target.closest('[data-eq-remover]'); if (!r) return;
        const m = S.equipe.find((x) => x.uid === r.dataset.eqRemover); if (!m) return;
        if (!(await customConfirm('Tirar o acesso?', `${m.email} deixa de entrar no painel desta loja.`))) return;
        try { await api({ acao: 'remover', uid: m.uid }); showToast('Acesso retirado.'); await carregar(); } catch (err) { showToast(err.message, true); }
    });
    el().addEventListener('change', (e) => {
        if (e.target.id === 'eq-papel') { $('eq-papel-dica').textContent = PAPEIS[e.target.value][1]; return; }
        const s = e.target.closest('[data-eq-papel]'); if (!s) return;
        const m = S.equipe.find((x) => x.uid === s.dataset.eqPapel); if (m) definir(m.email, s.value);
    });
}
export async function abrirEquipe() {
    if (!el()) return;
    ligar();
    if (!S.equipe) { S.estado = 'carregando'; render(); }
    await carregar();
}
