// =====================================================================
//  js/atalhos-lib.js — regras PURAS dos atalhos de compra da vitrine:
//  "Pedir de novo", "Minha lista da semana" e o convite para avaliar.
//  Sem navegador, para os testes poderem conferir.
// =====================================================================

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const nomeDoDia = (n) => DIAS[n] || '';

/** Uma lista guardada só vale se tiver itens com id e quantidade de verdade. */
export function listaValida(v) {
    if (!v || !Array.isArray(v.itens)) return null;
    const itens = v.itens.filter((i) => i && typeof i.id === 'string' && i.id && Number(i.qtd) > 0)
        .slice(0, 100).map((i) => ({ id: i.id, qtd: Number(i.qtd), tipo: i.tipo === 'kg' ? 'kg' : 'un', nome: String(i.nome || '').slice(0, 80) }));
    if (!itens.length) return null;
    const dia = Number.isInteger(v.dia) && v.dia >= 0 && v.dia <= 6 ? v.dia : null;
    return { itens, dia, em: String(v.em || '') };
}

/** Do pedido atual para o formato guardado. `agora` define o dia da semana da lista. */
export const listaDoCarrinho = (carrinho, agora = new Date()) => listaValida({
    itens: (carrinho || []).map((i) => ({ id: i.id, qtd: i.qtd, tipo: i.tipo, nome: i.nome })), dia: agora.getDay(), em: agora.toISOString(),
});

/**
 * Separa o que dá para pôr no pedido agora do que está em falta.
 * `produtos` = catálogo ativo de hoje. O item entra com o preço e os dados DE HOJE.
 */
export function separar(itens, produtos) {
    const porId = new Map((produtos || []).map((p) => [p.id, p])), entram = [], faltam = [];
    for (const i of itens || []) {
        const p = porId.get(i.id);
        if (p && p.ativo !== false && Number(i.qtd) > 0) entram.push({ ...p, qtd: Number(i.qtd), tipo: i.tipo || 'kg' });
        else faltam.push(i.nome || 'Produto indisponível');
    }
    return { entram, faltam };
}

/** O pedido atual já é exatamente este conjunto? (aí não precisa perguntar se troca) */
export const mesmoConjunto = (a, b) => {
    const cara = (l) => (l || []).map((i) => `${i.id}:${Number(i.qtd)}:${i.tipo || ''}`).sort().join('|');
    return cara(a) === cara(b);
};

const HORA = 3600000;
/** Vale convidar para avaliar? Entre 3 horas e 4 dias depois do pedido, se ainda não avaliou nem cancelou. */
export function podeConvidarAvaliar(pedido, agora = Date.now()) {
    if (!pedido || pedido.avaliado || pedido.cancelado) return false;
    const idade = agora - new Date(pedido.data).getTime();
    return idade >= 3 * HORA && idade <= 96 * HORA;
}

/** Texto curto da nota para o cabeçalho da loja. Só aparece com 5 avaliações ou mais. */
export function textoDaNota(resumo) {
    const n = Number(resumo && resumo.n), soma = Number(resumo && resumo.soma);
    if (!(n >= 5) || !(soma > 0)) return '';
    return `${(soma / n).toFixed(1).replace('.', ',')} de 5 em ${n} avaliações`;
}
