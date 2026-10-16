// =====================================================================
//  js/produtos-lista-lib.js — regras da LISTA DE PRODUTOS do painel (sem tela).
//
//  Botões de categoria em cima da lista (Temperos, Verduras, Folhas...):
//  quais aparecem, em que ordem e quantos produtos cada um tem.
//  E o que muda quando vários produtos são escolhidos de uma vez.
//  A tela fica em js/admin.js (renderProdutos).
// =====================================================================
export const TODAS = '__todas__';
export const SEM_CATEGORIA = '__sem__';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Chave da categoria do produto, do jeito que os botões comparam ('' vira SEM_CATEGORIA). */
export const categoriaDoProduto = (p) => norm(p && p.cat) || SEM_CATEGORIA;

/**
 * Botões de categoria para a lista.
 * produtos: os que passaram na busca. ordem: chaves das categorias na ordem da aba Categorias.
 * nomeDe(chave) → nome que o dono vê. Devolve [{ chave, nome, n }], só categorias com produto,
 * na ordem da aba Categorias; as que não estão lá vêm depois, por nome; "Sem categoria" no fim.
 */
export function categoriasDaLista(produtos, ordem = [], nomeDe = (c) => c) {
    const conta = new Map(), original = new Map();
    for (const p of produtos || []) {
        const k = categoriaDoProduto(p);
        conta.set(k, (conta.get(k) || 0) + 1);
        if (!original.has(k) && k !== SEM_CATEGORIA) original.set(k, String(p.cat).trim());
    }
    const pos = new Map(); (ordem || []).forEach((c, i) => { const k = norm(c); if (!pos.has(k)) pos.set(k, i); });
    const maiuscula = (t) => t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);
    const nome = (k) => (k === SEM_CATEGORIA ? 'Sem categoria' : maiuscula(String(nomeDe(original.get(k)) || original.get(k) || k)));
    return [...conta.keys()]
        .map((k) => ({ chave: k, nome: nome(k), n: conta.get(k) }))
        .sort((a, b) => {
            if (a.chave === SEM_CATEGORIA || b.chave === SEM_CATEGORIA) return a.chave === SEM_CATEGORIA ? 1 : -1;
            const pa = pos.has(a.chave) ? pos.get(a.chave) : Infinity, pb = pos.has(b.chave) ? pos.get(b.chave) : Infinity;
            return pa - pb || a.nome.localeCompare(b.nome, 'pt-BR');
        });
}

/** O produto passa no botão de categoria escolhido? */
export const passaNaCategoria = (p, cat) => !cat || cat === TODAS || categoriaDoProduto(p) === cat;

/**
 * O que gravar em cada produto escolhido, para uma ação em lote.
 * acao: 'loja' (pôr à venda) | 'fora' (tirar da loja) | 'chegou' (chegou hoje: põe à venda e marca o selo).
 * Devolve [{ id, dados }] só dos que mudam. "Só ingrediente" não vai para a loja.
 */
export function mudancasEmLote(produtos, acao, hoje, agora = Date.now()) {
    const out = [];
    for (const p of produtos || []) {
        if (!p || !p.id || p.soInsumo === true) continue;
        let dados = null;
        if (acao === 'loja' && !p.ativo) dados = { ativo: true };
        else if (acao === 'fora' && p.ativo) dados = { ativo: false };
        else if (acao === 'chegou' && (!p.ativo || p.chegouEm !== hoje)) dados = { ativo: true, chegouEm: hoje };
        if (dados) out.push({ id: p.id, dados: { ...dados, ultimaModificacao: agora } });
    }
    return out;
}
