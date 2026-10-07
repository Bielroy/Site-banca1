// =====================================================================
//  js/admin-pdv.js — aba "Balcão": venda presencial pelo celular.
//
//  Toca nos produtos, escolhe o pagamento, registra. A venda vai para
//  /api/pdv, que confere os preços no cadastro e grava um pedido já
//  concluído: estoque, faturamento, Balanço e motor de demanda recebem
//  a venda sem nenhum passo a mais.
// =====================================================================
import { auth } from './firebase.js';
import { escapeHTML, fmt, showToast, openModal, closeModal } from './utils.js';
import { criarCamposEndereco } from './endereco.js';

const S = { produtos: [], itens: new Map(), busca: '', pag: 'PIX', condominios: [], ligado: false, enviando: false, chave: null, ultima: null, endereco: null };
const el = () => document.getElementById('pdv-conteudo');
const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ehPeso = (un) => ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'].includes(String(un || '').toLowerCase());
const novaChave = () => (crypto.randomUUID ? crypto.randomUUID() : `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
const txtQtd = (q) => String(Math.round(q * 1000) / 1000).replace('.', ',');
const centavos = (v) => Math.round(Number(v) * 100);

const vendaveis = () => S.produtos.filter((p) => !p.soInsumo && Number(p.preco) > 0).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
// mesma conta do servidor: preço em centavos × quantidade, arredondado por item
const totalC = () => [...S.itens].reduce((s, [id, q]) => { const p = S.produtos.find((x) => x.id === id); return p ? s + Math.round(centavos(p.preco) * q) : s; }, 0);

function linhaHtml(p) {
    const q = S.itens.get(p.id) || 0, peso = ehPeso(p.unidade);
    return `<div class="pv2-linha${q ? ' on' : ''}" data-id="${escapeHTML(p.id)}">
        <div class="pv2-info"><strong>${escapeHTML(p.nome)}</strong><small>${fmt(p.preco)} / ${escapeHTML(p.unidade || 'un')}${p.estoqueFisico != null && p.estoqueFisico !== '' ? ` · tem ${txtQtd(Number(p.estoqueFisico))}` : ''}</small></div>
        <div class="pv2-qtd">
            <button type="button" data-pv2="menos" aria-label="Tirar ${escapeHTML(p.nome)}"${q ? '' : ' disabled'}>−</button>
            <input type="text" inputmode="${peso ? 'decimal' : 'numeric'}" autocomplete="off" value="${q ? txtQtd(q) : ''}" placeholder="0" aria-label="Quantidade de ${escapeHTML(p.nome)} em ${escapeHTML(p.unidade || 'un')}">
            <button type="button" data-pv2="mais" aria-label="Colocar ${escapeHTML(p.nome)}">+</button>
        </div>
    </div>`;
}

function pintarLista() {
    const termo = norm(S.busca), lista = vendaveis().filter((p) => !termo || norm(p.nome).includes(termo));
    // o que já está na venda vem primeiro
    lista.sort((a, b) => (S.itens.has(b.id) ? 1 : 0) - (S.itens.has(a.id) ? 1 : 0));
    $('pv2-lista').innerHTML = lista.length ? lista.map(linhaHtml).join('') : '<p class="config-sub">Nenhum produto com esse nome.</p>';
}
function pintarRodape() {
    const t = totalC() / 100, n = S.itens.size, rec = Number(String($('pv2-recebido')?.value || '').replace(',', '.'));
    $('pv2-total').textContent = fmt(t);
    const resumo = n ? `${n} produto${n > 1 ? 's' : ''}` : 'Nenhum produto';
    $('pv2-resumo').textContent = resumo; $('pv2-resumo2').textContent = resumo;
    const c = $('pv2-cobrar'); c.disabled = !n; c.textContent = n ? `Cobrar · ${fmt(t)}` : 'Cobrar';
    $('pv2-dinheiro').hidden = S.pag !== 'Dinheiro';
    $('pv2-troco').textContent = S.pag === 'Dinheiro' && rec > 0 ? (rec >= t ? `Troco: ${fmt(rec - t)}` : `Faltam ${fmt(t - rec)}`) : '';
    document.querySelectorAll('[data-pv2-pag]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pv2Pag === S.pag)));
    const b = $('pv2-registrar'); b.disabled = !n || S.enviando; b.textContent = S.enviando ? 'Registrando...' : n ? `Registrar venda · ${fmt(t)}` : 'Registrar venda';
}

function montar() {
    // Na tela: só a busca, os produtos e uma barra fina com o total. O pagamento abre
    // por cima ao tocar em "Cobrar", para a lista de produtos ficar com a tela toda.
    el().innerHTML = `
    <div class="es-topo"><div><h3>Balcão</h3><p class="config-sub">Venda presencial. Entra no estoque, no faturamento e na previsão.</p></div></div>
    <div id="pv2-ultima" class="pv2-ultima" hidden aria-live="polite"></div>
    <input type="search" id="pv2-busca" class="es-busca" placeholder="Buscar produto..." aria-label="Buscar produto">
    <div id="pv2-lista" class="pv2-lista"></div>
    <div class="pv2-barra">
        <span id="pv2-resumo"></span>
        <button class="btn-salvar-config" id="pv2-cobrar" disabled>Cobrar</button>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-pdv" role="dialog" aria-modal="true" aria-labelledby="pv2-m-titulo">
        <div class="modal">
            <header class="modal-head"><h2 id="pv2-m-titulo">Cobrar</h2><button class="btn-fechar" data-fechar="modal-pdv" aria-label="Fechar">&times;</button></header>
            <div class="modal-body pv2-caixa">
                <div class="pv2-total-linha"><span id="pv2-resumo2"></span><strong id="pv2-total"></strong></div>
                <div class="pv2-pags" role="group" aria-label="Forma de pagamento">
                    ${['PIX', 'Dinheiro', 'Cartão'].map((p) => `<button type="button" data-pv2-pag="${p}">${p}</button>`).join('')}
                </div>
                <div id="pv2-dinheiro" class="pv2-dinheiro" hidden>
                    <label for="pv2-recebido">Recebido em dinheiro</label>
                    <input type="text" id="pv2-recebido" inputmode="decimal" autocomplete="off" placeholder="Ex.: 50,00">
                    <b id="pv2-troco"></b>
                </div>
                <details class="pv2-cliente"><summary>Identificar o cliente (opcional)</summary>
                    <p class="config-sub">Com nome e endereço, a compra entra no histórico dessa casa e melhora a previsão.</p>
                    <div class="form-group"><label for="pv2-nome">Nome</label><input type="text" id="pv2-nome" maxlength="100" autocomplete="off"></div>
                    <div id="pv2-endereco"></div>
                </details>
                <details class="pv2-cliente"><summary>É o resumo de várias vendas?</summary>
                    <p class="config-sub">Para lançar de uma vez o que saiu no balcão, de cabeça. Entra no caixa, no estoque e na previsão, mas não conta como uma pessoa só.</p>
                    <label class="chk-linha" for="pv2-eh-resumo"><input type="checkbox" id="pv2-eh-resumo"> Sim, é o resumo de várias vendas</label>
                    <div class="form-group" id="pv2-resumo-dia-box" hidden><label for="pv2-resumo-dia">De que dia?</label>
                        <select id="pv2-resumo-dia"><option value="hoje">Hoje</option><option value="ontem">Ontem</option></select></div>
                </details>
            </div>
            <footer class="modal-footer"><button class="btn-salvar-config" id="pv2-registrar" disabled>Registrar venda</button></footer>
        </div>
    </div>`);
    S.endereco = criarCamposEndereco($('pv2-endereco'), 'pv2e'); S.endereco.definirLista(S.condominios);
    $('pv2-eh-resumo').addEventListener('change', (ev) => { $('pv2-resumo-dia-box').hidden = !ev.target.checked; });
    pintarLista(); pintarRodape();
}

const definir = (id, q) => {
    const p = S.produtos.find((x) => x.id === id); if (!p) return;
    const peso = ehPeso(p.unidade);
    let v = Number(q); if (!Number.isFinite(v) || v < 0) v = 0;
    v = peso ? Math.round(v * 1000) / 1000 : Math.round(v);
    if (v > 0) S.itens.set(id, Math.min(v, 9999)); else S.itens.delete(id);
};

async function registrar() {
    if (S.enviando || !S.itens.size) return;
    const e = S.endereco.ler(), nome = $('pv2-nome').value.trim();
    const resumo = $('pv2-eh-resumo')?.checked === true, diaResumo = $('pv2-resumo-dia')?.value === 'ontem' ? 'ontem' : 'hoje';
    const cliente = !resumo && (nome || e.quadra || e.lote) ? { nome, ...e } : null;     // resumo de várias vendas não é de uma casa só
    if (cliente && (e.quadra || e.lote) && S.endereco.validar()) return showToast(`Endereço do cliente incompleto: ${S.endereco.validar()}`, true);
    S.chave = S.chave || novaChave();                 // a mesma chave até a venda entrar: toque repetido não vende duas vezes
    S.enviando = true; pintarRodape();
    try {
        const token = await auth.currentUser?.getIdToken();
        const r = await fetch('/api/pdv', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ acao: 'venda', chave: S.chave, pag: S.pag, cliente, ...(resumo ? { resumo: true, dia: diaResumo } : {}), itens: [...S.itens].map(([id, qtd]) => ({ id, qtd })) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Não foi possível registrar a venda.');
        const rec = Number(String($('pv2-recebido').value || '').replace(',', '.'));
        // guarda o que foi vendido para o cupom (o valor de cada item é uma conta da tela; o total é o do servidor)
        const itensCupom = [...S.itens].map(([id, qtd]) => { const p = S.produtos.find((x) => x.id === id) || {}; return { nome: p.nome || id, qtd, unidade: p.unidade || 'un', tipo: ehPeso(p.unidade) ? 'kg' : 'un', subtotal: Math.round((Number(p.preco) || 0) * qtd * 100) / 100 }; });
        const pedidoCupom = { id: j.pedidoId || j.id || '', origem: 'balcao', data: new Date().toISOString(), nome: cliente ? cliente.nome : '', ...(cliente || {}), pag: S.pag, itens: itensCupom, total: j.total };
        S.ultima = { total: j.total, pag: S.pag, troco: S.pag === 'Dinheiro' && rec > j.total ? rec - j.total : 0, pedido: pedidoCupom };
        S.itens.clear(); S.chave = null; S.busca = ''; $('pv2-busca').value = ''; $('pv2-recebido').value = ''; $('pv2-nome').value = ''; S.endereco.preencher({});
        if ($('pv2-eh-resumo')) { $('pv2-eh-resumo').checked = false; $('pv2-resumo-dia').value = 'hoje'; $('pv2-resumo-dia-box').hidden = true; }
        const u = $('pv2-ultima'); u.hidden = false;
        u.innerHTML = `<b>Venda registrada: ${fmt(S.ultima.total)} (${escapeHTML(S.ultima.pag)})</b>${S.ultima.troco ? `<span>Troco: ${fmt(S.ultima.troco)}</span>` : ''}<button type="button" class="btn-outline" id="pv2-imprimir"><i class="ic" data-i="impressora"></i> Imprimir cupom</button>`;
        $('pv2-imprimir').onclick = async (ev) => {
            ev.currentTarget.disabled = true;
            try { const m = await import('./admin-impressao.js'); await m.imprimirPedido(S.ultima.pedido, 'cupom'); }
            catch (_) { showToast('Não consegui abrir a impressão. Confira a internet.', true); }
            if ($('pv2-imprimir')) $('pv2-imprimir').disabled = false;
        };
        closeModal('modal-pdv'); if (history.state && history.state.modal === 'modal-pdv') history.back();
        showToast('Venda registrada.');
        pintarLista(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        showToast(/Failed to fetch|NetworkError|Load failed/i.test(err.message) ? 'Sem internet. A venda NÃO foi registrada: toque de novo quando a conexão voltar.' : err.message, true);
    } finally { S.enviando = false; pintarRodape(); }
}

function ligar() {
    if (S.ligado) return; S.ligado = true;
    const aoClicar = (e) => {
        const b = e.target.closest('[data-pv2]');
        if (b) {
            const l = b.closest('.pv2-linha'), id = l.dataset.id, p = S.produtos.find((x) => x.id === id), passo = ehPeso(p.unidade) ? 0.1 : 1;
            definir(id, (S.itens.get(id) || 0) + (b.dataset.pv2 === 'mais' ? passo : -passo));
            l.outerHTML = linhaHtml(p); pintarRodape(); return;
        }
        const pg = e.target.closest('[data-pv2-pag]'); if (pg) { S.pag = pg.dataset.pv2Pag; pintarRodape(); if (S.pag === 'Dinheiro') $('pv2-recebido').focus(); return; }
        if (e.target.closest('#pv2-cobrar')) { pintarRodape(); return openModal('modal-pdv'); }
        if (e.target.closest('#pv2-registrar')) return registrar();
    };
    const aoDigitar = (e) => {
        if (e.target.id === 'pv2-busca') { S.busca = e.target.value; pintarLista(); return; }
        if (e.target.id === 'pv2-recebido') return pintarRodape();
        const l = e.target.closest('.pv2-linha'); if (!l) return;
        definir(l.dataset.id, String(e.target.value).replace(',', '.'));
        l.classList.toggle('on', S.itens.has(l.dataset.id)); l.querySelector('[data-pv2=menos]').disabled = !S.itens.has(l.dataset.id);
        pintarRodape();
    };
    for (const raiz of [el(), $('modal-pdv')]) { raiz.addEventListener('click', aoClicar); raiz.addEventListener('input', aoDigitar); }
    // ao sair do campo, mostra a quantidade já arredondada (unidade inteira, quilo com 3 casas)
    el().addEventListener('focusout', (e) => { const l = e.target.closest?.('.pv2-linha'); if (l && e.target.tagName === 'INPUT') { const q = S.itens.get(l.dataset.id); e.target.value = q ? txtQtd(q) : ''; } });
}

export const definirCondominiosPdv = (lista) => { S.condominios = Array.isArray(lista) ? lista : []; S.endereco?.definirLista(S.condominios); };

/** Chamado ao abrir a aba e quando os produtos mudam (preço e estoque ao vivo). */
export function abrirPdv(produtos) {
    if (!el()) return;
    S.produtos = produtos || [];
    if (!$('pv2-lista')) { montar(); ligar(); return; }
    if (!el().contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') pintarLista();
    pintarRodape();
}
