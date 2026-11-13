// =====================================================================
//  js/avise-loja.js — "EM FALTA HOJE" + "AVISE-ME QUANDO VOLTAR" na loja do cliente.
//
//  Embaixo da vitrine, uma faixa discreta com os produtos que zeraram no estoque
//  (vêm no documento do catálogo: lib/catalogo.js → esgotados). Cada um tem o botão
//  "Avise-me": o cliente deixa o nome e o WhatsApp e a banca avisa quando voltar
//  (lib/avise.js; o painel mostra a lista na aba Estoque). Nada é enviado sozinho.
//  O aparelho lembra o que já pediu ("Você será avisado"), sem guardar o telefone.
// =====================================================================
import { escapeHTML, showToast, openModal, closeModal } from './utils.js';
import { chave, EM_PREVIA } from './tenant.js';

const $ = (id) => document.getElementById(id);
const K = 'banca_avise';
const lerPedidos = () => { try { const v = JSON.parse(localStorage.getItem(chave(K)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } };
const marcarPedido = (id) => { try { const m = lerPedidos(); m[id] = Date.now(); const ks = Object.keys(m); if (ks.length > 60) delete m[ks[0]]; localStorage.setItem(chave(K), JSON.stringify(m)); } catch (_) { /* aparelho cheio */ } };
const urlOk = (u) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : '');
let LISTA = [], ESCOLHIDO = null;

/** Desenha (ou esconde) a faixa. `livre` = sem busca e na categoria "Todas" (como as outras faixas). */
export function pintarEmFalta(lista, { livre = true } = {}) {
    LISTA = (Array.isArray(lista) ? lista : []).filter((p) => p && p.id && p.nome).slice(0, 40);
    let sec = $('faixa-falta');
    if (!LISTA.length || !livre) { if (sec) sec.hidden = true; return; }
    if (!sec) {
        const grade = $('lista-produtos'); if (!grade) return;
        sec = document.createElement('section'); sec.id = 'faixa-falta'; sec.className = 'faixa-falta'; sec.setAttribute('aria-labelledby', 'faixa-falta-tit');
        grade.after(sec);
        sec.addEventListener('click', (e) => { const b = e.target.closest('[data-avise]'); if (b) abrir(b.dataset.avise); });
    }
    const ja = lerPedidos();
    sec.hidden = false;
    sec.innerHTML = `<h2 id="faixa-falta-tit">Em falta hoje</h2>
        <p class="faixa-falta-sub">Acabou por agora. Toque em <b>Avise-me</b> e a loja te chama no WhatsApp quando voltar.</p>
        <ul class="faixa-falta-lista">${LISTA.map((p) => `<li>
            <span class="ff-foto">${urlOk(p.foto) ? `<img src="${escapeHTML(urlOk(p.foto))}" alt="" loading="lazy" decoding="async">` : ''}</span>
            <span class="ff-nome">${escapeHTML(p.nome)}</span>
            ${ja[p.id] ? '<span class="ff-ok">Você será avisado</span>' : `<button type="button" class="ff-bt" data-avise="${escapeHTML(p.id)}" aria-label="Avise-me quando ${escapeHTML(p.nome)} voltar">Avise-me</button>`}
        </li>`).join('')}</ul>`;
    sec.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
}

function montarModal() {
    if ($('modal-avise')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-avise" role="dialog" aria-modal="true" aria-labelledby="avise-titulo">
        <div class="modal">
            <header class="modal-head"><h2 id="avise-titulo">Avise-me quando voltar</h2><button class="btn-fechar" data-fechar="modal-avise" aria-label="Fechar">&times;</button></header>
            <div class="modal-body">
                <p class="avise-prod" id="avise-prod"></p>
                <div class="form-group"><label for="avise-nome">Seu nome</label><input type="text" id="avise-nome" autocomplete="given-name" maxlength="40" enterkeyhint="next"></div>
                <div class="form-group"><label for="avise-tel">WhatsApp</label><input type="tel" id="avise-tel" inputmode="tel" autocomplete="tel" placeholder="62 9 9999-9999" enterkeyhint="send"></div>
                <p class="avise-nota">A loja usa o número só para este aviso. Você sai da lista assim que for avisado.</p>
            </div>
            <footer class="modal-footer"><button type="button" class="btn-primary" id="avise-enviar">Quero ser avisado</button></footer>
        </div>
    </div>`);
    $('avise-enviar').addEventListener('click', enviar);
    $('avise-tel').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
}

function abrir(id) {
    ESCOLHIDO = LISTA.find((p) => p.id === id) || null; if (!ESCOLHIDO) return;
    montarModal();
    $('avise-prod').innerHTML = `Quando <b>${escapeHTML(ESCOLHIDO.nome)}</b> voltar, a loja te chama no WhatsApp.`;
    // o nome e o telefone que o aparelho já conhece (do último pedido) vêm preenchidos
    let c = null; try { c = (JSON.parse(localStorage.getItem(chave('banca_clientes')) || '[]') || [])[0] || null; } catch (_) { /* sem dados */ }
    if (c && !$('avise-nome').value) $('avise-nome').value = String(c.nome || '').slice(0, 40);
    if (c && !$('avise-tel').value && c.telefone) $('avise-tel').value = String(c.telefone);
    const bt = $('avise-enviar'); bt.disabled = false; bt.textContent = 'Quero ser avisado';
    openModal('modal-avise');
    setTimeout(() => { const alvo = $('avise-nome').value ? $('avise-tel') : $('avise-nome'); try { alvo.focus({ preventScroll: true }); } catch (_) { /* segue */ } }, 120);
}

async function enviar() {
    if (!ESCOLHIDO) return;
    const nome = $('avise-nome').value.trim(), tel = $('avise-tel').value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (nome.length < 2) { showToast('Escreva o seu nome.', true); return $('avise-nome').focus(); }
    if (!/^[1-9]\d\d{8,9}$/.test(tel)) { showToast('Confira o WhatsApp: precisa do DDD e do número.', true); return $('avise-tel').focus(); }
    if (EM_PREVIA) { showToast('Esta é só a prévia da aparência: nada é enviado daqui.'); return; }
    const bt = $('avise-enviar'); bt.disabled = true; bt.textContent = 'Anotando...';
    try {
        const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'avise-me', produtoId: ESCOLHIDO.id, nome, telefone: tel }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Não consegui anotar agora. Tente de novo em instantes.');
        marcarPedido(ESCOLHIDO.id); closeModal('modal-avise');
        showToast(d.jaEstava ? 'Você já estava na lista. A loja te avisa.' : `Pronto! Quando ${ESCOLHIDO.nome} voltar, a loja te chama no WhatsApp.`);
        pintarEmFalta(LISTA);
    } catch (e) { showToast(e.message || 'Não consegui anotar agora.', true); bt.disabled = false; bt.textContent = 'Quero ser avisado'; }
}
