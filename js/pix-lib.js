// =====================================================================
//  js/pix-lib.js — contas puras do PIX automático (sem tela, testáveis).
// =====================================================================

/** CPF válido? Confere tamanho, repetição (111.111.111-11) e os dois dígitos verificadores. */
export function cpfValido(v) {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dig = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

/** "12345678909" → "123.456.789-09" enquanto a pessoa digita. */
export function mascararCpf(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 11);
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/**
 * Este pedido pode ser pago por PIX automático agora?
 *   ligado  = a loja ligou o PIX automático (loja/config.pixAutomatico)
 *   pedido  = { pag, status, temItensAPesar, pagamento }
 */
export function podePagarPix(ligado, pedido) {
    if (!ligado || !pedido) return false;
    if (String(pedido.pag || '').toUpperCase() !== 'PIX') return false;
    if (pedido.temItensAPesar) return false;                              // o valor ainda vai mudar na balança
    if (pedido.pagamento && pedido.pagamento.status === 'PAID') return false;
    return ['pendente', 'aguardando_pagamento', 'preparando', 'enviado'].includes(pedido.status);
}
