// =====================================================================
//  js/admin-calendario.js — aba "Calendário" do painel.
//
//  Onde o negócio anota a rotina e as datas que importam: dias de compra,
//  de produção e de feira, promoções, eventos, feriados locais e datas
//  especiais. Feriados nacionais já vêm marcados.
//
//  Ligações com o resto do sistema:
//   • Promoções, eventos e datas com nome vão para o motor de previsão
//     (ele passa a ajustar a previsão depois de ver o mesmo nome 2 vezes).
//   • A aba Compras mostra o próximo dia de compra.
//   • O Copiloto recebe a agenda dos próximos 14 dias.
// =====================================================================
import { getDocs, setDoc, deleteDoc, query, limit } from './firebase.js';
import { tcol, tdoc } from './tenant.js';
import { escapeHTML, showToast, openModal, closeModal, customConfirm } from './utils.js';
import { hojeBR, dataLonga, DIAS_CURTOS } from './fechamento-lib.js';
import { TIPOS, TIPOS_DE_DEMANDA, ocorrencias, gradeDoMes, somarDias, validarEntrada } from './calendario-lib.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const S = { podeEditar: true, entradas: null, em: 0, mes: hojeBR().slice(0, 7), dia: hojeBR(), ligado: false, estado: 'carregando' };
const el = () => document.getElementById('calendario-conteudo');
const $ = (id) => document.getElementById(id);

/** Entradas do calendário desta loja (uma leitura, guardada por 10 min). Usada também pela aba Compras. */
export async function lerCalendario({ forcar = false } = {}) {
    if (!forcar && S.entradas && Date.now() - S.em < 600000) return S.entradas;
    const snap = await getDocs(query(tcol('calendario'), limit(500)));
    S.entradas = snap.docs.map((d) => ({ ...d.data(), id: d.id })); S.em = Date.now();
    return S.entradas;
}

const REPETE = { '': '', semanal: 'toda semana', anual: 'todo ano' };
const itemHtml = (o, comData) => `
    <li class="cal-item">
        <i style="background:${TIPOS[o.tipo][1]}" aria-hidden="true"></i>
        <span><b>${escapeHTML(o.titulo)}</b><small>${comData ? `${escapeHTML(dataLonga(o.data))} · ` : ''}${TIPOS[o.tipo][0]}${o.nacional ? ' nacional' : ''}${o.repete ? ` · ${REPETE[o.repete]}` : ''}${o.obs ? ` · ${escapeHTML(o.obs)}` : ''}</small></span>
        ${o.nacional || !S.podeEditar ? '' : `<button type="button" class="cal-apagar" data-cal-apagar="${escapeHTML(o.id)}" aria-label="Apagar ${escapeHTML(o.titulo)}">&times;</button>`}
    </li>`;

