// =====================================================================
//  js/busca-lib.js — A BUSCA DA LOJA, que entende o jeito que o cliente escreve.
//
//  Antes a busca só olhava o NOME do produto: quem digitava "folhas" não achava
//  a alface. Agora cada produto é achado por:
//    • o nome ("Alface crespa")
//    • as palavras que a loja cadastrou (produto.palavras: ["salada", "verdinha"])
//    • o nome da categoria ("Verduras")
//    • um dicionário pronto de feira: alface, rúcula, couve... também são "folhas" e "verdura"
//  E perdoa o que o cliente erra: acento, maiúscula, plural ("tomates") e uma letra trocada
//  em palavra comprida ("alfase", "tomatte").
// =====================================================================
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Quem tem uma destas palavras no nome também é achado pelas palavras de "extras".
const DICIONARIO = [
    { chaves: ['alface', 'rucula', 'agriao', 'couve', 'espinafre', 'almeirao', 'chicoria', 'acelga', 'escarola', 'mostarda', 'catalonha', 'repolho', 'serralha', 'taioba', 'mix de folhas', 'folha'],
      extras: 'folha folhas verdura verduras salada hortalica' },
    { chaves: ['salsinha', 'salsa', 'cebolinha', 'coentro', 'cheiro verde', 'hortela', 'manjericao', 'alecrim', 'tomilho', 'oregano', 'louro', 'salvia', 'erva doce', 'capim santo', 'capim limao'],
      extras: 'tempero temperos cheiro verde erva ervas folha folhas verdura' },
    { chaves: ['batata', 'cenoura', 'beterraba', 'abobrinha', 'abobora', 'chuchu', 'pepino', 'berinjela', 'quiabo', 'vagem', 'mandioca', 'aipim', 'macaxeira', 'inhame', 'cara', 'jilo', 'maxixe', 'pimentao', 'tomate', 'cebola', 'alho', 'milho', 'gengibre', 'rabanete', 'nabo'],
      extras: 'legume legumes' },
    { chaves: ['banana', 'maca', 'laranja', 'limao', 'mamao', 'manga', 'abacaxi', 'melancia', 'melao', 'uva', 'morango', 'pera', 'goiaba', 'maracuja', 'tangerina', 'mexerica', 'ponkan', 'kiwi', 'abacate', 'caqui', 'ameixa', 'pessego', 'coco', 'acerola', 'pitaya', 'graviola', 'carambola', 'figo', 'jabuticaba', 'caju', 'lichia', 'atemoia', 'pinha'],
      extras: 'fruta frutas' },
    { chaves: ['acai', 'cupuacu'], extras: 'acai acaí sorvete creme tigela copo' },
    { chaves: ['pastel'], extras: 'pastel pasteis salgado' },
    { chaves: ['coca', 'guarana', 'refrigerante', 'refri', 'suco', 'agua', 'cha gelado', 'energetico', 'cerveja', 'caldo de cana', 'garapa'],
      extras: 'bebida bebidas refri refrigerante gelado' },
    { chaves: ['ovo', 'ovos'], extras: 'ovo ovos duzia granja caipira' },
];
// palavras que não ajudam a achar nada ("batata DA terra", "pastel DE carne")
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'o', 'a', 'os', 'as', 'um', 'uma', 'kg', 'un', 'tem', 'quero', 'voces', 'vcs']);

/** "tomates" → "tomate", "limões" (já sem acento: "limoes") → "limao", "pastéis" → "paste"... só para comparar. */
const raiz = (w) => (w.length > 4 && /(oes|aes)$/.test(w) ? `${w.slice(0, -3)}ao` : w.length > 4 && /(eis|res|zes|les)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** Até 12 palavras ou expressões curtas, sem repetir. Aceita lista ou texto separado por vírgula. */
export function limparPalavras(v) {
    const lista = Array.isArray(v) ? v : String(v || '').split(/[,;\n]/);
    const out = [], vistos = new Set();
    for (const x of lista) {
        const t = String(x || '').replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
        const n = norm(t);
        if (!n || vistos.has(n)) continue;
        vistos.add(n); out.push(t);
        if (out.length >= 12) break;
    }
    return out;
}

/** As palavras que o dicionário acrescenta para este nome (para mostrar no painel: "já acha por..."). */
export function palavrasAutomaticas(nome) {
    const n = ` ${norm(nome)} `;
    const extras = new Set();
    for (const g of DICIONARIO) if (g.chaves.some((c) => n.includes(` ${c} `) || n.includes(` ${c}s `) || n.includes(` ${c}es `))) g.extras.split(' ').forEach((w) => extras.add(w));
    return [...extras];
}

/** Todo o texto pelo qual o produto pode ser achado, já normalizado. */
export function textoDeBusca(p, nomeCategoria = '') {
    const nome = (p && p.nome) || '';
    return norm([nome, ...limparPalavras(p && p.palavras), nomeCategoria, ...palavrasAutomaticas(nome)].join(' '));
}

// uma letra trocada, sobrando ou faltando (só em palavra comprida, para "pera" não achar "pepa")
function quase(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, erros = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++erros > 1) return false;
        if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return erros + (a.length - i) + (b.length - j) <= 1;
}

/** O produto (texto de textoDeBusca) combina com o que o cliente digitou? Todas as palavras precisam achar. */
export function combinaBusca(texto, termo) {
    const pal = norm(termo).split(' ').filter((w) => w && !VAZIAS.has(w));
    if (!pal.length) return true;
    const ws = String(texto || '').split(' ').filter(Boolean);
    return pal.every((w) => {
        const r = raiz(w);
        return ws.some((t) => t.startsWith(w) || t.startsWith(r) || raiz(t) === r
            || (r.length >= 5 && (quase(raiz(t), r) || quase(t.slice(0, r.length), r))));
    });
}
