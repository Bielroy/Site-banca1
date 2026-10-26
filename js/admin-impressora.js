// =====================================================================
//  js/admin-impressora.js — tela "Impressora" do Menu.
//
//  Três partes, uma de cada vez:
//    Pedido do WhatsApp  cola ou digita o pedido que chegou por mensagem e imprime o cupom.
//                        Depois do papel, "Conferir e registrar" (opcional, js/admin-conferir-whats.js)
//                        casa cada linha com um produto e grava o pedido no sistema.
//    Foto                tira ou escolhe uma foto (lista escrita, print da conversa) e
//                        imprime a imagem no papel, em preto e branco.
//    Ajustes             caminho da impressora, papel, vias, impressão automática e o
//                        celular da banca (js/admin-impressao.js, que também tem os atalhos).
//  Em cima, a faixa diz se a impressora está pronta. Ao lado, o papel mostra como vai sair.
// =====================================================================
import { escapeHTML, showToast, focarCampo } from './utils.js';
import { lerConfig, CAMINHOS, conectada, imprimirNaTermica, imprimirPagina } from './impressao.js';
import { pedidoAvulso, avulsoTemConteudo, compor, colunasDe } from './impressao-lib.js';
import { paraCinza, rasterEscPos } from './rotulo-lib.js';
import { prepararFoto, tamanhoNoPapel, tintaUsada } from './foto-termica-lib.js';
import * as Ponte from './impressao-ponte.js';
import { loja, mandar, pintar as pintarAjustes, ligarAjustes, larguraAtual, imprimirTeste } from './admin-impressao.js';
import { criarConferencia } from './admin-conferir-whats.js';

const $ = (id) => document.getElementById(id);
const SECOES = { whats: 'Pedido do WhatsApp', foto: 'Foto', ajustes: 'Ajustes' };
const S = { secao: 'whats', montada: false, foto: null, fotoNome: '', modo: 'texto', clareza: 50, giro: 0, pontos: null, w: 0, h: 0, vias: 1, enviando: false };
const CAMPOS = ['nome', 'endereco', 'telefone', 'itens', 'entrega', 'pagamento', 'obs'];
const RASCUNHO = 'banca_impressora_rascunho';

// ---------------------------------------------------------------- rascunho do pedido (só neste aparelho)
const lerRascunho = () => { try { return JSON.parse(sessionStorage.getItem(RASCUNHO) || 'null') || {}; } catch (_) { return {}; } };
const guardarRascunho = (d) => { try { sessionStorage.setItem(RASCUNHO, JSON.stringify(d)); } catch (_) { /* armazenamento bloqueado */ } };
const dadosDoForm = () => Object.fromEntries(CAMPOS.map((k) => [k, ($(`ipr-${k}`) || {}).value || '']));
// depois de registrar, a tela fica pronta para o próximo pedido
const Conferir = criarConferencia({ $, lerForm: dadosDoForm, depoisDeRegistrar: () => $('ipr-limpar')?.click() });