function render() {
    if (!el()) return;
    if (S.estado !== 'ok') {
        el().innerHTML = `<div class="es-topo"><div><h3>Calendário</h3></div></div><div class="cp-vazio"><b>${S.estado === 'carregando' ? 'Carregando o calendário...' : 'Não consegui carregar o calendário.'}</b><span>${S.estado === 'erro' ? 'Confira a internet e abra a aba de novo. Se o painel acabou de ser atualizado, publique as regras novas do Firestore.' : ''}</span></div>`;
        return;
    }
    const [ano, mes] = S.mes.split('-').map(Number), hoje = hojeBR(), grade = gradeDoMes(ano, mes);
    const doMes = ocorrencias(S.entradas, grade[0].data, grade[grade.length - 1].data), porDia = new Map();
    doMes.forEach((o) => { if (!porDia.has(o.data)) porDia.set(o.data, []); porDia.get(o.data).push(o); });
    const doDia = porDia.get(S.dia) || [], proximos = ocorrencias(S.entradas, hoje, somarDias(hoje, 14));
    el().innerHTML = `
    <div class="es-topo"><div><h3>Calendário</h3><p class="config-sub">Rotina, promoções e datas que mexem com as vendas.</p></div>
        ${S.podeEditar ? '<button class="btn-outline es-hist-geral" data-cal="novo">+ Adicionar</button>' : ''}</div>
    <div class="cal-nav">
        <button type="button" data-cal="antes" aria-label="Mês anterior">‹</button>
        <strong>${MESES[mes - 1]} de ${ano}</strong>
        <button type="button" data-cal="depois" aria-label="Próximo mês">›</button>
        <button type="button" class="cal-hoje" data-cal="hoje">Hoje</button>
    </div>
    <div class="cal-grade" role="grid" aria-label="${MESES[mes - 1]} de ${ano}">
        ${DIAS_CURTOS.map((d) => `<span class="cal-dow" role="columnheader">${d}</span>`).join('')}
        ${grade.map((g) => { const os = porDia.get(g.data) || []; return `<button type="button" role="gridcell" class="cal-dia${g.foraDoMes ? ' fora' : ''}${g.data === hoje ? ' hoje' : ''}${g.data === S.dia ? ' sel' : ''}" data-cal-dia="${g.data}" aria-label="${dataLonga(g.data)}${os.length ? `, ${os.length} marcação(ões)` : ''}"${g.data === S.dia ? ' aria-selected="true"' : ''}>
            <b>${g.dia}</b><span class="cal-pontos">${os.slice(0, 4).map((o) => `<i style="background:${TIPOS[o.tipo][1]}"></i>`).join('')}</span></button>`; }).join('')}
    </div>
    <div class="cal-legenda">${Object.entries(TIPOS).map(([, [rot, corT]]) => `<span><i style="background:${corT}"></i>${rot}</span>`).join('')}</div>
    <h4 class="cp-sub cal-titulo-dia">${dataLonga(S.dia)}</h4>
    ${doDia.length ? `<ul class="cal-lista">${doDia.map((o) => itemHtml(o, false)).join('')}</ul>` : '<p class="config-sub">Nada marcado neste dia.</p>'}
    <h4 class="cp-sub">Próximos 14 dias</h4>
    ${proximos.length ? `<ul class="cal-lista">${proximos.map((o) => itemHtml(o, true)).join('')}</ul>` : '<p class="config-sub">Nada marcado. Comece pelos dias de compra e de produção, com repetição "toda semana".</p>'}
    <p class="config-sub cal-nota">Promoções, eventos e datas especiais com nome entram na previsão de vendas. O ajuste só aparece depois que o mesmo nome acontece duas vezes, para não tirar conclusão de um caso só.</p>`;
}

