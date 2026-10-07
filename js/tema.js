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
import { TENANT, fichaRef, chave, urlDaLoja, ehLojaOriginal } from './tenant.js';
import { ARTES, arteDoTipo } from './arte-lib.js';

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

/** Fontes que o painel oferece. Para acrescentar uma: ponha aqui e ela aparece no painel. */
export const FONTES = {
    titulo: { Fraunces: "'Fraunces', Georgia, serif", 'Bricolage Grotesque': "'Bricolage Grotesque', system-ui, sans-serif", 'Playfair Display': "'Playfair Display', Georgia, serif", Oswald: "'Oswald', 'Arial Narrow', sans-serif", Lora: "'Lora', Georgia, serif" },
    texto: { Figtree: "'Figtree', system-ui, sans-serif", 'Nunito Sans': "'Nunito Sans', system-ui, sans-serif", 'DM Sans': "'DM Sans', system-ui, sans-serif", Barlow: "'Barlow', system-ui, sans-serif" },
};
const NO_SITE = new Set(['Fraunces', 'Figtree']);          // já carregadas pelo index.html

/** Modelos prontos (ponto de partida no painel). */
export const MODELOS = {
    hortifruti: { primaria: '#1a3a2a', secundaria: '#4a9467', destaque: '#c4773a', fundo: '#faf7f2', superficie: '#ffffff', texto: '#1a1a18', sobrePrimaria: '#ffffff', fonteTitulo: 'Fraunces', fonteTexto: 'Figtree', raio: 14, etiqueta: 'barbante' },
    espetinhos: { primaria: '#b3261e', secundaria: '#e8622c', destaque: '#f2b33d', fundo: '#141110', superficie: '#211c1a', texto: '#f4ece6', sobrePrimaria: '#ffffff', fonteTitulo: 'Oswald', fonteTexto: 'Barlow', raio: 8, etiqueta: 'limpa' },
    jantinha: { primaria: '#7a2e12', secundaria: '#c8662e', destaque: '#e0a23a', fundo: '#fbf3e7', superficie: '#fffaf2', texto: '#2a1c14', sobrePrimaria: '#fff8ef', fonteTitulo: 'Lora', fonteTexto: 'Nunito Sans', raio: 18, etiqueta: 'limpa' },
};

/** Formatos da área da foto no cartão do produto: rótulo e proporção (largura / altura). */
export const FOTO_FORMATOS = { quadrada: ['Quadrada', '1 / 1'], alta: ['Em pé', '4 / 5'], 'bem-alta': ['Bem em pé (pacotes, garrafas)', '2 / 3'], larga: ['Deitada', '4 / 3'] };

const cor = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/** Transforma um tema em variáveis de CSS. Devolve { variaveis, classes } sem tocar na página. */
export function variaveisDoTema(tema) {
    const t = tema || {}, v = {};
    const p = cor(t.primaria), s = cor(t.secundaria), d = cor(t.destaque), f = cor(t.fundo), sup = cor(t.superficie), tx = cor(t.texto), sp = cor(t.sobrePrimaria);
    const fundo = f || 'var(--cream)', superf = sup || '#ffffff';
    if (p) { v['--forest'] = p; v['--forest-mid'] = mix(p, 82, superf); }
    if (s) { v['--leaf'] = s; v['--mint'] = mix(s, 62, superf); v['--mint-dark'] = mix(s, 78, tx || '#000000'); v['--sage'] = mix(s, 38, superf); v['--foam'] = mix(s, 14, superf); }
    if (d) { v['--earth'] = d; v['--earth-light'] = mix(d, 70, superf); v['--earth-forte'] = mix(d, 72, tx || '#000000'); v['--manga'] = d; }
    if (f) { v['--cream'] = f; v['--parchment'] = mix(f, 90, tx || '#000000'); }
    if (sup) { v['--superficie'] = sup; v['--warm-white'] = sup; }
    if (tx) { v['--text-dark'] = tx; v['--text-mid'] = mix(tx, 76, fundo); v['--text-light'] = mix(tx, 58, fundo); v['--linha'] = mix(tx, 16, fundo); }
    if (sp) v['--sobre-primaria'] = sp;
    if (FONTES.titulo[t.fonteTitulo]) v['--fonte-titulo'] = FONTES.titulo[t.fonteTitulo];
    if (FONTES.texto[t.fonteTexto]) v['--fonte-texto'] = FONTES.texto[t.fonteTexto];
    const raio = Number(t.raio);
    if (Number.isFinite(raio) && raio >= 0 && raio <= 28) { v['--raio-card'] = `${raio}px`; v['--radius'] = `${Math.round(raio * 1.4)}px`; v['--radius-sm'] = `${Math.max(4, Math.round(raio * 0.85))}px`; }
    // FOTO DO PRODUTO: cada loja escolhe o formato da área (quadrada, em pé, deitada) e se a foto preenche ou aparece inteira
    if (FOTO_FORMATOS[t.fotoFormato]) v['--foto-proporcao'] = FOTO_FORMATOS[t.fotoFormato][1];
    if (t.fotoFormato === 'alta') v['--foto-hero'] = '1 / 1'; else if (t.fotoFormato === 'bem-alta') v['--foto-hero'] = '4 / 5';   // a foto grande, ao abrir o produto, acompanha
    if (t.fotoEncaixe === 'inteira') v['--foto-encaixe'] = 'contain';
    // etiqueta: em tema escuro o "papel" claro continua claro (é um objeto), com tinta escura
    return { variaveis: v, classes: { 'etiqueta-limpa': t.etiqueta === 'limpa' } };
}

