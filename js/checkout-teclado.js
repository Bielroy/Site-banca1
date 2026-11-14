// =====================================================================
//  js/checkout-teclado.js — a tela "Confira e envie" com o TECLADO aberto.
//  No celular o teclado toma metade da tela. Aqui:
//   • a tela encolhe junto com a parte visível (iPhone e Android) e o botão
//     "Enviar" sai do caminho enquanto se digita (volta quando o teclado fecha);
//   • o campo em que se está digitando sobe para o meio do que sobrou;
//   • a tecla "próximo" do teclado pula para o campo seguinte;
//   • a forma de pagamento vira botões de um toque (sem lista para abrir);
//   • "Observação, troca e cupom" mostra no título o que já foi preenchido.
// =====================================================================
const MODAL = 'modal-checkout';
const raiz = document.documentElement;
const modal = () => document.getElementById(MODAL);
const aberto = () => !!modal()?.classList.contains('aberto');

// ---------- parte visível da tela (o que o teclado deixa) ----------
const vv = window.visualViewport;
function medir() {
    if (!vv) return;
    const tecl = window.innerHeight - vv.height > 140 && aberto() && document.activeElement && modal().contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    raiz.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    raiz.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    document.body.classList.toggle('teclado-aberto', !!tecl);
}
if (vv) { vv.addEventListener('resize', medir); vv.addEventListener('scroll', medir); }

// ---------- o campo em foco sobe para o meio ----------
document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!aberto() || !modal().contains(el) || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    setTimeout(() => { medir(); try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { el.scrollIntoView(); } }, 300);
});
document.addEventListener('focusout', () => setTimeout(medir, 120));

// ---------- "próximo" pula para o campo seguinte ----------
const camposVisiveis = () => [...modal().querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select:not(.pag-select)')]
    .filter((el) => !el.disabled && el.offsetParent !== null && !el.closest('details:not([open])'));
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !aberto()) return;
    const el = e.target;
    if (!modal().contains(el) || el.tagName !== 'INPUT') return;
    const lista = camposVisiveis(), i = lista.indexOf(el);
    e.preventDefault();
    const prox = lista[i + 1];
    if (prox && prox.tagName === 'INPUT') prox.focus(); else el.blur();
});

// ---------- pagamento em botões ----------
const ICONES = { pix: '◆', cart: '▭', dinh: '¤' };
function pintarPagamento() {
    const sel = document.getElementById('cli-pagamento'), box = document.getElementById('pag-chips'); if (!sel || !box) return;
    const ops = [...sel.options].filter((o) => !o.hidden && !o.disabled);
    box.innerHTML = ops.map((o) => {
        const [titulo, ...resto] = o.textContent.split('(');
        const sub = resto.join('(').replace(/\)\s*$/, '');
        const on = o.value === sel.value;
        return `<button type="button" class="pag-chip${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-pag="${o.value.replace(/"/g, '&quot;')}"><b>${titulo.trim()}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
    }).join('');
    box.hidden = ops.length < 2;
    sel.classList.toggle('pag-select--so', ops.length < 2);
}
document.addEventListener('click', (e) => {
    const b = e.target.closest('.pag-chip'); if (!b) return;
    const sel = document.getElementById('cli-pagamento'); if (!sel) return;
    sel.value = b.dataset.pag;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    pintarPagamento();
});
document.getElementById('cli-pagamento')?.addEventListener('change', pintarPagamento);
{ const sel = document.getElementById('cli-pagamento'); if (sel) new MutationObserver(pintarPagamento).observe(sel, { childList: true, subtree: true, attributes: true }); }

// ---------- resumo do que é opcional ----------
function resumoMais() {
    const r = document.getElementById('checkout-mais-resumo'); if (!r) return;
    const obs = (document.getElementById('cli-obs')?.value || '').trim(), cupom = (document.getElementById('cli-cupom')?.value || '').trim();
    const troca = document.querySelector('input[name="cli-troca"]:checked')?.value;
    const partes = [obs ? 'com observação' : '', troca === 'trocar' ? 'pode trocar' : troca === 'nao' ? 'não trocar' : '', cupom ? `cupom ${cupom.toUpperCase()}` : ''].filter(Boolean);
    r.textContent = partes.length ? partes.join(' · ') : 'opcional';
}
['input', 'change'].forEach((ev) => document.addEventListener(ev, (e) => { if (e.target && modal()?.contains(e.target)) resumoMais(); }));

// ao abrir a tela: pagamento pintado e resumo em dia (a classe "aberto" é posta por openModal)
new MutationObserver(() => { if (aberto()) { pintarPagamento(); resumoMais(); medir(); } else document.body.classList.remove('teclado-aberto'); })
    .observe(document.getElementById(MODAL) || document.body, { attributes: true, attributeFilter: ['class'] });
pintarPagamento();
