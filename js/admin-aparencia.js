// =====================================================================
//  js/admin-aparencia.js — aba "Aparência" do painel.
//
//  O dono escolhe nome, logo, cores, letras e o "jeito" da PRÓPRIA loja e vê
//  o resultado na hora, na LOJA DE VERDADE (com os produtos dela), aberta ao
//  lado numa prévia (/previa). Nada vai para os clientes até tocar em Gravar.
//  Os valores ficam em tenants/{loja}.tema e são aplicados por js/tema.js.
//
//  A prévia é a mesma página da loja, em modo prévia (ver EM_PREVIA em
//  js/tenant.js): carrinho à parte e pedido desligado. O painel manda a
//  aparência por mensagem (postMessage), só para o próprio site.
// =====================================================================
import { getDoc, setDoc } from './firebase.js';
import { fichaRef, TENANT, urlDaLoja, ehLojaOriginal } from './tenant.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';
import { temaSeguro, OPCOES, MODELOS, NOMES_MODELOS, FONTES, FOTO_FORMATOS, linkDaFonte, paletaDeUmaCor, avisosDeContraste, ajustarContraste, corValida, urlImagem } from './aparencia-lib.js';
import { validarArquivo } from './fotos-lib.js';

const CORES = [
    ['primaria', 'Cor principal', 'Cabeçalho e botões'],
    ['secundaria', 'Cor secundária', 'Detalhes e item no pedido'],
    ['destaque', 'Cor de destaque', 'Ofertas e pedido mínimo'],
    ['fundo', 'Fundo da página', ''],
    ['superficie', 'Fundo dos cards', ''],
    ['texto', 'Cor do texto', ''],
    ['sobrePrimaria', 'Texto sobre a cor principal', 'Quase sempre branco'],
];
// O tema gravado é conferido antes de ir para a tela e antes de voltar para o banco (ver js/aparencia-lib.js).
const CFG_TEMA = { padrao: MODELOS.hortifruti, cores: CORES.map(([k]) => k), fontesTitulo: FONTES.titulo, fontesTexto: FONTES.texto, formatos: FOTO_FORMATOS };
const conferido = (t) => temaSeguro(t, CFG_TEMA);
// O recado que a loja original sempre mostrou (está escrito na página). Sem recado gravado, o campo começa com ele:
// gravar a aparência sem mexer no campo não pode apagar a frase que os clientes já viam.
const RECADO_ORIGINAL = '+200 pedidos entregues. Pague com PIX, cartão ou dinheiro.';

// Textos das escolhas (a ordem é a de OPCOES; a 1ª é o visual de sempre)
const ROTULOS = {
    cabecalho: { cor: 'Cor lisa', degrade: 'Degradê', capa: 'Foto de capa' },
    borda: { toldo: 'Toldo listrado', onda: 'Onda', reta: 'Reta' },
    arte: { mostrar: 'Mostrar', esconder: 'Esconder' },
    alinhamento: { esquerda: 'À esquerda', centro: 'No centro' },
    logoFormato: { redondo: 'Redondo', quadrado: 'Quadrado' },
    botaoFormato: { pilula: 'Bem redondos', arredondado: 'Arredondados', quadrado: 'Quadrados' },
    card: { borda: 'Com contorno', sombra: 'Com sombra', plano: 'Sem contorno' },
    etiqueta: { barbante: 'De feira, com barbante', limpa: 'Limpa', selo: 'Selo' },
    fundoEstilo: { liso: 'Liso', papel: 'Linho', pontos: 'Pontinhos', listras: 'Listras' },
    letra: { normal: 'Normal', grande: 'Maior' },
    fotoEncaixe: { preencher: 'Preenche (corta as sobras)', inteira: 'Inteira (sem cortar)' },
};

