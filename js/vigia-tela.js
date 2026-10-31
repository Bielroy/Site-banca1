// =====================================================================
//  js/vigia-tela.js — VIGIA DA TELA: confere se algo QUEBROU no desenho da loja.
//
//  Não tira foto da tela e não compara com foto de referência: mede a página como ela está no
//  aparelho de quem abriu (largura, letra grande, iPhone ou Android) e procura defeito de verdade:
//    • rolagem-lateral  — a página ficou mais larga que a tela (dá para arrastar para o lado);
//    • fora-da-tela     — card, preço, nome ou botão saiu pela borda da tela;
//    • sai-do-card      — nome, preço, botão ou foto passou para fora do card;
//    • texto-cortado    — preço, nome ou texto de botão cortado no meio (sem "...") ou vazando;
//    • coberto          — algo está por cima do botão, do preço ou do nome (o "tomate na faixa");
//    • foto-quebrada    — foto de produto que não abriu (com internet e com as outras abrindo).
//  O site se adaptar (duas colunas virarem uma, botão crescer com a letra) NÃO é defeito.
//
//  Uso: os testes da matriz de telas (testes/tela/matriz.test.js) chamam verificarTela() em cada
//  tamanho de tela e tamanho de letra; na loja, iniciarVigia() roda a mesma conferência depois que a
//  vitrine aparece e manda o que achou para a aba Erros da Plataforma (js/erros-site.js → lib/erros.js).
//  Vai só o nome técnico do lugar (ex.: "card de produto › preço"), a regra e o tamanho da tela.
//  Nada do cliente. O mesmo defeito, no mesmo aparelho e na mesma versão do site, vai uma vez só.
// =====================================================================
import { avisarErro } from './erros-site.js';

export const REGRAS = {
    'rolagem-lateral': 'A página ficou mais larga que a tela',
    'fora-da-tela': 'Saiu pela borda da tela',
    'sai-do-card': 'Passou para fora do card',
    'texto-cortado': 'Texto cortado ou vazando',
    coberto: 'Tem algo por cima',
    'foto-quebrada': 'Foto que não abriu',
};

// o que importa para o cliente: comprar (nome, preço, botão) e se localizar (cabeçalho, categorias)
const CARDS = '#lista-produtos .produto-card, .faixa-rolo .produto-card';
const PARTES_DO_CARD = ['.produto-nome', '.etiqueta', '.etq-preco', '.card-acao button', '.btn-fav', '.produto-img-wrap'];
const IMPORTANTES = [
    '#header-principal', '#header-principal button', '#header-principal a',
    '.produto-nome', '.etq-preco', '.card-acao button', '#categorias .cat-btn', '#busca-input',
    '.site-rodape a', '#btn-carrinho-mobile',
].join(', ');
const TEXTOS = '.produto-nome, .etq-preco, .card-acao button, #categorias .cat-btn, #header-principal h1, #header-principal button, #header-principal a, .modo-btn';
const SEM_RETICENCIAS = '#header-principal button, #header-principal a, #categorias .cat-btn';
const ALVOS_DE_TOQUE = '.card-acao button, .etq-preco, .produto-nome, #categorias .cat-btn, #header-principal button';
// classes de estado não ajudam a achar o lugar no código
const CLASSE_DE_ESTADO = /^(ativo|aberto|active|show|visivel|skeleton|carregando|selecionad[oa]|tem-|is-|js-)/;
const NOMES = { 'produto-card': 'card de produto', 'produto-nome': 'nome', 'etq-preco': 'preço', etiqueta: 'etiqueta de preço', 'card-acao': 'botão do card', 'card-add': 'botão Adicionar',
    'btn-fav': 'coração', 'produto-img-wrap': 'foto', 'cat-btn': 'botão de categoria', 'faixa-rolo': 'faixa', 'header-principal': 'cabeçalho', 'lista-produtos': 'vitrine', 'site-rodape': 'rodapé', 'modo-btn': 'botão de jeito de comprar' };

const T = 1.5;   // folga em px (arredondamento do navegador)
/** Largura da tela. No CELULAR (toque), quando algo passa da borda o navegador "afasta" a página e innerWidth cresce junto
 *  (390 vira 772): por isso vale a largura da tela do aparelho (screen), deitada ou em pé. No COMPUTADOR vale a janela:
 *  a "tela do aparelho" não manda nada ali, e escâneres e testadores de site rodam com tela de mentira (800×600) e janela maior. */
