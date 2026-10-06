// =====================================================================
//  js/quantidade-lib.js — o que pode ser digitado num campo de quantidade.
// =====================================================================

/**
 * Deixa só número. Aceita vírgula ou ponto como separador (um só), até 4 casas antes e 3 depois.
 *   soInteiro = item vendido por unidade: sem vírgula.
 *   "x" → ""   "1x5" → "15"   "1,5kg" → "1,5"   "1.2.3" → "1.23"   "12,3456" → "12,345"
 */
export function limparQuantidade(texto, soInteiro = false) {
    let t = String(texto == null ? '' : texto).replace(soInteiro ? /\D/g : /[^\d.,]/g, '');
    if (soInteiro) return t.slice(0, 4);
    const i = t.search(/[.,]/);
    if (i === -1) return t.slice(0, 4);
    const antes = t.slice(0, i).slice(0, 4), depois = t.slice(i + 1).replace(/[.,]/g, '').slice(0, 3);
    return `${antes}${t[i]}${depois}`;
}
