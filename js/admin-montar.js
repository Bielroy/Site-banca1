// =====================================================================
//  js/admin-montar.js — MONTAR PEDIDO no cadastro do produto (painel).
//  O dono cria os grupos de escolha do produto: "Complementos (até 4 grátis)",
//  "Adicionais (cada um com o seu preço)", "Ponto da carne (escolha 1)"...
//  Começa de um modelo pronto (açaí, pastel, lanche, cesta), de outro produto
//  que já tem, ou em branco. Regras e conta: js/montar-lib.js.
//
//  iniciarMontarAdmin({ produtos })  produtos = () => lista atual (para "copiar de")
//  preencherMontar(p)                ao abrir um produto (null = produto novo)
//  lerMontar()                       ao salvar → { grupos } | null; lança erro com texto para o dono
// =====================================================================
import { montarDoProduto, idDe, gruposDoModelo, MODELOS_MONTAR, MAX_GRUPOS, MAX_OPCOES, regraDoGrupo } from './montar-lib.js';
import { escapeHTML, fmt } from './utils.js';

let grupos = [];
let produtosDaLoja = () => [];
const $ = (id) => document.getElementById(id);
const FRAC = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const porPeso = () => FRAC.includes(String($('edit-unidade')?.value || '').toLowerCase());
const precoTexto = (v) => (Number(v) > 0 ? String(Number(v).toFixed(2)).replace('.', ',') : '');
const lerNumero = (t) => { const s = String(t || '').replace(/r\$/gi, '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); const n = Number(s); return s === '' ? 0 : Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };

/** Tipo de escolha do grupo, do jeito que o dono entende. */
const tipoDe = (g) => (g.max === 1 ? (g.min === 1 ? 'uma' : 'uma-opcional') : 'varias');

function resumo() {
    const n = grupos.length, ops = grupos.reduce((t, g) => t + g.opcoes.length, 0);
    const r = $('montar-resumo'); if (r) r.textContent = n ? `${n} ${n === 1 ? 'grupo' : 'grupos'} · ${ops} ${ops === 1 ? 'opção' : 'opções'}` : 'açaí com complementos, pastel com adicionais...';
}

function pintar() {
    const box = $('montar-corpo'); if (!box) return;
    resumo();
    if (porPeso()) { box.innerHTML = '<p class="mt-ad-aviso">Produto vendido por peso não usa "montar pedido": o preço sai da balança. Troque a unidade para Unidade (ou Kit) para usar.</p>'; return; }
    const comMontar = produtosDaLoja().filter((p) => p.id !== $('edit-id')?.value && montarDoProduto(p));
    const inicio = `
        <div class="mt-ad-inicio">
            <p>O cliente toca no produto e escolhe as opções antes de pôr na sacola. Cada opção pode ser grátis ou ter preço. Comece por um modelo e ajuste:</p>
            <div class="mt-ad-modelos">
                ${Object.entries(MODELOS_MONTAR).map(([k, m]) => `<button type="button" class="prod-chip" data-mt-modelo="${k}">${escapeHTML(m.nome)}</button>`).join('')}
                <button type="button" class="prod-chip" data-mt-acao="grupo">Em branco</button>
            </div>
            ${comMontar.length ? `<label class="mt-ad-copiar">Ou copie de outro produto
                <select data-mt-copiar><option value="">Escolha…</option>${comMontar.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.nome)}</option>`).join('')}</select></label>` : ''}
        </div>`;
    if (!grupos.length) { box.innerHTML = inicio; return; }
    box.innerHTML = grupos.map((g, gi) => {
        const t = tipoDe(g);
        return `
        <fieldset class="mt-ad-grupo" data-gi="${gi}">
            <div class="mt-ad-grupo-topo">
                <input type="text" class="mt-ad-nome" data-campo="nome" value="${escapeHTML(g.nome)}" maxlength="40" placeholder="Nome do grupo (ex.: Complementos)" aria-label="Nome do grupo">
                <div class="mt-ad-mover">
                    <button type="button" data-mt-acao="subir" aria-label="Subir grupo" ${gi === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" data-mt-acao="descer" aria-label="Descer grupo" ${gi === grupos.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" data-mt-acao="tirar-grupo" aria-label="Apagar grupo">×</button>
                </div>
            </div>
            <div class="mt-ad-tipo" role="radiogroup" aria-label="Como o cliente escolhe">
                <button type="button" class="prod-chip${t === 'uma' ? ' on' : ''}" data-mt-tipo="uma">Escolhe 1 (obrigatório)</button>
                <button type="button" class="prod-chip${t === 'uma-opcional' ? ' on' : ''}" data-mt-tipo="uma-opcional">Escolhe 1 (opcional)</button>
                <button type="button" class="prod-chip${t === 'varias' ? ' on' : ''}" data-mt-tipo="varias">Escolhe várias</button>
            </div>
            ${t === 'varias' ? `<div class="mt-ad-regras">
                <label>Até <input type="number" inputmode="numeric" min="1" max="${MAX_OPCOES}" data-campo="max" value="${g.max}"></label>
                <label>Mínimo <input type="number" inputmode="numeric" min="0" max="${MAX_OPCOES}" data-campo="min" value="${g.min}"></label>
                <label>Grátis <input type="number" inputmode="numeric" min="0" max="${MAX_OPCOES}" data-campo="gratis" value="${g.gratis}"></label>
            </div><small class="dica-campo">"Grátis": as primeiras escolhas não pagam (as mais caras saem de graça). Ex.: até 4, grátis 3 → a 4ª paga o preço dela.</small>` : ''}
            <ul class="mt-ad-ops">
                ${g.opcoes.map((o, oi) => `
                <li data-oi="${oi}"${o.ativo === false ? ' class="acabou"' : ''}>
                    <input type="text" data-campo="op-nome" value="${escapeHTML(o.nome)}" maxlength="40" placeholder="Opção (ex.: Granola)" aria-label="Nome da opção">
                    <input type="text" inputmode="decimal" data-campo="op-preco" value="${precoTexto(o.preco)}" placeholder="grátis" aria-label="Preço a mais de ${escapeHTML(o.nome || 'opção')}">
                    <button type="button" class="mt-ad-tem${o.ativo === false ? '' : ' on'}" data-mt-acao="ativo" role="switch" aria-checked="${o.ativo !== false}" title="${o.ativo === false ? 'Acabou hoje' : 'Tem hoje'}">${o.ativo === false ? 'acabou' : 'tem'}</button>
                    <button type="button" class="mt-ad-x" data-mt-acao="tirar-op" aria-label="Apagar opção">×</button>
                </li>`).join('')}
            </ul>
            <button type="button" class="mt-ad-mais" data-mt-acao="op" ${g.opcoes.length >= MAX_OPCOES ? 'disabled' : ''}>+ Opção</button>
            <p class="mt-ad-previa" data-previa="${gi}"></p>
        </fieldset>`;
    }).join('') + `<button type="button" class="bt bt-sec mt-ad-novo" data-mt-acao="grupo" ${grupos.length >= MAX_GRUPOS ? 'disabled' : ''}>+ Grupo de escolha</button>`;
    pintarPrevias();
}

function pintarPrevias() {
    grupos.forEach((g, gi) => {
        const el = document.querySelector(`#montar-corpo [data-previa="${gi}"]`); if (!el) return;
        const m = montarDoProduto({ unidade: 'un', montar: { grupos: [g] } });
        const pagos = g.opcoes.filter((o) => Number(o.preco) > 0);
        el.textContent = m ? `Na loja: ${regraDoGrupo(m.grupos[0])}${pagos.length ? ` · de ${fmt(Math.min(...pagos.map((o) => o.preco)))} a ${fmt(Math.max(...pagos.map((o) => o.preco)))}` : ''}` : 'Dê um nome ao grupo e pelo menos uma opção.';
    });
}

