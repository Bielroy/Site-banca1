// =====================================================================
//  js/admin-video.js — VÍDEO CURTO DO PRODUTO (cadastro de produto no painel).
//
//  O vídeo vai DIRETO do celular para o Cloudflare R2: o servidor (api/foto.js →
//  acao 'video') só devolve um link que vale 10 minutos, para aquele arquivo e
//  aquele tamanho. Assim um vídeo de 30 MB não passa pelo servidor.
//  Na loja (js/loja.js) o vídeo toca sem som, em repetição, na tela do produto.
// =====================================================================
import { auth } from './firebase.js';
import { showToast, escapeHTML } from './utils.js';

const $ = (id) => document.getElementById(id);
const URL_OK = /^https:\/\/[^\s"'<>]+$/;
export const MAX_VIDEO = 40 * 1024 * 1024;
let arquivo = null, enviando = false;

/** Mostra o vídeo atual (ou nada) no formulário. */
export function mostrarVideo(url) {
    arquivo = null;
    const campo = $('edit-video-url'), previa = $('prod-video-previa'), tirar = $('btn-tirar-video'), input = $('edit-video');
    if (!campo || !previa) return;
    if (input) input.value = '';
    campo.value = URL_OK.test(String(url || '')) ? url : '';
    pintar(campo.value);
    if (tirar) tirar.hidden = !campo.value;
}
function pintar(src) {
    const previa = $('prod-video-previa'); if (!previa) return;
    previa.innerHTML = src ? `<video src="${escapeHTML(src)}" muted loop playsinline autoplay preload="metadata" aria-label="Vídeo do produto"></video>` : '<span class="prod-video-vazio" aria-hidden="true">▶</span>';
}

/** O vídeo escolhido agora (ainda não enviado), para mostrar a prévia. */
function escolheu(f) {
    if (!f) return;
    if (!/^video\/(mp4|webm|quicktime)$/.test(f.type)) { showToast('Escolha um vídeo MP4, WebM ou MOV (o do celular serve).', true); $('edit-video').value = ''; return; }
    if (f.size > MAX_VIDEO) { showToast(`O vídeo tem ${(f.size / 1048576).toFixed(0)} MB. O limite é 40 MB: grave um trecho mais curto.`, true); $('edit-video').value = ''; return; }
    arquivo = f;
    pintar(URL.createObjectURL(f));
    $('btn-tirar-video').hidden = false;
    $('prod-video-dica').textContent = `Vídeo de ${(f.size / 1048576).toFixed(1).replace('.', ',')} MB escolhido. Ele é enviado quando você salvar o produto.`;
}

async function enviar(f, produtoId, aoProgresso) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/foto', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'video', tipo: f.type, bytes: f.size, nome: `${produtoId}-video` }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 503) throw new Error('O envio de vídeo precisa do Cloudflare R2 ligado no servidor. Por enquanto, cole o link de um vídeo.');
    if (!r.ok || !d.put) throw new Error(d.error || 'Não consegui preparar o envio do vídeo.');
    // XMLHttpRequest só para mostrar o progresso (fetch não conta os bytes que saem)
    await new Promise((ok, falha) => {
        const x = new XMLHttpRequest();
        x.open('PUT', d.put);
        Object.entries(d.cabecalhos || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
        x.upload.onprogress = (e) => { if (e.lengthComputable && aoProgresso) aoProgresso(e.loaded / e.total); };
        x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : falha(new Error(`O armazenamento recusou o vídeo (${x.status}).`)));
        x.onerror = () => falha(new Error('O envio do vídeo caiu. Confira a internet (no Wi-Fi é mais rápido) e salve de novo.'));
        x.send(f);
    });
    return d.url;
}

/**
 * Chamado ao salvar o produto. Devolve o endereço do vídeo a gravar (ou null = sem vídeo).
 * Envia o arquivo escolhido, se houver; senão vale o link do campo.
 */
export async function videoParaSalvar(produtoId, aoProgresso) {
    if (enviando) throw new Error('O vídeo ainda está sendo enviado.');
    if (arquivo) {
        enviando = true;
        try { const url = await enviar(arquivo, produtoId, aoProgresso); mostrarVideo(url); return url; }
        finally { enviando = false; }
    }
    const link = String($('edit-video-url')?.value || '').trim();
    if (!link) return null;
    if (!URL_OK.test(link)) throw new Error('O link do vídeo precisa começar com https://');
    return link;
}

let ligado = false;
export function ligarVideo() {
    if (ligado || !$('edit-video')) return; ligado = true;
    $('edit-video').addEventListener('change', (e) => escolheu(e.target.files && e.target.files[0]));
    $('btn-tirar-video').addEventListener('click', () => { mostrarVideo(''); $('prod-video-dica').textContent = 'Sem vídeo. Ao salvar, o produto fica só com a foto.'; });
    $('edit-video-url').addEventListener('change', (e) => { arquivo = null; $('edit-video').value = ''; const v = e.target.value.trim(); pintar(URL_OK.test(v) ? v : ''); $('btn-tirar-video').hidden = !v; });
}
