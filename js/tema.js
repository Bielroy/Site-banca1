// =====================================================================
//  js/tema.js — APARÊNCIA DE CADA LOJA
//
//  O site é um só; o que muda de uma loja para outra são VALORES: cores,
//  fontes, cantos, nome. Eles ficam na ficha da loja (tenants/{id}.tema),
//  editada no painel (aba Aparência), e aqui viram variáveis de CSS.
//  Nenhum componente é duplicado: a etiqueta, o card e os botões leem as
//  mesmas variáveis de css/variables.css.
//
//  Sem ficha (ou sem tema), vale o visual original da Banca Adair e Pedrina.
// =====================================================================
import { getDoc, doc, db } from './firebase.js';
import { feiraDoDia, feirasDaFicha, feiraDoCliente, feirasDoCondominio, feiraDoEndereco, comFeira } from './plataforma-lib.js';
import { lerFeiraCliente, gravarFeiraCliente, gravarUltimaBanca, lerUltimaBanca } from './feira-cliente.js';
import { TENANT, fichaRef, chave, urlDaLoja, ehLojaOriginal, EM_PREVIA } from './tenant.js';
import { ARTES, arteDoTipo } from './arte-lib.js';
import { OPCOES, urlImagem, corLegivel, legivelSobre, FONTES, MODELOS, NOMES_MODELOS, FOTO_FORMATOS, linkDaFonte } from './aparencia-lib.js';
// As listas moraram aqui por muito tempo; quem já importava daqui continua funcionando.
export { FONTES, MODELOS, NOMES_MODELOS, FOTO_FORMATOS };

// DESENHO DO CABEÇALHO. A loja original mostra o caixote de frutas, que já vem na página.
// As outras ficam sem desenho até a ficha chegar, e aí ganham o traço do tipo de negócio delas.
if (!ehLojaOriginal) document.documentElement.classList.add('sem-arte');
// Mesmo cuidado com o botão do Ajudante: nas outras lojas ele só aparece depois que a ficha diz que está ligado.
if (!ehLojaOriginal) document.body.classList.add('sem-ia');
// E com os TEXTOS: a página vem escrita com o nome e as frases da Banca. Em outra loja eles somem na hora,
// antes mesmo de a ficha chegar (ver aplicarFicha), para nunca aparecer o nome de uma loja sobre os produtos de outra.
if (!ehLojaOriginal) {
    ['header-nome', 'header-sub', 'header-nota'].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = ''; });
    document.querySelectorAll('[data-nome-loja]').forEach((el) => { el.textContent = ''; });
    document.title = 'Loja';                              // a aba do navegador também não fica com o nome da Banca
}
const CAIXOTE = { viewBox: '', html: '' };
function aplicarArte(tipo) {
    const svg = document.querySelector('.header-arte'); if (!svg) return;
    if (!CAIXOTE.html) { CAIXOTE.viewBox = svg.getAttribute('viewBox'); CAIXOTE.html = svg.innerHTML; }
    const qual = arteDoTipo(tipo), traco = qual !== 'caixote';   // 'traco' = desenho de outro tipo de loja (nome antigo; hoje são formas cheias)
    svg.setAttribute('viewBox', traco ? '0 0 120 120' : CAIXOTE.viewBox);
    svg.innerHTML = traco ? ARTES[qual] : CAIXOTE.html;          // desenhos fixos deste projeto, nada vindo de fora
    svg.classList.toggle('plana', traco);
    document.documentElement.classList.remove('sem-arte');
}

