// =====================================================================
//  js/conhecido-lib.js — CLIENTE QUE VOLTA: o resumo no lugar do formulário.
//
//  Quem já pediu nesta loja tem nome, WhatsApp e endereço guardados (no aparelho ou na conta). Em vez de
//  mostrar os campos todas as vezes, a tela de envio mostra "Entrega para Maria · Atenas, Quadra 5 · (62) ..."
//  e o botão "Mudar meus dados" abre os campos de sempre. Os campos continuam existindo (só escondidos):
//  o envio do pedido lê os mesmos de antes, então nada muda para o servidor.
// =====================================================================
import { telefoneBonito } from './contato-lib.js';

/**
 * O que mostrar no resumo, ou null quando falta alguma coisa e o formulário deve aparecer.
 * { nome, telefone, retirada, enderecoTexto, enderecoOk }
 */
export function resumoDoCliente({ nome, telefone, retirada = false, enderecoTexto = '', enderecoOk = false } = {}) {
    const n = String(nome || '').replace(/\s+/g, ' ').trim();
    const tel = String(telefone || '').replace(/\D/g, '');
    if (!n) return null;
    if (tel.length < 10) return null;                          // sem WhatsApp: o formulário aparece e ele completa
    if (!retirada && !(enderecoOk && String(enderecoTexto || '').trim())) return null;
    return {
        titulo: retirada ? `Retirada para ${n}` : `Entrega para ${n}`,
        endereco: retirada ? '' : String(enderecoTexto).trim(),
        telefone: telefoneBonito(tel),
    };
}

/** A forma de pagamento guardada vale só se a loja ainda aceita (está entre as opções visíveis). */
export const pagamentoQueVale = (guardado, opcoes) => (typeof guardado === 'string' && Array.isArray(opcoes) && opcoes.includes(guardado) ? guardado : '');
