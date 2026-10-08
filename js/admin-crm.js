// =====================================================================
//  js/admin-crm.js — aba "Clientes" do painel.
//
//  Quem compra, com que frequência, quanto gasta e quem sumiu. Os números
//  vêm do motor de demanda (recalculado todo dia), então abrir a aba custa
//  uma chamada ao servidor e mais nada.
//
//  MENSAGENS: só para quem marcou "quero receber ofertas" no pedido, uma por
//  vez, pelo WhatsApp da própria pessoa que atende, e no máximo uma a cada
//  14 dias por cliente. Não existe envio em massa de propósito.
// =====================================================================
import { auth, getDoc, setDoc } from './firebase.js';
import { tdoc, fichaRef, ehLojaOriginal } from './tenant.js';
import { escapeHTML, fmt, showToast, openModal, closeModal, customConfirm } from './utils.js';
import { linhaEndereco } from './endereco.js';
import { lerPainel } from './painel-cache.js';
import { hojeBR } from './fechamento-lib.js';
import { SEGMENTOS, segmentar, filtrar, podeContatar, mensagemSugerida } from './crm-lib.js';
import { mensagemDoLink, foneParaWhats, foneBonito } from './conta-lib.js';

const S = { seg: null, produtos: [], filtro: 'todos', produtoId: '', busca: '', contatos: {}, geradoEm: '', ligado: false, estado: 'carregando', atual: null, nomeLoja: ehLojaOriginal ? 'Banca Adair e Pedrina' : 'loja' };
const el = () => document.getElementById('crm-conteudo');
const $ = (id) => document.getElementById(id);
const haDias = (n) => (n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`);

function render() {
    if (!el()) return;
    if (S.estado !== 'ok') {
        el().innerHTML = `<div class="es-topo"><div><h3>Clientes</h3></div></div><div class="cp-vazio"><b>${S.estado === 'carregando' ? 'Carregando clientes...' : S.estado === 'vazio' ? 'Ainda não há clientes calculados.' : 'Não consegui carregar os clientes.'}</b><span>${S.estado === 'vazio' ? 'A lista aparece depois do primeiro cálculo do motor de previsão (aba Previsão, botão de recalcular) e de alguns pedidos com endereço.' : S.estado === 'erro' ? 'Confira a internet e abra a aba de novo.' : ''}</span></div>`;
        return;
    }
    const c = S.seg.contagem, lista = filtrar(S.seg, { segmento: S.filtro, produtoId: S.produtoId, busca: S.busca });
    const nomeProd = (id) => (S.produtos.find((p) => p.id === id) || {}).nome;
    const comprados = [...new Set(S.seg.lista.flatMap((x) => x.tp || []))].map((id) => [id, nomeProd(id)]).filter(([, n]) => n).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    el().innerHTML = `
    <div class="es-topo"><div><h3>Clientes</h3><p class="config-sub">${c.inativos ? `<b>${c.inativos}</b> cliente${c.inativos > 1 ? 's não compram' : ' não compra'} há mais de ${S.seg.diasInativo} dias.` : 'Ninguém parado há mais de 30 dias.'}${S.geradoEm ? ` Dados de ${new Date(S.geradoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ''}</p></div></div>
    <div class="es-filtros">${SEGMENTOS.map(([k, r]) => `<button class="es-chip${S.filtro === k ? ' on' : ''}" data-crm-seg="${k}">${r} <b>${c[k]}</b></button>`).join('')}</div>
    <div class="crm-filtros">
        <input type="search" id="crm-busca" class="es-busca" placeholder="Buscar por nome ou endereço..." value="${escapeHTML(S.busca)}" aria-label="Buscar cliente">
        <select id="crm-produto" aria-label="Clientes que compram um produto"><option value="">Que compram qualquer produto</option>${comprados.map(([id, n]) => `<option value="${escapeHTML(id)}"${id === S.produtoId ? ' selected' : ''}>Que compram ${escapeHTML(n)}</option>`).join('')}</select>
    </div>
    <p class="config-sub crm-conta">${lista.length} cliente${lista.length === 1 ? '' : 's'} neste filtro</p>
    <div class="crm-lista">${lista.slice(0, 150).map((x) => `
        <button class="crm-item" data-crm-id="${escapeHTML(x.id)}">
            <span class="crm-nome">${escapeHTML(x.nome || 'Sem nome')}<small>${escapeHTML(linhaEndereco(x, { curto: true }) || 'sem endereço')}</small></span>
            <span class="crm-num"><b>${x.gasto ? fmt(x.gasto) : '–'}</b><small>${x.ped || x.n} pedido${(x.ped || x.n) > 1 ? 's' : ''} · ${haDias(x.semComprar)}</small></span>
        </button>`).join('') || '<p class="config-sub">Nenhum cliente neste filtro.</p>'}</div>
    ${lista.length > 150 ? '<p class="config-sub">Mostrando os 150 primeiros. Use a busca para achar os demais.</p>' : ''}`;
}

function garantirModal() {
    if ($('modal-crm')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-crm" role="dialog" aria-modal="true" aria-labelledby="crm-m-titulo">
        <div class="modal"><header class="modal-head"><h2 id="crm-m-titulo"></h2><button class="btn-fechar" data-fechar="modal-crm" aria-label="Fechar">&times;</button></header>
        <div class="modal-body" id="crm-m-corpo"></div></div>
    </div>`);
    $('modal-crm').addEventListener('click', (e) => { if (e.target.closest('#crm-enviar')) enviar(); else if (e.target.closest('#crm-gerar-link')) gerarLink(); else if (e.target.closest('#crm-copiar-link')) copiarLink(); });
}

async function abrirCliente(x) {
    garantirModal(); S.atual = x;
    const rot = Object.fromEntries(SEGMENTOS);
    const contato = podeContatar(x, S.contatos[x.id]);
    $('crm-m-titulo').textContent = x.nome || 'Cliente';
    $('crm-m-corpo').innerHTML = `
        <p class="config-sub">${escapeHTML(linhaEndereco(x) || 'Sem endereço')}</p>
        <div class="crm-tags">${x.seg.map((s) => `<span>${rot[s]}</span>`).join('')}</div>
        <dl class="crm-dados">
            <dt>Pedidos</dt><dd>${x.ped || x.n}</dd>
            <dt>Total gasto</dt><dd>${x.gasto ? fmt(x.gasto) : '–'}</dd>
            <dt>Ticket médio</dt><dd>${x.ticket ? fmt(x.ticket) : '–'}</dd>
            <dt>Última compra</dt><dd>${haDias(x.semComprar)}</dd>
            <dt>Costuma comprar</dt><dd>${x.cada ? `a cada ${Math.round(x.cada)} dia${Math.round(x.cada) > 1 ? 's' : ''}` : 'ainda sem padrão'}</dd>
        </dl>
        <h4 class="cp-sub">O que costuma levar</h4><div id="crm-itens"><p class="config-sub">Carregando...</p></div>
        <h4 class="cp-sub">Últimos pedidos</h4><div id="crm-pedidos"><p class="config-sub">Carregando...</p></div>
        <h4 class="cp-sub">Acesso do cliente</h4><div id="crm-acesso"><p class="config-sub">Carregando...</p></div>
        <h4 class="cp-sub">Mensagem</h4>
        ${contato.pode ? `<textarea id="crm-texto" rows="4" maxlength="500" aria-label="Mensagem para o cliente">${escapeHTML(mensagemSugerida(x, S.nomeLoja))}</textarea>
            <button class="btn-salvar-config crm-zap" id="crm-enviar">Abrir no WhatsApp</button>
            <p class="config-sub">Abre a conversa com o texto pronto; quem envia é você. Depois disso, este cliente fica 14 dias sem receber outra.</p>`
            : `<p class="crm-bloqueio">${escapeHTML(contato.motivo)}</p>`}`;
    openModal('modal-crm');
    carregarConta(x);
    try {
        const token = await auth.currentUser?.getIdToken();
        const r = await fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'cliente', clienteId: x.id }) });
        const j = await r.json(); if (!r.ok) throw new Error();
        if (S.atual !== x) return;
        const itens = (j.itens || []).slice(0, 6);
        $('crm-itens').innerHTML = itens.length ? `<ul class="crm-itens">${itens.map((i) => `<li><span>${escapeHTML(i.nome)}${(i.motivos || [])[0] ? `<small>${escapeHTML(i.motivos[0])}</small>` : ''}</span><b>${Math.round(i.p * 100)}%</b></li>`).join('')}</ul><p class="config-sub">A porcentagem é a chance de levar no próximo pedido.</p>${(j.perfil.abandonados || []).length ? `<p class="config-sub">Parou de levar: ${j.perfil.abandonados.slice(0, 5).map(escapeHTML).join(', ')}.</p>` : ''}` : '<p class="config-sub">Ainda sem histórico suficiente.</p>';
    } catch (_) { if (S.atual === x && $('crm-itens')) $('crm-itens').innerHTML = '<p class="config-sub">Não consegui carregar os produtos deste cliente.</p>'; }
}

// ---------------------------------------------------------------------
// CONTA DO CLIENTE: os pedidos deste endereço e o link de acesso.
// O cliente não tem login: a loja lembra dele por um crachá no aparelho e por um link pessoal que vai
// na mensagem do WhatsApp. Se ele perder os dois (celular novo, conversa apagada), o dono gera um link
// novo aqui. Quem decide se pode é o servidor (lib/conta.js): só dono e gerente.
// ---------------------------------------------------------------------
const STATUS_PEDIDO = { pendente: 'Recebido', aguardando_pagamento: 'Aguardando pagamento', aguardando_pesagem: 'Na balança', preparando: 'Separando', enviado: 'Saiu para entrega', cancelado: 'Cancelado', arquivado: 'Concluído' };
async function chamarConta(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não consegui falar com o servidor.');
    return j;
}
const botaoGerar = (rotulo) => `<button class="btn-outline crm-gerar" id="crm-gerar-link" type="button">${rotulo}</button>`;
async function carregarConta(x) {
    S.link = '';
    try {
        const j = await chamarConta({ acao: 'conta-ficha', clienteId: x.id });
        if (S.atual !== x) return;
        const ps = j.pedidos || [];
        $('crm-pedidos').innerHTML = ps.length ? `<ul class="crm-pedidos">${ps.map((p) => `<li><span><b>${escapeHTML(new Date(p.data).toLocaleDateString('pt-BR'))}</b> · ${escapeHTML(STATUS_PEDIDO[p.status] || p.status)}<small>${escapeHTML(p.descItens || '')}</small></span><b>${fmt(p.total)}</b></li>`).join('')}</ul>` : '<p class="config-sub">Não achei pedidos feitos pelo site neste endereço.</p>';
        $('crm-acesso').innerHTML = `<p class="config-sub">${j.temAcesso ? `A loja lembra deste cliente no aparelho dele${j.vistoEm ? ` (última visita em ${escapeHTML(new Date(j.vistoEm).toLocaleDateString('pt-BR'))})` : ''}.` : 'Este cliente ainda não tem acesso salvo.'} Se ele trocou de celular e perdeu a mensagem do WhatsApp, gere um link novo e envie para ele.</p>${botaoGerar('Gerar link de acesso')}`;
    } catch (e) {
        if (S.atual !== x) return;
        $('crm-pedidos').innerHTML = '<p class="config-sub">Não consegui carregar os pedidos deste cliente.</p>';
        $('crm-acesso').innerHTML = `<p class="config-sub">${escapeHTML(e.message)}</p>`;
    }
}
async function gerarLink() {
    const x = S.atual; if (!x) return;
    const ok = await customConfirm('Gerar um link novo?', `Os links antigos de ${x.nome || 'este cliente'} param de valer. Envie o link novo só para o WhatsApp que você já conhece dele: quem abrir o link vê o nome, o endereço e os pedidos.`, { ok: 'Gerar link', nao: 'Voltar' });
    if (!ok || S.atual !== x) return;
    const botao = $('crm-gerar-link'); if (botao) { botao.disabled = true; botao.textContent = 'Gerando...'; }
    try {
        const j = await chamarConta({ acao: 'conta-link', clienteId: x.id });
        if (S.atual !== x) return;
        S.link = j.link;
        const fone = foneParaWhats(j.telefone), texto = mensagemDoLink(j.nome || x.nome, S.nomeLoja, j.link);
        // o envio é um link de verdade, tocado por você: o navegador não barra, e nada sai sem o seu toque
        $('crm-acesso').innerHTML = `<p class="crm-ok">Link pronto. Os anteriores não valem mais.</p>
            ${j.outrosTelefones ? '<p class="crm-bloqueio">Atenção: este endereço tem pedidos com mais de um telefone. O link leva só os pedidos do número abaixo. Confira se é o do seu cliente.</p>' : ''}
            ${fone ? `<a class="btn-salvar-config crm-zap" href="https://wa.me/${fone}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener noreferrer">Enviar para ${escapeHTML(foneBonito(j.telefone))}</a>` : '<p class="crm-bloqueio">Este cliente não deixou telefone nos pedidos. Copie o link e envie na conversa que você já tem com ele.</p>'}
            <button class="btn-outline crm-gerar" id="crm-copiar-link" type="button">Copiar o link</button>
            <p class="config-sub">Antes de enviar, confira que é ele mesmo. Se o número mudou, pergunte o endereço e o último pedido.</p>`;
    } catch (e) {
        showToast(e.message, true);
        if (botao) { botao.disabled = false; botao.textContent = 'Gerar link de acesso'; }
    }
}
async function copiarLink() {
    if (!S.link) return;
    try { await navigator.clipboard.writeText(S.link); showToast('Link copiado.'); }
    catch (_) { showToast('Não consegui copiar. Use o botão do WhatsApp.', true); }
}

async function enviar() {
    const x = S.atual; if (!x) return;
    const texto = $('crm-texto').value.trim();
    if (texto.length < 10) return showToast('Escreva a mensagem antes de abrir o WhatsApp.', true);
    if (!podeContatar(x, S.contatos[x.id]).pode) return;
    const fone = x.tel.startsWith('55') ? x.tel : `55${x.tel}`;
    const janela = window.open(`https://wa.me/${fone}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    const agora = new Date().toISOString(); S.contatos[x.id] = agora;
    try { await setDoc(tdoc('crm', 'contatos'), { [x.id]: agora }, { merge: true }); }
    catch (_) { showToast('Abri o WhatsApp, mas não consegui anotar o contato. Publique as regras novas do Firestore.', true); }
    closeModal('modal-crm'); if (history.state && history.state.modal === 'modal-crm') history.back();
    if (janela === null) showToast('O navegador bloqueou a nova aba. Libere pop-ups para este site.', true);
}

function ligar() {
    if (S.ligado) return; S.ligado = true;
    el().addEventListener('click', (e) => {
        const s = e.target.closest('[data-crm-seg]'); if (s) { S.filtro = s.dataset.crmSeg; render(); return; }
        const i = e.target.closest('[data-crm-id]'); if (i) { const x = S.seg.lista.find((c) => c.id === i.dataset.crmId); if (x) abrirCliente(x); }
    });
    el().addEventListener('change', (e) => { if (e.target.id === 'crm-produto') { S.produtoId = e.target.value; render(); } });
    el().addEventListener('input', (e) => {
        if (e.target.id !== 'crm-busca') return;
        S.busca = e.target.value; const pos = e.target.selectionStart; render(); const b = $('crm-busca'); b.focus(); b.setSelectionRange(pos, pos);
    });
}

export async function abrirCrm(produtos, nomeLoja) {
    if (!el()) return;
    S.produtos = produtos || []; if (nomeLoja) S.nomeLoja = nomeLoja;
    ligar();
    if (S.seg) { render(); return; }
    S.estado = 'carregando'; render();
    try {
        const [painel, contatos, ficha] = await Promise.all([lerPainel(), getDoc(tdoc('crm', 'contatos')).catch(() => null), getDoc(fichaRef()).catch(() => null)]);
        if (ficha && ficha.exists() && ficha.data().nome) S.nomeLoja = ficha.data().nome;
        S.contatos = contatos && contatos.exists() ? contatos.data() : {};
        const indice = painel.indiceClientes || [];
        S.geradoEm = (painel.meta && painel.meta.geradoEm) || '';
        if (!indice.length) { S.estado = 'vazio'; render(); return; }
        S.seg = segmentar(indice, hojeBR()); S.estado = 'ok';
    } catch (_) { S.estado = 'erro'; }
    render();
}
