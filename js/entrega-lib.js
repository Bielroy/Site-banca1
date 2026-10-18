// =====================================================================
//  js/entrega-lib.js — prévia da TAXA de entrega no navegador.
//  O valor que vale é o do servidor (lib/entrega.js): mesma conta, em
//  reais em vez de centavos. Se mudar uma, mude a outra.
// =====================================================================
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

const limparDias = (dias) => [...new Set((Array.isArray(dias) ? dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
const limpaRegras = (lista) => (Array.isArray(lista) ? lista : []).filter((r) => r && typeof r === 'object').slice(0, 20).map((r) => ({
    feira: /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(r.feira || '')) ? String(r.feira) : '', dias: limparDias(r.dias), horarios: limpaHorarios(r.horarios),
}));
const limpaHorarios = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map((h) => String(h || '').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);

export function lerEntrega(config) {
    const e = (config && config.entrega) || {};
    const r = e.retirada && typeof e.retirada === 'object' ? e.retirada : {};
    return {
        taxa: Math.min(num(e.taxa), 500), gratisAcima: num(e.gratisAcima), horarios: limpaHorarios(e.horarios), regras: limpaRegras(e.regras),
        // RETIRADA NA BANCA: o cliente busca. Só aparece para ele se a loja ligou (ativa === true) e se hoje é um dos dias dela.
        retirada: { ativa: r.ativa === true, dias: limparDias(r.dias), horarios: limpaHorarios(r.horarios), local: String(r.local || '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) },
    };
}

/**
 * Horários de ENTREGA de uma feira (ou '') num dia da semana: vence a regra mais específica
 * (feira + dia · feira · dia · lista geral). Mesma conta de lib/entrega.js (horariosDaEntrega).
 */
export function horariosDaEntrega(cfg, feira = '', dow = -1) {
    let melhor = null, nota = -1;
    for (const r of cfg.regras || []) {
        if ((r.feira && r.feira !== feira) || (r.dias.length && !r.dias.includes(dow))) continue;
        const n = (r.feira ? 2 : 0) + (r.dias.length ? 1 : 0);
        if (n > nota) { melhor = r; nota = n; }
    }
    return melhor ? melhor.horarios : cfg.horarios;
}
/** A retirada funciona neste dia da semana? (sem dias marcados = todos os dias) */
export const retiradaNoDia = (cfg, dow) => !cfg.retirada.dias.length || cfg.retirada.dias.includes(dow);
/** Os horários que valem para o modo escolhido ('entrega' ou 'retirada'). ctx = { feira, dow } só serve para a entrega. */
export const horariosDoModo = (cfg, modo, ctx = {}) => (modo === 'retirada' ? cfg.retirada.horarios : horariosDaEntrega(cfg, ctx.feira || '', Number.isInteger(ctx.dow) ? ctx.dow : -1));

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
