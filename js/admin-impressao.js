// =====================================================================
//  js/admin-impressao.js — botão "Impressora" do painel e os atalhos de imprimir.
//  O QUE sai no papel: js/impressao-lib.js.   COMO sai: js/impressao.js.
// =====================================================================
import { getDoc } from './firebase.js';
import { fichaRef, ehLojaOriginal } from './tenant.js';
import { escapeHTML, showToast, openModal } from './utils.js';
import { CAMINHOS, suporte, lerConfig, salvarConfig, conectar, conectada, imprimir } from './impressao.js';
import { cupomDoPedido, etiquetaDeEntrega, etiquetaDeLote, paginaDeTeste, paraTexto, colunasDe } from './impressao-lib.js';

const $ = (id) => document.getElementById(id);
let nomeLoja = null;
async function loja() {
    if (nomeLoja !== null) return nomeLoja;
    try { const s = await getDoc(fichaRef()); nomeLoja = (s.exists() && s.data().nome) || ''; } catch (_) { nomeLoja = ''; }
    if (!nomeLoja && ehLojaOriginal) nomeLoja = 'Banca Adair e Pedrina';
    return nomeLoja;
}

async function mandar(folhas, opcoes, feito) {
    try {
        await imprimir(folhas, opcoes);
        const m = lerConfig().modo;
        showToast(m === 'sistema' ? 'Abrindo a tela de imprimir...' : m === 'app' ? 'Enviado para o aplicativo de impressão.' : (feito || 'Enviado para a impressora.'));
        return true;
    } catch (e) {
        console.error('[impressao]', e);
        showToast(e && e.amigavel ? e.message : 'Não consegui imprimir. Confira a impressora em "Impressora", no topo do painel.', true);
        return false;
    }
}
/** tipo: 'cupom' | 'etiqueta' */
export async function imprimirPedido(pedido, tipo = 'cupom') {
    const l = await loja();
    return mandar([tipo === 'etiqueta' ? etiquetaDeEntrega(pedido, { loja: l }) : cupomDoPedido(pedido, { loja: l })], tipo === 'etiqueta' ? { copias: 1 } : {});
}
/** Etiquetas de um lote fabricado. `quantas` etiquetas iguais (até 200 por vez). */
export async function imprimirLote(r, quantas = 1) {
    const l = await loja(), n = Math.min(Math.max(parseInt(quantas, 10) || 1, 1), 200), folha = etiquetaDeLote(r, { loja: l });
    return mandar(Array.from({ length: n }, () => folha), { copias: 1 }, `${n} etiqueta(s) enviada(s) para a impressora.`);
}

