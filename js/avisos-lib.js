// =====================================================================
//  js/avisos-lib.js — contas puras dos avisos de pedido (sem tela, testáveis).
// =====================================================================

/** Chave pública (texto) → bytes, no formato que o navegador pede para ligar os avisos. */
export function chaveParaBytes(texto) {
    const s = String(texto || '').replace(/-/g, '+').replace(/_/g, '/'), cheio = s + '='.repeat((4 - (s.length % 4)) % 4);
    const bruto = atob(cheio), out = new Uint8Array(bruto.length);
    for (let i = 0; i < bruto.length; i++) out[i] = bruto.charCodeAt(i);
    return out;
}

/**
 * Em que pé estão os avisos NESTE aparelho?
 *   'sem-suporte' navegador não tem o recurso      'ios-instalar' iPhone: só funciona com o site na tela de início
 *   'sem-chave'   o servidor ainda não tem a chave  'bloqueado'    a pessoa negou a permissão no navegador
 *   'ligado' | 'desligado'
 */
export function situacaoDosAvisos({ temSW, temPush, temNotificacao, permissao, assinado, chave, ios, instalado }) {
    if (ios && !instalado) return 'ios-instalar';
    if (!temSW || !temPush || !temNotificacao) return 'sem-suporte';
    if (!chave) return 'sem-chave';
    if (permissao === 'denied') return 'bloqueado';
    return assinado && permissao === 'granted' ? 'ligado' : 'desligado';
}
