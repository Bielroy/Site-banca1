// =====================================================================
//  js/fila-offline-lib.js — as contas da FILA DE ALTERAÇÕES SEM INTERNET (js/fila-offline.js). Arquivo puro (testado).
// =====================================================================
export const VALIDADE_MS = 6 * 3600e3;           // alteração que ficou mais de 6 h sem ir: descarta (o banco já pode ter mudado por outro aparelho)
export const MAX_ITENS = 300;

/** Dá para guardar no aparelho e mandar de novo depois? Só texto, número, sim/não, nulo, lista e objeto simples.
 *  Marcadores do Firebase (hora do servidor, apagar campo, somar) não dão: essas alterações seguem só pelo caminho normal. */
export function guardavel(v, fundo = 0) {
    if (fundo > 12) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.every((x) => guardavel(x, fundo + 1));
    if (typeof v === 'object') return Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every((x) => guardavel(x, fundo + 1));
    return false;
}

/** O que mandar de novo ao abrir: só as que não venceram, na ordem em que foram feitas, no máximo MAX_ITENS. */
export function paraReenviar(itens, agora = Date.now()) {
    return (Array.isArray(itens) ? itens : [])
        .filter((x) => x && typeof x.caminho === 'string' && /^[\w-]+(\/[\w-]+)+$/.test(x.caminho) && ['set', 'apagar'].includes(x.op) && Number.isFinite(x.em) && agora - x.em <= VALIDADE_MS)
        .sort((a, b) => a.em - b.em || a.seq - b.seq)
        .slice(-MAX_ITENS);
}

/** Texto do aviso no topo do painel. */
export function textoDoAviso({ online, pendentes }) {
    if (online && !pendentes) return '';
    const n = pendentes === 1 ? '1 alteração esperando' : `${pendentes} alterações esperando`;
    if (!online) return pendentes ? `Sem internet. ${n}: elas vão sozinhas quando a internet voltar.` : 'Sem internet. Pode continuar: o que você mudar vai quando a internet voltar.';
    return `Enviando ${n}...`;
}