// ---------------------------------------------------------------- tela "Impressora"
function pintar() {
    const c = lerConfig(), sup = suporte(), termica = c.modo !== 'sistema', precisaConectar = c.modo === 'bluetooth' || c.modo === 'serial';
    const largura = !termica ? c.largura : (c.largura === 'a4' ? 80 : c.largura);
    $('imp-corpo').innerHTML = `
        <fieldset class="imp-caminhos"><legend>Como este aparelho imprime</legend>
            ${Object.entries(CAMINHOS).map(([k, [rot, dica]]) => `
            <label class="imp-caminho${sup[k] ? ' off' : ''}${c.modo === k ? ' sel' : ''}">
                <input type="radio" name="imp-modo" value="${k}"${c.modo === k ? ' checked' : ''}${sup[k] ? ' disabled' : ''}>
                <span><b>${rot}</b><small>${escapeHTML(sup[k] || dica)}</small></span>
            </label>`).join('')}
        </fieldset>
        ${precisaConectar ? `<div class="imp-conexao"><span>${conectada() ? `Conectada${c.modo === 'bluetooth' && c.btNome ? `: <b>${escapeHTML(c.btNome)}</b>` : ''}` : 'Nenhuma impressora conectada agora.'}</span><button type="button" class="btn-outline" id="imp-conectar">${conectada() ? 'Trocar' : 'Conectar'}</button></div>` : ''}
        ${c.modo === 'app' ? '<p class="config-sub">Instale o app <b>RawBT</b> (Play Store) neste Android e escolha a impressora dentro dele. Depois é só imprimir por aqui.</p>' : ''}
        <div class="grid-2">
            <div class="form-group"><label for="imp-largura">Papel</label><select id="imp-largura">
                <option value="58"${String(c.largura) === '58' ? ' selected' : ''}>58 mm (bobina)</option><option value="80"${String(c.largura) === '80' ? ' selected' : ''}>80 mm (bobina)</option>
                ${termica ? '' : `<option value="a4"${c.largura === 'a4' ? ' selected' : ''}>Folha A4</option>`}</select></div>
            <div class="form-group"><label for="imp-copias">Vias do cupom</label><select id="imp-copias">${[1, 2, 3].map((n) => `<option${c.copias === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        </div>
        ${termica ? `<label class="imp-check"><input type="checkbox" id="imp-acentos"${c.acentos ? ' checked' : ''}> <span>Imprimir com acentos<small>Deixe desligado se sair letra estranha no lugar de "ã" e "ç".</small></span></label>` : ''}
        ${c.modo === 'serial' ? `<div class="form-group"><label for="imp-baud">Velocidade da porta</label><select id="imp-baud">${[9600, 19200, 38400, 115200].map((n) => `<option${Number(c.baud) === n ? ' selected' : ''}>${n}</option>`).join('')}</select><small class="dica-campo">Se sair papel em branco ou letras soltas, tente outra velocidade.</small></div>` : ''}
        <h4 class="cp-sub">Como o cupom fica</h4>
        <pre class="imp-previa" style="width:${colunasDe(largura === 'a4' ? 80 : largura) + 2}ch" aria-label="Prévia do cupom">${escapeHTML(paraTexto(paginaDeTeste({ loja: nomeLoja || '', largura: largura === 'a4' ? 80 : largura, modo: CAMINHOS[c.modo][0] }).map((l) => ({ ...l, g: false })), colunasDe(largura === 'a4' ? 80 : largura)))}</pre>
        <p class="config-sub">No papel, o nome da loja e o total saem em letra maior.</p>
        <p class="config-sub">Esta escolha vale só para este aparelho. Cada celular ou computador do painel guarda a sua.</p>`;
}
function garantirModal() {
    if ($('modal-impressora')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-impressora" role="dialog" aria-modal="true" aria-labelledby="imp-titulo">
        <div class="modal"><header class="modal-head"><h2 id="imp-titulo">Impressora</h2><button class="btn-fechar" data-fechar="modal-impressora" aria-label="Fechar">&times;</button></header>
        <div class="modal-body" id="imp-corpo"></div>
        <footer class="modal-footer"><button class="btn-salvar-config" id="imp-teste">Imprimir teste</button></footer></div>
    </div>`);
    $('imp-corpo').addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'imp-modo') { const c = salvarConfig({ modo: t.value }); if (t.value !== 'sistema' && c.largura === 'a4') salvarConfig({ largura: 80 }); }
        else if (t.id === 'imp-largura') salvarConfig({ largura: t.value === 'a4' ? 'a4' : Number(t.value) });
        else if (t.id === 'imp-copias') salvarConfig({ copias: Number(t.value) });
        else if (t.id === 'imp-acentos') salvarConfig({ acentos: t.checked });
        else if (t.id === 'imp-baud') salvarConfig({ baud: Number(t.value) });
        pintar();
    });
    $('imp-corpo').addEventListener('click', async (e) => {
        const b = e.target.closest('#imp-conectar'); if (!b) return;
        b.disabled = true;
        try { const nome = await conectar(); showToast(nome ? `Conectada: ${nome}.` : 'Conectada.'); }
        catch (err) { console.error('[impressao]', err); showToast(err && err.amigavel ? err.message : 'Não consegui conectar. Confira se a impressora está ligada e perto.', true); }
        pintar();
    });
    $('imp-teste').addEventListener('click', async () => {
        const b = $('imp-teste'); b.disabled = true;
        const c = lerConfig();
        await mandar([paginaDeTeste({ loja: await loja(), largura: c.largura === 'a4' ? 80 : c.largura, modo: CAMINHOS[c.modo][0] })], { copias: 1 }, 'Teste enviado para a impressora.');
        b.disabled = false; pintar();
    });
}
export async function abrirImpressora() {
    garantirModal(); await loja(); pintar(); openModal('modal-impressora');
}
