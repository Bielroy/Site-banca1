// =====================================================================
//  js/admin-comandos.js — PALETA DE COMANDOS do painel (Ctrl+K, ⌘K ou "/").
//
//  Uma caixa só para achar qualquer coisa sem andar pelas abas: uma tela ("Estoque"), um produto
//  ("tomate" → abre Produtos já filtrado), um pedido pelo nome do cliente ou pelo condomínio, ou uma ação
//  ("Novo produto", "Tema escuro"). A busca é a mesma da loja (js/busca-lib.js): perdoa acento, plural e letra trocada.
//
//  Mecânica estudada no cmdk (MIT) e no Power K do Plane: setas ↑ ↓ escolhem, Enter abre, Esc fecha;
//  papéis combobox/listbox/option com aria-activedescendant (o leitor de tela anuncia o escolhido);
//  tecla apertada enquanto o teclado compõe um acento é ignorada.
//
//  ATALHOS DE UMA TECLA (só fora de campo de texto, sem Ctrl/Alt): "/" abre a paleta, "p" vai para Pedidos,
//  "n" abre Novo produto. Respeitam o papel da pessoa: aba escondida para ela não aparece nem abre.
// =====================================================================
import { textoDeBusca, combinaBusca, norm } from './busca-lib.js';
import { escapeHTML } from './utils.js';

const MAX_POR_GRUPO = 6;
let fontes = { produtos: () => [], pedidos: () => [] };
let dlg = null, itens = [], ativo = 0;

const editavel = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const abaVisivel = (b) => b && !b.hidden && !b.closest('[hidden]') && getComputedStyle(b).display !== 'none';
const abas = () => [...document.querySelectorAll('#tabs-lista .tab[data-aba]')].filter(abaVisivel);
const irPara = (aba) => { const b = abas().find((x) => x.dataset.aba === aba); if (b) { b.click(); return true; } return false; };
const preencherBusca = (id, termo) => { const c = document.getElementById(id); if (!c) return; c.value = termo; c.dispatchEvent(new Event('input', { bubbles: true })); };

function acoes() {
    const lista = [];
    if (abas().some((b) => b.dataset.aba === 'produtos')) lista.push({ grupo: 'Ações', rotulo: 'Novo produto', dica: 'n', fazer: novoProduto });
    const tema = document.getElementById('btn-tema');
    if (tema) lista.push({ grupo: 'Ações', rotulo: document.getElementById('btn-tema-texto')?.textContent || 'Tema escuro', fazer: () => tema.click() });
    const imp = document.getElementById('btn-impressora');
    if (imp) lista.push({ grupo: 'Ações', rotulo: 'Impressora', fazer: () => imp.click() });
    return lista;
}
function novoProduto() { if (irPara('produtos')) setTimeout(() => document.querySelector('[data-action="novo-produto"]')?.click(), 60); }