const carregarFonte = (nome) => {
    // só as fontes da nossa lista: o nome vem da ficha da loja e antes entrava direto num seletor e num endereço
    if (typeof nome !== 'string' || !(FONTES.titulo[nome] || FONTES.texto[nome])) return;
    if (NO_SITE.has(nome) || [...document.querySelectorAll('link[data-fonte]')].some((l) => l.dataset.fonte === nome)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.dataset.fonte = nome;
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(nome).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;
    document.head.appendChild(l);
};

/** Aplica o tema em um elemento (a página inteira, ou a prévia do painel). */
export function aplicarTema(tema, alvo = document.documentElement) {
    const { variaveis, classes } = variaveisDoTema(tema);
    (alvo._temaVars || []).forEach((k) => alvo.style.removeProperty(k));
    Object.entries(variaveis).forEach(([k, val]) => alvo.style.setProperty(k, val));
    alvo._temaVars = Object.keys(variaveis);
    Object.entries(classes).forEach(([c, on]) => alvo.classList.toggle(c, !!on));
    if (tema) { carregarFonte(tema.fonteTitulo); carregarFonte(tema.fonteTexto); }
    if (alvo === document.documentElement && tema && cor(tema.primaria)) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tema.primaria);
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
// TROCA DE LOJA — as lojas da mesma feira aparecem numa faixa no topo.
// Tocar numa delas (ou deslizar o cabeçalho para o lado) abre a outra loja,
// já com as cores dela. feiras/{id} = { nome, lojas: [{ id, nome, cor }] }
// ---------------------------------------------------------------------
function montarFeira(feira) {
    const barra = document.getElementById('feira-lojas');
    const lojas = ((feira && feira.lojas) || []).filter((l) => l && /^[a-z0-9][a-z0-9-]{1,39}$/.test(l.id || '') && l.nome);
    if (!barra || lojas.length < 2) { if (barra) barra.hidden = true; return; }
    barra.textContent = '';
    lojas.forEach((l) => {
        const a = document.createElement('a');
        a.href = urlDaLoja(l.id); a.className = 'feira-loja' + (l.id === TENANT ? ' atual' : '');
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
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
        if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
        const vizinha = lojas[i + (dx < 0 ? 1 : -1)];
        if (vizinha) location.href = urlDaLoja(vizinha.id);
    }, { passive: true });
}

/** Chamado uma vez pela loja. Usa a ficha guardada no aparelho na hora e confere no banco depois. */
export async function iniciarTema() {
    const K = chave('banca_ficha');
    try { const g = JSON.parse(localStorage.getItem(K) || 'null'); if (g) { aplicarFicha(g.ficha, g.v === 2); montarFeira(g.feira); } } catch (_) { /* sem cache */ }
    try {
        const s = await getDoc(fichaRef());
        const ficha = s.exists() ? s.data() : null;
        let feira = null;
        if (ficha && /^[a-z0-9][a-z0-9-]{1,39}$/.test(ficha.feiraId || '')) {
            const f = await getDoc(doc(db, 'feiras', ficha.feiraId)); feira = f.exists() ? f.data() : null;
        }
        if (ficha) aplicarFicha(ficha);
        montarFeira(feira);
        try { localStorage.setItem(K, JSON.stringify({ v: 2, ficha: ficha && { nome: ficha.nome, subtitulo: ficha.subtitulo, nota: ficha.nota, tema: ficha.tema, feiraId: ficha.feiraId, tipo: ficha.tipo || '', modulos: ficha.modulos || null, busca: ficha.busca || '' }, feira })); } catch (_) { /* cheio */ }
        return ficha;
    } catch (e) { console.warn('[tema] usando o visual guardado:', e && e.code); return null; }
}
