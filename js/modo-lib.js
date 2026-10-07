// =====================================================================
//  js/modo-lib.js — UNIDADE ou QUILO direto no card (regras puras, testadas).
//
//  Produto vendido por quilo pode ser pedido de dois jeitos: por unidade
//  (pesada na hora) ou por quilo. O card mostra os DOIS botões, cada um
//  dizendo o que põe no pedido e quanto custa. Antes só existia "Adicionar",
//  que punha 1 unidade sem avisar, e para pedir por quilo era preciso abrir
//  a tela do produto.
//
//  Qual botão vem em cima (cheio):
//    1º  o que ESTE cliente escolheu da última vez para o produto (fica no aparelho);
//    2º  o que a loja marcou no cadastro (campo "Mostrar primeiro");
//    3º  unidade.
// =====================================================================
const QUILO = ['kg', 'kilo', 'quilograma'];
const MODOS = ['un', 'kg'];
/** Passo do quilo no card: meio quilo por toque (na tela do produto dá para ajustar fino). */
export const PASSO_KG = 0.5;

/** Só produto vendido por QUILO ganha os dois botões (grama e litro continuam com um). */
export const temDoisModos = (p) => !!p && QUILO.includes(String(p.unidade || '').toLowerCase()) && Number(p.preco) > 0;

/** O jeito que aparece em cima. `memoria` = { idDoProduto: 'un' | 'kg' } guardado no aparelho. */
export function modoPreferido(p, memoria) {
    if (!temDoisModos(p)) return 'un';
    const doCliente = memoria && typeof memoria === 'object' && Object.prototype.hasOwnProperty.call(memoria, p.id) ? memoria[p.id] : null;
    if (MODOS.includes(doCliente)) return doCliente;
    return p.mostrarPrimeiro === 'kg' ? 'kg' : 'un';
}

/** Memória lida do aparelho: só id simples com 'un' ou 'kg', no máximo 400 produtos. */
export function limparMemoria(bruto) {
    const limpa = {};
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return limpa;
    Object.keys(bruto).slice(0, 400).forEach((id) => { if (/^[\w-]{1,80}$/.test(id) && MODOS.includes(bruto[id])) limpa[id] = bruto[id]; });
    return limpa;
}

const reais = (v) => `R$ ${(Math.round(Number(v) * 100) / 100).toFixed(2).replace('.', ',')}`;
/** Preço estimado de UMA unidade (peso médio do cadastro), ou null se a loja não informou o peso. */
export const precoDaUnidade = (p) => { const pm = Number(p && p.pesoMedio) || 0; return pm > 0 ? Number(p.preco) * pm / 1000 : null; };

/** Os dois botões do card, na ordem em que aparecem. */
export function botoesDoCard(p, memoria) {
    const un = precoDaUnidade(p);
    const B = {
        un: { modo: 'un', titulo: '+ 1 unidade', preco: un == null ? 'pesamos na hora' : `≈ ${reais(un)}`, fala: `Adicionar 1 unidade de ${p.nome}` },
        kg: { modo: 'kg', titulo: '+ 1 kg', preco: reais(p.preco), fala: `Adicionar 1 quilo de ${p.nome}` },
    };
    return modoPreferido(p, memoria) === 'kg' ? [B.kg, B.un] : [B.un, B.kg];
}

const virgula = (n) => String(Math.round(Number(n) * 1000) / 1000).replace('.', ',');
/** Texto do contador depois que o produto entrou no pedido: "2 unidades" / "1,5 kg" e o valor embaixo. `curto` ("2 un") é para card estreito. */
export function textoNoPedido(p, item) {
    const qtd = Number(item && item.qtd) || 0;
    if (item && item.tipo === 'kg') return { titulo: `${virgula(qtd)} kg`, curto: `${virgula(qtd)} kg`, valor: reais(Number(p.preco) * qtd) };
    const un = precoDaUnidade(p);
    return { titulo: `${Math.round(qtd)} ${Math.round(qtd) === 1 ? 'unidade' : 'unidades'}`, curto: `${Math.round(qtd)} un`, valor: un == null ? 'a pesar' : `≈ ${reais(un * qtd)}` };
}

/** Próxima quantidade ao tocar em + ou − no card. 0 = sai do pedido. */
export function proximaQtd(item, direcao) {
    const qtd = Number(item && item.qtd) || 0, passo = item && item.tipo === 'kg' ? PASSO_KG : 1;
    const nova = Math.round((qtd + (direcao > 0 ? passo : -passo)) * 1000) / 1000;
    return nova > 0.0001 ? Math.min(nova, 999) : 0;
}
