// =====================================================================
//  js/pix-chave-lib.js — PIX "COPIA E COLA" SEM BANCO NO MEIO.
//
//  A loja cadastra a própria chave PIX no painel. Com a chave e o valor do
//  pedido, o site monta o código "copia e cola" (o mesmo padrão do QR Code
//  do PIX, definido pelo Banco Central). A cliente copia, cola no aplicativo
//  do banco dela e o valor já vem preenchido.
//
//  Não há confirmação automática: o dinheiro cai direto na conta da loja e
//  quem confere é a loja (pelo extrato ou pelo comprovante no WhatsApp).
//  Arquivo puro, para os testes poderem conferir.
// =====================================================================

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const campo = (id, valor) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

/** CRC16-CCITT (0x1021, início 0xFFFF): o "dígito verificador" do código PIX. */
export function crc16(texto) {
    let crc = 0xffff;
    for (let i = 0; i < texto.length; i++) {
        crc ^= texto.charCodeAt(i) << 8;
        for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

export const TIPOS_DE_CHAVE = { celular: 'Celular', cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', aleatoria: 'Chave aleatória' };

/** Deixa a chave no formato que os bancos esperam. Devolve '' se não for válida para o tipo. */
export function normalizarChave(tipo, valor) {
    const v = String(valor || '').trim(), d = v.replace(/\D/g, '');
    if (tipo === 'cpf') return d.length === 11 ? d : '';
    if (tipo === 'cnpj') return d.length === 14 ? d : '';
    if (tipo === 'celular') { const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d; return n.length === 10 || n.length === 11 ? `+55${n}` : ''; }
    if (tipo === 'email') return /^[^\s@]{1,64}@[^\s@]{1,180}\.[a-z]{2,}$/i.test(v) && v.length <= 77 ? v.toLowerCase() : '';
    if (tipo === 'aleatoria') return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : '';
    return '';
}

/** O que a loja guardou serve para cobrar? */
export const pixDaLojaValido = (pix) => !!pix && !!normalizarChave(pix.tipo, pix.chave) && String(pix.nome || '').trim().length >= 2;

/**
 * Monta o código "copia e cola".
 *   pix   = { tipo, chave, nome, cidade }   (o que a loja cadastrou)
 *   valor = total do pedido em reais; txid = identificação curta (número do pedido)
 * Devolve '' se faltar dado ou o valor não for positivo.
 */
export function codigoPix(pix, valor, txid = '') {
    const chave = pix ? normalizarChave(pix.tipo, pix.chave) : '', v = Math.round(Number(valor) * 100) / 100;
    if (!chave || !(v > 0) || v > 999999) return '';
    const nome = semAcento(pix.nome).replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25) || 'LOJA';
    const cidade = semAcento(pix.cidade).replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15) || 'BRASIL';
    const id = String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
    const corpo = campo('00', '01')
        + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave))
        + campo('52', '0000') + campo('53', '986') + campo('54', v.toFixed(2)) + campo('58', 'BR')
        + campo('59', nome) + campo('60', cidade) + campo('62', campo('05', id)) + '6304';
    return corpo + crc16(corpo);
}

/** Como mostrar a chave para a pessoa conferir (celular e CPF com pontuação). */
export function chaveBonita(pix) {
    const c = pix ? normalizarChave(pix.tipo, pix.chave) : '';
    if (pix && pix.tipo === 'celular' && c) { const n = c.slice(3); return `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}`; }
    if (pix && pix.tipo === 'cpf' && c) return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return c;
}
