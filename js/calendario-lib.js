// =====================================================================
//  js/calendario-lib.js — CALENDÁRIO OPERACIONAL (regras puras, testadas).
//
//  Uma entrada: { id, data: 'AAAA-MM-DD', tipo, titulo, obs, repete }
//    repete: ''         só naquele dia
//            'semanal'  toda semana, no mesmo dia da semana, a partir da data
//            'anual'    todo ano, no mesmo dia e mês, a partir da data
//  Feriados e datas comemorativas nacionais entram sozinhos (mesma lista que o
//  motor de demanda usa em analytics/seasonality.js; os testes conferem).
//  A versão do servidor fica em lib/calendario.js. Se mudar uma, mude a outra.
// =====================================================================
export const TIPOS = {
    compra: ['Dia de compra', '#2f7a4f'], producao: ['Dia de produção', '#b45309'], feira: ['Dia de feira', '#0e7490'],
    promocao: ['Promoção', '#be185d'], evento: ['Evento', '#6d28d9'], feriado: ['Feriado', '#b91c1c'], especial: ['Data especial', '#a16207'],
};
/** Tipos que mudam a PROCURA dos clientes: vão para o motor de previsão. Rotina (compra, produção, feira) não vai. */
export const TIPOS_DE_DEMANDA = ['promocao', 'evento', 'feriado', 'especial'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.toISOString().slice(0, 10);
const data = (s) => new Date(`${s}T12:00:00Z`);
export const somarDias = (s, n) => { const d = data(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const dowDe = (s) => data(s).getUTCDay();
export const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(data(s).getTime()) && iso(data(s)) === s;

function pascoa(ano) {          // Meeus/Jones/Butcher
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return `${ano}-${pad(mes)}-${pad(dia)}`;
}
const enesimo = (ano, mes, dow, n) => { const d1 = `${ano}-${pad(mes)}-01`; return somarDias(d1, ((dow - dowDe(d1) + 7) % 7) + 7 * (n - 1)); };

export function feriadosDoAno(ano) {
    const P = pascoa(ano), f = (m, d) => `${ano}-${pad(m)}-${pad(d)}`, F = 'feriado', E = 'especial';
    return [[f(1, 1), 'Ano Novo', F], [somarDias(P, -48), 'Carnaval', F], [somarDias(P, -47), 'Carnaval', F], [somarDias(P, -2), 'Sexta-feira Santa', F], [P, 'Páscoa', E],
        [f(4, 21), 'Tiradentes', F], [f(5, 1), 'Dia do Trabalho', F], [enesimo(ano, 5, 0, 2), 'Dia das Mães', E], [f(6, 12), 'Dia dos Namorados', E], [somarDias(P, 60), 'Corpus Christi', F],
        [enesimo(ano, 8, 0, 2), 'Dia dos Pais', E], [f(9, 7), 'Independência', F], [f(10, 12), 'N. Sra. Aparecida', F], [f(11, 2), 'Finados', F], [f(11, 15), 'Proclamação da República', F],
        [f(11, 20), 'Consciência Negra', F], [enesimo(ano, 11, 5, 4), 'Black Friday', E], [f(12, 24), 'Véspera de Natal', E], [f(12, 25), 'Natal', F], [f(12, 31), 'Véspera de Ano Novo', E]]
        .map(([d, titulo, tipo]) => ({ data: d, titulo, tipo, nacional: true }));
}

/** Tudo o que acontece entre duas datas (inclusive), já com as repetições abertas e os feriados nacionais. Em ordem de data. */
export function ocorrencias(entradas, de, ate, { nacionais = true } = {}) {
    const out = [];
    for (const e of entradas || []) {
        if (!e || !dataValida(e.data) || !TIPOS[e.tipo]) continue;
        const base = { id: e.id, tipo: e.tipo, titulo: e.titulo || TIPOS[e.tipo][0], obs: e.obs || '', repete: e.repete || '' };
        if (e.repete === 'semanal') {
            let d = e.data; if (d < de) d = somarDias(d, Math.ceil((data(de) - data(d)) / 86400000 / 7) * 7);
            for (; d <= ate; d = somarDias(d, 7)) out.push({ ...base, data: d });
        } else if (e.repete === 'anual') {
            for (let ano = Math.max(Number(e.data.slice(0, 4)), Number(de.slice(0, 4))); ano <= Number(ate.slice(0, 4)); ano++) {
                const d = `${ano}${e.data.slice(4)}`; if (dataValida(d) && d >= de && d <= ate) out.push({ ...base, data: d });     // 29/02 só existe em ano bissexto
            }
        } else if (e.data >= de && e.data <= ate) out.push({ ...base, data: e.data });
    }
    if (nacionais) for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++) feriadosDoAno(ano).forEach((f) => { if (f.data >= de && f.data <= ate) out.push(f); });
    return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.tipo.localeCompare(b.tipo)));
}

/** As semanas de um mês para desenhar a grade (domingo a sábado). Dias de fora do mês vêm com foraDoMes. */
export function gradeDoMes(ano, mes) {
    const primeiro = `${ano}-${pad(mes)}-01`, inicio = somarDias(primeiro, -dowDe(primeiro)), dias = [];
    for (let i = 0; i < 42; i++) { const d = somarDias(inicio, i); dias.push({ data: d, dia: Number(d.slice(8)), foraDoMes: d.slice(0, 7) !== primeiro.slice(0, 7) }); }
    return dias.slice(35).every((x) => x.foraDoMes) ? dias.slice(0, 35) : dias;
}

/** Confere uma entrada antes de gravar. Devolve '' ou a frase do problema. */
export function validarEntrada(e) {
    if (!dataValida(e.data)) return 'Escolha a data.';
    if (!TIPOS[e.tipo]) return 'Escolha o tipo.';
    if (!['', 'semanal', 'anual'].includes(e.repete || '')) return 'Repetição inválida.';
    if (String(e.titulo || '').length > 60) return 'O título pode ter até 60 letras.';
    if (['promocao', 'evento', 'especial', 'feriado'].includes(e.tipo) && !String(e.titulo || '').trim()) return 'Dê um nome: é por ele que a previsão reconhece quando o mesmo evento se repete.';
    return '';
}
