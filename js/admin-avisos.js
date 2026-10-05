// =====================================================================
//  js/admin-avisos.js — AVISO DE PEDIDO NOVO neste aparelho.
//  Liga a notificação do navegador (Web Push) e entrega o endereço do
//  aparelho ao servidor (/api/equipe, ações aviso-*). Quem manda o aviso
//  é o servidor, quando o pedido é gravado (lib/avisos.js) — por isso ele
//  chega mesmo com o painel fechado.
// =====================================================================
import { auth } from './firebase.js';
import { showToast, openModal } from './utils.js';
import { chaveParaBytes, situacaoDosAvisos } from './avisos-lib.js';
import { ico } from './icones-admin.js';

const CHAVE = (import.meta.env && import.meta.env.VITE_VAPID_PUBLIC_KEY) || '';
const $ = (id) => document.getElementById(id);

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
    const { s } = await situacao(), [titulo, texto] = TEXTOS[s];
    $('av-corpo').innerHTML = `
        <p class="av-estado${s === 'ligado' ? ' on' : ''}">${ico('sino')} <b>${titulo}</b></p>
        <p class="config-sub">${texto}</p>
        ${s === 'desligado' ? '<button class="btn-salvar-config" id="av-ligar">Ligar avisos neste aparelho</button>' : ''}
        ${s === 'ligado' ? '<button class="btn-salvar-config" id="av-teste">Mandar um aviso de teste</button><button class="btn-outline av-desligar" id="av-desligar">Desligar neste aparelho</button>' : ''}
        <p class="config-sub cal-nota">Cada pessoa liga no próprio celular. O aviso depende do navegador e da internet do aparelho: não substitui olhar o painel no horário de pico.</p>`;
    const b = $('btn-avisos'); if (b) b.classList.toggle('on', s === 'ligado');
}

async function ligar(botao) {
    botao.disabled = true;
    try {
        if ((await Notification.requestPermission()) !== 'granted') { showToast('O navegador não liberou os avisos.', true); return pintar(); }
        const { reg } = await situacao();
        const assinatura = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(CHAVE) });
        try { await api({ acao: 'aviso-ligar', assinatura: assinatura.toJSON() }); }
        catch (e) { await assinatura.unsubscribe().catch(() => {}); throw e; }
        showToast('Avisos ligados neste aparelho.');
    } catch (e) { showToast(e.message || 'Não foi possível ligar os avisos.', true); }
    pintar();
}
async function desligar(botao) {
    botao.disabled = true;
    try {
        const { assinatura } = await situacao();
        if (assinatura) { await api({ acao: 'aviso-desligar', endpoint: assinatura.endpoint }).catch(() => {}); await assinatura.unsubscribe(); }
        showToast('Avisos desligados neste aparelho.');
    } catch (e) { showToast(e.message || 'Não foi possível desligar.', true); }
    pintar();
}
async function testar(botao) {
    botao.disabled = true;
    try { const r = await api({ acao: 'aviso-teste' }); showToast(r.enviados ? `Aviso enviado para ${r.enviados} aparelho(s). Deve aparecer em instantes.` : 'Nenhum aparelho recebeu. Desligue e ligue os avisos de novo.', !r.enviados); }
    catch (e) { showToast(e.message, true); }
    botao.disabled = false;
}

export async function abrirAvisos() {
    if (!$('modal-avisos')) {
        document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="modal-avisos" role="dialog" aria-modal="true" aria-labelledby="av-titulo">
            <div class="modal"><header class="modal-head"><h2 id="av-titulo">Avisos de pedido</h2><button class="btn-fechar" data-fechar="modal-avisos" aria-label="Fechar">&times;</button></header>
            <div class="modal-body" id="av-corpo"></div></div>
        </div>`);
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
