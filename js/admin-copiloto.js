// =====================================================================
//  js/admin-copiloto.js — aba "Copiloto": perguntas em português sobre os
//  dados da própria loja ("o que comprar amanhã?", "o que dá mais lucro?").
//
//  A pergunta vai para /api/assistente (ação "copiloto"). O servidor junta os
//  dados DESTA loja e pede a resposta à IA. A conversa fica só na tela: ao
//  recarregar a página, começa do zero.
// =====================================================================
import { auth } from './firebase.js';
import { escapeHTML, showToast } from './utils.js';

const SUGESTOES = ['O que preciso comprar amanhã?', 'Qual produto está dando mais lucro?', 'Quais produtos estão parados?', 'Por que vendemos menos essa semana?', 'Qual foi nosso melhor dia de vendas?', 'Tenho R$ 800 para comprar mercadoria. Como você distribuiria?', 'Quais produtos devo produzir amanhã?'];
const S = { conversa: [], enviando: false, ligado: false };
const el = () => document.getElementById('copiloto-conteudo');
const $ = (id) => document.getElementById(id);

// resposta da IA → HTML seguro: tudo é escapado; só "- item" vira lista e **negrito** vira <b>
function formatar(texto) {
    const linhas = escapeHTML(texto).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n/);
    let html = '', emLista = false;
    for (const l of linhas) {
        const item = l.match(/^\s*[-•]\s+(.*)$/);
        if (item) { if (!emLista) { html += '<ul>'; emLista = true; } html += `<li>${item[1]}</li>`; continue; }
        if (emLista) { html += '</ul>'; emLista = false; }
        if (l.trim()) html += `<p>${l}</p>`;
    }
    return html + (emLista ? '</ul>' : '');
}

function pintar() {
    $('cop-conversa').innerHTML = S.conversa.length ? S.conversa.map((m) => `<div class="cop-msg cop-${m.role}${m.erro ? ' cop-erro' : ''}">${m.role === 'ia' ? formatar(m.content) : `<p>${escapeHTML(m.content)}</p>`}</div>`).join('') + (S.enviando ? '<div class="cop-msg cop-ia cop-pensando"><p>Olhando os números da loja...</p></div>' : '')
        : `<div class="cop-vazio"><b>Pergunte sobre a sua loja.</b><span>As respostas usam só os dados que estão no sistema: vendas, estoque, custos e previsão. Quanto mais completo o cadastro, melhor a resposta.</span></div>`;
    $('cop-sugestoes').hidden = S.conversa.length > 0;
    $('cop-enviar').disabled = S.enviando; $('cop-pergunta').disabled = S.enviando;
    const c = $('cop-conversa'); c.scrollTop = c.scrollHeight;
}

async function perguntar(texto) {
    const pergunta = String(texto || '').replace(/\s+/g, ' ').trim();
    if (S.enviando) return;
    if (pergunta.length < 3) return showToast('Escreva a pergunta.', true);
    const historico = S.conversa.filter((m) => !m.erro).slice(-6).map((m) => ({ role: m.role, content: m.content }));
    S.conversa.push({ role: 'user', content: pergunta }); S.enviando = true; $('cop-pergunta').value = ''; pintar();
    try {
        const token = await auth.currentUser?.getIdToken();
        const r = await fetch('/api/assistente', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'copiloto', pergunta, historico }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.resposta) throw new Error(j.error || 'Não consegui responder agora. Tente de novo.');
        S.conversa.push({ role: 'ia', content: j.resposta });
    } catch (e) {
        S.conversa.push({ role: 'ia', erro: true, content: /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Sem internet. Tente de novo quando a conexão voltar.' : e.message });
    } finally { S.enviando = false; pintar(); $('cop-pergunta').focus(); }
}

export function abrirCopiloto() {
    if (!el()) return;
    if (!S.ligado) {
        S.ligado = true;
        el().innerHTML = `
        <div class="es-topo"><div><h3>Copiloto</h3><p class="config-sub">Pergunte em português. Ele responde com os números da sua loja.</p></div></div>
        <div id="cop-conversa" class="cop-conversa" aria-live="polite"></div>
        <div id="cop-sugestoes" class="cop-sugestoes">${SUGESTOES.map((s) => `<button type="button" data-cop="${escapeHTML(s)}">${escapeHTML(s)}</button>`).join('')}</div>
        <form id="cop-form" class="cop-form">
            <label for="cop-pergunta" class="sr-only">Sua pergunta</label>
            <input type="text" id="cop-pergunta" maxlength="500" autocomplete="off" placeholder="Ex.: o que comprar amanhã?">
            <button class="btn-salvar-config" id="cop-enviar" type="submit">Perguntar</button>
        </form>
        <p class="config-sub">A IA pode errar. Confira os números nas abas Estoque, Compras e Balanço antes de decidir uma compra grande.</p>`;
        el().addEventListener('click', (e) => { const b = e.target.closest('[data-cop]'); if (b) perguntar(b.dataset.cop); });
        $('cop-form').addEventListener('submit', (e) => { e.preventDefault(); perguntar($('cop-pergunta').value); });
    }
    pintar();
}
