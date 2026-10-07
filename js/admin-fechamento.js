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
import { tcol, tdoc, chave, TENANT, ehLojaOriginal, fichaRef, pastaFotos, urlDaLoja } from './tenant.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';
import { nomeDaCategoria } from './admin-categorias.js';
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
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const ref = (dia) => tdoc('fechamentos', dia);

// ------------------------------------------------------------ dados
async function carregarDia(dia) {
    const minha = ++S.carga;
    S.carregando = true; document.getElementById('fc-lista')?.classList.add('fc-carregando');
    const d0 = semanaDe(dia)[0], d6 = semanaDe(dia)[6];
    try {
        const [snapDia, snapSemana, snapHist] = await Promise.all([
            getDoc(ref(dia)),
            getDocs(query(tcol('fechamentos'), where('dia', '>=', d0), where('dia', '<=', d6))),
            getDocs(query(tcol('fechamentos'), where('dia', '>=', addDias(dia, -56)), where('dia', '<', dia))),
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

const msgErroGravar = (e) => (e && e.code === 'permission-denied'
    ? 'Sem permissão para salvar. Publique as regras novas do Firestore (fechamentos).'
    : 'Não consegui salvar. Confira a internet.');

// O dia e o valor são capturados na hora do toque. Antes, a gravação atrasada
// (600 ms da anotação) lia S.dia/S.itens depois de a pessoa já ter trocado de
// dia, não achava nada e a última anotação se perdia.
function gravar(id, dia = S.dia, v = S.itens[id]) {
    const p = S.produtos.find((x) => x.id === id);
    if (!p || !v) return;
    S.estado = 'salvando'; pintarEstado();
    const temMarca = Object.values(S.itens).some((x) => x && x.tem != null);
    return setDoc(ref(dia), {
        dia, atualizadoEm: new Date().toISOString(),
        itens: { [id]: { tem: v.tem ?? null, obs: String(v.obs || '').slice(0, 80), nome: p.nome, cat: p.cat || 'outros' } },
    }, { merge: true }).then(() => {
        if (dia !== S.dia) return;                         // já estamos em outro dia: nada a pintar
        S.estado = 'salvo';
        if (temMarca) S.marcados.add(dia); else S.marcados.delete(dia);
        pintarEstado(); pintarSemana();
    }).catch((e) => { console.error(e); S.estado = 'erro'; pintarEstado(); showToast(msgErroGravar(e), true); });
}

const agendar = (id, ms = 0) => {
    clearTimeout(timers.get(id)?.t);
    const dia = S.dia, v = { ...S.itens[id] };
    if (!ms) { timers.delete(id); return gravar(id, dia, v); }
    timers.set(id, { dia, v, t: setTimeout(() => { timers.delete(id); gravar(id, dia, v); }, ms) });
};

// Antes de trocar de dia (ou sair da aba): grava já o que estava esperando.
const gravarPendentes = () => {
    for (const [id, pend] of timers) { clearTimeout(pend.t); gravar(id, pend.dia, pend.v); }
    timers.clear();
};

// ------------------------------------------------------------ ações
function marcar(id, valor) {                           // valor: true | false
    const atual = S.itens[id] || {};
    const novo = atual.tem === valor ? null : valor;     // tocar de novo desmarca
    // a anotação fica guardada mesmo trocando para "Não tem" (toque errado não apaga o que foi escrito)
    S.itens[id] = { ...atual, tem: novo, obs: atual.obs || '' };
    pintarLinha(id); pintarResumo(); pintarCeasa();
    agendar(id);
}

function anotar(id, texto) {
    const atual = S.itens[id] || {};
    S.itens[id] = { ...atual, tem: true, obs: texto.slice(0, 80) };
    pintarCeasa();
    agendar(id, 600);
}

async function restantesNaoTem() {
    if (S.estado === 'erro-leitura' || S.carregando) return;
    const faltam = S.produtos.filter((p) => !S.itens[p.id] || S.itens[p.id].tem == null);
    if (!faltam.length) return showToast('Todos os produtos já estão marcados.');
    if (!(await customConfirm('Marcar restantes', `Marcar ${faltam.length} produto(s) sem marcação como "Não tem"? Vale para a lista inteira, não só para a busca.`))) return;
    const dia = S.dia, mapa = {};
    faltam.forEach((p) => {
        S.itens[p.id] = { ...(S.itens[p.id] || {}), tem: false };
        mapa[p.id] = { tem: false, obs: String(S.itens[p.id].obs || ''), nome: p.nome, cat: p.cat || 'outros' };
    });
    // mostra na hora; a gravação segue por trás (sem internet a tela não ficava parada esperando)
    S.estado = 'salvando'; S.marcados.add(dia); render();
    setDoc(ref(dia), { dia, atualizadoEm: new Date().toISOString(), itens: mapa }, { merge: true })
        .then(() => { if (dia === S.dia) { S.estado = 'salvo'; pintarEstado(); } })
        .catch((e) => { console.error(e); if (dia === S.dia) { S.estado = 'erro'; pintarEstado(); } showToast(msgErroGravar(e), true); });
}

const textoLista = () => gerarListaCeasa({
    itens: S.itens, produtos: S.produtos, deDia: S.dia, incluirNaoMarcados: S.incluirNaoMarcados,
    paraDia: proximoDiaAberto(S.dia, S.diasAbertos),
});

async function copiar(aviso = 'Lista copiada!') {
    const { texto } = textoLista();
    try { await navigator.clipboard.writeText(texto); showToast(aviso); return true; }
    catch (e) {
        const ta = document.getElementById('fc-texto');
        let ok = false;
        if (ta) { ta.focus(); ta.select(); try { ok = document.execCommand('copy'); } catch (_) { ok = false; } }
        showToast(ok ? aviso : 'Não consegui copiar sozinho. Segure o dedo no texto da lista e escolha "Copiar".', !ok);
        return ok;
    }
}
async function compartilhar() {
    const { texto } = textoLista();
    if (navigator.share) {
        try { await navigator.share({ text: texto }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
    }
    // Sem o menu de compartilhar: abre o WhatsApp direto (o toque ainda vale aqui)
    const w = window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    if (!w) copiar('Lista copiada. Agora é só colar no WhatsApp.');
}

// ------------------------------------------------------------ tela
const rotuloEstado = () => ({ salvando: 'Salvando…', salvo: '✓ Salvo', erro: 'Não salvou', 'erro-leitura': 'Não consegui ler este dia' }[S.estado] || '');

function htmlLinha(p) {
    const v = S.itens[p.id] || {};
    const pad = padraoDoDiaDaSemana(S.historico, S.dia, p.id);
    const dow = diaDaSemana(S.dia), masc = dow === 0 || dow === 6;     // "os sábados", "as segundas"
    const dica = pad.n >= 2
        ? `<small class="fc-padrao">${masc ? 'Nos últimos' : 'Nas últimas'} ${pad.n} ${DIAS_LONGOS[dow].replace('-feira', '')}s: sobrou ${pad.sobrou}× · acabou ${pad.acabou}×</small>` : '';
    return `<div class="fc-item" data-id="${escapeHTML(p.id)}" data-estado="${v.tem === true ? 'sim' : v.tem === false ? 'nao' : ''}">
        <div class="fc-linha">
            <div class="fc-nome"><strong>${escapeHTML(p.nome)}</strong>${p.ativo === false ? '<span class="fc-esgotado">esgotado na loja</span>' : ''}${dica}</div>
            <div class="fc-botoes" role="group" aria-label="${escapeHTML(p.nome)}">
                <button type="button" class="fc-sim ${v.tem === true ? 'on' : ''}" data-fc="sim" aria-pressed="${v.tem === true}">Tem</button>
                <button type="button" class="fc-nao ${v.tem === false ? 'on' : ''}" data-fc="nao" aria-pressed="${v.tem === false}">Não tem</button>
            </div>
        </div>
        <input class="fc-obs" type="text" maxlength="80" value="${escapeHTML(v.obs || '')}" placeholder="Quanto sobrou? (opcional) ex.: meia caixa" enterkeyhint="done" aria-label="Quanto sobrou de ${escapeHTML(p.nome)}" ${v.tem === true ? '' : 'hidden'}>
    </div>`;
}

function htmlLista() {
    if (S.estado === 'erro-leitura') return `<div class="fc-erro"><p><i class="ic" data-i="alerta"></i> Não consegui abrir este dia.</p><small>Sem ler o que já foi salvo, marcar agora poderia apagar anotações. Confira a internet e tente de novo.</small><button type="button" data-fc="recarregar">Tentar de novo</button></div>`;
    const termo = norm(S.busca);
    let lista = ordenarProdutos(S.produtos).filter((p) => !termo || norm(p.nome).includes(termo) || norm(p.cat).includes(termo));
    if (S.soFaltam) lista = lista.filter((p) => !S.itens[p.id] || S.itens[p.id].tem == null);
    if (!lista.length) return `<p class="fc-vazio">${S.produtos.length ? 'Nenhum produto neste filtro.' : 'Nenhum produto cadastrado ainda.'}</p>`;
    let cat = null, out = '';
    for (const p of lista) {
        const c = p.cat || 'outros';
        if (norm(c) !== norm(cat)) { cat = c; out += `<h4 class="fc-cat">${escapeHTML(c)}</h4>`; }
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
        <h4><i class="ic" data-i="sacola"></i> Lista da Ceasa — ${escapeHTML(dataLonga(proximoDiaAberto(S.dia, S.diasAbertos)))}</h4>
        <small>Baseada no fechamento de ${escapeHTML(dataLonga(S.dia))}</small>
        ${bloco(`Comprar (${r.comprar.length})`, r.grupos, false) || '<p class="fc-vazio">Nada marcado como "Não tem" neste dia.</p>'}
        ${bloco(`Já tenho — conferir antes de comprar (${r.jaTenho.length})`, r.gruposJaTenho, true)}
        ${r.naoMarcados && !S.incluirNaoMarcados ? `<p class="fc-aviso"><i class="ic" data-i="alerta"></i> ${r.naoMarcados} produto(s) sem marcação ficaram de fora.</p>` : ''}
        <label class="fc-check"><input type="checkbox" id="fc-incluir" ${S.incluirNaoMarcados ? 'checked' : ''}> Incluir produtos sem marcação na lista</label>
        <textarea id="fc-texto" class="fc-texto" readonly rows="6" aria-label="Texto da lista">${escapeHTML(r.texto)}</textarea>
        <div class="fc-acoes"><button type="button" data-fc="copiar"><i class="ic" data-i="prancheta"></i> Copiar</button><button type="button" data-fc="compartilhar"><i class="ic" data-i="enviar"></i> Enviar / Compartilhar</button></div>
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

        <!-- A busca (grudada em cima) e o botão (grudado embaixo) só acompanham a CONFERÊNCIA.
             Fora desta caixa eles se soltam: antes ficavam por cima da lista da Ceasa ao rolar. -->
        <div class="fc-conferencia">
        <div class="fc-ctrl">
            <input id="fc-busca" type="search" placeholder="Buscar produto…" value="${escapeHTML(S.busca)}" aria-label="Buscar produto">
            <label class="fc-check"><input type="checkbox" id="fc-sofaltam" ${S.soFaltam ? 'checked' : ''}> Só os que faltam marcar</label>
            <button type="button" class="fc-lote" data-fc="restantes" ${S.estado === 'erro-leitura' ? 'disabled' : ''}>Marcar o resto como "Não tem"</button>
        </div>

        <div id="fc-lista" class="${S.carregando ? 'fc-carregando' : ''}">${htmlLista()}</div>

        <div class="fc-barra"><button type="button" class="btn-salvar-config" data-fc="gerar"><i class="ic" data-i="sacola"></i> ${S.listaAberta ? 'Atualizar' : 'Gerar'} lista da Ceasa</button></div>
        </div>
        ${S.listaAberta ? htmlListaCeasa() : ''}`;
}

function pintarEstado() { const e = document.getElementById('fc-estado'); if (e) e.textContent = rotuloEstado(); }
function pintarResumo() { const e = document.getElementById('fc-resumo'); if (e) e.innerHTML = htmlResumo(); }
function pintarCeasa() {                               // lista aberta acompanha cada toque (antes ficava velha até "Atualizar")
    const atual = document.getElementById('fc-ceasa'); if (!atual || !S.listaAberta) return;
    const y = document.getElementById('fc-texto')?.scrollTop || 0;
    atual.outerHTML = htmlListaCeasa();
    const ta = document.getElementById('fc-texto'); if (ta) ta.scrollTop = y;
}
function pintarSemana() { const e = document.getElementById('fc-dias'); if (e) e.innerHTML = htmlSemana(); }
function pintarLinha(id) {
    const linha = document.querySelector(`#fc-lista .fc-item[data-id="${CSS.escape(id)}"]`); if (!linha) return;
    const v = S.itens[id] || {};
    linha.dataset.estado = v.tem === true ? 'sim' : v.tem === false ? 'nao' : '';
    const sim = linha.querySelector('.fc-sim'), nao = linha.querySelector('.fc-nao'), obs = linha.querySelector('.fc-obs');
    sim.classList.toggle('on', v.tem === true); sim.setAttribute('aria-pressed', v.tem === true);
    nao.classList.toggle('on', v.tem === false); nao.setAttribute('aria-pressed', v.tem === false);
    // Sem foco automático: a conferência é toque-toque-toque; abrir o teclado a
    // cada "Tem" tapava a lista. A linha também fica na tela com o filtro
    // "só os que faltam" ligado, para dar tempo de anotar quanto sobrou.
    obs.hidden = v.tem !== true;
}

function trocarDia(dia) {
    gravarPendentes();
    S.dia = dia; S.listaAberta = false; S.itens = {}; S.estado = ''; S.carregando = true;
    render(); carregarDia(dia);
}

function ligar() {
    const raiz = el(); if (!raiz || raiz.dataset.ligado) return;
    raiz.dataset.ligado = '1';
    raiz.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-fc]'); if (!b) return;
        const acao = b.dataset.fc;
        const id = b.closest('.fc-item')?.dataset.id;
        if (acao === 'sim' || acao === 'nao') { if (S.estado !== 'erro-leitura' && !S.carregando) marcar(id, acao === 'sim'); }
        else if (acao === 'dia') { if (b.dataset.dia !== S.dia) trocarDia(b.dataset.dia); }
        else if (acao === 'semana-ant' || acao === 'semana-prox') trocarDia(addDias(S.dia, acao === 'semana-ant' ? -7 : 7));
        else if (acao === 'recarregar') trocarDia(S.dia);
        else if (acao === 'gerar') { S.listaAberta = true; render(); document.getElementById('fc-ceasa')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else if (acao === 'copiar') copiar();
        else if (acao === 'compartilhar') compartilhar();
        else if (acao === 'restantes') restantesNaoTem();
    });
    raiz.addEventListener('input', (e) => {
        if (e.target.classList.contains('fc-obs')) { if (S.estado !== 'erro-leitura') anotar(e.target.closest('.fc-item').dataset.id, e.target.value); }
        else if (e.target.id === 'fc-busca') { S.busca = e.target.value; document.getElementById('fc-lista').innerHTML = htmlLista(); }
    });
    raiz.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('fc-obs')) e.target.blur(); });
    // sair do campo, da aba ou do app: não deixa anotação esperando
    raiz.addEventListener('focusout', (e) => { if (e.target.classList.contains('fc-obs')) gravarPendentes(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) gravarPendentes(); });
    raiz.addEventListener('change', (e) => {
        if (e.target.id === 'fc-sofaltam') { S.soFaltam = e.target.checked; document.getElementById('fc-lista').innerHTML = htmlLista(); }
        else if (e.target.id === 'fc-incluir') { S.incluirNaoMarcados = e.target.checked; render(); document.getElementById('fc-ceasa')?.scrollIntoView({ block: 'start' }); }
    });
}

/** Ao abrir a aba. `produtos` = lista atual de produtos do painel. */
export const abrirFechamento = async (produtos) => {
    gravarPendentes();
    // categoria pelo NOME que aparece na loja (e uma só por categoria, mesmo com maiúsculas diferentes nos produtos)
    S.produtos = (produtos || []).map((p) => ({ id: p.id, nome: p.nome || p.id, cat: nomeDaCategoria(p.cat) || 'outros', ativo: p.ativo }));
    ligar();
    if (S.diasAbertos === null) {
        try { const c = await getDoc(tdoc('loja', 'config')); S.diasAbertos = c.exists() ? (c.data().diasAbertos || []) : []; }
        catch (e) { S.diasAbertos = []; }
    }
    render();
    carregarDia(S.dia);
};
