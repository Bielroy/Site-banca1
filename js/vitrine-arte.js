// =====================================================================
//  js/vitrine-arte.js — DESENHOS PRÓPRIOS da vitrine (SVG, sem arquivo para baixar).
//
//  Ícones coloridos das categorias, no mesmo traço da logo (caixote com
//  frutas): laranja, verde-folha, creme e madeira. E os ícones dos selos
//  ("Chegou hoje", "Da estação", "Escolha da casa") e das faixas.
//  Tudo fixo, escrito aqui: nada vem de quem usa a loja (não precisa escapar).
// =====================================================================
const arte = (miolo, rotulo = '') =>
    `<svg class="arte-cat" viewBox="0 0 24 24" ${rotulo ? `role="img" aria-label="${rotulo}"` : 'aria-hidden="true"'} focusable="false">${miolo}</svg>`;
const traco = (miolo, extra = '') =>
    `<svg class="ico${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${miolo}</svg>`;

const V = '#5FA77D', VC = '#7CC99B', VE = '#3E7D5A', L = '#E9A862', M = '#F2B33D', C = '#F6F1E4', MAD = '#D9C7A3', MADE = '#9C7B4B';

/** Ícone de cada categoria (o nome vem de iconeDaCategoria em js/vitrine-lib.js). */
export const ARTE_CATEGORIA = {
    todas: arte(`<circle cx="15.5" cy="8.5" r="3.6" fill="${VC}"/><circle cx="9.5" cy="8" r="4.6" fill="${L}"/><rect x="3.5" y="11.5" width="17" height="3" rx="1" fill="${C}" stroke="${MAD}" stroke-width=".8"/><rect x="3.5" y="15.5" width="17" height="3" rx="1" fill="${C}" stroke="${MAD}" stroke-width=".8"/><rect x="3" y="11" width="3" height="9" rx="1" fill="${MAD}"/><rect x="18" y="11" width="3" height="9" rx="1" fill="${MAD}"/>`),
    favoritos: arte('<path d="M12 20.5s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z" fill="#E06A5A"/><path d="M8.3 9.6a2 2 0 0 1 1.9-1.4" stroke="#F4B3A8" stroke-width="1.3" fill="none" stroke-linecap="round"/>'),
    fruta: arte(`<circle cx="12" cy="14" r="7" fill="${L}"/><circle cx="9.4" cy="11.8" r="1.4" fill="#F5C892"/><path d="M12 7.2c.1-2.2 1.4-3.7 3.8-4.1-.2 2.4-1.6 3.9-3.8 4.1z" fill="${V}"/><path d="M12 7.4V5.6" stroke="${MADE}" stroke-width="1.3" stroke-linecap="round"/>`),
    folha: arte(`<path d="M4.5 19.5C4.5 10.5 10.5 4.5 19.5 4.5c0 9-6 15-15 15z" fill="${VC}"/><path d="M5.5 18.5l10.5-10.5M9.5 14.5h4.5M12.3 11.7V8" stroke="${VE}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`),
    legume: arte(`<path d="M16.2 7.8L4.6 19.6c3.2 1.2 8.6-2.1 12.8-8.7z" fill="#E9873A"/><path d="M8.6 15.2l1.6.9M11.3 12.6l1.5.9M13.7 10.1l1.2.8" stroke="#C4651F" stroke-width="1.2" stroke-linecap="round"/><path d="M16.4 7.6c1-2.6 3-3.7 5.1-3.6M16.4 7.6c.4-2.7-.4-4.6-2.1-5.6M16.4 7.6c2.3-.6 4.1 0 5.6 1.5" stroke="${V}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`),
    raiz: arte(`<path d="M4.2 13.6c-.4-3.6 3.3-6.8 8-7 4.8-.2 8 2.7 7.6 6.4-.4 3.9-4 5.7-8 5.7s-7.2-1.7-7.6-5.1z" fill="#C9A06B"/><circle cx="9" cy="11.6" r=".9" fill="#8E6A3E"/><circle cx="14.6" cy="14.6" r=".9" fill="#8E6A3E"/><circle cx="15.4" cy="10.4" r=".7" fill="#8E6A3E"/><path d="M7 15.5c1.4.9 3 1.2 4.7 1.1" stroke="#E0C08F" stroke-width="1.1" fill="none" stroke-linecap="round"/>`),
    tempero: arte(`<path d="M12 21V5.5" stroke="${VE}" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="8.6" cy="8.6" rx="3.2" ry="1.7" transform="rotate(35 8.6 8.6)" fill="${VC}"/><ellipse cx="15.4" cy="9.6" rx="3.2" ry="1.7" transform="rotate(-35 15.4 9.6)" fill="${V}"/><ellipse cx="8.6" cy="13.6" rx="3.2" ry="1.7" transform="rotate(35 8.6 13.6)" fill="${V}"/><ellipse cx="15.4" cy="14.6" rx="3.2" ry="1.7" transform="rotate(-35 15.4 14.6)" fill="${VC}"/><ellipse cx="12" cy="4.6" rx="1.4" ry="2.4" fill="${VC}"/>`),
    ovo: arte('<path d="M12 3c3.6 0 6.5 5.4 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.4 8.4 3 12 3z" fill="#F6E7C8" stroke="#D9B98A" stroke-width="1"/><path d="M9 9.5c.5-1.3 1.3-2.3 2.2-2.8" stroke="#FFF8EA" stroke-width="1.4" fill="none" stroke-linecap="round"/>'),
    cesta: arte(`<circle cx="9" cy="9.2" r="2.8" fill="${L}"/><circle cx="14.6" cy="8.8" r="2.4" fill="${VC}"/><path d="M8.2 10.5L11 4.5M15.8 10.5L13 4.5" stroke="${MADE}" stroke-width="1.6" stroke-linecap="round"/><path d="M3.5 10.5h17l-1.8 8.7a2 2 0 0 1-2 1.6H7.3a2 2 0 0 1-2-1.6z" fill="${MAD}"/><path d="M5.8 13.8h12.4M6.4 16.9h11.2" stroke="#B89A6A" stroke-width="1.1"/>`),
    queijo: arte('<path d="M3 15.2L16.6 7.4 21 11.6v6.9H3z" fill="#F2C94C"/><path d="M3 15.2h18" stroke="#D4A82A" stroke-width="1"/><circle cx="7.6" cy="17.2" r="1.1" fill="#D4A82A"/><circle cx="13" cy="16.8" r=".8" fill="#D4A82A"/><circle cx="17.6" cy="13" r="1" fill="#D4A82A"/>'),
    copo: arte(`<path d="M6 4.5h12l-1.6 14.9a2 2 0 0 1-2 1.6H9.6a2 2 0 0 1-2-1.6z" fill="${C}" stroke="${MAD}" stroke-width="1"/><path d="M7 9h10l-1.1 10.1a1 1 0 0 1-1 .9H9.1a1 1 0 0 1-1-.9z" fill="${M}"/><circle cx="16.8" cy="5.2" r="2.6" fill="${L}"/><path d="M15.4 5.2h2.8" stroke="#F5C892" stroke-width=".9"/>`),
    pote: arte(`<rect x="6" y="7.2" width="12" height="13.8" rx="3" fill="${M}"/><rect x="5" y="3.5" width="14" height="4.2" rx="1.6" fill="#B5462F"/><path d="M7 5.6h10" stroke="#D96B52" stroke-width=".9"/><rect x="8.5" y="11" width="7" height="5" rx="1" fill="${C}"/><path d="M10 13.5h4" stroke="${MAD}" stroke-width="1" stroke-linecap="round"/>`),
};

