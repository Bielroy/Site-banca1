// =====================================================================
//  js/icones-admin.js — ÍCONES DO PAINEL, desenhados para este projeto.
//
//  Todos nascem na mesma grade (24 × 24), em traço arredondado, e cada um
//  leva UMA peça cheia na cor de destaque — a "semente" (classe .s). É ela
//  que dá a cara do conjunto e que "brota" quando a aba é escolhida.
//
//  COMO USAR
//    No HTML (qualquer lugar, inclusive texto montado em JavaScript):
//        <i class="ic" data-i="estoque"></i>
//    O arquivo troca sozinho essa marca pelo desenho, também no que for
//    criado depois (telas abertas mais tarde, listas redesenhadas).
//    Em JavaScript, quando quiser o desenho direto:  ico('estoque')
//
//  COMO MUDAR UM ÍCONE: altere o desenho em ICONES. `p` = traço, `s` = semente.
//  Tamanho e cores: css/admin-icones.css (.ic, --ic-semente).
// =====================================================================
const p = (d) => `<path pathLength="1" d="${d}"/>`;
const s = (d) => `<path class="s" d="${d}"/>`;
const bola = (cx, cy, r) => `<circle pathLength="1" cx="${cx}" cy="${cy}" r="${r}"/>`;
const semente = (cx, cy, r) => `<circle class="s" cx="${cx}" cy="${cy}" r="${r}"/>`;

