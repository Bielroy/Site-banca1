// =====================================================================
//  js/compras-lib.js — MONTA A LISTA DE COMPRAS (regra pura, testada).
//
//  Junta tudo o que o sistema já sabe:
//    estoque atual, mínimo e ideal ......... cadastro do produto (aba Estoque)
//    previsão de venda dos próximos 7 dias .. motor de demanda (dia da semana e sazonalidade já estão nela)
//    prazo do fornecedor ................... produto.prazoDias: soma a venda prevista enquanto a compra não chega
//    desperdício ........................... folga para o que costuma estragar
//    produção .............................. o que precisa ser PRODUZIDO puxa a compra dos ingredientes
//    fechamento da feira ................... produto sem estoque controlado marcado "Não tem"
//
//  Devolve { comprar, produzir, conferir, total }.
// =====================================================================
import { temControle, sugestaoCompra, comFolgaDePerda, custoDaFicha, paraCima } from './estoque-lib.js';

const r2 = (n) => Math.round(n * 100) / 100, r3 = (n) => Math.round(n * 1000) / 1000;

export function listaDeCompras({ produtos, previsto = {}, perdas = {}, acabou = [] }) {
    const mapa = new Map(produtos.map((p) => [p.id, p]));
    const alvoPrevisto = (p) => {
        const pv = previsto[p.id]; if (!pv) return null;
        const prazo = Number(p.prazoDias) > 0 ? Math.min(30, Number(p.prazoDias)) : 0;
        return r3(pv.alvo + (Number(pv.vende) || 0) / 7 * prazo);
    };

    // 1) O que produzir — e quanto de cada ingrediente isso vai consumir
    const produzir = [], uso = new Map();
    for (const p of produtos) {
        if (!p.ficha || !temControle(p.estoqueFisico)) continue;
        const f = custoDaFicha(p.ficha, mapa); if (!f.valida) continue;
        const s = sugestaoCompra({ atual: p.estoqueFisico, min: p.estoqueMin, ideal: p.estoqueIdeal, previsto: alvoPrevisto(p), unidade: 'un' });
        const unidades = Math.ceil(s.comprar - 1e-9); if (!(unidades > 0)) continue;
        produzir.push({ id: p.id, nome: p.nome, unidade: p.unidade || 'un', qtd: unidades, motivo: s.motivo, custo: f.completo ? r2(f.porUnidade * unidades) : null });
        for (const l of f.linhas) uso.set(l.id, r3((uso.get(l.id) || 0) + l.qtd * unidades / f.rende));
    }

    // 2) O que comprar
    const comprar = [], conferir = [], semEstoque = new Set(acabou);
    for (const p of produtos) {
        if (p.ficha && custoDaFicha(p.ficha, mapa).valida) continue;            // produzido aqui: não se compra
        const paraProducao = uso.get(p.id) || 0, custo = Number(p.custo) > 0 ? Number(p.custo) : null;
        const linha = (qtd, motivo) => ({ id: p.id, nome: p.nome, unidade: p.unidade || 'un', qtd, motivo, custoUnit: custo, custo: custo ? r2(qtd * custo) : null, paraProducao });
        if (!temControle(p.estoqueFisico)) {
            if (paraProducao > 0) comprar.push(linha(paraCima(paraProducao, p.unidade), 'para a produção (produto sem estoque controlado)'));
            else if (semEstoque.has(p.id)) conferir.push({ id: p.id, nome: p.nome, unidade: p.unidade || 'un', qtd: previsto[p.id] ? paraCima(previsto[p.id].alvo, p.unidade) : null });
            continue;
        }
        const sobra = r3(Number(p.estoqueFisico) - paraProducao);               // o que resta depois de separar o da produção
        const s = sugestaoCompra({ atual: sobra, min: p.estoqueMin, ideal: p.estoqueIdeal, previsto: alvoPrevisto(p), unidade: p.unidade });
        let qtd = s.comprar, motivo = s.motivo;
        if (sobra < 0 && qtd < -sobra) { qtd = paraCima(-sobra, p.unidade); motivo = 'para a produção'; }
        if (!(qtd > 0)) continue;
        const taxa = perdas[p.id] && perdas[p.id].taxa;
        if (taxa) { const f = comFolgaDePerda(qtd, taxa, p.unidade); if (f > qtd) { qtd = f; motivo += ', com folga para a perda'; } }
        if (paraProducao > 0 && motivo !== 'para a produção') motivo += ', inclui a produção';
        comprar.push(linha(qtd, motivo));
    }
    const ordem = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    comprar.sort(ordem); produzir.sort(ordem); conferir.sort(ordem);
    const comCusto = comprar.filter((l) => l.custo !== null);
    return { comprar, produzir, conferir, total: comCusto.length ? r2(comCusto.reduce((s, l) => s + l.custo, 0)) : null, semCusto: comprar.length - comCusto.length };
}

/** Texto da lista para mandar no WhatsApp ou colar em qualquer lugar. */
export function textoDaLista(lista, quando, fmtQtd) {
    const L = [`*COMPRAR* (${quando})`, ''];
    if (!lista.comprar.length) L.push('Nada para comprar.');
    lista.comprar.forEach((l) => L.push(`☐ ${l.nome}: ${fmtQtd(l.qtd, l.unidade)}`));
    if (lista.conferir.length) { L.push('', '*Conferir (acabou no fechamento)*'); lista.conferir.forEach((l) => L.push(`☐ ${l.nome}${l.qtd ? `: ${fmtQtd(l.qtd, l.unidade)}` : ''}`)); }
    if (lista.produzir.length) { L.push('', '*Produzir*'); lista.produzir.forEach((l) => L.push(`• ${l.nome}: ${l.qtd} un`)); }
    return L.join('\n');
}