/** Ícones dos selos e das faixas (traço, na cor do texto). */
export const ARTE_SELO = {
    chegou: traco('<path d="M12 20.5v-8"/><path d="M12 12.5c0-4.2-3-6.5-7-6.5 0 4.2 3 6.5 7 6.5z"/><path d="M12 14.5c0-3.6 2.6-5.6 6.6-5.6 0 3.6-2.6 5.6-6.6 5.6z"/>', 'selo-ico'),
    estacao: traco('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>', 'selo-ico'),
    escolha: traco('<circle cx="12" cy="9" r="5.2"/><path d="M9.6 8.9l1.7 1.7 3.2-3.3"/><path d="M8.6 13.4L7.2 21l4.8-2.6 4.8 2.6-1.4-7.6"/>', 'selo-ico'),
    mais: traco('<path d="M12 21c-4 0-6.5-2.7-6.5-6.2 0-3.9 3.3-5.6 3.8-9.8 2.6 1.6 3.4 4 3.4 5.6 1-.6 1.8-1.8 2-3.2 2.1 1.9 3.8 4.4 3.8 7.4 0 3.5-2.5 6.2-6.5 6.2z"/>', 'selo-ico'),
    kits: traco('<path d="M3.5 10h17l-1.8 9a2 2 0 0 1-2 1.6H7.3a2 2 0 0 1-2-1.6z"/><path d="M8 10l3-6M16 10l-3-6M7 14h10"/>', 'selo-ico'),
};

