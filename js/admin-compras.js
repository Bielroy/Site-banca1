// =====================================================================
//  js/admin-compras.js — aba "🛒 Compras" do painel.
//
//  "Comprar hoje": a lista montada por compras-lib.js. Na Ceasa você vai
//  marcando o que pegou (fica guardado no aparelho, funciona sem internet).
//  Depois, "Dar entrada no estoque" confere quantidade e preço pago e lança
//  tudo: o estoque sobe, o custo do produto é atualizado e a compra entra
//  no histórico.
// =====================================================================
import { getDoc } from './firebase.js';
import { tcol, tdoc, chave } from './tenant.js';
import { escapeHTML, fmt, showToast, openModal, closeModal } from './utils.js';
import { fmtQtd } from './estoque-lib.js';
import { listaDeCompras, textoDaLista } from './compras-lib.js';
import { carregarApoio, apoio, movimentar, movimentosRecentes } from './admin-estoque.js';
import { hojeBR, addDias, dataLonga } from './fechamento-lib.js';

const S = { produtos: [], acabou: [], acabouEm: 0, lista: null, ligado: false, proximaCompra: null };

// Próximo "dia de compra" do calendário (se houver). O calendário só é carregado aqui se a aba Compras precisar.
async function carregarProximaCompra() {
    try {
        const [{ lerCalendario }, { ocorrencias, somarDias }] = await Promise.all([import('./admin-calendario.js'), import('./calendario-lib.js')]);
        const hoje = hojeBR(), prox = ocorrencias(await lerCalendario(), hoje, somarDias(hoje, 30), { nacionais: false }).find((o) => o.tipo === 'compra');
        S.proximaCompra = prox ? prox.data : null;
    } catch (_) { S.proximaCompra = null; }
}
const el = () => document.getElementById('compras-conteudo');
const $ = (id) => document.getElementById(id);
const K = () => chave(`banca_compras_${hojeBR()}`);
const lerMarcados = () => { try { return new Set(JSON.parse(localStorage.getItem(K()) || '[]')); } catch (_) { return new Set(); } };
const gravarMarcados = (s) => { try { localStorage.setItem(K(), JSON.stringify([...s])); } catch (_) { /* cheio: segue sem guardar */ } };

// Produtos marcados "Não tem" no último fechamento (hoje, ou ontem se hoje ainda não foi feito). 2 leituras, guardadas por 10 min.
async function carregarFechamento() {
    if (Date.now() - S.acabouEm < 600000) return;
    try {
        const hoje = hojeBR();
        let s = await getDoc(tdoc('fechamentos', hoje));
        if (!s.exists()) s = await getDoc(tdoc('fechamentos', addDias(hoje, -1)));
        S.acabou = s.exists() ? Object.entries(s.data().itens || {}).filter(([, v]) => v && v.tem === false).map(([id]) => id) : [];
        S.acabouEm = Date.now();
    } catch (_) { S.acabou = []; }
}

function render() {
    if (!el()) return;
    const { previsto, perdas } = apoio();
    const L = S.lista = listaDeCompras({ produtos: S.produtos, previsto, perdas, acabou: S.acabou });
    const marcados = lerMarcados(), nMarc = L.comprar.filter((l) => marcados.has(l.id)).length;
    const linha = (l, comEntrada) => `
        <label class="cp-item${marcados.has(l.id) ? ' feito' : ''}">
            <input type="checkbox" data-cp-id="${escapeHTML(l.id)}"${marcados.has(l.id) ? ' checked' : ''}>
            <span class="cp-nome">${escapeHTML(l.nome)}<small>${comEntrada ? escapeHTML(l.motivo) : 'acabou no fechamento; sem estoque controlado'}</small></span>
            <span class="cp-qtd">${l.qtd ? fmtQtd(l.qtd, l.unidade) : 'conferir'}${comEntrada && l.custo ? `<small>≈ ${fmt(l.custo)}</small>` : ''}</span>
        </label>`;
    el().innerHTML = `
    <div class="es-topo">
        <div><h3>Comprar hoje</h3><p class="config-sub">${S.proximaCompra ? `<b class="cp-dia-compra">${S.proximaCompra === hojeBR() ? 'Hoje é dia de compra.' : `Próxima compra marcada: ${dataLonga(S.proximaCompra)}.`}</b> ` : ''}${dataLonga(hojeBR())}${L.total !== null ? ` · cerca de <b>${fmt(L.total)}</b>${L.semCusto ? ` (${L.semCusto} sem custo cadastrado)` : ''}` : ''}</p></div>
        <div class="cp-botoes"><button class="btn-outline" data-cp-acao="copiar">Copiar lista</button><button class="btn-outline" data-cp-acao="historico">Histórico</button></div>
    </div>
    ${L.comprar.length ? `<div class="cp-lista">${L.comprar.map((l) => linha(l, true)).join('')}</div>`
        : `<div class="cp-vazio"><b>Nada para comprar agora.</b><span>${S.produtos.some((p) => p.estoqueMin != null && p.estoqueMin !== '') ? 'Todos os produtos com mínimo definido estão em dia.' : 'A lista aparece quando os produtos têm estoque contado e um mínimo definido. Comece pela aba Estoque: "Contar" e depois "Limites".'}</span></div>`}
    ${L.conferir.length ? `<h4 class="cp-sub">Conferir</h4><div class="cp-lista">${L.conferir.map((l) => linha(l, false)).join('')}</div>` : ''}
    ${L.produzir.length ? `<h4 class="cp-sub">Produzir</h4><ul class="cp-produzir">${L.produzir.map((l) => `<li><span>${escapeHTML(l.nome)}<small>${escapeHTML(l.motivo)}; os ingredientes já estão na lista acima</small></span><b>${l.qtd} un</b></li>`).join('')}</ul><p class="config-sub">Para registrar a produção, use o botão Produzir na aba Estoque.</p>` : ''}
    ${nMarc ? `<div class="cp-rodape"><button class="btn-salvar-config" data-cp-acao="entrada">Dar entrada no estoque (${nMarc})</button></div>` : ''}`;
}

