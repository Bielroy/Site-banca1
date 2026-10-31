// =====================================================================
//  js/montar-loja.js — a TELA "MONTAR PEDIDO" da loja (açaí com complementos,
//  pastel com adicionais, lanche sem cebola...). As regras estão em
//  js/montar-lib.js; quem cobra é o servidor (lib/montar.js).
//
//  abrirMontar({ produto, linha, fmt, foto, rotuloBotao, aoConfirmar })
//    linha        item da sacola que está sendo ALTERADO (abre com as escolhas dele)
//    aoConfirmar  (produto, conferido, qtd, linhaAntiga) => void
// =====================================================================
import { montarDoProduto, conferirEscolha, regraDoGrupo, precoMontado } from './montar-lib.js';
import { escapeHTML, openModal, closeModal, hapticFeedback } from './utils.js';

const ID = 'modal-montar';
let atual = null;   // { p, montar, escolhas: Map(grupoId → [opcaoId]), qtd, linha, fmt, aoConfirmar }

const ICO_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function montarModal() {
    let m = document.getElementById(ID);
    if (m) return m;
    m = document.createElement('div');
    m.className = 'modal-overlay mt-overlay'; m.id = ID; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'mt-nome'); m.setAttribute('aria-hidden', 'true');
    m.innerHTML = `
        <div class="modal mt-modal">
            <button type="button" class="btn-fechar mt-fechar" data-fechar="${ID}" aria-label="Fechar">&times;</button>
            <div class="mt-rolo" id="mt-rolo">
                <div class="mt-foto" id="mt-foto"></div>
                <div class="mt-cabeca">
                    <h2 id="mt-nome"></h2>
                    <p class="mt-desc" id="mt-desc"></p>
                    <p class="mt-base" id="mt-base"></p>
                </div>
                <div class="mt-passos" id="mt-passos" aria-hidden="true"></div>
                <div id="mt-grupos"></div>
            </div>
            <footer class="mt-rodape">
                <p class="mt-resumo" id="mt-resumo" aria-live="polite"></p>
                <div class="mt-acoes">
                    <div class="mt-qtd" role="group" aria-label="Quantidade">
                        <button type="button" data-mt="menos" aria-label="Menos um">−</button>
                        <output id="mt-qtd" aria-live="polite">1</output>
                        <button type="button" data-mt="mais" aria-label="Mais um">+</button>
                    </div>
                    <button type="button" class="mt-ok" id="mt-ok"><span id="mt-ok-txt">Pôr na sacola</span><b id="mt-ok-preco"></b></button>
                </div>
            </footer>
        </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', aoTocar);
    return m;
}

function pintarGrupos() {
    const { montar, escolhas } = atual;
    document.getElementById('mt-grupos').innerHTML = montar.grupos.map((g, gi) => {
        const unico = g.max === 1, sel = escolhas.get(g.id) || [];
        const ops = g.opcoes.map((o) => {
            const on = sel.includes(o.id), cheio = !on && !unico && sel.length >= g.max;
            const preco = o.preco > 0 ? `+ ${atual.fmt(o.preco)}` : 'grátis';
            return `<button type="button" class="mt-op${on ? ' on' : ''}${cheio ? ' cheio' : ''}${o.ativo ? '' : ' acabou'}" role="${unico ? 'radio' : 'checkbox'}" aria-checked="${on}"
                        data-g="${escapeHTML(g.id)}" data-o="${escapeHTML(o.id)}"${o.ativo ? '' : ' disabled'}>
                        <span class="mt-marca${unico ? ' redonda' : ''}">${ICO_CHECK}</span>
                        <span class="mt-op-nome">${escapeHTML(o.nome)}</span>
                        <span class="mt-op-preco${o.preco > 0 ? '' : ' gratis'}">${o.ativo ? preco : 'acabou'}</span>
                    </button>`;
        }).join('');
        return `<section class="mt-grupo" data-grupo="${escapeHTML(g.id)}" aria-labelledby="mt-g-${gi}">
                    <header class="mt-grupo-topo">
                        <div><h3 id="mt-g-${gi}">${escapeHTML(g.nome)}</h3><small>${escapeHTML(regraDoGrupo(g))}</small></div>
                        <span class="mt-selo" data-selo="${escapeHTML(g.id)}"></span>
                    </header>
                    <div class="mt-ops" role="${unico ? 'radiogroup' : 'group'}" aria-labelledby="mt-g-${gi}">${ops}</div>
                </section>`;
    }).join('');
}

/** Atualiza contadores, selos de "obrigatório", passos, resumo e preço do botão. */
function pintarEstado() {
    const { montar, escolhas, p, qtd } = atual;
    const r = conferirEscolha(montar, Object.fromEntries(escolhas));
    let faltando = null;
    montar.grupos.forEach((g) => {
        const n = (escolhas.get(g.id) || []).length, ok = n >= g.min;
        if (!ok && !faltando) faltando = g;
        const selo = document.querySelector(`#${ID} [data-selo="${CSS.escape(g.id)}"]`);
        if (selo) {
            selo.className = `mt-selo${!ok ? ' falta' : n ? ' feito' : ''}`;
            selo.textContent = !ok ? (g.min === 1 ? 'Obrigatório' : `Faltam ${g.min - n}`) : g.max > 1 && n ? `${n}/${g.max}` : n ? 'Pronto' : '';
        }
        // limite: o que passaria do máximo fica apagado (escolha única troca sozinha)
        if (g.max > 1) document.querySelectorAll(`#${ID} .mt-op[data-g="${CSS.escape(g.id)}"]`).forEach((b) => b.classList.toggle('cheio', !b.classList.contains('on') && n >= g.max));
    });
    document.getElementById('mt-passos').innerHTML = montar.grupos.map((g) => { const n = (escolhas.get(g.id) || []).length; return `<i class="${n >= g.min && (n || g.min === 0) ? (n ? 'feito' : '') : 'falta'}"></i>`; }).join('');
    const nomes = montar.grupos.flatMap((g) => (escolhas.get(g.id) || []).map((id) => (g.opcoes.find((o) => o.id === id) || {}).nome).filter(Boolean));
    document.getElementById('mt-resumo').textContent = nomes.length ? nomes.join(' · ') : 'Toque nas opções para montar do seu jeito.';
    const unit = precoMontado(p.preco, r.ok ? r.extraC : 0);
    document.getElementById('mt-qtd').textContent = String(qtd);
    const ok = document.getElementById('mt-ok');
    ok.classList.toggle('incompleto', !!faltando);
    document.getElementById('mt-ok-txt').textContent = faltando ? (/^escolh/i.test(faltando.nome) ? faltando.nome : `Escolha: ${faltando.nome}`) : atual.linha ? 'Salvar mudanças' : atual.rotulo;
    document.getElementById('mt-ok-preco').textContent = atual.fmt(unit * qtd);
    atual.faltando = faltando; atual.conferido = r;
}