export function larguraDaTela() {
    const toque = (navigator.maxTouchPoints || 0) > 0 && matchMedia('(pointer: coarse)').matches;
    if (!toque) return innerWidth;
    // A largura em que a página é DESENHADA (a do <meta viewport>): não cresce quando algo passa da borda, ao contrário de innerWidth.
    // Antes valia a "tela do aparelho" (screen), mas o Safari 26 do iPhone mente nela para proteger a privacidade
    // (um iPhone de 440px dizia 414px) e o vigia acusava o cabeçalho e a faixa, que ocupam a tela certinho.
    const cw = document.documentElement.clientWidth || 0;
    if (cw > 0) return Math.min(innerWidth, cw);
    const sw = (window.screen && screen.width) || 0, sh = (window.screen && screen.height) || 0;
    if (!sw || !sh) return innerWidth;
    const deitado = matchMedia('(orientation: landscape)').matches;
    return Math.min(innerWidth, deitado ? Math.max(sw, sh) : Math.min(sw, sh));
}
const r = (el) => el.getBoundingClientRect();
const estilo = (el) => getComputedStyle(el);

function visivel(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden], [aria-hidden="true"], .modal-overlay:not(.active):not(.aberto)')) return false;
    if (typeof el.checkVisibility === 'function') { if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false; }
    else { const s = estilo(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; }
    const b = r(el);
    return b.width > 0.5 && b.height > 0.5;
}

/** "card de produto › preço" (e o código: "#lista-produtos .produto-card .etq-preco"). */
export function descrever(el) {
    const partes = [], codigo = [];
    let e = el, n = 0;
    while (e && e !== document.body && n < 4) {
        const classes = [...e.classList].filter((c) => !CLASSE_DE_ESTADO.test(c) && !/--/.test(c));
        const chave = e.id || classes[0] || '';
        const tok = e.id ? `#${e.id}` : classes[0] ? `.${classes[0]}` : e.tagName.toLowerCase();
        if (chave || n === 0) { codigo.unshift(tok); if (NOMES[chave]) partes.unshift(NOMES[chave]); n++; }
        if (e.id) break;
        e = e.parentElement;
    }
    // onde na página: faixa que rola, vitrine, cabeçalho... (o mesmo card muda de desenho em cada lugar)
    const lugar = el.closest('.faixa-rolo, #lista-produtos, #header-principal, #categorias, .site-rodape, [role="dialog"]');
    if (lugar && lugar !== el) {
        const tok = lugar.id ? `#${lugar.id}` : `.${[...lugar.classList][0] || lugar.tagName.toLowerCase()}`, chave = lugar.id || [...lugar.classList][0] || '';
        if (!codigo.includes(tok)) { codigo.unshift(tok); if (NOMES[chave]) partes.unshift(NOMES[chave]); }
    }
    if (!partes.length) partes.push(codigo[codigo.length - 1] || el.tagName.toLowerCase());
    return { nome: [...new Set(partes)].join(' › '), codigo: codigo.join(' ') };
}
const exemploDe = (el) => { const c = el.closest('[data-id]'); return c ? String(c.dataset.id).slice(0, 40) : ''; };

/** Primeiro ancestral que rola para o lado (faixas, categorias): dentro dele, sair da tela é normal. */
function rolaDeLado(el) {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = estilo(e);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1) return e;
    }
    return null;
}
const fixoOuGrudado = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const p = estilo(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
/** Colado na tela AGORA: fixo, ou "sticky" que já grudou no topo. Um bloco "sticky" ainda no lugar normal é conteúdo comum que rola
 *  (a barra "Ver pedido" fixa por cima dele, numa tela curta, não é defeito: ele gruda no topo assim que a página rola). */
const coladoAgora = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = estilo(e);
        if (s.position === 'fixed') return e;
        if (s.position === 'sticky') { const t = parseFloat(s.top); if (Number.isFinite(t) && Math.abs(e.getBoundingClientRect().top - t) <= 1.5) return e; }
    }
    return null;
};