// ---------------------------------------------------------------- faixa de cima: a impressora está pronta?
function estadoDaImpressora() {
    const c = lerConfig();
    if (c.modo === 'ponte') {
        const f = Ponte.situacao(), pontes = Ponte.estado().pontes || [], vivos = pontes.filter(Ponte.estaOnline), viva = vivos[0];
        const celulares = pontes.length > 1 ? pontes : null;      // mais de um celular: cada um aparece com a sua bolinha
        if (f.tipo === 'carregando') return { cor: 'espera', titulo: 'Celular da banca', dica: 'Procurando o celular...' };
        if (f.tipo === 'nenhum') return { cor: 'erro', titulo: 'Nenhum celular da banca ligado', dica: 'Em Ajustes, gere o código e digite no app Ponte da Banca.', acao: ['ajustes', 'Ligar celular'] };
        if (f.tipo === 'horario') return { cor: 'neutro', celulares, titulo: 'Celular da banca desligado pelo horário', dica: `${f.ligarAs ? `Liga sozinho às ${f.ligarAs}. ` : ''}O que chegar fica guardado e sai quando ele ligar.` };
        if (f.tipo === 'fora') return { cor: 'erro', celulares, titulo: celulares ? 'Nenhum celular da banca com contato' : 'Celular da banca sem contato', dica: `Visto pela última vez ${Ponte.quandoFoi(f.visto)}. Confira se está ligado e com internet. O que você mandar fica guardado.` };
        if (f.tipo === 'impressora') return { cor: 'alerta', celulares, titulo: 'A impressora não respondeu', dica: f.msg };
        if (vivos.length > 1) return { cor: 'ok', celulares, titulo: `${vivos.length} celulares da banca prontos`, dica: 'O papel sai no primeiro que pegar. Se cada um fica num lugar, deixe ligado só o que está perto da impressora.' };
        const imp = viva && viva.impressora && viva.impressora.nome;
        return { cor: 'ok', celulares, titulo: viva && viva.nome ? viva.nome : 'Celular da banca', dica: imp ? `Pronta para imprimir em ${imp}.` : 'Pronto para imprimir.' };
    }
    if (c.modo === 'bluetooth' || c.modo === 'serial') {
        return conectada() ? { cor: 'ok', titulo: CAMINHOS[c.modo][0], dica: c.btNome ? `Pronta: ${c.btNome}.` : 'Pronta para imprimir.' }
            : { cor: 'alerta', titulo: 'Impressora desconectada', dica: 'Toque em Conectar e escolha a impressora.', acao: ['conectar', 'Conectar'] };
    }
    if (c.modo === 'app') return { cor: 'ok', titulo: 'Aplicativo de impressão', dica: 'O papel vai para o RawBT deste celular.' };
    return { cor: 'neutro', titulo: 'Impressão do aparelho', dica: 'Abre a tela de imprimir. Para a térmica, escolha o caminho dela em Ajustes.', acao: ['ajustes', 'Escolher'] };
}
/** Um celular da banca na faixa de cima: nome e como ele está. */
function pintarCelular(p) {
    const on = Ponte.estaOnline(p), imp = p.impressora || {};
    const horario = !on && p.foraDoHorario, liga = p.cfg && p.cfg.ligarAs;
    const cor = horario ? 'alerta' : !on ? 'erro' : imp.estado === 'erro' ? 'alerta' : 'ok';
    const txt = horario ? (liga ? `desligado até ${liga}` : 'desligado pelo horário') : !on ? `sem contato ${Ponte.quandoFoi(p.visto)}` : imp.estado === 'erro' ? 'impressora parada' : 'pronto';
    return `<li class="ipr-cel ${cor}"><i aria-hidden="true"></i><b>${escapeHTML(p.nome || 'Celular da banca')}</b><small>${escapeHTML(txt)}</small></li>`;
}
function pintarStatus() {
    const el = $('ipr-status'); if (!el) return;
    const e = estadoDaImpressora();
    el.className = `ipr-status ${e.cor}`;
    el.innerHTML = `<span class="ipr-led" aria-hidden="true"></span>
        <div class="ipr-status-txt"><b>${escapeHTML(e.titulo)}</b><small>${escapeHTML(e.dica || '')}</small></div>
        ${e.acao ? `<button type="button" class="bt-sec" data-ipr-acao="${e.acao[0]}">${escapeHTML(e.acao[1])}</button>` : ''}
        <button type="button" class="bt-sec" id="imp-teste">Imprimir teste</button>
        ${e.celulares ? `<ul class="ipr-cels" aria-label="Celulares da banca">${e.celulares.map(pintarCelular).join('')}</ul>` : ''}`;
}
/** O atalho dos rótulos só aparece para quem cuida dos produtos (o rótulo fica guardado no produto). */
function pintarMais() {
    const el = $('ipr-mais'); if (!el) return;
    const tab = document.querySelector('.tab[data-aba="produtos"]');
    el.hidden = !tab || tab.hidden || S.secao === 'ajustes';
}

