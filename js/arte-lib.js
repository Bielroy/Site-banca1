// =====================================================================
//  js/arte-lib.js — o desenho de traço que fica no canto do cabeçalho.
//  Cada tipo de negócio tem o seu. Todos são originais, feitos em linha
//  (sem preenchimento) numa prancheta de 120×120, e pintados pelo CSS
//  com a cor do texto do cabeçalho, para contrastar em qualquer tema.
//  Arquivo puro (sem navegador), para os testes poderem conferir.
// =====================================================================

export const ARTES = {
    // pão com três cortes e duas espigas de vapor
    pao: '<path d="M14 80c-4-20 14-40 46-40s50 20 46 40c-1 8-8 12-16 12H30c-8 0-15-4-16-12z"/><path d="M40 50c4 6 5 13 3 20M60 46c4 6 5 14 3 22M80 50c4 6 5 13 3 20"/><path d="M46 28c-3-4 3-7 0-12M74 28c-3-4 3-7 0-12"/>',
    // espetinho na diagonal, três pedaços e a ponta
    espeto: '<path d="M14 106L34 86M92 28l14-14"/><rect x="-13" y="-11" width="26" height="22" rx="6" transform="translate(44 76) rotate(-45)"/><rect x="-13" y="-11" width="26" height="22" rx="6" transform="translate(63 57) rotate(-45)"/><rect x="-13" y="-11" width="26" height="22" rx="6" transform="translate(82 38) rotate(-45)"/><path d="M24 40c-5-6 2-10-2-17M40 30c-4-5 2-9-1-15"/>',
    // panela com tampa e vapor
    prato: '<path d="M24 58h72v26c0 9-7 16-16 16H40c-9 0-16-7-16-16z"/><path d="M18 58h84M24 68H12M96 68h12"/><path d="M34 58c0-12 12-20 26-20s26 8 26 20M60 38v-6"/><path d="M46 22c-3-4 3-7 0-12M74 22c-3-4 3-7 0-12"/>',
    // cupcake com cereja
    bolo: '<path d="M34 66h52l-7 36H41z"/><path d="M50 68l3 32M70 68l-3 32"/><path d="M30 66c-6-10 2-20 12-18 2-12 18-16 26-8 10-6 24 2 20 14 6 2 6 10 0 12"/><circle cx="62" cy="24" r="7"/><path d="M62 17c2-6 8-8 12-7"/>',
    // hambúrguer
    burger: '<path d="M18 58c0-20 18-34 42-34s42 14 42 34z"/><path d="M14 70c7 0 7 7 15 7s8-7 15-7 8 7 16 7 8-7 15-7 8 7 15 7 8-7 16-7"/><path d="M20 86h80v6c0 6-5 10-11 10H31c-6 0-11-4-11-10z"/><path d="M44 40l3 2M60 36l3 2M76 40l3 2"/>',
    // fatia de pizza
    pizza: '<path d="M20 34c26-14 54-14 80 0L60 106z"/><path d="M28 46c21-10 43-10 64 0"/><circle cx="50" cy="60" r="6"/><circle cx="70" cy="64" r="6"/><circle cx="60" cy="84" r="5"/>',
    // tigela (açaí, sorvete, caldo) com colher
    tigela: '<path d="M14 58h92c0 26-20 44-46 44S14 84 14 58z"/><path d="M26 58c2-12 14-16 22-10 4-10 20-10 24 0 8-6 20-2 22 10"/><path d="M84 46l16-30"/><circle cx="50" cy="40" r="3"/><circle cx="66" cy="34" r="3"/>',
    // copo com canudo
    copo: '<path d="M32 40h56l-8 62H40z"/><path d="M36 58h48"/><path d="M66 40l10-28h14"/><path d="M26 40h68"/><circle cx="52" cy="76" r="3"/><circle cx="66" cy="86" r="3"/>',
    // sacola de compras: serve para qualquer loja que não caiba nos outros
    sacola: '<path d="M24 44h72l-6 58H30z"/><path d="M44 44V34c0-10 7-16 16-16s16 6 16 16v10"/><path d="M46 62c0 8 6 14 14 14s14-6 14-14"/>',
};

// palavras que apontam para cada desenho (comparadas sem acento e em minúsculas)
const PISTAS = [
    ['caixote', ['hortifruti', 'horti', 'feira', 'fruta', 'verdura', 'legume', 'sacolao', 'quitanda', 'banca']],
    ['espeto', ['espet', 'churras', 'assad']],
    ['pizza', ['pizza']],
    ['pao', ['padaria', 'pao', 'paes', 'panific']],
    ['bolo', ['doce', 'bolo', 'confeit', 'sobremesa', 'brigadeiro', 'torta']],
    ['burger', ['lanche', 'hamburg', 'burger', 'sanduich', 'hot dog', 'cachorro']],
    ['tigela', ['acai', 'sorvete', 'caldo', 'sopa']],
    ['copo', ['bebida', 'suco', 'cafe', 'drink', 'cerveja', 'adega']],
    ['prato', ['jantinha', 'janta', 'marmit', 'comida', 'restaurante', 'almoco', 'refeic', 'cozinha']],
];

const limpo = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Qual desenho combina com este tipo de negócio? 'caixote' é o colorido da banca; o resto é traço. */
export function arteDoTipo(tipo) {
    const t = limpo(tipo);
    if (!t) return 'sacola';
    const achou = PISTAS.find(([, palavras]) => palavras.some((p) => t.includes(p)));
    return achou ? achou[0] : 'sacola';
}
