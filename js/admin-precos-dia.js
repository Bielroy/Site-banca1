// =====================================================================
//  js/admin-precos-dia.js — PREÇO POR DIA DA SEMANA (painel → Produtos).
//
//  Abre no dia de HOJE (Brasília). Toque em outro dia para mudar o preço dele
//  sem esperar o dia chegar. O preço de cada dia vale para os pedidos
//  ENTREGUES nesse dia: o cliente da feira de terça vê o de terça, o da
//  quarta vê o de quarta. Em branco = o preço normal do produto.
//  Fica fixo até você mudar. Oferta ligada ("de X por Y") vale em todos os dias.
//  Grava produtos/{id}.precosDia = { "2": 9.9 } (o servidor cobra por ele: lib/feira.js).
// =====================================================================
import { updateDoc, deleteField } from './firebase.js';
import { tdoc } from './tenant.js';
import { escapeHTML, fmt, showToast, openModal, closeModal, customConfirm } from './utils.js';
import { emOferta, limparPrecosDia } from './oferta-lib.js';
import { DIAS_SEMANA } from './plataforma-lib.js';

const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const hojeBR = () => new Date(Date.now() - 3 * 3600000).getUTCDay();
const S = { dia: hojeBR(), produtos: [], editado: new Map(), invalidos: new Set(), busca: '', ligado: false, salvando: false };
const $ = (id) => document.getElementById(id);
// "12,50" / "12.5" / "1.234,56" → número; '' → null (= preço normal); texto que não é preço → NaN (avisa, não apaga)
const num = (v) => {
    let t = String(v == null ? '' : v).trim().replace(/^R\$\s*/i, ''); if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    const n = Number(t); return n > 0 && n < 100000 ? n : NaN;
};

// o mapa de preços por dia de um produto, já com o que foi digitado e não salvo
const mapaDe = (p) => S.editado.get(p.id) || limparPrecosDia(p.precosDia);

function render() {
    const corpo = $('pd-corpo'); if (!corpo) return;
    const hoje = hojeBR(), termo = S.busca.toLowerCase();
    const lista = S.produtos.filter((p) => !p.soInsumo && Number(p.preco) > 0 && (!termo || String(p.nome || '').toLowerCase().includes(termo)));
    corpo.innerHTML = `
        <p class="config-sub">Hoje é <b>${NOMES[hoje]}</b>. O preço de cada dia vale para os pedidos entregues nesse dia e fica assim até você mudar. Em branco, vale o preço normal.</p>
        <div class="pd-dias" role="group" aria-label="Dia da semana">${DIAS_SEMANA.map((d, i) => `<button type="button" class="pd-dia${i === S.dia ? ' on' : ''}" data-pd-dia="${i}" aria-pressed="${i === S.dia}">${d}${i === hoje ? '<small>hoje</small>' : ''}</button>`).join('')}</div>
        <input type="search" id="pd-busca" class="pd-busca" placeholder="Buscar produto..." value="${escapeHTML(S.busca)}" aria-label="Buscar produto">
        <h3 class="pd-tit">Preços de ${NOMES[S.dia]}</h3>
        <div class="pd-lista">${lista.length ? lista.map((p) => {
            const m = mapaDe(p), v = m[S.dia], oferta = emOferta(p);
            return `<label class="pd-item${S.editado.has(p.id) ? ' mudou' : ''}">
                <span class="pd-nome"><b>${escapeHTML(p.nome)}</b><small>Normal ${fmt(Number(p.preco))} / ${escapeHTML(p.unidade || 'un')}${oferta ? ' · <em>em oferta: a oferta vale todos os dias</em>' : ''}</small></span>
                <span class="pd-campo">R$ <input type="text" inputmode="decimal" data-pd-id="${escapeHTML(p.id)}" value="${v != null ? String(v.toFixed(2)).replace('.', ',') : ''}" placeholder="${String(Number(p.preco).toFixed(2)).replace('.', ',')}" ${oferta ? 'disabled' : ''} aria-label="Preço de ${escapeHTML(p.nome)} na ${NOMES[S.dia]}"></span>
            </label>`;
        }).join('') : '<p class="config-sub">Nenhum produto com esse nome.</p>'}</div>`;
    const b = $('pd-salvar'); if (b) { b.disabled = S.salvando || !S.editado.size; b.textContent = S.salvando ? 'Salvando…' : S.editado.size ? `Salvar os preços (${S.editado.size})` : 'Salvar os preços'; }
}