// O "APP" DESTA LOJA: quem instala na tela inicial vê o nome e o ícone da loja em que está,
// e não os da Banca. O manifesto e o ícone saem de /api/manifest (ver o arquivo).
let _appDe = '';
function aplicarApp(ficha) {
    if (_appDe === TENANT || !ficha || !ficha.nome) return;
    _appDe = TENANT;
    const base = `/api/manifest?loja=${encodeURIComponent(TENANT)}`;
    let m = document.querySelector('link[rel="manifest"]');
    if (!m) { m = document.createElement('link'); m.rel = 'manifest'; document.head.appendChild(m); }
    m.href = base;
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => { l.href = `${base}&icone=1`; });
    const t = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (t) t.setAttribute('content', ficha.nome);
    // iPhone não aceita ícone em SVG na tela inicial: desenha o mesmo ícone num PNG, aqui mesmo no aparelho
    const img = new Image();
    img.onload = () => {
        try {
            const c = document.createElement('canvas'); c.width = c.height = 180; c.getContext('2d').drawImage(img, 0, 0, 180, 180);
            const png = c.toDataURL('image/png'); document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((l) => { l.href = png; });
        } catch (_) { /* fica o ícone padrão */ }
    };
    img.src = `${base}&icone=1`;
}

const NO_SITE = new Set(['Fraunces', 'Figtree']);          // já carregadas pelo index.html


const cor = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

// Classes que o tema liga na página (cada escolha de OPCOES vira uma classe; a 1ª de cada lista, o padrão, não liga nada)
const CLASSES_OPCOES = Object.entries(OPCOES).flatMap(([k, lista]) => lista.slice(1).map((v) => [k, v, `${k === 'etiqueta' ? 'etiqueta' : `ap-${k}`}-${v}`]));
const RAIO_BOTAO = { arredondado: '14px', quadrado: '6px' };

/** Transforma um tema em variáveis de CSS. Devolve { variaveis, classes } sem tocar na página. */
export function variaveisDoTema(tema) {
    const t = tema || {}, v = {};
    const p = cor(t.primaria), s = cor(t.secundaria), d = cor(t.destaque), f = cor(t.fundo), sup = cor(t.superficie), tx = cor(t.texto), sp = cor(t.sobrePrimaria), bt = cor(t.botao);
    const fundo = f || 'var(--cream)', superf = sup || '#ffffff';
    if (p) { v['--forest'] = p; v['--forest-mid'] = mix(p, 82, superf); }
    // A cor principal também é usada como COR DE TEXTO (nome do produto, preço, botões de contorno). Num fundo
    // escuro, um vermelho-escuro some: aqui ela é clareada (ou escurecida) só o necessário para ler bem.
    if (p) v['--forest-texto'] = corLegivel(p, [sup || '#ffffff', f || '#faf7f2']);
    if (s) { v['--leaf'] = s; v['--mint'] = mix(s, 62, superf); v['--mint-dark'] = mix(s, 78, tx || '#000000'); v['--sage'] = mix(s, 38, superf); v['--foam'] = mix(s, 14, superf); }
    if (d) { v['--earth'] = d; v['--earth-light'] = mix(d, 70, superf); v['--earth-forte'] = mix(d, 72, tx || '#000000'); v['--manga'] = d; }
    if (f) { v['--cream'] = f; v['--parchment'] = mix(f, 90, tx || '#000000'); }
    if (sup) { v['--superficie'] = sup; v['--warm-white'] = sup; }
    if (tx) { v['--text-dark'] = tx; v['--text-mid'] = mix(tx, 76, fundo); v['--text-light'] = mix(tx, 58, fundo); v['--linha'] = mix(tx, 16, fundo); }
    if (sp) v['--sobre-primaria'] = sp;
    // COR DOS BOTÕES (opcional): sem ela, os botões usam a cor principal, como sempre
    if (bt) { v['--cor-botao'] = bt; v['--cor-botao-mid'] = mix(bt, 82, '#ffffff'); v['--sobre-botao'] = legivelSobre(bt); v['--cor-botao-texto'] = corLegivel(bt, [sup || '#ffffff', f || '#faf7f2']); }
    if (FONTES.titulo[t.fonteTitulo]) v['--fonte-titulo'] = FONTES.titulo[t.fonteTitulo];
    if (FONTES.texto[t.fonteTexto]) v['--fonte-texto'] = FONTES.texto[t.fonteTexto];
    const raio = Number(t.raio);
    if (Number.isFinite(raio) && raio >= 0 && raio <= 28) { v['--raio-card'] = `${raio}px`; v['--radius'] = `${Math.round(raio * 1.4)}px`; v['--radius-sm'] = `${Math.max(4, Math.round(raio * 0.85))}px`; }
    // FOTO DO PRODUTO: cada loja escolhe o formato da área (quadrada, em pé, deitada) e se a foto preenche ou aparece inteira
    if (FOTO_FORMATOS[t.fotoFormato]) v['--foto-proporcao'] = FOTO_FORMATOS[t.fotoFormato][1];
    if (t.fotoFormato === 'alta') v['--foto-hero'] = '1 / 1'; else if (t.fotoFormato === 'bem-alta') v['--foto-hero'] = '4 / 5';   // a foto grande, ao abrir o produto, acompanha
    if (t.fotoEncaixe === 'inteira') v['--foto-encaixe'] = 'contain';
    if (RAIO_BOTAO[t.botaoFormato]) v['--raio-botao'] = RAIO_BOTAO[t.botaoFormato];
    // etiqueta: em tema escuro o "papel" claro continua claro (é um objeto), com tinta escura
    const classes = { 'com-cor-botao': !!bt };
    for (const [k, val, classe] of CLASSES_OPCOES) classes[classe] = t[k] === val;
    // capa só vale com uma foto de verdade; sem ela, o cabeçalho fica na cor lisa
    if (t.cabecalho === 'capa' && !urlImagem(t.capa)) classes['ap-cabecalho-capa'] = false;
    return { variaveis: v, classes };
}

