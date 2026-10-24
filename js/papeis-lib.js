// =====================================================================
//  js/papeis-lib.js — o que cada papel da equipe VÊ no painel.
//
//  Isto só organiza a tela. Quem manda de verdade é o servidor (api/*) e as
//  regras do banco (firestore.rules): esconder uma aba não protege nada.
//  Ao mudar aqui, confira se o servidor e as regras permitem o mesmo.
// =====================================================================
export const PAPEIS = {
    proprietario:  ['Proprietário', 'Tudo, inclusive a equipe.'],
    administrador: ['Administrador', 'Tudo, menos mexer na equipe.'],
    gerente:       ['Gerente', 'Tudo, menos a chave PIX, o PIX automático, o WhatsApp dos pedidos e a equipe. Pode ligar e desligar PIX, cartão e dinheiro.'],
    funcionario:   ['Funcionário', 'Pedidos, balcão, fechamento da feira, calendário e impressora.'],
    caixa:         ['Caixa', 'O balcão, a fila de pedidos e a impressora.'],
    producao:      ['Produção', 'Estoque (produzir, perdas, fichas), calendário e impressora.'],
    estoque:       ['Estoque', 'Estoque, compras, fechamento da feira, calendário e impressora.'],
};
/** Papéis que o proprietário pode dar pelo painel (proprietário só a plataforma define). */
export const ATRIBUIVEIS = ['administrador', 'gerente', 'funcionario', 'caixa', 'producao', 'estoque'];

const ABAS_DA_EQUIPE = {
    funcionario: ['relatorios', 'pdv', 'fechamento', 'calendario', 'impressora'],
    caixa:       ['pdv', 'relatorios', 'impressora'],
    producao:    ['estoque', 'calendario', 'impressora'],
    estoque:     ['estoque', 'compras', 'fechamento', 'calendario', 'impressora'],
};
export const ehGestor = (papel) => ['plataforma', 'proprietario', 'administrador', 'gerente'].includes(papel);
/** Quem pode ver e trocar a chave PIX (onde o dinheiro cai) e o WhatsApp que recebe os pedidos. O gerente só liga/desliga as formas de pagamento. */
export const mexeNaChavePix = (papel) => ['plataforma', 'proprietario', 'administrador'].includes(papel);
export const cuidaDaEquipe = (papel) => papel === 'plataforma' || papel === 'proprietario';
export const cuidaDeEstoque = (papel) => ehGestor(papel) || papel === 'estoque' || papel === 'producao';

// Qual módulo da plataforma liga cada aba (aba fora desta lista está sempre ligada).
export const MODULO_DA_ABA = { pdv: 'pdv', estoque: 'estoque', compras: 'estoque', crm: 'crm', copiloto: 'copiloto', calendario: 'calendario', cupons: 'cupons' };
const ligada = (aba, modulos) => !(modulos && MODULO_DA_ABA[aba] && modulos[MODULO_DA_ABA[aba]] === false);

/** Abas que o papel pode abrir, na ordem em que aparecem. `todas` = ids das abas; `modulos` = ficha.modulos da loja. */
export function abasDoPapel(papel, todas, modulos) {
    const base = ehGestor(papel) ? todas.filter((a) => a !== 'equipe' || cuidaDaEquipe(papel)) : (ABAS_DA_EQUIPE[papel] || []).filter((a) => todas.includes(a));
    return base.filter((a) => ligada(a, modulos));
}
export const podeAbrir = (papel, aba, todas, modulos) => abasDoPapel(papel, todas, modulos).includes(aba);
export const rotuloDoPapel = (papel) => (papel === 'plataforma' ? 'Plataforma' : (PAPEIS[papel] || ['Equipe'])[0]);

/**
 * Bancas desta conta (para o seletor do painel), sem repetir e em ordem. Vem do token, gravado só pelo servidor.
 * Conta com e-mail não confirmado não tem banca nenhuma; a conta antiga { admin: true } é dona da loja original.
 * Só ids válidos, no máximo 30 (ninguém deve ter tantas; o resto não cabe na tela).
 */
export function bancasDaConta(claims) {
    const c = claims || {};
    if (c.email_verified === false) return [];
    const ids = c.tenants && typeof c.tenants === 'object' && !Array.isArray(c.tenants)
        ? Object.keys(c.tenants).filter((id) => PAPEIS[c.tenants[id]]) : [];
    if (c.admin === true) ids.push('banca');
    return [...new Set(ids)].filter((id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(id)).sort().slice(0, 30);
}
