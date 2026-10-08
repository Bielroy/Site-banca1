// =====================================================================
//  js/aparencia-lib.js — o TEMA de uma loja, conferido antes de usar.
//
//  A aparência fica na ficha pública da loja e é escrita por quem administra
//  aquela loja. Quem abre a tela de Aparência pode ser OUTRA pessoa (o outro
//  administrador, o dono da plataforma). Por isso nada do que está gravado
//  vai para a tela sem conferir: cor só no formato #rrggbb, fonte e formato
//  só os da lista, número só número, imagem só endereço https. O que não
//  passar volta ao padrão.
//  Aqui também ficam as contas de COR (contraste, cor legível, paleta a partir
//  de uma cor só), usadas pela loja (js/tema.js) e pelo painel.
//  Arquivo puro (sem navegador), para os testes poderem conferir.
// =====================================================================
const COR = /^#[0-9a-fA-F]{6}$/;
export const corValida = (v) => typeof v === 'string' && COR.test(v);

/**
 * Escolhas de "jeito" da loja (a 1ª de cada lista é o padrão, que é o visual de sempre).
 * Para acrescentar uma opção: ponha aqui, no CSS (css/aparencia-loja.css) e no painel.
 * O banco aceita textos de até 20 letras nesses campos (firestore.rules, temaOk).
 */
export const OPCOES = {
    etiqueta: ['barbante', 'limpa', 'selo'],
    fotoEncaixe: ['preencher', 'inteira'],
    cabecalho: ['cor', 'degrade', 'capa'],
    borda: ['toldo', 'onda', 'reta'],
    arte: ['mostrar', 'esconder'],
    alinhamento: ['esquerda', 'centro'],
    logoFormato: ['redondo', 'quadrado'],
    botaoFormato: ['pilula', 'arredondado', 'quadrado'],
    card: ['borda', 'sombra', 'plano'],
    fundoEstilo: ['liso', 'papel', 'pontos', 'listras'],
    letra: ['normal', 'grande'],
};
/** Cores opcionais: sem elas, a loja usa a cor principal (ex.: botões). */
export const CORES_OPCIONAIS = ['botao'];

