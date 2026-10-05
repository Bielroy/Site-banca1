// =====================================================================
//  js/estoque-lib.js — regras PURAS do estoque (sem tela, sem Firebase),
//  separadas para poderem ser testadas (testes/index.js).
// =====================================================================
export const temControle = (v) => v !== null && v !== undefined && v !== '';
const num = (v) => (temControle(v) && Number.isFinite(Number(v)) ? Number(v) : null);
const ehPeso = (un) => ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'].includes(String(un || '').toLowerCase());

/** Situação do produto: 'sem-controle' | 'zerado' | 'baixo' | 'ok' | 'sobrando' */
export function situacao(p) {
    const atual = num(p.estoqueFisico), min = num(p.estoqueMin), max = num(p.estoqueMax);
    if (atual === null) return 'sem-controle';
    if (atual <= 0) return 'zerado';
    if (min !== null && atual < min) return 'baixo';
    if (max !== null && atual > max) return 'sobrando';
    return 'ok';
}

/**
 * Quanto comprar.
 *   atual, min, ideal → do cadastro do produto
 *   previsto          → estoque que o motor de demanda sugere para os próximos 7 dias (opcional)
 *
 * Regra:
 *   1. Só sugere compra se o estoque está abaixo do mínimo OU abaixo do que o motor prevê vender.
 *   2. Compra até o "ideal". Se o motor prevê MAIS que o ideal, compra até o previsto.
 *   3. Arredonda para cima: de meio em meio quilo, ou unidade inteira.
 * Ex.: tem 11 kg, mínimo 15, ideal 35 → comprar 24 kg.
 */
export function sugestaoCompra({ atual, min, ideal, previsto, unidade }) {
    const a = num(atual); if (a === null) return { comprar: 0, motivo: '' };
    const mi = num(min), id = num(ideal), pv = num(previsto);
    const abaixoMin = mi !== null && a < mi, abaixoPrev = pv !== null && a < pv;
    if (!abaixoMin && !abaixoPrev) return { comprar: 0, motivo: '' };
    let alvo = id !== null ? id : (mi !== null ? mi : 0), motivo = id !== null ? 'até o ideal' : 'até o mínimo';
    if (pv !== null && pv > alvo) { alvo = pv; motivo = 'pela previsão de venda'; }
    const passo = ehPeso(unidade) ? 0.5 : 1;
    const comprar = Math.max(0, Math.ceil((alvo - a) / passo - 1e-9) * passo);
    return { comprar, motivo, alvo };
}

// A unidade vem do cadastro e vai parar dentro de HTML: caracteres de marcação são retirados aqui, uma vez só.
export const fmtQtd = (q, un) => `${String(Math.round(Number(q) * 1000) / 1000).replace('.', ',')} ${String(un || 'un').replace(/[<>&"'`]/g, '').slice(0, 12)}`;

export const ROTULO_TIPO = { entrada: 'Entrada', compra: 'Compra', perda: 'Perda', saida: 'Saída', ajuste: 'Contagem', venda: 'Venda', cancelamento: 'Pedido cancelado', producao: 'Produção' };
export const MOTIVOS_PERDA = [['maturacao', 'Passou do ponto'], ['vencimento', 'Venceu'], ['dano', 'Amassou ou estragou'], ['producao', 'Perda na produção'], ['erro', 'Erro de contagem ou pedido'], ['devolucao', 'Devolução'], ['outro', 'Outro']];

// ---------------------------------------------------------------------
// FICHA TÉCNICA — produto.ficha = { rende, validadeDias, itens: [{ id, qtd }] }
// Mesma conta de lib/estoque.js (servidor). Se mudar uma, mude a outra.
// `produtos` = Map(id → produto)
// ---------------------------------------------------------------------
export function custoDaFicha(ficha, produtos) {
    const rende = Number(ficha && ficha.rende), itens = (ficha && ficha.itens) || [];
    if (!(rende > 0) || !itens.length) return { valida: false };
    let total = 0, semCusto = 0;
    const linhas = itens.map((i) => {
        const p = produtos.get(String(i.id)) || null, qtd = Number(i.qtd), custo = p && Number(p.custo) > 0 ? Number(p.custo) : null;
        if (custo === null) semCusto++; else total += qtd * custo;
        return { id: String(i.id), nome: p ? p.nome : '(produto apagado)', unidade: p ? p.unidade : '', qtd, custo, existe: !!p };
    });
    if (linhas.some((l) => !(l.qtd > 0) || !l.existe)) return { valida: false, linhas };
    total = Math.round(total * 100) / 100;
    return { valida: true, rende, linhas, total, porUnidade: Math.round((total / rende) * 100) / 100, completo: semCusto === 0, semCusto };
}

/** Margem de um produto: { lucro (R$ por unidade), pct (0–1) } ou null sem custo/preço. */
export function margem(preco, custo) {
    const p = Number(preco), c = Number(custo);
    if (!(p > 0) || !(c > 0)) return null;
    return { lucro: Math.round((p - c) * 100) / 100, pct: (p - c) / p };
}

/** Receita escrita em g/ml → quantidade na unidade de estoque (kg/l). */
export const UNIDADES_RECEITA = { kg: [['kg', 1], ['g', 0.001]], l: [['l', 1], ['ml', 0.001]], litro: [['l', 1], ['ml', 0.001]] };
export const paraEstoque = (valor, fator) => Math.round(Number(valor) * fator * 100000) / 100000;

// ---------------------------------------------------------------------
// DESPERDÍCIO — a partir dos resumos mensais (estoque_resumo/{AAAA-MM}).
// taxa = perdeu ÷ entrou, somando os meses lidos. Só vale com entrada registrada.
// ---------------------------------------------------------------------
export function taxasDePerda(resumos) {
    const soma = {};
    for (const r of resumos || []) for (const [id, v] of Object.entries((r && r.p) || {})) {
        const s = (soma[id] = soma[id] || { entrou: 0, perdeu: 0, valor: 0 });
        s.entrou += Number(v.entrou) || 0; s.perdeu += Number(v.perdeu) || 0; s.valor += Number(v.perdeuValor) || 0;
    }
    const out = {};
    for (const [id, s] of Object.entries(soma)) if (s.perdeu > 0) out[id] = { taxa: s.entrou > 0 ? Math.min(1, s.perdeu / s.entrou) : null, perdeu: s.perdeu, valor: Math.round(s.valor * 100) / 100 };
    return out;
}
/** Compra com folga para o que costuma estragar: para SOBRAR x vendável, compra x ÷ (1 − taxa). Folga limitada a 30%. */
export function comFolgaDePerda(comprar, taxa, unidade) {
    const t = Math.min(0.3, Math.max(0, Number(taxa) || 0));
    if (!(comprar > 0) || t < 0.02) return comprar;
    const passo = ehPeso(unidade) ? 0.5 : 1;
    return Math.ceil((comprar / (1 - t)) / passo - 1e-9) * passo;
}

/** Arredonda uma quantidade de compra para cima: de meio em meio quilo/litro, ou unidade inteira. */
export const paraCima = (q, unidade) => { const passo = ehPeso(unidade) ? 0.5 : 1; return Math.max(0, Math.ceil(q / passo - 1e-9) * passo); };
