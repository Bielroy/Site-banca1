// =====================================================================
//  js/admin-vitrine.js — "Vitrine" dentro da aba Aparência do painel.
//
//  O dono põe, sem mexer em código:
//   - quadros no meio da vitrine (foto + título + recado + "Ver Frutas"):
//     como escolher, receita da semana, chegou a safra...;
//   - o bloco "Quem escolhe seu pedido" (a foto de vocês e uma frase);
//   - o nome do selo de recomendação ("Escolha da Pedrina").
//  Tudo fica em loja/config.vitrine (a loja lê ao vivo; a prévia ao lado
//  mostra assim que grava). Conferido por vitrineSegura antes de ir e de voltar.
//
//  E o quadro "Como a vitrine está indo": visitas → sacola → pedido, esta
//  semana contra a anterior (para ver o antes e depois de mudar a vitrine).
// =====================================================================
import { getDoc, setDoc } from './firebase.js';
import { tdoc } from './tenant.js';
import { escapeHTML, showToast } from './utils.js';
import { vitrineSegura, MAX_QUADROS, ESCOLHA_PADRAO, resumoFunil, ETAPAS, NOMES_ETAPAS, hojeDaLoja } from './vitrine-lib.js';
import { validarArquivo } from './fotos-lib.js';

const el = () => document.getElementById('vitrine-conteudo');
let estado = null, gravado = '', categorias = [], ligado = false, enviando = 0, funilHtml = '';
const IDEIAS = ['Como escolher manga madura', 'Receita da semana: sopa de legumes', 'Chegou a safra do morango', 'Como guardar folhas por mais tempo'];

const fotoMini = (url) => (url ? `<img src="${escapeHTML(url)}" alt="">` : '<span>sem foto</span>');
const campoFoto = (alvo, url, dica) => `
    <div class="vt-foto">
        <div class="vt-foto-mini">${fotoMini(url)}</div>
        <div class="vt-foto-bts">
            <label class="btn-outline vt-enviar"><input type="file" accept="image/*" data-foto="${alvo}" hidden><span>${url ? 'Trocar foto' : 'Pôr foto'}</span></label>
            ${url ? `<button type="button" class="vt-tirar" data-tirar-foto="${alvo}">Tirar</button>` : ''}
        </div>
        <small class="dica-campo">${dica}</small>
    </div>`;

function render() {
    const v = estado, cats = categorias.map((c) => `<option value="${escapeHTML(c.chave)}">${escapeHTML(c.nome)}</option>`).join('');
    const quadros = v.quadros.map((q, i) => `
        <fieldset class="vt-quadro" data-i="${i}">
            <legend>Quadro ${i + 1} <small>entra depois do ${6 + 8 * i}º produto</small></legend>
            ${campoFoto(`q${i}`, q.img, 'Foto deitada fica melhor. Pode ser da banca, de uma receita, da safra.')}
            <div class="form-group"><label>Título</label><input type="text" maxlength="50" data-q="${i}" data-campo="titulo" value="${escapeHTML(q.titulo || '')}" placeholder="${escapeHTML(IDEIAS[i % IDEIAS.length])}"></div>
            <div class="form-group"><label>Recado (até 160 letras)</label><textarea rows="2" maxlength="160" data-q="${i}" data-campo="texto" placeholder="Ex.: aperte de leve; se ceder um pouquinho, está no ponto.">${escapeHTML(q.texto || '')}</textarea></div>
            <div class="form-group"><label>Botão para uma categoria (opcional)</label><select data-q="${i}" data-campo="cat"><option value="">Sem botão</option>${cats}</select></div>
            <button type="button" class="vt-remover" data-remover="${i}">Tirar este quadro</button>
        </fieldset>`).join('');
    el().innerHTML = `
    <section class="vt">
        <header class="vt-cab">
            <h3 class="ap-titulo">Vitrine: quadros e fotos</h3>
            <p class="config-sub">Imagens e recados no meio dos produtos, e a cara de quem escolhe o pedido. Aparecem na loja (e na prévia acima) quando você tocar em <b>Gravar a vitrine</b>.</p>
        </header>

        <details class="ap-sec vt-sec" open>
            <summary><span><b>Quem escolhe seu pedido</b><small>A foto de vocês e uma frase. Gente de verdade passa confiança.</small></span></summary>
            <div class="ap-sec-corpo">
                ${campoFoto('donos', v.donos.img, 'Sem foto, entra o desenho do caixote. Uma foto de vocês na banca funciona muito bem.')}
                <div class="form-group"><label for="vt-donos-titulo">Nome</label><input id="vt-donos-titulo" type="text" maxlength="50" data-donos="titulo" value="${escapeHTML(v.donos.titulo || '')}" placeholder="Ex.: Adair e Pedrina"></div>
                <div class="form-group"><label for="vt-donos-texto">Frase (até 200 letras)</label><textarea id="vt-donos-texto" rows="2" maxlength="200" data-donos="texto" placeholder="Ex.: Há 20 anos na feira. Escolhemos cada item como se fosse para a nossa casa.">${escapeHTML(v.donos.texto || '')}</textarea></div>
                <small class="dica-campo">Deixe o nome em branco para não mostrar este bloco.</small>
            </div>
        </details>

        <details class="ap-sec vt-sec" open>
            <summary><span><b>Quadros no meio da vitrine</b><small>Até ${MAX_QUADROS}. Dica de como escolher, receita, safra.</small></span></summary>
            <div class="ap-sec-corpo">
                ${quadros || '<p class="config-sub">Nenhum quadro ainda.</p>'}
                ${v.quadros.length < MAX_QUADROS ? '<button type="button" class="btn-outline vt-mais" data-acao-vt="mais">+ Novo quadro</button>' : ''}
                <small class="dica-campo">Quadro sem título não aparece. Um ou dois quadros bastam: mais que isso vira propaganda e atrapalha quem quer comprar rápido.</small>
            </div>
        </details>

        <details class="ap-sec vt-sec">
            <summary><span><b>Nome do selo de recomendação</b><small>O selo que você marca nos produtos que recomenda</small></span></summary>
            <div class="ap-sec-corpo">
                <div class="form-group"><label for="vt-escolha">Nome do selo</label><input id="vt-escolha" type="text" maxlength="24" data-escolha value="${escapeHTML(v.escolha || '')}" placeholder="${ESCOLHA_PADRAO}"></div>
                <small class="dica-campo">Ex.: "Escolha da Pedrina". Marque o selo no cadastro de cada produto (Produtos → abrir o produto → Selos na loja).</small>
            </div>
        </details>

        <div class="vt-gravar"><span id="vt-estado" aria-live="polite"></span><button type="button" class="btn-salvar-config" id="vt-gravar">Gravar a vitrine</button></div>

        <section class="vt-funil" id="vt-funil" aria-live="polite">${funilHtml || '<p class="config-sub">Carregando os números da vitrine...</p>'}</section>
    </section>`;
    el().querySelectorAll('select[data-q]').forEach((s) => { s.value = (v.quadros[Number(s.dataset.q)] || {}).cat || ''; });
    pintarEstado();
}

