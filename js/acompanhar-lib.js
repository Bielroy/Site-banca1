// =====================================================================
//  js/acompanhar-lib.js — o pedido NA TELA DO CLIENTE (contas puras, sem tela, testáveis).
//
//  Depois de pedir, a pessoa não precisa abrir "Meus pedidos": uma faixa fica na tela da loja
//  mostrando em que pé está o pedido, e muda sozinha (js/acompanhar-loja.js ouve o banco).
//  Pedido PARA RETIRAR que fica pronto mostra a senha grande (lib/senha.js).
//
//  A plaquinha da banca (NFC ou QR Code) abre sempre o MESMO link, com ?placa. O que aparece
//  depende do pedido deste aparelho: nenhum aberto = cardápio; PIX para pagar = o PIX com o
//  valor; pronto = a senha.
// =====================================================================

export const FINAIS = ['arquivado', 'cancelado'];
const HORAS_ACOMPANHA = 36;          // pedido mais velho que isso sai da faixa (pedido para outro dia: até o dia seguinte)
const MAX_ACOMPANHA = 3;

export const ehRetirada = (p) => !!p && p.modo === 'retirada';
export const pagoPeloSite = (p) => !!(p && p.pagamento && p.pagamento.status === 'PAID');
const senhaValida = (s) => /^\d{3}$/.test(String(s || ''));

/** As etapas da linha do tempo: retirada termina em "Pronto"; entrega, em "A caminho". */
export function etapasDoPedido(p) {
    return ehRetirada(p)
        ? [{ chave: 'recebido', rotulo: 'Recebido' }, { chave: 'separando', rotulo: 'Separando' }, { chave: 'pronto', rotulo: 'Pronto' }]
        : [{ chave: 'recebido', rotulo: 'Recebido' }, { chave: 'separando', rotulo: 'Separando' }, { chave: 'a_caminho', rotulo: 'A caminho' }];
}

/** Em qual etapa (0, 1 ou 2) está o status do banco. */
export function passoDoStatus(status) {
    if (status === 'enviado' || status === 'arquivado') return 2;
    if (status === 'preparando' || status === 'aguardando_pesagem') return 1;
    return 0;
}

/** O nome do status para o cliente. Retirada: "enviado" quer dizer "pronto para retirar". */
export function rotuloDoStatus(p) {
    const s = p && p.status, ret = ehRetirada(p);
    if (s === 'enviado') return ret ? 'Pronto para retirar' : 'Saiu para entrega';
    if (s === 'arquivado') return ret ? 'Retirado' : 'Entregue';
    return ({ pendente: 'Pedido recebido', aguardando_pagamento: 'Aguardando o pagamento', aguardando_pesagem: 'Na balança', preparando: 'Separando seu pedido', cancelado: 'Pedido cancelado' })[s] || 'Pedido recebido';
}

/**
 * O que a faixa mostra para este pedido.
 * tom: 'espera' | 'pagar' | 'separando' | 'pronto' | 'caminho' | 'fim' | 'cancelado'
 */
export function acompanhamento(p) {
    const s = p && p.status, ret = ehRetirada(p), senha = senhaValida(p && p.senha) && s === 'enviado' && ret ? String(p.senha) : '';
    const base = { status: s, retirada: ret, senha, passo: passoDoStatus(s), etapas: etapasDoPedido(p), titulo: rotuloDoStatus(p), pago: pagoPeloSite(p) };
    if (s === 'cancelado') return { ...base, tom: 'cancelado', ativo: false, texto: 'A banca cancelou este pedido.' };
    if (s === 'arquivado') return { ...base, tom: 'fim', ativo: false, texto: ret ? 'Pedido retirado. Obrigado!' : 'Pedido entregue. Obrigado!' };
    if (s === 'enviado' && ret) return { ...base, tom: 'pronto', ativo: true, titulo: 'Seu pedido está pronto!', texto: senha ? `Pode retirar. Sua senha é ${senha}.` : 'Pode ir buscar.' };
    if (s === 'enviado') return { ...base, tom: 'caminho', ativo: true, texto: 'Seu pedido saiu para entrega.' };
    if (s === 'preparando') return { ...base, tom: 'separando', ativo: true, texto: ret ? 'A banca está separando. Avisamos aqui quando ficar pronto.' : 'A banca está separando seu pedido.' };
    if (s === 'aguardando_pesagem') return { ...base, tom: 'separando', ativo: true, texto: 'Seus itens estão sendo pesados para fechar o valor.' };
    if (s === 'aguardando_pagamento' && !base.pago) return { ...base, tom: 'pagar', ativo: true, texto: 'Falta o pagamento para a banca começar.' };
    return { ...base, tom: 'espera', ativo: true, texto: 'A banca recebeu seu pedido.' };
}

