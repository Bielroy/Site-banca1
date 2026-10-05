// =====================================================================
//  js/icones.js — ícones da loja, desenhados em traço (SVG).
//
//  Substituem os emojis, que mudam de desenho em cada celular.
//  Para trocar um ícone: altere o "d" do <path> correspondente.
//  Todos usam a cor do texto ao redor (currentColor) e a classe .ico,
//  cujo tamanho é definido em css/visual.css.
// =====================================================================
const svg = (miolo, extra = '') =>
    `<svg class="ico${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${miolo}</svg>`;

export const ICO = {
    sacola:  svg('<path d="M4 9h16l-1.6 10.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8z"/><path d="M8.5 9l3-5.5M15.5 9l-3-5.5"/>'),
    coracao: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
    balanca: svg('<path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7l-2.5 6a2.7 2.7 0 0 0 5 0zM19 7l-2.5 6a2.7 2.7 0 0 0 5 0z"/>'),
    unidade: svg('<circle cx="12" cy="13" r="7"/><path d="M12 6c0-1.6 1-2.6 2.6-3"/>'),
    pino:    svg('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
    lista:   svg('<path d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-2 2-2-2-2 2-3-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h6"/>'),
    moto:    svg('<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h6l3-7h3M9 10h4"/>'),
    camera:  svg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    zap:     svg('<path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 19z"/>'),
};