let gravado = null, estado = null, historico = [], ultimoMarco = 0, carregado = false;
const ABERTAS = new Set(['identidade']);
const el = () => document.getElementById('aparencia-conteudo');
const $ = (id) => document.getElementById(id);
const lerPref = (k, padrao) => { try { return localStorage.getItem(k) || padrao; } catch (_) { return padrao; } };
const gravarPref = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sem armazenamento: só não lembra */ } };
let dispositivo = lerPref('ap-dispositivo', 'celular') === 'computador' ? 'computador' : 'celular';
let previaOculta = lerPref('ap-previa-oculta', '') === '1';

const fontesCarregadas = new Set();
function carregarFonte(nome) {
    const href = linkDaFonte(nome);
    if (!href || fontesCarregadas.has(nome)) return;
    fontesCarregadas.add(nome);
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}

// ---------------------------------------------------------------------
// ESTADO, DESFAZER E "NÃO GRAVADO"
// ---------------------------------------------------------------------
const copia = (x) => JSON.parse(JSON.stringify(x));
/** Muda o estado. agrupar = true junta mudanças seguidas (arrastar uma cor, digitar) num passo só do Desfazer. */
function mudar(fn, agrupar = false) {
    const antes = JSON.stringify(estado);
    fn(estado);
    estado.tema = conferido(estado.tema);
    if (JSON.stringify(estado) === antes) return;
    const agora = Date.now();
    if (!(agrupar && agora - ultimoMarco < 900)) historico.push(antes);
    ultimoMarco = agrupar ? agora : 0;
    if (historico.length > 80) historico.shift();
    sincronizar();
}
const mudou = () => JSON.stringify(estado) !== JSON.stringify(gravado);

// ---------------------------------------------------------------------
// TELA
// ---------------------------------------------------------------------
const secao = (id, titulo, resumo, corpo) => `
    <details class="ap-sec" data-sec="${id}"${ABERTAS.has(id) ? ' open' : ''}>
        <summary><span><b>${titulo}</b><small>${resumo}</small></span></summary>
        <div class="ap-sec-corpo">${corpo}</div>
    </details>`;
const escolha = (campo, titulo, opcoes, dica = '') => `
    <fieldset class="ap-escolha" data-campo-op="${campo}">
        <legend>${titulo}</legend>
        <div class="ap-chips">${opcoes.map(([v, rot]) => `<label class="ap-chip"><input type="radio" name="ap-op-${campo}" value="${escapeHTML(v)}" data-op="${campo}"><span>${escapeHTML(rot)}</span></label>`).join('')}</div>
        ${dica ? `<small class="dica-campo">${dica}</small>` : ''}
    </fieldset>`;
const opcoesDe = (campo) => OPCOES[campo].map((v) => [v, ROTULOS[campo][v] || v]);
const imagem = (tipo, titulo, dica) => `
    <div class="ap-imagem" data-imagem-de="${tipo}">
        <span class="ap-imagem-rot">${titulo}</span>
        <div class="ap-imagem-linha">
            <div class="ap-imagem-mini ap-imagem-mini--${tipo}" id="ap-${tipo}-mini" aria-hidden="true"></div>
            <div class="ap-imagem-botoes">
                <label class="btn-outline ap-enviar"><input type="file" accept="image/*" data-imagem="${tipo}" hidden><span id="ap-${tipo}-rot">Enviar</span></label>
                <button type="button" class="ap-tirar" data-tirar="${tipo}" id="ap-${tipo}-tirar">Tirar</button>
            </div>
        </div>
        <small class="dica-campo" id="ap-${tipo}-status">${dica}</small>
    </div>`;
