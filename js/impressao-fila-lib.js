// =====================================================================
//  js/impressao-fila-lib.js — QUAIS pedidos a impressão automática imprime (regra pura, sem tela).
//
//  Modos (escolha de cada aparelho, em "Impressora"):
//     manual   nada sai sozinho
//     chegada  o cupom sai assim que o pedido chega
//     aceite   o cupom sai quando o pedido é aceito (vai para "Separando": aceitar, pesar ou "Recebi o PIX")
//  A regra olha o ESTADO do pedido, não o "evento": se o aparelho ficou desligado, quando o painel
//  abrir de novo ele imprime o que ficou para trás. O servidor (lib/impressao.js) garante que nada
//  sai duas vezes.
// =====================================================================
export const VERSOES = ['inicial', 'pesado', 'cancelado'];
export const nivel = (v) => VERSOES.indexOf(v);
export const RESERVA_MS = 90 * 1000;
export const AVISO_CANCELADO_MS = 24 * 3600 * 1000;      // aviso de cancelado só para pedido cancelado nas últimas 24 h
export const LIMITE_SEM_PERGUNTAR = 5;                   // mais que isso parado na fila: pergunta antes de gastar papel

export const MODOS_AUTO = {
    manual: ['Manual', 'Só imprime quando você toca em "Cupom".'],
    chegada: ['Assim que o pedido chega', 'O cupom sai sozinho na hora em que o pedido cai na fila.'],
    aceite: ['Quando eu aceitar o pedido', 'O cupom sai quando o pedido vai para "Separando" (aceitar, pesar ou "Recebi o PIX").'],
};
/** Só Bluetooth direto e cabo imprimem sem ninguém tocar na tela (os outros caminhos abrem tela ou outro app). */
export const podeAutomatico = (modo) => modo === 'bluetooth' || modo === 'serial';

const STATUS = { chegada: ['pendente', 'aguardando_pesagem', 'preparando'], aceite: ['preparando'] };
const temAPesar = (p) => Array.isArray(p.itens) && p.itens.some((i) => i && i.aPesar);
/** O status que o painel MOSTRA (pedido já pesado que ainda diz "a pesar" aparece em Separando). */
export const statusVisto = (p) => (p.status === 'aguardando_pesagem' && !temAPesar(p) ? 'preparando' : p.status);

/** Qual papel este pedido pede agora. */
export function versaoDesejada(p, cfg) {
    if (p.status === 'cancelado') return 'cancelado';
    // "imprimir de novo depois da pesagem" só existe no "ao chegar" (no "ao aceitar" o cupom já sai depois da balança)
    return cfg && cfg.auto === 'chegada' && cfg.autoPesado && p.pesadoEm ? 'pesado' : 'inicial';
}
/** Esta versão (ou uma maior) já saiu no papel? */
export const jaSaiu = (p, versao) => { const s = p && p.impressao && p.impressao.saiu; return !!s && nivel(s) >= nivel(versao); };

/**
 * O que a impressão automática deve imprimir deste pedido, ou null.
 * cfg = config do aparelho ({ auto, autoPesado, autoCancelado, aparelho }).
 * ignorados / feitos = chaves "id:versao" que este aparelho já pulou ou já imprimiu.
 */
export function precisaImprimir(p, cfg, { ignorados, feitos, agora = Date.now() } = {}) {
    if (!p || !p.id || !cfg || !STATUS[cfg.auto]) return null;
    if (p.origem === 'balcao' || p.resumoDoDia) return null;                 // balcão: o cupom sai na hora, à mão
    let versao;
    if (p.status === 'cancelado') {
        if (cfg.autoCancelado === false) return null;
        if (!(p.impressao && p.impressao.saiu)) return null;                 // nunca saiu no papel: não tem o que avisar
        if (agora - (Date.parse(p.canceladoEm || p.data) || 0) > AVISO_CANCELADO_MS) return null;
        versao = 'cancelado';
    } else {
        if (!STATUS[cfg.auto].includes(statusVisto(p))) return null;
        versao = versaoDesejada(p, cfg);
    }
    const chave = `${p.id}:${versao}`;
    if (jaSaiu(p, versao) || (ignorados && ignorados.has(chave)) || (feitos && feitos.has(chave))) return null;
    const im = p.impressao;                                                  // outro aparelho está imprimindo agora
    if (im && im.estado === 'reservado' && im.aparelho !== cfg.aparelho && agora - (Date.parse(im.em) || 0) < RESERVA_MS && nivel(im.versao) >= nivel(versao)) return null;
    return { id: p.id, versao, chave };
}

/** Lista do que imprimir, do pedido mais antigo para o mais novo (a ordem em que chegaram). */
export function trabalhosDe(pedidos, cfg, opcoes) {
    return (pedidos || []).map((p) => ({ p, t: precisaImprimir(p, cfg, opcoes) })).filter((x) => x.t)
        .sort((a, b) => String(a.p.data || '').localeCompare(String(b.p.data || ''))).map((x) => ({ ...x.t, pedido: x.p }));
}