/** Área do elemento que dá para ver: a tela cortada por todo ancestral que esconde o que passa (overflow). */
function areaVisivel(el, { tela = true } = {}) {
    let a = tela ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
        const s = estilo(e);
        // o que rola (faixa, lista de categorias) não CORTA: dá para rolar até ver. Só conta quando se pergunta o que está na tela agora.
        const corta = (v) => v === 'hidden' || v === 'clip' || (tela && (v === 'auto' || v === 'scroll'));
        if (corta(s.overflowX) || corta(s.overflowY) || /paint|content|strict/.test(s.contain || '')) {
            const b = r(e);
            a = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
        }
        if (s.position === 'fixed') break;
        if (!tela && /auto|scroll/.test(s.overflowX + s.overflowY)) break;   // dentro do que rola, quem está fora não corta o conteúdo
    }
    return a;
}
/** Retângulo das letras do elemento (só o texto, juntando as linhas). */
function caixaDoTexto(el) {
    try {
        const rg = document.createRange(); rg.selectNodeContents(el);
        const rs = [...rg.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5);
        if (!rs.length) return null;
        return { left: Math.min(...rs.map((q) => q.left)), right: Math.max(...rs.map((q) => q.right)), top: Math.min(...rs.map((q) => q.top)), bottom: Math.max(...rs.map((q) => q.bottom)) };
    } catch (_) { return null; }
}
/** A caixa desenhada em volta do texto (fundo ou borda): o próprio botão, a etiqueta de preço, o card. */
function caixaVisual(el) {
    const fim = el.closest('.produto-card') || document.body;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
        const s = estilo(e);
        const fundo = s.backgroundImage !== 'none' || !/rgba\(.*,\s*0\)|transparent/.test(s.backgroundColor);
        if (fundo || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0) return e;
        if (e === fim) break;
    }
    return null;
}
const caixa = (b) => `x ${Math.round(b.left)}–${Math.round(b.right)}, y ${Math.round(b.top)}–${Math.round(b.bottom)}`;
const dentro = (b, a, folga = T) => b.left >= a.left - folga && b.right <= a.right + folga && b.top >= a.top - folga && b.bottom <= a.bottom + folga;
// a sacola aberta (gaveta + fundo escuro) também é janela: o que fica por baixo dela não está "coberto por defeito"
const umModalAberto = () => !!document.querySelector('.modal-overlay.active, .modal-overlay.aberto, dialog[open], .carrinho-overlay.aberto, #carrinho.aberto');

/**
 * Confere a tela como ela está agora. Devolve a lista de problemas (vazia = tudo certo):
 *   [{ regra, nome, codigo, exemplos: [ids de produto], vezes, detalhe }]
 */
