// =====================================================================
//  js/admin-avisos.js — AVISO DE PEDIDO NOVO neste aparelho.
//  Liga a notificação do navegador (Web Push) e entrega o endereço do
//  aparelho ao servidor (/api/equipe, ações aviso-*). Quem manda o aviso
//  é o servidor, quando o pedido é gravado (lib/avisos.js) — por isso ele
//  chega mesmo com o painel fechado.
//
//  O painel RENOVA o cadastro do aparelho a cada abertura (iniciarAvisos): endereço de aviso vence, o navegador troca,
//  o servidor limpa cadastro morto. Antes, quem tocava em "Permitir" mas não em "Ligar avisos" só via o aviso com o
//  painel aberto, e quem teve o endereço trocado deixava de receber sem perceber.
// =====================================================================
import { auth } from './firebase.js';
import { showToast, openModal } from './utils.js';
import { chaveParaBytes, situacaoDosAvisos } from './avisos-lib.js';
import { ico } from './icones-admin.js';

const CHAVE = (import.meta.env && import.meta.env.VITE_VAPID_PUBLIC_KEY) || '';
const $ = (id) => document.getElementById(id);
const OFF = 'banca-avisos-desligados';          // a pessoa desligou NESTE aparelho: a renovação automática respeita
const guardado = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const guardar = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) { /* sem armazenamento: segue */ } };
const mesmaChave = (ass) => { try { const a = new Uint8Array(ass.options.applicationServerKey), b = chaveParaBytes(CHAVE); return a.length === b.length && a.every((v, i) => v === b[i]); } catch (_) { return true; } };

async function api(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não foi possível concluir.');
    return j;
}
const registro = async () => ('serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : null);
async function situacao() {
    const reg = await registro().catch(() => null);
    const assinatura = reg && reg.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return { reg, assinatura, s: situacaoDosAvisos({ temSW: !!reg, temPush: 'PushManager' in window, temNotificacao: 'Notification' in window, permissao: 'Notification' in window ? Notification.permission : 'denied', assinado: !!assinatura, chave: CHAVE, ios, instalado: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true }) };
}

const TEXTOS = {
    'ligado': ['Avisos ligados neste aparelho', 'Quando chegar pedido, o celular avisa mesmo com o painel fechado.'],
    'desligado': ['Avisos desligados neste aparelho', 'Ligue para o celular avisar quando chegar pedido, mesmo com o painel fechado.'],
    'bloqueado': ['O navegador está bloqueando os avisos', 'Toque no cadeado ao lado do endereço do site, abra Permissões e libere as Notificações. Depois volte aqui.'],
    'ios-instalar': ['No iPhone, instale o site primeiro', 'Toque em Compartilhar e em "Adicionar à Tela de Início". Abra o painel pelo ícone novo e volte nesta tela.'],
    'sem-suporte': ['Este navegador não mostra avisos', 'Abra o painel pelo Chrome (Android) ou instale o site na tela de início.'],
    'sem-chave': ['Avisos ainda não configurados', 'Falta ligar os avisos no servidor. Fale com quem cuida do site.'],
};

async function pintar() {
    const { s, assinatura } = await situacao(), [titulo, texto] = TEXTOS[s];
    let tipos = '';
    if (s === 'ligado') {
        const e = assinatura ? await api({ acao: 'aviso-estado', endpoint: assinatura.endpoint }).catch(() => null) : null;
        if (e && e.cadastrado === false) { await sincronizar(true).catch(() => {}); }   // o servidor não conhece este aparelho: cadastra de novo agora
        if (e && e.tipos) {
            tipos = `<p class="config-sub"><b>Quais avisos este aparelho recebe</b></p><div class="av-tipos">${Object.entries(e.tipos).map(([k, nome]) =>
                `<label class="av-tipo"><input type="checkbox" data-tipo="${k}"${e.prefs[k] === false ? '' : ' checked'}><span>${nome}</span></label>`).join('')}</div>
                <p class="config-sub cal-nota">${e.aparelhos} aparelho(s) desta loja recebem avisos.${e.ultimoStatus && e.ultimoStatus >= 400 ? ` O último aviso para este aparelho falhou (código ${e.ultimoStatus}): toque em "Mandar um aviso de teste".` : ''}</p>`;
        }
    }
    $('av-corpo').innerHTML = `
        <p class="av-estado${s === 'ligado' ? ' on' : ''}">${ico('sino')} <b>${titulo}</b></p>
        <p class="config-sub">${texto}</p>
        ${s === 'desligado' ? '<button class="btn-salvar-config" id="av-ligar">Ligar avisos neste aparelho</button>' : ''}
        ${tipos}
        ${s === 'ligado' ? '<button class="btn-salvar-config" id="av-teste">Mandar um aviso de teste</button><button class="btn-outline av-desligar" id="av-desligar">Desligar neste aparelho</button>' : ''}
        <p class="config-sub cal-nota">Cada pessoa liga no próprio celular. O aviso depende do navegador e da internet do aparelho: não substitui olhar o painel no horário de pico.</p>`;
    const b = $('btn-avisos'); if (b) { b.classList.toggle('on', s === 'ligado'); b.classList.toggle('pede', s === 'desligado' && !guardado(OFF)); }
}

/**
 * Renova o cadastro deste aparelho no servidor. Roda ao abrir o painel e quando a tela volta a ficar visível.
 * Só age com a permissão JÁ dada e sem a pessoa ter desligado os avisos neste aparelho. Nunca incomoda: erro fica quieto.
 */
export async function sincronizar(forcar = false) {
    if (!CHAVE || !('Notification' in window) || !('PushManager' in window) || Notification.permission !== 'granted') return;
    if (guardado(OFF)) return;
    const ultima = Number(guardado('banca-avisos-sync')) || 0;
    if (!forcar && Date.now() - ultima < 30 * 60000) return;
    const { reg, assinatura } = await situacao();
    if (!reg || !reg.pushManager) return;
    let ass = assinatura;
    if (ass && !mesmaChave(ass)) { await ass.unsubscribe().catch(() => {}); ass = null; }            // chave do servidor mudou: refaz
    if (!ass) ass = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(CHAVE) });
    await api({ acao: 'aviso-ligar', assinatura: ass.toJSON() });
    guardar('banca-avisos-sync', String(Date.now()));
}

