// =====================================================================
//  js/admin-resumo.js — aba "Resumo" do painel (etapa 3 do design system).
//
//  O dia num relance, pensado para o celular: quanto vendeu, quantos pedidos,
//  o que está acabando, atalhos grandes e os pedidos que esperam alguém.
//  É uma aba a mais: Produtos continua sendo a primeira tela do painel.
//
//  Leitura: UMA consulta dos pedidos dos últimos 7 dias quando a aba abre
//  (e no botão Atualizar). A lista "esperando você" vem da fila que o painel
//  já escuta, então se mexe sozinha sem gastar leitura.
//  Contas: js/resumo-lib.js (testadas). Estilos: css/admin-resumo.css.
// =====================================================================
import { getDocs, query, where, orderBy, limit } from './firebase.js';
import { tcol } from './tenant.js';
import { escapeHTML, fmt } from './utils.js';
import { estadoVazio } from './painel-ui.js';
import { resumoDoDia, produtosAcabando, pedidosEsperando, saudacao } from './resumo-lib.js';
import { hojeBR, DIAS_CURTOS, diaDaSemana } from './fechamento-lib.js';

const S = { pedidos: null, erro: false, produtos: [], fila: [], abas: [], nome: '', carregando: false, vez: 0 };
const el = () => document.getElementById('resumo-conteudo');
const aberta = () => document.getElementById('aba-resumo')?.classList.contains('active');
const LIMITE = 1500;

async function buscarPedidos() {
    const vez = ++S.vez;
    S.carregando = true;
    try {
        const desde = new Date(Date.now() - 8 * 86400000).toISOString();     // 7 dias do gráfico + folga do fuso
        const snap = await getDocs(query(tcol('pedidos'), where('data', '>=', desde), orderBy('data', 'desc'), limit(LIMITE)));
        if (vez !== S.vez) return;
        S.pedidos = snap.docs.map((d) => d.data()); S.erro = false;
    } catch (e) {
        console.error('[resumo]', e);
        if (vez === S.vez) S.erro = true;
    } finally {
        if (vez === S.vez) { S.carregando = false; pintar(); }
    }
}

// ---------- pedaços da tela ----------
const valor = (n) => fmt(n);   // já sai "R$ 1.284,00"
const cartaoNumero = (rotulo, grande, baixo) => `<div class="rs-num"><span class="rs-rot">${rotulo}</span><b class="rs-grande">${grande}</b>${baixo || ''}</div>`;

function comparacao(r) {
    if (r.variacao === null) return '<span class="rs-comp">Ontem não teve venda para comparar</span>';
    if (r.variacao === 0) return '<span class="rs-comp">Igual a ontem</span>';
    const sobe = r.variacao > 0;
    return `<span class="rs-comp ${sobe ? 'sobe' : 'desce'}"><i class="ic" data-i="${sobe ? 'sobe' : 'desce'}"></i>${Math.abs(r.variacao)}% ${sobe ? 'a mais' : 'a menos'} que ontem</span>`;
}

// gráfico de barras simples (SVG, sem biblioteca): 7 dias, hoje em destaque
function grafico(serie) {
    const pico = Math.max(...serie.map((s) => s.valor), 1), L = 300, A = 92, larg = L / serie.length;
    const barras = serie.map((s, i) => {
        const h = s.valor > 0 ? Math.max(4, Math.round((s.valor / pico) * (A - 20))) : 2;
        const x = i * larg + larg * 0.18, w = larg * 0.64, y = A - 18 - h;
        const nome = s.hoje ? 'Hoje' : DIAS_CURTOS[diaDaSemana(s.dia)];
        return `<g><title>${nome} (${s.dia.slice(8, 10)}/${s.dia.slice(5, 7)}): ${valor(s.valor)}, ${s.pedidos} pedido(s)</title>`
            + `<rect class="rs-barra${s.hoje ? ' hoje' : ''}" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="4"/>`
            + `<text class="rs-dia${s.hoje ? ' hoje' : ''}" x="${(x + w / 2).toFixed(1)}" y="${A - 3}" text-anchor="middle">${nome}</text></g>`;
    }).join('');
    const total = serie.reduce((t, s) => t + s.valor, 0);
    return `<figure class="rs-grafico"><figcaption><span>Últimos 7 dias</span><b>${valor(total)}</b></figcaption>`
        + `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Vendas dos últimos 7 dias, ${valor(total)} no total">${barras}</svg></figure>`;
}

