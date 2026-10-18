// =====================================================================
//  js/entrega-lib.js — prévia da TAXA de entrega no navegador.
//  O valor que vale é o do servidor (lib/entrega.js): mesma conta, em
//  reais em vez de centavos. Se mudar uma, mude a outra.
// =====================================================================
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

const limpaHorarios = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map((h) => String(h || '').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);

export function lerEntrega(config) {
    const e = (config && config.entrega) || {};
    const r = e.retirada && typeof e.retirada === 'object' ? e.retirada : {};
    return {
        taxa: Math.min(num(e.taxa), 500), gratisAcima: num(e.gratisAcima), horarios: limpaHorarios(e.horarios),
        // RETIRADA NA BANCA: o cliente busca. Só aparece para ele se a loja ligou (ativa === true).
        retirada: { ativa: r.ativa === true, horarios: limpaHorarios(r.horarios), local: String(r.local || '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) },
    };
}

/** Os horários que valem para o modo escolhido ('entrega' ou 'retirada'). */
export const horariosDoModo = (cfg, modo) => (modo === 'retirada' ? cfg.retirada.horarios : cfg.horarios);

/**
 * O que mostrar no carrinho.  itens = valor dos itens (sem a taxa)
 *   { taxa, gratis, falta, texto }   texto '' = loja não cobra entrega
 */
export function previaDaEntrega(cfg, itens, fmt) {
    if (!(cfg.taxa > 0)) return { taxa: 0, gratis: false, falta: 0, texto: '' };
    if (cfg.gratisAcima > 0 && itens >= cfg.gratisAcima) return { taxa: 0, gratis: true, falta: 0, texto: 'Entrega grátis' };
    const falta = cfg.gratisAcima > 0 ? Math.round((cfg.gratisAcima - itens) * 100) / 100 : 0;
    return { taxa: cfg.taxa, gratis: false, falta, texto: `Entrega ${fmt(cfg.taxa)}${falta > 0 ? ` · faltam ${fmt(falta)} para entrega grátis` : ''}` };
}

/** Texto do painel ("um horário por linha") → lista limpa. */
export function horariosDoTexto(texto) {
    return [...new Set(String(texto || '').split('\n').map((l) => l.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);
}
