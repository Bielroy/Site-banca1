// =====================================================================
//  js/arte-lib.js — o desenho de traço que fica no canto do cabeçalho.
//  Cada tipo de negócio tem o seu. Todos são originais, feitos em linha
//  (sem preenchimento) numa prancheta de 120×120, e pintados pelo CSS
//  com a cor do texto do cabeçalho, para contrastar em qualquer tema.
//  Arquivo puro (sem navegador), para os testes poderem conferir.
// =====================================================================

export const ARTES = {
    // pão de casca com três cortes
    pao: '<path d="M14 76C10 50 34 32 62 32c28 0 48 18 44 44"/><path d="M10 78c30 12 70 12 100 0"/><path d="M40 44c7 8 8 20 3 30M61 39c7 9 8 22 3 33M82 44c7 8 8 20 3 30"/><path d="M26 98c22 6 46 6 68-2"/>',
    // espetinho na diagonal com fumaça
    espeto: '<path d="M12 108l22-22M90 30l18-18"/><rect x="-13" y="-10" width="26" height="20" rx="7" transform="translate(44 76) rotate(-45)"/><rect x="-13" y="-10" width="26" height="20" rx="7" transform="translate(63 57) rotate(-45)"/><rect x="-13" y="-10" width="26" height="20" rx="7" transform="translate(82 38) rotate(-45)"/><path d="M22 46c-8-8 6-14-2-24M40 34c-7-7 5-12-2-21"/>',
    // panela com tampa e vapor
    prato: '<path d="M22 60v20c0 12 9 20 20 20h36c11 0 20-8 20-20V60"/><path d="M14 60h92M22 70H10M98 70h12"/><path d="M30 60c2-14 14-22 30-22s28 8 30 22"/><circle cx="60" cy="33" r="4"/><path d="M46 22c-7-6 5-10-2-18M74 22c-7-6 5-10-2-18"/>',
    // bolo no pedestal, com cobertura escorrendo e cereja
    bolo: '<path d="M28 50v28h64V50"/><path d="M28 50c0-10 64-10 64 0"/><path d="M28 54c5 10 12 10 16 0 4 10 12 10 16 0 4 10 12 10 16 0 4 10 11 10 16 0"/><path d="M16 80h88M60 80v16M40 102c10-7 30-7 40 0"/><circle cx="60" cy="33" r="5"/><path d="M60 28c1-8 8-12 15-10"/>',
    // docinho: cupcake com cobertura em espiral
    doce: '<path d="M34 68l7 34h38l7-34"/><path d="M50 70l3 30M70 70l-3 30"/><path d="M28 68c-6-10 4-20 14-16 0-12 16-18 26-8 10-6 24 2 20 14 6 2 8 8 4 10z"/><path d="M48 42c8-8 20-6 22 4"/><circle cx="60" cy="24" r="5"/>',
    // hambúrguer
    burger: '<path d="M18 56c0-20 18-34 42-34s42 14 42 34z"/><path d="M12 68c8 0 8 8 16 8s8-8 16-8 8 8 16 8 8-8 16-8 8 8 16 8 8-8 16-8"/><path d="M20 86h80c0 10-6 16-14 16H34c-8 0-14-6-14-16z"/><path d="M44 38l4 2M60 33l4 2M76 38l4 2"/>',
    // fatia de pizza
    pizza: '<path d="M18 32c28-14 56-14 84 0L60 108z"/><path d="M26 45c22-10 46-10 68 0"/><circle cx="50" cy="60" r="6"/><circle cx="71" cy="64" r="6"/><circle cx="60" cy="84" r="5"/>',
    // tigela com colher (açaí, sorvete, caldo)
    tigela: '<path d="M12 58h96c0 26-21 44-48 44S12 84 12 58z"/><path d="M24 58c2-13 15-17 23-10 5-11 21-11 26 0 8-7 21-3 23 10"/><path d="M84 46l18-34"/><circle cx="50" cy="38" r="3"/><circle cx="67" cy="32" r="3"/>',
    // copo com canudo e rodela de fruta (suco, creme, vitamina)
    copo: '<path d="M32 42l7 60h42l7-60"/><path d="M24 42h72M36 60h48"/><path d="M62 42l10-30h16"/><circle cx="92" cy="40" r="13"/><path d="M92 27v26M79 40h26"/>',
    // crepe no cone, com recheio e morango
    crepe: '<path d="M28 46l32 62 32-62"/><path d="M92 46L50 90"/><path d="M24 46c-2-16 18-20 24-8 2-16 24-16 26 0 6-12 24-8 22 8"/><circle cx="48" cy="30" r="3"/><circle cx="72" cy="28" r="3"/>',
    // pastel de feira: retangular, com as bordas marcadas no garfo
    pastel: '<rect x="14" y="42" width="92" height="48" rx="9" transform="rotate(-8 60 66)"/><path d="M18 52h7M17 60h7M17 68h7M17 76h7M18 84h7M95 48h7M96 56h7M96 64h7M96 72h7M95 80h7M40 60c12-6 28-6 40 0" transform="rotate(-8 60 66)"/><path d="M48 26c-7-6 5-10-2-18M70 24c-7-6 5-10-2-18"/>',
    // macarrão enrolado no garfo
    macarrao: '<ellipse cx="60" cy="94" rx="46" ry="11"/><path d="M26 90c0-28 68-28 68 0M38 86c2-16 42-16 44 0M49 80c3-8 19-8 22 0"/><path d="M52 12v16c0 8 16 8 16 0V12M60 12v52"/>',
    // caldo de cana: a cana e o copo
    cana: '<path d="M22 108L40 22M36 110L54 26"/><path d="M27 84l14 3M31 64l14 3M36 44l14 3"/><path d="M44 24c-4-12-16-16-26-12 4 10 14 16 26 12zM50 26c6-12 20-14 28-8-6 10-18 14-28 8z"/><path d="M64 56l5 48h28l5-48"/><path d="M58 56h50M68 72h36"/>',
    // queijo: a peça com a fatia cortada (banca do queijo, ovos, mel e doces da roça)
    queijo: '<path d="M12 74L92 38c12 8 16 22 16 36z"/><path d="M12 74v22h96V74"/><circle cx="70" cy="62" r="6"/><circle cx="90" cy="66" r="3.5"/><circle cx="38" cy="86" r="4"/><circle cx="78" cy="88" r="4.5"/>',
    // pamonha: a espiga de milho na palha
    pamonha: '<path d="M60 10c22 10 28 46 10 70H50C32 56 38 20 60 10z"/><path d="M52 15c-5 20-4 44 3 65M68 15c5 20 4 44-3 65M43 32c11 5 23 5 34 0M40 48c13 6 27 6 40 0M42 64c12 5 24 5 36 0"/><path d="M50 80c-18 6-34-4-38-24 16-2 30 8 38 24zM70 80c18 6 34-4 38-24-16-2-30 8-38 24z"/><path d="M60 80v28"/>',
    // cachorro-quente com mostarda
    hotdog: '<path d="M22 46c4-14 72-14 76 0"/><rect x="8" y="46" width="104" height="20" rx="10"/><path d="M20 56c5-7 9 7 14 0s9 7 14 0 9 7 14 0 9 7 14 0 9 7 14 0 9 7 12 0"/><path d="M18 66c4 24 80 24 84 0"/>',
    // sacola de compras: serve para qualquer loja que não caiba nos outros
    sacola: '<path d="M22 44h76l-6 60H28z"/><path d="M44 44V34c0-10 7-18 16-18s16 8 16 18v10"/><path d="M44 62c0 9 7 16 16 16s16-7 16-16"/>',
};

