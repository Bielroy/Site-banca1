// =====================================================================
//  /js/utils.js  —  VERSÃO CORRIGIDA (v3.1)
//  Substitui o antigo utils.js na íntegra.
//
//  Correções:
//   [CRÍTICO] customConfirm agora AUTO-INJETA o modal de confirmação se
//             ele não existir na página (o index.html não tinha o
//             #overlay-confirm, então "Esvaziar carrinho" quebrava).
//   [ALTO]    Modais fecham com ESC e devolvem o foco (acessibilidade).
//   [MÉDIO]   customConfirm resolve(false) ao clicar fora / ESC / voltar,
//             sem deixar Promises presas (memory leak).
// =====================================================================

// --------- Formatadores / segurança ---------
export const fmt = (n) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

export const escapeHTML = (str) => {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>'"]/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));
};

export const isFracionavel = (unidade) => {
  const u = (unidade || '').toLowerCase();
  return ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'].includes(u);
};

export const fixFloat = (num) => Math.round(num * 1000) / 1000;

export const formatarQuantidadeVisual = (qtd, fracionavel) => {
  if (!fracionavel) return qtd.toString();
  return qtd.toString().replace('.', ',');
};

export const formatarQtdRelatorio = (qtd, und) => {
  if (isFracionavel(und)) return `${qtd.toString().replace('.', ',')} ${und || 'kg'}`;
  return `${qtd}x`;
};

export const hapticFeedback = (type = 'light') => {
  if (navigator.vibrate) {
    if (type === 'light') navigator.vibrate(50);
    if (type === 'heavy') navigator.vibrate([100, 50, 100]);
  }
};

let toastTimer;
export const showToast = (msg, isError = false) => {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = isError ? 'var(--danger)' : 'var(--forest)';
  t.classList.add('visivel');
  hapticFeedback(isError ? 'heavy' : 'light');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visivel'), 3000);
};

export const animarFeedbackBtn = (btn) => {
  if (!btn) return;
  btn.classList.add('sucesso');
  btn.innerHTML = '✓';
  hapticFeedback();
  setTimeout(() => { btn.classList.remove('sucesso'); btn.innerHTML = '+'; }, 500);
};

// --------- Modais (com foco + ESC) ---------
let ultimoFocado = null;

const SELETOR_FOCAVEL = [
  'a[href]', 'button:not([disabled])', 'input:not([type=hidden]):not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(', ');

const focarPrimeiroElemento = (modal) => {
  const alvo = modal.querySelector(
    'input:not([type=hidden]), select, textarea, button:not(.btn-fechar)'
  ) || modal.querySelector('[data-fechar], .btn-fechar');
  if (alvo) setTimeout(() => alvo.focus({ preventScroll: true }), 60);
};

// ---------------------------------------------------------------------
// PRISÃO DE FOCO
//
// Antes, com o modal aberto, apertar Tab várias vezes levava o foco para os
// botões da página ATRÁS do modal — quem navega por teclado ou usa leitor de
// tela ficava perdido, ativando coisas que não estava vendo.
//
// A prisão é calculada NA HORA em que a pessoa aperta Tab, e sempre no modal
// que está por cima. Isso importa porque a caixa de confirmação abre em cima
// de outro modal: se o foco ficasse preso no de baixo, os botões "Sim/Não"
// seriam inalcançáveis pelo teclado.
// ---------------------------------------------------------------------
const SELETOR_MODAL = '.modal-overlay.aberto, .carrinho.aberto, .picking-palco.aberto';

const modalDoTopo = () => {
  const abertos = Array.from(document.querySelectorAll(SELETOR_MODAL))
    .filter(el => el.offsetParent !== null);
  return abertos.length ? abertos[abertos.length - 1] : null;
};

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const modal = modalDoTopo();
  if (!modal) return;

  const focaveis = Array.from(modal.querySelectorAll(SELETOR_FOCAVEL))
    .filter(el => el.offsetParent !== null);
  if (focaveis.length === 0) return;

  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];

  // Foco fora do modal do topo: traz de volta para dentro
  if (!modal.contains(document.activeElement)) {
    e.preventDefault();
    primeiro.focus({ preventScroll: true });
    return;
  }

  if (e.shiftKey && document.activeElement === primeiro) {
    e.preventDefault();
    ultimo.focus({ preventScroll: true });
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault();
    primeiro.focus({ preventScroll: true });
  }
}, true);