export function verificarTela() {
    const achados = new Map();
    const anotar = (regra, el, detalhe = '') => {
        const d = descrever(el), k = `${regra}|${d.codigo}`;
        const a = achados.get(k) || { regra, nome: d.nome, codigo: d.codigo, exemplos: [], vezes: 0, detalhe };
        a.vezes++;
        const ex = exemploDe(el); if (ex && a.exemplos.length < 3 && !a.exemplos.includes(ex)) a.exemplos.push(ex);
        achados.set(k, a);
    };
    const modal = umModalAberto();
    const W = larguraDaTela();

    // 1. a página mais larga que a tela: aponta o elemento mais "fundo" que passou da borda
    const raiz = document.scrollingElement || document.documentElement;
    if (raiz.scrollWidth > W + 2) {
        const passam = [...document.body.querySelectorAll('*')].filter((el) => r(el).right > W + 2 && visivel(el) && !rolaDeLado(el));
        const culpado = passam.find((el) => !passam.some((o) => o !== el && el.contains(o)));   // o mais "de dentro"
        anotar('rolagem-lateral', culpado || document.body, `${raiz.scrollWidth}px numa tela de ${W}px`);
    }

    // 2. importante saindo pela borda da tela (fora das faixas que rolam para o lado)
    for (const el of document.querySelectorAll(IMPORTANTES)) {
        if (!visivel(el) || rolaDeLado(el)) continue;
        const b = r(el);
        if (b.left < -T || b.right > W + T) anotar('fora-da-tela', el, `${Math.round(b.left)}..${Math.round(b.right)} de 0..${W}px`);
    }

    // 3. partes do card fora do card. A foto pode ser recortada pelo card (é o normal); texto e botão, não.
    for (const card of document.querySelectorAll(CARDS)) {
        if (!visivel(card)) continue;
        const c = r(card);
        for (const sel of PARTES_DO_CARD) {
            for (const p of card.querySelectorAll(sel)) {
                if (!visivel(p)) continue;
                const b = r(p);
                if (sel === '.produto-img-wrap' || sel === '.btn-fav') {
                    // o que aparece da foto (cortada pelo que esconde o excesso) tem de ficar dentro do card
                    const a = areaVisivel(p, { tela: false }), vis = { left: Math.max(b.left, a.left), right: Math.min(b.right, a.right), top: Math.max(b.top, a.top), bottom: Math.min(b.bottom, a.bottom) };
                    if (vis.right > vis.left && vis.bottom > vis.top && !dentro(vis, c, 2)) anotar('sai-do-card', p, 'aparece fora do card');
                } else if (!dentro(b, c)) anotar('sai-do-card', p, `fora do card (${caixa(b)} no card ${caixa(c)})`);
            }
        }
        // a foto em si (não só a caixa): a que escapa da caixa e do card cobre os vizinhos
        for (const img of card.querySelectorAll('.produto-img-wrap img')) {
            if (!visivel(img)) continue;
            const b = r(img), a = areaVisivel(img, { tela: false });
            const vis = { left: Math.max(b.left, a.left), right: Math.min(b.right, a.right), top: Math.max(b.top, a.top), bottom: Math.min(b.bottom, a.bottom) };
            if (vis.right > vis.left && vis.bottom > vis.top && !dentro(vis, c, 2)) anotar('sai-do-card', img, 'foto aparece fora do card');
        }
    }

    // 4. texto cortado (sem reticências) por quem esconde o excesso, ou vazando da caixa desenhada em volta dele.
    //    Mede as LETRAS (não a caixa do elemento): linha apertada com a letra encostando não conta.
    for (const el of document.querySelectorAll(TEXTOS)) {
        if (!visivel(el) || !el.textContent.trim()) continue;
        const t = caixaDoTexto(el); if (!t) continue;
        const s = estilo(el);
        const reticencias = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none') || (s.lineClamp && s.lineClamp !== 'none');
        if (reticencias) {
            // "..." é de propósito no nome do produto; no botão do cabeçalho e na categoria, "Onde entr..." esconde o que o botão faz
            if (el.matches(SEM_RETICENCIAS) && (el.scrollWidth > el.clientWidth + 1 || [...el.querySelectorAll('*')].some((f) => f.scrollWidth > f.clientWidth + 1 && estilo(f).textOverflow === 'ellipsis'))) anotar('texto-cortado', el, 'cortado com "..."');
            continue;
        }
        if (el.matches(SEM_RETICENCIAS) && [...el.querySelectorAll('*')].some((f) => visivel(f) && f.scrollWidth > f.clientWidth + 1 && estilo(f).textOverflow === 'ellipsis')) { anotar('texto-cortado', el, 'cortado com "..."'); continue; }
        let corte = areaVisivel(el, { tela: false });
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const b = r(el); corte = { left: Math.max(corte.left, b.left), right: Math.min(corte.right, b.right), top: Math.max(corte.top, b.top), bottom: Math.min(corte.bottom, b.bottom) }; }
        if (t.left < corte.left - 2 || t.right > corte.right + 2 || t.top < corte.top - 4 || t.bottom > corte.bottom + 4) { anotar('texto-cortado', el, 'cortado sem "..."'); continue; }
        const caixa = caixaVisual(el);
        if (caixa) { const c = r(caixa); if (t.left < c.left - 2 || t.right > c.right + 2 || t.top < c.top - 4 || t.bottom > c.bottom + 4) anotar('texto-cortado', el, 'vazando da caixa'); }
    }

    // 5. algo por cima do que o cliente toca ou lê (sem janela aberta; o que é fixo/grudado de propósito não conta)
    if (!modal) {
        for (const el of document.querySelectorAll(ALVOS_DE_TOQUE)) {
            if (!visivel(el)) continue;
            const b = r(el), a = areaVisivel(el);
            const pontos = [[(b.left + b.right) / 2, (b.top + b.bottom) / 2], [b.left + Math.min(6, b.width / 4), (b.top + b.bottom) / 2], [b.right - Math.min(6, b.width / 4), (b.top + b.bottom) / 2]];
            let coberto = null;
            for (const [x, y] of pontos) {
                if (x < a.left + 1 || x > a.right - 1 || y < a.top + 1 || y > a.bottom - 1) continue;   // fora do que dá para ver
                const em = document.elementFromPoint(x, y);
                if (!em || el.contains(em) || em.contains(el)) continue;
                if (fixoOuGrudado(em) && !coladoAgora(el)) continue;                                  // cabeçalho, sacola flutuante, aviso (por cima do que ainda rola)
                if (em.closest('.toast, .voa, [class*="voando"], [class*="fly"]')) continue;          // animação passageira
                coberto = em; break;
            }
            if (coberto) anotar('coberto', el, `por ${descrever(coberto).codigo}`);
        }
    }

    // 6. foto de produto que não abriu — só com internet e com outras fotos abrindo (senão é a rede)
    const fotos = [...document.querySelectorAll('.produto-img-wrap img')].filter((i) => i.complete && i.getAttribute('src'));
    const abriram = fotos.filter((i) => i.naturalWidth > 0).length;
    if (navigator.onLine !== false && abriram > 0) {
        // foto antiga que SUMIU DO IMGBB não é defeito do site: a loja já esconde e o painel DELA avisa
        // (Produtos → "Conferir fotos fora do ar"). Na aba Erros ficava voltando a cada visita, sem nada para corrigir no código.
        for (const img of fotos) if (img.naturalWidth === 0 && !img.dataset.original && !img.dataset.foraDoAr && visivel(img.closest('.produto-card') || img)) anotar('foto-quebrada', img, 'não abriu');
    }
    return [...achados.values()];
}

