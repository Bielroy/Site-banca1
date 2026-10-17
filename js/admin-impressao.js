// =====================================================================
//  js/admin-impressao.js — os AJUSTES da impressora e os atalhos de imprimir.
//  A tela "Impressora" do Menu (pedido do WhatsApp, foto, ajustes): js/admin-impressora.js.
//  O QUE sai no papel: js/impressao-lib.js.   COMO sai: js/impressao.js.
//  Celular da banca (app Ponte): js/impressao-ponte.js.
// =====================================================================
import { getDoc } from './firebase.js';
import { fichaRef, ehLojaOriginal } from './tenant.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';
import { CAMINHOS, suporte, lerConfig, salvarConfig, conectar, conectada, imprimir } from './impressao.js';
import { cupomDoPedido, etiquetaDeEntrega, etiquetaDeLote, paginaDeTeste, paraTexto, colunasDe } from './impressao-lib.js';
import { MODOS_AUTO, podeAutomatico } from './impressao-fila-lib.js';
import * as Ponte from './impressao-ponte.js';
import { papelAtual } from './admin-guard.js';

// a impressão automática (js/impressao-auto.js) escuta este aviso e se ajusta na hora
const avisarMudanca = () => { try { document.dispatchEvent(new CustomEvent('impressao:config')); } catch (_) { /* navegador antigo */ } };

const $ = (id) => document.getElementById(id);
let nomeLoja = null;
export async function loja() {
    if (nomeLoja !== null) return nomeLoja;
    try { const s = await getDoc(fichaRef()); nomeLoja = (s.exists() && s.data().nome) || ''; } catch (_) { nomeLoja = ''; }
    if (!nomeLoja && ehLojaOriginal) nomeLoja = 'Banca Adair e Pedrina';
    return nomeLoja;
}

export async function mandar(folhas, opcoes, feito) {
    try {
        const r = await imprimir(folhas, opcoes);
        const m = lerConfig().modo;
        if (m === 'ponte') {
            if (r && r.online === false) showToast(`Na fila do celular da banca, mas ele está sem contato ${Ponte.quandoFoi(r.visto)}. Confira se ele está ligado e com internet.`, true);
            else showToast('Enviado para o celular da banca.');
            return true;
        }
        showToast(m === 'sistema' ? 'Abrindo a tela de imprimir...' : m === 'app' ? 'Enviado para o aplicativo de impressão.' : (feito || 'Enviado para a impressora.'));
        return true;
    } catch (e) {
        console.error('[impressao]', e);
        showToast(e && e.amigavel ? e.message : 'Não consegui imprimir. Confira a impressora em Menu → Impressora → Ajustes.', true);
        return false;
    }
}
/** tipo: 'cupom' | 'etiqueta' */
export async function imprimirPedido(pedido, tipo = 'cupom') {
    const l = await loja();
    return mandar([tipo === 'etiqueta' ? etiquetaDeEntrega(pedido, { loja: l }) : cupomDoPedido(pedido, { loja: l })],
        tipo === 'etiqueta' ? { copias: 1 } : { pedidoId: pedido && pedido.id, tipo: 'cupom' });
}
/** Etiquetas de um lote fabricado. `quantas` etiquetas iguais (até 200 por vez). */
export async function imprimirLote(r, quantas = 1) {
    const l = await loja(), n = Math.min(Math.max(parseInt(quantas, 10) || 1, 1), 200), folha = etiquetaDeLote(r, { loja: l });
    return mandar(Array.from({ length: n }, () => folha), { copias: 1 }, `${n} etiqueta(s) enviada(s) para a impressora.`);
}