/** Carrega uma letra da lista no Google Fonts (uma vez só). Usada também pelo painel, nas amostras. */
export const carregarFonte = (nome) => {
    // só as fontes da nossa lista: o nome vem da ficha da loja e antes entrava direto num seletor e num endereço
    const href = linkDaFonte(nome);
    if (!href || NO_SITE.has(nome) || [...document.querySelectorAll('link[data-fonte]')].some((l) => l.dataset.fonte === nome)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.dataset.fonte = nome; l.href = href;
    document.head.appendChild(l);
};

/** Aplica o tema em um elemento (a página inteira, ou uma amostra no painel). */
export function aplicarTema(tema, alvo = document.documentElement) {
    const { variaveis, classes } = variaveisDoTema(tema);
    (alvo._temaVars || []).forEach((k) => alvo.style.removeProperty(k));
    Object.entries(variaveis).forEach(([k, val]) => alvo.style.setProperty(k, val));
    alvo._temaVars = Object.keys(variaveis);
    Object.entries(classes).forEach(([c, on]) => alvo.classList.toggle(c, !!on));
    if (tema) { carregarFonte(tema.fonteTitulo); carregarFonte(tema.fonteTexto); }
    if (alvo === document.documentElement && tema && cor(tema.primaria)) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tema.primaria);
}

/**
 * LOGO e FOTO DE CAPA no cabeçalho da loja. Os endereços vêm da ficha e passam por urlImagem
 * (só https, sem nada que escape do atributo); entram como <img>, nunca como texto de CSS.
 */
function aplicarCabecalho(tema, nome) {
    const cab = document.getElementById('header-principal'), dentro = cab && cab.querySelector('.header-inner');
    if (!cab || !dentro) return;
    const t = tema || {}, logo = urlImagem(t.logo), capa = t.cabecalho === 'capa' ? urlImagem(t.capa) : '';
    let img = document.getElementById('header-logo');
    if (logo) {
        if (!img) { img = document.createElement('img'); img.id = 'header-logo'; img.className = 'header-logo'; img.decoding = 'async'; dentro.insertBefore(img, dentro.firstChild); }
        if (img.getAttribute('src') !== logo) img.src = logo;
        img.alt = nome ? `Logo de ${nome}` : 'Logo da loja';
        img.classList.toggle('quadrado', t.logoFormato === 'quadrado');
    } else if (img) img.remove();
    let fundo = document.getElementById('header-capa');
    if (capa) {
        if (!fundo) { fundo = document.createElement('img'); fundo.id = 'header-capa'; fundo.className = 'header-capa'; fundo.alt = ''; fundo.setAttribute('aria-hidden', 'true'); fundo.decoding = 'async'; cab.insertBefore(fundo, cab.firstChild); }
        if (fundo.getAttribute('src') !== capa) fundo.src = capa;
    } else if (fundo) fundo.remove();
}