function blocoAcabando(lista) {
    if (!lista.length) return '';
    const nomes = lista.slice(0, 3).map((x) => escapeHTML(x.nome)).join(' · ') + (lista.length > 3 ? ` e mais ${lista.length - 3}` : '');
    const zerados = lista.filter((x) => x.situacao === 'zerado').length;
    const titulo = lista.length === 1 ? (zerados ? '1 produto acabou' : '1 produto acabando') : `${lista.length} produtos ${zerados === lista.length ? 'acabaram' : 'acabando'}`;
    const destino = S.abas.includes('compras') ? 'compras' : S.abas.includes('estoque') ? 'estoque' : '';
    const corpo = `<i class="ic" data-i="alerta"></i><span><b>${titulo}</b><small>${nomes}</small></span>`;
    return destino
        ? `<button type="button" class="rs-alerta" data-ir-aba="${destino}" aria-label="${titulo}: ver em ${destino === 'compras' ? 'Compras' : 'Estoque'}">${corpo}<span class="rs-seta" aria-hidden="true">›</span></button>`
        : `<div class="rs-alerta">${corpo}</div>`;
}

// atalhos grandes: só os que o papel e os módulos da loja deixam abrir
function atalhos() {
    const lista = [
        S.abas.includes('produtos') && ['mais', 'Novo produto', 'data-action="novo-produto" data-rs-ir="produtos"'],
        S.abas.includes('relatorios') && ['pedidos', 'Pedidos', 'data-ir-aba="relatorios"'],
        S.abas.includes('pdv') && ['pdv', 'Balcão', 'data-ir-aba="pdv"'],
        S.abas.includes('fechamento') && ['fechamento', 'Fechar o dia', 'data-ir-aba="fechamento"'],
        S.abas.includes('balanco') && ['balanco', 'Balanço', 'data-ir-aba="balanco"'],
    ].filter(Boolean).slice(0, 4);
    if (!lista.length) return '';
    return `<nav class="rs-atalhos" aria-label="Atalhos">${lista.map(([icone, texto, attr]) => `<button type="button" class="rs-atalho" ${attr}><span class="rs-atalho-ico"><i class="ic" data-i="${icone}"></i></span><span>${texto}</span></button>`).join('')}</nav>`;
}

function onde(p) {
    if (p.condominio || p.quadra) return [p.condominio, p.quadra && `Qd ${p.quadra}`, p.lote && `Lt ${p.lote}`].filter(Boolean).join(' · ');
    if (p.modo === 'retirada') return p.feiraId ? 'Retirada na feira' : 'Retirada';
    return p.origem === 'balcao' ? 'Balcão' : '';
}
function blocoEsperando() {
    if (!S.abas.includes('relatorios')) return '';
    const lista = pedidosEsperando(S.fila);
    const titulo = `<h3 class="rs-tit">Pedidos esperando você${lista.length ? ` <span class="rs-conta">${lista.length}</span>` : ''}</h3>`;
    if (!lista.length) return titulo + estadoVazio({ icone: 'certo', titulo: 'Ninguém esperando', texto: 'Quando chegar pedido novo, ele aparece aqui e o celular apita.', compacto: true });
    const cartoes = lista.slice(0, 4).map((p) => {
        const itens = (p.itens || []).map((i) => i && i.nome).filter(Boolean);
        const resumoItens = itens.slice(0, 2).join(', ') + (itens.length > 2 ? ` +${itens.length - 2}` : '');
        const lugar = onde(p), pesar = p.status === 'aguardando_pesagem';
        return `<article class="rs-ped"><div class="rs-ped-topo"><b>${escapeHTML(p.nome || 'Cliente')}${lugar ? ` <span>· ${escapeHTML(lugar)}</span>` : ''}</b><b class="rs-ped-valor">${valor(Number(p.total) || 0)}</b></div>`
            + `<p>${escapeHTML(resumoItens || 'Sem itens')}</p>`
            + `<div class="rs-ped-pe"><span class="pn-pil ${pesar ? 'aviso' : 'atencao'}">${pesar ? 'Para pesar' : 'Novo'}</span><button type="button" class="btn btn-primary" data-ir-aba="relatorios">Abrir na fila</button></div></article>`;
    }).join('');
    const mais = lista.length > 4 ? `<button type="button" class="rs-ver-todos" data-ir-aba="relatorios">Ver os ${lista.length} pedidos</button>` : '';
    return titulo + `<div class="rs-peds">${cartoes}</div>` + mais;
}