function garantirModal() {
    if ($('modal-compras')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-compras" role="dialog" aria-modal="true" aria-labelledby="cp-m-titulo">
        <div class="modal modal-lg">
            <header class="modal-head"><h2 id="cp-m-titulo"></h2><button class="btn-fechar" data-fechar="modal-compras" aria-label="Fechar">&times;</button></header>
            <div class="modal-body" id="cp-m-corpo"></div>
            <footer class="modal-footer" id="cp-m-rodape"><button class="btn-salvar-config" id="cp-m-gravar">Lançar no estoque</button></footer>
        </div>
    </div>`);
    $('cp-m-gravar').addEventListener('click', lancar);
}
const numero = (elx) => { const v = String(elx?.value || '').replace(',', '.').trim(); return v === '' ? null : Number(v); };

function abrirEntrada() {
    garantirModal();
    const marcados = lerMarcados(), itens = S.lista.comprar.filter((l) => marcados.has(l.id));
    $('cp-m-titulo').textContent = 'Dar entrada no estoque'; $('cp-m-rodape').hidden = false;
    $('cp-m-corpo').innerHTML = `<p class="config-sub">Confira o que você trouxe e quanto pagou. O preço é opcional, mas é ele que alimenta o custo e as margens.</p>
        <div class="cp-entrada">${itens.map((l) => `
        <div class="cp-e-linha" data-id="${escapeHTML(l.id)}" data-un="${escapeHTML(l.unidade)}">
            <strong>${escapeHTML(l.nome)}</strong>
            <label>Quantidade (${escapeHTML(l.unidade)})<input class="cp-e-qtd" type="text" inputmode="decimal" autocomplete="off" value="${String(l.qtd).replace('.', ',')}"></label>
            <label>Pagou por ${escapeHTML(l.unidade)}<input class="cp-e-custo" type="text" inputmode="decimal" autocomplete="off" value="${l.custoUnit ? String(l.custoUnit).replace('.', ',') : ''}" placeholder="opcional"></label>
            <span class="cp-e-status" aria-live="polite"></span>
        </div>`).join('')}</div>`;
    openModal('modal-compras');
}

async function lancar() {
    const b = $('cp-m-gravar'); if (b.disabled) return;
    const linhas = [...document.querySelectorAll('#cp-m-corpo .cp-e-linha:not(.ok)')];
    for (const l of linhas) {            // confere tudo antes de lançar qualquer coisa
        const q = numero(l.querySelector('.cp-e-qtd')), c = numero(l.querySelector('.cp-e-custo'));
        if (!(q > 0)) { l.querySelector('.cp-e-qtd').focus(); return showToast('Confira a quantidade: precisa ser maior que zero.', true); }
        if (c !== null && !(c > 0)) { l.querySelector('.cp-e-custo').focus(); return showToast('O preço pago precisa ser maior que zero (ou fique em branco).', true); }
    }
    b.disabled = true; b.textContent = 'Lançando...';
    const marcados = lerMarcados(); let ok = 0, falhas = 0;
    for (const l of linhas) {
        const st = l.querySelector('.cp-e-status');
        // a chave fica presa à linha: se a internet cair e você tocar de novo, a mesma compra não entra duas vezes
        l.dataset.chave = l.dataset.chave || (crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2, 10)}`);
        try {
            const r = await movimentar({ produtoId: l.dataset.id, tipo: 'compra', qtd: numero(l.querySelector('.cp-e-qtd')), custoUnit: numero(l.querySelector('.cp-e-custo')), obs: 'Lista de compras', chave: l.dataset.chave });
            l.classList.add('ok'); l.querySelectorAll('input').forEach((i) => { i.disabled = true; });
            st.textContent = `Lançado. Agora tem ${fmtQtd(r.saldo, l.dataset.un)}.`; marcados.delete(l.dataset.id); ok++;
        } catch (e) { st.textContent = e.message || 'Não foi possível lançar.'; l.classList.add('erro'); falhas++; }
    }
    gravarMarcados(marcados);
    b.disabled = false; b.textContent = falhas ? 'Tentar de novo os que faltaram' : 'Lançar no estoque';
    if (!falhas) { $('cp-m-rodape').hidden = true; showToast(`${ok} compra(s) lançada(s) no estoque.`); }
    else showToast(`${ok} lançada(s), ${falhas} com problema. Confira a internet e tente de novo.`, true);
}