// compara o que está na tela (não o conferido): título digitado num quadro novo já conta como mudança
const atual = () => JSON.stringify(estado);
function pintarEstado() {
    const pendente = atual() !== gravado, est = document.getElementById('vt-estado');
    if (est) est.textContent = enviando ? 'Enviando foto...' : (pendente ? 'Mudanças ainda não gravadas' : 'Tudo gravado');
    document.getElementById('vt-gravar')?.toggleAttribute('disabled', !pendente || !!enviando);
}

async function enviarFoto(alvo, arquivo) {
    const problema = validarArquivo(arquivo || {}); if (problema) return showToast(problema, true);
    enviando++; pintarEstado();
    try {
        const F = await import('./admin-fotos.js');
        const otima = await F.otimizarFoto(arquivo, 1000, 0.82);
        const url = await F.enviarFoto('vitrine', otima, `-${Date.now().toString(36)}`);
        if (!/^https:\/\//.test(String(url || ''))) throw new Error('endereço não aceito');
        if (alvo === 'donos') estado.donos.img = url; else { const q = estado.quadros[Number(alvo.slice(1))]; if (q) q.img = url; }
        render();
        showToast('Foto pronta. Toque em "Gravar a vitrine".');
    } catch (e) { showToast((e && e.amigavel) || 'Não consegui enviar a foto. Confira a internet e tente de novo.', true); }
    finally { enviando--; pintarEstado(); }
}

async function gravar() {
    const bt = document.getElementById('vt-gravar'); if (!bt || bt.disabled) return;
    const incompleto = estado.quadros.findIndex((q) => String(q.titulo || '').trim() && !q.img && !String(q.texto || '').trim());
    if (incompleto > -1) return showToast(`O quadro ${incompleto + 1} precisa de uma foto ou de um recado.`, true);
    const semTitulo = estado.quadros.findIndex((q) => !String(q.titulo || '').trim() && (q.img || String(q.texto || '').trim()));
    if (semTitulo > -1) return showToast(`Dê um título ao quadro ${semTitulo + 1} (sem título ele não aparece).`, true);
    const limpo = vitrineSegura(estado);
    bt.disabled = true; bt.textContent = 'Gravando...';
    try {
        // mergeFields: troca a "vitrine" inteira (quadro tirado some de verdade) sem mexer no resto da configuração
        await setDoc(tdoc('loja', 'config'), { vitrine: limpo }, { mergeFields: ['vitrine'] });
        gravado = atual();
        showToast('Vitrine gravada. Os clientes já veem.');
    } catch (e) { showToast('Não consegui gravar. Confira a internet e tente de novo.', true); }
    finally { bt.textContent = 'Gravar a vitrine'; pintarEstado(); }
}

function ligar() {
    if (ligado) return; ligado = true;
    const raiz = el();
    raiz.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.q !== undefined) { const q = estado.quadros[Number(t.dataset.q)]; if (q) q[t.dataset.campo] = t.value; }
        else if (t.dataset.donos) estado.donos[t.dataset.donos] = t.value;
        else if (t.hasAttribute('data-escolha')) estado.escolha = t.value;
        pintarEstado();
    });
    raiz.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.foto && t.files && t.files[0]) enviarFoto(t.dataset.foto, t.files[0]);
        else if (t.tagName === 'SELECT' && t.dataset.q !== undefined) { const q = estado.quadros[Number(t.dataset.q)]; if (q) q.cat = t.value; pintarEstado(); }
    });
    raiz.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.id === 'vt-gravar') return gravar();
        if (b.dataset.acaoVt === 'mais' && estado.quadros.length < MAX_QUADROS) { estado.quadros.push({ titulo: '', texto: '', cat: '' }); render(); return; }
        if (b.dataset.remover !== undefined) { estado.quadros.splice(Number(b.dataset.remover), 1); render(); return; }
        if (b.dataset.tirarFoto) { const a = b.dataset.tirarFoto; if (a === 'donos') delete estado.donos.img; else delete (estado.quadros[Number(a.slice(1))] || {}).img; render(); }
    });
}