function pintar() {
    const alvo = el(); if (!alvo) return;
    const topo = `<header class="rs-topo"><div><span class="rs-ola">${saudacao()}${S.nome ? `, ${escapeHTML(S.nome)}` : ''}</span><h2 class="rs-titulo">Hoje na banca</h2></div>`
        + `<button type="button" class="bt bt-sec rs-atualizar" id="rs-atualizar"${S.carregando ? ' disabled' : ''}><i class="ic" data-i="repetir"></i> ${S.carregando ? 'Atualizando' : 'Atualizar'}</button></header>`;
    let numeros;
    if (S.erro && !S.pedidos) {
        numeros = estadoVazio({ erro: true, titulo: 'Não consegui somar as vendas', texto: 'Confira a internet e toque em Atualizar.', compacto: true });
    } else if (!S.pedidos) {
        numeros = `<div class="rs-nums" aria-busy="true"><div class="rs-num rs-esq"></div><div class="rs-num rs-esq"></div></div><div class="rs-grafico rs-esq rs-esq-graf"></div><span class="pn-oculto" role="status">Somando as vendas de hoje...</span>`;
    } else {
        const r = resumoDoDia(S.pedidos, hojeBR());
        const esperando = pedidosEsperando(S.fila).length;
        numeros = `<div class="rs-nums">${cartaoNumero('Vendido hoje', valor(r.vendido), comparacao(r))}`
            + cartaoNumero('Pedidos hoje', String(r.pedidos), esperando ? `<span class="pn-pil atencao">${esperando} esperando</span>` : (r.ticket ? `<span class="rs-comp">Média de ${valor(r.ticket)}</span>` : '<span class="rs-comp">Nenhum esperando</span>'))
            + `</div>${grafico(r.serie)}`
            + (S.pedidos.length >= LIMITE ? `<p class="rs-nota">Muitos pedidos nesta semana: a conta usa os ${LIMITE} mais recentes. O número exato está no Balanço.</p>` : '');
    }
    alvo.innerHTML = topo + numeros + blocoAcabando(produtosAcabando(S.produtos)) + atalhos() + blocoEsperando();
}

/** Abre a aba. `abas` = as abas que este papel pode abrir (os atalhos respeitam). */
export function abrirResumo({ produtos = [], fila = [], abas = [], nome = '' } = {}) {
    Object.assign(S, { produtos, fila, abas, nome: String(nome || '').trim().split(/\s+/)[0].slice(0, 24) });
    pintar();
    buscarPedidos();
}

/** A fila mudou (pedido chegou, foi aceito...): redesenha sem buscar de novo. */
export function atualizarResumo({ produtos, fila } = {}) {
    if (produtos) S.produtos = produtos;
    if (fila) S.fila = fila;
    if (aberta()) pintar();
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        if (e.target.closest('#rs-atualizar') && !S.carregando) { buscarPedidos(); pintar(); }
        // "Novo produto": abre o cadastro (data-action, no painel) e deixa a aba Produtos por trás
        const ir = e.target.closest('[data-rs-ir]');
        if (ir) document.querySelector(`.tab[data-aba="${ir.dataset.rsIr}"]`)?.click();
    });
}
