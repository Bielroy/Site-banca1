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

const igualSemAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * Para quem vai o PIX pela chave, do jeito que o cliente entende. A chave de banca pequena costuma estar no nome
 * da dona ("Rosiva Martins da Silva"): sem dizer de qual loja é, o cliente acha que é golpe.
 *   paraQuemPix('Rosiva Martins da Silva', 'Banca da Rosiva') → { nome: 'Rosiva Martins da Silva', loja: 'conta da loja Banca da Rosiva' }
 * Se o nome da chave já é o da loja (ou o contém), não repete.
 */
export function paraQuemPix(nomeDaChave, nomeDaLoja) {
    const nome = String(nomeDaChave || '').trim(), loja = String(nomeDaLoja || '').trim();
    const a = igualSemAcento(nome), b = igualSemAcento(loja);
    if (!loja || !a || a === b || a.includes(b) || b.includes(a)) return { nome: nome || loja, loja: '' };
    return { nome, loja: `conta da loja ${loja}` };
}
