// =====================================================================
//  js/formato-lib.js — FORMATO DA LOJA: loja completa ou SÓ VITRINE.
//
//  Fica na ficha da loja (tenants/{id}.formato), escolhido pela plataforma (Plataforma → Lojas):
//    'loja'     (ou sem campo)  a loja de sempre: carrinho, pedido, checkout. NADA muda para quem não tem o campo.
//    'vitrine'                  catálogo: mostra produto, foto e preço, sem carrinho nem pedido. Cada produto
//                               tem "Pedir no WhatsApp" e o servidor recusa pedido (api/checkout.js).
//  Usado pela loja (js/tema.js, js/loja.js), pela plataforma (js/plataforma.js) e pelo servidor
//  (api/plataforma.js, api/checkout.js, via lib/formato.js, que repete estas regras; um teste confere).
//  Sem dependências: os testes importam direto.
// =====================================================================

export const FORMATOS = {
    loja: 'Loja completa (carrinho e pedidos)',
    vitrine: 'Só vitrine (produtos, preço e WhatsApp)',
};

/** 'vitrine' só quando a ficha diz exatamente isso; qualquer outra coisa (sem ficha, sem campo, valor estranho) é 'loja'. */
export const formatoDaFicha = (ficha) => (ficha && ficha.formato === 'vitrine' ? 'vitrine' : 'loja');
export const ehVitrine = (ficha) => formatoDaFicha(ficha) === 'vitrine';

/** Mensagem do WhatsApp para um produto da vitrine: "Oi, Loja X! Vi no catálogo e quero: Tomate (R$ 7,90 / kg)". */
export function mensagemDoProduto(nomeDaLoja, produto, precoTexto = '') {
    const loja = String(nomeDaLoja || '').trim().slice(0, 60);
    const nome = String((produto && produto.nome) || '').trim().slice(0, 80);
    const preco = String(precoTexto || '').trim().slice(0, 40);
    const oi = loja ? `Oi, ${loja}!` : 'Oi!';
    if (!nome) return `${oi} Vi o catálogo e quero fazer um pedido.`;
    return `${oi} Vi no catálogo e quero: ${nome}${preco ? ` (${preco})` : ''}`;
}
