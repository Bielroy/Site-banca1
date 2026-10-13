// =====================================================================
//  js/alertas-lib.js — ALERTAS DO PAINEL (regras puras, testadas).
//
//  1. SOBRA DE PERECÍVEL (aba Estoque): o estoque dá para mais dias do que o
//     produto aguenta. Folha aguenta uns 2 dias; fruta e legume uns 4. Também
//     conta como perecível o que já teve perda registrada. Sugere promoção antes
//     de o produto ficar feio.
//  2. LUCRO DE HOJE (aba Balanço): previsão de venda de hoje × (preço de hoje − custo).
//     Curva ABC do dia: A = os que somam 80% do lucro previsto, B = até 95%, C = o resto.
//  3. VENDA CRUZADA (Balcão): o que costuma ir junto com o que já está na venda.
// =====================================================================

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
const tem = (texto, lista) => { const t = ` ${semAcento(texto)} `; return lista.some((k) => t.includes(` ${k}`)); };
const FOLHAS = ['folha', 'alface', 'rucula', 'agriao', 'espinafre', 'couve ', 'acelga', 'almeirao', 'chicoria', 'salsa', 'cebolinha', 'coentro', 'hortela', 'manjericao', 'cheiro verde', 'verdura', 'hortalica'];
const FRESCOS = ['fruta', 'legume', 'banana', 'tomate', 'mamao', 'manga', 'morango', 'uva', 'abacate', 'pepino', 'abobrinha', 'berinjela', 'quiabo', 'vagem', 'pimentao', 'goiaba', 'pessego', 'caqui', 'figo', 'maracuja'];
const temControle = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const r2 = (n) => Math.round(n * 100) / 100;

/** Quantos dias o produto aguenta bonito, ou null quando não é perecível (ou não dá para saber). */
export function diasQueAguenta(p, teveP) {
    const txt = `${p && p.nome} ${p && p.cat}`;
    if (tem(txt, FOLHAS)) return 2;
    if (tem(txt, FRESCOS) || teveP) return 4;
    return null;
}

/** produtos do catálogo, previsto = { id: { vende (7 dias) } }, perdas = { id: {...} } → [{ id, nome, unidade, sobra, dias, aguenta, valor }] */
export function sobrasPereciveis({ produtos, previsto = {}, perdas = {} }) {
    const out = [];
    for (const p of produtos || []) {
        if (!p || p.ativo === false || !temControle(p.estoqueFisico)) continue;
        const est = Number(p.estoqueFisico), pv = previsto[p.id], porDia = pv && Number(pv.vende) > 0 ? Number(pv.vende) / 7 : 0;
        if (!(est > 0) || !(porDia > 0)) continue;
        const aguenta = diasQueAguenta(p, !!perdas[p.id]); if (!aguenta) continue;
        const dias = est / porDia;
        if (dias <= aguenta * 1.5) continue;                       // folga normal: não incomoda
        const sobra = est - porDia * aguenta;
        out.push({ id: p.id, nome: p.nome, unidade: p.unidade || 'un', sobra: Math.round(sobra * 100) / 100, dias: Math.round(dias), aguenta, valor: r2(sobra * (Number(p.preco) || 0)) });
    }
    return out.sort((a, b) => b.valor - a.valor || b.dias - a.dias).slice(0, 6);
}

/** produtos (com preço e custo), previsaoHoje = { id: quantidade }, precoDe = (p) → preço de hoje. */
export function lucroDeHoje({ produtos, previsaoHoje = {}, precoDe = (p) => Number(p.preco) }) {
    const linhas = [];
    let semCusto = 0;
    for (const p of produtos || []) {
        if (!p || p.ativo === false) continue;
        const q = Number(previsaoHoje[p.id]); if (!(q > 0)) continue;
        const custo = Number(p.custo), preco = Number(precoDe(p));
        if (!(custo > 0) || !(preco > 0)) { semCusto++; continue; }
        linhas.push({ id: p.id, nome: p.nome, unidade: p.unidade || 'un', qtd: q, margem: (preco - custo) / preco, lucro: r2(q * (preco - custo)) });
    }
    linhas.sort((a, b) => b.lucro - a.lucro);
    const total = linhas.reduce((s, l) => s + Math.max(0, l.lucro), 0);
    // a classe olha o acumulado ANTES do produto: quem cruza os 80% ainda é A (é ele que completa os 80%)
    let antes = 0;
    for (const l of linhas) {
        const fr = total ? antes / total : 0;
        l.classe = l.lucro <= 0 ? 'C' : fr < 0.8 ? 'A' : fr < 0.95 ? 'B' : 'C';
        antes += Math.max(0, l.lucro);
    }
    return { linhas, total: r2(total), semCusto };
}

/** juntos = meta.juntos do motor, naVenda = ids já na venda → até `max` ids sugeridos (os mais citados primeiro). */
export function sugestoesJuntos(juntos, naVenda, max = 3) {
    const ja = new Set(naVenda || []), conta = new Map();
    for (const id of ja) (juntos && juntos[id] || []).forEach((j, i) => { if (!ja.has(j)) conta.set(j, (conta.get(j) || 0) + (3 - Math.min(i, 2))); });
    return [...conta.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([id]) => id);
}
