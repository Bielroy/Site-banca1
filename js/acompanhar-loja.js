// =====================================================================
//  js/acompanhar-loja.js — A FAIXA DO PEDIDO NA TELA DA LOJA (contas em js/acompanhar-lib.js).
//
//  Depois de pedir, uma faixa fica embaixo da loja dizendo em que pé está o pedido
//  ("Separando", "Pronto para retirar · senha 027", "Saiu para entrega"). Ela ouve o pedido
//  no banco (a regra deixa o cliente ler o PRÓPRIO pedido) e muda sozinha: ninguém precisa
//  abrir "Meus pedidos". Tocar na faixa abre os detalhes: linha do tempo, PIX com o valor, senha.
//
//  Quando o pedido PARA RETIRAR fica pronto (ou a banca chama a senha de novo), a tela abre
//  sozinha com a senha grande, o celular vibra e toca um aviso curto. Com a tela apagada o
//  navegador não toca nada: isso só um aviso por WhatsApp ou notificação resolveria.
//
//  Plaquinha (NFC / QR Code) com ?placa: abre o que vale para o pedido deste aparelho
//  (js/acompanhar-lib.js → oQueAPlacaAbre). Sem pedido aberto, fica a loja normal.
// =====================================================================
import { auth, onAuthStateChanged, onSnapshot } from './firebase.js';
import { tdoc } from './tenant.js';
import { escapeHTML, fmt, hapticFeedback } from './utils.js';
import { acompanhamento, pedidosParaAcompanhar, chamouAgora, oQueAPlacaAbre } from './acompanhar-lib.js';

const VIVOS = new Map();        // id → dados do pedido no banco
const OUVINDO = new Map();      // id → função que para de ouvir
let OPCOES = { lerPedidos: () => [], pixHtml: () => '' };
let aberto = '';                // id do pedido com os detalhes abertos
let placaPendente = false;
let tituloOriginal = '';

const raiz = () => {
    let el = document.getElementById('acomp');
    if (!el) {
        el = document.createElement('div');
        el.id = 'acomp'; el.className = 'acomp'; el.hidden = true;
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
        el.addEventListener('click', aoTocar);
    }
    return el;
};

const localDoPedido = (id) => (OPCOES.lerPedidos() || []).find((p) => String(p.id) === String(id)) || {};

// ---------- som e vibração do "ficou pronto" ----------
let audio = null;
const liberarSom = () => {           // o navegador só deixa tocar som depois de um toque na página
    try { if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); } if (audio && audio.state === 'suspended') audio.resume(); } catch (_) { /* sem som */ }
};
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, liberarSom, { once: true, passive: true }));
const tocarAviso = () => {
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 450]); } catch (_) { /* sem vibração */ }
    try { hapticFeedback && hapticFeedback(); } catch (_) { /* ok */ }
    if (!audio || audio.state !== 'running') return;
    try {
        const t0 = audio.currentTime;
        [0, 0.28, 0.56].forEach((d, i) => {
            const o = audio.createOscillator(), g = audio.createGain();
            o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
            g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.24);
            o.connect(g); g.connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + 0.26);
        });
    } catch (_) { /* sem som */ }
};
const avisarNoTitulo = (senha) => {
    if (!tituloOriginal) tituloOriginal = document.title;
    document.title = senha ? `🔔 Senha ${senha}: pedido pronto` : '🔔 Seu pedido está pronto';
};
const limparTitulo = () => { if (tituloOriginal) { document.title = tituloOriginal; tituloOriginal = ''; } };
document.addEventListener('visibilitychange', () => { if (!document.hidden && !aberto) limparTitulo(); });

// ---------- desenho ----------
const ICONE = { espera: '🧾', pagar: '💠', separando: '🧺', pronto: '✅', caminho: '🛵', fim: '✅', cancelado: '✖' };

const linhaDoTempo = (a) => `<div class="acomp-tempo">${a.etapas.map((e, i) => `<span class="acomp-passo${i <= a.passo ? ' feito' : ''}${i === a.passo ? ' atual' : ''}"><i></i>${escapeHTML(e.rotulo)}</span>`).join('')}</div>`;

const detalhesHtml = (id, p) => {
    const a = acompanhamento(p), loc = localDoPedido(id), total = typeof p.total === 'number' ? p.total : loc.total;
    const pix = a.tom !== 'pronto' && a.tom !== 'caminho' ? (OPCOES.pixHtml({ ...p, id }) || '') : '';
    return `
    <div class="acomp-folha" role="dialog" aria-modal="true" aria-label="Seu pedido">
        <button type="button" class="acomp-fechar" data-acomp="fechar" aria-label="Fechar">×</button>
        <p class="acomp-status tom-${a.tom}">${escapeHTML(a.titulo)}</p>
        ${a.senha ? `<div class="acomp-senha"><small>Sua senha</small><b>${escapeHTML(a.senha)}</b><span>Quando aparecer no painel, é só ir buscar.</span></div>` : ''}
        <p class="acomp-texto">${escapeHTML(a.texto)}</p>
        ${linhaDoTempo(a)}
        ${a.pago ? '<p class="acomp-pago">✓ Pago pelo PIX</p>' : ''}
        ${pix ? `<div class="acomp-pix">${pix}</div>` : ''}
        <div class="acomp-resumo">
            ${loc.descItens ? `<p>${escapeHTML(loc.descItens)}</p>` : ''}
            ${Number.isFinite(Number(total)) ? `<b>${fmt(Number(total))}</b>` : ''}
        </div>
    </div>`;
};

