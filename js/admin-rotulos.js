// =====================================================================
//  js/admin-rotulos.js — RÓTULOS ADESIVOS PERSONALIZADOS (painel).
//
//  Fluxo do dono:
//   1. escolhe o produto ("Milho verde");
//   2. monta o rótulo UMA vez: imagem que quiser (foto, desenho, logo),
//      nome do rótulo, linha de baixo, preço/validade/loja, borda — e salva;
//   3. no dia: escolhe o produto, diz QUANTOS (15) e imprime.
//  O rótulo fica guardado no produto (produto.rotulo). O tamanho do adesivo
//  fica neste aparelho (depende da impressora que está aqui).
//  Regras e impressão: js/rotulo-lib.js. Desenho: js/rotulo-arte.js.
// =====================================================================
import { getDoc, setDoc } from './firebase.js';
import { tdoc, fichaRef, chave, ehLojaOriginal } from './tenant.js';
import { escapeHTML, showToast, openModal } from './utils.js';
import { miniatura } from './foto-lib.js';
import { validarArquivo } from './fotos-lib.js';
import { TAMANHOS, TAMANHO_PADRAO, BORDAS, MAX_COPIAS, rotuloSeguro, conteudoDoRotulo, copiasValidas, pixelsDo, pontilhar, paraCinza, rasterEscPos, paginaDeRotulos, folhasNecessarias } from './rotulo-lib.js';
import { desenharRotulo, abrirImagem, prepararLetras } from './rotulo-arte.js';

const $ = (id) => document.getElementById(id);
const PREF = chave('banca_rotulo_pref');
const lerPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch (_) { return {}; } };
const gravarPref = (p) => { try { localStorage.setItem(PREF, JSON.stringify({ ...lerPref(), ...p })); } catch (_) { /* sem memória: só não lembra */ } };
const VALIDADES = [0, 2, 3, 5, 7, 10, 15, 30, 60, 90, 180, 365];

let produtos = [], atual = null, rotulo = null, gravado = '', loja = { nome: '', logo: '' }, imagens = new Map(), desenhando = 0;

// imagem aberta (cache por endereço). Arquivo recém escolhido entra direto, sem esperar o envio.
async function imagem(url) {
    if (!url) return null;
    if (imagens.has(url)) return imagens.get(url);
    const img = await abrirImagem(url, { reduzida: miniatura(url, 384) });
    imagens.set(url, img);
    return img;
}

