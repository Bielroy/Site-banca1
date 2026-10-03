// =====================================================================
//  js/admin-fechamento.js — aba "🧾 Fechamento" do painel admin.
//
//  Fim de feira, em 1 minuto no celular:
//    1) escolhe o dia da semana;
//    2) marca cada produto: "Tem" (sobrou) ou "Não tem" (acabou), e, se quiser,
//       escreve quanto sobrou ("meia caixa", "2 pacotes");
//    3) toca em "Gerar lista da Ceasa": sai o que comprar no dia seguinte.
//
//  Grava em `fechamentos/AAAA-MM-DD` (só admin). Salva sozinho a cada toque.
//  As regras de cálculo ficam em ./fechamento-lib.js (testadas).
// =====================================================================
import { db, collection, doc, getDoc, getDocs, setDoc, query, where } from './firebase.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';
import {
    DIAS_CURTOS, hojeBR, addDias, semanaDe, dataCurta, dataLonga, diaDaSemana, DIAS_LONGOS,
    proximoDiaAberto, ordenarProdutos, resumoDia, gerarListaCeasa, padraoDoDiaDaSemana
} from './fechamento-lib.js';

const S = {
    dia: hojeBR(), produtos: [], itens: {}, marcados: new Set(),         // marcados = dias da semana com registro
    historico: [], diasAbertos: null, busca: '', soFaltam: false, incluirNaoMarcados: false,
    listaAberta: false, estado: '', ligado: false, carga: 0, carregando: false,
};
const timers = new Map();
const el = () => document.getElementById('fechamento-conteudo');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ref = (dia) => doc(db, 'fechamentos', dia);

// ------------------------------------------------------------ dados
async function carregarDia(dia) {
    const minha = ++S.carga;
    S.carregando = true; document.getElementById('fc-lista')?.classList.add('fc-carregando');
    const d0 = semanaDe(dia)[0], d6 = semanaDe(dia)[6];
    try {
        const [snapDia, snapSemana, snapHist] = await Promise.all([
            getDoc(ref(dia)),
            getDocs(query(collection(db, 'fechamentos'), where('dia', '>=', d0), where('dia', '<=', d6))),
            getDocs(query(collection(db, 'fechamentos'), where('dia', '>=', addDias(dia, -56)), where('dia', '<', dia))),
        ]);
        if (minha !== S.carga) return;                       // a pessoa já trocou de dia
        S.itens = snapDia.exists() ? (snapDia.data().itens || {}) : {};
        S.marcados = new Set(snapSemana.docs.filter((d) => Object.values(d.data().itens || {}).some((v) => v && v.tem != null)).map((d) => d.id));
        S.historico = snapHist.docs.map((d) => ({ dia: d.id, itens: d.data().itens || {} }));
        S.estado = '';
    } catch (e) {
        console.error(e);
        if (minha !== S.carga) return;
        S.itens = {}; S.marcados = new Set(); S.historico = [];
        S.estado = 'erro-leitura';
    }
    S.carregando = false;
    render();
}

function gravar(id) {
    const p = S.produtos.find((x) => x.id === id);
    const v = S.itens[id];
    if (!p || !v) return;
    S.estado = 'salvando'; pintarEstado();
    return setDoc(ref(S.dia), {
        dia: S.dia, atualizadoEm: new Date().toISOString(),
        itens: { [id]: { tem: v.tem ?? null, obs: String(v.obs || '').slice(0, 80), nome: p.nome, cat: p.cat || 'outros' } },
    }, { merge: true }).then(() => {
        S.estado = 'salvo';
        if (Object.values(S.itens).some((x) => x && x.tem != null)) S.marcados.add(S.dia); else S.marcados.delete(S.dia);
        pintarEstado(); pintarSemana();
    }).catch((e) => { console.error(e); S.estado = 'erro'; pintarEstado(); showToast('Não consegui salvar. Confira a internet.', true); });
}

const agendar = (id, ms = 0) => {
    clearTimeout(timers.get(id));
    if (!ms) return gravar(id);
    timers.set(id, setTimeout(() => gravar(id), ms));
};

// ------------------------------------------------------------ ações
function marcar(id, valor) {                           // valor: true | false
    const atual = S.itens[id] || {};
    const novo = atual.tem === valor ? null : valor;     // tocar de novo desmarca
    S.itens[id] = { ...atual, tem: novo, obs: novo === true ? (atual.obs || '') : '' };
    pintarLinha(id); pintarResumo();
    agendar(id);
}