function ligar() {
    if (S.ligado) return; S.ligado = true;
    const corpo = $('pd-corpo');
    corpo.addEventListener('click', (e) => { const d = e.target.closest('[data-pd-dia]'); if (d) { S.dia = Number(d.dataset.pdDia); render(); } });
    corpo.addEventListener('input', (e) => {
        if (e.target.id === 'pd-busca') { S.busca = e.target.value; const pos = e.target.selectionStart; render(); const b = $('pd-busca'); b.focus(); b.setSelectionRange(pos, pos); return; }
        const id = e.target.dataset.pdId; if (!id) return;
        const p = S.produtos.find((x) => x.id === id); if (!p) return;
        const m = { ...mapaDe(p) }, v = num(e.target.value);
        e.target.classList.toggle('invalido', Number.isNaN(v));
        if (Number.isNaN(v)) { S.invalidos.add(`${id}:${S.dia}`); return; }
        S.invalidos.delete(`${id}:${S.dia}`);
        if (v == null) delete m[S.dia]; else m[S.dia] = v;
        const original = limparPrecosDia(p.precosDia);
        if (JSON.stringify(m) === JSON.stringify(original)) S.editado.delete(id); else S.editado.set(id, m);
        e.target.closest('.pd-item')?.classList.toggle('mudou', S.editado.has(id));
        const b = $('pd-salvar'); if (b) { b.disabled = !S.editado.size; b.textContent = S.editado.size ? `Salvar os preços (${S.editado.size})` : 'Salvar os preços'; }
    });
    $('pd-salvar').addEventListener('click', salvar);
    // fechar com preço digitado e não salvo: pergunta antes (o botão × e o fundo da tela)
    $('modal-precos-dia').addEventListener('click', async (e) => {
        const fechar = e.target.closest('[data-fechar="modal-precos-dia"]') || e.target.id === 'modal-precos-dia';
        if (!fechar || !S.editado.size || S.salvando) return;
        e.stopImmediatePropagation(); e.preventDefault();
        if (await customConfirm('Sair sem salvar?', `${S.editado.size} produto(s) com preço mudado e não salvo.`, { ok: 'Sair sem salvar', nao: 'Continuar' })) { S.editado.clear(); S.invalidos.clear(); closeModal('modal-precos-dia'); if (history.state && history.state.modal === 'modal-precos-dia') history.back(); }
    }, true);
}

async function salvar() {
    if (S.salvando || !S.editado.size) return;
    if (S.invalidos.size) return showToast('Há preço escrito de um jeito que não entendi (em vermelho). Exemplo: 12,50.', true);
    S.salvando = true; render();
    const falhas = [];
    for (const [id, m] of S.editado) {
        // grava SÓ os dias que mudaram: outro aparelho pode ter mudado outro dia enquanto esta tela estava aberta
        const p = S.produtos.find((x) => x.id === id), antes = limparPrecosDia(p && p.precosDia), novo = limparPrecosDia(m), mudancas = { ultimaModificacao: Date.now() };
        for (let d = 0; d <= 6; d++) if (antes[d] !== novo[d]) mudancas[`precosDia.${d}`] = novo[d] == null ? deleteField() : novo[d];
        try { await updateDoc(tdoc('produtos', id), mudancas); if (p) p.precosDia = { ...antes, ...novo }; S.editado.delete(id); }
        catch (e) { console.error(e); falhas.push(id); }
    }
    S.salvando = false; render();
    if (falhas.length) showToast(`Não consegui salvar ${falhas.length} produto(s). Confira a internet e toque em Salvar de novo.`, true);
    else { showToast('Preços salvos. Já valem na loja.'); closeModal('modal-precos-dia'); if (history.state && history.state.modal === 'modal-precos-dia') history.back(); }
}

/** Abre a tela. `produtos` = a lista ao vivo do painel. */
export function abrirPrecosDia(produtos) {
    S.produtos = (produtos || []).map((p) => ({ ...p })).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    S.dia = hojeBR(); S.busca = ''; S.editado.clear(); S.invalidos.clear();
    ligar(); render(); openModal('modal-precos-dia');
}