// Palavras que apontam para cada desenho (comparadas sem acento e em minúsculas).
// A ORDEM importa: "queijo, ovos, mel e doces da roça" é a banca do queijo, não a de doces;
// "caldo de cana" é cana, não caldo.
const PISTAS = [
    ['caixote', ['hortifruti', 'horti', 'fruta', 'verdura', 'legume', 'sacolao', 'quitanda']],
    ['queijo', ['queijo', 'laticin', 'ovos', 'mel ', 'da roca']],
    ['cana', ['cana', 'garapa']],
    ['hotdog', ['hot dog', 'hotdog', 'cachorro']],
    ['espeto', ['espet', 'churras', 'assad']],
    ['pizza', ['pizza']],
    ['pastel', ['pastel', 'pasteis', 'salgad', 'coxinha']],
    ['crepe', ['crepe', 'tapioca', 'panqueca', 'waffle']],
    ['macarrao', ['macarr', 'massa', 'yakisoba', 'espaguete', 'lamen']],
    ['pamonha', ['pamonha', 'milho', 'curau']],
    ['pao', ['padaria', 'pao', 'paes', 'panific']],
    ['bolo', ['bolo', 'torta']],
    ['doce', ['doce', 'confeit', 'sobremesa', 'brigadeiro', 'cupcake']],
    ['burger', ['lanche', 'hamburg', 'burger', 'sanduich']],
    ['tigela', ['acai', 'sorvete', 'caldo', 'sopa']],
    ['copo', ['suco', 'creme', 'vitamina', 'bebida', 'cafe', 'drink', 'cerveja', 'adega']],
    ['prato', ['jantinha', 'janta', 'marmit', 'comida', 'restaurante', 'almoco', 'refeic', 'cozinha']],
    ['caixote', ['feira', 'banca']],
];

const limpo = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Qual desenho combina com este tipo de negócio? 'caixote' é o colorido da banca; o resto é traço. */
export function arteDoTipo(tipo) {
    const t = limpo(tipo) + ' ';
    if (!t.trim()) return 'sacola';
    const achou = PISTAS.find(([, palavras]) => palavras.some((p) => t.includes(p)));
    return achou ? achou[0] : 'sacola';
}