function anotar(id, texto) {
    const atual = S.itens[id] || {};
    S.itens[id] = { ...atual, tem: true, obs: texto.slice(0, 80) };
    agendar(id, 600);
}

async function restantesNaoTem() {
    const faltam = S.produtos.filter((p) => !S.itens[p.id] || S.itens[p.id].tem == null);
    if (!faltam.length) return showToast('Todos os produtos já estão marcados.');
    if (!(await customConfirm('Marcar restantes', `Marcar ${faltam.length} produto(s) sem marcação como "Não tem"?`))) return;
    faltam.forEach((p) => { S.itens[p.id] = { ...(S.itens[p.id] || {}), tem: false, obs: '' }; });
    S.estado = 'salvando';
    try {
        const mapa = {};
        faltam.forEach((p) => { mapa[p.id] = { tem: false, obs: '', nome: p.nome, cat: p.cat || 'outros' }; });
        await setDoc(ref(S.dia), { dia: S.dia, atualizadoEm: new Date().toISOString(), itens: mapa }, { merge: true });
        S.estado = 'salvo'; S.marcados.add(S.dia);
    } catch (e) { console.error(e); S.estado = 'erro'; showToast('Não consegui salvar.', true); }
    render();
}

const textoLista = () => gerarListaCeasa({
    itens: S.itens, produtos: S.produtos, deDia: S.dia, incluirNaoMarcados: S.incluirNaoMarcados,
    paraDia: proximoDiaAberto(S.dia, S.diasAbertos),
});