// ---------------------------------------------------------------- o papel ao lado
function pintarPapel() {
    const papel = $('ipr-papel'); if (!papel) return;
    const largura = larguraAtual(), col = colunasDe(largura);
    papel.style.setProperty('--col', col);
    papel.dataset.largura = largura;
    $('ipr-papel-mm').textContent = `${largura} mm`;
    const bt = $('ipr-imprimir');
    if (S.secao === 'foto') {
        papel.classList.add('com-foto');
        const tem = !!(S.pontos && S.pontos.length);
        $('ipr-previa').hidden = true; $('ipr-canvas').hidden = !tem; $('ipr-vazio').hidden = tem;
        $('ipr-vazio').textContent = 'A foto aparece aqui, do jeito que vai sair.';
        if (tem) desenharPontos($('ipr-canvas'));
        bt.textContent = 'Imprimir foto'; bt.disabled = !tem || S.enviando;
        return;
    }
    papel.classList.remove('com-foto');
    const d = dadosDoForm(), tem = avulsoTemConteudo(d);
    $('ipr-canvas').hidden = true; $('ipr-previa').hidden = !tem; $('ipr-vazio').hidden = tem;
    $('ipr-vazio').textContent = 'Cole a mensagem do cliente e o cupom aparece aqui.';
    if (tem) {
        const linhas = compor(pedidoAvulso(d, { loja: nomeLoja }), col).filter((l) => !l.corte);
        $('ipr-previa').innerHTML = linhas.map((l) => `<span class="${l.b ? 'b' : ''}${l.g ? ' g' : ''}">${escapeHTML(l.s.replace(/\s+$/, '')) || ' '}</span>`).join('');
    }
    bt.textContent = 'Imprimir pedido'; bt.disabled = !tem || S.enviando;
}
let nomeLoja = '';

