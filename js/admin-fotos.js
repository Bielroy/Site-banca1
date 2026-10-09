// =====================================================================
//  js/admin-fotos.js — ENVIAR VÁRIAS FOTOS DE UMA VEZ (aba Produtos).
//
//  Para cada foto escolhida:
//    confere o arquivo → reduz para no máximo 1000 px → converte para WebP
//    (JPG onde o navegador não gera WebP) → envia para o ImgBB (ou, sem ele,
//    para o Firebase Storage) →
//    grava o endereço no produto.
//  Cada linha mostra o progresso e o ganho ("2,4 MB → 180 KB"). Se o envio
//  cair, tenta mais duas vezes sozinho; se ainda falhar, aparece "Tentar de novo".
//
//  O produto de cada foto é adivinhado pelo NOME DO ARQUIVO e pode ser
//  trocado na lista antes de enviar.
// =====================================================================
import { setDoc, getDoc } from './firebase.js';
import { storage, ref, uploadBytes, getDownloadURL } from './firebase-arquivos.js';
import { tdoc, pastaFotos } from './tenant.js';
import { escapeHTML, showToast, openModal, closeModal } from './utils.js';
import { validarArquivo, produtoParecido, tamanhoBonito, comTentativas, emFila } from './fotos-lib.js';

/** Reduz e converte. Devolve { blob, ext }. Usada também pelo cadastro de um produto só. */
// transparente: true mantém o fundo transparente (logo em PNG). Só dá em WebP; sem WebP, vira JPG com fundo branco.
export async function otimizarFoto(file, lado = 1000, qualidade = 0.82, { transparente = false } = {}) {
    let fonte = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!fonte) {
        fonte = await new Promise((ok, falha) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => falha(new Error('imagem inválida')); img.src = URL.createObjectURL(file); });
    }
    let w = fonte.width, h = fonte.height;
    if (!w || !h) throw new Error('imagem inválida');
    const escala = Math.min(1, lado / Math.max(w, h)); w = Math.round(w * escala); h = Math.round(h * escala);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const desenhar = (comFundo) => { ctx.clearRect(0, 0, w, h); if (comFundo) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); } ctx.drawImage(fonte, 0, 0, w, h); };   // PNG transparente ganha fundo branco
    desenhar(!transparente);
    const gerar = (tipo) => new Promise((r) => canvas.toBlob(r, tipo, qualidade));
    let blob = await gerar('image/webp');
    if (!blob || blob.type !== 'image/webp') { if (transparente) desenhar(true); blob = await gerar('image/jpeg'); }   // navegador sem WebP
    fonte.close?.();
    if (!blob) throw new Error('não consegui converter a imagem');
    return { blob, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
}