export const ICONES = {
    // ----- abas -----
    produtos:   p('M3.5 10.5h17l-1.2 8.7a1.5 1.5 0 0 1-1.5 1.3H6.2a1.5 1.5 0 0 1-1.5-1.3z') + p('M4.1 15h15.8') + semente(9, 6.6, 2.7) + p('M13.6 9.6c-.2-3.2 1.6-5.3 5.2-5.6.3 3.3-1.5 5.4-5.2 5.6z'),
    pdv:        p('M4 8.5h16') + p('M6.2 8.5c.3 2.6 2.7 4.1 5.8 4.1s5.5-1.5 5.8-4.1') + p('M12 12.6v2.6') + p('M7.2 20.5l1.3-5.3h7l1.3 5.3z') + semente(12, 5.4, 2.3),
    estoque:    p('M3.5 12.8h8v7.7h-8z') + p('M12.5 12.8h8v7.7h-8z') + s('M7.9 4h8.2v7.3H7.9z') + p('M7.9 4h8.2v7.3H7.9z') + p('M7.5 12.8v2.4') + p('M16.5 12.8v2.4'),
    compras:    p('M5 9.2h14l-1.2 10a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3z') + p('M8.8 12.4V7.2a3.2 3.2 0 0 1 6.4 0v5.2') + semente(8.8, 12.9, 1.25) + semente(15.2, 12.9, 1.25),
    crm:        bola(9, 8.2, 3.1) + p('M3.4 20.2c.4-3.7 2.6-5.7 5.6-5.7s5.2 2 5.6 5.7') + semente(17, 9.6, 2.4) + p('M16.6 14.7c2.4.2 3.8 1.9 4.1 5.5'),
    copiloto:   p('M5.5 4.8h13A1.5 1.5 0 0 1 20 6.3v8.9a1.5 1.5 0 0 1-1.5 1.5h-6.9l-4.1 3.5v-3.5h-2A1.5 1.5 0 0 1 4 15.2V6.3a1.5 1.5 0 0 1 1.5-1.5z') + s('M12 6.9l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1z'),
    calendario: p('M5.5 6h13A1.5 1.5 0 0 1 20 7.5v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6z') + p('M8 3.6v4') + p('M16 3.6v4') + p('M4 10.4h16') + s('M13.6 13.2h3.4v3.4h-3.4z'),
    relatorios: p('M3 20.5h18') + p('M4.3 12.5h3.4v8H4.3z') + s('M10.3 5h3.4v15.5h-3.4z') + p('M10.3 5h3.4v15.5h-3.4z') + p('M16.3 15h3.4v5.5h-3.4z'),
    pedidos:    p('M7.5 5.2h-1A1.5 1.5 0 0 0 5 6.7v12.3a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V6.7a1.5 1.5 0 0 0-1.5-1.5h-1') + s('M9 3.5h6v3.4H9z') + p('M9 3.5h6v3.4H9z') + p('M8.5 11h7') + p('M8.5 14.4h7') + p('M8.5 17.8h3.8'),
    balanco:    `<ellipse class="s" cx="12" cy="6.8" rx="6.2" ry="2.7"/><ellipse pathLength="1" cx="12" cy="6.8" rx="6.2" ry="2.7"/>` + p('M5.8 6.8v4.3c0 1.5 2.8 2.7 6.2 2.7s6.2-1.2 6.2-2.7V6.8') + p('M5.8 11.1v4.3c0 1.5 2.8 2.7 6.2 2.7s6.2-1.2 6.2-2.7v-4.3') + p('M5.8 15.4v2.2c0 1.5 2.8 2.7 6.2 2.7s6.2-1.2 6.2-2.7v-2.2'),
    fechamento: p('M3 9.2l2.1-5h13.8l2.1 5') + p('M3 9.2a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0') + p('M5 12.6v8') + p('M19 12.6v8') + p('M5 16.4h14') + s('M9.4 16.4h5.2v4.2H9.4z'),
    categorias: p('M3.6 12V5.1a1.5 1.5 0 0 1 1.5-1.5H12l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z') + semente(8, 8, 1.8),
    previsao:   semente(6.8, 6.6, 2.5) + p('M6.8 1.8v1') + p('M2 6.6h1') + p('M3.4 3.2l.7.7') + p('M10.2 3.2l-.7.7') + p('M8.2 20.4h9.4a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.6-1.3 4.2 4.2 0 0 0-.3 8.3z'),
    comunicados: s('M3.6 9.8h3.6v4.4H3.6z') + p('M3.6 9.8h3.6l8-4.6v13.6l-8-4.6H3.6z') + p('M7.6 14.6l1 5.2h2.6l-1-4.2') + p('M18 9.3a4.2 4.2 0 0 1 0 5.4'),
    cupons:     p('M5 6.4h14a1.5 1.5 0 0 1 1.5 1.5v2.2a2 2 0 0 0 0 3.8v2.2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-2.2a2 2 0 0 0 0-3.8V7.9A1.5 1.5 0 0 1 5 6.4z') + p('M14.8 6.8v1.6') + p('M14.8 11v2') + p('M14.8 15.6v1.6') + semente(7.6, 10.2, 1.25) + semente(11, 13.8, 1.25) + p('M11.2 9.4l-3.8 5.2'),
    aparencia:  p('M20.3 3.7a1.6 1.6 0 0 0-2.3 0l-7.5 7.5 2.3 2.3 7.5-7.5a1.6 1.6 0 0 0 0-2.3z') + s('M9.5 12.4c-2.2 0-3.7 1.4-3.8 3.6-.1 1.5-.9 2.4-2.3 2.9 1.6 1.5 4.3 1.9 6.4.4 1.4-1 2-2.6 1.8-4.6z') + p('M9.5 12.4c-2.2 0-3.7 1.4-3.8 3.6-.1 1.5-.9 2.4-2.3 2.9 1.6 1.5 4.3 1.9 6.4.4 1.4-1 2-2.6 1.8-4.6z'),
    equipe:     p('M9.2 7H7.5A1.5 1.5 0 0 0 6 8.5V19a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8.5A1.5 1.5 0 0 0 16.5 7h-1.7') + p('M9.2 7.6L12 3.4l2.8 4.2') + semente(12, 12, 2.3) + p('M9 17.2h6'),
    config:     p('M4 7h8.6') + p('M17.4 7H20') + bola(15, 7, 2.2) + p('M4 12h2.6') + p('M11.4 12H20') + semente(9, 12, 2.3) + p('M4 17h10.6') + p('M19.4 17h.6') + bola(17, 17, 2.2),
    // ----- ações e avisos -----
    impressora: p('M7 8.5V4h10v4.5') + p('M7 16.5H5.5A1.5 1.5 0 0 1 4 15v-5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 10v5a1.5 1.5 0 0 1-1.5 1.5H17') + s('M7 13.5h10V20H7z') + p('M7 13.5h10V20H7z'),
    etiqueta:   p('M3.6 12V5.1a1.5 1.5 0 0 1 1.5-1.5H12l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z') + semente(8, 8, 1.8),
    sair:       p('M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14') + p('M10.5 12H20') + p('M16.5 8.5L20 12l-3.5 3.5'),
    lapis:      p('M4 20l1-4.2L16.6 4.2a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L8.2 19z') + s('M4 20l1-4.2 3.2 3.2z'),
    lixeira:    p('M4.5 7h15') + p('M9.5 7V4.5h5V7') + p('M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12') + p('M10 11v5.5') + p('M14 11v5.5'),
    olho:       p('M2.8 12c2-4 5.2-6 9.2-6s7.2 2 9.2 6c-2 4-5.2 6-9.2 6s-7.2-2-9.2-6z') + semente(12, 12, 2.6),
    olhoFechado: p('M3 9.5c2 3.4 5 5.1 9 5.1s7-1.7 9-5.1') + p('M12 14.6v3') + p('M6.8 13.2l-1.6 2.5') + p('M17.2 13.2l1.6 2.5'),
    alerta:     p('M12 4.2L21 19.5H3z') + p('M12 10v4.4') + semente(12, 16.8, 1.1),
    certo:      bola(12, 12, 8.4) + p('M8 12.4l2.8 2.8L16.2 9.4'),
    pino:       p('M12 21s-6.6-6.1-6.6-11.2a6.6 6.6 0 0 1 13.2 0C18.6 14.9 12 21 12 21z') + semente(12, 9.8, 2.3),
    nota:       p('M6.5 3.8h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5.3a1.5 1.5 0 0 1 1.5-1.5z') + p('M14.5 3.8v4h4') + p('M8.5 12h7') + p('M8.5 15.6h4.5'),
    dinheiro:   p('M3.5 7h17v10h-17z') + semente(12, 12, 2.4) + p('M6.5 9.8v4.4') + p('M17.5 9.8v4.4'),
    balanca:    p('M12 4v16') + p('M7.5 20h9') + p('M5 7.2h14') + p('M5 7.2l-2.4 5.6a2.6 2.6 0 0 0 4.8 0z') + s('M19 7.2l-2.4 5.6a2.6 2.6 0 0 0 4.8 0z') + p('M19 7.2l-2.4 5.6a2.6 2.6 0 0 0 4.8 0z'),
    espera:     p('M7 3.8h10') + p('M7 20.2h10') + p('M8 3.8c0 4 4 5 4 8.2s-4 4.2-4 8.2') + p('M16 3.8c0 4-4 5-4 8.2s4 4.2 4 8.2') + s('M9.4 19.6c.4-1.9 1.3-2.8 2.6-3.6 1.3.8 2.2 1.7 2.6 3.6z'),
    faisca:     s('M11 3.5l1.9 5.2 5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2-5.2-1.9 5.2-1.9z') + p('M11 3.5l1.9 5.2 5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2-5.2-1.9 5.2-1.9z') + p('M18.5 15.5v4') + p('M16.5 17.5h4'),
    baixar:     p('M12 4v11') + p('M7.5 10.8L12 15.3l4.5-4.5') + p('M4.5 19.5h15'),
    enviar:     p('M3.8 11.3L20.2 4l-4.6 16.2-3.6-6.4z') + s('M12 13.8l8.2-9.8-4.6 16.2z') + p('M12 13.8l8.2-9.8'),
    repetir:    p('M19.5 11a7.5 7.5 0 0 0-13.2-4.2L4.5 8.6') + p('M4.5 4.4v4.2h4.2') + p('M4.5 13a7.5 7.5 0 0 0 13.2 4.2l1.8-1.8') + p('M19.5 19.6v-4.2h-4.2'),
    cadeado:    p('M6.5 10.5h11A1.5 1.5 0 0 1 19 12v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5z') + p('M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7') + semente(12, 15.4, 1.6),
    cesta:      p('M3.5 10h17l-1.6 9.2a1.5 1.5 0 0 1-1.5 1.3H6.6a1.5 1.5 0 0 1-1.5-1.3z') + p('M7.5 10l3-6') + p('M16.5 10l-3-6') + semente(12, 15.2, 1.7),
    sino:       p('M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z') + p('M12 3v2') + s('M10 20.2a2 2 0 0 0 4 0z'),
    caixa:      p('M4 8l8-4 8 4v8.5l-8 4-8-4z') + p('M4 8l8 4 8-4') + p('M12 12v8.5') + s('M8 6l8 4v3l-2 1v-3L6 7z'),
    sobe:       p('M3.5 17.5l5.5-5.5 3.5 3.5 7.5-8') + p('M15 7.5h5v5'),
    desce:      p('M3.5 6.5l5.5 5.5 3.5-3.5 7.5 8') + p('M15 16.5h5v-5'),
    alvo:       bola(12, 12, 8.4) + bola(12, 12, 4.6) + semente(12, 12, 1.7),
    folha:      s('M5 19c-.8-7.6 3.4-13 14-14 .8 7.6-3.4 13-14 14z') + p('M5 19c-.8-7.6 3.4-13 14-14 .8 7.6-3.4 13-14 14z') + p('M5 19l8-8'),
    pix:        p('M12 3.6l8.4 8.4-8.4 8.4L3.6 12z') + s('M12 8.6l3.4 3.4-3.4 3.4L8.6 12z'),
    entrega:    bola(7, 17.5, 2.6) + bola(17.5, 17.5, 2.6) + p('M7 17.5l3.5-7h5l2 7') + p('M9.5 10.5h-3') + s('M13.2 5.5h4.3v3.6h-4.3z') + p('M13.2 5.5h4.3v3.6h-4.3z'),
    loja:       p('M3 9.2l2.1-5h13.8l2.1 5') + p('M3 9.2a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0') + p('M5 12.6v8h14v-8') + s('M10 15h4v5.6h-4z'),
    menu:       s('M4 4h6.5v6.5H4z') + p('M4 4h6.5v6.5H4z') + p('M13.5 4H20v6.5h-6.5z') + p('M4 13.5h6.5V20H4z') + p('M13.5 13.5H20V20h-6.5z'),
    mais:       p('M12 5v14') + p('M5 12h14'),
    copiar:     p('M9 8.5h9.5A1.5 1.5 0 0 1 20 10v9a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 19v-9A1.5 1.5 0 0 1 9 8.5z') + p('M16.5 8.5V5A1.5 1.5 0 0 0 15 3.5H5.5A1.5 1.5 0 0 0 4 5v9.5A1.5 1.5 0 0 0 5.5 16h2'),
    vazio:      p('M4 13.5l2.4-8h11.2l2.4 8') + p('M4 13.5h4.6l1 2.5h4.8l1-2.5H20V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z'),
};
// nomes alternativos (o mesmo desenho serve a mais de um lugar)
const APELIDOS = { sacola: 'compras', pessoas: 'crm', moedas: 'balanco', barras: 'relatorios', prancheta: 'pedidos', cupom: 'cupons', megafone: 'comunicados', ajustes: 'config', toldo: 'fechamento' };
const desenho = (nome) => ICONES[nome] || ICONES[APELIDOS[nome]] || '';

