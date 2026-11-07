// =====================================================================
//  js/cadastro-lib.js — regras puras do CADASTRO DE PRODUTO (testadas).
//
//  1. Campos que cada loja vê no formulário. Cada banca tem seu jeito:
//     "quanto tempo dura na banca" faz sentido na feira, não na pastelaria.
//     A plataforma liga e desliga por loja (ficha.campos); o que não foi
//     mexido segue o padrão do tipo de negócio.
//     O servidor tem a mesma lista em lib/campos.js (um teste confere).
//
//  2. "Vários de uma vez": um nome por linha, com o mesmo preço, a mesma
//     unidade e a mesma categoria. Preço diferente vai depois de um traço:
//         Pastel de carne
//         Pastel especial - 18
// =====================================================================

/** Campos opcionais do formulário (o essencial — nome, preço, unidade, categoria, foto — sempre aparece). */
export const CAMPOS_PRODUTO = {
    oferta: 'Preço de oferta (riscado)',
    estoque: 'Quantidade em estoque',
    pacote: 'Pacote fechado e "leve X por R$"',
    pesoMedio: 'Peso médio da unidade (produto por quilo)',
    selos: 'Selos (Chegou hoje, Da estação, Escolha da casa)',
    descricao: 'Descrição',
    insumo: 'Só ingrediente (fora da loja)',
    duracao: 'Quanto tempo dura na banca',
    rotulo: 'Rótulo adesivo',
    montar: 'Montar pedido (complementos e adicionais)',
    dias: 'Dias da semana em que o produto sai',
    palavras: 'Outras palavras para a busca',
};

// Tipos de negócio de feira/hortifrúti: lá tudo vem ligado. Nos outros, o que é de hortifrúti começa desligado.
const DE_FEIRA = ['', 'hortifruti', 'feira', 'hortifrúti', 'sacolao', 'sacolão', 'verdurao', 'verdurão'];
const SO_DE_FEIRA = ['duracao', 'pesoMedio'];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Ligado/desligado de cada campo. O que a plataforma marcou vale; o resto segue o tipo de negócio. */
export function camposDaLoja(ficha, original = false) {
    const f = ficha && typeof ficha === 'object' ? ficha : {};
    const marcados = f.campos && typeof f.campos === 'object' && !Array.isArray(f.campos) ? f.campos : {};
    const feira = original || DE_FEIRA.includes(norm(f.tipo));
    const r = {};
    for (const k of Object.keys(CAMPOS_PRODUTO)) r[k] = typeof marcados[k] === 'boolean' ? marcados[k] : (feira || !SO_DE_FEIRA.includes(k));
    return r;
}

// ---------------------------------------------------------------------
// VÁRIOS DE UMA VEZ
// ---------------------------------------------------------------------
export const MAX_DE_UMA_VEZ = 60;

/** "15", "15,5", "R$ 15,50", "1.234,56" → número (ou NaN). */
export function lerPreco(t) {
    let s = String(t ?? '').replace(/r\$/gi, '').replace(/\s+/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(Number(s) * 100) / 100;
}

// preço no fim da linha: depois de traço, dois-pontos, igual, ponto e vírgula, barra, TAB ou "R$".
// "Açaí 500 ml" e "Pastel 4 queijos" continuam sendo nome.
const PRECO_NO_FIM = /^(.*?)\s*(?:[-–—:=;|\t]\s*(?:r\$\s*)?|r\$\s*)(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais)?\s*$/i;

/**
 * Lê o texto colado (um produto por linha).
 * `existentes` = nomes já cadastrados (não cria de novo).
 * Devolve [{ nome, preco, aviso }] na ordem; `aviso` diz por que a linha NÃO será criada.
 */
export function lerLista(texto, precoPadrao, existentes = []) {
    const ja = new Set((existentes || []).map(norm));
    const vistos = new Set();
    const padrao = typeof precoPadrao === 'number' ? precoPadrao : lerPreco(precoPadrao);
    const linhas = String(texto || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    return linhas.slice(0, MAX_DE_UMA_VEZ).map((linha) => {
        let nome = linha, preco = padrao;
        const m = linha.match(PRECO_NO_FIM);
        if (m && m[1].trim()) { const p = lerPreco(m[2]); if (p > 0) { nome = m[1]; preco = p; } }
        nome = nome.replace(/\s+/g, ' ').trim().slice(0, 80);
        const k = norm(nome);
        let aviso = '';
        if (nome.length < 2) aviso = 'nome curto demais';
        else if (ja.has(k)) aviso = 'já cadastrado';
        else if (vistos.has(k)) aviso = 'repetido na lista';
        else if (!(preco > 0)) aviso = 'sem preço';
        vistos.add(k);
        return { nome, preco: preco > 0 ? preco : null, aviso };
    });
}

/** Quantas linhas passaram do limite (para avisar). */
export const linhasDemais = (texto) => Math.max(0, String(texto || '').split(/\r?\n/).filter((l) => l.trim()).length - MAX_DE_UMA_VEZ);

// ---------------------------------------------------------------------
// PRODUTO NOVO JÁ COM A CARA DA LOJA
// Na pastelaria tudo é "unidade"; na feira, quase tudo é "quilo". O produto novo começa com a
// unidade mais usada na categoria escolhida (ou na loja inteira) em vez de sempre "quilo".
// ---------------------------------------------------------------------
const maisComum = (valores) => {
    const n = new Map(); let melhor = null, max = 0;
    for (const v of valores) { const c = (n.get(v) || 0) + 1; n.set(v, c); if (c > max) { max = c; melhor = v; } }
    return melhor;
};
const daCategoria = (produtos, cat) => (produtos || []).filter((p) => p && !p.soInsumo && (!cat || norm(p.cat) === norm(cat)));
/** Unidade mais usada na categoria (ou na loja, se a categoria não tem produto). Sem produto nenhum: 'kg'. */
export function unidadeMaisUsada(produtos, cat = '') {
    const un = (lista) => maisComum(lista.map((p) => String(p.unidade || '').trim()).filter(Boolean));
    return (cat && un(daCategoria(produtos, cat))) || un(daCategoria(produtos, '')) || 'kg';
}
/** Preço mais repetido na categoria (para a dica do campo de preço), ou null. */
export function precoMaisUsado(produtos, cat) {
    if (!cat) return null;
    return maisComum(daCategoria(produtos, cat).map((p) => Number(p.preco)).filter((v) => v > 0));
}
