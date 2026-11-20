// =====================================================================
//  js/admin-varios.js — "Vários de uma vez" na aba Produtos.
//
//  Para criar 10 pastéis sem abrir 10 formulários: escolhe a categoria, a
//  unidade e o preço UMA vez e escreve os nomes, um por linha. Quem tem
//  preço diferente leva o preço depois de um traço ("Pastel especial - 18").
//  A prévia mostra, antes de gravar, o que vai ser criado e o que fica de fora
//  (já cadastrado, repetido, sem preço). Regras em js/cadastro-lib.js.
// =====================================================================
import { db, writeBatch } from './firebase.js';
import { tdoc } from './tenant.js';
import { escapeHTML, showToast, openModal, closeModal, fmt } from './utils.js';
import { lerLista, lerPreco, linhasDemais, MAX_DE_UMA_VEZ, unidadeMaisUsada, precoMaisUsado } from './cadastro-lib.js';
import { chaveDaCategoria, nomeDaCategoria } from './admin-categorias.js';

const UNIDADES = [['un', 'Unidade'], ['kg', 'Quilo'], ['maço', 'Maço'], ['bdj', 'Bandeja'], ['kit', 'Kit / Cesta']];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const $ = (id) => document.getElementById(id);
const E = { produtos: [], categorias: [], arte: () => '', unidade: 'un', unidadeMexida: false, precoMexido: false, gravando: false };

