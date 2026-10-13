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

// ---------------------------------------------------------------------
// 4. KITS (aba Balanço): kit montado com a ficha técnica × vender os mesmos itens soltos.
//    Só entra produto com unidade kit/bandeja (ou "kit", "cesta", "bandeja", "combo" no nome)
//    cujos ingredientes são vendidos soltos na loja e têm preço e custo.
// ---------------------------------------------------------------------
const EH_KIT = (p) => ['kit', 'bdj', 'bandeja', 'cesta'].includes(String(p.unidade || '').toLowerCase()) || / (kit|cesta|bandeja|combo) /.test(` ${semAcento(p.nome)} `);
export function analisarKits(produtos) {
    const mapa = new Map((produtos || []).map((p) => [String(p.id), p])), out = [];
    for (const k of produtos || []) {
        if (!k || k.ativo === false || !k.ficha || !EH_KIT(k) || !(Number(k.preco) > 0)) continue;
        const rende = Number(k.ficha.rende), itens = Array.isArray(k.ficha.itens) ? k.ficha.itens : [];
        if (!(rende > 0) || !itens.length) continue;
        let separado = 0, custo = 0, lucroSolto = 0, ok = true;
        for (const i of itens) {
            const p = mapa.get(String(i.id)), q = Number(i.qtd) / rende;
            if (!p || p.soInsumo || !(Number(p.preco) > 0) || !(Number(p.custo) > 0) || !(q > 0)) { ok = false; break; }
            separado += q * Number(p.preco); custo += q * Number(p.custo); lucroSolto += q * (Number(p.preco) - Number(p.custo));
        }
        if (!ok) continue;
        const lucroKit = Number(k.preco) - custo;
        // quanto o kit precisa vender A MAIS (em unidades) para deixar o mesmo lucro que os itens soltos
        const empate = lucroKit > 0 && lucroSolto > lucroKit ? lucroSolto / lucroKit - 1 : null;
        out.push({ id: k.id, nome: k.nome, preco: r2(Number(k.preco)), separado: r2(separado), desconto: r2(separado - Number(k.preco)), lucroKit: r2(lucroKit), lucroSolto: r2(lucroSolto), empate: empate == null ? null : Math.round(empate * 100) / 100 });
    }
    return out.sort((a, b) => (b.lucroKit - b.lucroSolto) - (a.lucroKit - a.lucroSolto));
}

// ---------------------------------------------------------------------
// 5. SIMULADOR DE PREÇO (aba Balanço): venda ≈ venda atual × (preço novo ÷ preço atual)^(−elasticidade).
//    A elasticidade vem do motor (medida nas ofertas da loja, ou o valor de partida 1).
//    É estimativa para conversar, nunca troca preço sozinho.
// ---------------------------------------------------------------------
export function simularPreco({ preco, custo, vendeSemana, elasticidade = 1, variacoes = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] }) {
    const p0 = Number(preco), c = Number(custo), q0 = Number(vendeSemana), e = Math.max(0, Math.min(4, Number(elasticidade) || 0));
    if (!(p0 > 0) || !(c >= 0) || !(q0 > 0)) return [];
    const linhas = variacoes.map((v) => {
        const p = Math.round(p0 * (1 + v) * 100) / 100, q = q0 * Math.pow(p / p0, -e);
        return { variacao: v, preco: p, vende: Math.round(q * 100) / 100, lucro: r2(q * (p - c)) };
    });
    const melhor = linhas.reduce((m, l) => (l.lucro > m.lucro ? l : m), linhas[0]);
    linhas.forEach((l) => { l.melhor = l === melhor; });
    return linhas;
}
