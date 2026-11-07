// =====================================================================
//  js/atalhos-lib.js — regras PURAS dos atalhos de compra da vitrine:
//  "Pedir de novo", "Minha lista da semana" e o convite para avaliar.
//  Sem navegador, para os testes poderem conferir.
// =====================================================================

import { limparOpcoes, remontar, temMontar } from './montar-lib.js';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const nomeDoDia = (n) => DIAS[n] || '';

/** Uma lista guardada só vale se tiver itens com id e quantidade de verdade. */
export function listaValida(v) {
    if (!v || !Array.isArray(v.itens)) return null;
    const itens = v.itens.filter((i) => i && typeof i.id === 'string' && i.id && Number(i.qtd) > 0)
        .slice(0, 100).map((i) => { const op = limparOpcoes(i.opcoes); return { id: i.id, qtd: Number(i.qtd), tipo: i.tipo === 'kg' ? 'kg' : 'un', nome: String(i.nome || '').slice(0, 80), ...(Object.keys(op).length ? { opcoes: op } : {}) }; });
    if (!itens.length) return null;
    const dia = Number.isInteger(v.dia) && v.dia >= 0 && v.dia <= 6 ? v.dia : null;
    return { itens, dia, em: String(v.em || '') };
}

/** Do pedido atual para o formato guardado. `agora` define o dia da semana da lista. */
export const listaDoCarrinho = (carrinho, agora = new Date()) => listaValida({
    itens: (carrinho || []).map((i) => ({ id: i.id, qtd: i.qtd, tipo: i.tipo, nome: i.nome, opcoes: i.opcoes })), dia: agora.getDay(), em: agora.toISOString(),
});

/**
 * Separa o que dá para pôr no pedido agora do que está em falta.
 * `produtos` = catálogo ativo de hoje. O item entra com o preço e os dados DE HOJE.
 */
export function separar(itens, produtos) {
    const porId = new Map((produtos || []).map((p) => [p.id, p])), entram = [], faltam = [];
    for (const i of itens || []) {
        const p = porId.get(i.id);
        if (!p || p.ativo === false || !(Number(i.qtd) > 0)) { faltam.push(i.nome || 'Produto indisponível'); continue; }
        // produto montado (açaí com complementos...): volta com as MESMAS escolhas, conferidas no cadastro de hoje
        if (temMontar(p)) {
            const linha = remontar(p, i.opcoes, i.qtd);
            if (linha && !entram.some((x) => x.linha === linha.linha)) entram.push(linha); else if (!linha) faltam.push(`${i.nome || p.nome} (as opções mudaram)`);
            continue;
        }
        entram.push({ ...p, qtd: Number(i.qtd), tipo: i.tipo || 'kg' });
    }
    return { entram, faltam };
}

/** O pedido atual já é exatamente este conjunto? (aí não precisa perguntar se troca) */
export const mesmoConjunto = (a, b) => {
    const ops = (o) => { const x = limparOpcoes(o); return Object.keys(x).sort().map((g) => `${g}=${x[g].slice().sort().join('+')}`).join(';'); };
    const cara = (l) => (l || []).map((i) => `${i.id}:${Number(i.qtd)}:${i.tipo || ''}:${ops(i.opcoes)}`).sort().join('|');
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
