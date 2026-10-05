// =====================================================================
//  js/entrega-lib.js — prévia da TAXA de entrega no navegador.
//  O valor que vale é o do servidor (lib/entrega.js): mesma conta, em
//  reais em vez de centavos. Se mudar uma, mude a outra.
// =====================================================================
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

export function lerEntrega(config) {
    const e = (config && config.entrega) || {};
    const horarios = (Array.isArray(e.horarios) ? e.horarios : []).map((h) => String(h || '').trim().slice(0, 40)).filter(Boolean).slice(0, 8);
    return { taxa: Math.min(num(e.taxa), 500), gratisAcima: num(e.gratisAcima), horarios: [...new Set(horarios)] };
}

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