const usados = () => new Set(grupos.map((g) => g.id));
function novoGrupo() { grupos.push({ id: idDe('grupo', usados()), nome: '', min: 0, max: 3, gratis: 0, opcoes: [{ id: 'op', nome: '', preco: 0, ativo: true }] }); }

function aoClicar(e) {
    const modelo = e.target.closest('[data-mt-modelo]');
    if (modelo) { grupos = gruposDoModelo(modelo.dataset.mtModelo); pintar(); return; }
    const tipo = e.target.closest('[data-mt-tipo]');
    const gEl = e.target.closest('[data-gi]'), g = gEl ? grupos[Number(gEl.dataset.gi)] : null;
    if (tipo && g) {
        const t = tipo.dataset.mtTipo;
        if (t === 'uma') { g.min = 1; g.max = 1; g.gratis = 0; }
        else if (t === 'uma-opcional') { g.min = 0; g.max = 1; g.gratis = 0; }
        else { g.max = Math.max(2, Math.min(g.opcoes.length || 2, g.max > 1 ? g.max : 3)); g.min = Math.min(g.min, g.max); }
        pintar(); return;
    }
    const b = e.target.closest('[data-mt-acao]'); if (!b) return;
    const acao = b.dataset.mtAcao, gi = gEl ? Number(gEl.dataset.gi) : -1, oEl = b.closest('[data-oi]'), oi = oEl ? Number(oEl.dataset.oi) : -1;
    if (acao === 'grupo') novoGrupo();
    else if (acao === 'tirar-grupo') grupos.splice(gi, 1);
    else if (acao === 'subir' && gi > 0) [grupos[gi - 1], grupos[gi]] = [grupos[gi], grupos[gi - 1]];
    else if (acao === 'descer' && gi < grupos.length - 1) [grupos[gi + 1], grupos[gi]] = [grupos[gi], grupos[gi + 1]];
    else if (acao === 'op' && g) { g.opcoes.push({ id: idDe('op', new Set(g.opcoes.map((o) => o.id))), nome: '', preco: 0, ativo: true }); pintar(); document.querySelector(`#montar-corpo [data-gi="${gi}"] li:last-child input`)?.focus(); return; }
    else if (acao === 'tirar-op' && g) g.opcoes.splice(oi, 1);
    else if (acao === 'ativo' && g && g.opcoes[oi]) g.opcoes[oi].ativo = g.opcoes[oi].ativo === false;
    pintar();
}