function aoTocar(e) {
    if (!atual) return;
    const op = e.target.closest('.mt-op');
    if (op && !op.disabled) {
        const g = atual.montar.grupos.find((x) => x.id === op.dataset.g); if (!g) return;
        const sel = (atual.escolhas.get(g.id) || []).slice(), i = sel.indexOf(op.dataset.o);
        if (g.max === 1) {
            if (i > -1) { if (g.min === 0) sel.splice(i, 1); }   // escolha única obrigatória: tocar de novo não desmarca
            else sel.splice(0, sel.length, op.dataset.o);
        } else if (i > -1) sel.splice(i, 1);
        else if (sel.length < g.max) sel.push(op.dataset.o);
        else { op.classList.remove('treme'); void op.offsetWidth; op.classList.add('treme'); return; }   // chegou no limite
        atual.escolhas.set(g.id, sel);
        document.querySelectorAll(`#${ID} .mt-op[data-g="${CSS.escape(g.id)}"]`).forEach((b) => { const on = sel.includes(b.dataset.o); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        if (sel.includes(op.dataset.o)) { op.classList.remove('pulo'); void op.offsetWidth; op.classList.add('pulo'); try { hapticFeedback(); } catch (_) { /* sem vibração */ } }
        pintarEstado();
        // escolha única completa: desce para o próximo grupo que ainda falta
        if (g.max === 1 && sel.length && atual.faltando) rolarAte(atual.faltando);
        return;
    }
    const bt = e.target.closest('[data-mt]');
    if (bt) { atual.qtd = Math.min(50, Math.max(1, atual.qtd + (bt.dataset.mt === 'mais' ? 1 : -1))); pintarEstado(); return; }
    if (e.target.closest('#mt-ok')) confirmar();
}

function rolarAte(g) {
    const sec = document.querySelector(`#${ID} [data-grupo="${CSS.escape(g.id)}"]`); if (!sec) return;
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sec.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' });
    return sec;
}

function confirmar() {
    if (atual.faltando) {
        const sec = rolarAte(atual.faltando);
        if (sec) { sec.classList.remove('chama'); void sec.offsetWidth; sec.classList.add('chama'); }
        return;
    }
    if (!atual.conferido || !atual.conferido.ok) return;
    const { p, conferido, qtd, linha, aoConfirmar } = atual;
    fechar();
    aoConfirmar(p, conferido, qtd, linha);
}

function fechar() {
    closeModal(ID);
    if (history.state && history.state.modal === ID) history.back();
}

// inicial = { grupoId: [opcaoId...] }: escolhas já marcadas ao abrir (o Ajudante sugeriu a combinação). O cliente confere e muda.
export function abrirMontar({ produto, linha = null, inicial = null, fmt, foto = '', rotuloBotao = 'Pôr na sacola', aoConfirmar }) {
    const montar = montarDoProduto(produto); if (!montar) return false;
    montarModal();
    const escolhas = new Map(montar.grupos.map((g) => [g.id, []]));
    const marcadas = linha && linha.opcoes ? linha.opcoes : (inicial && typeof inicial === 'object' ? inicial : null);
    if (marcadas) for (const g of montar.grupos) escolhas.set(g.id, (Array.isArray(marcadas[g.id]) ? marcadas[g.id] : []).filter((id) => g.opcoes.some((o) => o.id === id && o.ativo)).slice(0, g.max));
    // escolha única obrigatória com uma opção só: já vem marcada
    for (const g of montar.grupos) { const vivas = g.opcoes.filter((o) => o.ativo); if (g.min === 1 && g.max === 1 && vivas.length === 1 && !escolhas.get(g.id).length) escolhas.set(g.id, [vivas[0].id]); }
    atual = { p: produto, montar, escolhas, qtd: linha ? Math.max(1, Math.round(Number(linha.qtd) || 1)) : 1, linha, fmt, aoConfirmar, rotulo: rotuloBotao };

    const fotoBox = document.getElementById('mt-foto');
    fotoBox.innerHTML = foto ? `<img src="${escapeHTML(foto)}" alt="${escapeHTML(produto.nome)}" decoding="async">` : '';
    fotoBox.hidden = !foto;
    document.querySelector(`#${ID} .mt-modal`).classList.toggle('sem-foto', !foto);
    document.getElementById('mt-nome').textContent = produto.nome;
    const desc = document.getElementById('mt-desc'); desc.textContent = produto.descricao || ''; desc.hidden = !produto.descricao;
    document.getElementById('mt-base').innerHTML = `${montar.grupos.some((g) => g.opcoes.some((o) => o.preco > 0)) ? 'a partir de ' : ''}<b>${escapeHTML(fmt(produto.preco))}</b>`;
    pintarGrupos(); pintarEstado();
    document.getElementById('mt-rolo').scrollTop = 0;
    openModal(ID);
    return true;
}
