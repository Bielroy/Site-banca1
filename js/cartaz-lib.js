// =====================================================================
//  js/cartaz-lib.js — CARTAZ A4 "Agora temos aplicativo" de uma feira (puro: entra dado, sai página).
//
//  Plataforma → Feiras → Cartaz. O QR Code leva ao link DAQUELA feira (/feira/id), então cada
//  feira imprime o seu. No rodapé, um círculo tracejado marca onde colar a fitinha NFC
//  (a fitinha precisa ser gravada com o mesmo link, num app como o "NFC Tools").
//  A página sai pronta para a tela de imprimir (ou "Salvar como PDF"): A4, sem script, sem arquivo de fora.
// =====================================================================
import { qrDe, qrCaminho } from './qr-lib.js';

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

const passo = (n, html) => `<div class="passo"><div class="num">${n}</div><div class="txt">${html}</div></div>`;

/** Página completa do cartaz. feira = { nome }, link = endereço da feira (https://.../feira/id). */
export function cartazHtml({ feira, link }) {
    const nome = String(feira && feira.nome || '').trim().slice(0, 60);
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cartaz ${esc(nome)}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { width: 210mm; height: 297mm; overflow: hidden; background: #1a3a2a; color: #faf7f2; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pg { width: 210mm; height: 297mm; display: flex; flex-direction: column; }
.topo { padding: 11mm 15mm 8mm; display: flex; flex-direction: column; gap: 5mm; }
.marca { display: flex; align-items: center; gap: 4mm; font-size: 6mm; font-weight: 700; letter-spacing: .1mm; }
h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 900; font-size: 22mm; line-height: .98; letter-spacing: -.3mm; }
h1 span { color: #f2b33d; }
.sub { margin: 0; font-size: 7mm; line-height: 1.3; font-weight: 600; color: #e8f5ee; max-width: 170mm; }
.painel { flex: 1; background: #faf7f2; color: #1a1a18; border-radius: 11mm 11mm 0 0; overflow: hidden; display: flex; flex-direction: column; }
.toldo { height: 3.5mm; background: repeating-linear-gradient(90deg, #1a3a2a 0 7.4mm, #faf7f2 7.4mm 14.8mm); }
.passos { padding: 6.5mm 15mm 0; display: flex; flex-direction: column; gap: 3.6mm; }
.titulo-passos { font-size: 4.6mm; font-weight: 800; letter-spacing: .4mm; text-transform: uppercase; color: #9a5a1f; }
.passo { display: flex; align-items: center; gap: 5mm; }
.num { flex: none; width: 13.5mm; height: 13.5mm; border-radius: 50%; background: #f2b33d; color: #1a3a2a; font-weight: 800; font-size: 7.4mm; display: flex; align-items: center; justify-content: center; font-family: Georgia, serif; }
.txt { font-size: 6.3mm; line-height: 1.25; }
.dica { background: #e8f5ee; color: #1a3a2a; border-radius: 4mm; padding: 3mm 4.5mm; font-size: 5mm; line-height: 1.3; }
.rodape { margin-top: auto; padding: 0 15mm 10mm; display: flex; gap: 6mm; align-items: stretch; }
.qr { flex: 1; background: #fff; border: .5mm solid #d9c7a3; border-radius: 6mm; padding: 4mm; display: flex; align-items: center; gap: 4mm; }
.qr svg { flex: none; width: 58mm; height: 58mm; }
.qr b { display: block; font-family: Georgia, serif; font-size: 6.8mm; line-height: 1.1; }
.qr small { display: block; margin-top: 1.5mm; font-size: 4.2mm; color: #3b3b36; }
.nfc { flex: none; width: 60mm; background: #1a3a2a; color: #faf7f2; border-radius: 6mm; padding: 4.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2.5mm; text-align: center; font-weight: 800; font-size: 5.2mm; line-height: 1.15; }
.nfc .anel { width: 44mm; height: 44mm; border: .8mm dashed #f2b33d; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
</style></head><body><div class="pg">
<div class="topo">
<div class="marca">${CAIXOTE}<span>${esc(nome || 'Feira')}</span></div>
<h1>Agora temos <span>aplicativo!</span></h1>
<p class="sub">Escolha a sua banca e monte o pedido no celular. A gente separa tudo na hora.</p>
</div>
<div class="painel"><div class="toldo"></div>
<div class="passos">
<div class="titulo-passos">É fácil, são 3 passos</div>
${passo(1, '<b>Abra a loja.</b> Aponte a câmera do celular para o QR, ou encoste o celular na fitinha.')}
${passo(2, '<b>Escolha os produtos.</b> Toque em <b>Adicionar</b> em cada um que você quer levar.')}
${passo(3, '<b>Envie o pedido.</b> Toque na sacola, confira e mande. A banca confirma com você.')}
<div class="dica"><b>Dica:</b> no menu do navegador, toque em <b>Adicionar à tela inicial</b> e a loja vira um ícone no seu celular.</div>
</div>
<div class="rodape">
<div class="qr">${qrSvg(link, { tamanho: 176 })}<div><b>Aponte a câmera</b><small>ou digite<br>${esc(linkCurto(link)).replace(/([/-])/g, '$1<wbr>')}</small></div></div>
<div class="nfc"><div class="anel">${NFC}</div>Encoste o celular aqui</div>
</div>
</div></div></body></html>`;
}