// ---------------------------------------------------------------- celular da banca (app Ponte)
const marca = (v, atual) => (String(v) === String(atual) ? ' selected' : '');
function pintarCodigo() {
    const k = Ponte.codigoValido(); if (!k) return '';
    const min = Math.max(1, Math.round((k.expira - Date.now()) / 60000));
    return `<div class="imp-codigo" role="status">
        <span>Digite este código no app</span><b>${escapeHTML(k.codigo.slice(0, 4))} ${escapeHTML(k.codigo.slice(4))}</b>
        <small>Vale por mais ${min} min e uma vez só.</small>
        <a class="btn-outline" href="${escapeHTML(Ponte.linkDoApp(k.codigo))}">O app está neste celular? Toque aqui</a>
    </div>`;
}
function pintarCelular(p, gestor) {
    const c = p.cfg || {}, on = Ponte.estaOnline(p), imp = p.impressora || {}, pul = Ponte.estado().pulados[p.id] || 0, d = `data-ponte="${escapeHTML(p.id)}"`;
    const status = on ? '<span class="imp-ponte-st ok">Conectado</span>' : `<span class="imp-ponte-st erro">Sem contato ${escapeHTML(Ponte.quandoFoi(p.visto))}</span>`;
    const impTxt = imp.estado === 'ok' ? `Impressora funcionando${imp.nome ? `: <b>${escapeHTML(imp.nome)}</b>` : ''}.`
        : imp.estado === 'erro' ? `<span class="imp-ponte-st erro">Impressora parada</span> ${escapeHTML(imp.msg || '')}`
        : imp.estado === 'nenhuma' ? 'Nenhuma impressora escolhida no app.' : 'Ainda não imprimiu nada.';
    return `<section class="imp-ponte-card" ${d}>
        <header><b>${escapeHTML(p.nome || 'Celular da banca')}</b>${status}</header>
        <p class="config-sub">${impTxt}</p>
        ${on ? '' : '<p class="config-sub">Confira se o celular está ligado, com internet e se o app <b>Ponte da Banca</b> mostra "Pronta". O que chegar enquanto isso fica guardado e sai quando ele voltar.</p>'}
        <div class="grid-2">
            <div class="form-group"><label>Papel</label><select ${d} data-campo="largura"><option value="58"${marca(58, c.largura)}>58 mm</option><option value="80"${marca(80, c.largura)}>80 mm</option></select></div>
            <div class="form-group"><label>Vias do cupom</label><select ${d} data-campo="copias">${[1, 2, 3].map((n) => `<option${marca(n, c.copias)}>${n}</option>`).join('')}</select></div>
        </div>
        <label class="imp-check"><input type="checkbox" ${d} data-campo="acentos"${c.acentos ? ' checked' : ''}> <span>Imprimir com acentos<small>Deixe desligado se sair letra estranha no lugar de "ã" e "ç".</small></span></label>
        <fieldset class="imp-caminhos imp-auto-modos"><legend>Quando o cupom sai sozinho</legend>
            ${Object.entries(MODOS_AUTO).map(([k, [rot, dica]]) => `
            <label class="imp-caminho${c.auto === k ? ' sel' : ''}"><input type="radio" name="ponte-auto-${escapeHTML(p.id)}" ${d} data-campo="auto" value="${k}"${c.auto === k ? ' checked' : ''}><span><b>${rot}</b><small>${dica}</small></span></label>`).join('')}
        </fieldset>
        ${c.auto !== 'manual' ? `
        <label class="imp-check"><input type="checkbox" ${d} data-campo="autoEtiqueta"${c.autoEtiqueta ? ' checked' : ''}> <span>Imprimir também a etiqueta da sacola<small>Sai logo depois do cupom, com o nome, o endereço e quanto cobrar.</small></span></label>
        ${c.auto === 'chegada' ? `<label class="imp-check"><input type="checkbox" ${d} data-campo="autoPesado"${c.autoPesado ? ' checked' : ''}> <span>Imprimir de novo depois da pesagem<small>Pedido com item a pesar sai na chegada com "a pesar"; depois da balança sai o cupom com o valor certo.</small></span></label>` : ''}
        <label class="imp-check"><input type="checkbox" ${d} data-campo="autoCancelado"${c.autoCancelado !== false ? ' checked' : ''}> <span>Avisar no papel se um pedido impresso for cancelado<small>Sai "PEDIDO CANCELADO" com o nome do cliente, para ninguém separar nem entregar.</small></span></label>` : ''}
        ${pul ? `<p class="aviso-limite">${pul} pedido(s) que já estavam na fila não vão sair sozinhos. <button type="button" class="btn-outline" ${d} data-ponte-acao="fila">Imprimir esses agora</button></p>` : ''}
        ${gestor ? `<button type="button" class="btn-texto-perigo" ${d} data-ponte-acao="remover">Desligar este celular</button>` : ''}
    </section>`;
}
function pintarPonte() {
    const E = Ponte.estado(), pontes = E.pontes || [], gestor = podeLigar();
    if (E.pontes === null) return `<p class="config-sub">${E.erro ? escapeHTML(E.erro) : 'Procurando o celular da banca...'}</p>`;
    const passos = `
        <ol class="imp-passos">
            <li><b>No celular que vai ficar perto da impressora</b>, baixe e instale o app.
                <a class="btn-outline" href="${Ponte.APK_URL}" target="_blank" rel="noopener">Baixar o app Ponte da Banca</a>
                <small>O Android vai perguntar se pode instalar apps desta fonte: pode permitir.</small></li>
            <li>Abra o app, escolha a impressora e libere o que ele pedir (Bluetooth, avisos e bateria).</li>
            <li>${gestor ? `Toque em <b>Gerar código</b> e digite o código no app. <button type="button" class="btn-salvar-config" data-ponte-acao="codigo">Gerar código</button>` : 'Peça ao dono da loja para gerar o código e ligar o celular.'}</li>
        </ol>`;
    return `${E.erro ? `<p class="aviso-limite">${escapeHTML(E.erro)}</p>` : ''}
        ${pontes.length ? pontes.map((p) => pintarCelular(p, gestor)).join('') : passos}
        ${pintarCodigo()}
        ${pontes.length && gestor ? `<p class="config-sub">Trocou de celular? <button type="button" class="btn-outline" data-ponte-acao="codigo">Ligar outro celular</button> <a href="${Ponte.APK_URL}" target="_blank" rel="noopener">Baixar o app</a></p>` : ''}
        <p class="config-sub">O celular da banca imprime até com a tela bloqueada. Este aparelho (e qualquer outro do painel) só manda o papel: o botão "Cupom", o teste e as etiquetas saem lá.</p>`;
}
// só o dono e o administrador ligam ou desligam celular (o servidor confere de novo)
const podeLigar = () => ['proprietario', 'administrador', 'plataforma'].includes(papelAtual);

