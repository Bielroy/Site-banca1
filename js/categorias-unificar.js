// =====================================================================
//  js/categorias-unificar.js — junta categorias escritas de jeitos diferentes.
//
//  "Pasteis Doces" e "Pastéis Doces" (ou "pastéis doces ") são a MESMA
//  categoria: o painel já conta assim. A loja agora também: cada produto
//  sem categoria cadastrada passa a usar uma grafia só, para não aparecerem
//  duas abas iguais. A grafia escolhida é a com acento; empate, a mais usada.
// =====================================================================
export const normCat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const temAcento = (s) => /[̀-ͯ]/.test(String(s).normalize('NFD'));

/** Recebe os produtos e devolve os mesmos, com p.cat padronizado entre grafias parecidas. */
export const unificarCategorias = (produtos) => {
    const grafias = new Map();          // norm -> Map(grafia -> quantos)
    for (const p of produtos) {
        const k = normCat(p.cat); if (!k) continue;
        const g = String(p.cat).replace(/\s+/g, ' ').trim();
        if (!grafias.has(k)) grafias.set(k, new Map());
        const m = grafias.get(k); m.set(g, (m.get(g) || 0) + 1);
    }
    const escolhida = new Map();
    for (const [k, m] of grafias) {
        const [melhor] = [...m.entries()].sort((a, b) => (temAcento(b[0]) - temAcento(a[0])) || (b[1] - a[1]) || a[0].localeCompare(b[0], 'pt-BR'));
        escolhida.set(k, melhor[0]);
    }
    return produtos.map((p) => {
        const k = normCat(p.cat); if (!k) return p;
        const c = escolhida.get(k);
        return c === p.cat ? p : { ...p, cat: c };
    });
};