function aoDigitar(e) {
    const el = e.target, campo = el.dataset && el.dataset.campo; if (!campo) return;
    const gEl = el.closest('[data-gi]'); if (!gEl) return;
    const g = grupos[Number(gEl.dataset.gi)]; if (!g) return;
    const oEl = el.closest('[data-oi]'), o = oEl ? g.opcoes[Number(oEl.dataset.oi)] : null;
    if (campo === 'nome') g.nome = el.value;
    else if (campo === 'op-nome' && o) o.nome = el.value;
    else if (campo === 'op-preco' && o) { const n = lerNumero(el.value); o.preco = Number.isFinite(n) ? n : o.preco; el.classList.toggle('erro', !Number.isFinite(n)); }
    else if (['max', 'min', 'gratis'].includes(campo)) g[campo] = Math.max(0, Math.round(Number(el.value) || 0));
    resumo(); pintarPrevias();
}

function aoMudar(e) {
    const sel = e.target.closest('[data-mt-copiar]');
    if (sel && sel.value) {
        const p = produtosDaLoja().find((x) => x.id === sel.value), m = p && montarDoProduto(p);
        if (m) { grupos = JSON.parse(JSON.stringify(m.grupos)); pintar(); }
        return;
    }
    // ao sair de um campo de regra: corrige o que não faz sentido (mínimo maior que o máximo...)
    if (e.target.dataset && ['max', 'min', 'gratis'].includes(e.target.dataset.campo)) {
        const g = grupos[Number(e.target.closest('[data-gi]')?.dataset.gi)];
        if (g) { g.max = Math.max(1, Math.min(MAX_OPCOES, g.max)); g.min = Math.min(g.min, g.max); g.gratis = Math.min(g.gratis, g.max); pintar(); }
    }
}

export function iniciarMontarAdmin({ produtos }) {
    produtosDaLoja = produtos || produtosDaLoja;
    const box = $('montar-corpo'); if (!box || box.dataset.ligado) return;
    box.dataset.ligado = '1';
    box.addEventListener('click', aoClicar);
    box.addEventListener('input', aoDigitar);
    box.addEventListener('change', aoMudar);
    $('edit-unidade')?.addEventListener('change', pintar);
}

export function preencherMontar(p) {
    const m = p ? montarDoProduto({ ...p, unidade: 'un' }) : null;
    grupos = m ? JSON.parse(JSON.stringify(m.grupos)) : [];
    const det = $('prod-montar'); if (det) det.open = grupos.length > 0;
    pintar();
}

/** O que vai para o produto. Lança um erro com texto para o dono quando algo está pela metade. */
export function lerMontar() {
    if (porPeso() || !grupos.length) return null;
    for (const g of grupos) {
        if (!String(g.nome).trim()) throw new Error('Montar pedido: dê um nome a cada grupo (ex.: Complementos).');
        if (!g.opcoes.some((o) => String(o.nome).trim())) throw new Error(`Montar pedido: o grupo "${g.nome}" precisa de pelo menos uma opção.`);
        if (g.opcoes.some((o) => !Number.isFinite(Number(o.preco)))) throw new Error(`Montar pedido: confira os preços de "${g.nome}".`);
    }
    const limpos = grupos.map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => String(o.nome).trim()) }));
    const m = montarDoProduto({ unidade: 'un', montar: { grupos: limpos } });
    return m ? { grupos: m.grupos } : null;
}
