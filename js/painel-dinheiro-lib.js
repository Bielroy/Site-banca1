// =====================================================================
//  js/painel-dinheiro-lib.js — DINHEIRO E FILA DO PAINEL (contas puras, sem tela, testáveis).
//
//  PIX pela chave da loja: o site não sabe quando o dinheiro cai. Quem sabe é a equipe, olhando o app
//  do banco e tocando "PIX recebido" (api/pdv.js, op 'pix-recebido'). Antes, todo pedido concluído
//  (arquivado) contava no Balanço como "recebido", mesmo o PIX que ninguém conferiu. Aqui fica a regra:
//    - PIX pago pelo banco (PIX automático) ou conferido pela equipe = recebido;
//    - PIX concluído sem conferência = "PIX não conferido" (linha própria no Balanço, com a lista);
//    - PIX ainda em andamento = "a receber".
//  Também: o que "Arquivar todos" pode levar, o nome da aba de cada etapa e o aviso de erro em português simples.
// =====================================================================

const centavos = (v) => Math.round((Number(v) || 0) * 100);
const reais = (c) => Math.round(c) / 100;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Pedido pago por PIX (pela chave ou automático). */
export const ehPix = (p) => !!p && String(p.pag || '').toUpperCase() === 'PIX';
/** PIX automático: o banco confirmou. */
export const pagoPeloBanco = (p) => !!(p && p.pagamento && p.pagamento.status === 'PAID');
/** Quanto a equipe marcou como recebido no PIX pela chave (0 = nada conferido). */
export const valorConferido = (p) => (p && p.pixConferido && p.pixConferido.em ? Number(p.pixConferido.valor) || 0 : 0);

/**
 * Este pedido tem PIX que ninguém conferiu (ou conferido a menos do que o total de agora)?
 * Venda de balcão fica de fora: a pessoa da banca viu o PIX na hora, com o cliente na frente.
 */
export function pixSemConferencia(p) {
    if (!ehPix(p) || p.origem === 'balcao' || p.status === 'cancelado') return false;
    if (pagoPeloBanco(p) || !(centavos(p.total) > 0)) return false;
    return centavos(valorConferido(p)) < centavos(p.total);
}
/** Quanto falta conferir deste PIX, em reais (0 = nada). */
export const faltaConferir = (p) => (pixSemConferencia(p) ? reais(centavos(p.total) - centavos(valorConferido(p))) : 0);

/** Dia do pedido para o caixa e para a fila: o da ENTREGA (pedido para outro dia) ou o dia (Brasília) em que foi feito. */
export function diaDoPedido(p) {
    if (p && DIA.test(String(p.entregaDia || ''))) return p.entregaDia;
    const t = Date.parse(p && p.data);
    return Number.isFinite(t) ? new Date(t - 3 * 3600000).toISOString().slice(0, 10) : '';
}

/**
 * Onde está o dinheiro dos pedidos do período (cancelado fica fora).
 *   jaPago           PIX automático confirmado + PIX pela chave conferido pela equipe
 *   naEntrega        pedido concluído pago na entrega/retirada (dinheiro, cartão) e venda de balcão
 *   pixNaoConferido  PIX de pedido CONCLUÍDO que ninguém conferiu no banco (não é "recebido")
 *   aReceber         pedido ainda em andamento
 *   listaPixNaoConferido  [{ id, nome, dia, falta }] do mais novo para o mais velho
 */
export function dinheiroDoPeriodo(pedidos) {
    let jaPago = 0, naEntrega = 0, pixNaoConferido = 0, aReceber = 0;
    const lista = [];
    for (const p of Array.isArray(pedidos) ? pedidos : []) {
        if (!p || p.status === 'cancelado') continue;
        const v = centavos(p.total);
        if (pagoPeloBanco(p)) { jaPago += v; continue; }
        if (pixSemConferencia(p)) {
            const conf = Math.min(v, centavos(valorConferido(p))), resto = v - conf;
            jaPago += conf;
            if (p.status === 'arquivado') { pixNaoConferido += resto; lista.push({ id: String(p.id || ''), nome: String(p.nome || 'Cliente'), dia: diaDoPedido(p), falta: reais(resto) }); }
            else aReceber += resto;
            continue;
        }
        if (ehPix(p) && valorConferido(p) > 0) { jaPago += v; continue; }
        if (p.origem === 'balcao' || p.status === 'arquivado') naEntrega += v; else aReceber += v;
    }
    lista.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));
    return { jaPago: reais(jaPago), naEntrega: reais(naEntrega), pixNaoConferido: reais(pixNaoConferido), aReceber: reais(aReceber), listaPixNaoConferido: lista };
}