/** Módulo ligado nesta loja? A loja original mantém tudo ligado, como sempre foi. */
export const moduloLigado = (ficha, nome) => {
    const m = ficha && ficha.modulos ? ficha.modulos[nome] : undefined;
    if (m === true || m === false) return m;
    return nome === 'ia' ? ehLojaOriginal : true;
};

const escrever = (id, texto) => { const el = document.getElementById(id); if (el && texto) el.textContent = texto; };
// completa = false: cópia antiga guardada no aparelho, que não trazia o tipo nem os módulos.
// Nesse caso o desenho e o botão do Ajudante esperam a ficha de verdade, em vez de mostrar o errado e trocar depois.
function aplicarFicha(ficha, completa = true) {
    if (!ficha) return;
    aplicarTema(ficha.tema || null);
    aplicarCabecalho(ficha.tema || null, typeof ficha.nome === 'string' ? ficha.nome : '');
    if (!ehLojaOriginal && completa) aplicarArte(ficha.tipo);
    if (!ehLojaOriginal) aplicarApp(ficha);
    if (ficha.nome && !(ehLojaOriginal && !ficha.tema)) {          // a loja original mantém o título desenhado, a não ser que tenha sido personalizada
        escrever('header-nome', ficha.nome);
        document.title = ficha.subtitulo ? `${ficha.nome} | ${ficha.subtitulo}` : ficha.nome;
    }
    // OUTRA LOJA NUNCA APARECE COM A CARA DA BANCA. A página já vem escrita com o nome, a frase e o rodapé da
    // loja original; se a ficha de outra loja viesse sem nome (ou com campos vazios), a tela continuava dizendo
    // "Banca Adair e Pedrina" com os produtos, o WhatsApp e o PIX de outra pessoa. Agora, fora da loja original,
    // tudo o que é texto da Banca é trocado SEMPRE: sem nome na ficha, vale o endereço da loja.
    if (!ehLojaOriginal) {
        const nome = typeof ficha.nome === 'string' && ficha.nome.trim() ? ficha.nome.trim() : TENANT;
        const por = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
        por('header-nome', nome); por('header-sub', typeof ficha.subtitulo === 'string' ? ficha.subtitulo : '');
        document.title = ficha.subtitulo ? `${nome} | ${ficha.subtitulo}` : nome;
        document.querySelectorAll('[data-nome-loja]').forEach((el) => { el.textContent = nome; });
        const nota = document.getElementById('header-nota'); if (nota) { nota.textContent = typeof ficha.nota === 'string' ? ficha.nota : ''; nota.hidden = !nota.textContent; }
    }
    escrever('header-sub', ficha.subtitulo);
    const busca = document.getElementById('busca-input');
    if (busca && (ficha.busca || !ehLojaOriginal)) busca.placeholder = ficha.busca || 'Buscar produto...';
    // MÓDULOS: cada loja liga só o que usa (ficha.modulos = { ia: true, ... }).
    // O Ajudante foi escrito para hortifruti, então nas outras lojas começa desligado.
    if (completa) document.body.classList.toggle('sem-ia', !moduloLigado(ficha, 'ia'));
    if (ficha.nota !== undefined) { const n = document.getElementById('header-nota'); if (n) { n.textContent = ficha.nota || ''; n.hidden = !ficha.nota; } }
}

// ---------------------------------------------------------------------
// FEIRA. feiras/{id} = { nome, dias: [0..6], lojas: [{ id, nome, cor }], condominios: [nomes] }
//  - Cliente DA FEIRA (entrou pelo link dela, escolheu um condomínio dela ou a conta lembrou):
//    vê a faixa com as bancas da feira DELE (qualquer dia). Numa banca que não é da feira dele,
//    não aparece faixa nenhuma.
//  - Cliente sem feira (quem já usava antes): a faixa antiga, com as lojas da feira de hoje.
// ---------------------------------------------------------------------
const diaBR = () => new Date(Date.now() - 3 * 3600000).getUTCDay();          // dia da semana em Brasília
let FEIRAS_DA_LOJA = [], FEIRA_CLIENTE = null;
/** A feira do cliente, se ele for de uma feira DESTA banca (senão null: a loja funciona como sempre). */
export const feiraDoClienteAqui = () => FEIRA_CLIENTE;
/**
 * Condomínios das feiras desta banca (cadastro da plataforma), para a lista de endereço do cliente.
 * Cliente de uma feira vê os da feira dele; sem feira, os de todas as feiras desta banca.
 */