const desenhar = () => {
    const el = raiz();
    const lista = [...VIVOS.entries()].map(([id, p]) => ({ id, p, a: acompanhamento(p) })).filter((x) => x.a.ativo);
    if (aberto && !VIVOS.has(aberto)) aberto = '';
    if (!lista.length && !aberto) { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('com-acomp'); return; }
    el.hidden = false; document.body.classList.add('com-acomp');
    const faixas = lista.map(({ id, a }) => `
        <button type="button" class="acomp-faixa tom-${a.tom}" data-acomp="abrir" data-id="${escapeHTML(id)}">
            <span class="acomp-ico" aria-hidden="true">${ICONE[a.tom] || '🧾'}</span>
            <span class="acomp-txt"><b>${escapeHTML(a.titulo)}</b><small>${escapeHTML(a.senha ? `Senha ${a.senha} · toque para ver` : a.tom === 'pagar' ? 'Toque para pagar com PIX' : 'Toque para ver o pedido')}</small></span>
            ${a.senha ? `<span class="acomp-senha-mini">${escapeHTML(a.senha)}</span>` : ''}
        </button>`).join('');
    const det = aberto && VIVOS.has(aberto) ? `<div class="acomp-fundo" data-acomp="fechar"></div>${detalhesHtml(aberto, VIVOS.get(aberto))}` : '';
    el.classList.toggle('acomp-aberto', !!det);
    el.innerHTML = `<div class="acomp-faixas">${faixas}</div>${det}`;
};

function aoTocar(e) {
    const alvo = e.target.closest('[data-acomp]'); if (!alvo) return;
    if (alvo.dataset.acomp === 'abrir') { abrirDetalhes(alvo.dataset.id); }
    else if (alvo.dataset.acomp === 'fechar') { aberto = ''; limparTitulo(); desenhar(); }
}
const abrirDetalhes = (id) => { if (!VIVOS.has(id)) return; aberto = id; desenhar(); };

// ---------- ouvir o banco ----------
const ouvir = (id) => {
    if (OUVINDO.has(id)) return;
    let primeira = true;
    const parar = onSnapshot(tdoc('pedidos', id), (snap) => {
        if (!snap.exists()) { VIVOS.delete(id); desenhar(); return; }
        const antes = primeira ? null : VIVOS.get(id), depois = snap.data();
        primeira = false;
        VIVOS.set(id, depois);
        if (chamouAgora(antes, depois)) { aberto = id; tocarAviso(); avisarNoTitulo(acompanhamento(depois).senha); }
        if (!acompanhamento(depois).ativo) { pararDeOuvir(id); }
        desenhar();
        if (placaPendente) resolverPlaca();
    }, () => { pararDeOuvir(id); VIVOS.delete(id); desenhar(); if (placaPendente) resolverPlaca(); });   // sem permissão (pedido de outra conta) ou sem internet
    OUVINDO.set(id, parar);
};
const pararDeOuvir = (id) => { const f = OUVINDO.get(id); if (f) { try { f(); } catch (_) { /* ok */ } } OUVINDO.delete(id); };

/** Relê a lista de pedidos do aparelho (chame depois de enviar um pedido). */
export function atualizarAcompanhamento() {
    if (!auth.currentUser) return;
    const ids = pedidosParaAcompanhar(OPCOES.lerPedidos());
    ids.forEach(ouvir);
    [...OUVINDO.keys()].filter((id) => !ids.includes(id)).forEach((id) => { pararDeOuvir(id); VIVOS.delete(id); });
    desenhar();
}

// ---------- plaquinha ----------
let esperaPlaca = null;
const resolverPlaca = (forcar = false) => {
    const ids = pedidosParaAcompanhar(OPCOES.lerPedidos());
    const todosLidos = ids.every((id) => VIVOS.has(id) || !OUVINDO.has(id));
    if (!forcar && !todosLidos) return;
    placaPendente = false; clearTimeout(esperaPlaca);
    const { tela, pedido } = oQueAPlacaAbre(ids.filter((id) => VIVOS.has(id)).map((id) => ({ ...VIVOS.get(id), _id: id })));
    if (tela !== 'cardapio' && pedido) abrirDetalhes(pedido._id);
};

/** Liga a faixa. lerPedidos: os pedidos guardados no aparelho; pixHtml(pedido): o bloco de PIX da loja. */
export function iniciarAcompanhamento(opcoes = {}) {
    OPCOES = { ...OPCOES, ...opcoes };
    try {
        const u = new URL(location.href);
        if (u.searchParams.has('placa')) {
            placaPendente = true;
            u.searchParams.delete('placa');
            history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);   // recarregar não repete
            esperaPlaca = setTimeout(() => { if (placaPendente) resolverPlaca(true); }, 4000);
        }
    } catch (_) { /* endereço estranho: segue sem a plaquinha */ }
    onAuthStateChanged(auth, (u) => {
        if (!u) { [...OUVINDO.keys()].forEach(pararDeOuvir); VIVOS.clear(); desenhar(); return; }
        atualizarAcompanhamento();
        if (placaPendente && !pedidosParaAcompanhar(OPCOES.lerPedidos()).length) resolverPlaca(true);
    });
}
