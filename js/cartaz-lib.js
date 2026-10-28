// =====================================================================
//  js/cartaz-lib.js — CARTAZ A4 "Agora temos aplicativo" de uma feira (puro: entra dado, sai página).
//
//  Plataforma → Feiras → Cartaz. O QR Code leva ao link DAQUELA feira (/feira/id), então cada
//  feira imprime o seu. No rodapé, um círculo tracejado marca onde colar a fitinha NFC
//  (a fitinha precisa ser gravada com o mesmo link, num app como o "NFC Tools").
//  A página sai pronta para a tela de imprimir (ou "Salvar como PDF"): A4, sem script, sem arquivo de fora.
// =====================================================================
import { qrDe, qrCaminho } from './qr-lib.js';
import { urlImagem, contraste, ehEscura } from './aparencia-lib.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** O link sem "https://", para mostrar escrito embaixo do QR. */
export const linkCurto = (link) => String(link || '').replace(/^https?:\/\//i, '');

/** QR do link como <svg> (com a borda clara que o leitor precisa). '' se o link é longo demais. */
export function qrSvg(link, { tamanho = 176, cor = '#1a3a2a' } = {}) {
    const g = qrDe(link); if (!g) return '';
    const n = g.length, b = 2;
    return `<svg width="${tamanho}" height="${tamanho}" viewBox="${-b} ${-b} ${n + 2 * b} ${n + 2 * b}" shape-rendering="crispEdges" role="img" aria-label="QR Code: ${esc(linkCurto(link))}"><rect x="${-b}" y="${-b}" width="${n + 2 * b}" height="${n + 2 * b}" fill="#fff"/><path fill="${cor}" d="${qrCaminho(g)}"/></svg>`;
}

const CAIXOTE = `<svg width="56" height="56" viewBox="90 60 340 350" aria-hidden="true"><circle cx="322" cy="203" r="56" fill="#7cc99b"/><circle cx="216" cy="190" r="76" fill="#e9a862"/><path d="M216 114c2-22 14-32 44-32-2 24-14 32-44 32z" fill="#7cc99b"/><rect x="132" y="232" width="236" height="156" fill="#f6efe2"/><rect x="132" y="274" width="236" height="15" fill="#1a3a2a"/><rect x="132" y="331" width="236" height="15" fill="#1a3a2a"/><rect x="104" y="224" width="40" height="168" rx="12" fill="#d9c7a3"/><rect x="368" y="224" width="40" height="168" rx="12" fill="#d9c7a3"/></svg>`;
const NFC = `<svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="#f2b33d" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 8.5a5.5 5.5 0 0 1 0 7"/><path d="M9.5 6a9 9 0 0 1 0 12"/><path d="M13 3.5a12.5 12.5 0 0 1 0 17"/><circle cx="3.5" cy="12" r="1" fill="#f2b33d" stroke="none"/></svg>`;

const passo = (n, titulo, resto) => `<div class="passo"><div class="num">${n}</div><div class="txt"><b>${titulo}</b> ${resto}</div></div>`;
const fruta = (cor, folha = '#4a9467') => `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="8.5" fill="${cor}"/><circle cx="9" cy="11" r="1.6" fill="#fff" opacity=".35"/><path d="M12 5.5c.2-2.6 1.8-4 4.4-4.3-.2 2.7-1.8 4.2-4.4 4.3z" fill="${folha}"/></svg>`;
const card = (nome, cor) => `<div class="mc"><div class="mf">${fruta(cor)}</div><div class="mn">${nome}</div><div class="mb">Adicionar</div></div>`;

/** Desenho do celular com a loja aberta (só enfeite e explicação: não tem preço nem produto de verdade). */
const CELULAR = `<div class="cel" aria-hidden="true"><div class="tela">
<div class="mh"><div class="mlogo"></div><b>Banca</b></div>
<div class="mbusca">Buscar tomate, alface...</div>
<div class="mchips"><span class="on">Todos</span><span>Frutas</span><span>Folhas</span></div>
<div class="mgrade">${card('Tomate', '#d9503f')}${card('Alface', '#7cc99b')}${card('Laranja', '#e9a862')}${card('Banana', '#f2c94c')}${card('Cenoura', '#e9873a')}${card('Limão', '#b9d64a')}</div>
<div class="msacola">Ver sacola</div>
</div></div>`;

/** Página completa do cartaz. feira = { nome }, link = endereço da feira (https://.../feira/id). */
export function cartazHtml({ feira, link }) {
    const nome = String(feira && feira.nome || '').trim().slice(0, 60);
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cartaz ${esc(nome)}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: 210mm; height: 297mm; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
/* o fundo fica em cada BLOCO (o fundo do <body> some em alguns celulares na hora de salvar o PDF) */
.pg { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #1a3a2a; color: #faf7f2; }
.bola { position: absolute; border-radius: 50%; }
.topo { position: absolute; left: 15mm; top: 12mm; width: 118mm; }
.marca { display: flex; align-items: center; gap: 3.5mm; font-size: 5.6mm; font-weight: 800; letter-spacing: .1mm; color: #f2b33d; }
.marca svg { width: 13mm; height: 13mm; flex: none; }
h1 { margin: 6mm 0 0; font-family: Georgia, "Times New Roman", serif; font-weight: 900; font-size: 20.5mm; line-height: .98; letter-spacing: -.3mm; color: #faf7f2; }
h1 span { color: #f2b33d; }
.sub { margin: 6mm 0 0; font-size: 6.4mm; line-height: 1.3; font-weight: 600; color: #e8f5ee; }
.painel { position: absolute; left: 0; right: 0; top: 112mm; bottom: 0; background: #faf7f2; color: #1a1a18; border-radius: 11mm 11mm 0 0; overflow: hidden; }
.toldo { height: 4mm; background: repeating-linear-gradient(90deg, #1a3a2a 0 7.4mm, #faf7f2 7.4mm 14.8mm); }
.passos { padding: 8mm 84mm 0 15mm; display: flex; flex-direction: column; gap: 4.5mm; }
.titulo-passos { font-size: 4.6mm; font-weight: 800; letter-spacing: .5mm; text-transform: uppercase; color: #9a5a1f; }
.passo { display: flex; align-items: center; gap: 4.5mm; }
.num { flex: none; width: 14mm; height: 14mm; border-radius: 50%; background: #f2b33d; color: #1a3a2a; font-weight: 800; font-size: 8mm; display: flex; align-items: center; justify-content: center; font-family: Georgia, serif; }
.txt { font-size: 5.7mm; line-height: 1.22; }
.txt b { display: block; font-size: 6.6mm; }
.dica { position: absolute; left: 136mm; right: 15mm; top: 62mm; background: #e8f5ee; color: #1a3a2a; border-radius: 4mm; padding: 3.5mm 4mm; font-size: 4.3mm; line-height: 1.28; display: flex; align-items: flex-start; gap: 2.5mm; }
.dica .mais { flex: none; width: 7mm; height: 7mm; border-radius: 50%; background: #1a3a2a; color: #faf7f2; font-weight: 800; font-size: 5mm; line-height: 7mm; text-align: center; }
.rodape { position: absolute; left: 15mm; right: 15mm; bottom: 10mm; height: 72mm; display: flex; gap: 6mm; }
.qr { flex: 1; background: #fff; border: .5mm solid #d9c7a3; border-radius: 6mm; padding: 4.5mm; display: flex; align-items: center; gap: 4.5mm; }
.qr svg.codigo { flex: none; width: 56mm; height: 56mm; }
.qr b { display: block; font-family: Georgia, serif; font-size: 7mm; line-height: 1.08; }
.qr small { display: block; margin-top: 2mm; font-size: 4.2mm; color: #3b3b36; }
.nfc { flex: none; width: 58mm; background: #1a3a2a; color: #faf7f2; border-radius: 6mm; padding: 4.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3mm; text-align: center; font-weight: 800; font-size: 5.4mm; line-height: 1.15; }
.nfc .anel { width: 40mm; height: 40mm; border: .8mm dashed #f2b33d; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
/* celular */
.cel { position: absolute; right: 11mm; top: 30mm; width: 66mm; height: 134mm; background: #0f2419; border-radius: 9.5mm; padding: 2.6mm; transform: rotate(5deg); box-shadow: 0 3mm 7mm rgba(0,0,0,.35); z-index: 5; }
.tela { width: 100%; height: 100%; background: #faf7f2; border-radius: 7mm; overflow: hidden; display: flex; flex-direction: column; color: #1a1a18; }
.mh { background: #1a3a2a; color: #faf7f2; padding: 5mm 3.5mm 3mm; display: flex; align-items: center; gap: 2mm; font-size: 4mm; }
.mlogo { width: 5mm; height: 5mm; border-radius: 50%; background: linear-gradient(90deg, #e9a862 55%, #7cc99b 55%); }
.mbusca { margin: 2.5mm 3mm 0; background: #e6e3dc; border-radius: 4mm; padding: 1.8mm 3mm; font-size: 2.9mm; color: #6b6b64; }
.mchips { display: flex; gap: 1.5mm; margin: 2mm 3mm 0; font-size: 2.9mm; font-weight: 700; }
.mchips span { border: .3mm solid #cfc9bb; border-radius: 4mm; padding: .9mm 2.4mm; }
.mchips .on { background: #1a3a2a; color: #faf7f2; border-color: #1a3a2a; }
.mgrade { margin: 2.5mm 3mm 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; flex: 1; align-content: start; }
.mc { background: #fff; border: .3mm solid #e6e0d2; border-radius: 3mm; padding: 1.8mm; display: flex; flex-direction: column; align-items: center; gap: .8mm; }
.mf svg { width: 11mm; height: 11mm; display: block; }
.mn { font-size: 3.2mm; font-weight: 800; }
.mb { background: #f2b33d; color: #1a3a2a; font-size: 2.7mm; font-weight: 800; border-radius: 3mm; padding: .9mm 0; width: 100%; text-align: center; }
.msacola { margin: 0 3mm 3.5mm; background: #1a3a2a; color: #faf7f2; border-radius: 4mm; text-align: center; padding: 2.4mm 0; font-size: 3.4mm; font-weight: 800; }
</style></head><body><div class="pg">
<div class="bola" style="width:70mm;height:70mm;left:-26mm;top:78mm;background:#234b38"></div>
<div class="bola" style="width:34mm;height:34mm;left:108mm;top:-12mm;background:#234b38"></div>
<div class="topo">
<div class="marca">${CAIXOTE}<span>${esc(nome || 'Feira')}</span></div>
<h1>Agora temos <span>aplicativo!</span></h1>
<p class="sub">Escolha a sua banca e monte o pedido no celular.</p>
</div>
${CELULAR}
<div class="painel"><div class="toldo"></div>
<div class="passos">
<div class="titulo-passos">É fácil, são 3 passos</div>
${passo(1, 'Abra a loja.', 'Aponte a câmera para o QR ou encoste o celular na fitinha.')}
${passo(2, 'Escolha.', 'Toque em <b style="display:inline;font-size:inherit">Adicionar</b> nos produtos que você quer levar.')}
${passo(3, 'Envie o pedido.', 'Abra a sacola, confira e mande. A banca confirma com você.')}
</div>
<div class="dica"><span class="mais">+</span><span><b>Dica:</b> no menu do navegador, toque em <b>Adicionar à tela inicial</b>. A loja vira um ícone no celular.</span></div>
<div class="rodape">
<div class="qr">${qrSvg(link, { tamanho: 176 }).replace('<svg ', '<svg class="codigo" ')}<div><b>Aponte a câmera aqui</b><small>ou digite<br>${esc(linkCurto(link)).replace(/([/-])/g, '$1<wbr>')}</small></div></div>
<div class="nfc"><div class="anel">${NFC}</div>Encoste o celular aqui</div>
</div>
</div></div></body></html>`;
}


// =====================================================================
//  CARTAZ DA LOJA (um por banca, nas cores, na logo e na foto DELA)
//  Plataforma → Lojas → (abrir a loja) → "Cartaz com QR e fitinha NFC".
//  Mostra: o nome e a logo da loja, a foto da loja (a "capa" da Aparência: o food truck, a banca...), o condomínio,
//  o QR Code que abre ESTA loja e um quadro grande de como usar a fitinha NFC (onde encostar o celular).
// =====================================================================
const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (v) => (HEX.test(String(v)) ? String(v).toLowerCase() : '');
const tintaSobreCor = (c) => (contraste(c, '#ffffff') >= contraste(c, '#1a1a18') ? '#ffffff' : '#1a1a18');

/** As cores do cartaz a partir do tema da loja: fundo escuro, cor de destaque que lê bem sobre ele e painel claro. */
export function paletaDoCartaz(tema) {
    const t = tema || {};
    const escuro = [t.primaria, t.texto, t.fundo, t.superficie].map(hex).find((c) => c && ehEscura(c)) || '#1a1a18';
    const destaque = [t.destaque, t.botao, t.secundaria, t.primaria].map(hex).find((c) => c && contraste(c, escuro) >= 4) || '#f2b33d';
    const claro = [t.fundo, t.superficie].map(hex).find((c) => c && !ehEscura(c) && contraste(c, '#1a1a18') >= 10) || '#faf7f2';
    return { escuro, destaque, claro, sobreDestaque: tintaSobreCor(destaque), tinta: '#1a1a18' };
}

const PIN = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>';

/** Desenho: a parte de trás do celular indo ao encontro da fitinha (a câmera fica no alto), com as ondinhas do NFC. */
const CELULAR_NA_FITINHA = (cor, claro) => `<svg viewBox="0 0 108 120" width="100%" height="100%" aria-hidden="true">
<g transform="rotate(-12 44 62)"><rect x="18" y="12" width="52" height="92" rx="10" fill="${claro}" stroke="${cor}" stroke-width="2.6"/><rect x="24" y="18" width="17" height="17" rx="5" fill="${cor}" opacity=".92"/><circle cx="32.5" cy="26.5" r="3.4" fill="${claro}"/><circle cx="46" cy="22" r="1.8" fill="${cor}"/></g>
<g stroke="${cor}" stroke-width="3" stroke-linecap="round" fill="none"><path d="M78 48a16 16 0 0 1 0 24"/><path d="M86 40a28 28 0 0 1 0 40"/><path d="M94 32a40 40 0 0 1 0 56"/></g></svg>`;

const NFC_ICONE = (cor) => `<svg viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 8.5a5.5 5.5 0 0 1 0 7"/><path d="M9.5 6a9 9 0 0 1 0 12"/><path d="M13 3.5a12.5 12.5 0 0 1 0 17"/><circle cx="3.5" cy="12" r="1" fill="${cor}" stroke="none"/></svg>`;
const ini = (nome) => (String(nome).trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2) || '?').toUpperCase();

/**
 * Página completa do cartaz de UMA LOJA.
 *   loja = { nome, subtitulo?, tema? (cores, logo, capa) }  ·  condominios = ['Jardins Florença', ...]  ·  link = endereço da loja.
 */
export function cartazLojaHtml({ loja, condominios = [], link }) {
    const l = loja || {}, nome = String(l.nome || '').trim().slice(0, 60) || 'Loja';
    const P = paletaDoCartaz(l.tema), logo = urlImagem(l.tema && l.tema.logo), foto = urlImagem(l.tema && l.tema.capa);
    const conds = (condominios || []).map((c) => String(c || '').trim()).filter(Boolean).slice(0, 3);
    const sub = String(l.subtitulo || '').trim().slice(0, 90);
    const selo = logo ? `<img class="logo" src="${esc(logo)}" alt="">` : `<div class="logo mono">${esc(ini(nome))}</div>`;
    const quadro = foto ? `<div class="foto"><img src="${esc(foto)}" alt=""></div>` : `<div class="foto vazio">${logo ? `<img src="${esc(logo)}" alt="" style="width:100%;height:100%;object-fit:contain">` : `<span>${esc(ini(nome))}</span>`}</div>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cartaz ${esc(nome)}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: 210mm; height: 297mm; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
.pg { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: ${P.escuro}; color: #fff; }
.bola { position: absolute; border-radius: 50%; background: rgba(255,255,255,.06); }
.topo { position: absolute; left: 15mm; top: 11mm; width: 112mm; }
.marca { display: flex; align-items: center; gap: 4mm; }
.logo { width: 22mm; height: 22mm; border-radius: 50%; object-fit: cover; flex: none; background: ${P.escuro}; border: .6mm solid ${P.destaque}; }
.logo.mono { display: flex; align-items: center; justify-content: center; font: 800 9mm Georgia, serif; color: ${P.destaque}; }
.marca b { font-size: 6.2mm; line-height: 1.12; font-weight: 800; letter-spacing: .1mm; color: ${P.destaque}; text-transform: uppercase; }
h1 { margin: 5mm 0 0; font-family: Georgia, "Times New Roman", serif; font-weight: 900; font-size: 16mm; line-height: 1; letter-spacing: -.3mm; color: #fff; }
h1 span { color: ${P.destaque}; }
.sub { margin: 4mm 0 0; font-size: 5.2mm; line-height: 1.3; font-weight: 600; color: rgba(255,255,255,.88); }
.onde { margin-top: 4mm; display: inline-flex; align-items: center; gap: 2mm; background: ${P.destaque}; color: ${P.sobreDestaque}; border-radius: 99mm; padding: 2mm 5mm 2mm 3mm; font-size: 5mm; font-weight: 800; max-width: 112mm; }
.onde svg { flex: none; }
.foto { position: absolute; right: 13mm; top: 14mm; width: 70mm; height: 70mm; border-radius: 6mm; overflow: hidden; border: 1.4mm solid ${P.destaque}; transform: rotate(3deg); box-shadow: 0 3mm 8mm rgba(0,0,0,.45); background: ${P.escuro}; }
.foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
.foto.vazio { display: flex; align-items: center; justify-content: center; font: 800 26mm Georgia, serif; color: ${P.destaque}; padding: 6mm; }
.painel { position: absolute; left: 0; right: 0; top: 113mm; bottom: 0; background: ${P.claro}; color: ${P.tinta}; border-radius: 11mm 11mm 0 0; overflow: hidden; }
.toldo { height: 4mm; background: repeating-linear-gradient(90deg, ${P.escuro} 0 7.4mm, ${P.claro} 7.4mm 14.8mm); }
.passos { padding: 5mm 15mm 0; display: flex; flex-direction: column; gap: 3mm; }
.titulo-passos { font-size: 4.4mm; font-weight: 800; letter-spacing: .5mm; text-transform: uppercase; color: ${P.escuro}; opacity: .75; }
.passo { display: flex; align-items: center; gap: 4mm; }
.num { flex: none; width: 11mm; height: 11mm; border-radius: 50%; background: ${P.escuro}; color: ${P.destaque}; font-weight: 800; font-size: 6.4mm; display: flex; align-items: center; justify-content: center; font-family: Georgia, serif; }
.txt { font-size: 4.8mm; line-height: 1.18; }
.txt b { display: block; font-size: 5.6mm; }
.rodape { position: absolute; left: 12mm; right: 12mm; bottom: 8mm; height: 105mm; display: flex; gap: 5mm; }
.qr { flex: none; width: 70mm; background: #fff; border: .5mm solid rgba(0,0,0,.15); border-radius: 6mm; padding: 4mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2.5mm; text-align: center; }
.qr svg.codigo { width: 52mm; height: 52mm; }
.qr b { display: block; font-family: Georgia, serif; font-size: 6.4mm; line-height: 1.1; }
.qr small { display: block; font-size: 3.7mm; color: #3b3b36; overflow-wrap: anywhere; }
.nfc { flex: 1; background: ${P.escuro}; color: #fff; border-radius: 6mm; padding: 4.2mm 5mm; display: flex; flex-direction: column; gap: 2.4mm; }
.nfc h2 { margin: 0; font-family: Georgia, serif; font-size: 6.8mm; line-height: 1.05; color: ${P.destaque}; }
.nfc-fluxo { display: flex; align-items: center; gap: 3mm; }
.nfc-fluxo .cel { flex: none; width: 31mm; height: 34mm; }
.nfc-fluxo .seta { flex: none; font: 800 8mm Georgia, serif; color: ${P.destaque}; }
.nfc .anel { flex: none; width: 31mm; height: 31mm; border: .8mm dashed ${P.destaque}; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.nfc .anel svg { width: 19mm; height: 19mm; }
.nfc-fluxo p { margin: 0; font-size: 3.7mm; line-height: 1.25; color: rgba(255,255,255,.85); }
.nfc ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 1.6mm; font-size: 3.9mm; line-height: 1.18; }
.nfc li { display: flex; gap: 2.4mm; align-items: flex-start; }
.nfc li i { flex: none; width: 5.6mm; height: 5.6mm; border-radius: 50%; background: ${P.destaque}; color: ${P.sobreDestaque}; font: 800 3.6mm/5.6mm Georgia, serif; text-align: center; font-style: normal; margin-top: .2mm; }
.nfc li b { color: ${P.destaque}; }
.nfc .nota { margin-top: auto; font-size: 3.4mm; line-height: 1.25; color: rgba(255,255,255,.75); border-top: .3mm solid rgba(255,255,255,.22); padding-top: 2mm; }
</style></head><body><div class="pg">
<div class="bola" style="width:70mm;height:70mm;left:-26mm;top:78mm"></div>
<div class="bola" style="width:34mm;height:34mm;left:108mm;top:-12mm"></div>
<div class="topo">
<div class="marca">${selo}<b>${esc(nome)}</b></div>
<h1>Peça pelo <span>celular!</span></h1>
<p class="sub">${esc(sub || 'Escolha, monte o seu pedido e a gente prepara.')}</p>
${conds.length ? `<div class="onde">${PIN}<span>${esc('Atendemos: ' + conds.join(' · '))}</span></div>` : ''}
</div>
${quadro}
<div class="painel"><div class="toldo"></div>
<div class="passos">
<div class="titulo-passos">É fácil, são 3 passos</div>
${passo(1, 'Abra a loja.', 'Aponte a câmera para o QR ou encoste o celular na fitinha.')}
${passo(2, 'Escolha.', 'Toque em <b style="display:inline;font-size:inherit">Adicionar</b> no que você quer levar.')}
${passo(3, 'Envie o pedido.', 'Abra a sacola, confira e mande. A gente confirma com você.')}
</div>
<div class="rodape">
<div class="qr">${qrSvg(link, { tamanho: 176, cor: P.escuro }).replace('<svg ', '<svg class="codigo" ')}<div><b>Aponte a câmera aqui</b><small>ou digite ${esc(linkCurto(link)).replace(/([/-])/g, '$1<wbr>')}</small></div></div>
<div class="nfc">
<h2>Encoste o celular aqui</h2>
<div class="nfc-fluxo"><div class="cel">${CELULAR_NA_FITINHA(P.destaque, P.escuro)}</div><span class="seta">&rarr;</span><div class="anel">${NFC_ICONE(P.destaque)}</div><p>O círculo é a fitinha NFC.</p></div>
<ol>
<li><i>1</i><span><b>Destrave</b> o celular. No Android, deixe o <b>NFC ligado</b>.</span></li>
<li><i>2</i><span>Encoste a <b>parte de trás</b> do celular, perto da câmera, no círculo.</span></li>
<li><i>3</i><span><b>Segure parado</b> por 2 segundos, até vibrar ou aparecer um aviso.</span></li>
<li><i>4</i><span><b>Toque no aviso</b> na tela e a loja abre.</span></li>
</ol>
<div class="nota">iPhone XS ou mais novo e quase todo Android têm NFC. Se o seu não ler, use o QR Code ao lado.</div>
</div>
</div>
</div></div></body></html>`;
}
