// =====================================================================
//  js/html-lib.js — HTML QUE VEM DE FORA (hoje: o relatório escrito pela IA).
//
//  Regra: só passam <p>, <ul>, <li> e <b>, SEM nenhum atributo. Todo o resto
//  vira texto comum. Assim nada do que a IA (ou quem conseguir influenciar a
//  IA) escrever consegue rodar no painel. Mesma regra de api/assistente.js
//  (htmlSimples): o servidor limpa e a tela limpa de novo.
//  Arquivo puro (sem navegador), para os testes poderem conferir.
// =====================================================================
const esc = (t) => String(t).replace(/&(?!(?:amp|lt|gt|quot|#39|nbsp);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function htmlSimples(texto) {
    let saida = '', resto = String(texto == null ? '' : texto).slice(0, 6000);
    const marca = /<\s*(\/?)\s*(p|ul|li|b|strong)\b[^<>]*>/i;
    for (;;) {
        const m = marca.exec(resto);
        if (!m) { saida += esc(resto); break; }
        const nome = m[2].toLowerCase() === 'strong' ? 'b' : m[2].toLowerCase();
        saida += esc(resto.slice(0, m.index)) + `<${m[1] ? '/' : ''}${nome}>`;
        resto = resto.slice(m.index + m[0].length);
    }
    return saida;
}

/** Campo de planilha (CSV): entre aspas, e sem deixar texto virar FÓRMULA ao abrir no Excel. */
export function csvCampo(valor) {
    // tira espaços, tabulações e quebras do começo: "\t=1+1" também vira fórmula em algumas planilhas
    let txt = String(valor ?? '').replace(/^[\s\u0000-\u001f]+/, '').replace(/[\r\n]+/g, ' ');
    if (/^[=+\-@]/.test(txt)) txt = `'${txt}`;
    return `"${txt.replace(/"/g, '""')}"`;
}
