// =====================================================================
//  js/mensagem-lib.js — TEXTOS QUE A BANCA MANDA AO CLIENTE PELO WHATSAPP
//  (puro: sem tela e sem Firebase, para poder ser testado em testes/index.js).
//
//  Um estilo só, sóbrio: o nome da loja em cima, um resumo que se lê de relance,
//  a conta em linhas e um fecho curto. Negrito com *asteriscos* e itálico com
//  _sublinhados_ (formatação do WhatsApp). Sem enfeite: quem lê está no celular.
//
//    mensagemPedidoPronto(d)   pedido separado, pesado e conferido
//    mensagemDeAjuste(d)       item que faltou e saiu / item acrescentado depois
//    mensagemACaminho(d)       pedido saiu para entrega (ou está pronto para retirada)
//
//  d = { loja, pedido, endereco, conta?: { itens, desconto, entrega, total } }
//  Os itens e os registros (pedido.ajustes) vêm do pedido como o servidor gravou.
// =====================================================================
const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (n) => REAIS.format(Number(n) || 0).replace(/ /g, ' ');
const numero = (n) => String(Number(n) || 0).replace('.', ',');
const POR_PESO = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const ehPorPeso = (un) => POR_PESO.includes(String(un || '').toLowerCase());
const RISCO = '──────────────';

/** "maria clara souza" → "Maria" (só o primeiro nome, com maiúscula). */
export function primeiroNome(nomeCompleto) {
    const p = String(nomeCompleto || '').trim().split(/\s+/)[0] || '';
    return p ? p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR') : '';
}

/** Valor do item: o peso da balança × preço, ou o valor fechado que o servidor calculou. */
export function valorDoItem(i) {
    if (!i) return 0;
    if (Number(i.pesoFinal) > 0 && i.tipo === 'un' && ehPorPeso(i.unidade)) return Math.round(Number(i.pesoFinal) * (Number(i.precoOriginal) || 0) * 100) / 100;
    if (i.aPesar) return 0;
    return Number(i.subtotal) > 0 ? Number(i.subtotal) : Math.round((Number(i.precoOriginal ?? i.preco) || 0) * (Number(i.qtd) || 0) * 100) / 100;
}

/** "1,25 kg × R$ 8,90" · "3 un, 1,25 kg × R$ 8,90" · "2 un" · "a pesar" */
export function detalheDoItem(i) {
    const un = String(i.unidade || 'un').toLowerCase(), preco = Number(i.precoOriginal ?? i.preco) || 0;
    if (i.aPesar && !(Number(i.pesoFinal) > 0)) return `${numero(i.qtd)} un · valor depois da balança`;
    if (Number(i.pesoFinal) > 0 && i.tipo === 'un' && ehPorPeso(i.unidade)) return `${numero(i.qtd)} un · ${numero(i.pesoFinal)} kg × ${dinheiro(preco)}`;
    if (i.tipo === 'kg' || (ehPorPeso(i.unidade) && i.tipo !== 'un')) return `${numero(i.qtd)} ${un} × ${dinheiro(preco)}`;
    const q = Number(i.qtd) || 0;
    return q > 1 && preco > 0 && !i.promo ? `${numero(q)} × ${dinheiro(preco)}` : `${numero(q)} un`;
}

const linhasDosItens = (itens) => {
    const L = [];
    (itens || []).forEach((i) => {
        const v = valorDoItem(i);
        L.push(`• *${String(i.nome || 'Produto').trim()}*`);
        L.push(`  ${detalheDoItem(i)}${v > 0 ? ` · *${dinheiro(v)}*` : ''}`);
        if (i.adicionais) L.push(`  _${String(i.adicionais).trim()}_`);
    });
    return L;
};

