// =====================================================================
//  js/dias-lib.js — PRODUTO POR DIA DA SEMANA e PEDIDO PARA AMANHÃ.
//  Mesma conta no servidor (lib/dias.js); um teste confere que batem.
//
//  produto.dias = [3, 6]   → só sai na quarta e no sábado (0 = domingo ... 6 = sábado)
//  sem o campo, vazio ou os 7 dias → sai todo dia (é o padrão: nada muda para quem não mexer)
//
//  O DIA que vale é o da ENTREGA: o cliente da feira usa o dia da feira; os outros escolhem
//  "Hoje" ou "Amanhã" na loja. A alface de quarta aparece para quem pede para quarta.
// =====================================================================
export const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const CURTOS_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Lista de dias limpa e em ordem. null = todos os dias (sem restrição). */
export function limparDiasProduto(v) {
    if (!Array.isArray(v)) return null;
    const dias = [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    return dias.length === 0 || dias.length === 7 ? null : dias;
}

/** O produto sai neste dia da semana? Dia inválido: sai (nunca some produto por engano). */
export function vendeNoDia(p, dow) {
    const dias = limparDiasProduto(p && p.dias);
    if (!dias || !Number.isInteger(dow) || dow < 0 || dow > 6) return true;
    return dias.includes(dow);
}

/** "quarta e sábado" · "segunda a sexta" · "todo dia" */
export function textoDosDias(v) {
    const dias = limparDiasProduto(v);
    if (!dias) return 'todo dia';
    const seguidos = dias.length >= 3 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
    if (seguidos) return `${NOMES_DIA[dias[0]]} a ${NOMES_DIA[dias[dias.length - 1]]}`;
    const nomes = dias.map((d) => NOMES_DIA[d]);
    return nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** Hoje e amanhã em Brasília: { dia: 'AAAA-MM-DD', dow }. */
export function diaBR(agora = Date.now(), maisDias = 0) {
    const br = new Date(agora - 3 * 3600000);
    const d = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + maisDias));
    return { dia: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
}

/**
 * A loja deixa escolher "Hoje / Amanhã"?
 *   config.pedidoAmanha === false → nunca · === true → sempre
 *   sem resposta → automático: só quando há produto que não sai todo dia
 * E amanhã precisa ser dia de a loja abrir.
 */
export function aceitaAmanha(config, produtos, agora = Date.now()) {
    const c = config || {};
    if (c.pedidoAmanha === false || c.lojaAberta === false) return false;
    const abertos = Array.isArray(c.diasAbertos) && c.diasAbertos.length ? c.diasAbertos : [0, 1, 2, 3, 4, 5, 6];
    if (!abertos.includes(diaBR(agora, 1).dow)) return false;
    return c.pedidoAmanha === true || (Array.isArray(produtos) && produtos.some((p) => limparDiasProduto(p && p.dias)));
}
