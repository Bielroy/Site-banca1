// =====================================================================
//  js/pedido-reserva-lib.js — PLANO B do pedido: o servidor não respondeu.
//
//  Se o envio do pedido falha por um motivo que NÃO é culpa do cliente (sem resposta, servidor fora do ar,
//  erro 5xx, fila cheia), a loja monta a mensagem do pedido aqui mesmo, no celular, e oferece mandar pelo
//  WhatsApp da banca. A banca nunca para de atender por causa do servidor.
//
//  Erro que o cliente resolve (cupom vencido, produto esgotado, endereço faltando, dia mudou) NÃO cai aqui:
//  esses continuam com o aviso de sempre, porque mandar pelo WhatsApp passaria por cima da conferência.
//  Sem nada de tela: só regras e o texto (testados em testes/index.js).
// =====================================================================

const REDE = /failed to fetch|load failed|networkerror|network request failed|sem conex[aã]o|timeout|timed out|aborted|abort/i;

/**
 * Esta falha merece o plano B?
 *   'rede'     sem resposta (internet caiu, tempo esgotado, servidor fora do ar antes de responder)
 *   'servidor' o servidor respondeu com erro dele (5xx) ou com "pedidos demais agora" (429)
 *   ''         erro que o cliente resolve na tela (4xx com motivo): continua o aviso normal
 */
export function falhaDoServidor(erro) {
    if (!erro) return '';
    if (erro.previa) return '';                                    // prévia do painel: nunca envia nada
    const st = Number(erro.status);
    if (Number.isFinite(st) && st > 0) return st >= 500 || st === 429 ? 'servidor' : '';
    return REDE.test(String(erro.message || erro.name || '')) ? 'rede' : '';
}

/** Vale tentar de novo sozinho, na hora? Só quando a falha foi rápida (5xx ou rede caindo), nunca no tempo esgotado. */
export const tentarDeNovo = (erro) => {
    const tipo = falhaDoServidor(erro);
    if (!tipo || Number(erro.status) === 429) return false;
    return !/timeout|timed out|aborted|abort/i.test(String(erro.message || erro.name || ''));
};

const reais = (n) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')}`;
const limpo = (s, max = 200) => String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Quantidade em palavras curtas: "2 kg", "3 un", "1,5 kg". */
function qtdTexto(i) {
    const q = Number(i.qtd) || 0, n = String(Math.round(q * 1000) / 1000).replace('.', ',');
    return i.tipo === 'kg' ? `${n} kg` : `${n} un`;
}

/**
 * Texto do pedido para o WhatsApp da banca.
 * p = { loja, codigo, nome, telefone, modo: 'entrega'|'retirada', endereco, dia, horario, pag, troco, obs,
 *       itens: [{ nome, qtd, tipo, aPesar, subtotal, adicionais }], total, aproximado }
 */
export function textoPedidoReserva(p) {
    const d = p || {}, itens = Array.isArray(d.itens) ? d.itens.slice(0, 120) : [];
    const l = [];
    l.push(`*Pedido${d.loja ? ` para ${limpo(d.loja, 60)}` : ''}*`);
    l.push('_O site não conseguiu registrar, então mandei por aqui._');
    if (d.codigo) l.push(`Código: ${limpo(d.codigo, 24)}`);
    l.push('');
    for (const i of itens) {
        const extra = i.adicionais ? ` (${limpo(i.adicionais, 120)})` : '';
        const valor = i.aPesar ? ' — a pesar' : Number(i.subtotal) > 0 ? ` — ${reais(i.subtotal)}` : '';
        l.push(`• ${qtdTexto(i)} ${limpo(i.nome, 80)}${extra}${valor}`);
    }
    l.push('');
    if (Number(d.total) > 0) l.push(`${d.aproximado ? 'Total estimado' : 'Total'}: ${d.aproximado ? '≈ ' : ''}${reais(d.total)}`);
    l.push(`Nome: ${limpo(d.nome, 80)}`);
    if (d.telefone) l.push(`Telefone: ${limpo(d.telefone, 20)}`);
    l.push(d.modo === 'retirada' ? 'Vou retirar' : `Entrega: ${limpo(d.endereco, 160) || '(endereço não informado)'}`);
    if (d.dia) l.push(`Para: ${limpo(d.dia, 40)}`);
    if (d.horario) l.push(`Horário: ${limpo(d.horario, 40)}`);
    if (d.pag) l.push(`Pagamento: ${limpo(d.pag, 30)}${d.troco ? ` (troco para ${limpo(d.troco, 20)})` : ''}`);
    if (d.obs) l.push(`Obs.: ${limpo(d.obs, 400)}`);
    return l.join('\n');
}