// a conta em linhas; quando o pedido não tem cupom nem entrega, sai só o total
const linhasDaConta = (pedido, conta, itens) => {
    const somaItens = conta && Number.isFinite(Number(conta.itens)) ? Number(conta.itens) : (itens || []).reduce((t, i) => t + valorDoItem(i), 0);
    const desconto = conta ? Number(conta.desconto) || 0 : Number(pedido.cupom && pedido.cupom.desconto) || 0;
    const entrega = conta ? Number(conta.entrega) || 0 : Number(pedido.entrega && pedido.entrega.taxa) || 0;
    const total = conta && Number.isFinite(Number(conta.total)) ? Number(conta.total) : Number(pedido.total) || 0;
    const L = [];
    if (desconto > 0 || entrega > 0) L.push(`Itens: ${dinheiro(somaItens)}`);
    if (desconto > 0) L.push(`Cupom${pedido.cupom && pedido.cupom.codigo ? ` ${pedido.cupom.codigo}` : ''}: − ${dinheiro(desconto)}`);
    if (entrega > 0) L.push(`Entrega: ${dinheiro(entrega)}`);
    L.push(`*Total: ${dinheiro(total)}*`);
    return { linhas: L, total };
};

const pagoPeloSite = (pedido) => !!(pedido.pagamento && pedido.pagamento.status === 'PAID');

// pagamento, horário, endereço e observação: o que o cliente confere antes de receber
const linhasDaEntrega = (pedido, endereco, { diferenca = 0 } = {}) => {
    const L = [], retirada = pedido.modo === 'retirada';
    L.push(`Pagamento: ${pedido.pag || 'a combinar'}${pagoPeloSite(pedido) ? ' (já recebido)' : ''}`);
    if (pagoPeloSite(pedido) && diferenca > 0) L.push(`Falta acertar na entrega: *${dinheiro(diferenca)}*`);
    if (pagoPeloSite(pedido) && diferenca < 0) L.push(`Vamos devolver a diferença: *${dinheiro(-diferenca)}*`);
    if (pedido.troco) L.push(`Troco para: ${pedido.troco}`);
    const hora = pedido.entrega && (pedido.entrega.horario || (pedido.entrega.horarioACombinar ? 'horário a combinar' : ''));
    if (hora) L.push(`${retirada ? 'Retirada' : 'Entrega'}: ${hora}`);
    if (retirada) L.push(`${pedido.feiraId ? 'Retirada na feira' : 'Retirada na banca'}${pedido.retiradaLocal ? `: ${pedido.retiradaLocal}` : ''}`);
    else if (endereco) L.push(`Endereço: ${endereco}`);
    if (pedido.obs) L.push(`Observação: ${pedido.obs}`);
    return L;
};