async function lerLoja() {
    try {
        const s = await getDoc(fichaRef()), d = s.exists() ? s.data() : {};
        loja = { nome: (d && d.nome) || (ehLojaOriginal ? 'Banca Adair e Pedrina' : ''), logo: (d && d.tema && /^https:\/\//.test(String(d.tema.logo || '')) ? d.tema.logo : '') };
    } catch (_) { loja = { nome: ehLojaOriginal ? 'Banca Adair e Pedrina' : '', logo: '' }; }
}

function montarModal() {
    if ($('modal-rotulos')) return;
    const tamanhos = Object.entries(TAMANHOS).map(([k, t]) => `<option value="${k}">${escapeHTML(t.nome)}</option>`).join('');
    const validades = VALIDADES.map((d) => `<option value="${d}">${d ? `${d} ${d === 1 ? 'dia' : 'dias'}` : 'Sem validade'}</option>`).join('');
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-rotulos" role="dialog" aria-modal="true" aria-labelledby="rt-titulo">
        <div class="modal rt-modal">
            <header class="modal-head"><h2 id="rt-titulo">Rótulos adesivos</h2><button class="btn-fechar" data-fechar="modal-rotulos" aria-label="Fechar">&times;</button></header>
            <div class="modal-body">
                <div class="form-group"><label for="rt-produto">Produto</label><select id="rt-produto"></select></div>
                <div class="rt-previa"><canvas id="rt-canvas" aria-label="Prévia do rótulo" role="img"></canvas></div>
                <p class="rt-previa-nota" id="rt-previa-nota"></p>

                <details class="rt-montar" id="rt-montar">
                    <summary><span><b>Montar o rótulo deste produto</b><small id="rt-montar-resumo">Imagem, nome, validade</small></span></summary>
                    <div class="rt-montar-corpo">
                        <div class="rt-img">
                            <div class="rt-img-mini" id="rt-img-mini"></div>
                            <div class="rt-img-bts">
                                <label class="btn-outline rt-enviar"><input type="file" accept="image/*" id="rt-img-arquivo" hidden><span>Pôr imagem</span></label>
                                <button type="button" class="btn-outline" id="rt-img-banco">Banco de fotos</button>
                                <button type="button" class="btn-outline" id="rt-img-produto">Usar a foto do produto</button>
                                <button type="button" class="rt-tirar" id="rt-img-tirar">Tirar imagem</button>
                            </div>
                        </div>
                        <small class="dica-campo">Pode ser uma foto do produto, um desenho ou a sua logo. PNG com fundo transparente fica ótimo.</small>
                        <div class="form-group"><label for="rt-nome">Nome no rótulo</label><input type="text" id="rt-nome" maxlength="40" autocomplete="off"></div>
                        <div class="form-group"><label for="rt-sub">Linha de baixo (opcional)</label><input type="text" id="rt-sub" maxlength="60" autocomplete="off" placeholder="Ex.: Tomate seco artesanal · 200 g"></div>
                        <div class="grid-2">
                            <div class="form-group"><label for="rt-validade">Validade</label><select id="rt-validade">${validades}</select></div>
                            <div class="form-group"><label for="rt-borda">Borda</label><select id="rt-borda">${Object.entries(BORDAS).map(([k, n]) => `<option value="${k}">${escapeHTML(n)}</option>`).join('')}</select></div>
                        </div>
                        <label class="chk-linha"><input type="checkbox" id="rt-preco"> Mostrar o preço</label>
                        <label class="chk-linha"><input type="checkbox" id="rt-loja"> Mostrar o nome (e a logo) da loja</label>
                        <div class="rt-salvar"><span id="rt-estado" aria-live="polite"></span><button type="button" class="btn-salvar-config" id="rt-salvar">Salvar o rótulo deste produto</button></div>
                    </div>
                </details>

                <section class="rt-imprimir" aria-label="Imprimir">
                    <div class="form-group"><label for="rt-tamanho">Tamanho do adesivo</label><select id="rt-tamanho">${tamanhos}</select></div>
                    <div class="rt-qtd-linha">
                        <div class="form-group"><label for="rt-qtd">Quantos rótulos</label>
                            <div class="rt-qtd"><button type="button" data-rt-qtd="-1" aria-label="Um a menos">−</button><input type="number" id="rt-qtd" inputmode="numeric" min="1" max="${MAX_COPIAS}" value="1"><button type="button" data-rt-qtd="1" aria-label="Um a mais">+</button></div>
                        </div>
                        <div class="form-group" id="rt-pular-grupo"><label for="rt-pular">Já usadas na folha</label><input type="number" id="rt-pular" inputmode="numeric" min="0" value="0"></div>
                    </div>
                    <p class="rt-resumo" id="rt-resumo" aria-live="polite"></p>
                </section>
            </div>
            <footer class="modal-footer"><button type="button" class="bt bt-pri rt-bt-imprimir" id="rt-imprimir">Imprimir</button></footer>
        </div>
    </div>`);
    ligar();
}

const nomeDe = (p) => String((p && p.nome) || '');
function pintarProdutos(idEscolhido) {
    const lista = [...produtos].filter((p) => !p.soInsumo || p.rotulo).sort((a, b) => (b.rotulo ? 1 : 0) - (a.rotulo ? 1 : 0) || nomeDe(a).localeCompare(nomeDe(b), 'pt-BR'));
    const com = lista.filter((p) => p.rotulo), sem = lista.filter((p) => !p.rotulo);
    const op = (p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(nomeDe(p))}</option>`;
    $('rt-produto').innerHTML = (com.length ? `<optgroup label="Com rótulo salvo">${com.map(op).join('')}</optgroup>` : '') + `<optgroup label="${com.length ? 'Sem rótulo ainda' : 'Produtos'}">${sem.map(op).join('')}</optgroup>`;
    $('rt-produto').value = idEscolhido && lista.some((p) => p.id === idEscolhido) ? idEscolhido : (lista[0] || {}).id || '';
}

function escolherProduto(id) {
    atual = produtos.find((p) => p.id === id) || null;
    rotulo = atual ? rotuloSeguro(atual.rotulo || { loja: true, borda: 'feira', img: atual.foto || '' }) : rotuloSeguro({});
    if (atual && !atual.rotulo && atual.foto && /^https:\/\//.test(atual.foto)) rotulo.img = atual.foto;     // começa com a foto do produto
    gravado = atual && atual.rotulo ? JSON.stringify(rotuloSeguro(atual.rotulo)) : '';
    $('rt-nome').value = rotulo.titulo; $('rt-nome').placeholder = nomeDe(atual) || 'Nome do produto';
    $('rt-sub').value = rotulo.sub;
    $('rt-validade').value = String(rotulo.validadeDias || 0);
    $('rt-borda').value = rotulo.borda;
    $('rt-preco').checked = rotulo.preco; $('rt-loja').checked = rotulo.loja;
    $('rt-montar').open = !(atual && atual.rotulo);           // sem rótulo salvo: já abre para montar
    $('rt-img-produto').hidden = !(atual && atual.foto);
    pintarEstado(); redesenhar();
}

function lerCampos() {
    const enviando = rotulo && String(rotulo.img || '').startsWith('blob:') ? rotulo.img : '';   // imagem ainda subindo: a prévia continua com ela
    rotulo = rotuloSeguro({ ...rotulo, titulo: $('rt-nome').value, sub: $('rt-sub').value, validadeDias: Number($('rt-validade').value) || null, borda: $('rt-borda').value, preco: $('rt-preco').checked, loja: $('rt-loja').checked });
    if (enviando) rotulo.img = enviando;
}
function pintarEstado() {
    const mudou = JSON.stringify(rotulo) !== gravado;
    $('rt-estado').textContent = !atual ? '' : (mudou ? (gravado ? 'Mudanças ainda não salvas' : 'Ainda não salvo') : 'Salvo');
    $('rt-salvar').disabled = !atual || !mudou;
    const partes = [rotulo.img ? 'com imagem' : 'sem imagem', rotulo.validadeDias ? `validade ${rotulo.validadeDias} dias` : '', rotulo.preco ? 'com preço' : ''].filter(Boolean);
    $('rt-montar-resumo').textContent = partes.join(' · ');
    const mini = $('rt-img-mini');
    mini.innerHTML = rotulo.img ? `<img src="${escapeHTML(rotulo.img.startsWith('blob:') ? rotulo.img : miniatura(rotulo.img, 128))}" alt="">` : '<span>sem imagem</span>';
    $('rt-img-tirar').hidden = !rotulo.img;
    // impressão
    const tam = $('rt-tamanho').value, t = TAMANHOS[tam] || TAMANHOS[TAMANHO_PADRAO], n = copiasValidas($('rt-qtd').value);
    $('rt-pular-grupo').hidden = !t.folha;
    const folhas = t.folha ? folhasNecessarias(tam, n, Number($('rt-pular').value) || 0) : 0;
    $('rt-resumo').textContent = `${n} ${n === 1 ? 'rótulo' : 'rótulos'} de ${String(t.mm[0]).replace('.', ',')} × ${String(t.mm[1]).replace('.', ',')} mm${folhas ? ` · ${folhas} ${folhas === 1 ? 'folha' : 'folhas'} A4` : ''}${t.termica ? ' · sai em preto e branco na térmica' : ''}.`;
    $('rt-imprimir').textContent = `Imprimir ${n} ${n === 1 ? 'rótulo' : 'rótulos'}`;
    $('rt-imprimir').disabled = !atual;
}

/** Desenha o rótulo do produto escolhido no tamanho escolhido. mono = como sai na térmica. */
async function desenhar(canvas, { mono } = {}) {
    const tam = $('rt-tamanho').value, { w, h } = pixelsDo(tam);
    const c = conteudoDoRotulo(rotulo, atual || {}, { loja: loja.nome });
    const [img, logo] = await Promise.all([imagem(c.img), c.loja ? imagem(loja.logo) : null]);
    return desenharRotulo(canvas, c, { img, logo }, { w, h, mono: mono ?? !!TAMANHOS[tam].termica });
}
async function redesenhar() {
    const minha = ++desenhando;
    await prepararLetras();
    const tmp = document.createElement('canvas');
    await desenhar(tmp);
    if (minha !== desenhando) return;                      // mudou de novo enquanto desenhava: vale o mais novo
    const t = TAMANHOS[$('rt-tamanho').value];
    if (t.termica) termicaNaTela(tmp);                     // prévia já pontilhada, como sai no papel da térmica
    const cv = $('rt-canvas'); cv.width = tmp.width; cv.height = tmp.height; cv.getContext('2d').drawImage(tmp, 0, 0);
    $('rt-previa-nota').textContent = t.termica ? 'Prévia em preto e branco, como sai na térmica.' : 'Prévia no tamanho de verdade do adesivo (a cor sai na impressora comum).';
}

/** Troca o desenho pelo que a térmica vai imprimir (preto e branco pontilhado). Devolve os pontos. */
function termicaNaTela(cv) {
    const ctx = cv.getContext('2d'), dados = ctx.getImageData(0, 0, cv.width, cv.height);
    const cinza = paraCinza(dados.data, cv.width, cv.height);
    // cor clara (milho amarelo, folha verde-clara) quase some no papel térmico: escurece os tons do meio
    for (let i = 0; i < cinza.length; i++) cinza[i] = Math.round(255 * Math.pow(cinza[i] / 255, 1.8));
    const pontos = pontilhar(cinza, cv.width, cv.height);
    for (let i = 0; i < pontos.length; i++) { const v = pontos[i] ? 0 : 255; dados.data[i * 4] = dados.data[i * 4 + 1] = dados.data[i * 4 + 2] = v; dados.data[i * 4 + 3] = 255; }
    ctx.putImageData(dados, 0, 0);
    return pontos;
}

async function salvar() {
    if (!atual) return;
    lerCampos();
    const bt = $('rt-salvar'); bt.disabled = true; bt.textContent = 'Salvando...';
    try {
        if (rotulo.img && rotulo.img.startsWith('blob:')) throw Object.assign(new Error(), { amigavel: 'Espere a imagem terminar de enviar.' });
        await setDoc(tdoc('produtos', atual.id), { rotulo, ultimaModificacao: Date.now() }, { merge: true });
        atual.rotulo = rotulo; gravado = JSON.stringify(rotulo);
        showToast(`Rótulo de ${nomeDe(atual)} salvo. Da próxima vez é só dizer quantos e imprimir.`);
        const id = atual.id; pintarProdutos(id);
    } catch (e) { showToast((e && e.amigavel) || 'Não consegui salvar o rótulo. Confira a internet.', true); }
    finally { bt.textContent = 'Salvar o rótulo deste produto'; pintarEstado(); }
}

async function enviarImagem(arquivo) {
    const problema = validarArquivo(arquivo || {}); if (problema) return showToast(problema, true);
    const local = URL.createObjectURL(arquivo);
    try { imagens.set(local, await createImageBitmap(arquivo)); } catch (_) { /* a prévia espera o envio */ }
    rotulo.img = local; pintarEstado(); redesenhar();
    $('rt-estado').textContent = 'Enviando a imagem...';
    try {
        const F = await import('./admin-fotos.js');
        const otima = await F.otimizarFoto(arquivo, 800, 0.88, { transparente: true });
        const url = await F.enviarFoto(`rotulo-${atual ? atual.id : 'x'}`, otima, `-${Date.now().toString(36)}`);
        if (!/^https:\/\//.test(String(url || ''))) throw new Error('endereço não aceito');
        imagens.set(url, imagens.get(local) || null);
        if (rotulo.img === local) rotulo.img = url;
        URL.revokeObjectURL(local);
        pintarEstado(); showToast('Imagem pronta. Toque em "Salvar o rótulo deste produto".');
    } catch (e) {
        if (rotulo.img === local) delete rotulo.img;
        pintarEstado(); redesenhar();
        showToast((e && e.amigavel) || 'Não consegui enviar a imagem. Confira a internet e tente de novo.', true);
    }
}

async function imprimirAgora() {
    if (!atual) return;
    lerCampos();
    const bt = $('rt-imprimir'), tam = $('rt-tamanho').value, t = TAMANHOS[tam], n = copiasValidas($('rt-qtd').value);
    gravarPref({ tamanho: tam });
    bt.disabled = true; const antes = bt.textContent; bt.textContent = 'Preparando...';
    try {
        const I = await import('./impressao.js');
        const cv = document.createElement('canvas');
        await prepararLetras();
        if (t.termica && I.lerConfig().modo !== 'sistema') {
            await desenhar(cv, { mono: true });
            const pontos = termicaNaTela(cv);
            await I.imprimirNaTermica(rasterEscPos(pontos, cv.width, cv.height, { copias: n }));
            showToast(`${n} ${n === 1 ? 'rótulo enviado' : 'rótulos enviados'} para a térmica.`);
        } else {
            await desenhar(cv);
            const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
            if (!blob) throw new Error('não consegui gerar a imagem');
            const url = URL.createObjectURL(blob);
            await I.imprimirPagina(paginaDeRotulos(url, tam, n, { pular: Number($('rt-pular').value) || 0 }));
            setTimeout(() => URL.revokeObjectURL(url), 180000);
            showToast(t.folha ? 'Abrindo a tela de imprimir. Escolha "Tamanho real" (100%), sem ajustar à página.' : 'Abrindo a tela de imprimir. Escolha o papel do tamanho do adesivo.');
        }
    } catch (e) {
        console.error('[rotulos]', e);
        showToast(e && e.amigavel ? e.message : 'Não consegui imprimir. Confira a impressora em "Impressora", no topo do painel.', true);
    } finally { bt.disabled = false; bt.textContent = antes; pintarEstado(); }
}

let ligados = false;
function ligar() {
    if (ligados) return; ligados = true;
    $('rt-produto').addEventListener('change', (e) => escolherProduto(e.target.value));
    ['rt-nome', 'rt-sub'].forEach((id) => $(id).addEventListener('input', () => { lerCampos(); pintarEstado(); redesenhar(); }));
    ['rt-validade', 'rt-borda', 'rt-preco', 'rt-loja'].forEach((id) => $(id).addEventListener('change', () => { lerCampos(); pintarEstado(); redesenhar(); }));
    $('rt-tamanho').addEventListener('change', () => { gravarPref({ tamanho: $('rt-tamanho').value }); pintarEstado(); redesenhar(); });
    ['rt-qtd', 'rt-pular'].forEach((id) => $(id).addEventListener('input', pintarEstado));
    document.querySelectorAll('[data-rt-qtd]').forEach((b) => b.addEventListener('click', () => { $('rt-qtd').value = copiasValidas((Number($('rt-qtd').value) || 0) + Number(b.dataset.rtQtd)); pintarEstado(); }));
    $('rt-img-arquivo').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) enviarImagem(f); });
    $('rt-img-produto').addEventListener('click', () => { if (atual && atual.foto) { rotulo.img = atual.foto; pintarEstado(); redesenhar(); } });
    $('rt-img-tirar').addEventListener('click', () => { delete rotulo.img; pintarEstado(); redesenhar(); });
    $('rt-img-banco').addEventListener('click', async () => {
        try { (await import('./admin-fotos.js')).abrirBanco((f) => { if (f && /^https:\/\//.test(f.url)) { rotulo.img = f.url; pintarEstado(); redesenhar(); } }); }
        catch (_) { showToast('Não consegui abrir o banco de fotos. Confira a internet.', true); }
    });
    $('rt-salvar').addEventListener('click', salvar);
    $('rt-imprimir').addEventListener('click', imprimirAgora);
}

/** Abre a tela. lista = produtos do painel; produtoId = já escolhe esse (vindo do cadastro do produto). */
export async function abrirRotulos(lista = [], produtoId = '') {
    produtos = Array.isArray(lista) ? lista : [];
    montarModal();
    if (!loja.nome && !loja.logo) await lerLoja();
    const pref = lerPref();
    $('rt-tamanho').value = TAMANHOS[pref.tamanho] ? pref.tamanho : TAMANHO_PADRAO;
    $('rt-qtd').value = '1'; $('rt-pular').value = '0';
    pintarProdutos(produtoId);
    openModal('modal-rotulos');
    escolherProduto($('rt-produto').value);
}
