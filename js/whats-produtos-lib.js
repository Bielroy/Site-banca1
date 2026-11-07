// =====================================================================
//  js/whats-produtos-lib.js — o pedido que chegou por mensagem, casado com o CADASTRO da loja.
//
//  Cada linha do texto colado ("3 kilos batata", "2 alfaces *americana*", "hortela") vira:
//    • a quantidade e a medida (kg, grama, unidade, dúzia, pacote) que o cliente escreveu;
//    • o produto mais parecido do cadastro, aceitando erro de digitação e plural
//      ("mamao papaya" acha "Mamão papaia"), e os outros parecidos para trocar com um toque;
//    • o que vai para o sistema: por quilo com peso escrito = valor fechado; por quilo pedido
//      em unidades ("3 mangas") = fica "a pesar" (valor depois da balança, como no pedido da loja);
//      por unidade = preço × quantidade;
//    • as dúvidas, em palavras: "não sai hoje", "parecido com 2 produtos", "sem quantidade".
//  Linha que não parece item ("eu passo pegar às 18h") vira recado e não é registrada.
//
//  Puro (entra texto e produtos, sai lista): testado em testes/index.js com um pedido real.
//  A conta do valor é a mesma do servidor (centavos × quantidade, por item); quem grava é
//  /api/pdv (acao "mensagem"), que confere tudo de novo no cadastro.
// =====================================================================
import { precoDoDia } from './oferta-lib.js';
import { vendeNoDia } from './dias-lib.js';

const POR_PESO = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
export const porPeso = (p) => POR_PESO.includes(String((p && p.unidade) || '').toLowerCase());
const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cent = (v) => Math.round(Number(v) * 100);

const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, meio: 0.5, meia: 0.5 };
// medida escrita pelo cliente → tipo
const MEDIDAS = [
    [/^(?:kg|kgs|kilos?|quilos?|k)$/, 'kg'], [/^(?:g|gr|grs|gramas?)$/, 'g'],
    [/^(?:un|und|unds|unid|unids|unidades?)$/, 'un'], [/^(?:dz|duzias?)$/, 'duzia'],
    [/^(?:pct|pcts|pacotes?|pacotinhos?|bandejas?|cx|caixas?|caixinhas?|macos?|mao|molhos?|sacos?|saquinhos?|potes?)$/, 'pacote'],
];
const medidaDe = (palavra) => { const w = norm(palavra).replace(/\.$/, ''); for (const [re, m] of MEDIDAS) if (re.test(w)) return m; return null; };
// palavras de ligação (somem do texto do cliente e do nome do produto)
const LIGACAO = new Set(['de', 'da', 'do', 'das', 'dos', 'p', 'pra', 'pro', 'para', 'com', 'sem', 'e', 'a', 'o', 'as', 'os', 'um', 'uma', 'por', 'que', 'se']);
// jeito de falar do cliente (somem só do texto dele: "bem madura", "por favor", "se não tiver não mande")
const CONVERSA = new Set(['bem', 'tipo', 'aquela', 'aquele', 'nao', 'tiver', 'mandar', 'mande', 'manda', 'favor', 'pf', 'pfv', 'mais', 'tambem', 'grande', 'grandes', 'pequeno', 'pequena', 'pequenos', 'pequenas', 'medio', 'media', 'bonito', 'bonita', 'maduro', 'madura', 'maduros', 'maduras', 'docinha', 'docinho', 'bom', 'boa', 'bons', 'boas', 'fresco', 'fresca', 'usada', 'usado', 'quero', 'queria', 'ok']);

/** Palavras de busca: sem acento, sem pontuação, sem as de ligação, no singular simples. doCliente: tira também o jeito de falar. */
function palavras(s, { manterVazias = false, doCliente = false } = {}) {
    return norm(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
        .filter((w) => manterVazias || (!LIGACAO.has(w) && !(doCliente && CONVERSA.has(w)))).filter((w) => !/^\d+$/.test(w)).map(singular);
}
function singular(w) {
    if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -3) + 'ao';       // mamoes → mamao
    if (w.length > 4 && w.endsWith('aes')) return w.slice(0, -3) + 'ao';       // paes → pao
    if (w.length > 4 && /(r|z)es$/.test(w)) return w.slice(0, -2);             // alfaces? (não), flores → flor
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
}
/** Distância de edição (com troca de duas letras vizinhas contando como um erro). */
function distancia(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
}
/** Parecença entre duas palavras (0 a 1). Palavra curta só vale igual; erro de digitação vale quase inteiro. */
function parecida(a, b) {
    if (a === b) return 1;
    if (Math.min(a.length, b.length) < 4) return 0;
    if (a.length >= 5 && b.startsWith(a)) return 0.9;                            // "abaca" → "abacaxi"
    const maior = Math.max(a.length, b.length), r = 1 - distancia(a, b) / maior;
    return r >= (maior <= 5 ? 0.8 : 0.72) ? r : 0;                               // palavra curta: "jaca" não é "maca"
}
/**
 * Quanto o texto do cliente parece o nome do produto (0 a 1). A PRIMEIRA palavra do cliente é o produto
 * ("melão" em "melão doce") e pesa o dobro; o resto ("doce", "para suco") ajuda a escolher entre parecidos.
 * Palavra a mais no nome do cadastro ("Manga palmer") tira pouco.
 */
