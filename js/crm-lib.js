// =====================================================================
//  js/crm-lib.js — CLIENTES E SEGMENTOS (regras puras, testadas).
//
//  Entrada: a lista de clientes que o motor de demanda já calcula todo dia
//  (indiceClientes). Nenhuma leitura a mais no banco.
//
//  Segmentos (um cliente pode estar em mais de um):
//    novos        primeira compra há até 30 dias
//    recorrentes  3 compras ou mais e ainda dentro do ritmo dele
//    atrasados    recorrente que passou do dobro do intervalo de costume (ainda não inativo)
//    inativos     sem comprar há mais de 30 dias
//    altoValor    os 20% que mais gastaram, entre quem comprou 2 vezes ou mais
// =====================================================================
const DIA = 86400000;
const dias = (iso, hojeIso) => Math.round((Date.parse(`${hojeIso}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / DIA);

export const SEGMENTOS = [['todos', 'Todos'], ['novos', 'Novos'], ['recorrentes', 'Recorrentes'], ['atrasados', 'Atrasados'], ['inativos', 'Inativos'], ['altoValor', 'Alto valor']];

export function segmentar(clientes, hojeIso, { diasInativo = 30, diasNovo = 30 } = {}) {
    const lista = (clientes || []).filter((c) => c && c.ult).map((c) => {
        const semComprar = dias(c.ult, hojeIso), desdePrimeira = c.pri ? dias(c.pri, hojeIso) : null, cada = Number(c.cada) > 0 ? Number(c.cada) : null;
        return { ...c, semComprar, desdePrimeira, cada, seg: [] };
    });
    // corte do "alto valor": gasto do cliente no percentil 80 entre quem tem 2+ compras
    const gastos = lista.filter((c) => c.n >= 2 && Number(c.gasto) > 0).map((c) => Number(c.gasto)).sort((a, b) => a - b);
    const corte = gastos.length >= 5 ? gastos[Math.floor(gastos.length * 0.8)] : Infinity;
    for (const c of lista) {
        const inativo = c.semComprar > diasInativo;
        if (c.desdePrimeira !== null && c.desdePrimeira <= diasNovo) c.seg.push('novos');
        if (inativo) c.seg.push('inativos');
        if (c.n >= 3 && !inativo) {
            if (c.cada && c.semComprar > 2 * c.cada) c.seg.push('atrasados'); else c.seg.push('recorrentes');
        }
        if (c.n >= 2 && Number(c.gasto) >= corte) c.seg.push('altoValor');
    }
    const contagem = Object.fromEntries(SEGMENTOS.map(([k]) => [k, k === 'todos' ? lista.length : lista.filter((c) => c.seg.includes(k)).length]));
    return { lista, contagem, diasInativo };
}

/** Filtra por segmento, por produto (entre os mais comprados do cliente) e por texto. Mais sumido primeiro nos inativos; maior gasto primeiro no resto. */
export function filtrar(seg, { segmento = 'todos', produtoId = '', busca = '' } = {}) {
    const termo = String(busca).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const texto = (c) => `${c.nome} ${c.condominio} ${c.quadra} ${c.lote}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return seg.lista.filter((c) => (segmento === 'todos' || c.seg.includes(segmento)) && (!produtoId || (c.tp || []).includes(produtoId)) && (!termo || texto(c).includes(termo)))
        .sort((a, b) => (segmento === 'inativos' || segmento === 'atrasados' ? b.semComprar - a.semComprar : (Number(b.gasto) || 0) - (Number(a.gasto) || 0)));
}

/**
 * Pode mandar mensagem de oferta? Só para quem aceitou no pedido (LGPD) e tem telefone,
 * e no máximo uma vez a cada `intervaloDias` — para não virar spam.
 */
export function podeContatar(c, ultimoContatoIso, agora = Date.now(), intervaloDias = 14) {
    if (!c.oferta || !c.tel) return { pode: false, motivo: 'Este cliente não pediu para receber ofertas.' };
    if (ultimoContatoIso) {
        const ha = Math.floor((agora - Date.parse(ultimoContatoIso)) / DIA);
        if (ha < intervaloDias) return { pode: false, motivo: `Já recebeu mensagem ${ha === 0 ? 'hoje' : `há ${ha} dia(s)`}. Espere ${intervaloDias - ha} dia(s) para não incomodar.` };
    }
    return { pode: true, motivo: '' };
}

/** Texto inicial da mensagem, conforme o momento do cliente. A pessoa pode editar antes de enviar. */
export function mensagemSugerida(c, nomeLoja) {
    const primeiro = String(c.nome || '').trim().split(/\s+/)[0] || 'tudo bem';
    if (c.seg.includes('inativos') || c.seg.includes('atrasados')) return `Oi, ${primeiro}! Aqui é da ${nomeLoja}. Faz um tempinho que você não pede e chegou coisa fresquinha esta semana. Quer que eu separe algo para você?`;
    if (c.seg.includes('novos')) return `Oi, ${primeiro}! Aqui é da ${nomeLoja}. Obrigado pelo primeiro pedido! Deu tudo certo com a entrega?`;
    return `Oi, ${primeiro}! Aqui é da ${nomeLoja}. Passando para avisar das novidades desta semana.`;
}