/** O tamanho da tela e da letra, para saber em que aparelho o defeito aparece: "390px · letra 150%". */
export function telaAtual() {
    const raizPx = parseFloat(estilo(document.documentElement).fontSize) || 16;
    const letra = Math.round((raizPx / 16) * 20) * 5;   // de 5 em 5%
    return `${Math.round(larguraDaTela())}px${matchMedia('(orientation: landscape)').matches ? ' deitado' : ''} · letra ${letra}%`;
}

// --------------------------------------------------------------------------- na loja, no aparelho do cliente
const CHAVE = 'vigia_tela_v1';
const versaoDoSite = () => { try { const s = document.querySelector('script[type="module"][src*="/assets/"]'); return s ? s.getAttribute('src').split('/').pop().slice(0, 40) : 'dev'; } catch (_) { return ''; } };
function jaMandou() {
    try { const g = JSON.parse(localStorage.getItem(CHAVE) || '{}'); return g.v === versaoDoSite() ? g : { v: versaoDoSite(), a: [] }; }
    catch (_) { return { v: versaoDoSite(), a: [] }; }
}
const assinaturaLocal = (p) => `${p.regra}|${p.codigo}|${telaAtual().replace(/ · letra \d+%/, '')}`;

/** Manda o que achou (o que este aparelho já mandou nesta versão do site não vai de novo). Devolve quantos foram. */
export function relatarProblemas(problemas, { forcar = false } = {}) {
    const g = jaMandou(); let n = 0;
    for (const p of problemas) {
        const k = assinaturaLocal(p);
        if (!forcar && g.a.includes(k)) continue;
        avisarErro({ tipo: 'visual', msg: `${REGRAS[p.regra] || p.regra}: ${p.nome}`, arquivo: p.codigo, pilha: `${p.codigo}\n${p.detalhe}${p.exemplos.length ? `\nex.: ${p.exemplos.join(', ')}` : ''}\n${p.vezes} na tela`, tela: telaAtual() });
        g.a = [...g.a, k].slice(-40); n++;
    }
    try { localStorage.setItem(CHAVE, JSON.stringify(g)); } catch (_) { /* sem espaço ou janela anônima: segue */ }
    return n;
}

const ocioso = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));
let _rodadas = 0;
function conferirAgora() {
    if (_rodadas >= 4 || document.hidden) return;
    _rodadas++;
    ocioso(() => { try { relatarProblemas(verificarTela()); } catch (_) { /* o vigia nunca atrapalha a loja */ } });
}

