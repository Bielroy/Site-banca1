// =====================================================================
//  js/admin-margens.js — bloco "Custos e margens" dentro da aba Balanço.
//  Usa os MESMOS pedidos que o Balanço já carregou (nenhuma leitura a mais)
//  e o custo cadastrado em cada produto. Contas em margens-lib.js.
// =====================================================================
import { escapeHTML, fmt } from './utils.js';
import { resumoMargens } from './margens-lib.js';
import { fmtQtd } from './estoque-lib.js';

const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const tabela = (titulo, dica, linhas, coluna) => `
    <section class="mg-bloco"><h4>${titulo}</h4>${dica ? `<p class="config-sub">${dica}</p>` : ''}
    ${linhas.length ? `<ul class="mg-lista">${linhas.map((l) => `<li><span>${escapeHTML(l.nome)}<small>vendeu ${fmtQtd(l.qtd, l.unidade)}</small></span>${coluna(l)}</li>`).join('')}</ul>` : '<p class="config-sub">Nada aqui neste período.</p>'}</section>`;

export function renderMargens(pedidos, produtos, dias) {
    const alvo = document.getElementById('margens-conteudo'); if (!alvo) return;
    const r = resumoMargens(pedidos, produtos);
    if (!r.nPedidos) { alvo.innerHTML = ''; return; }
    const semCustoAviso = r.coberturaCusto < 0.999
        ? `<p class="mg-aviso">${pct(1 - r.coberturaCusto)} do faturamento vem de produtos sem custo cadastrado, então o lucro abaixo cobre só o restante. Cadastre o custo na aba Estoque (botão Limites ou numa Entrada).</p>` : '';
    alvo.innerHTML = `
    <h3 class="mg-titulo">Custos e margens <small>últimos ${dias} dias</small></h3>
    ${semCustoAviso}
    <div class="mg-kpis">
        <div><span>Faturamento</span><strong>${fmt(r.faturamento)}</strong></div>
        <div><span>Lucro estimado</span><strong>${r.lucroEstimado == null ? '–' : fmt(r.lucroEstimado)}</strong><small>${r.margemGeral == null ? 'cadastre custos para ver' : `margem de ${pct(r.margemGeral)}`}</small></div>
        <div><span>Ticket médio</span><strong>${fmt(r.ticketMedio)}</strong><small>${r.nPedidos} pedido(s)</small></div>
    </div>
    <div class="mg-grade">
        ${tabela('Mais vendidos', 'Quem mais traz dinheiro para o caixa.', r.maisVendidos, (l) => `<b>${fmt(l.receita)}</b>`)}
        ${tabela('Mais lucrativos', 'Quem mais deixa dinheiro depois do custo. Nem sempre é o mais vendido.', r.maisLucrativos, (l) => `<b>${fmt(l.lucro)}<small>${pct(l.margem)}</small></b>`)}
        ${r.prejuizo.length ? tabela('Dando prejuízo', 'Vendidos abaixo do custo.', r.prejuizo, (l) => `<b class="mg-neg">${fmt(l.lucro)}<small>${pct(l.margem)}</small></b>`) : ''}
        ${r.baixaMargem.length ? tabela('Margem baixa', 'Menos de 20% de margem.', r.baixaMargem, (l) => `<b>${pct(l.margem)}<small>${fmt(l.lucro)}</small></b>`) : ''}
        ${r.semCusto.length ? tabela('Sem custo cadastrado', '', r.semCusto.slice(0, 8), (l) => `<b>${fmt(l.receita)}</b>`) : ''}
    </div>
    <p class="config-sub">O lucro é uma estimativa: usa o custo cadastrado hoje, não o do dia de cada venda, e não inclui despesas como embalagem, gás ou entrega.</p>`;
}
