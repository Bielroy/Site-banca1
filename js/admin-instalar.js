// =====================================================================
//  js/admin-instalar.js — O PAINEL COMO APLICATIVO.
//
//  A loja e o painel são dois aplicativos diferentes na tela inicial:
//    • "Banca Adair" (ícone escuro)  → abre a loja, para o cliente;
//    • "Painel" (ícone claro, com a prancheta) → abre direto o painel.
//  Quem trabalha na loja instala o segundo e não precisa mais achar o link.
//
//  O manifesto da loja original é o arquivo /admin.webmanifest. Nas outras
//  lojas ele vem de /api/manifest?loja=...&painel=1, com o nome e a cor
//  de cada uma. O botão "Instalar o painel" só aparece quando o aparelho
//  deixa instalar (ou no iPhone, onde ele explica o caminho pelo Safari).
// =====================================================================
import { TENANT, ehLojaOriginal } from './tenant.js';
import { showToast, customConfirm } from './utils.js';

// 1) o manifesto certo, e só ele (o build pode ter posto na página o da loja)
const meu = document.getElementById('manifesto-painel');
if (meu) {
    if (!ehLojaOriginal) {
        const base = `/api/manifest?loja=${encodeURIComponent(TENANT)}&painel=1`;
        meu.href = base;
        document.querySelectorAll('link[rel="icon"]').forEach((l) => { l.href = `${base}&icone=1`; });
        const img = new Image();              // iPhone não aceita ícone em SVG: desenha num PNG aqui mesmo
        img.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 180; c.getContext('2d').drawImage(img, 0, 0, 180, 180); const png = c.toDataURL('image/png'); document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((l) => { l.href = png; }); } catch (_) { /* fica o padrão */ } };
        img.src = `${base}&icone=1`;
    }
    document.querySelectorAll('link[rel="manifest"]').forEach((l) => { if (l !== meu) l.remove(); });
}

// 2) o botão
let convite = null;
const jaEhApp = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const botao = () => document.getElementById('btn-instalar-painel');
const mostrar = (sim) => { const b = botao(); if (b) b.hidden = !sim || jaEhApp(); };

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); convite = e; mostrar(true); });
window.addEventListener('appinstalled', () => { convite = null; mostrar(false); showToast('Pronto! O painel está na tela inicial deste aparelho.'); });
if (ehIphone()) mostrar(true);

botao()?.addEventListener('click', async () => {
    if (convite) {
        const c = convite; convite = null; c.prompt();
        try { const { outcome } = await c.userChoice; if (outcome === 'accepted') mostrar(false); } catch (_) { /* fechou a janela */ }
        return;
    }
    if (ehIphone()) await customConfirm('Pôr o painel na tela inicial', 'No Safari, toque no botão Compartilhar (o quadrado com a seta para cima) e depois em "Adicionar à Tela de Início". Na primeira vez, entre no painel de novo por dentro do aplicativo.', { ok: 'Entendi', nao: 'Fechar' });
});
