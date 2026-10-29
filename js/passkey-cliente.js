// =====================================================================
//  js/passkey-cliente.js — FACE ID / DIGITAL no navegador (o servidor confere em api/passkey.js).
//
//  iPhone: o Safari só abre o Face ID se o pedido sair LOGO depois do toque. Por isso as opções (o desafio)
//  são buscadas ANTES (prepararEntrada / prepararCadastro) e, no toque, o navigator.credentials é chamado
//  sem esperar internet nenhuma antes. Se as opções ainda não chegaram, busca e tenta assim mesmo.
// =====================================================================
const API = '/api/passkey';
const VALE_MS = 4 * 60 * 1000;          // o desafio vale 5 min no servidor; aqui renova antes

const deB64u = (s) => { const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
const b64u = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

async function post(corpo, token) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Não consegui agora. Tente de novo.'), { status: r.status });
    return j;
}

/** Este aparelho tem Face ID, digital ou bloqueio de tela que o navegador deixa usar? */
export async function temSuporte() {
    try { return !!(window.PublicKeyCredential && window.isSecureContext && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch (_) { return false; }
}
/** Dá para sugerir a chave no campo de e-mail (o "preenchimento automático")? */
export async function temSugestaoNoCampo() {
    try { return !!(window.PublicKeyCredential && PublicKeyCredential.isConditionalMediationAvailable && await PublicKeyCredential.isConditionalMediationAvailable()); }
    catch (_) { return false; }
}

/** Mensagem em português para o que o navegador respondeu. */
export function explicarErro(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError') return 'Cancelado, ou este aparelho ainda não tem Face ID/digital ativado para o painel. Na primeira vez, entre pelo link do e-mail e ative depois.';
    if (n === 'InvalidStateError') return 'Este aparelho já está com Face ID/digital ativado.';
    if (n === 'SecurityError') return 'O Face ID só funciona no endereço oficial do painel.';
    if (n === 'AbortError') return '';
    return (e && e.message) || 'Não consegui agora. Tente de novo.';
}

// ---------------------------------------------------------------- ENTRAR
let opEntrada = null;
export async function prepararEntrada(forcar = false) {
    if (!forcar && opEntrada && Date.now() - opEntrada.em < VALE_MS) return opEntrada.publicKey;
    const j = await post({ acao: 'opcoes-entrada' });
    opEntrada = { publicKey: j.publicKey, em: Date.now() };
    return j.publicKey;
}
const paraGet = (pk) => ({ challenge: deB64u(pk.challenge), rpId: pk.rpId, userVerification: pk.userVerification || 'required', timeout: pk.timeout || 120000, allowCredentials: [] });
const respostaGet = (c) => ({ id: c.id, rawId: b64u(c.rawId), type: c.type, response: {
    clientDataJSON: b64u(c.response.clientDataJSON), authenticatorData: b64u(c.response.authenticatorData),
    signature: b64u(c.response.signature), userHandle: c.response.userHandle ? b64u(c.response.userHandle) : '' } });

/**
 * Pede o Face ID/digital e devolve o token do Firebase (para signInWithCustomToken).
 * condicional = true: espera a pessoa escolher a chave na sugestão do campo de e-mail (sem abrir nada sozinho).
 */
export async function pedirEntrada({ condicional = false, sinal } = {}) {
    const pronta = opEntrada && Date.now() - opEntrada.em < VALE_MS ? opEntrada.publicKey : null;
    const pk = pronta || await prepararEntrada(true);
    if (!condicional) opEntrada = null;                       // cada desafio vale uma vez (a sugestão do campo, se cancelada, não gasta o desafio)
    const cred = await navigator.credentials.get({ publicKey: paraGet(pk), ...(condicional ? { mediation: 'conditional' } : {}), ...(sinal ? { signal: sinal } : {}) });
    if (!cred) throw Object.assign(new Error('Cancelado.'), { name: 'NotAllowedError' });
    const j = await post({ acao: 'entrar', resposta: respostaGet(cred) });
    return j.token;
}

// ---------------------------------------------------------------- ATIVAR (cadastrar este aparelho; precisa estar logado)
let opCadastro = null;
export async function prepararCadastro(token) {
    const j = await post({ acao: 'opcoes-cadastro' }, token);
    opCadastro = { publicKey: j.publicKey, em: Date.now() };
    return j.publicKey;
}
/** Ativa o Face ID/digital neste aparelho. pegarToken = () => Promise<id token do Firebase>. */
export async function ativar(pegarToken, aparelho = '') {
    const pronta = opCadastro && Date.now() - opCadastro.em < VALE_MS ? opCadastro.publicKey : null;
    const pk = pronta || await prepararCadastro(await pegarToken());
    opCadastro = null;
    const cred = await navigator.credentials.create({ publicKey: {
        ...pk, challenge: deB64u(pk.challenge), user: { ...pk.user, id: deB64u(pk.user.id) },
        excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ type: 'public-key', id: deB64u(c.id) })),
    } });
    if (!cred) throw Object.assign(new Error('Cancelado.'), { name: 'NotAllowedError' });
    return post({ acao: 'cadastrar', ...(aparelho ? { aparelho } : {}), resposta: { id: cred.id, rawId: b64u(cred.rawId), type: cred.type, response: {
        clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject) } } }, await pegarToken());
}
export const _b64 = { deB64u, b64u };
