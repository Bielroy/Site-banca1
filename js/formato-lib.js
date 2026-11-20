// =====================================================================
//  js/formato-lib.js — FORMATO DA LOJA: loja completa ou SÓ VITRINE.
//
//  Fica na ficha da loja (tenants/{id}.formato), escolhido pela plataforma (Plataforma → Lojas):
//    'loja'     (ou sem campo)  a loja de sempre: carrinho, pedido, checkout. NADA muda para quem não tem o campo.
//    'vitrine'                  catálogo: mostra produto, foto e preço, sem carrinho nem pedido. Cada produto
//                               tem "Pedir no WhatsApp" e o servidor recusa pedido (api/checkout.js).
//    'whatsapp'                 SACOLA NO WHATSAPP: o cliente monta a sacola como na loja completa, mas o único jeito
//                               de fechar é "Finalizar no WhatsApp": a mensagem vai pronta para o WhatsApp do dono
//                               (itens, total, nome). Não vira pedido no painel e o servidor recusa pedido pelo site.
//  Usado pela loja (js/tema.js, js/loja.js), pela plataforma (js/plataforma.js) e pelo servidor
//  (api/plataforma.js, api/checkout.js, via lib/formato.js, que repete estas regras; um teste confere).
//  Sem dependências: os testes importam direto.
// =====================================================================

export const FORMATOS = {
    loja: 'Loja completa (carrinho e pedidos)',
    whatsapp: 'Sacola no WhatsApp (o cliente monta a sacola e envia no WhatsApp)',
    vitrine: 'Só vitrine (produtos, preço e WhatsApp)',
};

/** 'vitrine' ou 'whatsapp' só quando a ficha diz exatamente isso; qualquer outra coisa (sem ficha, sem campo, valor estranho) é 'loja'. */
export const formatoDaFicha = (ficha) => (ficha && (ficha.formato === 'vitrine' || ficha.formato === 'whatsapp') ? ficha.formato : 'loja');
export const ehVitrine = (ficha) => formatoDaFicha(ficha) === 'vitrine';
/** Loja que NÃO recebe pedido pelo site (só vitrine ou sacola no WhatsApp): o painel fica sem as abas de pedido. */
export const semPedidoNoSite = (formato) => formato === 'vitrine' || formato === 'whatsapp';

const limpoF = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const reaisF = (n) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')}`;
/**
 * Mensagem da SACOLA NO WHATSAPP (formato 'whatsapp'): curta, só o que o dono precisa para responder.
 *   itens = [{ nome, qtd, tipo: 'un'|'kg', aPesar, subtotal, adicionais }]; total; aproximado (tem item por peso); nome; obs
 */
export function mensagemDaSacola({ loja = '', itens = [], total = 0, aproximado = false, nome = '', obs = '' } = {}) {
    const l = [`Oi${loja ? `, ${limpoF(loja, 60)}` : ''}! Quero fazer este pedido:`, ''];
    for (const i of (Array.isArray(itens) ? itens : []).slice(0, 120)) {
        const q = Number(i.qtd) || 0, n = String(Math.round(q * 1000) / 1000).replace('.', ',');
        const qtd = i.tipo === 'kg' ? `${n} kg` : `${n}x`;
        const valor = i.aPesar ? ' (a pesar)' : Number(i.subtotal) > 0 ? ` — ${reaisF(i.subtotal)}` : '';
        l.push(`• ${qtd} ${limpoF(i.nome, 80)}${i.adicionais ? ` (${limpoF(i.adicionais, 120)})` : ''}${valor}`);
    }
    l.push('');
    if (Number(total) > 0) l.push(`*${aproximado ? 'Total estimado: ≈ ' : 'Total: '}${reaisF(total)}*`);
    if (limpoF(nome, 80)) l.push(`Nome: ${limpoF(nome, 80)}`);
    if (limpoF(obs, 400)) l.push(`Obs.: ${limpoF(obs, 400)}`);
    return l.join('\n').replace(/\n+$/, '');
}

/** Mensagem do WhatsApp para um produto da vitrine: "Oi, Loja X! Vi no catálogo e quero: Tomate (R$ 7,90 / kg)". */
export function mensagemDoProduto(nomeDaLoja, produto, precoTexto = '') {
    const loja = String(nomeDaLoja || '').trim().slice(0, 60);
    const nome = String((produto && produto.nome) || '').trim().slice(0, 80);
    const preco = String(precoTexto || '').trim().slice(0, 40);
    const oi = loja ? `Oi, ${loja}!` : 'Oi!';
    if (!nome) return `${oi} Vi o catálogo e quero fazer um pedido.`;
    return `${oi} Vi no catálogo e quero: ${nome}${preco ? ` (${preco})` : ''}`;
}