// ---------------------------------------------------------------------
// COMO A VITRINE ESTÁ INDO (contagem feita pela loja: js/loja.js, contarFunil)
// ---------------------------------------------------------------------
const mesAnterior = (mes) => { const [a, m] = mes.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
async function pintarFunil() {
    const caixa = document.getElementById('vt-funil'); if (!caixa) return;
    const hoje = hojeDaLoja(), meses = [hoje.slice(0, 7), mesAnterior(hoje.slice(0, 7))], dias = {};
    try {
        const docs = await Promise.all(meses.map((m) => getDoc(tdoc('analytics', `funil-${m}`)).catch(() => null)));
        docs.forEach((d, i) => { const ds = d && d.exists() ? (d.data().dias || {}) : {}; for (const [dd, v] of Object.entries(ds)) dias[`${meses[i]}-${dd}`] = v; });
    } catch (_) { /* sem números: mostra zerado */ }
    const r = resumoFunil(dias, hoje);
    const pct = (x) => (x === null ? '–' : `${String(x).replace('.', ',')}%`);
    const linha = (e) => `<tr><th scope="row">${NOMES_ETAPAS[e]}</th><td>${r.semana[e]}</td><td>${r.anterior[e]}</td></tr>`;
    funilHtml = `
        <h4>Como a vitrine está indo</h4>
        <p class="config-sub">Cada celular conta uma vez por dia. Sem nome nem telefone: só a quantidade.</p>
        <table class="vt-tabela">
            <thead><tr><th></th><th>Últimos 7 dias</th><th>7 dias antes</th></tr></thead>
            <tbody>${ETAPAS.map(linha).join('')}</tbody>
            <tfoot>
                <tr><th scope="row">De cada 100 visitas, puseram na sacola</th><td>${pct(r.semana.txSacola)}</td><td>${pct(r.anterior.txSacola)}</td></tr>
                <tr><th scope="row">De cada 100 visitas, pediram</th><td>${pct(r.semana.txPedido)}</td><td>${pct(r.anterior.txPedido)}</td></tr>
            </tfoot>
        </table>
        <small class="dica-campo">${r.poucos ? 'Ainda são poucas visitas: diferença pequena pode ser acaso. ' : ''}Mudou a vitrine (fotos, selos, quadros)? Compare por <b>2 semanas</b> antes de decidir, e lembre que semana de pagamento vende mais.</small>`;
    caixa.innerHTML = funilHtml;          // guardado: redesenhar o bloco (novo quadro, foto) não apaga os números
}

/** Abre o bloco. `cats` = [{ chave, nome }] das categorias com produto. */
export async function abrirVitrine(cats = []) {
    if (!el()) return;
    categorias = cats;
    if (estado) { pintarFunil(); return; }
    el().innerHTML = '<p class="config-sub">Carregando a vitrine...</p>';
    let cfg = {};
    try { const s = await getDoc(tdoc('loja', 'config')); if (s.exists()) cfg = s.data() || {}; }
    catch (_) { el().innerHTML = '<p class="config-sub">Não consegui ler a vitrine. Confira a internet e abra a aba de novo.</p>'; return; }
    const v = vitrineSegura(cfg.vitrine);
    estado = { quadros: v.quadros.map((q) => ({ cat: '', ...q })), donos: { titulo: '', texto: '', ...(v.donos || {}) }, escolha: v.escolha || '' };
    gravado = atual();
    render(); ligar(); pintarFunil();
}