/** Envia a foto já otimizada e devolve o endereço público. O nome leva um sufixo para o navegador não mostrar a foto antiga guardada. */
// 1º caminho: ImgBB, pelo nosso servidor (a chave fica lá). É o que funciona sem pagar o Storage do Firebase.
// Se o ImgBB não estiver ligado na plataforma, cai no Storage, como era antes.
const emBase64 = (blob) => new Promise((ok, falha) => { const l = new FileReader(); l.onload = () => ok(String(l.result).split(',')[1] || ''); l.onerror = () => falha(new Error('não consegui ler a foto')); l.readAsDataURL(blob); });
let _semImgbb = false;
async function enviarAoImgbb(produtoId, blob, sufixo) {
    const r = await fetch('/api/foto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagem: await emBase64(blob), nome: `${produtoId}${sufixo}` }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 503 && d.codigo === 'sem-imgbb') { _semImgbb = true; return null; }
    if (!r.ok || !d.url) throw Object.assign(new Error(d.error || 'O envio caiu.'), { amigavel: d.error || '', definitivo: r.status === 400 || r.status === 403 });
    return d.url;
}
export async function enviarFoto(produtoId, { blob, ext }, sufixo = '') {
    if (!_semImgbb) { const url = await enviarAoImgbb(produtoId, blob, sufixo); if (url) return url; }
    const caminho = `${pastaFotos()}/${produtoId}-${Date.now().toString(36)}${sufixo}.${ext}`;
    const r = ref(storage, caminho);
    await uploadBytes(r, blob, { contentType: blob.type, cacheControl: 'public, max-age=31536000, immutable' });
    return getDownloadURL(r);
}

/** As duas versões de uma foto: grande (tela do produto) e miniatura (cards da vitrine: carrega bem mais rápido no 4G). */
export async function otimizarFotos(file) { return { grande: await otimizarFoto(file, 1000, 0.82), mini: await otimizarFoto(file, 400, 0.78) }; }
export async function enviarOtimizadas(produtoId, o, nome = '') {
    const [foto, fotoMini] = await Promise.all([enviarFoto(produtoId, o.grande), enviarFoto(produtoId, o.mini, '-m')]);
    guardarNoBanco({ url: foto, mini: fotoMini, nome });          // toda foto enviada fica também no banco de fotos da loja
    return { foto, fotoMini };
}

// ---------------------------------------------------------------------
// BANCO DE FOTOS da loja: tudo o que já foi enviado, para escolher depois
// na tela de cada produto, sem enviar de novo nem copiar link.
// Fica em loja/fotos (uma lista com o link, a miniatura e o nome do arquivo).
// ---------------------------------------------------------------------
const MAX_BANCO = 300;
export async function lerBanco() {
    const s = await getDoc(tdoc('loja', 'fotos'));
    const itens = s.exists() && Array.isArray(s.data().itens) ? s.data().itens : [];
    return itens.filter((f) => f && /^https:\/\//.test(String(f.url || '')));
}
// as fotos sobem 3 de cada vez; a lista é gravada uma por vez, em fila, para uma não apagar a outra
let filaBanco = Promise.resolve();
function mexerNoBanco(mudar) {
    filaBanco = filaBanco.then(async () => {
        const itens = mudar(await lerBanco()).slice(0, MAX_BANCO);
        await setDoc(tdoc('loja', 'fotos'), { itens, em: Date.now() }, { merge: true });
    }).catch((e) => console.warn('[banco de fotos]', e && (e.code || e.message)));
    return filaBanco;
}
const guardarNoBanco = (f) => mexerNoBanco((itens) => [{ url: f.url, mini: f.mini || '', nome: String(f.nome || '').slice(0, 80), em: Date.now() }, ...itens.filter((x) => x.url !== f.url)]);

/** Abre o banco de fotos para escolher uma. `aoEscolher({ url, mini, nome })` é chamado com a foto tocada. */
export async function abrirBanco(aoEscolher) {
    if (!$('modal-banco-fotos')) {
        document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="modal-banco-fotos" role="dialog" aria-modal="true" aria-labelledby="banco-titulo">
            <div class="modal modal-lg">
                <header class="modal-head"><h2 id="banco-titulo">Banco de fotos</h2><button class="btn-fechar" data-fechar="modal-banco-fotos" aria-label="Fechar">&times;</button></header>
                <div class="modal-body"><p class="config-sub" id="banco-dica"></p><div id="banco-grade" class="banco-grade"></div></div>
            </div>
        </div>`);
        $('modal-banco-fotos').addEventListener('click', async (e) => {
            if (e.target.closest('[data-fechar]')) return closeModal('modal-banco-fotos');
            const tirar = e.target.closest('[data-tirar]'), foto = e.target.closest('[data-foto]');
            if (tirar) { e.stopPropagation(); const url = tirar.dataset.tirar; await mexerNoBanco((itens) => itens.filter((x) => x.url !== url)); return pintarBanco(); }
            if (foto && $('modal-banco-fotos')._escolher) { const f = ($('modal-banco-fotos')._itens || []).find((x) => x.url === foto.dataset.foto); closeModal('modal-banco-fotos'); if (f) $('modal-banco-fotos')._escolher(f); }
        });
    }
    $('modal-banco-fotos')._escolher = aoEscolher;
    $('banco-grade').innerHTML = ''; $('banco-dica').textContent = 'Carregando as fotos...';
    openModal('modal-banco-fotos');
    await pintarBanco();
}
async function pintarBanco() {
    let itens = [];
    try { await filaBanco; itens = await lerBanco(); } catch (e) { $('banco-dica').textContent = 'Não consegui abrir o banco de fotos. Confira a internet.'; return; }
    $('modal-banco-fotos')._itens = itens;
    $('banco-dica').textContent = itens.length ? 'Toque na foto para usar neste produto.' : 'Ainda não há fotos aqui. Feche, toque em "Enviar várias fotos" na lista de produtos, escolha as fotos e envie: elas ficam guardadas neste banco.';
    $('banco-grade').innerHTML = itens.map((f) => `
        <div class="banco-item">
            <button type="button" class="banco-foto" data-foto="${escapeHTML(f.url)}" aria-label="Usar a foto ${escapeHTML(f.nome || '')}"><img src="${escapeHTML(f.mini || f.url)}" alt="" loading="lazy"></button>
            <span class="banco-nome">${escapeHTML(f.nome || 'sem nome')}</span>
            <button type="button" class="banco-tirar" data-tirar="${escapeHTML(f.url)}" aria-label="Tirar do banco de fotos">&times;</button>
        </div>`).join('');
}
/** Atalho usado pelo cadastro de um produto só. */
export const enviarFotos = async (produtoId, file) => enviarOtimizadas(produtoId, await otimizarFotos(file), file && file.name);

let linhas = [], produtos = [], enviando = false, seq = 0;
const $ = (id) => document.getElementById(id);

function garantirModal() {
    if ($('modal-fotos')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-fotos" role="dialog" aria-modal="true" aria-labelledby="fotos-titulo">
        <div class="modal modal-lg">
            <header class="modal-head"><h2 id="fotos-titulo">Enviar várias fotos</h2><button class="btn-fechar" data-fechar="modal-fotos" aria-label="Fechar">&times;</button></header>
            <div class="modal-body">
                <p class="config-sub">Escolha as fotos. O sistema reduz, converte e envia cada uma. Foto com produto marcado já entra no produto. Foto sem produto vai para o banco de fotos, e você escolhe depois, na tela de cada produto.</p>
                <input type="file" id="fotos-arquivos" accept="image/*" multiple class="sr-only">
                <label for="fotos-arquivos" class="ft-escolher">Escolher fotos</label>
                <div id="fotos-lista" class="ft-lista" aria-live="polite"></div>
            </div>
            <footer class="modal-footer"><button class="btn-salvar-config" id="fotos-enviar" disabled>Enviar</button></footer>
        </div>
    </div>`);
    $('fotos-arquivos').addEventListener('change', (e) => { adicionar([...e.target.files]); e.target.value = ''; });
    $('fotos-enviar').addEventListener('click', enviarTodas);
    $('fotos-lista').addEventListener('change', (e) => { const l = linhas.find((x) => x.id === Number(e.target.dataset.linha)); if (l) { l.produtoId = e.target.value; pintar(); } });
    $('fotos-lista').addEventListener('click', (e) => {
        const b = e.target.closest('[data-acao]'); if (!b) return;
        const l = linhas.find((x) => x.id === Number(b.dataset.linha)); if (!l) return;
        if (b.dataset.acao === 'tirar') { URL.revokeObjectURL(l.previa); linhas = linhas.filter((x) => x !== l); pintar(); }
        if (b.dataset.acao === 'repetir') processar(l).then(resumo);
    });
}

function adicionar(arquivos) {
    const usados = new Set(linhas.map((l) => l.produtoId).filter(Boolean));
    for (const f of arquivos.slice(0, 60)) {
        const erro = validarArquivo(f);
        const parecido = erro ? null : produtoParecido(f.name, produtos.filter((p) => !usados.has(p.id)));
        if (parecido) usados.add(parecido.id);
        const l = { id: ++seq, file: f, previa: erro ? '' : URL.createObjectURL(f), estado: erro ? 'erro' : 'pronta', msg: erro, produtoId: parecido ? parecido.id : '', antes: f.size, depois: 0, otimizada: null };
        linhas.push(l);
        if (l.previa) {          // arquivo corrompido: descobre já, antes de a pessoa escolher o produto
            const teste = new Image();
            teste.onerror = () => { if (l.estado !== 'pronta') return; URL.revokeObjectURL(l.previa); l.previa = ''; l.estado = 'erro'; l.msg = 'Arquivo corrompido ou em formato que o navegador não abre.'; l.produtoId = ''; pintar(); };
            teste.src = l.previa;
        }
    }
    if (arquivos.length > 60) showToast('Envie até 60 fotos por vez. As demais ficaram de fora.', true);
    pintar();
}

const ROTULO = { pronta: '', reduzindo: 'Reduzindo...', enviando: 'Enviando...', salvando: 'Gravando...', feito: 'Otimizado', erro: '' };
function pintar() {
    const ops = (sel) => `<option value="">Escolha o produto</option>` + produtos.map((p) => `<option value="${escapeHTML(p.id)}"${p.id === sel ? ' selected' : ''}>${escapeHTML(p.nome)}</option>`).join('');
    $('fotos-lista').innerHTML = linhas.map((l) => `
        <div class="ft-linha ft-${l.estado}">
            <div class="ft-mini">${l.previa ? `<img src="${l.previa}" alt="">` : ''}</div>
            <div class="ft-meio">
                <span class="ft-nome">${escapeHTML(l.file.name)}</span>
                ${l.estado === 'feito' || l.estado === 'erro' && !l.previa ? '' : `<select data-linha="${l.id}" aria-label="Produto desta foto"${enviando ? ' disabled' : ''}>${ops(l.produtoId)}</select>`}
                <span class="ft-status">${l.estado === 'feito' ? `${tamanhoBonito(l.antes)} → ${tamanhoBonito(l.depois)} · ${l.noBanco ? 'No banco de fotos' : 'No produto e no banco de fotos'}` : l.estado === 'erro' ? escapeHTML(l.msg) : ROTULO[l.estado] || tamanhoBonito(l.antes)}</span>
            </div>
            ${l.estado === 'erro' && l.previa ? `<button type="button" class="btn-outline ft-btn" data-acao="repetir" data-linha="${l.id}">Tentar de novo</button>` : ''}
            ${['pronta', 'erro'].includes(l.estado) && !enviando ? `<button type="button" class="ft-tirar" data-acao="tirar" data-linha="${l.id}" aria-label="Tirar da lista">&times;</button>` : ''}
        </div>`).join('');
    const prontas = linhas.filter((l) => l.estado === 'pronta').length;
    const semProduto = linhas.filter((l) => l.estado === 'pronta' && !l.produtoId).length;
    const b = $('fotos-enviar');
    b.disabled = enviando || !prontas;
    b.textContent = enviando ? 'Enviando...' : prontas ? `Enviar ${prontas} foto${prontas > 1 ? 's' : ''}${semProduto ? ` (${semProduto === prontas ? 'todas' : semProduto} para o banco de fotos)` : ''}` : 'Enviar';
}

async function processar(l) {
    try {
        if (!l.otimizada) {
            l.estado = 'reduzindo'; pintar();
            l.otimizada = await otimizarFotos(l.file).catch(() => { throw Object.assign(new Error('Arquivo corrompido ou em formato que o navegador não abre.'), { definitivo: true }); });
            l.depois = l.otimizada.grande.blob.size;
        }
        l.estado = 'enviando'; pintar();
        // sem produto marcado, a foto vai só para o banco de fotos (o nome do arquivo ajuda a achar depois)
        const urls = await comTentativas(() => enviarOtimizadas(l.produtoId || 'banco', l.otimizada, l.file.name));
        l.noBanco = !l.produtoId;
        if (l.produtoId) {
            l.estado = 'salvando'; pintar();
            await comTentativas(() => setDoc(tdoc('produtos', l.produtoId), { ...urls, ultimaModificacao: Date.now() }, { merge: true }));
        }
        await filaBanco;
        l.estado = 'feito'; l.msg = '';
    } catch (e) {
        l.estado = 'erro';
        const semLugar = e && /unauthorized|permission|storage\//.test(e.code || '');
        l.msg = e.definitivo ? e.message
            : e.amigavel ? e.amigavel
            : semLugar ? 'Não há onde guardar a foto. Peça ao dono da plataforma para colar a chave do ImgBB na tela Plataforma.'
            : 'O envio caiu. Confira a internet e toque em Tentar de novo.';
        if (e.definitivo) { URL.revokeObjectURL(l.previa); l.previa = ''; }
    }
    pintar();
}

function resumo() {
    const ok = linhas.filter((l) => l.estado === 'feito').length, ruins = linhas.filter((l) => l.estado === 'erro').length;
    if (ok || ruins) showToast(ruins ? `${ok} enviada(s), ${ruins} com problema.` : `${ok} foto(s) enviada(s).`, !!ruins);
}

async function enviarTodas() {
    if (enviando) return;
    const fila = linhas.filter((l) => l.estado === 'pronta');
    // duas fotos para o mesmo produto: vale a última da lista; avisa as outras
    const ultimo = new Map(); fila.forEach((l) => { if (l.produtoId) ultimo.set(l.produtoId, l); });
    enviando = true; pintar();
    await emFila(fila, 3, async (l) => {
        if (l.produtoId && ultimo.get(l.produtoId) !== l) { l.estado = 'erro'; l.msg = 'Outra foto desta lista é do mesmo produto. Esta não foi enviada.'; l.previa && URL.revokeObjectURL(l.previa); l.previa = ''; pintar(); return; }
        await processar(l);
    });
    enviando = false; pintar(); resumo();
}

export function abrirFotos(listaProdutos) {
    garantirModal();
    produtos = [...listaProdutos].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    linhas.forEach((l) => l.previa && URL.revokeObjectURL(l.previa)); linhas = [];
    pintar(); openModal('modal-fotos');
}