// ---------------------------------------------------------------- ajustes (aba "Ajustes" da tela Impressora)
export function pintar() {
    if (!$('imp-corpo')) return;
    const c = lerConfig(), sup = suporte(), ponte = c.modo === 'ponte', termica = c.modo !== 'sistema', precisaConectar = c.modo === 'bluetooth' || c.modo === 'serial';
    const largura = !termica ? c.largura : (c.largura === 'a4' ? 80 : c.largura);
    const ponteCfg = ponte ? (ponteAtiva() || {}).cfg || {} : null;
    const larguraPrevia = ponte ? (ponteCfg.largura || 80) : (largura === 'a4' ? 80 : largura);
    $('imp-corpo').innerHTML = `
        <fieldset class="imp-caminhos"><legend>Como este aparelho imprime</legend>
            ${Object.entries(CAMINHOS).map(([k, [rot, dica]]) => `
            <label class="imp-caminho${sup[k] ? ' off' : ''}${c.modo === k ? ' sel' : ''}">
                <input type="radio" name="imp-modo" value="${k}"${c.modo === k ? ' checked' : ''}${sup[k] ? ' disabled' : ''}>
                <span><b>${rot}</b><small>${escapeHTML(sup[k] || dica)}</small></span>
            </label>`).join('')}
        </fieldset>
        ${ponte ? `<h4 class="cp-sub">Celular da banca</h4>${pintarPonte()}` : `
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
        <h4 class="cp-sub">Impressão automática</h4>
        ${podeAutomatico(c.modo) ? `
        <fieldset class="imp-caminhos imp-auto-modos"><legend class="sr-only">Quando o cupom sai sozinho</legend>
            ${Object.entries(MODOS_AUTO).map(([k, [rot, dica]]) => `
            <label class="imp-caminho${c.auto === k ? ' sel' : ''}"><input type="radio" name="imp-auto" value="${k}"${c.auto === k ? ' checked' : ''}><span><b>${rot}</b><small>${dica}</small></span></label>`).join('')}
        </fieldset>
        ${c.auto !== 'manual' ? `
        <label class="imp-check"><input type="checkbox" id="imp-auto-etiqueta"${c.autoEtiqueta ? ' checked' : ''}> <span>Imprimir também a etiqueta da sacola<small>Sai logo depois do cupom, com o nome, o endereço e quanto cobrar.</small></span></label>
        ${c.auto === 'chegada' ? `<label class="imp-check"><input type="checkbox" id="imp-auto-pesado"${c.autoPesado ? ' checked' : ''}> <span>Imprimir de novo depois da pesagem<small>Pedido com item a pesar sai na chegada com "a pesar"; depois da balança sai o cupom com o valor certo.</small></span></label>` : ''}
        <label class="imp-check"><input type="checkbox" id="imp-auto-cancelado"${c.autoCancelado !== false ? ' checked' : ''}> <span>Avisar no papel se um pedido impresso for cancelado<small>Sai "PEDIDO CANCELADO" com o nome do cliente, para ninguém separar nem entregar.</small></span></label>
        <p class="config-sub">Deixe o painel <b>aberto neste aparelho</b>, perto da impressora. A tela fica acesa sozinha enquanto o painel estiver aberto. O que chegar com o painel fechado sai quando ele abrir de novo, e nenhum pedido sai duas vezes.</p>` : ''}`
        : '<p class="config-sub">Para o cupom sair sozinho, escolha "Bluetooth direto", "Cabo USB" ou "Celular da banca" lá em cima. Só o celular da banca imprime com a tela bloqueada.</p>'}`}
        <h4 class="cp-sub">Como o cupom fica</h4>
        <pre class="imp-previa" style="width:${colunasDe(larguraPrevia) + 2}ch" aria-label="Prévia do cupom">${escapeHTML(paraTexto(paginaDeTeste({ loja: nomeLoja || '', largura: larguraPrevia, modo: CAMINHOS[c.modo][0] }).map((l) => ({ ...l, g: false })), colunasDe(larguraPrevia)))}</pre>
        <p class="config-sub">No papel, o nome da loja e o total saem em letra maior.</p>
        <p class="config-sub">${ponte ? 'O caminho vale só para este aparelho. Papel, vias e impressão automática são do celular da banca e valem para todos.' : 'Esta escolha vale só para este aparelho. Cada celular ou computador do painel guarda a sua.'}</p>`;
}
const ajustesNaTela = () => { const c = $('imp-corpo'); return !!(c && c.offsetParent); };
/** O estado do celular chegou: redesenha os ajustes, se estiverem na tela (sem atrapalhar quem está escolhendo numa lista). */
function repintarSeAberto() {
    if (!ajustesNaTela() || lerConfig().modo !== 'ponte') return;
    const foco = document.activeElement; if (foco && foco.tagName === 'SELECT' && $('imp-corpo').contains(foco)) return;
    pintar();
}