function nota(q, nome) {
    if (!q.length || !nome.length) return 0;
    const melhor = (w, lista) => Math.max(0, ...lista.map((x) => parecida(w, x)));
    const cobreNome = nome.reduce((s, w) => s + melhor(w, q), 0) / nome.length;
    const pesos = q.map((_, i) => (i === 0 ? 2 : 1)), soma = pesos.reduce((a, b) => a + b, 0);
    const cobreTexto = q.reduce((s, w, i) => s + pesos[i] * melhor(w, nome), 0) / soma;
    return 0.65 * cobreTexto + 0.35 * cobreNome;
}

/** Separa a quantidade e a medida do resto: "3 kilos batata" → { qtd: 3, medida: 'kg', resto: 'batata' }. */
export function lerQuantidade(texto) {
    let t = String(texto || '').trim(), qtd = null, medida = null;
    const num = (s) => { const w = norm(s).replace(',', '.'); if (/^\d+\/\d+$/.test(w)) { const [a, b] = w.split('/').map(Number); return b ? a / b : null; } if (/^\d+(\.\d+)?$/.test(w)) return Number(w); return NUMEROS[w] ?? null; };
    // começo: "3", "3kg", "1,5 kg", "meio quilo", "duas dúzias de", "1/2 kg"
    let m = /^(\d+(?:[.,]\d+)?|\d+\/\d+|[a-zA-ZÀ-ÿ]+)\s*([a-zA-ZÀ-ÿ.]+)?\s*(?:de\s+|d[ae]s?\s+)?(.*)$/.exec(t);
    if (m && num(m[1]) != null) {
        const md = m[2] ? medidaDe(m[2]) : null;
        qtd = num(m[1]); medida = md; t = (md ? m[3] : `${m[2] || ''} ${m[3]}`).trim();
        // "meio quilo de" sem número: já pegou; "1 kg e meio": raro, fica o 1
    } else {
        // fim: "batata 2kg", "tomate 500 g", "alface 2"
        m = /^(.*?)[\s,-]+(\d+(?:[.,]\d+)?)\s*([a-zA-ZÀ-ÿ.]+)?\s*$/.exec(t);
        if (m && (!m[3] || medidaDe(m[3]))) { qtd = num(m[2]); medida = m[3] ? medidaDe(m[3]) : null; t = m[1].trim(); }
    }
    if (medida === 'g' && qtd != null) { qtd = qtd / 1000; medida = 'kg'; }
    return { qtd: qtd != null && qtd > 0 && qtd <= 10000 ? qtd : null, medida, resto: t.replace(/^(?:de|da|do)\s+/i, '').trim() };
}

/**
 * Os produtos mais parecidos com o texto, do melhor para o pior (no máximo 4).
 * produtos = [{ id, nome, palavras?: [] }]
 */
export function parecidos(resto, produtos) {
    const q = palavras(String(resto || '').replace(/\([^)]*\)/g, ' '), { doCliente: true });   // o que está entre parênteses é recado ("aquela docinha")
    if (!q.length) return [];
    return (produtos || []).map((p) => {
        const n = nota(q, palavras(p.nome));
        const extra = Array.isArray(p.palavras) && p.palavras.length ? Math.max(0, ...p.palavras.map((w) => nota(q, palavras(w)))) * 0.95 : 0;
        return { p, nota: Math.round(Math.max(n, extra) * 1000) / 1000 };
    }).filter((x) => x.nota >= 0.4).sort((a, b) => b.nota - a.nota || String(a.p.nome).localeCompare(String(b.p.nome), 'pt-BR')).slice(0, 4);
}

/**
 * Uma linha + o produto escolhido → o que vai para o sistema.
 * Devolve { tipo: 'kg' | 'un', qtd, aPesar, valor (R$, ou null se só a balança diz), estimado, avisos[] }.
 */