/** O desenho pronto para colocar no HTML. */
export const ico = (nome, classe = '') => `<svg class="ic${classe ? ` ${classe}` : ''}" data-i="${nome}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${desenho(nome)}</svg>`;

/** Troca as marcas <i class="ic" data-i="..."> que estiverem dentro de `raiz` pelos desenhos. */
export function hidratar(raiz = document) {
    const marcas = raiz.querySelectorAll ? raiz.querySelectorAll('i.ic[data-i]') : [];
    marcas.forEach((m) => {
        if (!desenho(m.dataset.i)) return;
        const molde = document.createElement('template');
        molde.innerHTML = ico(m.dataset.i, [...m.classList].filter((c) => c !== 'ic').join(' '));
        m.replaceWith(molde.content.firstChild);
    });
}
// Liga sozinho: desenha o que já está na página e o que aparecer depois.
if (typeof document !== 'undefined' && !window.__iconesLigados) {
    window.__iconesLigados = true;
    const ligar = () => {
        hidratar(document);
        new MutationObserver((mudancas) => {
            for (const m of mudancas) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; if (n.matches && n.matches('i.ic[data-i]')) hidratar(n.parentNode); else hidratar(n); }
        }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) ligar(); else document.addEventListener('DOMContentLoaded', ligar);
}