/** Chamado pelo painel ao entrar: renova o cadastro, acende o sino e refaz o cadastro quando o celular volta a ser usado. */
let vigia = false;
export async function iniciarAvisos() {
    try { await sincronizar(); } catch (e) { console.warn('[avisos] não renovou:', e && e.message); }
    await marcarBotaoDeAvisos();
    if (vigia) return; vigia = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar().then(marcarBotaoDeAvisos).catch(() => {}); });
}

async function ligar(botao) {
    botao.disabled = true;
    try {
        if ((await Notification.requestPermission()) !== 'granted') { showToast('O navegador não liberou os avisos.', true); return pintar(); }
        const { reg } = await situacao();
        const assinatura = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(CHAVE) });
        try { await api({ acao: 'aviso-ligar', assinatura: assinatura.toJSON() }); }
        catch (e) { await assinatura.unsubscribe().catch(() => {}); throw e; }
        guardar(OFF, null); guardar('banca-avisos-sync', String(Date.now()));
        showToast('Avisos ligados neste aparelho.');
    } catch (e) { showToast(e.message || 'Não foi possível ligar os avisos.', true); }
    pintar();
}
async function desligar(botao) {
    botao.disabled = true;
    try {
        const { assinatura } = await situacao();
        guardar(OFF, '1');
        if (assinatura) { await api({ acao: 'aviso-desligar', endpoint: assinatura.endpoint }).catch(() => {}); await assinatura.unsubscribe(); }
        showToast('Avisos desligados neste aparelho.');
    } catch (e) { showToast(e.message || 'Não foi possível desligar.', true); }
    pintar();
}
async function testar(botao) {
    botao.disabled = true;
    try {
        const r = await api({ acao: 'aviso-teste' });
        if (r.enviados && r.enviados === r.total) showToast(`Aviso enviado para ${r.enviados} aparelho(s). Deve aparecer em instantes.`);
        else if (r.enviados) showToast(`${r.enviados} de ${r.total} aparelhos receberam. Falhou em ${r.total - r.enviados} (código ${[...new Set(r.falhas)].join(', ') || 'sem resposta'}).`, true);
        else { await sincronizar(true).catch(() => {}); showToast(r.total ? `Nenhum aparelho recebeu (código ${[...new Set(r.falhas)].join(', ') || 'sem resposta'}). Renovei o cadastro deste aparelho: toque em testar de novo.` : 'Este aparelho não estava cadastrado. Cadastrei agora: toque em testar de novo.', true); }
    } catch (e) { showToast(e.message, true); }
    botao.disabled = false;
}
async function salvarTipos() {
    const { assinatura } = await situacao(); if (!assinatura) return;
    const prefs = {}; document.querySelectorAll('#av-corpo input[data-tipo]').forEach((i) => { prefs[i.dataset.tipo] = i.checked; });
    try { await api({ acao: 'aviso-prefs', endpoint: assinatura.endpoint, prefs }); } catch (e) { showToast(e.message, true); pintar(); }
}

export async function abrirAvisos() {
    if (!$('modal-avisos')) {
        document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="modal-avisos" role="dialog" aria-modal="true" aria-labelledby="av-titulo">
            <div class="modal"><header class="modal-head"><h2 id="av-titulo">Avisos de pedido</h2><button class="btn-fechar" data-fechar="modal-avisos" aria-label="Fechar">&times;</button></header>
            <div class="modal-body" id="av-corpo"></div></div>
        </div>`);
        $('av-corpo').addEventListener('change', (e) => { if (e.target.matches('input[data-tipo]')) salvarTipos(); });
        $('av-corpo').addEventListener('click', (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.id === 'av-ligar') ligar(b); else if (b.id === 'av-desligar') desligar(b); else if (b.id === 'av-teste') testar(b);
        });
    }
    await pintar(); openModal('modal-avisos');
}

/** Só acende o sino do topo se este aparelho já estiver com os avisos ligados. */
export async function marcarBotaoDeAvisos() {
    try { const { s } = await situacao(); const b = $('btn-avisos'); if (b) b.classList.toggle('on', s === 'ligado'); } catch (_) { /* sem suporte: o botão fica como está */ }
}