async function copiar() {
    const { texto } = textoLista();
    try { await navigator.clipboard.writeText(texto); showToast('📋 Lista copiada!'); }
    catch (e) {
        const ta = document.getElementById('fc-texto'); if (ta) { ta.select(); document.execCommand?.('copy'); showToast('📋 Lista copiada!'); }
    }
}
async function compartilhar() {
    const { texto } = textoLista();
    if (navigator.share) { try { await navigator.share({ text: texto }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
}

// ------------------------------------------------------------ tela
const rotuloEstado = () => ({ salvando: 'Salvando…', salvo: '✓ Salvo', erro: '⚠️ Não salvou', 'erro-leitura': '⚠️ Não consegui ler este dia' }[S.estado] || '');

function htmlLinha(p) {
    const v = S.itens[p.id] || {};
    const pad = padraoDoDiaDaSemana(S.historico, S.dia, p.id);
    const dica = pad.n >= 2
        ? `<small class="fc-padrao">Nas últimas ${pad.n} ${DIAS_LONGOS[diaDaSemana(S.dia)].replace('-feira', '')}s: sobrou ${pad.sobrou}× · acabou ${pad.acabou}×</small>` : '';
    return `<div class="fc-item" data-id="${escapeHTML(p.id)}" data-estado="${v.tem === true ? 'sim' : v.tem === false ? 'nao' : ''}">
        <div class="fc-linha">
            <div class="fc-nome"><strong>${escapeHTML(p.nome)}</strong>${p.ativo === false ? '<span class="fc-esgotado">esgotado na loja</span>' : ''}${dica}</div>
            <div class="fc-botoes" role="group" aria-label="${escapeHTML(p.nome)}">
                <button type="button" class="fc-sim ${v.tem === true ? 'on' : ''}" data-fc="sim" aria-pressed="${v.tem === true}">Tem</button>
                <button type="button" class="fc-nao ${v.tem === false ? 'on' : ''}" data-fc="nao" aria-pressed="${v.tem === false}">Não tem</button>
            </div>
        </div>
        <input class="fc-obs" type="text" maxlength="80" value="${escapeHTML(v.obs || '')}" placeholder="Quanto sobrou? (opcional) ex.: meia caixa" aria-label="Quanto sobrou de ${escapeHTML(p.nome)}" ${v.tem === true ? '' : 'hidden'}>
    </div>`;
}

function htmlLista() {
    const termo = norm(S.busca);
    let lista = ordenarProdutos(S.produtos).filter((p) => !termo || norm(p.nome).includes(termo) || norm(p.cat).includes(termo));
    if (S.soFaltam) lista = lista.filter((p) => !S.itens[p.id] || S.itens[p.id].tem == null);
    if (!lista.length) return `<p class="fc-vazio">${S.produtos.length ? 'Nenhum produto neste filtro.' : 'Nenhum produto cadastrado ainda.'}</p>`;
    let cat = null, out = '';
    for (const p of lista) {
        const c = p.cat || 'outros';
        if (c !== cat) { cat = c; out += `<h4 class="fc-cat">${escapeHTML(c)}</h4>`; }
        out += htmlLinha(p);
    }
    return out;
}

function htmlSemana() {
    const hoje = hojeBR();
    return semanaDe(S.dia).map((d) => `<button type="button" class="fc-dia ${d === S.dia ? 'on' : ''} ${d === hoje ? 'hoje' : ''}" data-fc="dia" data-dia="${d}" aria-label="${escapeHTML(dataLonga(d))}" aria-pressed="${d === S.dia}">
        <span>${DIAS_CURTOS[diaDaSemana(d)]}</span><b>${d.slice(8, 10)}</b><i class="${S.marcados.has(d) ? 'reg' : ''}" aria-hidden="true"></i></button>`).join('');
}

function htmlResumo() {
    const r = resumoDia(S.itens, S.produtos);
    return `<b>${r.marcados}</b> de ${r.total} marcados · <span class="fc-r-sim">${r.sobrou} sobraram</span> · <span class="fc-r-nao">${r.acabou} acabaram</span>`;
}

function htmlListaCeasa() {
    const r = textoLista();
    const bloco = (titulo, grupos, comObs) => grupos.length ? `<h5>${titulo}</h5>` + grupos.map((g) => `<p class="fc-l-cat">${escapeHTML(g.cat)}</p><ul>${g.itens.map((i) => `<li>${escapeHTML(i.nome)}${comObs ? ` <em>— ${escapeHTML(i.obs)}</em>` : ''}${i.naoMarcado ? ' <em>(não conferido)</em>' : ''}</li>`).join('')}</ul>`).join('') : '';
    return `<section class="fc-ceasa" id="fc-ceasa">
        <h4>🛒 Lista da Ceasa — ${escapeHTML(dataLonga(proximoDiaAberto(S.dia, S.diasAbertos)))}</h4>
        <small>Baseada no fechamento de ${escapeHTML(dataLonga(S.dia))}</small>
        ${bloco(`Comprar (${r.comprar.length})`, r.grupos, false) || '<p class="fc-vazio">Nada marcado como "Não tem" neste dia.</p>'}
        ${bloco(`Já tenho — conferir antes de comprar (${r.jaTenho.length})`, r.gruposJaTenho, true)}
        ${r.naoMarcados && !S.incluirNaoMarcados ? `<p class="fc-aviso">⚠️ ${r.naoMarcados} produto(s) sem marcação ficaram de fora.</p>` : ''}
        <label class="fc-check"><input type="checkbox" id="fc-incluir" ${S.incluirNaoMarcados ? 'checked' : ''}> Incluir produtos sem marcação na lista</label>
        <textarea id="fc-texto" class="fc-texto" readonly rows="6" aria-label="Texto da lista">${escapeHTML(r.texto)}</textarea>
        <div class="fc-acoes"><button type="button" data-fc="copiar">📋 Copiar</button><button type="button" data-fc="compartilhar">📤 Enviar / Compartilhar</button></div>
    </section>`;
}

function render() {
    const raiz = el(); if (!raiz) return;
    raiz.innerHTML = `
        <div class="fc-topo"><div><h3>Fechamento da Feira</h3>
            <p class="config-sub">Marque o que <b>tem</b> e o que <b>não tem</b>. Dali sai a lista de compras da Ceasa.</p></div>
            <span id="fc-estado" class="fc-estado">${rotuloEstado()}</span></div>

        <div class="fc-semana">
            <button type="button" class="fc-nav" data-fc="semana-ant" aria-label="Semana anterior">‹</button>
            <div class="fc-dias" id="fc-dias">${htmlSemana()}</div>
            <button type="button" class="fc-nav" data-fc="semana-prox" aria-label="Próxima semana">›</button>
        </div>
        <p class="fc-diatitulo">${escapeHTML(dataLonga(S.dia))}${S.dia === hojeBR() ? ' · <b>hoje</b>' : ''}</p>
        <p class="fc-resumo" id="fc-resumo">${htmlResumo()}</p>

        <div class="fc-ctrl">
            <input id="fc-busca" type="search" placeholder="Buscar produto…" value="${escapeHTML(S.busca)}" aria-label="Buscar produto">
            <label class="fc-check"><input type="checkbox" id="fc-sofaltam" ${S.soFaltam ? 'checked' : ''}> Só os que faltam marcar</label>
            <button type="button" class="fc-lote" data-fc="restantes">Marcar o resto como "Não tem"</button>
        </div>

        <div id="fc-lista" class="${S.carregando ? 'fc-carregando' : ''}">${htmlLista()}</div>

        <div class="fc-barra"><button type="button" class="btn-salvar-config" data-fc="gerar">🛒 ${S.listaAberta ? 'Atualizar' : 'Gerar'} lista da Ceasa</button></div>
        ${S.listaAberta ? htmlListaCeasa() : ''}`;
}

function pintarEstado() { const e = document.getElementById('fc-estado'); if (e) e.textContent = rotuloEstado(); }
function pintarResumo() { const e = document.getElementById('fc-resumo'); if (e) e.innerHTML = htmlResumo(); }
function pintarSemana() { const e = document.getElementById('fc-dias'); if (e) e.innerHTML = htmlSemana(); }
function pintarLinha(id) {
    const linha = document.querySelector(`#fc-lista .fc-item[data-id="${CSS.escape(id)}"]`); if (!linha) return;
    const v = S.itens[id] || {};
    linha.dataset.estado = v.tem === true ? 'sim' : v.tem === false ? 'nao' : '';
    const sim = linha.querySelector('.fc-sim'), nao = linha.querySelector('.fc-nao'), obs = linha.querySelector('.fc-obs');
    sim.classList.toggle('on', v.tem === true); sim.setAttribute('aria-pressed', v.tem === true);
    nao.classList.toggle('on', v.tem === false); nao.setAttribute('aria-pressed', v.tem === false);
    obs.hidden = v.tem !== true; if (v.tem !== true) obs.value = '';
    else if (document.activeElement !== obs) setTimeout(() => obs.focus({ preventScroll: true }), 0);
    if (S.soFaltam && v.tem != null) linha.hidden = true;
}

function ligar() {
    const raiz = el(); if (!raiz || raiz.dataset.ligado) return;
    raiz.dataset.ligado = '1';
    raiz.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-fc]'); if (!b) return;
        const acao = b.dataset.fc;
        const id = b.closest('.fc-item')?.dataset.id;
        if (acao === 'sim') marcar(id, true);
        else if (acao === 'nao') marcar(id, false);
        else if (acao === 'dia') { S.dia = b.dataset.dia; S.listaAberta = false; S.itens = {}; render(); carregarDia(S.dia); }
        else if (acao === 'semana-ant' || acao === 'semana-prox') {
            S.dia = addDias(S.dia, acao === 'semana-ant' ? -7 : 7); S.listaAberta = false; S.itens = {}; render(); carregarDia(S.dia);
        }
        else if (acao === 'gerar') { S.listaAberta = true; render(); document.getElementById('fc-ceasa')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else if (acao === 'copiar') copiar();
        else if (acao === 'compartilhar') compartilhar();
        else if (acao === 'restantes') restantesNaoTem();
    });
    raiz.addEventListener('input', (e) => {
        if (e.target.classList.contains('fc-obs')) anotar(e.target.closest('.fc-item').dataset.id, e.target.value);
        else if (e.target.id === 'fc-busca') { S.busca = e.target.value; document.getElementById('fc-lista').innerHTML = htmlLista(); }
    });
    raiz.addEventListener('change', (e) => {
        if (e.target.id === 'fc-sofaltam') { S.soFaltam = e.target.checked; document.getElementById('fc-lista').innerHTML = htmlLista(); }
        else if (e.target.id === 'fc-incluir') { S.incluirNaoMarcados = e.target.checked; render(); document.getElementById('fc-ceasa')?.scrollIntoView({ block: 'start' }); }
    });
}

/** Ao abrir a aba. `produtos` = lista atual de produtos do painel. */
export const abrirFechamento = async (produtos) => {
    S.produtos = (produtos || []).map((p) => ({ id: p.id, nome: p.nome || p.id, cat: p.cat || 'outros', ativo: p.ativo }));
    ligar();
    if (S.diasAbertos === null) {
        try { const c = await getDoc(doc(db, 'loja', 'config')); S.diasAbertos = c.exists() ? (c.data().diasAbertos || []) : []; }
        catch (e) { S.diasAbertos = []; }
    }
    render();
    carregarDia(S.dia);
};

