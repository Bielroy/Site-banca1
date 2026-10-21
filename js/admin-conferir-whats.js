// =====================================================================
//  js/admin-conferir-whats.js — "Conferir e registrar" o pedido que chegou por mensagem.
//
//  Fica na tela da Impressora, DEPOIS que o papel saiu (o papel continua igual: só o texto).
//  É opcional: a banca abre, vê cada linha casada com um produto do cadastro (js/whats-produtos-lib.js),
//  troca o que estiver errado com um toque e registra. O pedido vai para /api/pdv (acao "mensagem"),
//  que confere preço e produto no cadastro e grava um pedido normal de hoje:
//    • por quilo com peso escrito  → valor fechado;
//    • por quilo pedido em unidades → "a pesar" (fecha na Pesagem, como o pedido da loja);
//    • por unidade → preço × quantidade.
//  Linha amarela = dúvida (parecido com dois produtos, não sai hoje, dois itens numa linha...).
//  Linha cinza = recado ("eu passo pegar às 18h"): não entra como item, vai na observação.
// =====================================================================
import { auth } from './firebase.js';
import { escapeHTML, fmt, showToast } from './utils.js';
import { linhasDoWhats } from './impressao-lib.js';
import { conferirPedido, itemDoProduto, somaDaConferencia, porPeso } from './whats-produtos-lib.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const novaChave = () => `msg-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
const hojeDow = () => new Date(Date.now() - 3 * 3600000).getUTCDay();
const numero = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.').trim()); return Number.isFinite(n) && n > 0 ? n : null; };
const txtQtd = (q) => (q == null ? '' : String(Math.round(q * 1000) / 1000).replace('.', ','));
/** "pix", "cartão na entrega", "dinheiro, troco p/ 50" → a forma que o sistema conhece ('' = escolher). */
export const pagDoTexto = (t) => { const n = norm(t); if (/pix/.test(n)) return 'PIX'; if (/cart|maquin|debito|credito/.test(n)) return 'Cartão'; if (/dinheiro|especie|troco/.test(n)) return 'Dinheiro'; return ''; };
const serio = (a) => !String(a).startsWith('Sem quantidade');

