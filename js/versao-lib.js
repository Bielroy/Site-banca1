// =====================================================================
//  js/versao-lib.js — o site que está na tela é o mesmo que está no ar?
//  A cada publicação, o arquivo principal de cada página ganha um nome
//  novo (ex.: /assets/main-B_XEcaEF.js). Se a página que o servidor
//  entrega hoje não cita mais o arquivo que esta tela carregou, a tela
//  está velha. Contas puras, sem tela, para poder testar.
// =====================================================================

/** Dos scripts da página, qual é o arquivo "com nome de versão" (o que o build gera em /assets/). */
export function arquivoDaPagina(srcs) {
    for (const s of srcs || []) {
        const m = String(s || '').match(/\/assets\/[\w.-]+\.js/);
        if (m) return m[0];
    }
    return '';
}

/** A página no ar (`html`) já não usa o arquivo desta tela? Só diz "sim" se o html parecer mesmo uma página do site. */
export function estaDesatualizada(meuArquivo, html) {
    const t = String(html || '');
    if (!meuArquivo || !/\/assets\/[\w.-]+\.js/.test(t)) return false;     // resposta estranha (erro, página de login do Wi-Fi...): não mexe
    return !t.includes(meuArquivo);
}

/** Trava de segurança: no máximo 2 recargas automáticas a cada 10 minutos, e nunca duas em menos de 30 segundos. */
export function podeRecarregar(historico, agora) {
    const h = (historico || []).filter((x) => Number.isFinite(x) && agora - x < 10 * 60 * 1000);
    return h.length < 2 && !h.some((x) => agora - x < 30000);
}

/**
 * Endereço para RECARREGAR buscando a página no servidor: o mesmo endereço, com um "?v=" novo.
 * Sem isto, com internet lenta o aparelho devolvia a cópia guardada (a mesma página velha) e a tela
 * continuava desatualizada depois de "recarregar". Mantém os outros parâmetros (ex.: ?loja=...).
 */
export function enderecoFresco(caminho, busca, agora) {
    const q = new URLSearchParams(String(busca || '').replace(/^\?/, ''));
    q.set('v', String(agora));
    const c = String(caminho || '/'); return `${c.startsWith('/') && !c.startsWith('//') ? c : '/'}?${q.toString()}`;
}
