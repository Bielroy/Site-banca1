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