const opcoesFonte = (lista) => Object.keys(lista).map((n) => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join('');

function render() {
    const modelos = Object.entries(MODELOS).map(([k, m]) => `
        <button type="button" class="ap-modelo" data-modelo="${k}" style="--m-fundo:${m.fundo};--m-p:${m.primaria};--m-s:${m.secundaria};--m-d:${m.destaque};--m-sup:${m.superficie};--m-tx:${m.texto};--m-bt:${m.botao || m.primaria}">
            <span class="ap-modelo-cab"></span>
            <span class="ap-modelo-card"><i></i><i></i></span>
            <b>${escapeHTML(NOMES_MODELOS[k] || k)}</b>
        </button>`).join('');
    el().innerHTML = `
    <div class="ap">
    <div class="ap-cab">
        <h3 class="ap-titulo">Aparência da loja</h3>
        <p class="config-sub">Mude e veja na hora, na sua loja de verdade. Só vai para os clientes quando você tocar em <b>Gravar</b>.</p>
    </div>
    <div class="ap-grade">
        <aside class="ap-lado${previaOculta ? ' oculta' : ''}" id="ap-lado" aria-label="Prévia da loja">
            <div class="ap-previa-barra">
                <div class="ap-seg" role="group" aria-label="Ver como">
                    <button type="button" data-disp="celular" aria-pressed="false">Celular</button>
                    <button type="button" data-disp="computador" aria-pressed="false">Computador</button>
                </div>
                <button type="button" class="ap-previa-bt" id="ap-previa-cheia" aria-label="Ver a prévia em tela cheia">Tela cheia</button>
                <button type="button" class="ap-previa-bt" id="ap-previa-ocultar">${previaOculta ? 'Mostrar prévia' : 'Esconder'}</button>
            </div>
            <div class="ap-moldura" id="ap-moldura"><div class="ap-tela" id="ap-tela"><iframe id="ap-iframe" title="Prévia da sua loja" src="${escapeHTML(enderecoDaPrevia())}"></iframe></div></div>
            <p class="ap-previa-nota">Pode tocar à vontade: nada daqui é gravado nem vira pedido.</p>
        </aside>
        <div class="ap-form" id="ap-form">
            ${secao('identidade', 'Nome e logo', 'Como a loja se apresenta', `
                <div class="form-group"><label for="ap-nome">Nome da loja</label><input type="text" id="ap-nome" data-texto="nome" maxlength="60" autocomplete="off"></div>
                <div class="form-group"><label for="ap-subtitulo">Frase abaixo do nome</label><input type="text" id="ap-subtitulo" data-texto="subtitulo" maxlength="80" autocomplete="off" placeholder="Ex.: Na brasa, de quinta a domingo"></div>
                <div class="form-group"><label for="ap-nota">Recado pequeno (opcional)</label><input type="text" id="ap-nota" data-texto="nota" maxlength="120" autocomplete="off" placeholder="Ex.: Pague com PIX, cartão ou dinheiro"></div>
                ${imagem('logo', 'Logo', 'Quadrada fica melhor. PNG com fundo transparente também serve.')}
                <div data-se="logo">${escolha('logoFormato', 'Formato do logo', opcoesDe('logoFormato'))}</div>`)}
            ${secao('modelos', 'Modelos prontos', 'Comece de um visual pronto', `
                <div class="ap-modelos">${modelos}</div>
                <small class="dica-campo">Troca cores, letras e o jeito dos cards e botões. Nome, logo e capa continuam.</small>`)}
            ${secao('cores', 'Cores', 'Cores da loja e fundo', `
                <div class="ap-gerar">
                    <span class="ap-gerar-rot"><b>Montar as cores a partir de uma só</b><small>Escolha a cor da sua marca e o resto combina sozinho.</small></span>
                    <div class="ap-gerar-linha">
                        <input type="color" id="ap-gerar-cor" aria-label="Cor da marca">
                        <button type="button" class="btn-outline" data-gerar="claro">Fundo claro</button>
                        <button type="button" class="btn-outline" data-gerar="escuro">Fundo escuro</button>
                    </div>
                </div>
                <div class="ap-cores">${CORES.map(([k, rot, dica]) => `
                    <label class="ap-cor"><input type="color" data-cor="${k}" aria-label="${escapeHTML(rot)}"><span><b>${rot}</b>${dica ? `<small>${dica}</small>` : ''}</span></label>`).join('')}
                    <div class="ap-cor ap-cor--botao">
                        <input type="color" data-cor="botao" aria-label="Cor dos botões" id="ap-cor-botao">
                        <span><b>Cor dos botões</b><label class="ap-check"><input type="checkbox" id="ap-botao-igual"> igual à cor principal</label></span>
                    </div>
                </div>
                <div id="ap-avisos" class="ap-avisos" aria-live="polite"></div>
                ${escolha('fundoEstilo', 'Fundo da página', opcoesDe('fundoEstilo'), 'Uma textura bem leve no fundo, atrás dos produtos.')}`)}
            ${secao('cabecalho', 'Cabeçalho', 'O topo da loja', `
                ${escolha('cabecalho', 'Fundo do cabeçalho', opcoesDe('cabecalho'))}
                <div data-se="cabecalho=capa">${imagem('capa', 'Foto de capa', 'Foto deitada (mais larga que alta). A cor principal fica por cima, bem leve, para o nome continuar legível.')}</div>
                ${escolha('alinhamento', 'Nome da loja', opcoesDe('alinhamento'))}
                ${escolha('arte', 'Desenho no canto', opcoesDe('arte'), 'O desenho do tipo de loja (caixote, pão, espeto...). Com o nome no centro, ele sai.')}
                ${escolha('borda', 'Borda de baixo', opcoesDe('borda'))}`)}
            ${secao('vitrine', 'Produtos e botões', 'Cards, fotos, preço e botões', `
                ${escolha('fotoFormato', 'Formato da foto', Object.entries(FOTO_FORMATOS).map(([k, [rot]]) => [k, rot]), 'Fotos tiradas em pé (pão no saco, garrafa, pote) ficam melhores em "Em pé".')}
                ${escolha('fotoEncaixe', 'Como a foto se encaixa', opcoesDe('fotoEncaixe'))}
                ${escolha('etiqueta', 'Etiqueta do preço', opcoesDe('etiqueta'))}
                ${escolha('card', 'Cards dos produtos', opcoesDe('card'))}
                <div class="form-group"><label for="ap-raio">Cantos dos cards: <span id="ap-raio-valor"></span></label><input type="range" id="ap-raio" data-num="raio" min="0" max="24" step="1"></div>
                ${escolha('botaoFormato', 'Botões', opcoesDe('botaoFormato'))}`)}
            ${secao('letras', 'Letras', 'Tipo e tamanho da letra', `
                <div class="form-group"><label for="ap-fonte-titulo">Letra dos títulos e preços</label><select id="ap-fonte-titulo" data-fonte="fonteTitulo">${opcoesFonte(FONTES.titulo)}</select>
                    <p class="ap-amostra ap-amostra--titulo" data-amostra="fonteTitulo">Tomate italiano · R$ 9,90</p></div>
                <div class="form-group"><label for="ap-fonte-texto">Letra do texto</label><select id="ap-fonte-texto" data-fonte="fonteTexto">${opcoesFonte(FONTES.texto)}</select>
                    <p class="ap-amostra" data-amostra="fonteTexto">Escolha onde entregar · Adicionar ao pedido</p></div>
                ${escolha('letra', 'Tamanho da letra', opcoesDe('letra'), 'Maior ajuda quem enxerga menos. Os cards ficam um pouco mais altos.')}`)}
            <p class="dica-campo ap-link-loja">Sua loja: <a href="${escapeHTML(urlDaLoja(TENANT))}" target="_blank" rel="noopener">abrir em outra aba</a></p>
        </div>
    </div>
    <div class="ap-rodape" id="ap-rodape">
        <span class="ap-rodape-estado" id="ap-estado" aria-live="polite"></span>
        <div class="ap-rodape-botoes">
            <button type="button" class="ap-rodape-bt" id="ap-desfazer">Desfazer</button>
            <button type="button" class="ap-rodape-bt" id="ap-voltar">Descartar<span class="ap-so-largo"> mudanças</span></button>
            <button type="button" class="btn-salvar-config" id="ap-gravar">Gravar</button>
        </div>
    </div>
    </div>`;
    sincronizar();
    ligarPrevia();
}

/** Põe na tela o que está no estado: campos, escolhas, amostras, avisos, botões do rodapé. */
function sincronizar() {
    const raiz = el(); if (!raiz || !estado) return;
    const t = estado.tema;
    raiz.querySelectorAll('[data-texto]').forEach((i) => { if (document.activeElement !== i) i.value = estado[i.dataset.texto] || ''; });
    raiz.querySelectorAll('input[data-cor]').forEach((i) => { const k = i.dataset.cor; const v = k === 'botao' ? (t.botao || t.primaria) : t[k]; if (corValida(v) && i.value.toLowerCase() !== v.toLowerCase()) i.value = v.toLowerCase(); });
    const igual = $('ap-botao-igual'); if (igual) { igual.checked = !t.botao; $('ap-cor-botao').disabled = !t.botao; }
    const gerar = $('ap-gerar-cor'); if (gerar && !gerar.dataset.mexeu) gerar.value = (t.primaria || '#1a3a2a').toLowerCase();
    raiz.querySelectorAll('input[data-op]').forEach((i) => {
        const k = i.dataset.op, padrao = OPCOES[k] ? OPCOES[k][0] : (k === 'fotoFormato' ? 'quadrada' : '');
        i.checked = (t[k] || padrao) === i.value;
    });
    raiz.querySelectorAll('select[data-fonte]').forEach((s) => { s.value = t[s.dataset.fonte]; });
    raiz.querySelectorAll('[data-amostra]').forEach((p) => { const k = p.dataset.amostra, nome = t[k]; carregarFonte(nome); p.style.fontFamily = (k === 'fonteTitulo' ? FONTES.titulo : FONTES.texto)[nome] || ''; });
    const raio = $('ap-raio'); if (raio) { raio.value = Number(t.raio) || 0; $('ap-raio-valor').textContent = `${Number(t.raio) || 0}px`; }
    // partes que só aparecem com uma escolha (formato do logo só com logo; capa só com "Foto de capa")
    raiz.querySelectorAll('[data-se]').forEach((b) => {
        const [k, v] = b.dataset.se.split('='); b.hidden = v === undefined ? !t[k] : (t[k] || '') !== v;
    });
    for (const tipo of ['logo', 'capa']) {
        const url = urlImagem(t[tipo]), mini = $(`ap-${tipo}-mini`); if (!mini) continue;
        mini.innerHTML = url ? `<img src="${escapeHTML(url)}" alt="">` : '<span>sem imagem</span>';
        $(`ap-${tipo}-rot`).textContent = url ? 'Trocar' : 'Enviar';
        $(`ap-${tipo}-tirar`).hidden = !url;
    }
    // modelo que está igual às cores atuais aparece marcado
    raiz.querySelectorAll('[data-modelo]').forEach((b) => { const m = MODELOS[b.dataset.modelo]; b.classList.toggle('ativo', !!m && CORES.every(([k]) => (m[k] || '').toLowerCase() === (t[k] || '').toLowerCase()) && m.fonteTitulo === t.fonteTitulo); });
    // avisos de leitura, cada um com "Ajustar sozinho"
    const av = $('ap-avisos');
    if (av) av.innerHTML = avisosDeContraste(t).map((a) => `<p><span>${escapeHTML(a.texto)}</span><button type="button" class="ap-ajustar" data-ajustar="${a.campo}">Ajustar sozinho</button></p>`).join('');
    // rodapé
    const pendente = mudou();
    $('ap-estado').textContent = pendente ? 'Mudanças ainda não gravadas' : 'Tudo gravado';
    $('ap-rodape').classList.toggle('pendente', pendente);
    $('ap-desfazer').disabled = !historico.length;
    $('ap-voltar').disabled = !pendente;
    raiz.querySelectorAll('[data-disp]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.disp === dispositivo)));
    enviarPrevia();
}

// ---------------------------------------------------------------------
// PRÉVIA: a loja de verdade num quadro, em escala
// ---------------------------------------------------------------------
function enderecoDaPrevia() { return ehLojaOriginal ? '/previa' : `/previa?loja=${encodeURIComponent(TENANT)}`; }
const fichaDaPrevia = () => ({ nome: estado.nome, subtitulo: estado.subtitulo, nota: estado.nota, tema: conferido(estado.tema) });
let quadroRaf = 0;
function enviarPrevia() {
    const f = $('ap-iframe'); if (!f || !f.contentWindow) return;
    cancelAnimationFrame(quadroRaf);
    quadroRaf = requestAnimationFrame(() => { try { f.contentWindow.postMessage({ tipo: 'banca-previa', ficha: fichaDaPrevia() }, location.origin); } catch (_) { /* quadro ainda carregando */ } });
}
let ouvindo = false, observador = null;
function ligarPrevia() {
    if (!ouvindo) {
        ouvindo = true;
        // a loja avisa quando abriu: é a hora de mandar a aparência que está na tela
        window.addEventListener('message', (e) => {
            const f = $('ap-iframe');
            if (!f || e.source !== f.contentWindow || e.origin !== location.origin || !e.data || e.data.tipo !== 'banca-previa-pronta') return;
            enviarPrevia();
        });
        window.addEventListener('resize', medirPrevia);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('ap-lado')?.classList.contains('cheia')) alternarCheia(false); });
    }
    $('ap-iframe').addEventListener('load', enviarPrevia);
    observador?.disconnect();
    if ('ResizeObserver' in window) { observador = new ResizeObserver(() => medirPrevia()); observador.observe($('ap-moldura')); }
    medirPrevia();
}
const TAMANHOS = { celular: [390, 780], computador: [1280, 820] };
function medirPrevia() {
    const moldura = $('ap-moldura'), tela = $('ap-tela'), f = $('ap-iframe'), lado = $('ap-lado');
    if (!moldura || !f) return;
    const [larg, altCheia] = TAMANHOS[dispositivo];
    const cheia = lado.classList.contains('cheia'), estreito = window.matchMedia('(max-width: 959px)').matches;
    const disponivel = moldura.clientWidth || 320;
    const escala = Math.min(1, disponivel / larg);
    // no celular a prévia fica presa no alto, com uma altura menor, para sobrar tela para os ajustes
    let visivel = altCheia * escala;
    if (cheia) visivel = Math.max(320, window.innerHeight - (lado.querySelector('.ap-previa-barra')?.offsetHeight || 0) - 24);
    else if (estreito) visivel = Math.min(visivel, Math.max(220, Math.round(window.innerHeight * 0.34)));
    else visivel = Math.min(visivel, Math.max(360, window.innerHeight - 200));        // computador: cabe acima do rodapé
    f.style.width = `${larg}px`; f.style.height = `${Math.round(visivel / escala)}px`;
    f.style.transform = `scale(${escala})`;
    tela.style.width = `${Math.round(larg * escala)}px`; tela.style.height = `${Math.round(visivel)}px`;
    moldura.dataset.disp = dispositivo;
    // no celular a prévia fica presa no alto: o que rola para a vista (seção aberta, campo com foco) para logo abaixo dela
    requestAnimationFrame(() => { const raiz = el(); if (raiz && lado) raiz.style.setProperty('--ap-previa-alt', estreito && !cheia ? `${lado.offsetHeight}px` : '0px'); });
}
function alternarCheia(ligar) {
    const lado = $('ap-lado'); if (!lado) return;
    const on = ligar === undefined ? !lado.classList.contains('cheia') : ligar;
    lado.classList.toggle('cheia', on); document.body.classList.toggle('ap-previa-aberta', on);
    $('ap-previa-cheia').textContent = on ? 'Fechar' : 'Tela cheia';
    if (on) lado.classList.remove('oculta');
    medirPrevia();
}