function montar() {
    if ($('modal-varios')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-varios">
        <div class="modal">
            <header class="modal-head">
                <h2>Vários produtos de uma vez</h2>
                <button class="btn-fechar" data-fechar="modal-varios" aria-label="Fechar">&times;</button>
            </header>
            <div class="modal-body">
                <div class="vv-passo">
                    <span class="prod-rot" id="vv-rot-cat"><b>1</b>Categoria</span>
                    <div class="prod-chips prod-chips-cat" id="vv-cats" role="radiogroup" aria-labelledby="vv-rot-cat"></div>
                    <input type="text" id="vv-cat" autocomplete="off" placeholder="Ou digite uma categoria nova" aria-label="Categoria">
                </div>
                <div class="vv-passo">
                    <span class="prod-rot" id="vv-rot-un"><b>2</b>Vendido por</span>
                    <div class="prod-chips" id="vv-unidades" role="radiogroup" aria-labelledby="vv-rot-un"></div>
                </div>
                <div class="vv-passo">
                    <label class="prod-rot" for="vv-preco"><b>3</b>Preço de cada um (R$)</label>
                    <input type="text" id="vv-preco" inputmode="decimal" autocomplete="off" placeholder="Ex.: 15,00">
                </div>
                <div class="vv-passo">
                    <label class="prod-rot" for="vv-lista"><b>4</b>Os nomes, um por linha</label>
                    <textarea id="vv-lista" class="vv-lista" rows="6" placeholder="Pastel de carne&#10;Pastel de queijo&#10;Pastel de frango&#10;Pastel especial - 18"></textarea>
                    <small class="vv-dica">Algum com preço diferente? Escreva o preço depois de um traço: <b>Pastel especial - 18</b>. Foto e descrição você põe depois, abrindo o produto.</small>
                    <ul class="vv-previa" id="vv-previa" aria-live="polite"></ul>
                    <p class="vv-resumo" id="vv-resumo"></p>
                </div>
            </div>
            <footer class="modal-footer">
                <button type="button" class="bt bt-pri" id="vv-criar" disabled>Criar produtos</button>
            </footer>
        </div>
    </div>`);
    $('vv-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat-nome]'); if (!b) return; $('vv-cat').value = b.dataset.catNome; aoMudarCategoria(); });
    $('vv-cat').addEventListener('input', aoMudarCategoria);
    $('vv-unidades').addEventListener('click', (e) => { const b = e.target.closest('[data-unidade]'); if (!b) return; E.unidade = b.dataset.unidade; E.unidadeMexida = true; pintar(); });
    $('vv-preco').addEventListener('input', () => { E.precoMexido = true; pintar(); });
    $('vv-lista').addEventListener('input', pintar);
    $('vv-criar').addEventListener('click', criar);
}

const chaveAtual = () => chaveDaCategoria($('vv-cat').value).trim();
function aoMudarCategoria() {
    const cat = chaveAtual();
    if (!E.unidadeMexida) E.unidade = unidadeMaisUsada(E.produtos, cat);
    // preço: sugere o mais comum da categoria enquanto a pessoa não digitou o dela
    if (!E.precoMexido) { const pm = precoMaisUsado(E.produtos, cat); $('vv-preco').value = pm ? pm.toFixed(2).replace('.', ',') : ''; }
    pintar();
}

function pintar() {
    const atual = norm(chaveAtual());
    $('vv-cats').innerHTML = E.categorias.map((c) => { const on = !!atual && norm(c.chave) === atual; return `<button type="button" class="prod-chip prod-chip-cat${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-cat-nome="${escapeHTML(c.nome)}"><span class="prod-chip-ico" aria-hidden="true">${E.arte(c.nome)}</span>${escapeHTML(c.nome)}</button>`; }).join('');
    $('vv-cats').hidden = !E.categorias.length;
    $('vv-unidades').innerHTML = UNIDADES.map(([v, rot]) => `<button type="button" class="prod-chip${v === E.unidade ? ' on' : ''}" role="radio" aria-checked="${v === E.unidade}" data-unidade="${escapeHTML(v)}">${rot}</button>`).join('');
    const linhas = lerLista($('vv-lista').value, lerPreco($('vv-preco').value), E.produtos.map((p) => p.nome));
    const un = UNIDADES.find(([v]) => v === E.unidade)?.[1].toLowerCase() || E.unidade;
    $('vv-previa').innerHTML = linhas.map((l) => `<li class="${l.aviso ? 'fora' : ''}"><b>${escapeHTML(l.nome)}</b><span>${l.aviso ? escapeHTML(l.aviso) : `${fmt(l.preco)} / ${escapeHTML(un)}`}</span></li>`).join('');
    const ok = linhas.filter((l) => !l.aviso).length, demais = linhasDemais($('vv-lista').value);
    const semCat = !chaveAtual();
    $('vv-resumo').textContent = !linhas.length ? '' : semCat ? 'Escolha a categoria (passo 1).'
        : `${ok === 1 ? '1 produto vai ser criado' : `${ok} produtos vão ser criados`}${ok < linhas.length ? `; ${linhas.length - ok} fica${linhas.length - ok > 1 ? 'm' : ''} de fora` : ''}.${demais ? ` Só ${MAX_DE_UMA_VEZ} por vez: ${demais} linha${demais > 1 ? 's ficaram' : ' ficou'} para a próxima.` : ''}`;
    const bt = $('vv-criar');
    bt.disabled = E.gravando || semCat || !ok;
    bt.textContent = ok ? `Criar ${ok === 1 ? '1 produto' : `${ok} produtos`}` : 'Criar produtos';
    return linhas;
}

async function criar() {
    const cat = chaveAtual().toLowerCase();
    const linhas = pintar().filter((l) => !l.aviso);
    if (!cat || !linhas.length || E.gravando) return;
    E.gravando = true; const bt = $('vv-criar'); bt.disabled = true; bt.textContent = 'Criando...';
    try {
        const lote = writeBatch(db), agora = Date.now();
        linhas.forEach((l, i) => {
            const id = crypto.randomUUID ? crypto.randomUUID() : `p${agora.toString(36)}${i}${Math.random().toString(36).slice(2, 7)}`;
            lote.set(tdoc('produtos', id), { nome: l.nome, preco: l.preco, precoDe: null, unidade: E.unidade, cat, descricao: '', pesoMedio: null, mostrarPrimeiro: 'un', duracao: 'normal',
                soInsumo: false, chegouEm: null, estacao: false, escolha: false, ativo: true, ultimaModificacao: agora + i });
        });
        await lote.commit();
        closeModal('modal-varios');
        showToast(`${linhas.length === 1 ? '1 produto criado' : `${linhas.length} produtos criados`} em ${nomeDaCategoria(cat) || cat}. Para pôr foto, toque no produto.`);
        $('vv-lista').value = '';
    } catch (e) {
        showToast('Não consegui criar os produtos. Confira a internet e tente de novo: nada foi gravado.', true);
    } finally { E.gravando = false; pintar(); }
}

/** produtos = lista atual; categorias = [{ chave, nome }]; arte(nome) = desenho da categoria; categoria = chave já aberta na lista (ou ''). */
export function abrirVarios({ produtos, categorias, arte, categoria }) {
    montar();
    Object.assign(E, { produtos: produtos || [], categorias: categorias || [], arte: arte || (() => ''), unidadeMexida: false, precoMexido: false });
    $('vv-cat').value = categoria ? nomeDaCategoria(categoria) : '';
    $('vv-preco').value = '';
    aoMudarCategoria();
    openModal('modal-varios');
}