async function abrirHistorico() {
    garantirModal(); $('cp-m-titulo').textContent = 'Histórico de compras'; $('cp-m-rodape').hidden = true;
    $('cp-m-corpo').innerHTML = '<p class="config-sub">Carregando...</p>'; openModal('modal-compras');
    try {
        const movs = await movimentosRecentes('tipo', 'compra', 300);
        const dias = new Map();
        movs.forEach((m) => { const d = new Date(new Date(m.em).getTime() - 3 * 3600000).toISOString().slice(0, 10); if (!dias.has(d)) dias.set(d, []); dias.get(d).push(m); });
        $('cp-m-corpo').innerHTML = dias.size ? [...dias.entries()].slice(0, 30).map(([d, ms]) => {
            const total = ms.reduce((s, m) => s + (Number(m.valor) || 0), 0);
            return `<section class="cp-dia"><h4>${dataLonga(d)}${total ? `<b>${fmt(total)}</b>` : ''}</h4><ul class="es-hist">${ms.map((m) => `<li class="pos"><div><b>${escapeHTML(m.nome)}</b><small>${m.custoUnit ? `${fmt(m.custoUnit)} por ${escapeHTML(m.unidade || 'un')}` : 'sem preço informado'}${m.obs && m.obs !== 'Lista de compras' ? ` · ${escapeHTML(m.obs)}` : ''}</small></div><div class="es-hist-num"><b>${fmtQtd(m.qtd, m.unidade)}</b>${m.valor ? `<small>${fmt(m.valor)}</small>` : ''}</div></li>`).join('')}</ul></section>`;
        }).join('') : '<p class="config-sub">Nenhuma compra registrada ainda.</p>';
    } catch (e) { $('cp-m-corpo').innerHTML = `<p class="config-sub">${e && e.code === 'permission-denied' ? 'Sem permissão para ler o histórico. Publique as regras novas do Firestore.' : 'Não consegui carregar o histórico. Confira a internet.'}</p>`; }
}

function ligar() {
    if (S.ligado) return; S.ligado = true;
    el().addEventListener('change', (e) => {
        const id = e.target.dataset.cpId; if (!id) return;
        const m = lerMarcados(); if (e.target.checked) m.add(id); else m.delete(id);
        gravarMarcados(m); render();
    });
    el().addEventListener('click', async (e) => {
        const a = e.target.closest('[data-cp-acao]'); if (!a) return;
        if (a.dataset.cpAcao === 'entrada') abrirEntrada();
        if (a.dataset.cpAcao === 'historico') abrirHistorico();
        if (a.dataset.cpAcao === 'copiar') {
            const txt = textoDaLista(S.lista, dataLonga(hojeBR()), fmtQtd);
            try { await navigator.clipboard.writeText(txt); showToast('Lista copiada. Cole no WhatsApp.'); }
            catch (_) { showToast('Não consegui copiar neste navegador.', true); }
        }
    });
}

export async function abrirCompras(produtos) {
    if (!el()) return;
    S.produtos = produtos || []; ligar(); render();
    await Promise.all([carregarApoio(), carregarFechamento(), carregarProximaCompra()]);
    render();
}