/** Endereço de imagem aceito (logo e capa): só https, sem espaço nem caracteres que escapem de um atributo ou do CSS. */
export function urlImagem(v) {
    if (typeof v !== 'string' || v.length < 12 || v.length > 500) return '';
    if (!/^https:\/\/[A-Za-z0-9._~:/?#@!$&*+,;=%-]+$/.test(v)) return '';     // a mesma lista de firestore.rules (urlOk)
    try { const u = new URL(v); return u.protocol === 'https:' && u.hostname.includes('.') ? v : ''; } catch (_) { return ''; }
}

/**
 * Devolve um tema só com campos conhecidos e valores válidos.
 * cfg = { padrao, cores: ['primaria', ...], fontesTitulo: {...}, fontesTexto: {...}, formatos: {...} }
 */
export function temaSeguro(bruto, cfg) {
    const t = bruto && typeof bruto === 'object' ? bruto : {}, saida = { ...cfg.padrao };
    for (const k of cfg.cores) if (corValida(t[k])) saida[k] = t[k];
    for (const k of CORES_OPCIONAIS) { if (corValida(t[k])) saida[k] = t[k]; else delete saida[k]; }
    if (typeof t.fonteTitulo === 'string' && Object.prototype.hasOwnProperty.call(cfg.fontesTitulo, t.fonteTitulo)) saida.fonteTitulo = t.fonteTitulo;
    if (typeof t.fonteTexto === 'string' && Object.prototype.hasOwnProperty.call(cfg.fontesTexto, t.fonteTexto)) saida.fonteTexto = t.fonteTexto;
    const raio = Number(t.raio);
    if (t.raio !== null && t.raio !== '' && Number.isFinite(raio) && raio >= 0 && raio <= 24) saida.raio = Math.round(raio);
    if (typeof t.fotoFormato === 'string' && Object.prototype.hasOwnProperty.call(cfg.formatos, t.fotoFormato)) saida.fotoFormato = t.fotoFormato;
    for (const [k, lista] of Object.entries(OPCOES)) if (lista.includes(t[k])) saida[k] = t[k];
    for (const k of ['logo', 'capa']) { const u = urlImagem(t[k]); if (u) saida[k] = u; else delete saida[k]; }
    for (const k of Object.keys(saida)) if (saida[k] === undefined) delete saida[k];     // o banco recusa campo "indefinido"
    return saida;
}

/** Número para pôr dentro de um campo de formulário: só número mesmo; qualquer outra coisa vira vazio. */
export function numeroDeCampo(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'object' || typeof v === 'boolean') return '';
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : '';
}

// ---------------------------------------------------------------------
// LISTAS DO PAINEL (letras, modelos, formatos da foto). Aqui, e não em js/tema.js, para os testes conferirem.
// ---------------------------------------------------------------------
/** Fontes que o painel oferece. Para acrescentar uma: ponha aqui e ela aparece no painel (e em PESOS, se não tiver o 600). */
export const FONTES = {
    titulo: {
        Fraunces: "'Fraunces', Georgia, serif", 'Bricolage Grotesque': "'Bricolage Grotesque', system-ui, sans-serif", 'Playfair Display': "'Playfair Display', Georgia, serif",
        Oswald: "'Oswald', 'Arial Narrow', sans-serif", Lora: "'Lora', Georgia, serif", Merriweather: "'Merriweather', Georgia, serif",
        Poppins: "'Poppins', system-ui, sans-serif", Montserrat: "'Montserrat', system-ui, sans-serif", 'Baloo 2': "'Baloo 2', system-ui, sans-serif",
        Rubik: "'Rubik', system-ui, sans-serif", Pacifico: "'Pacifico', cursive",
    },
    texto: {
        Figtree: "'Figtree', system-ui, sans-serif", 'Nunito Sans': "'Nunito Sans', system-ui, sans-serif", 'DM Sans': "'DM Sans', system-ui, sans-serif",
        Barlow: "'Barlow', system-ui, sans-serif", Inter: "'Inter', system-ui, sans-serif", Poppins: "'Poppins', system-ui, sans-serif",
        Montserrat: "'Montserrat', system-ui, sans-serif", Rubik: "'Rubik', system-ui, sans-serif", Lato: "'Lato', system-ui, sans-serif",
    },
};
// Pesos pedidos ao Google Fonts. Pedir um peso que a fonte não tem derruba o pedido inteiro.
export const PESOS = { Merriweather: '400;700', Lato: '400;700', Pacifico: '' };
/** Endereço do Google Fonts para uma letra da lista (vazio se não for da lista). */
export function linkDaFonte(nome) {
    if (typeof nome !== 'string' || !(Object.prototype.hasOwnProperty.call(FONTES.titulo, nome) || Object.prototype.hasOwnProperty.call(FONTES.texto, nome))) return '';
    const pesos = Object.prototype.hasOwnProperty.call(PESOS, nome) ? PESOS[nome] : '400;600;700';
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(nome).replace(/%20/g, '+')}${pesos ? `:wght@${pesos}` : ''}&display=swap`;
}
/** Modelos prontos (ponto de partida no painel). Só cores, letras e o "jeito"; nome, logo e capa ficam. */
export const MODELOS = {
    hortifruti: { primaria: '#1a3a2a', secundaria: '#4a9467', destaque: '#c4773a', fundo: '#faf7f2', superficie: '#ffffff', texto: '#1a1a18', sobrePrimaria: '#ffffff', fonteTitulo: 'Fraunces', fonteTexto: 'Figtree', raio: 14, etiqueta: 'barbante' },
    espetinhos: { primaria: '#b3261e', secundaria: '#e8622c', destaque: '#f2b33d', fundo: '#141110', superficie: '#211c1a', texto: '#f4ece6', sobrePrimaria: '#ffffff', fonteTitulo: 'Oswald', fonteTexto: 'Barlow', raio: 8, etiqueta: 'limpa' },
    jantinha: { primaria: '#7a2e12', secundaria: '#c8662e', destaque: '#e0a23a', fundo: '#fbf3e7', superficie: '#fffaf2', texto: '#2a1c14', sobrePrimaria: '#fff8ef', fonteTitulo: 'Lora', fonteTexto: 'Nunito Sans', raio: 18, etiqueta: 'limpa' },
    padaria: { primaria: '#5b3a1e', secundaria: '#b9853f', destaque: '#d9a441', fundo: '#f7efe3', superficie: '#fffdf8', texto: '#2b1d10', sobrePrimaria: '#fff8ec', fonteTitulo: 'Playfair Display', fonteTexto: 'Lato', raio: 12, etiqueta: 'barbante', fundoEstilo: 'papel' },
    acai: { primaria: '#4a1650', secundaria: '#8e3a8f', destaque: '#f0b21a', fundo: '#f8f2f8', superficie: '#ffffff', texto: '#24102a', sobrePrimaria: '#ffffff', fonteTitulo: 'Baloo 2', fonteTexto: 'Poppins', raio: 20, etiqueta: 'selo', botaoFormato: 'pilula', card: 'sombra' },
    mercadinho: { primaria: '#0f4c81', secundaria: '#2f8fd8', destaque: '#f2a516', fundo: '#f2f6fa', superficie: '#ffffff', texto: '#14212e', sobrePrimaria: '#ffffff', fonteTitulo: 'Montserrat', fonteTexto: 'Inter', raio: 10, etiqueta: 'selo', botaoFormato: 'arredondado', card: 'borda', borda: 'reta' },
    doceria: { primaria: '#c2416b', secundaria: '#e88aa8', destaque: '#7a3b2e', fundo: '#fdf3f5', superficie: '#ffffff', texto: '#3a1a24', sobrePrimaria: '#ffffff', fonteTitulo: 'Pacifico', fonteTexto: 'Nunito Sans', raio: 22, etiqueta: 'limpa', card: 'sombra', fundoEstilo: 'pontos', borda: 'onda' },
    natural: { primaria: '#3d5a40', secundaria: '#8aa87a', destaque: '#d08c3d', fundo: '#f3f1e8', superficie: '#fbfaf5', texto: '#1f2a20', sobrePrimaria: '#ffffff', fonteTitulo: 'Merriweather', fonteTexto: 'DM Sans', raio: 16, etiqueta: 'barbante', card: 'plano', fundoEstilo: 'papel' },
    noite: { primaria: '#1c1c1e', secundaria: '#3ddc84', destaque: '#3ddc84', fundo: '#0e0e10', superficie: '#1a1a1d', texto: '#f2f2f2', sobrePrimaria: '#ffffff', botao: '#3ddc84', fonteTitulo: 'Rubik', fonteTexto: 'Inter', raio: 12, etiqueta: 'selo', botaoFormato: 'arredondado', card: 'borda', borda: 'reta', cabecalho: 'degrade' },
};
/** Nomes dos modelos no painel. */
export const NOMES_MODELOS = { hortifruti: 'Hortifruti', espetinhos: 'Espetinhos', jantinha: 'Jantinha', padaria: 'Padaria', acai: 'Açaí', mercadinho: 'Mercadinho', doceria: 'Doceria', natural: 'Natural', noite: 'Noite' };

/** Formatos da área da foto no cartão do produto: rótulo e proporção (largura / altura). */
export const FOTO_FORMATOS = { quadrada: ['Quadrada', '1 / 1'], alta: ['Em pé', '4 / 5'], 'bem-alta': ['Bem em pé (pacotes, garrafas)', '2 / 3'], larga: ['Deitada', '4 / 3'] };

// ---------------------------------------------------------------------
// CONTAS DE COR
// ---------------------------------------------------------------------
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Mistura duas cores: pct% de a com o resto de b. */
export const misturar = (a, pct, b) => { const x = rgb(a), y = rgb(b); return hex(...x.map((v, i) => (v * pct + y[i] * (100 - pct)) / 100)); };
const luminancia = (c) => { const v = rgb(c).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
/** Contraste entre duas cores (regra WCAG): 4,5 ou mais é texto fácil de ler; 3 serve para letra grande e contornos. */
export const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const ehEscura = (c) => luminancia(c) < 0.18;
/** A cor de texto que se lê melhor em cima de `fundo`: branco ou quase preto. */
export const legivelSobre = (fundo, claro = '#ffffff', escuro = '#1a1a18') => (contraste(fundo, claro) >= contraste(fundo, escuro) ? claro : escuro);
/**
 * A mesma cor, clareada ou escurecida só o necessário para ler bem em cima de TODOS os fundos dados.
 * Ex.: vermelho-escuro como cor de texto num fundo escuro vira um vermelho mais claro.
 */
export function corLegivel(cor, fundos, alvo = 4.5) {
    const lista = (Array.isArray(fundos) ? fundos : [fundos]).filter(corValida);
    if (!corValida(cor) || !lista.length) return cor;
    const pior = (c) => Math.min(...lista.map((f) => contraste(c, f)));
    if (pior(cor) >= alvo) return cor;
    const direcao = lista.every(ehEscura) ? '#ffffff' : lista.every((f) => !ehEscura(f)) ? '#000000' : null;
    const rumos = direcao ? [direcao] : ['#ffffff', '#000000'];
    let melhor = cor, nota = pior(cor);
    for (const r of rumos) {
        for (let p = 90; p >= 0; p -= 10) {
            const c = misturar(cor, p, r), n = pior(c);
            if (n >= alvo) return c;
            if (n > nota) { melhor = c; nota = n; }
        }
    }
    return melhor;
}

const paraHsl = (c) => {
    const [r, g, b] = rgb(c).map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
};
const deHsl = (h, s, l) => {
    h = ((h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    if (!s) return hex(l * 255, l * 255, l * 255);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const canal = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return hex(canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255);
};

/**
 * Monta as cores da loja a partir de UMA cor (a principal), no modo claro ou escuro.
 * Devolve só as cores; letras, cantos e o resto ficam como estão.
 */
export function paletaDeUmaCor(base, modo = 'claro') {
    if (!corValida(base)) return null;
    const [h, s0] = paraHsl(base), s = Math.max(0.25, Math.min(0.85, s0));
    const escuro = modo === 'escuro';
    const fundo = escuro ? deHsl(h, 0.14, 0.08) : deHsl(h, 0.32, 0.965);
    const superficie = escuro ? deHsl(h, 0.12, 0.13) : '#ffffff';
    const texto = escuro ? deHsl(h, 0.18, 0.93) : deHsl(h, 0.2, 0.11);
    const secundaria = deHsl(h + 22, Math.min(0.62, s), escuro ? 0.58 : 0.44);
    const destaque = deHsl(h + 165, 0.72, escuro ? 0.62 : 0.52);
    return { primaria: base, secundaria, destaque, fundo, superficie, texto, sobrePrimaria: legivelSobre(base) };
}

/** Avisos de leitura das cores escolhidas (para o painel). Cada um diz o que fazer e qual campo o "ajustar sozinho" corrige. */
export function avisosDeContraste(t) {
    const av = [], ok = (k) => corValida(t && t[k]);
    if (!t) return av;
    if (ok('primaria') && ok('sobrePrimaria') && contraste(t.primaria, t.sobrePrimaria) < 4.5) av.push({ campo: 'sobrePrimaria', texto: 'O texto do cabeçalho e dos botões está difícil de ler sobre a cor principal.' });
    if (ok('botao') && contraste(t.botao, legivelSobre(t.botao)) < 4.5) av.push({ campo: 'botao', texto: 'A cor dos botões não deixa ler bem o texto deles.' });
    if (ok('superficie') && ok('texto') && contraste(t.superficie, t.texto) < 4.5) av.push({ campo: 'texto', texto: 'O texto está com pouco contraste sobre o fundo dos cards.' });
    if (ok('fundo') && ok('texto') && contraste(t.fundo, t.texto) < 4.5) av.push({ campo: 'texto', texto: 'O texto está com pouco contraste sobre o fundo da página.' });
    return av.filter((a, i) => av.findIndex((b) => b.campo === a.campo) === i);
}

/** Corrige o campo apontado por um aviso de contraste. Devolve o tema novo (o original não muda). */
export function ajustarContraste(t, campo) {
    const n = { ...t };
    if (campo === 'sobrePrimaria' && corValida(n.primaria)) n.sobrePrimaria = legivelSobre(n.primaria);
    else if (campo === 'botao' && corValida(n.botao)) n.botao = corLegivel(n.botao, [legivelSobre(n.botao)]);
    else if (campo === 'texto' && corValida(n.texto)) n.texto = corLegivel(n.texto, [n.superficie, n.fundo]);
    return n;
}
