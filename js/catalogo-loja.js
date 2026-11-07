// =====================================================================
//  js/catalogo-loja.js — a loja lê a vitrine NUM DOCUMENTO SÓ (loja/catalogo, montado pelo servidor
//  em lib/catalogo.js). Antes: 1 leitura por produto a cada visita. Agora: 1 leitura do documento
//  + os produtos que mudaram há pouco (normalmente nenhum).
//
//  Sempre certo, sem limpar cache:
//   - documento e produtos mudados ficam OUVIDOS: mudou no painel, a vitrine muda na tela, ao vivo;
//   - produtos mudados depois de `geradoEm` (menos 10 min de folga) chegam por cima do documento (a tela
//     desenha na hora com o documento e se corrige quando eles chegam);
//   - documento faltando, inválido, grande demais ou com erro: volta para o jeito antigo (lê todos os
//     produtos), que é exatamente como a loja funcionava antes. A vitrine nunca fica vazia por causa disto.
// =====================================================================

export const VERSAO_CATALOGO = 1;
export const MARGEM_MS = 10 * 60 * 1000;
const ESPERA_DOCUMENTO_MS = 4000;     // sem documento válido nesse tempo: jeito antigo

export const vaiParaVitrine = (p) => !!(p && p.ativo && !p.soInsumo);
export const catalogoValido = (c) => !!(c && c.v === VERSAO_CATALOGO && !c.grande && Array.isArray(c.produtos) && Number(c.geradoEm) > 0);

/** Documento + produtos mudados → lista da vitrine (só os que aparecem), na ordem do banco (por id). */
export function juntarVitrine(base, mudados) {
    const m = new Map();
    for (const p of Array.isArray(base) ? base : []) if (p && p.id != null) m.set(String(p.id), p);
    for (const p of Array.isArray(mudados) ? mudados : []) {
        if (!p || p.id == null) continue;
        if (vaiParaVitrine(p)) m.set(String(p.id), p); else m.delete(String(p.id));
    }
    return [...m.values()].filter(vaiParaVitrine).sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}

/**
 * Ouve a vitrine. fb = { onSnapshot, docCatalogo, colProdutos, query, where }.
 * aoMudar(lista, modo) recebe os produtos que aparecem; aoErro(e) recebe o erro do jeito antigo
 * (o único que decide "loja fora do ar"). Devolve a função que para tudo.
 */
/** Categorias, aviso do dia e nota que vêm junto no documento (null = documento de antes, ou jeito antigo: leia você mesmo). */
export const extrasDoCatalogo = (c) => (c && Array.isArray(c.categorias)
    ? { categorias: c.categorias, comunicados: c.comunicados || null, avaliacoes: c.avaliacoes || null } : null);

export function ouvirVitrine(fb, { aoMudar, aoErro, forcarAntigo = false, aoTrocarModo, aoExtras } = {}) {
    let modo = 'catalogo', cancelado = false, base = null, mudados = [], limite = null;
    const paradas = [];
    let pararMudados = null, relogioDoc = null;
    const limpar = () => { clearTimeout(relogioDoc); };

    const antigo = (motivo) => {
        if (cancelado || modo === 'antigo') return;
        modo = 'antigo'; limpar();
        if (pararMudados) { pararMudados(); pararMudados = null; }
        while (paradas.length) { try { paradas.pop()(); } catch (_) { /* já parado */ } }
        if (aoTrocarModo) aoTrocarModo('antigo', motivo);
        if (aoExtras) aoExtras(null);          // categorias, aviso e nota: a loja lê cada um como antes
        paradas.push(fb.onSnapshot(fb.colProdutos, (snap) => {
            aoMudar(snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter(vaiParaVitrine), 'antigo');
        }, (e) => aoErro && aoErro(e)));
    };
    if (forcarAntigo) { antigo('forcado'); return () => { cancelado = true; while (paradas.length) paradas.pop()(); }; }

    const desenhar = () => {
        if (cancelado || modo !== 'catalogo' || !base) return;
        // Desenha JÁ com o documento (que o servidor refaz em segundos a cada mudança) e corrige por cima quando
        // os "mudados" chegam (quase sempre nenhum). Esperar por eles custava uma ida e volta a mais antes da 1ª foto.
        aoMudar(juntarVitrine(base, mudados), 'catalogo');
    };
    const ouvirMudados = (desde) => {
        if (limite === desde && pararMudados) return;
        if (pararMudados) pararMudados();
        limite = desde; mudados = [];
        pararMudados = fb.onSnapshot(fb.query(fb.colProdutos, fb.where('ultimaModificacao', '>', desde)), (snap) => {
            mudados = snap.docs.map((d) => ({ ...d.data(), id: d.id })); desenhar();
        }, () => antigo('erro-mudados'));
    };

    relogioDoc = setTimeout(() => { if (!base) antigo('sem-resposta'); }, ESPERA_DOCUMENTO_MS);
    paradas.push(fb.onSnapshot(fb.docCatalogo, (snap) => {
        if (cancelado || modo !== 'catalogo') return;
        const existe = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
        const c = existe ? snap.data() : null;
        if (!catalogoValido(c)) {
            // sem cópia guardada e ainda sem resposta da internet: espera o relógio (não troca à toa)
            if (!existe && snap.metadata && snap.metadata.fromCache && (typeof navigator === 'undefined' || navigator.onLine !== false)) return;
            return antigo(c && c.grande ? 'grande' : 'sem-catalogo');
        }
        clearTimeout(relogioDoc);
        base = c.produtos;
        if (aoExtras) aoExtras(extrasDoCatalogo(c));    // antes de desenhar: as abas já saem com as categorias
        ouvirMudados(Number(c.geradoEm) - MARGEM_MS);
        desenhar();
    }, () => antigo('erro-catalogo')));      // regra ainda não publicada, por exemplo: o jeito antigo resolve

    return () => {
        cancelado = true; limpar();
        if (pararMudados) pararMudados();
        while (paradas.length) { try { paradas.pop()(); } catch (_) { /* já parado */ } }
    };
}