const lista = (nomes) => (nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

/** Registros de itens tirados (pedido.ajustes), sem os que voltaram ao pedido depois. */
export function itensTirados(pedido) {
    return (Array.isArray(pedido && pedido.ajustes) ? pedido.ajustes : []).filter((a) => a && a.op === 'tirou' && a.nome);
}

// o pedido de desculpas pelo que faltou; vai em itálico, antes do fecho
const avisoDeFalta = (tirados) => {
    if (!tirados.length) return [];
    const nomes = [...new Set(tirados.map((a) => String(a.nome).trim()))];
    const um = nomes.length === 1;
    return ['', `_${um ? 'Ficou' : 'Ficaram'} de fora: ${lista(nomes)}. ${um ? 'Estava em falta' : 'Estavam em falta'} hoje e não conseguimos enviar. Pedimos desculpas pelo transtorno._`];
};

const cabecalho = (loja, pedido, frase) => {
    const nome = primeiroNome(pedido.nome);
    return [`*${String(loja || 'Nossa loja').trim()}*`, '', `Olá${nome ? `, ${nome}` : ''}! ${frase}`];
};
const FECHO = ['', 'Obrigado pela preferência!', 'Qualquer ajuste, é só responder esta mensagem.'];

/** Pedido separado, pesado e conferido: o resumo com os valores finais. */
export function mensagemPedidoPronto({ loja, pedido, endereco = '', conta = null, itens = null, diferenca = 0 }) {
    const lin = itens || pedido.itens || [], c = linhasDaConta(pedido, conta, lin);
    return [
        ...cabecalho(loja, pedido, 'Seu pedido está separado e conferido.'),
        '', '*Resumo do pedido*', '', ...linhasDosItens(lin),
        '', RISCO, ...c.linhas,
        '', ...linhasDaEntrega(pedido, endereco, { diferenca }),
        ...avisoDeFalta(itensTirados(pedido)),
        ...FECHO,
    ].join('\n');
}

/**
 * Aviso de mudança no pedido. `tirados` e `acrescentados` são os registros que o servidor
 * devolveu (ou os de pedido.ajustes). Diz o que mudou, o total novo e, se já estava pago, o acerto.
 */
export function mensagemDeAjuste({ loja, pedido, tirados = [], acrescentados = [], total = null, diferenca = 0 }) {
    const novoTotal = Number.isFinite(Number(total)) ? Number(total) : Number(pedido.total) || 0;
    const L = [...cabecalho(loja, pedido, tirados.length && !acrescentados.length ? 'Precisamos avisar de uma mudança no seu pedido.' : 'Atualizamos o seu pedido.')];
    if (tirados.length) {
        const nomes = [...new Set(tirados.map((a) => String(a.nome).trim()))], um = nomes.length === 1;
        L.push('', `Infelizmente ${um ? 'o item abaixo está' : 'os itens abaixo estão'} em falta hoje e ${um ? 'saiu' : 'saíram'} do pedido:`);
        tirados.forEach((a) => L.push(`• *${String(a.nome).trim()}*${a.qtd ? ` (${a.qtd})` : ''}${Number(a.valor) > 0 ? ` · − ${dinheiro(a.valor)}` : ''}`));
        L.push('', 'Pedimos desculpas pelo transtorno.');
    }
    if (acrescentados.length) {
        L.push('', acrescentados.length === 1 ? 'Acrescentamos o que você pediu:' : 'Acrescentamos o que você pediu:');
        acrescentados.forEach((a) => L.push(`• *${String(a.nome).trim()}*${a.qtd ? ` (${a.qtd})` : ''}${a.aPesar ? ' · valor depois da balança' : (Number(a.valor) > 0 ? ` · + ${dinheiro(a.valor)}` : '')}`));
    }
    L.push('', RISCO, `*Novo total: ${dinheiro(novoTotal)}*`);
    if (pagoPeloSite(pedido) && diferenca > 0) L.push(`Você já pagou pelo site. Falta acertar na entrega: *${dinheiro(diferenca)}*`);
    if (pagoPeloSite(pedido) && diferenca < 0) L.push(`Você já pagou pelo site. Vamos devolver a diferença: *${dinheiro(-diferenca)}*`);
    L.push('', tirados.length ? 'Se preferir trocar por outro produto, é só responder esta mensagem.' : 'Qualquer ajuste, é só responder esta mensagem.');
    return L.join('\n');
}

/** Pedido saiu para entrega (ou ficou pronto para retirada). Curto: quem lê quer saber "quando" e "quanto". */
export function mensagemACaminho({ loja, pedido, endereco = '' }) {
    const retirada = pedido.modo === 'retirada';
    const L = [...cabecalho(loja, pedido, retirada ? 'Seu pedido está pronto para retirada.' : 'Seu pedido saiu para entrega.')];
    L.push('', `*Total: ${dinheiro(pedido.total)}*`, ...linhasDaEntrega(pedido, endereco), ...FECHO);
    return L.join('\n');
}

/** Link do WhatsApp com o texto. Sem telefone, abre a escolha de contato. */
export function linkDoWhatsApp(telefone, texto) {
    const fone = String(telefone || '').replace(/\D/g, '');
    const para = fone ? (fone.startsWith('55') && fone.length >= 12 ? fone : `55${fone}`) : '';
    return `https://wa.me/${para}?text=${encodeURIComponent(texto)}`;
}