export function condominiosDasFeiras() {
    const fontes = FEIRA_CLIENTE ? [FEIRA_CLIENTE] : FEIRAS_DA_LOJA, vistos = new Set(), out = [];
    for (const f of fontes) for (const c of Array.isArray(f && f.conds) ? f.conds : []) {
        if (!c || !c.nome || vistos.has(c.id)) continue;
        vistos.add(c.id); out.push({ id: `pf-${c.id}`, nome: String(c.nome).slice(0, 80), formato: ['ql', 'rua', 'livre'].includes(c.formato) ? c.formato : 'ql', apelidos: Array.isArray(c.apelidos) ? c.apelidos.slice(0, 5).map(String) : [] });
    }
    return out;
}
const lojasValidas = (feira) => ((feira && feira.lojas) || []).filter((l) => l && /^[a-z0-9][a-z0-9-]{1,39}$/.test(l.id || '') && l.nome);

function montarFeira(feiras) {
    const barra = document.getElementById('feira-lojas');
    if (!barra) return;
    const escolhida = lerFeiraCliente();
    const { feira, doCliente } = feiraDoCliente(feiras, escolhida, diaBR());
    const antes = FEIRA_CLIENTE && FEIRA_CLIENTE.id; FEIRA_CLIENTE = doCliente ? feira : null;
    if ((FEIRA_CLIENTE && FEIRA_CLIENTE.id) !== antes) { try { document.dispatchEvent(new CustomEvent('feira-do-cliente')); } catch (_) { /* navegador antigo */ } }
    try { document.dispatchEvent(new CustomEvent('feiras-da-loja')); } catch (_) { /* navegador antigo */ }
    if (doCliente) { gravarUltimaBanca(feira.id, TENANT); montarFaixa(barra, feira, feira.id); aplicarAppDaFeira(feira); return; }
    if (escolhida) { barra.hidden = true; return; }             // cliente de outra feira: nenhuma banca de fora aparece aqui
    montarFaixa(barra, feira);
}

function montarFaixa(barra, feira, fid = '') {
    const lojas = lojasValidas(feira), link = (id) => (fid ? comFeira(urlDaLoja(id), fid) : urlDaLoja(id));
    if (lojas.length < 2) { barra.hidden = true; return; }
    barra.textContent = '';
    lojas.forEach((l) => {
        const a = document.createElement('a');
        a.href = link(l.id); a.className = 'feira-loja' + (l.id === TENANT ? ' atual' : '');
        if (l.id === TENANT) a.setAttribute('aria-current', 'page');
        const ponto = document.createElement('i'); if (cor(l.cor)) ponto.style.background = l.cor;
        a.append(ponto, document.createTextNode(l.nome));
        barra.appendChild(a);
    });
    barra.hidden = false;
    barra.querySelector('.atual')?.scrollIntoView({ inline: 'center', block: 'nearest' });

    // deslizar o cabeçalho para o lado = loja vizinha
    const cab = document.getElementById('header-principal');
    const i = lojas.findIndex((l) => l.id === TENANT);
    if (!cab || i < 0 || cab.dataset.deslize) return;
    cab.dataset.deslize = '1';
    let x0 = null, y0 = null;
    cab.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    cab.addEventListener('touchend', (e) => {
        if (x0 === null || barra.hidden) return;
        const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
        if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
        const vizinha = lojas[i + (dx < 0 ? 1 : -1)];
        if (vizinha) location.href = link(vizinha.id);
    }, { passive: true });
}

