// =====================================================================
//  js/admin-aparencia.js — aba "🎨 Aparência" do painel.
//
//  O dono escolhe nome, cores, fontes e cantos da PRÓPRIA loja e vê o
//  resultado na hora, numa prévia. Ao gravar, a loja muda para todos os
//  clientes — sem mexer em código. Os valores ficam em tenants/{loja}.tema
//  e são aplicados por js/tema.js (o mesmo arquivo desenha a prévia).
// =====================================================================
import { getDoc, setDoc } from './firebase.js';
import { fichaRef, TENANT, urlDaLoja } from './tenant.js';
import { escapeHTML, showToast } from './utils.js';
import { aplicarTema, FONTES, MODELOS, FOTO_FORMATOS } from './tema.js';

const CORES = [
    ['primaria', 'Cor principal', 'Cabeçalho e botões'],
    ['secundaria', 'Cor secundária', 'Detalhes e item no pedido'],
    ['destaque', 'Cor de destaque', 'Barra do pedido mínimo, avisos'],
    ['fundo', 'Fundo da página', ''],
    ['superficie', 'Fundo dos cards', ''],
    ['texto', 'Cor do texto', ''],
    ['sobrePrimaria', 'Texto sobre a cor principal', 'Quase sempre branco'],
];
let tema = { ...MODELOS.hortifruti }, carregado = false;
const el = () => document.getElementById('aparencia-conteudo');
const $ = (id) => document.getElementById(id);

// Contraste entre duas cores (regra de acessibilidade WCAG): abaixo de 4,5 o texto fica difícil de ler.
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const opcoes = (lista, atual) => Object.keys(lista).map((n) => `<option value="${escapeHTML(n)}"${n === atual ? ' selected' : ''}>${escapeHTML(n)}</option>`).join('');

function pintarPrevia() {
    const p = $('ap-previa'); if (!p) return;
    aplicarTema(tema, p);
    $('ap-previa-nome').textContent = $('ap-nome').value.trim() || 'Nome da loja';
    $('ap-previa-sub').textContent = $('ap-subtitulo').value.trim() || 'Frase curta da loja';
    const avisos = [];
    if (contraste(tema.primaria, tema.sobrePrimaria) < 4.5) avisos.push('O texto sobre a cor principal está difícil de ler. Clareie um ou escureça o outro.');
    if (contraste(tema.superficie, tema.texto) < 4.5) avisos.push('O texto está com pouco contraste sobre o fundo dos cards.');
    if (contraste(tema.fundo, tema.texto) < 4.5) avisos.push('O texto está com pouco contraste sobre o fundo da página.');
    $('ap-avisos').innerHTML = avisos.map((a) => `<p>${escapeHTML(a)}</p>`).join('');
}

function render(ficha) {
    el().innerHTML = `
    <h3 class="ap-titulo">Aparência da loja</h3>
    <p class="config-sub">Mude e veja na hora. Só vai para os clientes quando você tocar em Gravar.</p>
    <div class="ap-grade">
        <div class="ap-form">
            <div class="form-group"><label for="ap-nome">Nome da loja</label><input type="text" id="ap-nome" maxlength="60" value="${escapeHTML(ficha.nome || '')}"></div>
            <div class="form-group"><label for="ap-subtitulo">Frase abaixo do nome</label><input type="text" id="ap-subtitulo" maxlength="80" value="${escapeHTML(ficha.subtitulo || '')}" placeholder="Ex.: Na brasa, de quinta a domingo"></div>
            <div class="form-group"><label>Começar de um modelo</label>
                <div class="ap-modelos">
                    <button type="button" class="btn-outline" data-modelo="hortifruti">Hortifruti</button>
                    <button type="button" class="btn-outline" data-modelo="espetinhos">Espetinhos</button>
                    <button type="button" class="btn-outline" data-modelo="jantinha">Jantinha</button>
                </div>
            </div>
            <div class="ap-cores">${CORES.map(([k, rot, dica]) => `
                <label class="ap-cor"><input type="color" id="ap-cor-${k}" data-cor="${k}" value="${tema[k]}"><span><b>${rot}</b>${dica ? `<small>${dica}</small>` : ''}</span></label>`).join('')}
            </div>
            <div class="grid-2">
                <div class="form-group"><label for="ap-fonte-titulo">Letra dos títulos</label><select id="ap-fonte-titulo">${opcoes(FONTES.titulo, tema.fonteTitulo)}</select></div>
                <div class="form-group"><label for="ap-fonte-texto">Letra do texto</label><select id="ap-fonte-texto">${opcoes(FONTES.texto, tema.fonteTexto)}</select></div>
            </div>
            <div class="form-group"><label for="ap-raio">Cantos: <span id="ap-raio-valor"></span></label><input type="range" id="ap-raio" min="0" max="24" step="1" value="${tema.raio}"></div>
            <div class="form-group"><label for="ap-etiqueta">Etiqueta de preço</label>
                <select id="ap-etiqueta"><option value="barbante"${tema.etiqueta !== 'limpa' ? ' selected' : ''}>De feira, com barbante</option><option value="limpa"${tema.etiqueta === 'limpa' ? ' selected' : ''}>Limpa</option></select>
            </div>
            <div class="grid-2">
                <div class="form-group"><label for="ap-foto-formato">Formato da foto do produto</label><select id="ap-foto-formato">${Object.entries(FOTO_FORMATOS).map(([k, [rot]]) => `<option value="${k}"${(tema.fotoFormato || 'quadrada') === k ? ' selected' : ''}>${rot}</option>`).join('')}</select></div>
                <div class="form-group"><label for="ap-foto-encaixe">Como a foto se encaixa</label><select id="ap-foto-encaixe"><option value="preencher"${tema.fotoEncaixe !== 'inteira' ? ' selected' : ''}>Preenche a área (corta as sobras)</option><option value="inteira"${tema.fotoEncaixe === 'inteira' ? ' selected' : ''}>Aparece inteira (sem cortar)</option></select></div>
            </div>
            <small class="dica-campo">Fotos tiradas em pé (pão no saco, garrafa, pote) ficam melhores em "Em pé". Vale para todos os produtos da loja.</small>
            <div id="ap-avisos" class="ap-avisos" aria-live="polite"></div>
            <button class="btn-salvar-config" id="ap-gravar">Gravar aparência</button>
            <p class="dica-campo">Sua loja: <a href="${urlDaLoja(TENANT)}" target="_blank" rel="noopener">abrir em outra aba</a></p>
        </div>
        <div class="ap-previa" id="ap-previa" aria-label="Prévia da loja">
            <div class="ap-p-topo"><strong id="ap-previa-nome"></strong><span id="ap-previa-sub"></span><em>Meus pedidos</em></div>
            <div class="ap-p-corpo">
                <div class="ap-p-card">
                    <div class="ap-p-foto"></div>
                    <b>Produto de exemplo</b>
                    <div class="ap-p-etq"><strong>R$ 8,90</strong> <small>a unidade</small></div>
                    <span class="ap-p-botao">Adicionar</span>
                </div>
                <div class="ap-p-card ap-p-card--no-pedido">
                    <div class="ap-p-foto"></div>
                    <b>Já no pedido</b>
                    <div class="ap-p-etq"><strong>R$ 4,50</strong> <small>o maço</small></div>
                    <span class="ap-p-seletor"><i>−</i>2 un<i>+</i></span>
                </div>
            </div>
            <div class="ap-p-barra">Ver pedido <span>R$ 22,30</span></div>
        </div>
    </div>`;
    $('ap-raio-valor').textContent = `${tema.raio}px`;
    pintarPrevia();
}

