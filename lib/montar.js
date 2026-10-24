'use strict';
// =====================================================================
//  lib/montar.js — MONTAR PEDIDO no servidor (açaí com complementos, pastel
//  com adicionais...). CÓPIA da conta de js/montar-lib.js: um teste confere
//  que as duas dão o mesmo resultado. A do servidor é a que vale: o navegador
//  manda só os ids escolhidos, nunca preço.
// =====================================================================

const MAX_GRUPOS = 6;
const MAX_OPCOES = 30;
const MAX_PRECO_C = 100000;            // R$ 1.000 por opção: acima disso é erro de digitação
const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const ID = /^[a-z0-9][a-z0-9_-]{0,23}$/;

const texto = (v, max) => Array.from(String(v == null ? '' : v).normalize('NFC').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
const inteiro = (v, min, max, padrao) => { const n = Number(v); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const centavos = (v) => { const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.min(MAX_PRECO_C, Math.round(n * 100)) : 0; };

/** "Leite condensado" → "leite-condensado" (id de grupo ou opção que não existe ainda). */
function idDe(nome, usados = new Set()) {
    let base = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'op';
    if (!/^[a-z0-9]/.test(base)) base = `o${base}`.slice(0, 20);
    let id = base, n = 2;
    while (usados.has(id)) id = `${base}-${n++}`.slice(0, 24);
    usados.add(id);
    return id;
}

/**
 * O "montar" do produto, conferido. O que não passa some. Devolve { grupos } ou null (produto sem montar).
 * Produto vendido por peso não tem montar (a balança decide o preço).
 */
function montarDoProduto(p) {
    if (!p || typeof p !== 'object' || FRACIONAVEIS.includes(String(p.unidade || '').toLowerCase())) return null;
    const bruto = p.montar && typeof p.montar === 'object' && Array.isArray(p.montar.grupos) ? p.montar.grupos : [];
    const gruposUsados = new Set(), grupos = [];
    for (const g of bruto.slice(0, MAX_GRUPOS)) {
        if (!g || typeof g !== 'object') continue;
        const nome = texto(g.nome, 40); if (!nome) continue;
        const id = typeof g.id === 'string' && ID.test(g.id) && !gruposUsados.has(g.id) ? g.id : idDe(nome, gruposUsados);
        gruposUsados.add(id);
        const opUsadas = new Set(), opcoes = [];
        for (const o of (Array.isArray(g.opcoes) ? g.opcoes : []).slice(0, MAX_OPCOES)) {
            if (!o || typeof o !== 'object') continue;
            const on = texto(o.nome, 40); if (!on) continue;
            const oid = typeof o.id === 'string' && ID.test(o.id) && !opUsadas.has(o.id) ? o.id : idDe(on, opUsadas);
            opUsadas.add(oid);
            opcoes.push({ id: oid, nome: on, preco: centavos(o.preco) / 100, ativo: o.ativo !== false });
        }
        if (!opcoes.length) continue;
        const max = inteiro(g.max, 1, opcoes.length, Math.min(opcoes.length, 1));
        const min = inteiro(g.min, 0, max, 0);
        const gratis = inteiro(g.gratis, 0, max, 0);
        grupos.push({ id, nome, min, max, gratis, opcoes });
    }
    return grupos.length ? { grupos } : null;
}

/** O produto se monta? (tem pelo menos um grupo com opção à venda) */
const temMontar = (p) => { const m = montarDoProduto(p); return !!m && m.grupos.some((g) => g.opcoes.some((o) => o.ativo)); };

/** Só o formato: { grupoId: [opcaoId...] } com ids válidos (para guardar e mandar). */
function limparOpcoes(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const [g, lista] of Object.entries(v).slice(0, MAX_GRUPOS)) {
        if (!ID.test(g) || !Array.isArray(lista)) continue;
        const ids = [...new Set(lista.filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, MAX_OPCOES);
        if (ids.length) out[g] = ids;
    }
    return out;
}

/** Assinatura das escolhas: duas linhas com a mesma assinatura são o MESMO item (somam a quantidade). */
function assinatura(montar, opcoes) {
    const o = limparOpcoes(opcoes);
    return (montar ? montar.grupos : []).map((g) => `${g.id}:${(o[g.id] || []).slice().sort().join(',')}`).join('|');
}

/** Quanto custam as escolhas de um grupo (centavos): as `gratis` mais caras saem de graça. */
function custoDoGrupoC(g, escolhidas) {
    const precos = escolhidas.map((o) => centavos(o.preco)).sort((a, b) => b - a);
    return precos.slice(g.gratis).reduce((t, c) => t + c, 0);
}

/**
 * Confere as escolhas do cliente contra o montar do produto.
 * Devolve { ok: true, extraC, escolhas: [{ grupo, opcoes: [nome...], extraC }], assinatura, opcoes }
 *      ou { ok: false, erro } (texto para o cliente).
 */
function conferirEscolha(montar, opcoes) {
    if (!montar) return { ok: true, extraC: 0, escolhas: [], assinatura: '', opcoes: {} };
    const o = limparOpcoes(opcoes), escolhas = [], limpas = {};
    let extraC = 0;
    for (const g of montar.grupos) {
        const ids = o[g.id] || [];
        const escolhidas = [];
        for (const id of ids) {
            const op = g.opcoes.find((x) => x.id === id);
            if (!op || !op.ativo) return { ok: false, erro: `uma opção de "${g.nome}" acabou. Escolha de novo.` };
            escolhidas.push(op);
        }
        if (escolhidas.length < g.min) return { ok: false, erro: g.min === 1 ? `escolha ${g.max === 1 ? 'uma opção' : 'pelo menos uma opção'} em "${g.nome}".` : `escolha pelo menos ${g.min} em "${g.nome}".` };
        if (escolhidas.length > g.max) return { ok: false, erro: `em "${g.nome}" vale até ${g.max}.` };
        const c = custoDoGrupoC(g, escolhidas);
        extraC += c;
        if (escolhidas.length) { escolhas.push({ grupo: g.nome, opcoes: escolhidas.map((x) => x.nome), extraC: c }); limpas[g.id] = escolhidas.map((x) => x.id); }
    }
    return { ok: true, extraC, escolhas, assinatura: assinatura(montar, limpas), opcoes: limpas };
}

/** "Complementos: granola, banana · Extras: Nutella" (sacola, pedido, WhatsApp, cupom). */
const textoDaEscolha = (escolhas) => (Array.isArray(escolhas) ? escolhas : [])
    .filter((e) => e && Array.isArray(e.opcoes) && e.opcoes.length)
    .map((e) => `${e.grupo}: ${e.opcoes.join(', ')}`).join(' · ');

/** O que o cliente lê embaixo do nome do grupo: "Escolha 1", "Escolha até 3 · 3 grátis", "Opcional". */
function regraDoGrupo(g) {
    if (!g) return '';
    let r = g.max === 1 ? (g.min === 1 ? 'Escolha 1' : 'Escolha até 1') : g.min > 0 && g.min === g.max ? `Escolha ${g.max}` : g.min > 0 ? `Escolha de ${g.min} a ${g.max}` : `Escolha até ${g.max}`;
    if (g.gratis > 0 && g.opcoes.some((o) => o.preco > 0)) r += ` · ${g.gratis === 1 ? '1 grátis' : `${g.gratis} grátis`}`;
    if (g.min === 0) r += ' · opcional';
    return r;
}

/** Preço de 1 unidade com as escolhas (reais). */
const precoMontado = (base, extraC) => Math.round(Math.round(Number(base) * 100) + (Number(extraC) || 0)) / 100;

/** Grupos prontos para o painel (o dono ajusta nomes e preços). */
const MODELOS_MONTAR = {
    acai: { nome: 'Açaí', grupos: [
        { nome: 'Complementos', min: 0, max: 4, gratis: 4, opcoes: [['Granola', 0], ['Leite em pó', 0], ['Banana', 0], ['Paçoca', 0], ['Leite condensado', 0], ['Morango', 0], ['Flocos de arroz', 0], ['Amendoim', 0]] },
        { nome: 'Adicionais', min: 0, max: 5, gratis: 0, opcoes: [['Nutella', 4], ['Creme de ninho', 3], ['Kiwi', 3], ['Bis', 3], ['Mel', 2]] },
    ] },
    pastel: { nome: 'Pastel', grupos: [
        { nome: 'Adicionais', min: 0, max: 4, gratis: 0, opcoes: [['Queijo extra', 4], ['Catupiry', 4], ['Cheddar', 4], ['Bacon', 5], ['Milho', 2], ['Azeitona', 2]] },
    ] },
    lanche: { nome: 'Lanche', grupos: [
        { nome: 'Ponto da carne', min: 1, max: 1, gratis: 0, opcoes: [['Mal passado', 0], ['Ao ponto', 0], ['Bem passado', 0]] },
        { nome: 'Adicionais', min: 0, max: 4, gratis: 0, opcoes: [['Bacon', 5], ['Ovo', 3], ['Queijo extra', 4], ['Cheddar', 4]] },
        { nome: 'Tirar', min: 0, max: 4, gratis: 0, opcoes: [['Sem cebola', 0], ['Sem tomate', 0], ['Sem alface', 0], ['Sem molho', 0]] },
    ] },
    cesta: { nome: 'Cesta / kit', grupos: [
        { nome: 'Escolha as frutas', min: 3, max: 3, gratis: 0, opcoes: [['Banana', 0], ['Maçã', 0], ['Laranja', 0], ['Mamão', 0], ['Manga', 0], ['Uva', 0]] },
    ] },
};

/** Um modelo vira grupos no formato do produto (ids gerados). */
function gruposDoModelo(chaveModelo) {
    const m = MODELOS_MONTAR[chaveModelo]; if (!m) return [];
    const usados = new Set();
    return m.grupos.map((g) => {
        const ops = new Set();
        return { id: idDe(g.nome, usados), nome: g.nome, min: g.min, max: g.max, gratis: g.gratis, opcoes: g.opcoes.map(([n, preco]) => ({ id: idDe(n, ops), nome: n, preco, ativo: true })) };
    });
}

/** Chave da linha na sacola: produto comum = o id; produto montado = id + escolhas (dois açaís diferentes = duas linhas). */
const chaveDaLinha = (item) => (item && item.linha) || (item && item.id != null ? String(item.id) : '');

/**
 * Uma linha de sacola de produto montado, a partir do produto de HOJE e das escolhas já conferidas
 * (conferirEscolha). O preço da linha = preço do produto + o das escolhas.
 */
function linhaMontada(p, conferido, qtd = 1) {
    return {
        ...p, qtd: Math.max(1, Math.round(Number(qtd) || 1)), tipo: 'un',
        opcoes: conferido.opcoes, escolhas: conferido.escolhas, adicionais: textoDaEscolha(conferido.escolhas),
        extraC: conferido.extraC, precoBase: p.preco, preco: precoMontado(p.preco, conferido.extraC),
        linha: `${p.id}~${conferido.assinatura}`,
    };
}

/** Item guardado (lista, pedido antigo, sacola da conta) → linha montada com o produto de hoje, ou null se não dá mais. */
function remontar(p, opcoes, qtd) {
    const m = montarDoProduto(p); if (!m) return null;
    const r = conferirEscolha(m, opcoes);
    return r.ok ? linhaMontada(p, r, qtd) : null;
}

module.exports = { MAX_GRUPOS, MAX_OPCOES, idDe, montarDoProduto, temMontar, limparOpcoes, assinatura, conferirEscolha, textoDaEscolha, regraDoGrupo, precoMontado, MODELOS_MONTAR, gruposDoModelo, chaveDaLinha, linhaMontada, remontar };