// Cliente da feira que instala o app de dentro de uma banca: o ícone abre a tela da FEIRA, não só esta banca.
function aplicarAppDaFeira(feira) {
    if (!feira || !feira.id || lojasValidas(feira).length < 2) return;
    let m = document.querySelector('link[rel="manifest"]');
    if (!m) { m = document.createElement('link'); m.rel = 'manifest'; document.head.appendChild(m); }
    m.href = `/api/manifest?feira=${encodeURIComponent(feira.id)}`;
    _appDe = TENANT;                                                          // a ficha da loja não troca de volta depois
}

/**
 * A feira do cliente muda quando ele escolhe um condomínio que é de uma feira desta banca.
 * Devolve a feira escolhida (ou '' se o condomínio não é de feira nenhuma daqui).
 * Com duas feiras no mesmo condomínio, `perguntar(lista)` decide (devolve o id).
 */
export async function feiraPeloCondominio(condominio, perguntar) {
    const achadas = feirasDoCondominio(FEIRAS_DA_LOJA, condominio);
    if (!achadas.length) return '';
    const atual = lerFeiraCliente();
    if (achadas.some((f) => f.id === atual)) return atual;
    let id = achadas[0].id;
    if (achadas.length > 1 && typeof perguntar === 'function') { try { id = (await perguntar(achadas)) || id; } catch (_) { /* fica a primeira */ } }
    gravarFeiraCliente(id);
    montarFeira(FEIRAS_DA_LOJA);
    return id;
}
/** A conta trouxe a feira (celular novo): vale se este aparelho ainda não tem uma. */
export function feiraDaConta(id) {
    if (!id || lerFeiraCliente()) return;
    gravarFeiraCliente(id); montarFeira(FEIRAS_DA_LOJA);
}

// ---------------------------------------------------------------------
// PRÉVIA (loja aberta dentro do painel, em /previa): o painel manda a aparência que está sendo
// mexida e a loja mostra na hora, sem gravar. Só vale mensagem da PRÓPRIA página que abriu a prévia
// (mesmo endereço). Os valores passam pelas mesmas conferências da ficha gravada.
// ---------------------------------------------------------------------
let FICHA_PREVIA = null, FICHA_GRAVADA = null;
const textoAte = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
if (EM_PREVIA && typeof window !== 'undefined' && window.parent && window.parent !== window) {
    window.addEventListener('message', (e) => {
        if (e.source !== window.parent || e.origin !== location.origin) return;
        const d = e.data;
        if (!d || d.tipo !== 'banca-previa' || !d.ficha || typeof d.ficha !== 'object') return;
        const f = d.ficha;
        const n = { nome: textoAte(f.nome, 60), subtitulo: textoAte(f.subtitulo, 120), nota: textoAte(f.nota, 200), tema: f.tema && typeof f.tema === 'object' ? f.tema : null };
        FICHA_PREVIA = Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined));     // campo que não veio não apaga o gravado
        aplicarFicha({ ...(FICHA_GRAVADA || {}), ...FICHA_PREVIA });
    });
    try { window.parent.postMessage({ tipo: 'banca-previa-pronta' }, location.origin); } catch (_) { /* painel fechado */ }
}

/**
 * Link da feira: se ESTA banca não está (ligada) na feira, vai para a primeira banca ligada dela.
 * Devolve true quando mandou o navegador para outra banca.
 */
async function irParaBancaDaFeira(fid, feiras) {
    const aqui = feiras.find((f) => f.id === fid);
    if (aqui && (aqui.lojas || []).some((l) => l && l.id === TENANT)) return false;
    let feira = aqui;
    if (!feira) { try { const s = await getDoc(doc(db, 'feiras', fid)); feira = s.exists() ? s.data() : null; } catch (_) { feira = null; } }
    for (const l of lojasValidas(feira)) {
        if (l.id === TENANT) continue;
        if (!aqui) { try { const f = await getDoc(doc(db, 'tenants', l.id)); if (f.exists() && f.data().ativo === false) continue; } catch (_) { /* tenta assim mesmo */ } }
        location.replace(comFeira(urlDaLoja(l.id), fid)); return true;
    }
    return false;
}