export function itemDoProduto(linha, p, { dia } = {}) {
    const avisos = [], frac = porPeso(p), preco = precoDoDia(p, dia);
    let qtd = linha.qtd, medida = linha.medida, tipo, aPesar = false, valor = null, estimado = false;
    if (qtd == null) { qtd = 1; avisos.push('Sem quantidade: ficou 1'); }
    if (frac) {
        if (medida === 'kg' || !Number.isInteger(qtd)) { tipo = 'kg'; qtd = Math.round(qtd * 1000) / 1000; valor = Math.round(cent(preco) * qtd) / 100; }
        else {
            // por quilo, pedido em unidades ("3 mangas"): o valor sai na balança, como no pedido da loja
            tipo = 'un'; aPesar = true;
            const pm = Number(p.pesoMedio) || 0;
            if (pm > 0) { valor = Math.round(cent(preco) * (pm / 1000) * qtd) / 100; estimado = true; }
        }
    } else {
        tipo = 'un';
        if (medida === 'kg') avisos.push(`"${p.nome}" é vendido por ${p.unidade || 'unidade'}, não por quilo`);
        if (medida === 'duzia' && !/duzia|\bdz\b/.test(norm(`${p.nome} ${p.unidade}`))) qtd = qtd * 12;
        if (!Number.isInteger(qtd)) avisos.push(`Quantidade quebrada (${String(qtd).replace('.', ',')}): confira`);
        qtd = Math.max(1, Math.round(qtd));
        valor = Math.round(cent(preco) * qtd) / 100;
    }
    if (!(preco > 0)) avisos.push('Sem preço no cadastro');
    if (p.ativo === false) avisos.push('Está desligado na loja');
    if (Number.isInteger(dia) && !vendeNoDia(p, dia)) avisos.push('Não sai neste dia');
    if (p.estoqueFisico != null && p.estoqueFisico !== '' && Number(p.estoqueFisico) <= 0) avisos.push('Estoque zerado');
    return { tipo, qtd, aPesar, valor, estimado, preco, avisos };
}

/**
 * Texto colado (já separado em linhas por impressao-lib.linhasDoWhats) → a conferência.
 * produtos: todos os do cadastro que podem ser vendidos. dia: dia da semana do pedido (0 = domingo).
 * Cada linha: { texto, qtd, medida, candidatos, produto, nivel: 'ok'|'duvida'|'nada'|'recado', item, avisos }.
 */
export function conferirPedido(linhas, produtos, { dia } = {}) {
    const vendaveis = (produtos || []).filter((p) => p && p.id && p.nome && !p.soInsumo);
    return (linhas || []).map((texto) => {
        const lq = lerQuantidade(texto), candidatos = parecidos(lq.resto, vendaveis);
        const [a, b] = candidatos, linha = { texto, qtd: lq.qtd, medida: lq.medida, candidatos: candidatos.map((c) => ({ id: c.p.id, nome: c.p.nome, nota: c.nota })) };
        const longa = palavras(lq.resto.replace(/\([^)]*\)/g, ' '), { manterVazias: true }).length > 7;
        if (!a || a.nota < 0.55 || (longa && lq.qtd == null && a.nota < 0.8)) {
            // sem número e sem produto parecido: é recado ("eu passo pegar às 18h"), não item
            return { ...linha, produto: null, nivel: lq.qtd == null ? 'recado' : 'nada', item: null, avisos: lq.qtd == null ? [] : ['Não achei este produto no cadastro'] };
        }
        const item = itemDoProduto(lq, a.p, { dia }), avisos = [...item.avisos];
        const empate = b && a.nota - b.nota < 0.12;
        if (empate) avisos.unshift(`Parecido com ${candidatos.filter((c) => a.nota - c.nota < 0.12).length} produtos: confira`);
        if (/\se\s+\d/.test(norm(lq.resto))) avisos.unshift('Parece ter mais de um item nesta linha');
        // "Sem quantidade: ficou 1" é só um lembrete (hortelã, salsinha): não vira dúvida sozinho
        const serios = avisos.filter((x) => !x.startsWith('Sem quantidade'));
        const nivel = a.nota >= 0.6 && !empate && !serios.length ? 'ok' : 'duvida';
        return { ...linha, produto: { id: a.p.id, nome: a.p.nome }, nivel, item, avisos };
    });
}

/** Soma da conferência: valor fechado, estimado e quantos itens ficam para a balança. */
export function somaDaConferencia(conf) {
    let fechadoC = 0, estimadoC = 0, aPesar = 0, semValor = 0, itens = 0;
    for (const l of conf || []) {
        if (!l.produto || !l.item || l.pular) continue;
        itens++;
        if (l.item.aPesar) { aPesar++; if (l.item.valor != null) estimadoC += cent(l.item.valor); else semValor++; }
        else fechadoC += cent(l.item.valor || 0);
    }
    return { itens, fechado: fechadoC / 100, estimado: estimadoC / 100, aPesar, semValor };
}