/** Os pedidos deste aparelho que valem a faixa: os mais novos, ainda abertos, de até 36 h. */
export function pedidosParaAcompanhar(lista, agora = Date.now()) {
    return (Array.isArray(lista) ? lista : [])
        .filter((p) => p && p.id && !p.cancelado && !FINAIS.includes(p.status))
        .filter((p) => { const t = Date.parse(p.data); return Number.isFinite(t) && agora - t < HORAS_ACOMPANHA * 3600000 && agora - t > -3600000; })
        .slice(0, MAX_ACOMPANHA)
        .map((p) => String(p.id));
}

/** Deve tocar o aviso? Quando o pedido FICA pronto, ou quando a banca chama a senha de novo. */
export function chamouAgora(antes, depois) {
    if (!depois || !ehRetirada(depois) || depois.status !== 'enviado') return false;
    if (!antes) return false;                                       // primeira leitura (abriu a página com ele já pronto): só mostra, sem tocar
    if (antes.status !== 'enviado') return true;
    const va = Number(antes.chamada && antes.chamada.vezes) || 0, vd = Number(depois.chamada && depois.chamada.vezes) || 0;
    return vd > va;
}

/** Pedido com PIX ainda por pagar pelo site (a tela de pagamento decide se mostra o código). */
export function temPixParaPagar(p) {
    return !!p && String(p.pag || '').toUpperCase() === 'PIX' && !pagoPeloSite(p) && !p.temItensAPesar && !FINAIS.includes(p.status);
}

/** A banca acabou de pesar e o PIX ficou liberado (com o valor fechado da balança): vale um aviso curto. */
export function pixLiberouAgora(antes, depois) {
    return !!antes && !!antes.temItensAPesar && temPixParaPagar(depois);
}

/**
 * A pessoa encostou o celular na plaquinha (ou leu o QR Code): o que abrir.
 * pedidos = os pedidos deste aparelho, já lidos do banco (o mais novo primeiro).
 *   'cardapio'   nenhum pedido aberto: a loja normal.
 *   'pronto'     um pedido pronto para retirar: a senha.
 *   'pagar'      um pedido com PIX por pagar: o código com o valor.
 *   'acompanhar' tem pedido aberto: a faixa aberta, com a etapa.
 */
export function oQueAPlacaAbre(pedidos) {
    const abertos = (Array.isArray(pedidos) ? pedidos : []).filter((p) => p && acompanhamento(p).ativo);
    if (!abertos.length) return { tela: 'cardapio', pedido: null };
    const pronto = abertos.find((p) => acompanhamento(p).tom === 'pronto');
    if (pronto) return { tela: 'pronto', pedido: pronto };
    const pagar = abertos.find(temPixParaPagar);
    if (pagar) return { tela: 'pagar', pedido: pagar };
    return { tela: 'acompanhar', pedido: abertos[0] };
}

/** O link da plaquinha desta loja: o endereço da loja com ?placa. */
export function linkDaPlaca(urlDaLoja) {
    try { const u = new URL(String(urlDaLoja)); u.searchParams.set('placa', '1'); u.hash = ''; return u.toString(); } catch (_) { return ''; }
}
