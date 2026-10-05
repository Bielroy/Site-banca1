// Regras puras da tela da plataforma (testadas sem navegador).
/** "Espetinhos do Zé" → "espetinhos-do-ze" (mesma regra de id do servidor: a-z, 0-9 e hífen, 2 a 40). */
export const sugerirId = (nome) => String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
export const idValido = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));
/** Soma do mês de todas as lojas. */
export function totais(lojas) {
    const l = Array.isArray(lojas) ? lojas : [];
    return { lojas: l.length, ativas: l.filter((x) => x.ativo).length, receita: Math.round(l.reduce((t, x) => t + ((x.mes && x.mes.receita) || 0), 0) * 100) / 100, pedidos: l.reduce((t, x) => t + ((x.mes && x.mes.pedidos) || 0), 0) };
}