async function salvarPonte(alvo) {
    const id = alvo.dataset.ponte, campo = alvo.dataset.campo;
    const valor = alvo.type === 'checkbox' ? alvo.checked : campo === 'largura' || campo === 'copias' ? Number(alvo.value) : alvo.value;
    try {
        const d = await Ponte.salvar(id, { [campo]: valor });
        if (d.pulados) showToast(`${d.pulados} pedido(s) que já estavam na fila não vão sair sozinhos. Para imprimir, toque em "Imprimir esses agora".`);
    } catch (e) { showToast(e && e.amigavel ? e.message : 'Não consegui salvar no celular da banca.', true); }
    pintar();
}
async function acaoPonte(b) {
    const a = b.dataset.ponteAcao, id = b.dataset.ponte;
    b.disabled = true;
    try {
        if (a === 'codigo') {
            const c = lerConfig();
            await Ponte.gerarCodigo({ largura: c.largura === 58 ? 58 : 80, acentos: !!c.acentos, copias: c.copias, auto: c.auto !== 'manual' ? c.auto : 'chegada' });
            // o celular ligado aparece aqui sozinho: confere a cada 5 s enquanto o código vale
            const vigia = setInterval(async () => {
                const antes = (Ponte.estado().pontes || []).length; await Ponte.atualizar();
                if ((Ponte.estado().pontes || []).length > antes) { Ponte.estado().codigo = null; showToast('Celular da banca ligado!'); clearInterval(vigia); repintarSeAberto(); }
                if (!Ponte.codigoValido() || !$('imp-corpo')?.isConnected) clearInterval(vigia);
            }, 5000);
        } else if (a === 'fila') {
            await Ponte.salvar(id, null, true); showToast('Certo: os pedidos que estavam na fila vão sair no celular da banca.');
        } else if (a === 'remover') {
            const ok = await customConfirm('Desligar este celular?', 'Ele para de imprimir na hora. Para ligar de novo, gere um código novo.', { ok: 'Desligar', nao: 'Voltar' });
            if (ok) { await Ponte.remover(id); showToast('Celular desligado.'); }
        }
    } catch (e) { showToast(e && e.amigavel ? e.message : 'Não consegui falar com o servidor agora.', true); }
    b.disabled = false; pintar();
}

