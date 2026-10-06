// =====================================================================
//  lib/artes.js — os MESMOS desenhos de js/arte-lib.js, para o servidor
//  (o ícone do app de cada loja é montado em /api/manifest).
//  Mudou um desenho lá? Mude aqui também: um teste confere se os dois
//  arquivos continuam iguais.
// =====================================================================
const ARTES = {
    // pão de casca com três cortes, na tábua
    pao: '<rect x="8" y="86" width="104" height="14" rx="7" fill="#D9C7A3"/><path d="M16 88C8 56 32 34 60 34s52 22 44 54z" fill="#E9A862"/><rect x="-4" y="-14" width="8" height="28" rx="4" fill="#F6F1E4" transform="translate(38 62) rotate(18)"/><rect x="-4" y="-14" width="8" height="28" rx="4" fill="#F6F1E4" transform="translate(60 62) rotate(18)"/><rect x="-4" y="-14" width="8" height="28" rx="4" fill="#F6F1E4" transform="translate(82 62) rotate(18)"/>',
    // espetinho na diagonal
    espeto: '<g transform="rotate(-45 60 60)"><rect x="0" y="56" width="120" height="8" rx="4" fill="#D9C7A3"/><rect x="28" y="43" width="22" height="34" rx="9" fill="#E4765C"/><rect x="54" y="43" width="22" height="34" rx="9" fill="#7CC99B"/><rect x="80" y="43" width="22" height="34" rx="9" fill="#E9A862"/></g>',
    // panela com tampa (jantinha, marmita, caldos)
    prato: '<rect x="4" y="64" width="20" height="11" rx="5.5" fill="#D9C7A3"/><rect x="96" y="64" width="20" height="11" rx="5.5" fill="#D9C7A3"/><path d="M30 52a30 26 0 0 1 60 0z" fill="#D9C7A3"/><circle cx="60" cy="22" r="7" fill="#7CC99B"/><path d="M22 56h76v24a22 22 0 0 1-22 22H44a22 22 0 0 1-22-22z" fill="#E9A862"/><rect x="14" y="48" width="92" height="13" rx="6.5" fill="#F6F1E4"/>',
    // bolo no pedestal, com cobertura e cereja
    bolo: '<rect x="38" y="100" width="44" height="8" rx="4" fill="#D9C7A3"/><rect x="55" y="84" width="10" height="20" rx="3" fill="#D9C7A3"/><rect x="12" y="78" width="96" height="11" rx="5.5" fill="#D9C7A3"/><rect x="26" y="42" width="68" height="38" rx="9" fill="#E9A862"/><path d="M26 51a9 9 0 0 1 9-9h50a9 9 0 0 1 9 9v6a7.5 7.5 0 0 1-15 0 7.5 7.5 0 0 0-11 0 7.5 7.5 0 0 1-16 0 7.5 7.5 0 0 0-11 0 7.5 7.5 0 0 1-15 0z" fill="#F6F1E4"/><circle cx="60" cy="30" r="9" fill="#E4765C"/><path d="M0 0C1-11 9-16 18-15 18-6 10 0 0 0Z" fill="#7CC99B" transform="translate(62 22) rotate(0) scale(0.8)"/>',
    // docinho: cupcake com cereja
    doce: '<path d="M32 66h56l-8 36a7 7 0 0 1-7 6H47a7 7 0 0 1-7-6z" fill="#E9A862"/><circle cx="42" cy="58" r="15" fill="#F6F1E4"/><circle cx="78" cy="58" r="15" fill="#F6F1E4"/><circle cx="60" cy="44" r="19" fill="#F6F1E4"/><rect x="34" y="58" width="52" height="14" rx="7" fill="#F6F1E4"/><circle cx="60" cy="20" r="9" fill="#E4765C"/><path d="M0 0C1-11 9-16 18-15 18-6 10 0 0 0Z" fill="#7CC99B" transform="translate(62 12) rotate(0) scale(0.8)"/>',
    // hambúrguer
    burger: '<path d="M14 56C14 34 34 20 60 20s46 14 46 36z" fill="#E9A862"/><rect x="8" y="59" width="104" height="11" rx="5.5" fill="#7CC99B"/><rect x="14" y="73" width="92" height="14" rx="7" fill="#B5794A"/><rect x="16" y="90" width="88" height="16" rx="8" fill="#E9A862"/><rect x="-4" y="-2" width="8" height="4" rx="2" fill="#F6F1E4" transform="translate(42 38) rotate(-20)"/><rect x="-4" y="-2" width="8" height="4" rx="2" fill="#F6F1E4" transform="translate(60 31) rotate(0)"/><rect x="-4" y="-2" width="8" height="4" rx="2" fill="#F6F1E4" transform="translate(78 38) rotate(20)"/>',
    // fatia de pizza
    pizza: '<path d="M60 110L20 40c26-10 54-10 80 0z" fill="#E9A862"/><path d="M12 34C42 16 78 16 108 34a6 6 0 0 1 2 8l-2 3C78 30 42 30 12 45l-2-3a6 6 0 0 1 2-8z" fill="#D9C7A3"/><circle cx="47" cy="58" r="8" fill="#E4765C"/><circle cx="70" cy="62" r="8" fill="#E4765C"/><circle cx="59" cy="84" r="7" fill="#E4765C"/><circle cx="60" cy="46" r="4.5" fill="#7CC99B"/>',
    // tigela com colher (açaí, sorvete)
    tigela: '<rect x="-4.5" y="-30" width="9" height="60" rx="4.5" fill="#D9C7A3" transform="translate(92 34) rotate(30)"/><path d="M22 60a38 26 0 0 1 76 0z" fill="#E4765C"/><circle cx="46" cy="45" r="8" fill="#E9A862"/><circle cx="66" cy="41" r="8" fill="#E9A862"/><path d="M0 0C1-11 9-16 18-15 18-6 10 0 0 0Z" fill="#7CC99B" transform="translate(54 36) rotate(-20) scale(0.7)"/><path d="M10 58h100a50 44 0 0 1-100 0z" fill="#F6F1E4"/><rect x="42" y="100" width="36" height="8" rx="4" fill="#D9C7A3"/>',
    // copo com canudo e rodela de fruta (suco, creme, vitamina)
    copo: '<rect x="-4" y="-34" width="8" height="68" rx="4" fill="#7CC99B" transform="translate(72 40) rotate(20)"/><circle cx="92" cy="44" r="15" fill="#E9A862"/><circle cx="92" cy="44" r="9" fill="#F6F1E4"/><path d="M30 40h60l-7 61a7 7 0 0 1-7 6H44a7 7 0 0 1-7-6z" fill="#F6F1E4"/><path d="M36 60h48l-4.6 40a4 4 0 0 1-4 3.5H44.600000000000001a4 4 0 0 1-4-3.5z" fill="#E9A862"/>',
    // crepe no cone
    crepe: '<circle cx="44" cy="42" r="14" fill="#F6F1E4"/><circle cx="76" cy="42" r="14" fill="#F6F1E4"/><circle cx="60" cy="34" r="17" fill="#F6F1E4"/><circle cx="60" cy="16" r="8" fill="#E4765C"/><path d="M0 0C1-11 9-16 18-15 18-6 10 0 0 0Z" fill="#7CC99B" transform="translate(62 9) rotate(0) scale(0.7)"/><path d="M24 46h72L64 108a4.5 4.5 0 0 1-8 0z" fill="#E9A862"/><path d="M60 46h36L64 108a4.5 4.5 0 0 1-4 2.4z" fill="#D9C7A3"/>',
    // pastel de feira, com as bordas marcadas no garfo
    pastel: '<rect x="10" y="98" width="100" height="8" rx="4" fill="#D9C7A3"/><g transform="rotate(-8 60 62)"><rect x="12" y="36" width="96" height="54" rx="13" fill="#E9A862"/><rect x="18" y="47" width="9" height="5" rx="2.5" fill="#F6F1E4"/><rect x="18" y="60.5" width="9" height="5" rx="2.5" fill="#F6F1E4"/><rect x="18" y="74" width="9" height="5" rx="2.5" fill="#F6F1E4"/><rect x="93" y="47" width="9" height="5" rx="2.5" fill="#F6F1E4"/><rect x="93" y="60.5" width="9" height="5" rx="2.5" fill="#F6F1E4"/><rect x="93" y="74" width="9" height="5" rx="2.5" fill="#F6F1E4"/><rect x="40" y="52" width="40" height="6" rx="3" fill="#D9C7A3"/></g>',
    // prato de macarrão com garfo
    macarrao: '<rect x="-4" y="-34" width="8" height="68" rx="4" fill="#D9C7A3" transform="translate(96 36) rotate(32)"/><circle cx="42" cy="56" r="15" fill="#E9A862"/><circle cx="78" cy="56" r="14" fill="#E9A862"/><circle cx="60" cy="48" r="18" fill="#E9A862"/><circle cx="62" cy="32" r="9" fill="#E4765C"/><path d="M0 0C1-11 9-16 18-15 18-6 10 0 0 0Z" fill="#7CC99B" transform="translate(66 25) rotate(0) scale(0.75)"/><path d="M10 60h100a50 42 0 0 1-100 0z" fill="#F6F1E4"/><rect x="42" y="100" width="36" height="8" rx="4" fill="#D9C7A3"/>',
    // caldo de cana: a cana e o copo
    cana: '<g transform="rotate(10 36 66)"><rect x="16" y="14" width="13" height="96" rx="6.5" fill="#7CC99B"/><rect x="34" y="24" width="13" height="86" rx="6.5" fill="#7CC99B"/><rect x="16" y="40" width="13" height="5" rx="2.5" fill="#F6F1E4"/><rect x="16" y="64" width="13" height="5" rx="2.5" fill="#F6F1E4"/><rect x="16" y="88" width="13" height="5" rx="2.5" fill="#F6F1E4"/><rect x="34" y="50" width="13" height="5" rx="2.5" fill="#F6F1E4"/><rect x="34" y="74" width="13" height="5" rx="2.5" fill="#F6F1E4"/></g><path d="M62 54h48l-5.5 47a6 6 0 0 1-6 5H73.5a6 6 0 0 1-6-5z" fill="#F6F1E4"/><path d="M67 70h38l-3.2 28a3.5 3.5 0 0 1-3.5 3H73.7a3.5 3.5 0 0 1-3.5-3z" fill="#E9A862"/>',
    // queijo com a fatia cortada (queijo, ovos, mel e doces da roça)
    queijo: '<path d="M10 74L88 38c12 6 22 20 22 36z" fill="#E9A862"/><path d="M10 74h100v20a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8z" fill="#D9C7A3"/><circle cx="74" cy="62" r="6.5" fill="#F6F1E4"/><circle cx="93" cy="66" r="3.5" fill="#F6F1E4"/><circle cx="36" cy="87" r="5" fill="#E9A862"/><circle cx="80" cy="89" r="6" fill="#E9A862"/><circle cx="58" cy="84" r="3" fill="#E9A862"/>',
    // espiga de milho na palha
    pamonha: '<rect x="55" y="82" width="10" height="26" rx="5" fill="#D9C7A3"/><path d="M60 8c22 10 28 46 12 76H48C32 54 38 18 60 8z" fill="#E9A862"/><circle cx="60" cy="24" r="3.6" fill="#F6F1E4"/><circle cx="52" cy="36" r="3.6" fill="#F6F1E4"/><circle cx="68" cy="36" r="3.6" fill="#F6F1E4"/><circle cx="60" cy="48" r="3.6" fill="#F6F1E4"/><circle cx="50" cy="58" r="3.6" fill="#F6F1E4"/><circle cx="70" cy="58" r="3.6" fill="#F6F1E4"/><circle cx="60" cy="70" r="3.6" fill="#F6F1E4"/><path d="M50 86C28 92 12 78 10 54c20 0 36 10 40 32z" fill="#7CC99B"/><path d="M70 86c22 6 38-8 40-32-20 0-36 10-40 32z" fill="#7CC99B"/>',
    // cachorro-quente com mostarda
    hotdog: '<rect x="10" y="34" width="100" height="34" rx="17" fill="#D9C7A3"/><rect x="2" y="46" width="116" height="24" rx="12" fill="#E4765C"/><path d="M16 58c5-8 9 8 14 0s9 8 14 0 9 8 14 0 9 8 14 0 9 8 14 0 9 8 14 0" fill="none" stroke="#F6F1E4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="8" y="62" width="104" height="32" rx="16" fill="#E9A862"/>',
    // sacola de compras: serve para qualquer loja que não caiba nos outros
    sacola: '<circle cx="48" cy="40" r="17" fill="#E9A862"/><circle cx="76" cy="44" r="13" fill="#7CC99B"/><path d="M0 0C1-11 9-16 18-15 18-6 10 0 0 0Z" fill="#7CC99B" transform="translate(48 25) rotate(0) scale(0.8)"/><path d="M20 46h80l-6 54a8 8 0 0 1-8 7H34a8 8 0 0 1-8-7z" fill="#D9C7A3"/><rect x="44" y="60" width="32" height="10" rx="5" fill="#F6F1E4"/>',
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
function arteDoTipo(tipo) {
    const t = limpo(tipo) + ' ';
    if (!t.trim()) return 'sacola';
    const achou = PISTAS.find(([, palavras]) => palavras.some((p) => t.includes(p)));
    return achou ? achou[0] : 'sacola';
}

module.exports = { ARTES, arteDoTipo };
