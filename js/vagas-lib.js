// =====================================================================
//  js/vagas-lib.js — VAGAS POR HORÁRIO DE ENTREGA e ANTECEDÊNCIA (mecânica da agenda do Cal.com:
//  seatsPerTimeSlot = vagas por horário, minimumBookingNotice = aviso mínimo).
//
//  Cada horário de entrega ("Manhã (8h às 12h)") aceita no máximo `vagas` pedidos por dia (0 = sem limite).
//  Pedido PARA HOJE só pode escolher um horário que começa daqui a pelo menos `antecedenciaMin` minutos
//  (o começo é o primeiro horário escrito no texto: "8h", "8:30", "14h"). Horário sem hora escrita não fecha por hora.
//  Contagem: {loja}/vagas/{AAAA-MM-DD} = { [chave do horário]: { n, horario } }, gravada pelo servidor no pedido
//  e devolvida no cancelamento. A loja lê o mesmo documento para mostrar "lotado" e "restam 2".
//  Mesma conta de lib/vagas.js (servidor). Se mudar uma, mude a outra: o teste confere as duas.
// =====================================================================
export const MAX_VAGAS = 500, MAX_ANTECEDENCIA = 1440;

/** Minutos do dia em que o horário começa ("Tarde (14h às 18h)" → 840). -1 quando o texto não tem hora. */
export function inicioMin(texto) {
    const m = String(texto || '').match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i);
    if (!m) return -1;
    const h = Number(m[1]), mi = Number(m[2] || 0);
    return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? h * 60 + mi : -1;
}
/** Chave do horário no documento de vagas (só letras, números e hífen). */
export const chaveHorario = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'sem-nome';

/** Vagas e antecedência da configuração (lixo vira "sem limite"). */
export function lerVagas(entrega) {
    const e = entrega || {}, inteiro = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
    return { vagas: inteiro(e.vagas, MAX_VAGAS), antecedenciaMin: inteiro(e.antecedenciaMin, MAX_ANTECEDENCIA) };
}

/**
 * Este horário ainda aceita pedido?
 *   { horario, vagas, usados, paraHoje, agoraMin, antecedenciaMin } → { ok, lotado, fechado, restam }
 *   restam: quantas vagas sobram (null = sem limite)
 */
export function estadoDoHorario({ horario, vagas = 0, usados = 0, paraHoje = false, agoraMin = 0, antecedenciaMin = 0 }) {
    const restam = vagas > 0 ? Math.max(0, vagas - (Number(usados) || 0)) : null;
    const lotado = vagas > 0 && restam === 0;
    const ini = inicioMin(horario);
    const fechado = !!paraHoje && antecedenciaMin > 0 && ini >= 0 && agoraMin + antecedenciaMin > ini;   // sem antecedência: não fecha por hora (como antes)
    return { ok: !lotado && !fechado, lotado, fechado, restam };
}

/** Minutos do dia agora no horário de Brasília (o servidor roda em UTC). */
export const agoraMinBR = (agora = Date.now()) => { const d = new Date(agora - 3 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