/** Chamado uma vez pela loja. Usa a ficha guardada no aparelho na hora e confere no banco depois. */
export async function iniciarTema() {
    // veio pelo link da feira (?feira=id): este aparelho passa a ser desta feira
    const doLink = feiraDoEndereco({ search: location.search });
    if (doLink) gravarFeiraCliente(doLink);
    // veio pelo LINK DA FEIRA (/feira/id manda para cá com &entrar=1): abre direto a última banca que o
    // cliente usou nesta feira. Na primeira vez fica nesta, se ela for da feira (conferido mais abaixo).
    const entrando = !!doLink && new URLSearchParams(location.search).has('entrar');
    if (entrando) {
        try { const u = new URL(location.href); u.searchParams.delete('entrar'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (_) { /* segue */ }
        const ultima = lerUltimaBanca(doLink);
        if (ultima && ultima !== TENANT) { location.replace(comFeira(urlDaLoja(ultima), doLink)); return null; }
    }
    const K = chave('banca_ficha');
    try {
        const g = JSON.parse(localStorage.getItem(K) || 'null');
        if (g) {
            aplicarFicha(g.ficha, g.v >= 2);
            FEIRAS_DA_LOJA = g.v === 3 && Array.isArray(g.feiras) ? g.feiras : [];
            if (g.v === 3) montarFeira(FEIRAS_DA_LOJA);
            else if (!lerFeiraCliente()) montarFaixa(document.getElementById('feira-lojas') || document.createElement('nav'), Array.isArray(g.feiras) ? feiraDoDia(g.feiras, diaBR()) : g.feira);
        }
    } catch (_) { /* sem cache */ }
    try {
        const s = await getDoc(fichaRef());
        const ficha = s.exists() ? s.data() : null;
        // a loja pode estar em várias feiras: lê todas (com o id) e mostra a do cliente (ou a de hoje)
        const feirasCruas = (await Promise.all(feirasDaFicha(ficha).map((id) => getDoc(doc(db, 'feiras', id)).then((f) => (f.exists() ? { ...f.data(), id } : null)).catch(() => null)))).filter(Boolean);
        // a feira guarda uma CÓPIA do nome e da cor de cada banca: confere a ficha de verdade (banca bloqueada some,
        // nome e cor novos aparecem). Sem resposta da ficha, fica a cópia.
        const ids = [...new Set(feirasCruas.flatMap((f) => (f.lojas || []).map((l) => l && l.id)).filter((x) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(x || '') && x !== TENANT))].slice(0, 24);
        const vivas = new Map(await Promise.all(ids.map((id) => getDoc(doc(db, 'tenants', id)).then((f) => [id, f.exists() ? f.data() : null]).catch(() => [id, undefined]))));
        if (ficha) vivas.set(TENANT, ficha);
        const feiras = feirasCruas.map((f) => ({ ...f, lojas: (f.lojas || []).filter((l) => { const v = vivas.get(l && l.id); return !(v && v.ativo === false); })
            .map((l) => { const v = vivas.get(l.id); return v ? { ...l, nome: v.nome || l.nome, cor: (v.tema && v.tema.primaria) || l.cor } : l; }) }));
        if (entrando && await irParaBancaDaFeira(doLink, feiras)) return null;
        FICHA_GRAVADA = ficha;
        if (ficha || FICHA_PREVIA) aplicarFicha({ ...(ficha || {}), ...(FICHA_PREVIA || {}) });
        FEIRAS_DA_LOJA = feiras;
        montarFeira(feiras);
        try { localStorage.setItem(K, JSON.stringify({ v: 3, ficha: ficha && { nome: ficha.nome, subtitulo: ficha.subtitulo, nota: ficha.nota, tema: ficha.tema, feiraId: ficha.feiraId, feiras: ficha.feiras || null, tipo: ficha.tipo || '', modulos: ficha.modulos || null, busca: ficha.busca || '' }, feiras })); } catch (_) { /* cheio */ }
        return ficha;
    } catch (e) { console.warn('[tema] usando o visual guardado:', e && e.code); return null; }
}