/** Tudo o que combina com o que foi digitado, em grupos (telas, ações, produtos, pedidos). */
export function resultados(termo, { produtos = [], pedidos = [], telas = [], extras = [] } = {}) {
    const t = String(termo || '').trim(), casa = (txt) => !t || combinaBusca(norm(txt), t);
    const telasOk = telas.filter((x) => casa(`${x.rotulo} tela aba`)).map((x) => ({ grupo: 'Telas', ...x }));
    const acoesOk = extras.filter((x) => casa(x.rotulo));
    if (!t) return [...telasOk, ...acoesOk].slice(0, 14);
    const prods = produtos.filter((p) => p && p.nome && combinaBusca(textoDeBusca(p), t)).slice(0, MAX_POR_GRUPO)
        .map((p) => ({ grupo: 'Produtos', rotulo: p.nome, dica: p.ativo === false ? 'fora da loja' : '', produto: p }));
    const vistos = new Set();
    const peds = pedidos.filter((p) => p && casa([p.nome, p.condominio, p.quadra && `quadra ${p.quadra}`, p.lote && `lote ${p.lote}`].filter(Boolean).join(' ')))
        .filter((p) => { const k = norm(p.nome); if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, MAX_POR_GRUPO)
        .map((p) => ({ grupo: 'Pedidos', rotulo: p.nome || 'Cliente', dica: [p.condominio, p.quadra && `Q ${p.quadra}`, p.lote && `L ${p.lote}`].filter(Boolean).join(' · '), pedido: p }));
    return [...telasOk.slice(0, 4), ...acoesOk, ...prods, ...peds];
}

function montar() {
    if (dlg) return dlg;
    document.body.insertAdjacentHTML('beforeend', `
    <dialog class="cmd" id="cmd-paleta" aria-label="Buscar no painel">
      <div class="cmd-campo"><i class="ic" data-i="busca" aria-hidden="true"></i>
        <input id="cmd-texto" type="text" role="combobox" aria-expanded="true" aria-controls="cmd-lista" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Buscar tela, produto, cliente ou ação"></div>
      <ul class="cmd-lista" id="cmd-lista" role="listbox" aria-label="Resultados"></ul>
      <p class="cmd-rodape"><kbd>↑</kbd><kbd>↓</kbd> escolher · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar · fora da busca: <kbd>/</kbd> busca, <kbd>p</kbd> pedidos, <kbd>n</kbd> novo produto</p>
    </dialog>`);
    dlg = document.getElementById('cmd-paleta');
    const campo = document.getElementById('cmd-texto'), lista = document.getElementById('cmd-lista');
    campo.addEventListener('input', () => { ativo = 0; pintar(); });
    campo.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (itens.length) { ativo = (ativo + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length; marcar(); } }
        else if (e.key === 'Enter') { e.preventDefault(); escolher(ativo); }
    });
    lista.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) escolher(Number(li.dataset.i)); });
    lista.addEventListener('pointermove', (e) => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== ativo) { ativo = Number(li.dataset.i); marcar(); } });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) fechar(); });          // toque fora da caixa fecha
    return dlg;
}
function pintar() {
    const termo = document.getElementById('cmd-texto').value;
    const telas = abas().map((b) => ({ rotulo: b.querySelector('.tab-txt')?.textContent.trim() || b.dataset.aba, aba: b.dataset.aba }));
    itens = resultados(termo, { produtos: fontes.produtos() || [], pedidos: fontes.pedidos() || [], telas, extras: acoes() });
    let grupo = '';
    document.getElementById('cmd-lista').innerHTML = itens.map((x, i) => {
        const cab = x.grupo !== grupo ? `<li class="cmd-grupo" role="presentation">${escapeHTML((grupo = x.grupo))}</li>` : '';
        return `${cab}<li class="cmd-item" role="option" id="cmd-op-${i}" data-i="${i}" aria-selected="false"><span>${escapeHTML(x.rotulo)}</span>${x.dica ? `<small>${escapeHTML(x.dica)}</small>` : ''}</li>`;
    }).join('') || `<li class="cmd-nada" role="presentation">Nada com "${escapeHTML(termo)}". Tente o nome do cliente, do produto ou da tela.</li>`;
    marcar();
}
function marcar() {
    const campo = document.getElementById('cmd-texto');
    document.querySelectorAll('#cmd-lista .cmd-item').forEach((li) => li.setAttribute('aria-selected', String(Number(li.dataset.i) === ativo)));
    const el = document.getElementById(`cmd-op-${ativo}`);
    if (el) { campo.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); } else campo.removeAttribute('aria-activedescendant');
}
function escolher(i) {
    const x = itens[i]; if (!x) return;
    fechar();
    if (x.aba) irPara(x.aba);
    else if (x.produto) { if (irPara('produtos')) setTimeout(() => preencherBusca('admin-busca-input', x.produto.nome), 30); }
    else if (x.pedido) { if (irPara('relatorios')) setTimeout(() => preencherBusca('pedido-busca-input', x.pedido.nome || ''), 30); }
    else if (x.fazer) x.fazer();
}
export function abrirPaleta() {
    montar();
    if (dlg.open) return;
    document.getElementById('cmd-texto').value = ''; ativo = 0; pintar();
    dlg.showModal();
    document.getElementById('cmd-texto').focus();
}
function fechar() { if (dlg && dlg.open) dlg.close(); }

/** Liga a paleta e os atalhos. fontes: { produtos: () => [...], pedidos: () => [...] } (listas que o painel já tem). */
export function iniciarComandos(f = {}) {
    fontes = { ...fontes, ...f };
    document.getElementById('btn-comandos')?.addEventListener('click', abrirPaleta);
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dlg && dlg.open) fechar(); else abrirPaleta(); return; }
        if (e.ctrlKey || e.metaKey || e.altKey || editavel(e.target) || document.querySelector('dialog[open], .modal-overlay.aberto')) return;
        if (document.getElementById('dashboard')?.style.display === 'none') return;     // ainda na tela de login
        if (e.key === '/') { e.preventDefault(); abrirPaleta(); }
        else if (e.key === 'p' || e.key === 'P') { if (irPara('relatorios')) e.preventDefault(); }
        else if (e.key === 'n' || e.key === 'N') { if (abas().some((b) => b.dataset.aba === 'produtos')) { e.preventDefault(); novoProduto(); } }
    });
}