export const openModal = (id) => {
  const modal = document.getElementById(id);
  if (!modal) return;
  ultimoFocado = document.activeElement;
  modal.classList.add('aberto');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  history.pushState({ modal: id }, '', `#${id}`);
  modal.setAttribute('role', modal.getAttribute('role') || 'dialog');
  modal.setAttribute('aria-modal', 'true');
  focarPrimeiroElemento(modal);
};

export const closeModal = (id) => {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('aberto');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-modal', 'false');
  document.body.style.overflow = '';
  if (ultimoFocado && typeof ultimoFocado.focus === 'function') {
    ultimoFocado.focus({ preventScroll: true });
    ultimoFocado = null;
  }
};

// ESC fecha o modal aberto no topo, reutilizando a lógica do botão de fechar
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const confirmAberto = document.querySelector('#overlay-confirm.aberto');
  if (confirmAberto) { // deixa o próprio customConfirm tratar
    document.getElementById('btn-confirm-cancel')?.click();
    return;
  }
  const abertos = [...document.querySelectorAll('.modal-overlay.aberto')];
  const topo = abertos[abertos.length - 1];
  if (topo) topo.querySelector('[data-fechar], .btn-fechar')?.click();
});

// --------- customConfirm robusto (auto-injeta o modal) ---------
const ensureConfirmModal = () => {
  if (document.getElementById('overlay-confirm')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="overlay-confirm" role="alertdialog" aria-modal="true" aria-hidden="true">
      <div class="modal" style="max-width: 380px; text-align: center;">
        <div class="modal-body" style="padding: 30px 24px;">
          <h2 id="confirm-title" style="color: var(--forest); margin-bottom: 12px; font-size: 1.5rem;">Atenção</h2>
          <p id="confirm-msg" style="color: var(--text-mid); font-size: 1.05rem;">Confirma a operação?</p>
          <div style="display:flex; gap:12px; margin-top:24px;">
            <button class="btn btn-outline" id="btn-confirm-cancel" style="flex:1; border-color:#e0dcd4; color:var(--text-dark);">Cancelar</button>
            <button class="btn" id="btn-confirm-ok" style="flex:1; background:var(--danger); color:white; border-color:var(--danger);">Confirmar</button>
          </div>
        </div>
      </div>
    </div>`);
};

export const customConfirm = (title, msg) => {
  ensureConfirmModal();
  const overlay = document.getElementById('overlay-confirm');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;

  // abre sem mexer no history (não interfere no back-button dos outros modais)
  const focoAnterior = document.activeElement;
  overlay.classList.add('aberto');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  const okBtn = document.getElementById('btn-confirm-ok');
  const cancelBtn = document.getElementById('btn-confirm-cancel');
  setTimeout(() => okBtn.focus({ preventScroll: true }), 60);

  return new Promise((resolve) => {
    const finalizar = (valor) => { cleanup(); resolve(valor); };
    const onOk = () => finalizar(true);
    const onCancel = () => finalizar(false);
    const onOverlay = (e) => { if (e.target === overlay) finalizar(false); };
    const onKey = (e) => { if (e.key === 'Escape') finalizar(false); };

    const cleanup = () => {
      overlay.classList.remove('aberto');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      if (focoAnterior && typeof focoAnterior.focus === 'function') focoAnterior.focus({ preventScroll: true });
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
};

// --------- Rede: erros globais ---------
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise:', event.reason);
  showToast('Erro de conexão. Tente novamente.', true);
});

// --------- IndexedDB wrapper (não bloqueante) ---------
export const dbStorage = {
  db: null,
  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('BancaApp', 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore('store');
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = () => reject('IndexedDB Error');
    });
  },
  async get(key) {
    try {
      const db = await this.init();
      return await new Promise((resolve) => {
        const req = db.transaction('store').objectStore('store').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      // Fallback: localStorage (modo privado / IndexedDB indisponível)
      try { return JSON.parse(localStorage.getItem('idbfallback_' + key)); } catch (_) { return null; }
    }
  },
  async set(key, val) {
    try {
      const db = await this.init();
      return await new Promise((resolve) => {
        const req = db.transaction('store', 'readwrite').objectStore('store').put(val, key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (e) {
      try { localStorage.setItem('idbfallback_' + key, JSON.stringify(val)); } catch (_) {}
    }
  },
};

// --------- Ícones ---------
export const iconeCarrinhoVazio = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>`;
export const iconeHistoricoVazio = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>`;
