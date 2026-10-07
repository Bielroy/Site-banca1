// Regras puras da tela da plataforma (testadas sem navegador).
/** "Espetinhos do Zé" → "espetinhos-do-ze" (mesma regra de id do servidor: a-z, 0-9 e hífen, 2 a 40). */
export const sugerirId = (nome) => String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
export const idValido = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));
/** Soma do mês de todas as lojas. */
export function totais(lojas) {
    const l = Array.isArray(lojas) ? lojas : [];
    return { lojas: l.length, ativas: l.filter((x) => x.ativo).length, receita: Math.round(l.reduce((t, x) => t + ((x.mes && x.mes.receita) || 0), 0) * 100) / 100, pedidos: l.reduce((t, x) => t + ((x.mes && x.mes.pedidos) || 0), 0) };
}

// ---------------------------------------------------------------------
// FEIRAS POR DIA DA SEMANA
// Cada feira acontece em certos dias (0 = domingo ... 6 = sábado) e tem as
// lojas que vão NAQUELE dia. A mesma loja pode estar em várias feiras.
// Feira sem dia marcado vale para todos os dias (era assim antes).
// ---------------------------------------------------------------------
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Só números inteiros de 0 a 6, sem repetir, em ordem. */
export const limparDias = (dias) => [...new Set((Array.isArray(dias) ? dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
/** "Qua" · "Qua e Sex" · "Todos os dias". */
export const diasEmTexto = (dias) => { const d = limparDias(dias); return !d.length || d.length === 7 ? 'Todos os dias' : d.map((n) => DIAS_SEMANA[n]).join(d.length === 2 ? ' e ' : ', '); };
/**
 * Qual feira vale HOJE para esta loja. Primeiro a que tem o dia marcado; depois a que vale
 * para todos os dias. Se nenhuma acontece hoje, devolve null (a faixa de lojas some).
 */
export function feiraDoDia(feiras, dia) {
    const lista = (Array.isArray(feiras) ? feiras : []).filter((f) => f && Array.isArray(f.lojas));
    const doDia = lista.filter((f) => limparDias(f.dias).includes(dia));
    if (doDia.length) return doDia[0];
    return lista.find((f) => !limparDias(f.dias).length) || null;
}
/** Ids das feiras de uma loja: a lista nova (feiras) mais o campo antigo (feiraId). No máximo 8. */
export const feirasDaFicha = (ficha) => [...new Set([...(ficha && Array.isArray(ficha.feiras) ? ficha.feiras : []), ficha && ficha.feiraId].filter((id) => typeof id === 'string' && idValido(id)))].slice(0, 8);
