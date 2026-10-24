// =====================================================================
//  js/entrega-lib.js — prévia da TAXA de entrega no navegador.
//  O valor que vale é o do servidor (lib/entrega.js): mesma conta, em
//  reais em vez de centavos. Se mudar uma, mude a outra.
// =====================================================================
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

const limparDias = (dias) => [...new Set((Array.isArray(dias) ? dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
const limpaTexto = (v, max) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const limpaHorarios = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map((h) => limpaTexto(h, 40)).filter(Boolean))].slice(0, 8);
const ID_FEIRA = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** Agenda por feira e dia (mesma limpeza de lib/entrega.js). */
function limpaAgenda(lista) {
    const out = [], vistos = new Set();
    for (const r of Array.isArray(lista) ? lista.slice(0, 80) : []) {
        if (!r || typeof r !== 'object' || !ID_FEIRA.test(String(r.feira || '')) || !Number.isInteger(r.dia) || r.dia < 0 || r.dia > 6) continue;
        const entrega = r.entrega === true, retirada = r.retirada === true, chave = `${r.feira}|${r.dia}`;
        if ((!entrega && !retirada) || vistos.has(chave)) continue;
        vistos.add(chave);
        out.push({ feira: String(r.feira), dia: r.dia, entrega, horariosEntrega: entrega ? limpaHorarios(r.horariosEntrega) : [], retirada, horariosRetirada: retirada ? limpaHorarios(r.horariosRetirada) : [], local: retirada ? limpaTexto(r.local, 80) : '' });
        if (out.length >= 40) break;
    }
    return out;
}

export function lerEntrega(config) {
    const e = (config && config.entrega) || {};
    const r = e.retirada && typeof e.retirada === 'object' ? e.retirada : {};
    return {
        taxa: Math.min(num(e.taxa), 500), gratisAcima: num(e.gratisAcima), horarios: limpaHorarios(e.horarios),
        // RETIRADA GERAL (cliente sem feira): só se a loja ligou (ativa === true) e se hoje é um dos dias dela.
        retirada: { ativa: r.ativa === true, dias: limparDias(r.dias), horarios: limpaHorarios(r.horarios), local: limpaTexto(r.local, 80) },
        // AGENDA (cliente da feira): o que cada dia de cada feira tem.
        agenda: limpaAgenda(e.agenda),
    };
}

/** A retirada geral funciona neste dia da semana? (sem dias marcados = todos os dias) */
export const retiradaNoDia = (cfg, dow) => !cfg.retirada.dias.length || cfg.retirada.dias.includes(dow);
/**
 * O que o cliente pode escolher no dia do pedido. Mesma conta de lib/entrega.js (opcoesDoDia).
 *   feira = id da feira do cliente nesta banca ('' = sem feira) · dow = dia da semana da entrega
 */
export function opcoesDoDia(cfg, feira = '', dow = -1) {
    if (feira) {
        const r = cfg.agenda.find((x) => x.feira === feira && x.dia === dow);
        if (r) return { entrega: r.entrega, retirada: r.retirada, horariosEntrega: r.horariosEntrega, horariosRetirada: r.horariosRetirada, local: r.local, daAgenda: true };
        return { entrega: true, retirada: false, horariosEntrega: cfg.horarios, horariosRetirada: [], local: '', daAgenda: false };
    }
    return { entrega: true, retirada: cfg.retirada.ativa && retiradaNoDia(cfg, dow), horariosEntrega: cfg.horarios, horariosRetirada: cfg.retirada.horarios, local: cfg.retirada.local, daAgenda: false };
}
/** Os horários que valem para o modo escolhido. ctx = { feira, dow }. */
export const horariosDoModo = (cfg, modo, ctx = {}) => { const o = opcoesDoDia(cfg, ctx.feira || '', Number.isInteger(ctx.dow) ? ctx.dow : -1); return modo === 'retirada' ? o.horariosRetirada : o.horariosEntrega; };

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