export function criarConferencia({ $, lerForm, depoisDeRegistrar }) {
    const C = { produtos: [], linhas: null, chave: null, enviando: false };
    const caixa = () => $('ipr-conf');
    const vendaveis = () => C.produtos.filter((p) => p && p.id && p.nome && !p.soInsumo).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const produto = (id) => C.produtos.find((p) => p.id === id);

    function oferecer() {
        const el = caixa(); if (!el) return;
        C.linhas = null; el.hidden = false;
        el.innerHTML = C.produtos.length
            ? `<div class="iconf-convite"><b>Registrar no sistema?</b><span>Opcional. Você confere os produtos e o pedido entra na lista de pedidos, no caixa e no estoque. O que é por quilo e foi pedido em unidades fica para a Pesagem.</span><button type="button" class="btn iconf-bt" data-conf="abrir">Conferir e registrar</button></div>`
            : '';
        el.hidden = !C.produtos.length;
    }
    function fechar() { const el = caixa(); if (el) { el.hidden = true; el.innerHTML = ''; } C.linhas = null; C.chave = null; }
    function abrir() {
        const d = lerForm();
        C.linhas = conferirPedido(linhasDoWhats(d.itens), C.produtos, { dia: hojeDow() }).map((l) => ({ ...l, pular: !l.produto }));
        if (!C.linhas.length) { showToast('Cole os itens do pedido primeiro.', true); return; }
        C.chave = C.chave || novaChave();
        pintar();
        caixa().scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function opcoes(l) {
        const marcados = new Set(l.candidatos.map((c) => c.id)), sel = l.pular ? '' : (l.produto && l.produto.id) || '';
        const op = (p, estrela) => `<option value="${escapeHTML(p.id)}"${p.id === sel ? ' selected' : ''}>${escapeHTML(p.nome)}</option>`;
        const sugeridos = l.candidatos.map((c) => produto(c.id)).filter(Boolean);
        const resto = vendaveis().filter((p) => !marcados.has(p.id));
        return `<option value=""${sel ? '' : ' selected'}>${l.nivel === 'recado' ? 'Recado (não entra)' : '— não registrar —'}</option>${sugeridos.length ? `<optgroup label="Parecidos">${sugeridos.map((p) => op(p, true)).join('')}</optgroup>` : ''}<optgroup label="Todos os produtos">${resto.map((p) => op(p, false)).join('')}</optgroup>`;
    }
    function linhaHtml(l, i) {
        const p = !l.pular && l.produto ? produto(l.produto.id) : null, it = p ? l.item : null;
        const cls = l.pular ? (l.nivel === 'recado' ? 'recado' : 'fora') : l.nivel;
        const medida = p ? (porPeso(p)
            ? `<select data-k="tipo" aria-label="Medida"><option value="kg"${it.tipo === 'kg' ? ' selected' : ''}>kg</option><option value="un"${it.tipo === 'un' ? ' selected' : ''}>unid. (pesar)</option></select>`
            : `<span class="iconf-un">${escapeHTML(p.unidade || 'un')}</span>`) : '';
        const valor = !it ? '' : it.aPesar ? (it.valor != null ? `≈ ${fmt(it.valor)}` : 'a pesar') : fmt(it.valor || 0);
        const avisos = !l.pular && l.avisos && l.avisos.length ? `<p class="iconf-aviso">${l.avisos.map(escapeHTML).join(' · ')}</p>` : '';
        return `<li class="iconf-linha iconf-${cls}" data-i="${i}">
            <small class="iconf-orig">${escapeHTML(l.texto)}</small>
            <div class="iconf-campos">
                <select data-k="produto" class="iconf-prod" aria-label="Produto">${opcoes(l)}</select>
                ${p ? `<input data-k="qtd" class="iconf-qtd" inputmode="decimal" value="${escapeHTML(txtQtd(it.qtd))}" aria-label="Quantidade">${medida}<b class="iconf-valor">${valor}</b>` : ''}
            </div>${avisos}</li>`;
    }
    function pintar() {
        const el = caixa(); if (!el || !C.linhas) return;
        const d = lerForm(), soma = somaDaConferencia(C.linhas);
        const conta = (n) => C.linhas.filter((l) => !l.pular && l.nivel === n).length, recados = C.linhas.filter((l) => l.pular && l.nivel === 'recado').length;
        const pag = el.querySelector('#iconf-pag')?.value ?? pagDoTexto(d.pagamento), nome = el.querySelector('#iconf-nome')?.value ?? d.nome;
        const totalTxt = `${fmt(soma.fechado)}${soma.estimado ? ` + ≈ ${fmt(soma.estimado)} a pesar` : ''}${soma.semValor ? ` + ${soma.semValor} ${soma.semValor === 1 ? 'item' : 'itens'} para pesar` : ''}`;
        el.hidden = false;
        el.innerHTML = `<div class="iconf-cab"><b>Conferir o pedido</b><span>${conta('ok')} certos${conta('duvida') ? ` · <em>${conta('duvida')} para conferir</em>` : ''}${recados ? ` · ${recados} recado${recados > 1 ? 's' : ''}` : ''}</span></div>
            <p class="iconf-dica">Os produtos mais parecidos aparecem primeiro na lista. Troque o que estiver errado. "Não registrar" tira a linha.</p>
            <ol class="iconf-lista">${C.linhas.map(linhaHtml).join('')}</ol>
            <div class="iconf-rodape">
                <div class="iconf-grade">
                    <div class="form-group"><label for="iconf-nome">Cliente</label><input id="iconf-nome" maxlength="80" value="${escapeHTML(nome || '')}" placeholder="Nome de quem pediu"></div>
                    <div class="form-group"><label for="iconf-pag">Pagamento</label><select id="iconf-pag"><option value=""${pag ? '' : ' selected'}>Escolha</option>${['PIX', 'Dinheiro', 'Cartão'].map((x) => `<option${x === pag ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
                </div>
                <p class="iconf-total"><span>Total</span><b>${totalTxt}</b></p>
                <div class="iconf-acoes"><button type="button" class="ipr-link" data-conf="cancelar">Agora não</button>
                <button type="button" class="btn iconf-bt" data-conf="registrar"${soma.itens && !C.enviando ? '' : ' disabled'}>${C.enviando ? 'Registrando...' : `Registrar pedido (${soma.itens} ${soma.itens === 1 ? 'item' : 'itens'})`}</button></div>
            </div>`;
    }
    // troca de produto, quantidade ou medida: refaz a conta da linha (mesma do servidor)
    function mudou(li, campo) {
        const l = C.linhas[Number(li.dataset.i)]; if (!l) return;
        const sel = li.querySelector('[data-k="produto"]').value;
        if (campo === 'produto') {
            if (!sel) { l.pular = true; pintar(); return; }
            const p = produto(sel); if (!p) return;
            l.pular = false; l.produto = { id: p.id, nome: p.nome };
            l.item = itemDoProduto({ qtd: l.item ? l.item.qtd : l.qtd, medida: l.item ? (l.item.tipo === 'kg' ? 'kg' : 'un') : l.medida }, p, { dia: hojeDow() });
        } else {
            const p = produto(sel); if (!p) return;
            const qtd = numero(li.querySelector('[data-k="qtd"]')?.value), tipo = li.querySelector('[data-k="tipo"]')?.value;
            l.item = itemDoProduto({ qtd: qtd ?? 1, medida: porPeso(p) ? (tipo === 'kg' ? 'kg' : 'un') : null }, p, { dia: hojeDow() });
            if (porPeso(p) && tipo === 'un' && !Number.isInteger(qtd ?? 1)) l.item = itemDoProduto({ qtd: Math.max(1, Math.round(qtd)), medida: 'un' }, p, { dia: hojeDow() });
        }
        l.avisos = l.item.avisos; l.nivel = l.avisos.some(serio) ? 'duvida' : 'ok';   // quem escolheu foi a banca: sem aviso sério, está certo
        if (campo === 'qtd') {           // digitando: só atualiza o valor e o total, sem redesenhar (o teclado não fecha)
            const it = l.item, v = li.querySelector('.iconf-valor');
            if (v) v.textContent = it.aPesar ? (it.valor != null ? `≈ ${fmt(it.valor)}` : 'a pesar') : fmt(it.valor || 0);
            const soma = somaDaConferencia(C.linhas), t = caixa().querySelector('.iconf-total b');
            if (t) t.textContent = `${fmt(soma.fechado)}${soma.estimado ? ` + ≈ ${fmt(soma.estimado)} a pesar` : ''}${soma.semValor ? ` + ${soma.semValor} ${soma.semValor === 1 ? 'item' : 'itens'} para pesar` : ''}`;
            return;
        }
        pintar();
    }

    async function registrar() {
        if (C.enviando || !C.linhas) return;
        const el = caixa(), d = lerForm();
        const nome = el.querySelector('#iconf-nome').value.trim(), pag = el.querySelector('#iconf-pag').value;
        if (!nome) { showToast('Escreva o nome do cliente.', true); el.querySelector('#iconf-nome').focus(); return; }
        if (!pag) { showToast('Escolha a forma de pagamento.', true); el.querySelector('#iconf-pag').focus(); return; }
        // o mesmo produto em duas linhas ("2 bananas" e, depois, "acrescentar 1 banana") vira uma linha só
        const juntos = new Map();
        for (const l of C.linhas) {
            if (l.pular || !l.produto || !l.item) continue;
            const k = `${l.produto.id}|${l.item.tipo}`, a = juntos.get(k);
            juntos.set(k, { id: l.produto.id, tipo: l.item.tipo, qtd: Math.round(((a ? a.qtd : 0) + l.item.qtd) * 1000) / 1000 });
        }
        if (!juntos.size) { showToast('Escolha pelo menos um produto.', true); return; }
        const recados = C.linhas.filter((l) => l.pular && l.nivel === 'recado').map((l) => l.texto);
        const obs = [d.obs, ...recados].map((x) => String(x || '').trim()).filter(Boolean).join(' · ').slice(0, 500);
        C.enviando = true; pintar();
        try {
            const token = await auth.currentUser?.getIdToken();
            const r = await fetch('/api/pdv', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ acao: 'mensagem', chave: C.chave, pag, cliente: { nome, telefone: d.telefone, endereco: d.endereco }, entrega: d.entrega, obs, itens: [...juntos.values()] }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || 'Não foi possível registrar o pedido.');
            showToast(`Pedido registrado: ${fmt(j.total)}${j.aPesar ? `, mais ${j.aPesar} ${j.aPesar === 1 ? 'item' : 'itens'} para pesar na Pesagem` : ''}.`);
            C.enviando = false; fechar(); depoisDeRegistrar && depoisDeRegistrar(j);
        } catch (e) {
            C.enviando = false; pintar();
            showToast(navigator.onLine ? e.message : 'Sem internet. O pedido não foi registrado: tente de novo quando voltar.', true);
        }
    }

    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-conf]'); if (!b || !caixa()?.contains(b)) return;
        if (b.dataset.conf === 'abrir') abrir();
        else if (b.dataset.conf === 'cancelar') oferecer();
        else if (b.dataset.conf === 'registrar') registrar();
    });
    document.addEventListener('change', (e) => { const li = e.target.closest?.('#ipr-conf .iconf-linha'); if (li && e.target.dataset.k) mudou(li, e.target.dataset.k === 'produto' ? 'produto' : 'outro'); });
    document.addEventListener('input', (e) => { const li = e.target.closest?.('#ipr-conf .iconf-linha'); if (li && e.target.dataset.k === 'qtd') mudou(li, 'qtd'); });

    return { oferecer, fechar, definirProdutos: (lista) => { C.produtos = Array.isArray(lista) ? lista : []; } };
}