// ---------------------------------------------------------------------
// LOGO E CAPA
// ---------------------------------------------------------------------
async function enviarImagem(tipo, arquivo) {
    const problema = validarArquivo(arquivo || {}); if (problema) return showToast(problema, true);
    const status = $(`ap-${tipo}-status`), antes = status.textContent;
    status.textContent = 'Preparando e enviando a imagem...';
    try {
        const F = await import('./admin-fotos.js');
        const otima = await F.otimizarFoto(arquivo, tipo === 'capa' ? 1600 : 512, 0.85, { transparente: tipo === 'logo' });
        const url = urlImagem(await F.enviarFoto(tipo, otima, `-${Date.now().toString(36)}`));
        if (!url) throw new Error('endereço da imagem não aceito');
        mudar((e) => { e.tema[tipo] = url; if (tipo === 'capa') e.tema.cabecalho = 'capa'; });
        status.textContent = 'Pronto. Toque em Gravar para os clientes verem.';
    } catch (err) {
        status.textContent = antes;
        showToast((err && err.amigavel) || 'Não consegui enviar a imagem. Confira a internet e tente de novo.', true);
    }
}

// ---------------------------------------------------------------------
// AÇÕES
// ---------------------------------------------------------------------
function aplicarModelo(nome) {
    if (!Object.prototype.hasOwnProperty.call(MODELOS, nome)) return;
    mudar((e) => {
        const t = e.tema, base = Object.fromEntries(Object.entries(OPCOES).map(([k, l]) => [k, l[0]]));
        const fica = { logo: t.logo, capa: t.capa, logoFormato: t.logoFormato, fotoFormato: t.fotoFormato, fotoEncaixe: t.fotoEncaixe, letra: t.letra };
        e.tema = { ...base, ...MODELOS[nome] };
        for (const [k, v] of Object.entries(fica)) if (v !== undefined) e.tema[k] = v;
        if (t.cabecalho === 'capa' && urlImagem(t.capa)) e.tema.cabecalho = 'capa';      // quem pôs foto de capa não perde a capa ao trocar de modelo
    });
}
async function gravar(botao) {
    const nome = (estado.nome || '').trim();
    if (!nome) { ABERTAS.add('identidade'); $('ap-form').querySelector('[data-sec="identidade"]').open = true; $('ap-nome').focus(); return showToast('Escreva o nome da loja.', true); }
    if (nome.length < 2) return showToast('O nome da loja precisa de pelo menos 2 letras.', true);
    botao.disabled = true; botao.textContent = 'Gravando...';
    try {
        const ficha = { nome: nome.slice(0, 60), subtitulo: (estado.subtitulo || '').trim().slice(0, 120), nota: (estado.nota || '').trim().slice(0, 120), tema: conferido(estado.tema), atualizadoEm: Date.now() };
        // mergeFields: o tema é trocado INTEIRO (com merge comum, o logo tirado continuaria gravado lá dentro)
        await setDoc(fichaRef(), ficha, { mergeFields: Object.keys(ficha) });
        gravado = copia({ nome: ficha.nome, subtitulo: ficha.subtitulo, nota: ficha.nota, tema: ficha.tema });
        estado = copia(gravado);
        showToast('Aparência gravada. A loja já mudou para os clientes.');
    } catch (err) {
        showToast(err && err.code === 'permission-denied' ? 'Sem permissão para gravar. Publique as regras novas do Firestore.' : 'Não consegui gravar. Confira a internet.', true);
    } finally { botao.disabled = false; botao.textContent = 'Gravar'; sincronizar(); }
}