// ---------------------------------------------------------------- foto
async function abrirFoto(arquivo) {
    if (!arquivo) return;
    if (!/^image\//.test(arquivo.type || '')) { showToast('Esse arquivo não é uma foto.', true); return; }
    try {
        S.foto = await createImageBitmap(arquivo, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(arquivo));
        S.fotoNome = arquivo.name || 'foto'; S.giro = 0;
        processarFoto(); pintarFoto();
    } catch (e) { console.error('[foto]', e); showToast('Não consegui abrir esta foto. Tente outra.', true); }
}
/** Foto → pontos pretos na largura da bobina (refeito ao mudar clareza, jeito, giro ou papel). */
function processarFoto() {
    if (!S.foto) { S.pontos = null; return; }
    const deLado = S.giro % 180 !== 0;
    const w0 = deLado ? S.foto.height : S.foto.width, h0 = deLado ? S.foto.width : S.foto.height;
    S.bobina = larguraAtual();
    const { w, h } = tamanhoNoPapel(w0, h0, S.bobina);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2); g.rotate((S.giro * Math.PI) / 180);
    const dw = deLado ? h : w, dh = deLado ? w : h;
    g.imageSmoothingQuality = 'high';
    g.drawImage(S.foto, -dw / 2, -dh / 2, dw, dh);
    const cinza = paraCinza(g.getImageData(0, 0, w, h).data, w, h);
    S.pontos = prepararFoto(cinza, w, h, { modo: S.modo, clareza: S.clareza }); S.w = w; S.h = h;
}
function desenharPontos(cv) {
    cv.width = S.w; cv.height = S.h;
    const g = cv.getContext('2d'), img = g.createImageData(S.w, S.h);
    for (let i = 0; i < S.pontos.length; i++) { const v = S.pontos[i] ? 24 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
}
function pintarFoto() {
    const tem = !!S.foto;
    $('ipr-foto-escolher').hidden = tem; $('ipr-foto-ajustes').hidden = !tem;
    if (tem) {
        $('ipr-foto-nome').textContent = S.fotoNome;
        document.querySelectorAll('[name="ipr-modo"]').forEach((r) => { r.checked = r.value === S.modo; r.closest('label').classList.toggle('sel', r.checked); });
        $('ipr-clareza').value = String(S.clareza);
        const t = tintaUsada(S.pontos);
        const av = $('ipr-foto-aviso');
        av.hidden = t < 0.45;
        av.textContent = S.modo === 'foto' ? 'A foto saiu escura: vai gastar muito papel e pode não dar para ler. Arraste a clareza para a direita ou use "Lista escrita".'
            : 'Saiu muita tinta: arraste a clareza para a direita, ou tire a foto com mais luz e sem sombra.';
    }
    pintarPapel();
}

// ---------------------------------------------------------------- imprimir
const avisoDoCelular = (r) => {
    if (lerConfig().modo !== 'ponte') return;
    if (r && r.foraDoHorario) showToast('Na fila do celular da banca. Ele está desligado pelo horário: para sair agora, toque em "Ligar a ponte" no app.');
    else if (r && r.online === false) showToast(`Na fila do celular da banca, mas ele está sem contato ${Ponte.quandoFoi(r.visto)}.`, true);
    else showToast('Enviado para o celular da banca.');
};
async function imprimirAgora() {
    if (S.enviando) return;
    S.enviando = true; pintarPapel();
    const bt = $('ipr-imprimir'), antes = bt.textContent; bt.textContent = 'Enviando...';
    try {
        if (S.secao === 'foto') await imprimirFoto();
        else {
            const d = dadosDoForm();
            if (!avulsoTemConteudo(d)) return;
            const ok = await mandar([pedidoAvulso(d, { loja: nomeLoja })], { copias: S.vias }, S.vias > 1 ? `${S.vias} vias enviadas para a impressora.` : 'Pedido enviado para a impressora.');
            if (ok) { $('ipr-limpar').hidden = false; S.impresso = true; guardarRascunho({ ...d, impresso: true }); Conferir.oferecer(); }
        }
    } finally { S.enviando = false; bt.textContent = antes; pintarPapel(); }
}
async function imprimirFoto() {
    if (!S.pontos) return;
    const c = lerConfig();
    try {
        if (c.modo === 'sistema') {
            const cv = document.createElement('canvas'); desenharPontos(cv);
            const url = cv.toDataURL('image/png'), mm = larguraAtual() === 58 ? 48 : 72;
            const um = `<img src="${url}" alt="" style="display:block;width:${mm}mm;margin:0 auto 6mm">`;
            await imprimirPagina(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Foto</title><style>@page{size:${mm + 8}mm auto;margin:0}body{margin:0;padding:2mm 0}</style></head><body>${um.repeat(S.vias)}</body></html>`);
            showToast('Abrindo a tela de imprimir...');
            return;
        }
        const r = await imprimirNaTermica(rasterEscPos(S.pontos, S.w, S.h, { copias: S.vias }));
        if (c.modo === 'ponte') avisoDoCelular(r);
        else showToast(c.modo === 'app' ? 'Enviado para o aplicativo de impressão.' : 'Foto enviada para a impressora.');
    } catch (e) {
        console.error('[foto]', e);
        showToast(e && e.amigavel ? e.message : 'Não consegui imprimir a foto. Confira a impressora em Ajustes.', true);
    }
}

// ---------------------------------------------------------------- tela
function montar() {
    const caixa = $('impressora-conteudo'); if (!caixa) return;
    // Pedido que já saiu no papel não volta quando a pessoa sai da tela e entra de novo (mesmo sem tocar em "Limpar").
    let r = lerRascunho(); if (r.impresso) { r = {}; guardarRascunho({}); }
    const v = (k) => escapeHTML(r[k] || '');
    caixa.innerHTML = `
    <div class="ipr">
        <header class="ipr-status" id="ipr-status" role="status" aria-live="polite"></header>
        <div class="ipr-seg" role="tablist" aria-label="O que fazer na impressora">
            ${Object.entries(SECOES).map(([k, nome]) => `<button type="button" role="tab" id="ipr-tab-${k}" data-secao="${k}" aria-controls="ipr-p-${k}"><i class="ic" data-i="${k === 'whats' ? 'conversa' : k === 'foto' ? 'camera' : 'config'}"></i><span>${nome}</span></button>`).join('')}
        </div>
        <div class="ipr-palco">
            <section class="ipr-painel" id="ipr-p-whats" role="tabpanel" aria-labelledby="ipr-tab-whats">
                <p class="ipr-lead">Para o pedido que chegou por mensagem. Cole a conversa do cliente: a hora e o nome que o WhatsApp põe, e os emojis, saem sozinhos.</p>
                <div class="form-group ipr-itens">
                    <div class="ipr-rotulo"><label for="ipr-itens">Itens do pedido</label><button type="button" class="ipr-colar" id="ipr-colar"><i class="ic" data-i="copiar"></i> Colar</button></div>
                    <textarea id="ipr-itens" rows="7" placeholder="Um item por linha, por exemplo:&#10;2 kg de tomate&#10;1 alface crespa&#10;6 ovos caipira">${v('itens')}</textarea>
                </div>
                <div class="ipr-grade">
                    <div class="form-group"><label for="ipr-nome">Cliente</label><input id="ipr-nome" autocomplete="off" maxlength="80" value="${v('nome')}" placeholder="Nome de quem pediu"></div>
                    <div class="form-group"><label for="ipr-telefone">Telefone</label><input id="ipr-telefone" inputmode="tel" autocomplete="off" maxlength="20" value="${v('telefone')}" placeholder="(61) 9 0000-0000"></div>
                    <div class="form-group ipr-largo"><label for="ipr-endereco">Endereço</label><input id="ipr-endereco" autocomplete="off" maxlength="160" value="${v('endereco')}" placeholder="Condomínio, quadra e lote"></div>
                    <div class="form-group"><label for="ipr-entrega">Entregar</label><input id="ipr-entrega" autocomplete="off" maxlength="60" value="${v('entrega')}" placeholder="Hoje, até 11h" list="ipr-entrega-lista"></div>
                    <div class="form-group"><label for="ipr-pagamento">Pagamento</label><input id="ipr-pagamento" autocomplete="off" maxlength="60" value="${v('pagamento')}" placeholder="PIX, dinheiro, cartão" list="ipr-pag-lista"></div>
                    <div class="form-group ipr-largo"><label for="ipr-obs">Observação</label><input id="ipr-obs" autocomplete="off" maxlength="300" value="${v('obs')}" placeholder="Troco para 50, tomate bem maduro..."></div>
                </div>
                <datalist id="ipr-pag-lista"><option value="PIX"><option value="Dinheiro"><option value="Cartão na entrega"><option value="Já pago"></datalist>
                <datalist id="ipr-entrega-lista"><option value="Hoje"><option value="Amanhã"><option value="Retira na banca"></datalist>
                <p class="ipr-nota">O papel sai só com o texto. Depois de imprimir, se quiser, confira os produtos e registre o pedido: ele entra na lista de pedidos, no caixa e no estoque.</p>
                <button type="button" class="ipr-link ipr-limpar" id="ipr-limpar"${avulsoTemConteudo(r) ? '' : ' hidden'}>Limpar para o próximo pedido</button>
                <div class="iconf" id="ipr-conf" hidden></div>
            </section>

            <section class="ipr-painel" id="ipr-p-foto" role="tabpanel" aria-labelledby="ipr-tab-foto">
                <p class="ipr-lead">Para a lista escrita à mão ou o print da conversa. A foto sai no papel em preto e branco, do tamanho da bobina.</p>
                <div class="ipr-foto-escolher" id="ipr-foto-escolher">
                    <label class="ipr-alvo"><input type="file" accept="image/*" capture="environment" id="ipr-camera"><i class="ic" data-i="camera"></i><b>Tirar foto</b><small>Com boa luz, sem sombra em cima do papel</small></label>
                    <label class="ipr-alvo"><input type="file" accept="image/*" id="ipr-galeria"><i class="ic" data-i="baixar"></i><b>Escolher da galeria</b><small>Foto ou print que o cliente mandou</small></label>
                </div>
                <div class="ipr-foto-ajustes" id="ipr-foto-ajustes" hidden>
                    <div class="ipr-foto-topo"><span id="ipr-foto-nome"></span><button type="button" class="ipr-link" id="ipr-foto-trocar">Trocar foto</button></div>
                    <fieldset class="ipr-jeito"><legend>O que tem na foto</legend>
                        <label><input type="radio" name="ipr-modo" value="texto"><span><b>Lista escrita</b><small>Letra e texto bem pretos, sem a sombra</small></span></label>
                        <label><input type="radio" name="ipr-modo" value="foto"><span><b>Imagem</b><small>Produto, rosto, desenho: com tons de cinza</small></span></label>
                    </fieldset>
                    <div class="form-group"><label for="ipr-clareza">Clareza</label>
                        <div class="ipr-faixa"><span aria-hidden="true">Mais escuro</span><input type="range" id="ipr-clareza" min="0" max="100" step="5"><span aria-hidden="true">Mais claro</span></div></div>
                    <button type="button" class="bt-sec" id="ipr-girar"><i class="ic" data-i="repetir"></i> Girar a foto</button>
                    <p class="aviso-limite" id="ipr-foto-aviso" hidden></p>
                </div>
            </section>

            <section class="ipr-painel" id="ipr-p-ajustes" role="tabpanel" aria-labelledby="ipr-tab-ajustes">
                <div id="imp-corpo"></div>
            </section>

            <aside class="ipr-saida" id="ipr-saida" aria-label="Como vai sair no papel">
                <div class="ipr-boca"><span>Como vai sair</span><small id="ipr-papel-mm"></small></div>
                <div class="ipr-papel" id="ipr-papel">
                    <p class="ipr-vazio" id="ipr-vazio"></p>
                    <div class="ipr-previa" id="ipr-previa" hidden></div>
                    <canvas class="ipr-canvas" id="ipr-canvas" hidden></canvas>
                </div>
                <div class="ipr-acao">
                    <div class="ipr-vias" role="group" aria-label="Vias">
                        <button type="button" data-vias="-1" aria-label="Uma via a menos">−</button>
                        <span id="ipr-vias">1 via</span>
                        <button type="button" data-vias="1" aria-label="Uma via a mais">+</button>
                    </div>
                    <button type="button" class="bt ipr-imprimir" id="ipr-imprimir">Imprimir pedido</button>
                </div>
            </aside>
        </div>
        <aside class="ipr-mais" id="ipr-mais" hidden>
            <i class="ic" data-i="etiqueta" aria-hidden="true"></i>
            <div><b>Rótulo adesivo dos produtos</b><small>Monte uma vez, com a foto, o nome e o preço, e imprima quantos precisar no dia.</small></div>
            <button type="button" class="bt-sec" data-action="rotulos">Abrir rótulos</button>
        </aside>
    </div>`;
    ligar();
    S.montada = true;
}

function irPara(secao) {
    S.secao = SECOES[secao] ? secao : 'whats';
    document.querySelectorAll('.ipr-seg [data-secao]').forEach((b) => { const on = b.dataset.secao === S.secao; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('.ipr-painel').forEach((p) => { p.hidden = p.id !== `ipr-p-${S.secao}`; });
    $('ipr-saida').hidden = S.secao === 'ajustes';
    document.querySelector('.ipr').dataset.secao = S.secao;
    if (S.secao === 'ajustes') { ligarAjustes(); pintarAjustes(); if (lerConfig().modo === 'ponte') Ponte.atualizar(); }
    else pintarPapel();
    pintarMais();
}

function ligar() {
    const raiz = document.querySelector('.ipr');
    raiz.querySelector('.ipr-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-secao]'); if (b) irPara(b.dataset.secao); });
    raiz.querySelector('.ipr-seg').addEventListener('keydown', (e) => {   // setas trocam de parte, como abas de verdade
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const ks = Object.keys(SECOES), i = (ks.indexOf(S.secao) + (e.key === 'ArrowRight' ? 1 : ks.length - 1)) % ks.length;
        irPara(ks[i]); $(`ipr-tab-${ks[i]}`).focus();
    });
    $('ipr-p-whats').addEventListener('input', () => { guardarRascunho(dadosDoForm()); pintarPapel(); });
    // Depois que a via saiu, o próximo pedido colado SUBSTITUI o anterior (antes ele ia junto, embaixo, e saía no
    // papel do próximo cliente). Antes de imprimir, colar de novo junta: o cliente às vezes manda várias mensagens.
    const novoPedidoSeJaSaiu = () => { if (!S.impresso) return; S.impresso = false; CAMPOS.forEach((k) => { const el = $(`ipr-${k}`); if (el) el.value = ''; }); $('ipr-limpar').hidden = true; Conferir.fechar(); };
    $('ipr-itens').addEventListener('paste', novoPedidoSeJaSaiu);
    $('ipr-colar').addEventListener('click', async () => {
        try {
            const t = await navigator.clipboard.readText();
            if (!t || !t.trim()) { showToast('Não tem texto copiado. No WhatsApp, segure a mensagem e toque em Copiar.'); return; }
            novoPedidoSeJaSaiu();
            const el = $('ipr-itens'); el.value = el.value.trim() ? `${el.value.trim()}\n${t.trim()}` : t.trim();
            guardarRascunho(dadosDoForm()); pintarPapel();
        } catch (_) { showToast('O navegador não deixou colar daqui. Segure dentro da caixa e toque em Colar.'); $('ipr-itens').focus(); }
    });
    $('ipr-limpar').addEventListener('click', () => {
        CAMPOS.forEach((k) => { const el = $(`ipr-${k}`); if (el) el.value = ''; });
        S.impresso = false; Conferir.fechar();
        guardarRascunho({}); $('ipr-limpar').hidden = true; pintarPapel(); focarCampo($('ipr-itens'));
    });
    for (const id of ['ipr-camera', 'ipr-galeria']) $(id).addEventListener('change', (e) => { abrirFoto(e.target.files && e.target.files[0]); e.target.value = ''; });
    $('ipr-foto-trocar').addEventListener('click', () => { S.foto = null; S.pontos = null; pintarFoto(); });
    $('ipr-foto-ajustes').addEventListener('change', (e) => { if (e.target.name === 'ipr-modo') { S.modo = e.target.value; processarFoto(); pintarFoto(); } });
    let quadro = 0;
    $('ipr-clareza').addEventListener('input', (e) => { S.clareza = Number(e.target.value); cancelAnimationFrame(quadro); quadro = requestAnimationFrame(() => { processarFoto(); pintarFoto(); }); });
    $('ipr-girar').addEventListener('click', () => { S.giro = (S.giro + 90) % 360; processarFoto(); pintarFoto(); });
    raiz.querySelector('.ipr-vias').addEventListener('click', (e) => {
        const b = e.target.closest('[data-vias]'); if (!b) return;
        S.vias = Math.min(3, Math.max(1, S.vias + Number(b.dataset.vias)));
        $('ipr-vias').textContent = S.vias === 1 ? '1 via' : `${S.vias} vias`;
    });
    $('ipr-imprimir').addEventListener('click', imprimirAgora);
    $('ipr-status').addEventListener('click', async (e) => {
        if (e.target.closest('#imp-teste')) { const b = e.target.closest('#imp-teste'); b.disabled = true; await imprimirTeste(); b.disabled = false; return; }
        const a = e.target.closest('[data-ipr-acao]'); if (!a) return;
        if (a.dataset.iprAcao === 'ajustes') irPara('ajustes');
        if (a.dataset.iprAcao === 'conectar') { irPara('ajustes'); setTimeout(() => $('imp-conectar')?.click(), 50); }
    });
    // o celular da banca respondeu, ou os ajustes mudaram: faixa e papel acompanham (a bobina pode ter mudado)
    const mudou = () => { pintarStatus(); if (S.foto && S.bobina !== larguraAtual()) { processarFoto(); pintarFoto(); } else if (S.secao !== 'ajustes') pintarPapel(); };
    document.addEventListener('ponte:estado', mudou);
    document.addEventListener('impressao:config', mudou);
}

/** Chamada quando a aba "Impressora" abre (js/admin.js). */
export async function abrirAbaImpressora(produtos) {
    if (Array.isArray(produtos)) Conferir.definirProdutos(produtos);
    nomeLoja = await loja();
    if (!S.montada || !$('ipr-status')) montar();
    pintarStatus(); irPara(S.secao);
    if (lerConfig().modo === 'ponte') Ponte.atualizar();
}
/** Os produtos mudaram (preço, estoque, produto novo): a conferência do pedido usa a lista nova. */
export const definirProdutosImpressora = (produtos) => Conferir.definirProdutos(produtos);
/** Abre a aba "Impressora" numa parte: 'whats' | 'foto' | 'ajustes'. */
export function irParaImpressora(secao = 'whats') {
    S.secao = SECOES[secao] ? secao : 'whats';
    const tab = document.querySelector('.tab[data-aba="impressora"]');
    if (!tab || tab.hidden) { showToast('A tela da impressora não está liberada para o seu acesso.', true); return; }
    if (tab.classList.contains('active') && S.montada) irPara(S.secao); else tab.click();
}
