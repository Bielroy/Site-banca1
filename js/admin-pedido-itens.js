// =====================================================================
//  js/admin-pedido-itens.js — "Itens: faltou ou acrescentar" no cartão do pedido.
//
//  Duas coisas que antes obrigavam a cancelar o pedido ou a pedir de novo:
//    • FALTOU um produto depois que o pedido chegou → tira só aquele item
//      (o estoque dele volta e o total é refeito);
//    • o cliente lembrou de mais uma coisa pelo WhatsApp → acrescenta aqui,
//      sem ele ter de voltar à loja.
//  Só vale antes de o pedido sair para entrega. Quem faz a conta é o servidor
//  (api/pdv.js → acao 'ajuste', regras em lib/ajuste.js): a tela só diz QUAL item.
//  No fim, um toque monta a mensagem para o cliente (js/mensagem-lib.js), com o
//  pedido de desculpas pelo que faltou. A mensagem só sai se a pessoa mandar.
// =====================================================================
import { auth } from './firebase.js';
import { escapeHTML, fmt, qtdDoItem, showToast, openModal, closeModal, customConfirm, focarCampo } from './utils.js';
import { mensagemDeAjuste, linkDoWhatsApp } from './mensagem-lib.js';

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const POR_PESO = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const ehPorPeso = (un) => POR_PESO.includes(String(un || '').toLowerCase());
const S = { pedido: null, produtos: [], loja: '', aoMudar: null, tirados: [], acrescentados: [], diferenca: 0, escolhido: null, tipo: 'un', ocupado: false };

