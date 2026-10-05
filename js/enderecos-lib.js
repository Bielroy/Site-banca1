// =====================================================================
//  js/enderecos-lib.js — de qual LOJA é um endereço, e qual é o endereço de uma loja.
//  Regras puras (sem navegador), usadas por js/tenant.js e testadas em testes/index.js.
//  O servidor tem a mesma regra em lib/tenant.js (lojaDoHost).
//
//  cfg = { base: 'minhaplataforma.com.br', proprios: { 'bancaadairepedrina.com.br': 'banca' } }
//
//  Ordem de decisão:
//   1. domínio próprio da loja            bancaadairepedrina.com.br → banca
//   2. subdomínio da plataforma           espetinhos-do-ze.minhaplataforma.com.br → espetinhos-do-ze
//   3. ?loja=id                            só onde o endereço NÃO pertence a uma loja
//                                          (domínio da plataforma, *.vercel.app, localhost)
//   4. loja original
//  Nos casos 1 e 2 o ?loja= é ignorado de propósito: o endereço de uma loja nunca abre outra.
// =====================================================================
export const PADRAO = 'banca';
export const RESERVADOS = ['www', 'app', 'api', 'admin', 'painel', 'plataforma', 'loja', 'lojas', 'mail', 'ftp', 'static', 'cdn'];
export const idValido = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));
const limparHost = (h) => String(h || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
const semWww = (h) => h.replace(/^www\./, '');

/** "a.com=loja-a, b.com.br=loja-b" → { 'a.com': 'loja-a', 'b.com.br': 'loja-b' } */
export function lerProprios(texto) {
    const out = {};
    String(texto || '').split(',').forEach((par) => { const [d, id] = par.split('=').map((s) => semWww(limparHost(s))); if (d && d.includes('.') && idValido(id)) out[d] = id; });
    return out;
}
export const normalizarCfg = (cfg) => ({ base: semWww(limparHost(cfg && cfg.base)), proprios: (cfg && cfg.proprios) || {} });

/** Loja "dona" do endereço (domínio próprio ou subdomínio), ou null se o endereço não é de uma loja só. */
export function lojaDoHost(hostname, cfg) {
    const c = normalizarCfg(cfg), h = limparHost(hostname);
    const proprio = c.proprios[semWww(h)];
    if (idValido(proprio)) return proprio;
    if (c.base && h.endsWith(`.${c.base}`)) {
        const sub = h.slice(0, -c.base.length - 1);
        if (!sub.includes('.') && idValido(sub) && !RESERVADOS.includes(sub)) return sub;
    }
    return null;
}
/** Loja aberta neste endereço. `onde` = { hostname, search }. */
export function lojaDoEndereco(onde, cfg) {
    const doHost = lojaDoHost(onde && onde.hostname, cfg);
    if (doHost) return doHost;
    let daUrl = '';
    try { daUrl = (new URLSearchParams((onde && onde.search) || '').get('loja') || '').trim().toLowerCase(); } catch (_) { /* endereço estranho */ }
    return idValido(daUrl) ? daUrl : PADRAO;
}
/**
 * Endereço de uma loja. Com subdomínios ligados E estando no domínio da plataforma (ou de uma loja),
 * devolve o endereço completo (https://id.base/pagina). Senão, o jeito antigo: pagina?loja=id.
 */
export function enderecoDaLoja(id, pagina, onde, cfg) {
    const c = normalizarCfg(cfg), h = limparHost(onde && onde.hostname), pag = pagina || '/';
    const antigo = id === PADRAO ? pag : `${pag}${pag.includes('?') ? '&' : '?'}loja=${encodeURIComponent(id)}`;
    const naPlataforma = !!c.base && (semWww(h) === c.base || h.endsWith(`.${c.base}`) || !!c.proprios[semWww(h)]);
    if (!naPlataforma || !idValido(id)) return antigo;
    const caminho = `/${String(pag).replace(/^\.?\/+/, '')}`;
    const proprio = Object.keys(c.proprios).find((d) => c.proprios[d] === id);
    if (proprio) return `https://${proprio}${caminho}`;
    if (id === PADRAO) return `https://${c.base}${caminho}`;
    return RESERVADOS.includes(id) ? `https://${c.base}${caminho}${caminho.includes('?') ? '&' : '?'}loja=${id}` : `https://${id}.${c.base}${caminho}`;
}