/** Liga o vigia na loja: confere depois que a vitrine aparece, depois de rolar até perto do fim e depois de girar a tela. */
export function iniciarVigia() {
    if (window.__vigiaLigado) return; window.__vigiaLigado = true;
    let tentativas = 0;
    const esperarVitrine = () => {
        const pronta = document.querySelector('#lista-produtos .produto-card[data-id]') && !document.body.classList.contains('montando');
        if (pronta) return setTimeout(conferirAgora, 2500);                 // fotos e faixas assentarem
        if (++tentativas < 40) setTimeout(esperarVitrine, 500);
    };
    esperarVitrine();
    let rolouFundo = false, tRol = 0;
    addEventListener('scroll', () => {
        if (rolouFundo) return;
        clearTimeout(tRol);
        tRol = setTimeout(() => { const s = document.scrollingElement || document.documentElement; if (scrollY + innerHeight > s.scrollHeight * 0.6) { rolouFundo = true; conferirAgora(); } }, 800);
    }, { passive: true });
    let tGiro = 0;
    addEventListener('orientationchange', () => { clearTimeout(tGiro); tGiro = setTimeout(conferirAgora, 1500); });
    ligarBotaoDeRelato();
}

// --------------------------------------------------------------------------- "Algo estranho na tela?" (rodapé da loja)
// Opções fixas, sem campo de texto: assim nada do que o cliente escreveria (nome, telefone) vai junto.
const OPCOES = [
    ['cortado', 'Alguma coisa aparece cortada'],
    ['por-cima', 'Uma coisa está por cima de outra'],
    ['foto', 'Foto que não abre ou ficou estranha'],
    ['botao', 'Um botão não funciona'],
    ['outro', 'Outra coisa esquisita'],
];
function ligarBotaoDeRelato() {
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-relatar-tela]');
        if (b) { e.preventDefault(); abrirRelato(); return; }
        const op = e.target.closest && e.target.closest('[data-relato-opcao]');
        if (op) { e.preventDefault(); enviarRelato(op.dataset.relatoOpcao); return; }
        if (e.target.closest && (e.target.closest('[data-relato-fechar]') || e.target.id === 'relato-tela')) fecharRelato();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('relato-tela')) fecharRelato(); });
}
let _focoAntes = null;
function abrirRelato() {
    if (document.getElementById('relato-tela')) return;
    _focoAntes = document.activeElement;
    const fundo = document.createElement('div');
    fundo.id = 'relato-tela'; fundo.className = 'relato-tela'; fundo.setAttribute('role', 'dialog'); fundo.setAttribute('aria-modal', 'true'); fundo.setAttribute('aria-labelledby', 'relato-titulo');
    fundo.innerHTML = `<div class="relato-caixa">
        <h2 id="relato-titulo">O que ficou estranho?</h2>
        <p>A gente recebe o tamanho da tela e onde está o defeito. Nada do seu pedido nem dos seus dados.</p>
        <div class="relato-opcoes">${OPCOES.map(([k, t]) => `<button type="button" data-relato-opcao="${k}">${t}</button>`).join('')}</div>
        <button type="button" class="relato-fechar" data-relato-fechar>Fechar</button>
    </div>`;
    document.body.appendChild(fundo);
    setTimeout(() => { const p = fundo.querySelector('[data-relato-opcao]'); p && p.focus({ preventScroll: true }); }, 30);
}
function fecharRelato() {
    const f = document.getElementById('relato-tela'); if (f) f.remove();
    if (_focoAntes && _focoAntes.focus) try { _focoAntes.focus({ preventScroll: true }); } catch (_) { /* segue */ }
}
function enviarRelato(chave) {
    const texto = (OPCOES.find(([k]) => k === chave) || OPCOES[4])[1];
    fecharRelato();
    let achados = [];
    try { achados = verificarTela(); } catch (_) { /* segue sem */ }
    const resumo = achados.length ? achados.slice(0, 6).map((p) => `${REGRAS[p.regra]}: ${p.nome} (${p.codigo})`).join('\n') : 'As regras automáticas não acharam defeito nesta tela.';
    avisarErro({ tipo: 'relato', msg: `Cliente avisou: ${texto}`, arquivo: '', pilha: resumo, tela: telaAtual() });
    const aviso = document.createElement('div');
    aviso.className = 'relato-obrigado'; aviso.setAttribute('role', 'status'); aviso.textContent = 'Obrigado! A loja vai conferir.';
    document.body.appendChild(aviso); setTimeout(() => aviso.remove(), 3200);
}

// os testes chamam por aqui (a matriz de telas e os testes de tela)
if (typeof window !== 'undefined') window.__vigiaTela = { verificarTela, telaAtual, descrever, larguraDaTela };
