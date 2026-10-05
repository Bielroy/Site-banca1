// =====================================================================
//  js/tenant.js — QUAL LOJA ESTÁ ABERTA (lado do navegador)
//
//  Várias lojas usam este mesmo site. A loja vem do endereço:
//      bancaadairepedrina.com.br            → loja original ("banca")
//      .../?loja=espetinhos-do-ze           → outra loja
//      espetinhos-do-ze.plataforma.com.br   → outra loja (subdomínio; ver js/enderecos-config.js)
//      dominio-proprio.com.br               → domínio só da loja (idem)
//
//  ONDE FICAM OS DADOS (igual ao servidor, ver lib/tenant.js):
//      loja original → raiz do banco (produtos/…, pedidos/…)
//      outras lojas  → tenants/{id}/produtos/…, tenants/{id}/pedidos/…
//
//  Em vez de collection(db, 'produtos'), o código usa tcol('produtos');
//  em vez de doc(db, 'loja', 'config'), usa tdoc('loja', 'config').
//  Assim nenhum arquivo precisa saber em qual loja está.
// =====================================================================
import { db, auth, collection, doc } from './firebase.js';
import { lojaDoEndereco, lojaDoHost, enderecoDaLoja } from './enderecos-lib.js';
import { CFG } from './enderecos-config.js';

export const TENANT_PADRAO = 'banca';

const descobrir = () => {
    try { return lojaDoEndereco({ hostname: location.hostname, search: location.search }, CFG); }
    catch (_) { return TENANT_PADRAO; }                 // endereço estranho: cai na loja original
};

export const TENANT = descobrir();
export const ehLojaOriginal = TENANT === TENANT_PADRAO;

export const tcol = (nome) => (ehLojaOriginal ? collection(db, nome) : collection(db, 'tenants', TENANT, nome));
export const tdoc = (nome, id) => (ehLojaOriginal ? doc(db, nome, String(id)) : doc(db, 'tenants', TENANT, nome, String(id)));
/** Ficha pública da loja (nome, tema, módulos): tenants/{id} — vale para TODAS, inclusive a original. */
export const fichaRef = () => doc(db, 'tenants', TENANT);
/** Pasta das fotos no Storage. */
export const pastaFotos = () => (ehLojaOriginal ? 'fotos_produtos' : `tenants/${TENANT}/fotos_produtos`);

/** Chave do armazenamento do aparelho: carrinho, favoritos etc. não se misturam entre lojas. */
export const chave = (nome) => (ehLojaOriginal ? nome : `${nome}__${TENANT}`);

/** Endereço de uma loja (usado para trocar de loja). Com subdomínios ligados, vira https://id.dominio/…; senão, ?loja=id. */
export const urlDaLoja = (id, pagina = '/') => enderecoDaLoja(id, pagina, { hostname: typeof location !== 'undefined' ? location.hostname : '' }, CFG);
/** true quando o próprio endereço já diz qual é a loja (subdomínio ou domínio próprio). */
export const enderecoEhDaLoja = (() => { try { return !!lojaDoHost(location.hostname, CFG); } catch (_) { return false; } })();

// Toda chamada às nossas APIs leva junto qual é a loja (cabeçalho X-Loja) e, se a
// chamada ainda não trouxer, o login da pessoa. O servidor usa a loja só para saber
// ONDE olhar; o que a pessoa PODE fazer vem do login, conferido lá.
if (typeof window !== 'undefined' && !window.__fetchComLoja) {
    window.__fetchComLoja = true;
    const original = window.fetch.bind(window);
    window.fetch = async (alvo, opcoes = {}) => {
        const url = typeof alvo === 'string' ? alvo : (alvo && alvo.url) || '';
        if (!url.startsWith('/api/')) return original(alvo, opcoes);
        const headers = new Headers(opcoes.headers || {});
        if (!ehLojaOriginal) headers.set('X-Loja', TENANT);
        if (!headers.has('Authorization')) {
            try { const t = await auth.currentUser?.getIdToken(); if (t) headers.set('Authorization', `Bearer ${t}`); } catch (_) { /* segue sem login */ }
        }
        return original(alvo, { ...opcoes, headers });
    };
}
