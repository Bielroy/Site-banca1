// =====================================================================
//  js/admin-fotos-conserto.js — FOTOS QUE SUMIRAM DO IMGBB (aba Produtos → "Conferir fotos").
//
//  O ImgBB às vezes deixa de entregar um arquivo e manda no lugar uma figura azul
//  "imgbb.com service unavailable". O redutor do site (functions/_vercel/image.js) reconhece
//  essa figura e responde 502. Aqui:
//    1. confere a foto grande e a miniatura de cada produto pelo redutor;
//    2. para cada produto com foto fora do ar, procura uma cópia boa: a outra versão da mesma
//       foto (grande ou miniatura) ou uma cópia que o redutor ainda tinha guardada ("resgatada");
//    3. mostra a cópia para a pessoa conferir e, com um toque, envia de novo e grava no produto.
//  Sem cópia, oferece escolher outra foto do celular.
// =====================================================================
import { setDoc } from './firebase.js';
import { tdoc } from './tenant.js';
import { escapeHTML, showToast, openModal } from './utils.js';
import { otimizarFotos, enviarOtimizadas } from './admin-fotos.js';
import { comTentativas, emFila } from './fotos-lib.js';
import { conferir, melhorCopia, peloRedutor } from './fotos-conserto-lib.js';

let linhas = [], aoTerminar = null;
const $ = (id) => document.getElementById(id);

function garantirModal() {
    if ($('modal-conserto-fotos')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-conserto-fotos" role="dialog" aria-modal="true" aria-labelledby="cf-titulo">
        <div class="modal modal-lg">
            <header class="modal-head"><h2 id="cf-titulo">Fotos fora do ar</h2><button class="btn-fechar" data-fechar="modal-conserto-fotos" aria-label="Fechar">&times;</button></header>
            <div class="modal-body"><p class="config-sub" id="cf-dica"></p><div id="cf-lista" class="ft-lista" aria-live="polite"></div></div>
            <footer class="modal-footer"><button class="btn-salvar-config" id="cf-todas" hidden>Consertar todas com cópia</button></footer>
        </div>
    </div>`);
    $('cf-lista').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cf]'); if (!b) return;
        const l = linhas[Number(b.dataset.i)]; if (!l) return;
        if (b.dataset.cf === 'usar') consertar(l);
        if (b.dataset.cf === 'outra') l.el.querySelector('input[type="file"]').click();
    });
    $('cf-lista').addEventListener('change', (e) => {
        const inp = e.target.closest('input[type="file"]'); if (!inp || !inp.files || !inp.files[0]) return;
        const l = linhas[Number(inp.dataset.i)]; const arq = inp.files[0]; inp.value = '';
        if (l) consertar(l, arq);
    });
    $('cf-todas').addEventListener('click', async () => {
        $('cf-todas').disabled = true;
        await emFila(linhas.filter((l) => l.copia && l.estado !== 'feito'), 2, (l) => consertar(l));
        $('cf-todas').disabled = false; pintarRodape();
    });
}

const textoEstado = (l) => ({
    pronta: l.copia ? (l.resgatada ? 'O ImgBB perdeu esta foto, mas achei uma cópia guardada. Confira se é a certa.' : 'Uma das versões sumiu do ImgBB; a outra está boa.') : 'Sumiu do ImgBB e não há cópia. Escolha a foto de novo.',
    enviando: 'Enviando de novo...', feito: 'Consertada.', erro: l.msg || 'Não consegui consertar.',
}[l.estado]);

function pintarLinha(l) {
    l.el.className = `ft-linha ft-${l.estado === 'pronta' ? 'pronta' : l.estado}`;
    l.el.innerHTML = `<div class="ft-mini">${l.copia ? `<img src="${escapeHTML(peloRedutor(l.copia, 384))}" alt="">` : ''}</div>
        <div class="ft-meio"><span class="ft-nome">${escapeHTML(l.p.nome)}</span><span class="ft-status">${escapeHTML(textoEstado(l))}</span></div>
        ${l.estado === 'feito' || l.estado === 'enviando' ? '' : `${l.copia ? `<button type="button" class="btn-outline ft-btn" data-cf="usar" data-i="${l.i}">Usar esta</button>` : ''}
        <button type="button" class="btn-outline ft-btn" data-cf="outra" data-i="${l.i}">Escolher outra</button>`}
        <input type="file" accept="image/*" data-i="${l.i}" class="sr-only" tabindex="-1" aria-hidden="true">`;
}
function pintarRodape() {
    const comCopia = linhas.filter((l) => l.copia && l.estado !== 'feito').length;
    const b = $('cf-todas'); b.hidden = comCopia < 2; b.textContent = `Consertar as ${comCopia} que têm cópia`;
}

async function consertar(l, arquivo = null) {
    l.estado = 'enviando'; pintarLinha(l);
    try {
        let fonte = arquivo;
        if (!fonte) {
            const r = await fetch(peloRedutor(l.copia, 828), { cache: 'no-store' });
            if (!r.ok) throw new Error('A cópia também saiu do ar. Escolha a foto de novo.');
            const blob = await r.blob();
            fonte = new File([blob], `${l.p.id}.${/png/.test(blob.type) ? 'png' : /jpe?g/.test(blob.type) ? 'jpg' : 'webp'}`, { type: blob.type || 'image/webp' });
        }
        const otimizada = await otimizarFotos(fonte).catch(() => { throw new Error('Não consegui abrir esta foto. Tente outra (JPG ou PNG).'); });
        const urls = await comTentativas(() => enviarOtimizadas(l.p.id, otimizada, fonte.name));
        await comTentativas(() => setDoc(tdoc('produtos', l.p.id), { ...urls, ultimaModificacao: Date.now() }, { merge: true }));
        Object.assign(l.p, urls); l.copia = urls.foto; l.resgatada = false;
        l.estado = 'feito'; l.msg = '';
    } catch (e) {
        l.estado = 'erro';
        l.msg = (e && (e.amigavel || e.message)) || 'O envio caiu. Confira a internet e tente de novo.';
    }
    pintarLinha(l); pintarRodape();
    if (linhas.every((x) => x.estado === 'feito') && aoTerminar) aoTerminar();
}

/** Abre a conferência. `quandoTerminar` é chamado quando todas foram consertadas (para a lista de produtos se redesenhar). */
export async function abrirConserto(produtos, quandoTerminar) {
    garantirModal(); aoTerminar = quandoTerminar || null;
    linhas = []; $('cf-lista').innerHTML = ''; $('cf-todas').hidden = true;
    $('cf-dica').textContent = 'Conferindo as fotos...';
    openModal('modal-conserto-fotos');
    const ruins = await conferir(produtos, (n, t) => { $('cf-dica').textContent = `Conferindo as fotos... ${n} de ${t}`; });
    if (!ruins.length) { $('cf-dica').textContent = 'Todas as fotos estão abrindo. Nada para consertar.'; return; }
    $('cf-dica').textContent = `${ruins.length === 1 ? '1 produto está' : `${ruins.length} produtos estão`} com foto fora do ar no ImgBB (por isso aparecia "imgbb.com service unavailable"). Confira a cópia e toque em "Usar esta", ou escolha a foto de novo.`;
    linhas = ruins.map((r, i) => { const copia = melhorCopia(r); return { i, p: r.p, copia, resgatada: !!copia && (copia === r.p.foto ? r.foto : r.mini) === 'resgatada', estado: 'pronta', msg: '', el: document.createElement('div') }; });
    linhas.forEach((l) => { pintarLinha(l); $('cf-lista').appendChild(l.el); });
    pintarRodape();
}
