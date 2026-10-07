// =====================================================================
//  js/margens-lib.js — CUSTOS E MARGENS a partir dos pedidos (regras puras, testadas).
//
//  Para cada produto vendido no período:
//    receita = o que o cliente pagou (subtotal do item no pedido)
//    custo   = quantidade vendida × custo atual do produto
//    lucro   = receita − custo     (estimado: usa o custo de HOJE, não o do dia da venda)
//  Item "a pesar" ainda sem peso fica de fora (não tem valor nem quantidade certa).
//  "Mais vendido" (receita) e "mais lucrativo" (lucro) são listas diferentes de propósito.
// =====================================================================
const r2 = (n) => Math.round(n * 100) / 100;
const FORA = new Set(['cancelado']);

export function resumoMargens(pedidos, produtos, { margemBaixa = 0.2 } = {}) {
    const cat = new Map((produtos || []).map((p) => [p.id, p]));
    const por = new Map();
    let faturamento = 0, nPedidos = 0, receitaComCusto = 0, custoTotal = 0;
    for (const ped of pedidos || []) {
        if (FORA.has(ped.status)) continue;
        nPedidos++; faturamento += Number(ped.total) || 0;
        for (const i of ped.itens || []) {
            const pesado = Number(i.pesoFinal) > 0;
            if (i.aPesar && !pesado) continue;
            const qtd = pesado ? Number(i.pesoFinal) : Number(i.qtd) || 0;                 // em unidade de estoque (kg quando foi pesado)
            const preco = Number(i.precoOriginal ?? i.preco) || 0;
            const receita = Number.isFinite(Number(i.subtotal)) && Number(i.subtotal) > 0 ? Number(i.subtotal) : qtd * preco;
            if (!(qtd > 0)) continue;
            const p = cat.get(i.id), custoUn = p && Number(p.custo) > 0 ? Number(p.custo) : null;
            const l = por.get(i.id) || { id: i.id, nome: (p && p.nome) || i.nome || 'Produto', unidade: (p && p.unidade) || i.unidade || 'un', qtd: 0, receita: 0, custo: 0, temCusto: custoUn !== null };
            l.qtd += qtd; l.receita += receita; if (custoUn !== null) l.custo += qtd * custoUn;
            por.set(i.id, l);
        }
    }
    const linhas = [...por.values()].map((l) => {
        const lucro = l.temCusto ? r2(l.receita - l.custo) : null;
        if (l.temCusto) { receitaComCusto += l.receita; custoTotal += l.custo; }
        return { ...l, qtd: Math.round(l.qtd * 1000) / 1000, receita: r2(l.receita), custo: r2(l.custo), lucro, margem: l.temCusto && l.receita > 0 ? (l.receita - l.custo) / l.receita : null };
    });
    const comCusto = linhas.filter((l) => l.temCusto);
    return {
        faturamento: r2(faturamento), nPedidos, ticketMedio: nPedidos ? r2(faturamento / nPedidos) : 0,
        lucroEstimado: comCusto.length ? r2(receitaComCusto - custoTotal) : null,
        margemGeral: receitaComCusto > 0 ? (receitaComCusto - custoTotal) / receitaComCusto : null,
        // contra a soma dos ITENS (o total do pedido inclui entrega e cupom, e fazia parecer que havia produto sem custo)
        coberturaCusto: linhas.length ? Math.min(1, receitaComCusto / Math.max(linhas.reduce((s, l) => s + l.receita, 0), 0.01)) : 0,      // quanto do faturamento tem custo cadastrado
        maisVendidos: [...linhas].sort((a, b) => b.receita - a.receita).slice(0, 8),
        maisLucrativos: [...comCusto].sort((a, b) => b.lucro - a.lucro).slice(0, 8),
        baixaMargem: comCusto.filter((l) => l.margem >= 0 && l.margem < margemBaixa).sort((a, b) => a.margem - b.margem),
        prejuizo: comCusto.filter((l) => l.margem < 0).sort((a, b) => a.lucro - b.lucro),
        semCusto: linhas.filter((l) => !l.temCusto).sort((a, b) => b.receita - a.receita),
    };
}