function montar() {
    if ($('modal-pedido-itens')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-pedido-itens">
        <div class="modal pi-modal">
            <header class="modal-head">
                <h2 id="pi-titulo">Itens do pedido</h2>
                <button class="btn-fechar" data-fechar="modal-pedido-itens" aria-label="Fechar">&times;</button>
            </header>
            <div class="modal-body">
                <p class="pi-total" id="pi-total"></p>
                <ul class="pi-itens" id="pi-itens"></ul>
                <section class="pi-mais" aria-labelledby="pi-mais-tit">
                    <h3 id="pi-mais-tit">Acrescentar um produto</h3>
                    <p class="pi-dica">Para quando o cliente lembra de mais alguma coisa pelo WhatsApp. O preço é o do cadastro.</p>
                    <input type="search" id="pi-busca" placeholder="Buscar produto" aria-label="Buscar produto para acrescentar" autocomplete="off">
                    <div class="pi-achados" id="pi-achados"></div>
                    <div class="pi-escolhido" id="pi-escolhido" hidden></div>
                </section>
                <section class="pi-feito" id="pi-feito" hidden></section>
            </div>
        </div>
    </div>`);
    $('pi-busca').addEventListener('input', pintarAchados);
    $('modal-pedido-itens').addEventListener('click', aoClicar);
    $('modal-pedido-itens').addEventListener('input', (e) => { if (e.target.id === 'pi-qtd') pintarValorPrevisto(); });
}

const valorDaLinha = (i) => (i.aPesar && !(Number(i.pesoFinal) > 0) ? 0 : (Number(i.subtotal) > 0 ? Number(i.subtotal) : (Number(i.pesoFinal) > 0 ? Number(i.pesoFinal) : Number(i.qtd) || 0) * (Number(i.precoOriginal ?? i.preco) || 0)));

function pintarItens() {
    const p = S.pedido, itens = p.itens || [];
    $('pi-titulo').textContent = `Itens do pedido de ${p.nome || 'cliente'}`;
    $('pi-total').innerHTML = `Total agora: <b>${fmt(p.total || 0)}</b>${itens.some((i) => i.aPesar) ? ' <small>(falta pesar item)</small>' : ''}`;
    $('pi-itens').innerHTML = itens.map((i, idx) => `
        <li>
            <div class="pi-item"><b>${qtdDoItem(i)}</b> ${escapeHTML(i.nome)}${i.adicionais ? `<small>↳ ${escapeHTML(i.adicionais)}</small>` : ''}<span>${i.aPesar ? 'a pesar' : fmt(valorDaLinha(i))}</span></div>
            <button type="button" class="pi-tirar" data-pi-tirar="${idx}"${itens.length === 1 ? ' disabled title="É o único item: para tirar tudo, cancele o pedido"' : ''}>Faltou: tirar</button>
        </li>`).join('');
}

function pintarAchados() {
    const termo = norm($('pi-busca').value), alvo = $('pi-achados');
    if (termo.length < 2) { alvo.innerHTML = ''; return; }
    const achados = S.produtos.filter((p) => p && !p.soInsumo && Number(p.preco) > 0 && norm(p.nome).includes(termo))
        .sort((a, b) => (norm(a.nome).startsWith(termo) ? 0 : 1) - (norm(b.nome).startsWith(termo) ? 0 : 1) || String(a.nome).localeCompare(String(b.nome), 'pt-BR')).slice(0, 8);
    alvo.innerHTML = achados.length
        ? achados.map((p) => `<button type="button" data-pi-escolher="${escapeHTML(p.id)}"><span>${escapeHTML(p.nome)}${p.ativo === false ? ' <small>(fora da loja)</small>' : ''}</span><b>${fmt(p.preco)}${ehPorPeso(p.unidade) ? '/kg' : ''}</b></button>`).join('')
        : '<p class="pi-nada">Nenhum produto com esse nome.</p>';
}

const lerQtd = () => Number(String($('pi-qtd')?.value || '').replace(',', '.'));
function pintarValorPrevisto() {
    const alvo = $('pi-previsto'), p = S.escolhido; if (!alvo || !p) return;
    const q = lerQtd();
    if (!(q > 0)) { alvo.textContent = ''; return; }
    alvo.textContent = S.tipo === 'un' && ehPorPeso(p.unidade) ? 'Vai à balança: o valor entra depois de pesar.' : `Acrescenta cerca de ${fmt(q * Number(p.preco))} (o servidor confere o preço do dia).`;
}
function pintarEscolhido() {
    const alvo = $('pi-escolhido'), p = S.escolhido;
    alvo.hidden = !p; if (!p) { alvo.innerHTML = ''; return; }
    const peso = ehPorPeso(p.unidade);
    alvo.innerHTML = `
        <p class="pi-nome"><b>${escapeHTML(p.nome)}</b> <span>${fmt(p.preco)}${peso ? '/kg' : ''}</span></p>
        ${peso ? `<div class="pi-tipos" role="radiogroup" aria-label="Como o cliente pediu">
            <button type="button" role="radio" aria-checked="${S.tipo === 'kg'}" class="${S.tipo === 'kg' ? 'on' : ''}" data-pi-tipo="kg">Por quilo</button>
            <button type="button" role="radio" aria-checked="${S.tipo === 'un'}" class="${S.tipo === 'un' ? 'on' : ''}" data-pi-tipo="un">Por unidade (vai à balança)</button>
        </div>` : ''}
        <label class="pi-rot" for="pi-qtd">${S.tipo === 'kg' ? 'Quantos quilos' : 'Quantidade'}</label>
        <div class="pi-linha">
            <input type="text" id="pi-qtd" inputmode="${S.tipo === 'kg' ? 'decimal' : 'numeric'}" autocomplete="off" value="${S.tipo === 'kg' ? '' : '1'}" placeholder="${S.tipo === 'kg' ? 'Ex.: 0,5' : '1'}">
            <button type="button" class="btn btn-primary" id="pi-acrescentar">Acrescentar ao pedido</button>
        </div>
        <p class="pi-previsto" id="pi-previsto" aria-live="polite"></p>`;
    pintarValorPrevisto();
    setTimeout(() => focarCampo($('pi-qtd')), 80);
}

// o que mudou nesta vez e o botão de avisar o cliente
function pintarFeito() {
    const alvo = $('pi-feito'), n = S.tirados.length + S.acrescentados.length;
    alvo.hidden = !n; if (!n) { alvo.innerHTML = ''; return; }
    const linhas = [...S.tirados.map((a) => `<li class="saiu">Saiu: <b>${escapeHTML(a.nome)}</b>${a.qtd ? ` (${escapeHTML(a.qtd)})` : ''}</li>`),
        ...S.acrescentados.map((a) => `<li class="entrou">Entrou: <b>${escapeHTML(a.nome)}</b>${a.qtd ? ` (${escapeHTML(a.qtd)})` : ''}</li>`)].join('');
    const acerto = S.diferenca > 0 ? `<p class="pc-acerto cobrar"><span>Este pedido já foi pago pelo site. <b>Falta cobrar ${fmt(S.diferenca)} na entrega.</b></span></p>`
        : S.diferenca < 0 ? `<p class="pc-acerto devolver"><span>Este pedido já foi pago pelo site. <b>Devolva ${fmt(-S.diferenca)} ao cliente.</b></span></p>` : '';
    alvo.innerHTML = `<h3>O que mudou agora</h3><ul>${linhas}</ul>${acerto}
        <button type="button" class="btn btn-primary" id="pi-avisar"><i class="ic" data-i="conversa"></i> Avisar o cliente no WhatsApp</button>
        <p class="pi-dica">A mensagem já vai escrita${S.tirados.length ? ', com o pedido de desculpas pelo que faltou' : ''}. Nada é enviado sem você tocar em enviar no WhatsApp.</p>`;
}

async function chamar(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/pdv', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'ajuste', pedidoId: S.pedido.id, ...corpo }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível mudar o pedido.');
    return d;
}
// o cartão e esta tela mudam NA HORA com a resposta do servidor (sem esperar o banco avisar o aparelho)
function aplicar(d) {
    S.pedido = { ...S.pedido, itens: Array.isArray(d.itens) ? d.itens : S.pedido.itens, total: d.total, status: d.status || S.pedido.status, temItensAPesar: (d.itens || []).some((i) => i.aPesar),
        ajustes: [...(S.pedido.ajustes || []), d.tirado || d.acrescentado].filter(Boolean) };
    S.diferenca = Number(d.diferencaDoPago) || 0;
    if (typeof S.aoMudar === 'function') S.aoMudar(S.pedido);
    pintarItens(); pintarFeito();
}

async function tirar(idx) {
    const item = (S.pedido.itens || [])[idx]; if (!item || S.ocupado) return;
    if (!(await customConfirm(`Tirar "${item.nome}" do pedido?`, 'Use quando o produto faltou. O estoque dele volta e o total do pedido é refeito. Depois você avisa o cliente com um toque.', { ok: 'Tirar do pedido', nao: 'Voltar' }))) return;
    S.ocupado = true;
    try {
        const d = await chamar({ op: 'tirar', indice: idx, itemId: item.id, motivo: 'em falta' });
        S.tirados.push(d.tirado); aplicar(d);
        showToast(`"${item.nome}" saiu do pedido. Novo total: ${fmt(d.total)}.`);
    } catch (e) { showToast(e.message, true); }
    S.ocupado = false;
}
async function acrescentar() {
    const p = S.escolhido, q = lerQtd(); if (!p || S.ocupado) return;
    if (!(q > 0)) { showToast('Escreva a quantidade.', true); return focarCampo($('pi-qtd')); }
    const botao = $('pi-acrescentar'); S.ocupado = true; if (botao) { botao.disabled = true; botao.textContent = 'Acrescentando...'; }
    try {
        const d = await chamar({ op: 'acrescentar', item: { id: p.id, qtd: q, tipo: ehPorPeso(p.unidade) ? S.tipo : 'un' } });
        S.acrescentados.push(d.acrescentado); S.escolhido = null; $('pi-busca').value = ''; $('pi-achados').innerHTML = '';
        pintarEscolhido(); aplicar(d);
        showToast(d.acrescentado && d.acrescentado.aPesar ? `"${p.nome}" entrou no pedido. Ele vai à balança.` : `"${p.nome}" entrou no pedido. Novo total: ${fmt(d.total)}.`);
    } catch (e) { showToast(e.message, true); if (botao) { botao.disabled = false; botao.textContent = 'Acrescentar ao pedido'; } }
    S.ocupado = false;
}
function avisar() {
    const msg = mensagemDeAjuste({ loja: S.loja, pedido: S.pedido, tirados: S.tirados, acrescentados: S.acrescentados, total: S.pedido.total, diferenca: S.diferenca });
    // abre ANTES de qualquer espera: o iPhone bloqueia janela aberta depois de um "await"
    window.open(linkDoWhatsApp(S.pedido.telefone, msg), '_blank', 'noopener');
    try { navigator.clipboard.writeText(msg).catch(() => {}); } catch (_) { /* sem área de transferência: o link já leva o texto */ }
    showToast(S.pedido.telefone ? 'Abrindo a conversa com o cliente.' : 'Texto copiado: escolha a conversa do cliente.');
}

function aoClicar(e) {
    const t = e.target.closest('[data-pi-tirar], [data-pi-escolher], [data-pi-tipo], #pi-acrescentar, #pi-avisar'); if (!t) return;
    if (t.dataset.piTirar !== undefined) return tirar(Number(t.dataset.piTirar));
    if (t.dataset.piEscolher) { S.escolhido = S.produtos.find((p) => p.id === t.dataset.piEscolher) || null; S.tipo = S.escolhido && ehPorPeso(S.escolhido.unidade) ? 'kg' : 'un'; $('pi-achados').innerHTML = ''; return pintarEscolhido(); }
    if (t.dataset.piTipo) { S.tipo = t.dataset.piTipo; return pintarEscolhido(); }
    if (t.id === 'pi-acrescentar') return acrescentar();
    if (t.id === 'pi-avisar') return avisar();
}

/** Abre a tela para um pedido. `aoMudar(pedido)` é chamado com o pedido novo a cada mudança. */
export function abrirItensDoPedido(pedido, { produtos = [], loja = '', aoMudar = null } = {}) {
    montar();
    Object.assign(S, { pedido: { ...pedido }, produtos, loja, aoMudar, tirados: [], acrescentados: [], diferenca: 0, escolhido: null, tipo: 'un', ocupado: false });
    $('pi-busca').value = ''; $('pi-achados').innerHTML = '';
    pintarItens(); pintarEscolhido(); pintarFeito();
    openModal('modal-pedido-itens');
}
export const fecharItensDoPedido = () => closeModal('modal-pedido-itens');