/** Pacotinho de papel pardo com janela (bloco "Pacotes prontos", atalho, selo do cartão, sacola e painel). */
export const ARTE_PACOTE = arte(`<path d="M5.2 7.5h13.6l-1.1 13.1a1.5 1.5 0 0 1-1.5 1.4H7.8a1.5 1.5 0 0 1-1.5-1.4z" fill="#d9b27a"/><path d="M5.2 7.5 6.4 3.6c.1-.4.5-.6.9-.6h9.4c.4 0 .8.2.9.6l1.2 3.9z" fill="#b98a4e"/><path d="M5.6 7.6l1.1-.9 1.1.9 1.1-.9 1.1.9 1.1-.9 1.1.9 1.1-.9 1.1.9 1.1-.9 1.1.9 1.1-.9 1.1.9" fill="none" stroke="#8a5f2a" stroke-width=".7" stroke-linejoin="round"/><rect x="7.4" y="9.4" width="9.2" height="7" rx="1.6" fill="#f6efe2"/><ellipse cx="9.9" cy="14.5" rx="1.7" ry="1.35" fill="#c9a06b"/><ellipse cx="13.9" cy="14.6" rx="1.8" ry="1.35" fill="#b98f5a"/><ellipse cx="11.9" cy="12.2" rx="1.6" ry="1.3" fill="#d8b07a"/><rect x="7.4" y="17.6" width="9.2" height="2.3" rx=".5" fill="#f6efe2"/><path d="M8.8 18.75h4.6" stroke="#9c7b4b" stroke-width=".8" stroke-linecap="round"/>`);

/** Balança (grupo "Pesados na hora" da sacola e da comanda), no traço da cor do texto. */
export const ARTE_BALANCA = traco('<path d="M12 3v18M5 21h14M4 7h16"/><path d="M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>', 'grupo-ico');

/** Desenho para o bloco "Quem escolhe seu pedido" quando o dono ainda não pôs foto. */
export const ARTE_DONOS = `<svg class="donos-arte" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <circle cx="60" cy="60" r="58" fill="${C}"/>
    <circle cx="78" cy="48" r="15" fill="${VC}"/><circle cx="50" cy="44" r="20" fill="${L}"/>
    <path d="M50 24c.6-7 5.6-10.4 11.4-10-1 6-5 9.6-11.4 10z" fill="${V}"/>
    <rect x="22" y="62" width="76" height="11" rx="3" fill="#fff" stroke="${MAD}" stroke-width="1.5"/>
    <rect x="22" y="77" width="76" height="11" rx="3" fill="#fff" stroke="${MAD}" stroke-width="1.5"/>
    <rect x="22" y="92" width="76" height="11" rx="3" fill="#fff" stroke="${MAD}" stroke-width="1.5"/>
    <rect x="18" y="60" width="11" height="46" rx="3" fill="${MAD}"/><rect x="91" y="60" width="11" height="46" rx="3" fill="${MAD}"/>
</svg>`;