function ligar() {
    const raiz = el();
    raiz.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.cor) tema[t.dataset.cor] = t.value;
        else if (t.id === 'ap-raio') { tema.raio = Number(t.value); $('ap-raio-valor').textContent = `${tema.raio}px`; }
        else if (t.id === 'ap-fonte-titulo') tema.fonteTitulo = t.value;
        else if (t.id === 'ap-fonte-texto') tema.fonteTexto = t.value;
        else if (t.id === 'ap-etiqueta') tema.etiqueta = t.value;
        else if (t.id === 'ap-foto-formato') tema.fotoFormato = t.value;
        else if (t.id === 'ap-foto-encaixe') tema.fotoEncaixe = t.value;
        pintarPrevia();
    });
    raiz.addEventListener('click', async (e) => {
        const m = e.target.closest('[data-modelo]');
        if (m) {
            tema = { ...MODELOS[m.dataset.modelo], fotoFormato: tema.fotoFormato, fotoEncaixe: tema.fotoEncaixe };   // o modelo troca cores e letras; o formato da foto fica
            CORES.forEach(([k]) => { $(`ap-cor-${k}`).value = tema[k]; });
            $('ap-fonte-titulo').value = tema.fonteTitulo; $('ap-fonte-texto').value = tema.fonteTexto;
            $('ap-raio').value = tema.raio; $('ap-raio-valor').textContent = `${tema.raio}px`; $('ap-etiqueta').value = tema.etiqueta;
            pintarPrevia(); return;
        }
        const g = e.target.closest('#ap-gravar'); if (!g) return;
        const nome = $('ap-nome').value.trim();
        if (!nome) return showToast('Escreva o nome da loja.', true);
        g.disabled = true; g.textContent = 'Gravando...';
        try {
            await setDoc(fichaRef(), { nome, subtitulo: $('ap-subtitulo').value.trim(), tema: { ...tema }, atualizadoEm: Date.now() }, { merge: true });
            showToast('Aparência gravada. A loja já mudou para os clientes.');
        } catch (err) {
            showToast(err && err.code === 'permission-denied' ? 'Sem permissão para gravar. Publique as regras novas do Firestore.' : 'Não consegui gravar. Confira a internet.', true);
        } finally { g.disabled = false; g.textContent = 'Gravar aparência'; }
    });
}

export async function abrirAparencia() {
    if (!el()) return;
    if (carregado) return;
    el().innerHTML = '<p class="config-sub">Carregando...</p>';
    let ficha = {};
    try { const s = await getDoc(fichaRef()); if (s.exists()) ficha = s.data(); }
    catch (e) { el().innerHTML = '<p class="config-sub">Não consegui ler a aparência desta loja. Confira a internet e abra a aba de novo.</p>'; return; }
    tema = { ...MODELOS.hortifruti, ...(ficha.tema || {}) };
    if (!ficha.nome && TENANT === 'banca') ficha.nome = 'Banca Adair e Pedrina';
    carregado = true;
    render(ficha); ligar();
}
