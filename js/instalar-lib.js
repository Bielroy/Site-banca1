// =====================================================================
//  js/instalar-lib.js — quando mostrar o convite "ponha a loja na tela inicial" no iPhone.
//
//  O iPhone não deixa o site abrir o convite de instalar (o Android deixa: é o botão do topo).
//  Então, no iPhone, a loja mostra um cartão explicando o caminho, só para quem já pediu antes
//  (cliente que volta), e não insiste: fechou, some por 30 dias.
//
//  Dentro do Instagram, Facebook, TikTok etc. o iPhone nem oferece "Adicionar à Tela de Início":
//  lá o cartão manda abrir no Safari. Sem nada de tela aqui: só regras (testadas em testes/index.js).
// =====================================================================

export const DIAS_SEM_INSISTIR = 30;

// navegadores embutidos em apps (a opção de pôr na tela inicial não existe neles)
const EMBUTIDO = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|musical_ly|BytedanceWebview|TikTok|Snapchat|Line\/|LinkedInApp|Pinterest|GSA\//i;

/** iPhone/iPad? (o iPad novo se diz "Macintosh", mas tem tela de toque) */
export function ehIOS(ua, toques = 0) {
    const u = String(ua || '');
    return /iPhone|iPad|iPod/i.test(u) || (/Macintosh/i.test(u) && Number(toques) > 1);
}

/** 'embutido' (Instagram, Facebook...), 'safari' ou 'outro' (Chrome, Firefox, Edge do iPhone). */
export function navegadorIOS(ua) {
    const u = String(ua || '');
    if (EMBUTIDO.test(u)) return 'embutido';
    if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//i.test(u)) return 'outro';
    return 'safari';
}

/**
 * Mostra o convite? Só no iPhone/iPad, fora do modo app, fora da prévia do painel,
 * para quem já fez pedido nesta loja, e se não fechou nos últimos 30 dias.
 */
export function deveConvidar({ ios, jaEhApp, emPrevia, emQuadro, pedidos, fechadoEm, agora = Date.now() }) {
    if (!ios || jaEhApp || emPrevia || emQuadro) return false;
    if (!(Number(pedidos) > 0)) return false;
    const f = Number(fechadoEm);
    if (Number.isFinite(f) && f > 0 && agora - f < DIAS_SEM_INSISTIR * 864e5) return false;
    return true;
}
