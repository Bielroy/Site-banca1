// =====================================================================
//  js/fechamento-lib.js — regras PURAS do Fechamento da Feira (sem DOM,
//  sem Firebase). Ficam separadas para poderem ser testadas.
//
//  Registro de um dia (coleção `fechamentos`, documento = AAAA-MM-DD):
//    { dia, atualizadoEm, itens: { [produtoId]: { tem: true|false|null, obs, nome, cat } } }
//      tem = true   → sobrou (obs opcional: "meia caixa")
//      tem = false  → não tem mais
//      tem = null   → desmarcado
// =====================================================================

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Data de hoje em Brasília (UTC−3) como AAAA-MM-DD. */
export const hojeBR = (agora = Date.now()) => new Date(agora - 3 * 3600000).toISOString().slice(0, 10);
export const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const diaDaSemana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();          // 0 = domingo
export const domingoDaSemana = (iso) => addDias(iso, -diaDaSemana(iso));
export const semanaDe = (iso) => { const d0 = domingoDaSemana(iso); return Array.from({ length: 7 }, (_, i) => addDias(d0, i)); };
export const dataCurta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const dataLonga = (iso) => `${DIAS_LONGOS[diaDaSemana(iso)]}, ${dataCurta(iso)}`;

/** Próximo dia em que a banca abre (diasAbertos = [0..6]); sem config, o dia seguinte. */
export const proximoDiaAberto = (iso, diasAbertos) => {
    const abertos = Array.isArray(diasAbertos) && diasAbertos.length ? diasAbertos : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 1; i <= 7; i++) { const d = addDias(iso, i); if (abertos.includes(diaDaSemana(d))) return d; }
    return addDias(iso, 1);
};

/** Ordem estável: categoria, depois nome. */
export const ordenarProdutos = (produtos) => [...produtos].sort((a, b) =>
    norm(a.cat).localeCompare(norm(b.cat)) || norm(a.nome).localeCompare(norm(b.nome), 'pt-BR'));

export const resumoDia = (itens, produtos) => {
    const ids = new Set(produtos.map((p) => p.id));
    let sobrou = 0, acabou = 0;
    for (const [id, v] of Object.entries(itens || {})) {
        if (!ids.has(id) || !v) continue;
        if (v.tem === true) sobrou++; else if (v.tem === false) acabou++;
    }
    return { total: produtos.length, marcados: sobrou + acabou, sobrou, acabou, faltaMarcar: produtos.length - sobrou - acabou };
};

const agrupar = (lista) => {
    const m = new Map();
    for (const it of lista) { const c = it.cat || 'outros'; if (!m.has(c)) m.set(c, []); m.get(c).push(it); }
    return [...m.entries()].map(([cat, itens]) => ({ cat, itens }));
};

/**
 * Lista de compras da Ceasa a partir do fechamento de um dia.
 *  comprar  = marcados "não tem" (+ opcionalmente os não marcados)
 *  jaTenho  = marcados "tem" que trazem anotação de quanto sobrou (para conferir antes de comprar)
 */
export const gerarListaCeasa = ({ itens, produtos, deDia, paraDia, incluirNaoMarcados = false }) => {
    const reg = itens || {};
    const comprar = [], jaTenho = [];
    let naoMarcados = 0;
    for (const p of ordenarProdutos(produtos)) {
        const v = reg[p.id];
        const base = { id: p.id, nome: p.nome, cat: p.cat || 'outros' };
        if (v && v.tem === false) comprar.push(base);
        else if (v && v.tem === true) { if (String(v.obs || '').trim()) jaTenho.push({ ...base, obs: String(v.obs).trim() }); }
        else { naoMarcados++; if (incluirNaoMarcados) comprar.push({ ...base, naoMarcado: true }); }
    }
    const gc = agrupar(comprar), gt = agrupar(jaTenho);
    const L = [`🛒 *LISTA DA CEASA* — ${dataLonga(paraDia)}`, `_Baseada no fechamento de ${dataLonga(deDia)}_`, ''];
    L.push(`*COMPRAR (${comprar.length})*`);
    if (!comprar.length) L.push('Nada marcado como "não tem".');
    gc.forEach((g) => { L.push(`_${g.cat}_`); g.itens.forEach((i) => L.push(`☐ ${i.nome}${i.naoMarcado ? ' (não conferido)' : ''}`)); });
    if (jaTenho.length) {
        L.push('', `*JÁ TENHO — conferir antes de comprar (${jaTenho.length})*`);
        gt.forEach((g) => g.itens.forEach((i) => L.push(`• ${i.nome} — ${i.obs}`)));
    }
    if (naoMarcados && !incluirNaoMarcados) L.push('', `⚠️ ${naoMarcados} produto(s) sem marcação ficaram de fora.`);
    return { comprar, jaTenho, naoMarcados, grupos: gc, gruposJaTenho: gt, texto: L.join('\n') };
};

/**
 * Padrão do dia da semana: em quantas das últimas semanas o produto sobrou / acabou.
 * `registros` = [{ dia, itens }] (qualquer ordem; só os do mesmo dia da semana contam).
 */
export const padraoDoDiaDaSemana = (registros, diaRef, produtoId, maxSemanas = 8) => {
    const dow = diaDaSemana(diaRef);
    const mesmos = (registros || []).filter((r) => r.dia < diaRef && diaDaSemana(r.dia) === dow)
        .sort((a, b) => (a.dia < b.dia ? 1 : -1)).slice(0, maxSemanas);
    let sobrou = 0, acabou = 0, n = 0;
    for (const r of mesmos) {
        const v = r.itens && r.itens[produtoId];
        if (!v || (v.tem !== true && v.tem !== false)) continue;
        n++; if (v.tem) sobrou++; else acabou++;
    }
    return { n, sobrou, acabou };
};

