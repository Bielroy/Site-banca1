// =====================================================================
//  js/banco-travado-lib.js — QUANDO A CÓPIA DO BANCO NO APARELHO TRAVA.
//
//  Fora do iPhone, o banco (Firestore) guarda uma cópia no aparelho (IndexedDB) para abrir rápido e funcionar
//  sem internet. No Android isso às vezes trava: outra aba ou o app instalado ficou em segundo plano segurando a
//  cópia, ou o armazenamento do navegador se perdeu. Aí NENHUMA leitura responde, nem com erro, e o painel fica
//  para sempre nos "risquinhos" de carregando (aconteceu num Samsung em 13/11/2026).
//
//  Saída: o painel percebe que nada chegou em alguns segundos, marca este aparelho para abrir SEM a cópia
//  (como no iPhone, lendo direto da internet) e pede para carregar de novo. A marca vale 7 dias; depois o
//  aparelho tenta a cópia de novo.
// =====================================================================
export const CHAVE = 'usebanca-banco-sem-copia';
export const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
export const ESPERA_MS = 15000;          // quanto o painel espera a lista de produtos antes de dizer que travou

/** true = abrir o banco sem a cópia no aparelho. `ls` = localStorage (pode faltar ou dar erro: aí false). */
export function usarSoMemoria(ls, agora = Date.now()) {
    try {
        const ate = Number(ls && ls.getItem(CHAVE));
        if (!ate) return false;
        if (ate < agora) { ls.removeItem(CHAVE); return false; }
        return true;
    } catch (_) { return false; }
}

/** Marca este aparelho para abrir sem a cópia nos próximos 7 dias. Devolve true se conseguiu gravar. */
export function marcarSoMemoria(ls, agora = Date.now()) {
    try { ls.setItem(CHAVE, String(agora + VALIDADE_MS)); return true; } catch (_) { return false; }
}