function ligar() {
    const raiz = el();
    raiz.addEventListener('toggle', (e) => { const d = e.target.closest?.('details[data-sec]'); if (d) { if (d.open) ABERTAS.add(d.dataset.sec); else ABERTAS.delete(d.dataset.sec); } }, true);
    raiz.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.texto) mudar((s) => { s[t.dataset.texto] = t.value; }, true);
        else if (t.dataset.cor) mudar((s) => { s.tema[t.dataset.cor] = t.value; }, true);
        else if (t.dataset.num === 'raio') mudar((s) => { s.tema.raio = Number(t.value); }, true);
        else if (t.id === 'ap-gerar-cor') t.dataset.mexeu = '1';
    });
    raiz.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.op && t.checked) mudar((s) => { s.tema[t.dataset.op] = t.value; });
        else if (t.dataset.fonte) mudar((s) => { s.tema[t.dataset.fonte] = t.value; });
        else if (t.id === 'ap-botao-igual') mudar((s) => { if (t.checked) delete s.tema.botao; else s.tema.botao = s.tema.primaria; });
        else if (t.dataset.imagem && t.files && t.files[0]) { enviarImagem(t.dataset.imagem, t.files[0]); t.value = ''; }
        else if (t.dataset.texto || t.dataset.cor || t.dataset.num) ultimoMarco = 0;          // soltou: a próxima mudança é outro passo do Desfazer
    });
    raiz.addEventListener('click', async (e) => {
        const alvo = e.target.closest('button'); if (!alvo) return;
        if (alvo.dataset.modelo) return aplicarModelo(alvo.dataset.modelo);
        if (alvo.dataset.gerar) { const p = paletaDeUmaCor($('ap-gerar-cor').value, alvo.dataset.gerar); if (p) mudar((s) => { Object.assign(s.tema, p); delete s.tema.botao; }); return; }
        if (alvo.dataset.ajustar) return mudar((s) => { s.tema = ajustarContraste(s.tema, alvo.dataset.ajustar); });
        if (alvo.dataset.tirar) return mudar((s) => { delete s.tema[alvo.dataset.tirar]; if (alvo.dataset.tirar === 'capa' && s.tema.cabecalho === 'capa') s.tema.cabecalho = 'cor'; });
        if (alvo.dataset.disp) { dispositivo = alvo.dataset.disp; gravarPref('ap-dispositivo', dispositivo); medirPrevia(); return sincronizar(); }
        if (alvo.id === 'ap-previa-cheia') return alternarCheia();
        if (alvo.id === 'ap-previa-ocultar') {
            if ($('ap-lado').classList.contains('cheia')) alternarCheia(false);
            previaOculta = $('ap-lado').classList.toggle('oculta');
            gravarPref('ap-previa-oculta', previaOculta ? '1' : ''); alvo.textContent = previaOculta ? 'Mostrar prévia' : 'Esconder'; return medirPrevia();
        }
        if (alvo.id === 'ap-desfazer') { const anterior = historico.pop(); if (anterior) { estado = JSON.parse(anterior); ultimoMarco = 0; sincronizar(); } return; }
        if (alvo.id === 'ap-voltar') {
            if (!mudou() || !(await customConfirm('Descartar as mudanças?', 'A aparência volta a ser a que está gravada (a que os clientes veem). Se mudar de ideia, toque em Desfazer.', { ok: 'Descartar', nao: 'Continuar mexendo' }))) return;
            historico.push(JSON.stringify(estado)); estado = copia(gravado); return sincronizar();
        }
        if (alvo.id === 'ap-gravar') return gravar(alvo);
    });
}

export async function abrirAparencia() {
    if (!el()) return;
    if (carregado) { medirPrevia(); return; }
    el().innerHTML = '<p class="config-sub">Carregando...</p>';
    let ficha = {};
    try { const s = await getDoc(fichaRef()); if (s.exists()) ficha = s.data(); }
    catch (e) { el().innerHTML = '<p class="config-sub">Não consegui ler a aparência desta loja. Confira a internet e abra a aba de novo.</p>'; return; }
    const texto = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    gravado = {
        nome: texto(ficha.nome, 60) || (ehLojaOriginal ? 'Banca Adair e Pedrina' : ''),
        subtitulo: texto(ficha.subtitulo, 120),
        nota: typeof ficha.nota === 'string' ? ficha.nota.slice(0, 120) : (ehLojaOriginal ? RECADO_ORIGINAL : ''),
        tema: conferido(ficha.tema),          // nada do que está gravado vai para a tela sem conferir
    };
    estado = copia(gravado); historico = [];
    carregado = true;
    render(); ligar();
}