/** Liga os ajustes no #imp-corpo (criado pela tela Impressora). Uma vez por elemento. */
export function ligarAjustes() {
    const corpo = $('imp-corpo'); if (!corpo || corpo.dataset.ligado) return;
    corpo.dataset.ligado = '1';
    if (!window.__ponteOuvida) { window.__ponteOuvida = true; document.addEventListener('ponte:estado', repintarSeAberto); }
    corpo.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset && t.dataset.ponte && t.dataset.campo) return salvarPonte(t);
        if (t.name === 'imp-modo') {
            const c = salvarConfig({ modo: t.value }); if (t.value !== 'sistema' && c.largura === 'a4') salvarConfig({ largura: 80 });
            if (t.value === 'ponte') Ponte.atualizar();
        }
        else if (t.id === 'imp-largura') salvarConfig({ largura: t.value === 'a4' ? 'a4' : Number(t.value) });
        else if (t.id === 'imp-copias') salvarConfig({ copias: Number(t.value) });
        else if (t.id === 'imp-acentos') salvarConfig({ acentos: t.checked });
        else if (t.id === 'imp-baud') salvarConfig({ baud: Number(t.value) });
        else if (t.name === 'imp-auto') salvarConfig({ auto: t.value });
        else if (t.id === 'imp-auto-etiqueta') salvarConfig({ autoEtiqueta: t.checked });
        else if (t.id === 'imp-auto-pesado') salvarConfig({ autoPesado: t.checked });
        else if (t.id === 'imp-auto-cancelado') salvarConfig({ autoCancelado: t.checked });
        else return undefined;
        pintar(); avisarMudanca();
        return undefined;
    });
    corpo.addEventListener('click', async (e) => {
        const p = e.target.closest('[data-ponte-acao]'); if (p) return acaoPonte(p);
        const b = e.target.closest('#imp-conectar'); if (!b) return undefined;
        b.disabled = true;
        try { const nome = await conectar(); showToast(nome ? `Conectada: ${nome}.` : 'Conectada.'); }
        catch (err) { console.error('[impressao]', err); showToast(err && err.amigavel ? err.message : 'Não consegui conectar. Confira se a impressora está ligada e perto.', true); }
        pintar(); avisarMudanca();
        return undefined;
    });
}
/** O celular da banca que vale agora: o primeiro com contato; se nenhum tiver, o primeiro da lista. */
export function ponteAtiva() {
    const ps = Ponte.estado().pontes || [];
    return ps.find(Ponte.estaOnline) || ps[0] || null;
}
/** Largura da bobina que vale agora: a do celular da banca, ou a deste aparelho. */
export function larguraAtual() {
    const c = lerConfig();
    if (c.modo === 'ponte') return Number(((ponteAtiva() || {}).cfg || {}).largura) === 58 ? 58 : 80;
    return c.largura === 58 ? 58 : 80;
}
export async function imprimirTeste() {
    const c = lerConfig();
    return mandar([paginaDeTeste({ loja: await loja(), largura: larguraAtual(), modo: CAMINHOS[c.modo][0] })], { copias: 1 }, 'Teste enviado para a impressora.');
}
/** Abre a tela Impressora do Menu. secao: 'whats' | 'foto' | 'ajustes'. */
export async function abrirImpressora(secao = 'ajustes') {
    const m = await import('./admin-impressora.js');
    return m.irParaImpressora(secao);
}
