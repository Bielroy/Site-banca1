// =====================================================================
//  js/oferta-lib.js — OFERTA: produto com "preço antigo" maior que o preço.
//  O preço que vale continua sendo `preco` (é o que o servidor cobra);
//  `precoDe` é só o valor riscado que aparece para a cliente.
//  Arquivo puro, para os testes poderem conferir.
// =====================================================================

/** Este produto está em oferta? Só vale se o preço antigo for de verdade maior que o atual. */
export const emOferta = (p) => !!p && Number(p.preco) > 0 && Number(p.precoDe) > Number(p.preco);

/** Desconto em % inteiros (0 quando não há oferta). Arredonda para baixo: nunca promete mais do que dá. */
export const desconto = (p) => (emOferta(p) ? Math.floor(((Number(p.precoDe) - Number(p.preco)) / Number(p.precoDe)) * 100 + 1e-9) : 0);   // + 1e-9: 20% certinho não pode virar 19 por arredondamento da máquina

/** O que o painel grava: número com 2 casas, ou null quando não é oferta (vazio, igual ou menor que o preço). */
export function precoDeValido(precoDe, preco) {
    const de = Math.round(Number(String(precoDe == null ? '' : precoDe).replace(',', '.')) * 100) / 100;
    return Number.isFinite(de) && de > Number(preco) && de < 100000 ? de : null;
}

/** As ofertas da vitrine, da maior para a menor, no máximo `max`. */
export const ofertasDe = (produtos, max = 12) => (produtos || []).filter(emOferta).sort((a, b) => desconto(b) - desconto(a)).slice(0, max);

// ---------------------------------------------------------------------
// PREÇO POR DIA DA SEMANA. produto.precosDia = { "2": 9.9, "3": 8.5 } (0 = domingo ... 6 = sábado).
// O dia que vale é o dia da ENTREGA: o da feira do cliente, ou hoje para quem não é de feira.
// Oferta ligada ("de X por Y") vence: o preço da oferta vale em todos os dias.
// Mesma conta no servidor (lib/feira.js → precoDoDia); um teste confere que batem.
// ---------------------------------------------------------------------
export function precoDoDia(p, dia) {
    const base = Number(p && p.preco);
    if (!p || emOferta(p) || !Number.isInteger(dia) || dia < 0 || dia > 6 || !p.precosDia || typeof p.precosDia !== 'object') return base;
    const v = Math.round(Number(p.precosDia[dia]) * 100) / 100;
    return Number.isFinite(v) && v > 0 && v < 100000 ? v : base;
}
/** Os preços por dia guardados no produto, limpos: só dias 0..6 com valor de verdade. */
export function limparPrecosDia(m) {
    const out = {};
    if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
    for (let d = 0; d <= 6; d++) { const v = Math.round(Number(String(m[d] == null ? '' : m[d]).replace(',', '.')) * 100) / 100; if (Number.isFinite(v) && v > 0 && v < 100000) out[d] = v; }
    return out;
}
