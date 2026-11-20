// =====================================================================
//  js/admin-dias.js — no cadastro do produto:
//    • "Sai em quais dias?"  sete botões (dom a sáb). Todos marcados = todo dia.
//      Grava produto.dias = [3, 6] (só quarta e sábado) ou null (todo dia).
//      Na loja, o produto só aparece para quem pede para um desses dias (js/dias-lib.js).
//    • "Outras palavras para achar na busca"  produto.palavras = ['salada', 'verdinha'].
//      Mostra também as palavras que a busca já entende sozinha (js/busca-lib.js).
// =====================================================================
import { limparDiasProduto, textoDosDias, CURTOS_DIA } from './dias-lib.js';
import { limparPalavras, palavrasAutomaticas } from './busca-lib.js';
import { escapeHTML } from './utils.js';

const $ = (id) => document.getElementById(id);
let marcados = new Set([0, 1, 2, 3, 4, 5, 6]);
let ligado = false;

function pintarDias() {
    const box = $('dias-chips'); if (!box) return;
    box.innerHTML = CURTOS_DIA.map((d, i) => `<button type="button" class="prod-dia${marcados.has(i) ? ' on' : ''}" data-dia="${i}" aria-pressed="${marcados.has(i)}">${d}</button>`).join('')
        + `<button type="button" class="prod-dia-todos" data-dia="todos"${marcados.size === 7 ? ' hidden' : ''}>Todo dia</button>`;
    const previa = $('dias-previa');
    if (previa) {
        const dias = limparDiasProduto([...marcados]);
        previa.textContent = marcados.size === 0 ? 'Marque pelo menos um dia.' : dias ? `Na loja, só aparece para pedido de ${textoDosDias(dias)}.` : 'Todos marcados: sai todo dia.';
        previa.classList.toggle('erro', marcados.size === 0);
    }
}

function pintarPalavras() {
    const previa = $('palavras-previa'); if (!previa) return;
    const auto = palavrasAutomaticas($('edit-nome')?.value || '');
    previa.innerHTML = auto.length
        ? `A busca já acha este produto por: <b>${escapeHTML(auto.slice(0, 8).join(', '))}</b>. Escreva aqui só outras, separadas por vírgula.`
        : 'Separe por vírgula. O cliente que digitar uma delas acha este produto.';
}

export function iniciarDiasAdmin() {
    if (ligado) return; ligado = true;
    $('dias-chips')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-dia]'); if (!b) return;
        if (b.dataset.dia === 'todos') marcados = new Set([0, 1, 2, 3, 4, 5, 6]);
        else { const d = Number(b.dataset.dia); if (marcados.has(d)) marcados.delete(d); else marcados.add(d); }
        pintarDias();
    });
    $('edit-nome')?.addEventListener('input', pintarPalavras);
}

export function preencherDias(p) {
    iniciarDiasAdmin();
    const dias = limparDiasProduto(p && p.dias);
    marcados = new Set(dias || [0, 1, 2, 3, 4, 5, 6]);
    pintarDias();
    const campo = $('edit-palavras'); if (campo) campo.value = limparPalavras(p && p.palavras).join(', ');
    pintarPalavras();
}

/** null = todo dia. Lança erro se nenhum dia estiver marcado. */
export function lerDias() {
    if (!$('dias-chips')) return null;
    if (marcados.size === 0) throw new Error('Marque pelo menos um dia em "Sai em quais dias?" (ou toque em "Todo dia").');
    return limparDiasProduto([...marcados]);
}

export const lerPalavras = () => limparPalavras($('edit-palavras')?.value || '');
