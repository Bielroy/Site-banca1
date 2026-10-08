// =====================================================================
//  js/conta-lib.js — CONTA DO CLIENTE: regras puras (testadas sem navegador).
//
//  A conta mora no servidor (lib/conta.js). Aqui fica só a parte de juntar
//  o que voltou do servidor com o que já está guardado no aparelho.
// =====================================================================

/** Formato do código de acesso: id da conta (16) + ponto + segredo (43). */
export const RE_CODIGO = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/;

/** Código que veio no link pessoal ("#a=..."). '' se o endereço não traz um código bem formado. */
export function codigoDoEndereco(hash) {
    const m = /^#a=([^&#]+)$/.exec(String(hash || ''));
    return m && RE_CODIGO.test(m[1]) ? m[1] : '';
}

/**
 * Junta os pedidos do aparelho com os da conta, sem repetir. O que veio do servidor é mais novo
 * (status e valor já pesado), então vence nos campos que os dois têm. Mais recentes primeiro.
 */
export function juntarPedidos(locais, daConta, max = 10) {
    const porId = new Map();
    for (const p of Array.isArray(locais) ? locais : []) if (p && p.id) porId.set(String(p.id), p);
    for (const p of Array.isArray(daConta) ? daConta : []) if (p && p.id) porId.set(String(p.id), { ...(porId.get(String(p.id)) || {}), ...p });
    return [...porId.values()].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))).slice(0, max);
}

/** Nome e endereço no formato que a loja guarda no aparelho. Sem endereço na conta, endereco = null. */
export function perfilParaAparelho(conta) {
    const c = conta || {}, t = (v) => String(v || '').trim();
    const cliente = t(c.nome) ? { nome: t(c.nome), quadra: t(c.quadra), lote: t(c.lote), ...(t(c.telefone) ? { tel: t(c.telefone).replace(/\D/g, '') } : {}) } : null;
    const endereco = t(c.quadra) || t(c.lote) || t(c.condominio)
        ? { condominio: t(c.condominio), condominioId: t(c.condominioId), formatoEndereco: ['rua', 'livre'].includes(c.formatoEndereco) ? c.formatoEndereco : 'ql', quadra: t(c.quadra), lote: t(c.lote) } : null;
    return { cliente, endereco };
}

/** Favoritos: os do aparelho mais os da conta, sem repetir. */
export const unirFavs = (locais, daConta) => [...new Set([...(Array.isArray(locais) ? locais : []), ...(Array.isArray(daConta) ? daConta : [])].filter((x) => typeof x === 'string' && x))];

/** Unidade ou quilo de cada produto: o que está no aparelho vence (é a escolha mais recente). */
export function unirModo(local, daConta) {
    const limpo = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).filter(([, v]) => v === 'un' || v === 'kg'));
    return { ...limpo(daConta), ...limpo(local) };
}

/** A sacola que vai para o servidor: só id, quantidade e tipo (o preço é sempre o de hoje, do cadastro). */
export const sacolaParaGuardar = (carrinho) => (Array.isArray(carrinho) ? carrinho : [])
    .filter((i) => i && i.id != null && Number(i.qtd) > 0).slice(0, 60).map((i) => ({ id: String(i.id), qtd: Number(i.qtd), tipo: i.tipo === 'kg' ? 'kg' : 'un' }));

/** A sacola guardada ainda serve? Depois de 30 dias a pessoa nem lembra do que tinha posto. */
export function sacolaVale(sacola, sacolaEm, agora = Date.now(), dias = 30) {
    const ha = agora - Date.parse(sacolaEm || '');
    return Array.isArray(sacola) && sacola.length > 0 && Number.isFinite(ha) && ha >= 0 && ha <= dias * 86400000;
}

/** Texto do WhatsApp que o dono manda ao cliente com o link novo. */
export function mensagemDoLink(nome, nomeLoja, link) {
    const primeiro = String(nome || '').trim().split(/\s+/)[0];
    return `Oi${primeiro ? ', ' + primeiro : ''}! Aqui é da ${nomeLoja}. Toque no link abaixo para a loja lembrar de você neste celular (nome, endereço e seus pedidos):\n\n${link}\n\nO link é só seu: não repasse para outra pessoa.`;
}

/** Número para o wa.me: só dígitos, com o 55 do Brasil na frente. '' se não parece telefone. */
export function foneParaWhats(tel) {
    const d = String(tel || '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return '';
    return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

/** "62988887777" → "(62) 98888-7777", para o dono conferir o número antes de enviar. */
export function foneBonito(tel) {
    let d = String(tel || '').replace(/\D/g, ''); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
}
