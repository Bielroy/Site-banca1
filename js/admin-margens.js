// =====================================================================
//  js/admin-margens.js — bloco "Custos e margens" dentro da aba Balanço.
//  Usa os MESMOS pedidos que o Balanço já carregou (nenhuma leitura a mais)
//  e o custo cadastrado em cada produto. Contas em margens-lib.js.
// =====================================================================
import { escapeHTML, fmt } from './utils.js';
import { resumoMargens } from './margens-lib.js';
import { fmtQtd } from './estoque-lib.js';
import { lucroDeHoje, analisarKits, simularPreco } from './alertas-lib.js';
import { lerPainel } from './painel-cache.js';
import { precoDoDia } from './oferta-lib.js';

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
    <div id="mg-hoje"></div>
    ${kitsHtml(produtos)}
    <div id="mg-simulador"></div>
    <p class="config-sub">O lucro é uma estimativa: usa o custo cadastrado hoje, não o do dia de cada venda, e não inclui despesas como embalagem, gás ou entrega.</p>`;
    preencherHoje(produtos);
}

// KITS: montar o kit (ficha técnica) × vender os mesmos itens soltos
function kitsHtml(produtos) {
    const ks = analisarKits(produtos); if (!ks.length) return '';
    return `<section class="mg-hoje mg-kits"><h4>Kits: vale a pena?</h4><ul>${ks.map((k) => {
        const dif = k.lucroKit - k.lucroSolto;
        const frase = dif >= 0 ? `o kit deixa ${fmt(dif)} a mais que vender os itens soltos`
            : k.empate != null ? `soltos deixam ${fmt(-dif)} a mais; o kit compensa se vender uns ${Math.round(k.empate * 100)}% a mais`
            : `soltos deixam ${fmt(-dif)} a mais e o kit não cobre o custo`;
        return `<li><span>${escapeHTML(k.nome)}<small>kit ${fmt(k.preco)} · soltos ${fmt(k.separado)} (cliente economiza ${fmt(k.desconto)}) · ${frase}</small></span><b class="${dif >= 0 ? '' : 'mg-neg'}">${fmt(k.lucroKit)}</b></li>`;
    }).join('')}</ul><p class="config-sub">Lucro por kit, pelo custo cadastrado dos itens. Kit também ajuda a vender o que está sobrando: aí o lucro de verdade é maior que esta conta.</p></section>`;
}

// SIMULADOR DE PREÇO: escolhe um produto e vê a venda e o lucro da semana em preços diferentes
function montarSimulador(produtos, j) {
    const caixa = document.getElementById('mg-simulador'); if (!caixa || !j || !j.produtos) return;
    const vende = {};
    for (const [id, p] of Object.entries(j.produtos)) { const h = p.horizontes && p.horizontes.prox7; if (h && h.previsto > 0) vende[id] = h.previsto; }
    const ops = (produtos || []).filter((p) => p.ativo !== false && Number(p.custo) > 0 && Number(p.preco) > 0 && vende[p.id]).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    if (!ops.length) return;
    const f = j.meta && j.meta.fatores && j.meta.fatores.preco, e = f && f.elasticidade > 0 ? f.elasticidade : 1, medido = f && f.n ? `medida em ${f.n} dia(s) de preço diferente na loja` : 'valor de partida: a loja ainda não teve oferta para medir';
    caixa.innerHTML = `<section class="mg-hoje mg-sim"><h4>Simular preço</h4>
        <select id="mg-sim-prod" aria-label="Produto para simular">${ops.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.nome)}</option>`).join('')}</select>
        <div id="mg-sim-tab"></div>
        <p class="config-sub">Estimativa da venda da semana em cada preço (sensibilidade a preço ${String(Math.round(e * 100) / 100).replace('.', ',')}, ${medido}). Não muda nenhum preço: use para decidir e, se testar, o sistema aprende com o resultado.</p></section>`;
    const pintar = () => {
        const p = ops.find((x) => x.id === document.getElementById('mg-sim-prod').value); if (!p) return;
        const linhas = simularPreco({ preco: p.preco, custo: p.custo, vendeSemana: vende[p.id], elasticidade: e });
        document.getElementById('mg-sim-tab').innerHTML = `<ul>${linhas.map((l) => `<li${l.melhor ? ' class="mg-sim-melhor"' : ''}><span>${fmt(l.preco)}${l.variacao ? ` <small>${l.variacao > 0 ? '+' : ''}${Math.round(l.variacao * 100)}%</small>` : ' <small>preço atual</small>'}<small>vende perto de ${fmtQtd(l.vende, p.unidade)} na semana</small></span><b>${fmt(l.lucro)}</b></li>`).join('')}</ul>`;
    };
    document.getElementById('mg-sim-prod').addEventListener('change', pintar); pintar();
}

// CURVA ABC DE HOJE: previsão de venda de hoje (motor) × (preço de hoje − custo). Se o motor ainda não rodou, não mostra nada.
async function preencherHoje(produtos) {
    try {
        const j = await lerPainel(), caixa = document.getElementById('mg-hoje');
        if (!caixa || !j || !j.produtos) return;
        montarSimulador(produtos, j);
        const prev = {};
        for (const [id, p] of Object.entries(j.produtos)) { const h = p.horizontes && p.horizontes.hoje; if (h && h.previsto > 0) prev[id] = h.previsto; }
        const dow = new Date(Date.now() - 3 * 3600000).getUTCDay();
        const r = lucroDeHoje({ produtos, previsaoHoje: prev, precoDe: (p) => precoDoDia(p, dow) });
        if (!r.linhas.length) return;
        const top = r.linhas.filter((l) => l.classe === 'A').slice(0, 8);
        caixa.innerHTML = `<section class="mg-hoje"><h4>Hoje, quem mais deve dar lucro <small>cerca de ${fmt(r.total)} previstos</small></h4>
            <ul>${top.map((l) => `<li><span>${escapeHTML(l.nome)}<small>vende perto de ${fmtQtd(l.qtd, l.unidade)} · margem ${pct(l.margem)}</small></span><b>${fmt(l.lucro)}</b></li>`).join('')}</ul>
            <p class="config-sub">Estes ${top.length} produto(s) somam 80% do lucro previsto para hoje: capriche na exposição e não deixe faltar.${r.semCusto ? ` ${r.semCusto} produto(s) com venda prevista estão sem custo cadastrado e ficaram de fora.` : ''}</p></section>`;
    } catch (_) { /* sem previsão: o resto da aba segue igual */ }
}