/**
 * "Arquivar todos" (fim do expediente): só leva o que SAIU PARA ENTREGA (status 'enviado', modo entrega) com o dia de
 * entrega HOJE ou antes. RETIRADA pronta ('enviado' + modo 'retirada') NUNCA vai no lote: "pronto" não quer dizer que
 * o cliente buscou; ela só sai da fila pelo "Cliente retirou" do cartão. O resto fica, e a pessoa fica sabendo por quê.
 *   { arquivar: [pedidos], naoSairam: n, outroDia: n, retiradasProntas: n }
 */
export function separarParaArquivar(pedidos, hoje) {
    const arquivar = []; let naoSairam = 0, outroDia = 0, retiradasProntas = 0;
    for (const p of Array.isArray(pedidos) ? pedidos : []) {
        if (!p || ['arquivado', 'cancelado'].includes(p.status)) continue;
        if (p.status !== 'enviado') { naoSairam++; continue; }
        if (p.modo === 'retirada') { retiradasProntas++; continue; }
        const dia = diaDoPedido(p);
        if (dia && hoje && dia > hoje) { outroDia++; continue; }
        arquivar.push(p);
    }
    return { arquivar, naoSairam, outroDia, retiradasProntas };
}

/** "Ficam 3 na fila: 2 ainda não saíram (Novos ou Separando) e 1 é para outro dia. 1 retirada pronta ainda não foi buscada e ficou na fila." */
export function textoDoQueFica({ naoSairam = 0, outroDia = 0, retiradasProntas = 0 } = {}) {
    const n = naoSairam + outroDia, frases = [];
    if (n) {
        const partes = [];
        if (naoSairam) partes.push(`${naoSairam} ainda não ${naoSairam === 1 ? 'saiu' : 'saíram'} (Novos ou Separando)`);
        if (outroDia) partes.push(`${outroDia} ${outroDia === 1 ? 'é' : 'são'} para outro dia`);
        frases.push(`${n === 1 ? 'Fica 1' : `Ficam ${n}`} na fila: ${partes.join(' e ')}.`);
    }
    if (retiradasProntas) frases.push(retiradasProntas === 1 ? '1 retirada pronta ainda não foi buscada e ficou na fila.' : `${retiradasProntas} retiradas prontas ainda não foram buscadas e ficaram na fila.`);
    return frases.join(' ');
}

/**
 * O nome da aba do painel em que o pedido está, EXATAMENTE como está escrito na tela (js/admin.js → renderHtmlPedidos:
 * Novos, Separando, Enviados; os concluídos ficam em "Ver os entregues"). Retirada pronta também fica em Enviados.
 */
export const ABAS = { novos: 'Novos', prep: 'Separando', env: 'Enviados', feitos: 'Entregues' };
export function nomeDaAba(status) {
    return ({ preparando: ABAS.prep, enviado: ABAS.env, arquivado: ABAS.feitos, cancelado: 'Cancelados' })[status] || ABAS.novos;
}

const SEM_REDE = /failed to fetch|load failed|networkerror|network request failed|offline|unavailable|sem conex|timeout|deadline/i;
/**
 * O aviso quando uma ação do painel não deu certo, sem linguagem de sistema.
 *   noPedido = a ação mexia na etapa de um pedido
 */
export function avisoDeFalha(erro, { online = true, noPedido = false, mudou = false } = {}) {
    const cod = String((erro && erro.code) || ''), msg = String((erro && erro.message) || '');
    if (!online || SEM_REDE.test(cod) || SEM_REDE.test(msg)) return noPedido ? 'Sem internet: a etapa não mudou. Toque de novo.' : 'Sem internet: nada foi salvo. Toque de novo.';
    // o banco diz só "sem permissão" nos dois casos; quem chama sabe se o pedido mudou na tela enquanto isso (mudou)
    if (/permission/i.test(cod) || /permission|insufficient/i.test(msg)) {
        if (noPedido && mudou) return 'Este pedido já mudou em outro aparelho. Confira na tela e toque de novo se precisar.';
        return 'Sua conta não tem permissão para isso. Fale com o dono da loja.';
    }
    return noPedido ? 'Não consegui mudar a etapa. Toque de novo.' : 'Não deu certo. Toque de novo.';
}