function garantirModal() {
    if ($('modal-calendario')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-calendario" role="dialog" aria-modal="true" aria-labelledby="cal-m-titulo">
        <div class="modal"><header class="modal-head"><h2 id="cal-m-titulo">Adicionar ao calendário</h2><button class="btn-fechar" data-fechar="modal-calendario" aria-label="Fechar">&times;</button></header>
        <div class="modal-body">
            <div class="form-group"><label for="cal-tipo">O que é</label><select id="cal-tipo">${Object.entries(TIPOS).map(([k, [rot]]) => `<option value="${k}">${rot}</option>`).join('')}</select></div>
            <div class="form-group"><label for="cal-data">Data</label><input type="date" id="cal-data"></div>
            <div class="form-group"><label for="cal-repete">Repete</label><select id="cal-repete"><option value="">Só neste dia</option><option value="semanal">Toda semana, neste dia da semana</option><option value="anual">Todo ano, nesta data</option></select></div>
            <div class="form-group"><label for="cal-nome" id="cal-nome-rotulo">Nome (opcional)</label><input type="text" id="cal-nome" maxlength="60" autocomplete="off"><small class="dica-campo" id="cal-nome-dica"></small></div>
            <div class="form-group"><label for="cal-obs">Observação (opcional)</label><input type="text" id="cal-obs" maxlength="120" autocomplete="off"></div>
        </div>
        <footer class="modal-footer"><button class="btn-salvar-config" id="cal-gravar">Gravar</button></footer></div>
    </div>`);
    const ajustar = () => {
        const dem = TIPOS_DE_DEMANDA.includes($('cal-tipo').value);
        $('cal-nome-rotulo').textContent = dem ? 'Nome' : 'Nome (opcional)';
        $('cal-nome-dica').textContent = dem ? 'Use sempre o mesmo nome quando se repetir (ex.: "Festa junina do condomínio"). É assim que a previsão aprende o efeito.' : '';
        $('cal-nome').placeholder = { compra: 'Ex.: Ceasa', producao: 'Ex.: Molhos e conservas', feira: 'Ex.: Feira do Jardins', promocao: 'Ex.: Sexta da fruta', evento: 'Ex.: Festa junina do condomínio', feriado: 'Ex.: Aniversário de Goiânia', especial: 'Ex.: Volta às aulas' }[$('cal-tipo').value];
    };
    $('cal-tipo').addEventListener('change', ajustar); $('modal-calendario')._ajustar = ajustar;
    $('cal-gravar').addEventListener('click', gravar);
}

function abrirNovo() {
    garantirModal();
    $('cal-tipo').value = 'compra'; $('cal-data').value = S.dia; $('cal-repete').value = ''; $('cal-nome').value = ''; $('cal-obs').value = '';
    $('modal-calendario')._ajustar(); openModal('modal-calendario');
}

async function gravar() {
    const b = $('cal-gravar'); if (b.disabled) return;
    const e = { data: $('cal-data').value, tipo: $('cal-tipo').value, repete: $('cal-repete').value, titulo: $('cal-nome').value.trim(), obs: $('cal-obs').value.trim().slice(0, 120) };
    const erro = validarEntrada(e); if (erro) return showToast(erro, true);
    const id = crypto.randomUUID ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    b.disabled = true;
    try {
        await setDoc(tdoc('calendario', id), { ...e, criadoEm: new Date().toISOString() });
        S.entradas.push({ id, ...e }); S.dia = e.data; S.mes = e.data.slice(0, 7);
        closeModal('modal-calendario'); if (history.state && history.state.modal === 'modal-calendario') history.back();
        showToast('Marcado no calendário.'); render();
    } catch (err) { showToast(err && err.code === 'permission-denied' ? 'Sem permissão para gravar. Publique as regras novas do Firestore.' : 'Não consegui gravar. Confira a internet.', true); }
    finally { b.disabled = false; }
}

async function apagar(id) {
    const e = S.entradas.find((x) => x.id === id); if (!e) return;
    const ok = await customConfirm('Apagar do calendário?', e.repete ? `"${e.titulo || TIPOS[e.tipo][0]}" se repete ${REPETE[e.repete]}. Apagar tira TODAS as datas, inclusive as passadas.` : `"${e.titulo || TIPOS[e.tipo][0]}" sai do calendário.`);
    if (!ok) return;
    try { await deleteDoc(tdoc('calendario', id)); S.entradas = S.entradas.filter((x) => x.id !== id); showToast('Apagado.'); render(); }
    catch (_) { showToast('Não consegui apagar. Confira a internet.', true); }
}

function ligar() {
    if (S.ligado) return; S.ligado = true;
    el().addEventListener('click', (e) => {
        const d = e.target.closest('[data-cal-dia]'); if (d) { S.dia = d.dataset.calDia; if (S.dia.slice(0, 7) !== S.mes) S.mes = S.dia.slice(0, 7); render(); el().querySelector('.cal-dia.sel')?.focus(); return; }
        const x = e.target.closest('[data-cal-apagar]'); if (x) return apagar(x.dataset.calApagar);
        const a = e.target.closest('[data-cal]'); if (!a) return;
        if (a.dataset.cal === 'novo') return S.podeEditar ? abrirNovo() : null;
        if (a.dataset.cal === 'hoje') { S.dia = hojeBR(); S.mes = S.dia.slice(0, 7); }
        else { const [y, m] = S.mes.split('-').map(Number), n = new Date(Date.UTC(y, m - 1 + (a.dataset.cal === 'depois' ? 1 : -1), 1)); S.mes = n.toISOString().slice(0, 7); }
        render();
    });
}

export async function abrirCalendario({ podeEditar = true } = {}) {
    if (!el()) return;
    S.podeEditar = podeEditar;
    ligar();
    if (S.entradas) { S.estado = 'ok'; render(); return; }
    S.estado = 'carregando'; render();
    try { await lerCalendario(); S.estado = 'ok'; } catch (_) { S.estado = 'erro'; }
    render();
}
