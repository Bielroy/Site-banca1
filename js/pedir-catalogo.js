// =====================================================================
//  js/pedir-catalogo.js — o painel avisa o servidor que algo mudou, para ele remendar os documentos
//  montados (vitrine, painel e custos: lib/catalogo.js). Junta vários salvamentos seguidos num aviso só.
//
//   'mudou'  + ids   produto salvo (o servidor relê só esses)
//   'custos' + ids   custo ou ficha técnica salvos
//   'extras'         categorias ou aviso do dia
//   'tudo'           produto apagado ou algo grande: remontagem inteira
//   'se-faltar'      painel abriu: só remonta se o documento falta ou está velho
//
//  Falhou (sem internet)? Tudo bem: quem lê também ouve os produtos mudados há pouco, e o servidor remonta
//  tudo a cada 6 h quando o painel abre.
// =====================================================================
import { auth } from './firebase.js';
import { marcarProdutoLocal } from './painel-catalogo.js';

const P = { tudo: false, seFaltar: false, extras: false, ids: new Set(), custos: new Set(), timer: null };

async function enviar(corpo) {
    const token = await auth.currentUser?.getIdToken(); if (!token) return;
    await fetch('/api/pdv', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'catalogo', ...corpo }) });
}

/** modo: 'tudo' | 'se-faltar' | 'mudou' | 'custos' | 'extras'. ids: produtos (para 'mudou' e 'custos'). */
export function pedirCatalogo(modo = 'tudo', ids = null, esperaMs = 4000) {
    const lista = (Array.isArray(ids) ? ids : []).filter(Boolean).map(String);
    if (modo === 'mudou' && lista.length) lista.forEach((id) => P.ids.add(id));
    else if (modo === 'custos' && lista.length) lista.forEach((id) => P.custos.add(id));
    else if (modo === 'extras') P.extras = true;
    else if (modo === 'se-faltar') P.seFaltar = true;
    else P.tudo = true;
    clearTimeout(P.timer);
    P.timer = setTimeout(async () => {
        const { tudo, seFaltar, extras } = P, ids = [...P.ids], custos = [...P.custos];
        P.tudo = false; P.seFaltar = false; P.extras = false; P.ids.clear(); P.custos.clear();
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        try {
            if (tudo || ids.length + custos.length > 300) return await enviar({ modo: 'tudo' });
            if (ids.length) await enviar({ modo: 'mudou', ids });
            if (custos.length) await enviar({ modo: 'custos', ids: custos });
            if (extras) await enviar({ modo: 'extras' });
            if (seFaltar && !ids.length && !custos.length && !extras) await enviar({ modo: 'se-faltar' });
        } catch (_) { /* sem internet: quem lê pega pela leitura de reserva */ }
    }, esperaMs);
}

/**
 * Este aparelho salvou um produto: mostra já no painel (mesmo com o relógio do celular errado, quando o produto
 * não entra nos "mudados") e avisa o servidor com o id, para ele remendar a vitrine e o painel.
 */
export function produtoSalvo(id, dados) {
    if (!id) return;
    if (dados && typeof dados === 'object') marcarProdutoLocal(id, dados);
    pedirCatalogo('mudou', [id]);
}
