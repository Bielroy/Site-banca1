// =====================================================================
//  js/cofre-lib.js — o painel ABRE os dados do cliente no próprio aparelho.
//
//  O banco guarda nome, telefone, endereço e observação cifrados (lib/cofre.js).
//  Depois do login, o painel pede a chave da loja ao servidor (só quem atende
//  recebe) e abre os pedidos aqui, com o WebCrypto do navegador. A chave fica
//  só na memória desta página: não vai para o aparelho, nem para o banco.
//  Sem chave (servidor sem cofre, ou pessoa sem permissão), o que estiver
//  cifrado aparece como "(protegido)"; dado antigo, sem cifra, aparece normal.
// =====================================================================
export const PREFIXO = 'c1:';
export const CAMPOS = ['nome', 'telefone', 'quadra', 'lote', 'obs'];
export const PROTEGIDO = '(protegido)';

let chave = Promise.resolve(null);

const deB64 = (s) => { const t = atob(s); const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; };
const deB64u = (s) => { let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return deB64(t); };

/** `buscar` devolve a chave da loja em base64 ('' quando o servidor não usa cofre). Chamado uma vez, no login. */
export function carregarChave(buscar) {
    chave = Promise.resolve().then(buscar).then((b64) => (b64
        ? crypto.subtle.importKey('raw', deB64(b64), { name: 'AES-GCM' }, false, ['decrypt'])
        : null)).catch(() => null);
    return chave;
}
export function esquecerChave() { chave = Promise.resolve(null); }

export const cifrado = (v) => typeof v === 'string' && v.startsWith(PREFIXO);

export async function abrir(valor, campo) {
    if (!cifrado(valor)) return valor;
    const k = await chave;
    if (!k) return PROTEGIDO;
    try {
        const b = deB64u(valor.slice(PREFIXO.length));
        const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: new TextEncoder().encode(campo), tagLength: 128 }, k, b.subarray(12));
        return new TextDecoder().decode(claro);
    } catch (_) { return PROTEGIDO; }
}

/** Cópia do pedido com os campos do cliente abertos. */
export async function abrirPedido(p) {
    if (!p || typeof p !== 'object' || !CAMPOS.some((c) => cifrado(p[c]))) return p;
    const out = { ...p };
    await Promise.all(CAMPOS.map(async (c) => { if (cifrado(p[c])) out[c] = await abrir(p[c], c); }));
    return out;
}
export const abrirPedidos = (lista) => Promise.all((lista || []).map(abrirPedido));
