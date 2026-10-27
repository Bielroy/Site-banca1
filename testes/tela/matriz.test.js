'use strict';
// =====================================================================
//  testes/tela/matriz.test.js — MATRIZ DE TELAS: a loja em vários tamanhos de tela e de letra,
//  com dados de PIOR CASO, conferida pelas mesmas regras do vigia que roda no celular do cliente
//  (js/vigia-tela.js): nada passa da tela, nada sai do card, nenhum preço/nome/botão cortado,
//  nada por cima do que se toca, nenhuma foto quebrada.
//
//  Telas: 320 (iPhone SE / zoom da tela), 375, 390, 430 e deitado. Letra: 100%, 150% e 200%.
//    • Chromium: letra grande pelo tamanho de letra do navegador (o caminho do Android);
//    • WebKit:   letra grande pelo "Tamanho do Texto" do iPhone (--escala-texto, js/texto-grande.js).
//  Dados de pior caso: nome enorme e palavra sem espaço, preço de 4 dígitos, sem foto, foto muito
//  larga e muito alta, oferta, pacote, selo, 120 produtos, 14 categorias de nome comprido, feira com
//  6 bancas, loja fechada e loja com outro tema.
//  Uma foto de cada combinação vai para testes/tela/saida-matriz/ (o GitHub guarda para conferir de olho).
//
//  O site SE ADAPTAR (duas colunas virarem uma, botão crescer) não é defeito; só quebra conta.
//
//  Como roda (o GitHub faz sozinho, ver .github/workflows/seguranca.yml):
//     node testes/tela/matriz.test.js                     (Chromium, matriz inteira)
//     MOTOR=webkit MATRIZ=curta node testes/tela/matriz.test.js
//     SO_TESTE=fechada node testes/tela/matriz.test.js     (só o que tem "fechada" no nome)
// =====================================================================
const assert = require('assert');
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (_) { pw = require(path.join(__dirname, 'node_modules', 'playwright')); }
const { subir, cenarioPadrao } = require('./servidor');

const MOTOR = process.env.MOTOR || 'chromium';
const CURTA = process.env.MATRIZ === 'curta';
const SAIDA = path.join(__dirname, 'saida-matriz');
fs.mkdirSync(SAIDA, { recursive: true });
const FOTOS = path.join(__dirname, 'fotos');

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const TELAS = {
  320: { width: 320, height: 640 },
  375: { width: 375, height: 667 },
  390: { width: 390, height: 844 },
  430: { width: 430, height: 932 },
  440: { width: 440, height: 956 },   // iPhone Pro Max
  deitado: { width: 844, height: 390 },
  // janela de computador pequena (800×600): é o tamanho de escâner, pré-visualização e navegador de PC encolhido
  janela800: { width: 800, height: 600, pc: true },
  w700: { width: 700, height: 500, pc: true }, w740: { width: 740, height: 450, pc: true }, w768: { width: 768, height: 500, pc: true }, w783: { width: 783, height: 450, pc: true },
  w800b: { width: 800, height: 450, pc: true }, w817: { width: 817, height: 450, pc: true }, w860: { width: 860, height: 450, pc: true }, w900: { width: 900, height: 500, pc: true }, w1000: { width: 1000, height: 600, pc: true }, w1100: { width: 1100, height: 600, pc: true }, w1280: { width: 1280, height: 720, pc: true },
};
const NOMES_TELA = process.env.SO_TELAS ? process.env.SO_TELAS.split(',') : CURTA ? ['320', '390', 'deitado', 'janela800'] : Object.keys(TELAS).filter((t) => t !== '440');   // 440 só no teste do Safari 26 (a matriz inteira passava de 20 min)
const LETRAS = CURTA ? [1, 2] : [1, 1.5, 2];

// ------------------------------------------------------------------ dados de pior caso
const foto = (n) => `https://img.exemplo.test/${n}`;
const PIOR = {
  tomate: { nome: 'Tomate italiano', preco: 9.9, precoDe: 12.9, unidade: 'kg', cat: 'legumes', ativo: true, pesoMedio: 120, foto: foto('tomate.jpg') },
  enorme: { nome: 'Batata inglesa lavada selecionada especial de nome bem comprido que não acaba nunca mais', preco: 6.5, unidade: 'kg', cat: 'legumes', ativo: true, foto: foto('batata.jpg') },
  palavra: { nome: 'Mandioquinha-salsa-descascada-congelada-embalada-a-vácuo', preco: 18.75, unidade: 'kg', cat: 'legumes', ativo: true, pesoMedio: 250, foto: foto('cenoura.jpg') },
  caro: { nome: 'Cesta de Natal completa', preco: 1234.56, precoDe: 1499.9, unidade: 'un', cat: 'outros', ativo: true, foto: foto('kit.jpg') },
  semfoto: { nome: 'Couve manteiga', preco: 3.5, unidade: 'un', cat: 'verduras', ativo: true },
  larga: { nome: 'Foto muito larga', preco: 7.9, unidade: 'kg', cat: 'frutas', ativo: true, foto: foto('larga.svg') },
  alta: { nome: 'Foto muito alta', preco: 4.9, unidade: 'un', cat: 'frutas', ativo: true, foto: foto('alta.svg') },
  pacote: { nome: 'Feijão carioca tipo 1', preco: 8.99, unidade: 'un', cat: 'mercearia', ativo: true, pacote: true, pesoPacote: '1 kg', foto: foto('ovos.jpg') },
  tempero: { nome: 'Alho triturado caseiro', preco: 6, unidade: 'un', cat: 'temperos', ativo: true, foto: foto('limao.jpg') },
  selo: { nome: 'Manga palmer', preco: 8.9, unidade: 'kg', cat: 'frutas', ativo: true, escolha: true, estacao: true, foto: foto('manga.jpg') },
  dz: { nome: 'Ovos caipira (dúzia)', preco: 14, unidade: 'dz', cat: 'outros', ativo: true, foto: foto('ovos.jpg') },
  kit: { nome: 'Kit sopa da vovó com legumes da estação', preco: 24.9, unidade: 'kit', cat: 'outros', ativo: true, foto: foto('kit.jpg') },
  banana: { nome: 'Banana prata', preco: 6.9, precoDe: 7.9, unidade: 'kg', cat: 'frutas', ativo: true, pesoMedio: 130, foto: foto('banana.jpg') },
  alface: { nome: 'Alface crespa', preco: 4.5, unidade: 'un', cat: 'verduras', ativo: true, foto: foto('alface.jpg') },
};
const CATS_PIOR = ['frutas', 'legumes', 'verduras', 'outros', 'mercearia', 'temperos'].map((chave, i) => ({ chave, nome: chave[0].toUpperCase() + chave.slice(1), ordem: i + 1 }));
const MAIS = ['tomate', 'banana', 'enorme', 'palavra', 'caro', 'selo', 'dz', 'alface'];

const CATS_MUITAS = ['Frutas da estação', 'Legumes frescos', 'Verduras e folhas', 'Temperos e ervas', 'Ovos e laticínios', 'Pães e bolos caseiros', 'Mercearia', 'Bebidas geladas',
  'Doces e compotas', 'Congelados', 'Orgânicos certificados', 'Cogumelos', 'Castanhas e grãos', 'Flores'].map((nome, i) => ({ chave: 'c' + i, nome, ordem: i + 1 }));
function muitos() {
  const p = {}, fotos = ['tomate', 'alface', 'banana', 'ovos', 'cenoura', 'batata', 'cebola', 'limao', 'manga', 'kit'];
  for (let i = 0; i < 120; i++) p['m' + i] = { nome: `Produto ${i} ${i % 7 === 0 ? 'com nome comprido de verdade para quebrar em duas linhas' : 'da feira'}`, preco: 2 + (i % 17) * 3.37, precoDe: i % 9 === 0 ? 99.9 : undefined,
    unidade: ['kg', 'un', 'dz', 'maço'][i % 4], cat: 'c' + (i % 14), ativo: true, pesoMedio: i % 4 === 0 ? 150 : undefined, foto: i % 11 === 0 ? undefined : foto(fotos[i % 10] + '.jpg') };
  return p;
}

const CENARIOS = {
  'pior caso': () => { const c = cenarioPadrao(); c.lojas.banca.produtos = PIOR; c.lojas.banca.categorias = CATS_PIOR; return c; },
  'muitos produtos e feira grande': () => {
    const c = cenarioPadrao();
    c.lojas.banca.produtos = muitos(); c.lojas.banca.categorias = CATS_MUITAS;
    const bancas = ['Pastel & Açaí do Bié', 'Pães da Lúcia', 'Pastel Moe Coe', 'Hortifrúti Orgânico da Dona Maria Aparecida', 'Queijos e Doces de Minas'];
    bancas.forEach((nome, i) => { c.lojas['b' + i] = { ficha: { nome, ativo: true, feiras: ['florenca'] }, produtos: {} }; });
    c.feiras.florenca.lojas = [{ id: 'banca', nome: 'Banca Adair e Pedrina', cor: '#1a3a2a' }, ...bancas.map((nome, i) => ({ id: 'b' + i, nome, cor: ['#7a2e2e', '#5a3a22', '#2e4a7a', '#3a6a2a', '#6a4a8a'][i] }))];
    return c;
  },
  'loja fechada': () => { const c = cenarioPadrao(); c.lojas.banca.produtos = PIOR; c.lojas.banca.categorias = CATS_PIOR; c.lojas.banca.config = { ...c.lojas.banca.config, lojaAberta: false }; return c; },
  'outra loja com tema': () => {
    const c = cenarioPadrao();
    const pl = c.lojas['paes-da-lucia'];
    pl.produtos = { pao: { nome: 'Pão francês', preco: 1.2, unidade: 'un', cat: 'paes', ativo: true, foto: foto('kit.jpg') },
      bolo: { nome: 'Bolo de cenoura com cobertura de chocolate meio amargo', preco: 32, unidade: 'un', cat: 'bolos', ativo: true },
      broa: { nome: 'Broa de milho', preco: 3.5, precoDe: 4, unidade: 'un', cat: 'paes', ativo: true, foto: foto('banana.jpg') } };
    pl.categorias = [{ chave: 'paes', nome: 'Pães', ordem: 1 }, { chave: 'bolos', nome: 'Bolos e tortas da casa', ordem: 2 }];
    return c;
  },
  // Aparência → as escolhas que mais mexem no desenho (cada loja pode ligar as suas)
  'aparência: etiqueta selo, texto à esquerda, letra grande da loja': () => {
    const c = cenarioPadrao(); c.lojas.banca.produtos = PIOR; c.lojas.banca.categorias = CATS_PIOR;
    c.lojas.banca.ficha = { ...c.lojas.banca.ficha, tema: { primaria: '#7a2e2e', etiqueta: 'selo', textoLado: 'esquerda', botaoCab: 'solido', card: 'sombra', letra: 'grande', botaoFormato: 'quadrado', fotoEncaixe: 'inteira', borda: 'onda', fundoEstilo: 'pontos' } };
    return c;
  },
  'aparência: capa com logo, centralizado, etiqueta limpa': () => {
    const c = cenarioPadrao(); c.lojas.banca.produtos = PIOR; c.lojas.banca.categorias = CATS_PIOR;
    c.lojas.banca.ficha = { ...c.lojas.banca.ficha, tema: { primaria: '#2e4a7a', etiqueta: 'limpa', cabecalho: 'capa', capa: foto('banana.jpg'), logo: foto('tomate.jpg'), logoFormato: 'quadrado', alinhamento: 'centro', botaoCab: 'vidro', card: 'plano', borda: 'reta', arte: 'esconder' } };
    return c;
  },
  // cliente que volta com endereço salvo de condomínio de nome comprido (o botão do topo mostra o endereço inteiro: apareceu "..." no iPhone)
  'endereço salvo comprido': () => { const c = cenarioPadrao(); c.lojas.banca.produtos = PIOR; c.lojas.banca.categorias = CATS_PIOR; return c; },
};
const CAMINHO = { 'muitos produtos e feira grande': '/?feira=florenca&entrar=1', 'outra loja com tema': '/?loja=paes-da-lucia' };
// o que roda no aparelho antes da loja abrir (por cenário)
const ANTES = {
  'endereço salvo comprido': () => localStorage.setItem('banca_endereco', JSON.stringify({ modo: 'entrega', condominio: 'Residencial Jardins do Bosque Encantado', formato: 'rua', quadra: 'Alameda das Palmeiras Imperiais', lote: '1234' })),
};

// fotos de formato estranho: desenhadas na hora (SVG), sem arquivo no projeto
const SVG = {
  'larga.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="500"><rect width="2400" height="500" fill="#c33"/><circle cx="1200" cy="250" r="200" fill="#fc3"/></svg>',
  'alta.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="2400"><rect width="400" height="2400" fill="#3a3"/><circle cx="200" cy="1200" r="150" fill="#ff9"/></svg>',
};

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
let navegador, servidor;

async function abrir(caminho, { tela, letra = 1, cen, antes }) {
  const { pc, ...vp } = TELAS[tela];
  const opcoes = { viewport: vp, deviceScaleFactor: pc ? 1 : 2, hasTouch: !pc, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };
  if (MOTOR !== 'firefox' && !pc) opcoes.isMobile = true;
  if (MOTOR === 'webkit' && !pc) opcoes.userAgent = UA_IPHONE;
  const ctx = await navegador.newContext(opcoes);
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cen);
  if (antes) await ctx.addInitScript(antes);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // VELHO=1: navegador antigo (Firefox 109, Windows 7). Tira do CSS o que ele não entende — :has, color-mix, container queries,
  // content-visibility, @property, text-wrap — do mesmo jeito que ele faz: a regra/declaração que ele não entende é ignorada.
  if (process.env.VELHO) await ctx.route(/\.css(\?.*)?$/, async (r) => {
    const resp = await r.fetch(); let css = await resp.text();
    css = css.replace(/color-mix\(/g, 'x-color-mix(').replace(/:has\(/g, ':x-has(').replace(/@container/g, '@x-container').replace(/container-type\s*:/g, 'x-container-type:')
      .replace(/(^|[;{\s])container\s*:/g, '$1x-container:').replace(/content-visibility\s*:/g, 'x-content-visibility:').replace(/text-wrap\s*:/g, 'x-text-wrap:')
      .replace(/@property/g, '@x-property').replace(/(\d)cqi/g, '$1xcqi').replace(/:focus-visible/g, ':focus-visible');
    return r.fulfill({ response: resp, body: css });
  });
  await ctx.route(/img\.exemplo\.test\/([\w.]+)/, (r) => {
    const nome = r.request().url().match(/img\.exemplo\.test\/([\w.]+)/)[1];
    if (SVG[nome]) return r.fulfill({ contentType: 'image/svg+xml', body: SVG[nome] });
    const arq = path.join(FOTOS, nome);
    return fs.existsSync(arq) ? r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(arq) }) : r.fulfill({ status: 404, body: '' });
  });
  const pagina = await ctx.newPage(), erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon|status of 404|Viewport argument key/i.test(m.text())) erros.push('console: ' + m.text()); });
  // letra grande do Android: tamanho de letra do navegador (só o Chromium deixa mudar)
  if (letra !== 1 && MOTOR === 'chromium') {
    const cdp = await ctx.newCDPSession(pagina);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: Math.round(16 * letra), fixed: Math.round(13 * letra) } });
  }
  // 1ª visita guarda o ranking; na 2ª (cliente que volta) a loja já abre com as faixas
  await pagina.goto(servidor.base + caminho);
  await pagina.locator('#lista-produtos .produto-card[data-id]').first().waitFor({ timeout: 15000 });
  await pagina.waitForFunction(() => Object.keys(localStorage).some((k) => /rank/.test(k)), null, { timeout: 6000 }).catch(() => {});
  await pagina.reload();
  await pagina.locator('#lista-produtos .produto-card[data-id]').first().waitFor({ timeout: 15000 });
  await pagina.waitForFunction(() => !document.body.classList.contains('montando'), null, { timeout: 10000 }).catch(() => {});
  // letra grande do iPhone: o mesmo que js/texto-grande.js faz quando o Tamanho do Texto está maior
  if (letra !== 1 && MOTOR !== 'chromium') {
    await pagina.evaluate((s) => { const h = document.documentElement; h.style.setProperty('--escala-texto', String(s)); h.classList.toggle('texto-grande', 16 * s >= 18.5); }, letra);
  }
  await esperarFotos(pagina);
  await pagina.waitForTimeout(400);
  return { pagina, erros, fechar: () => ctx.close() };
}
// espera as fotos que estão NA TELA (a "preguiçosa" fora dela, inclusive à direita numa faixa, nunca carrega sozinha)
const esperarFotos = (p) => p.waitForFunction(() => [...document.querySelectorAll('img')].filter((i) => {
  if (i.loading !== 'lazy') return true;
  const b = i.getBoundingClientRect();
  return b.width > 0 && b.left < innerWidth && b.right > 0 && b.top < innerHeight && b.bottom > 0;
}).every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});

/** Confere a tela de cima até embaixo (as regras de "por cima" valem para o que está na tela). */
async function conferirTudo(pagina) {
  const achados = new Map();
  const juntar = (lista) => { for (const p of lista) { const k = `${p.regra}|${p.codigo}`; const a = achados.get(k); if (!a) achados.set(k, p); else { a.vezes += p.vezes; for (const e of p.exemplos) if (a.exemplos.length < 3 && !a.exemplos.includes(e)) a.exemplos.push(e); } } };
  const conferir = () => pagina.evaluate(() => window.__vigiaTela.verificarTela());
  await pagina.evaluate(() => window.scrollTo(0, 0)); await pagina.waitForTimeout(150);
  juntar(await conferir());
  const altura = await pagina.evaluate(() => document.documentElement.scrollHeight), tela = await pagina.evaluate(() => innerHeight);
  for (let y = tela * 0.8, n = 0; y < altura && n < 30; y += tela * 0.8, n++) {
    await pagina.evaluate((v) => window.scrollTo(0, v), y);
    await pagina.waitForTimeout(120);
    const t0 = Date.now(); await esperarFotos(pagina); const t1 = Date.now();
    juntar(await conferir());
    if (process.env.DEPURAR) console.log(`      y=${Math.round(y)} fotos ${t1 - t0} ms, regras ${Date.now() - t1} ms`);
  }
  await pagina.evaluate(() => window.scrollTo(0, 0));
  return [...achados.values()];
}
/** Foto de perto do defeito (o card do exemplo, com o lugar marcado de vermelho), para achar sem abrir a loja. */
async function fotoDoDefeito(pagina, p, prefixo) {
  try {
    const ultimo = p.codigo.split(' ').pop();
    const alvo = await pagina.evaluateHandle(({ ex, ultimo, codigo }) => {
      let todos = [];
      try { todos = [...document.querySelectorAll(codigo)]; } catch (_) { /* seletor estranho */ }
      let el = todos.find((e) => !ex || (e.closest('[data-id]') || {}).dataset?.id === ex) || todos[0];
      if (!el && ex) el = document.querySelector(`.produto-card[data-id="${CSS.escape(ex)}"]`);
      if (!el) return null;
      el.style.outline = '3px solid red'; el.style.outlineOffset = '-1px';
      const quadro = el.closest('.produto-card') || el;
      quadro.scrollIntoView({ block: 'center' });
      return quadro;
    }, { ex: p.exemplos[0] || '', ultimo, codigo: p.codigo });
    const el = alvo.asElement(); if (!el) return;
    await pagina.waitForTimeout(150);
    await el.screenshot({ path: path.join(SAIDA, nomeArq(`${prefixo}-DEFEITO-${p.regra}-${ultimo}.png`)), scale: 'css' });
    await el.evaluate((q) => { q.querySelectorAll('[style*="outline"]').forEach((e) => { e.style.outline = ''; }); q.style.outline = ''; });
  } catch (_) { /* a foto é só para ajudar */ }
}
const texto = (p) => `${p.regra}: ${p.nome}  [${p.codigo}]  ${p.detalhe}${p.exemplos.length ? `  ex.: ${p.exemplos.join(', ')}` : ''}  (${p.vezes}x)`;
const semErros = (erros) => assert.deepStrictEqual(erros, [], 'a página teve erro de código:\n  ' + erros.join('\n  '));
const nomeArq = (s) => s.replace(/[^\w.-]+/g, '-');

// ------------------------------------------------------------------ a matriz
for (const [nomeCen, fazer] of Object.entries(CENARIOS)) {
  if (CURTA && !['pior caso', 'muitos produtos e feira grande', 'aparência: etiqueta selo, texto à esquerda, letra grande da loja', 'endereço salvo comprido'].includes(nomeCen)) continue;
  for (const tela of NOMES_TELA) {
    teste(`${nomeCen} · tela ${tela}`, async () => {
      const falhas = [];
      for (const letra of tela === 'deitado' || TELAS[tela].pc ? [1] : LETRAS) {
        const { pagina, erros, fechar } = await abrir(CAMINHO[nomeCen] || '/', { tela, letra, cen: fazer(), antes: ANTES[nomeCen] });
        try {
          const ctxTela = await pagina.evaluate(() => window.__vigiaTela.telaAtual());
          await pagina.screenshot({ path: path.join(SAIDA, nomeArq(`${MOTOR}-${nomeCen}-${tela}-letra${letra * 100}.jpg`)), type: 'jpeg', quality: 60, scale: 'css' }).catch(() => {});
          // e a vitrine (os cards), que é onde mais quebra
          await pagina.evaluate(() => { const v = document.querySelector('#lista-produtos'); if (v) window.scrollTo(0, v.getBoundingClientRect().top + scrollY - 60); });
          await pagina.waitForTimeout(250); await esperarFotos(pagina);
          await pagina.screenshot({ path: path.join(SAIDA, nomeArq(`${MOTOR}-${nomeCen}-${tela}-letra${letra * 100}-vitrine.jpg`)), type: 'jpeg', quality: 60, scale: 'css' }).catch(() => {});
          const problemas = await conferirTudo(pagina);
          for (const p of problemas) falhas.push(`letra ${letra * 100}% (${ctxTela}) → ${texto(p)}`);
          for (const p of problemas.slice(0, 6)) await fotoDoDefeito(pagina, p, `${MOTOR}-${nomeCen}-${tela}-letra${letra * 100}`);
          semErros(erros);
        } finally { await fechar(); }
      }
      assert.strictEqual(falhas.length, 0, `defeito na tela:\n    ${falhas.join('\n    ')}`);
    });
  }
}

// ------------------------------------------------------------------ navegador automático: tela do aparelho de mentira
// Escâneres e testadores de site rodam com "tela do aparelho" 800×600 e janela maior (1280×720). O vigia usava a tela do aparelho
// como largura e acusava tudo que passava de 800px ("saiu pela borda", "página mais larga"). No computador vale a janela.
teste('o vigia no computador usa a janela, não a "tela do aparelho" (navegador automático com tela de 800×600 e janela de 1280)', async () => {
  const falsa = () => { for (const [k, v] of [['width', 800], ['height', 600], ['availWidth', 800], ['availHeight', 600]]) Object.defineProperty(window.screen, k, { get: () => v }); };
  for (const cen of ['pior caso', 'loja fechada']) {
    const { pagina, erros, fechar } = await abrir('/', { tela: 'w1280', cen: CENARIOS[cen](), antes: falsa });
    try {
      assert.strictEqual(await pagina.evaluate(() => screen.width), 800, 'a tela do aparelho é mesmo de mentira');
      assert.strictEqual(await pagina.evaluate(() => window.__vigiaTela.larguraDaTela()), 1280, 'no computador vale a janela');
      const achou = await pagina.evaluate(() => window.__vigiaTela.verificarTela());
      assert.deepStrictEqual(achou.map(texto), [], `${cen}: acusou defeito que não existe`);
      semErros(erros);
    } finally { await fechar(); }
  }
});

// ------------------------------------------------------------------ Safari 26: tela do aparelho "de mentira" no celular
// O Safari 26 do iPhone informa uma tela menor que a real (privacidade): um iPhone de 440px dizia 414px. O vigia usava esse número
// e acusava o cabeçalho, a faixa da feira e a barra "Ver pedido", que ocupam a largura certinho ("saiu pela borda", "mais larga").
teste('o vigia no celular usa a largura da página, não a "tela do aparelho" que o Safari 26 informa menor (440px dizendo 414)', async () => {
  const falsa = () => { for (const [k, v] of [['width', 414], ['height', 896], ['availWidth', 414], ['availHeight', 896]]) Object.defineProperty(window.screen, k, { get: () => v }); };
  const { pagina, erros, fechar } = await abrir('/', { tela: '440', cen: CENARIOS['pior caso'](), antes: falsa });
  try {
    await pagina.locator('#lista-produtos .produto-card[data-id="alface"] .card-add').evaluate((b) => b.click());
    await pagina.waitForSelector('#btn-carrinho-mobile:not(.vazio)', { timeout: 5000 });
    assert.strictEqual(await pagina.evaluate(() => screen.width), 414, 'a tela do aparelho é mesmo de mentira');
    assert.strictEqual(await pagina.evaluate(() => window.__vigiaTela.larguraDaTela()), 440, 'vale a largura em que a página é desenhada');
    const achou = (await pagina.evaluate(() => window.__vigiaTela.verificarTela())).filter((p) => p.regra === 'fora-da-tela' || p.regra === 'rolagem-lateral');
    assert.deepStrictEqual(achou.map(texto), [], 'acusou defeito que não existe');
    semErros(erros);
  } finally { await fechar(); }
});
// e o vigia continua achando o que passa de verdade da borda nessa mesma tela
teste('com a tela de mentira, algo que passa de verdade da borda ainda é acusado', async () => {
  const falsa = () => { for (const [k, v] of [['width', 414], ['height', 896]]) Object.defineProperty(window.screen, k, { get: () => v }); };
  const { pagina, fechar } = await abrir('/', { tela: '440', cen: CENARIOS['pior caso'](), antes: falsa });
  try {
    const regras = await pagina.evaluate(() => {
      const st = document.createElement('style'); st.textContent = '#busca-input { width: 700px !important; min-width: 700px !important; max-width: none !important; }'; document.head.appendChild(st);
      return new Promise((ok) => setTimeout(() => ok(window.__vigiaTela.verificarTela().map((p) => p.regra)), 300));
    });
    assert.ok(regras.includes('rolagem-lateral') || regras.includes('fora-da-tela'), 'devia acusar: ' + regras.join(', '));
  } finally { await fechar(); }
});

// ------------------------------------------------------------------ a barra "Ver pedido" por cima do que ainda não grudou no topo
// iPhone 375px com a barra de baixo do Safari (tela curta) e itens na sacola: a barra fixa cobre a fileira de categorias enquanto ela está
// no lugar normal (a página rola e ela gruda no topo). Isso não é defeito: o vigia acusava "Tem algo por cima: botão de categoria".
teste('a barra fixa da sacola por cima das categorias ainda não coladas no topo não é defeito (375px, tela de 450px de altura)', async () => {
  const { pagina, erros, fechar } = await abrir('/', { tela: '375', cen: CENARIOS['pior caso']() });
  try {
    await pagina.setViewportSize({ width: 375, height: 450 });
    // O toque dos testes, no WebKit, às vezes cai no card (abre o detalhe do produto) porque a tela de 450px rola com a barra do topo.
    // O que importa aqui é o produto estar na sacola, então aciona o botão "Adicionar" direto, sem depender de onde o dedo cai.
    await pagina.locator('#lista-produtos .produto-card[data-id="alface"] .card-add').evaluate((b) => b.click());
    await pagina.waitForSelector('#btn-carrinho-mobile:not(.vazio)', { timeout: 5000 });
    await pagina.evaluate(() => window.scrollTo(0, 0)); await pagina.waitForTimeout(300);
    // a altura do topo muda com o dia e a hora (aviso de loja fechada, feira do dia): acerta a altura da tela para a barra
    // de baixo cair bem no meio da fileira de categorias, em vez de depender de um número fixo
    const ajuste = await pagina.evaluate(() => {
      const barra = document.querySelector('#btn-carrinho-mobile').getBoundingClientRect(), cat = document.querySelector('#categorias .cat-btn').getBoundingClientRect();
      return Math.round(barra.top - (cat.top + cat.bottom) / 2);
    });
    if (ajuste) { await pagina.setViewportSize({ width: 375, height: Math.max(300, 450 - ajuste) }); await pagina.evaluate(() => window.scrollTo(0, 0)); await pagina.waitForTimeout(300); }
    const cobre = await pagina.evaluate(() => {
      const barra = document.querySelector('#btn-carrinho-mobile').getBoundingClientRect();
      return [...document.querySelectorAll('#categorias .cat-btn')].filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > barra.top && r.top < barra.bottom && r.right > barra.left && r.left < barra.right; }).length;
    });
    assert.ok(cobre > 0, 'o cenário do teste precisa ter a barra por cima das categorias (ajuste a altura da tela)');
    const achou = await pagina.evaluate(() => window.__vigiaTela.verificarTela());
    assert.deepStrictEqual(achou.filter((p) => p.regra === 'coberto').map(texto), [], 'a barra fixa por cima de conteúdo que rola não é defeito');
    semErros(erros);
  } finally { await fechar(); }
});

// ------------------------------------------------------------------ o vigia acha defeito de propósito
// (se as regras pararem de enxergar, a matriz passaria sem conferir nada)
teste('o vigia acha defeito feito de propósito: rolagem lateral, preço cortado, botão coberto, foto quebrada, foto fora do card', async () => {
  const c = CENARIOS['pior caso']();
  c.lojas.banca.produtos = { ...c.lojas.banca.produtos, quebrada: { nome: 'Foto quebrada', preco: 5, unidade: 'un', cat: 'frutas', ativo: true, foto: foto('nao-existe.jpg') } };
  const { pagina, fechar } = await abrir('/', { tela: '390', cen: c });
  try {
    assert.deepStrictEqual((await pagina.evaluate(() => window.__vigiaTela.verificarTela())).map((p) => p.regra).filter((r) => r !== 'foto-quebrada'), [], 'a loja sem defeito não acusa nada');
    await pagina.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = `
        #lista-produtos > .produto-card { content-visibility: visible !important; }   /* todos medidos, perto ou longe da tela */
        #lista-produtos .produto-card[data-id="tomate"] .etq-preco { width: 22px; overflow: hidden; white-space: nowrap; }
        #lista-produtos .produto-card[data-id="banana"], #lista-produtos .produto-card[data-id="banana"] .produto-img-wrap { overflow: visible !important; contain: none !important; content-visibility: visible !important; }
        #lista-produtos .produto-card[data-id="banana"] .produto-img-wrap img { position: absolute; left: 0; top: 0; width: 100% !important; height: 900px !important; max-height: none !important; z-index: 50; }
`;
      document.head.appendChild(s);
      document.querySelector('#lista-produtos .produto-card[data-id="alface"]').scrollIntoView({ block: 'center' });
    });
    await pagina.waitForTimeout(300);
    // uma "tampa" por cima do botão da alface (medido depois de rolar: card fora da tela não tem o tamanho de verdade)
    await pagina.evaluate(() => {
      const tampa = document.createElement('div');
      tampa.className = 'tampa-teste';
      const alvo = document.querySelector('#lista-produtos .produto-card[data-id="alface"] .card-acao button').getBoundingClientRect();
      tampa.style.cssText = `position:absolute; left:${alvo.left + scrollX - 4}px; top:${alvo.top + scrollY - 4}px; width:${alvo.width + 8}px; height:${alvo.height + 8}px; background:red; z-index:40`;
      document.body.appendChild(tampa);
    });
    await pagina.waitForTimeout(100);
    const achou = await pagina.evaluate(() => window.__vigiaTela.verificarTela());
    const regras = new Set(achou.map((p) => p.regra));
    for (const r of ['texto-cortado', 'coberto', 'sai-do-card', 'foto-quebrada']) assert.ok(regras.has(r), `devia acusar ${r}; achou: ${achou.map(texto).join(' | ')}`);
    // por último, a página mais larga que a tela (no celular o navegador "afasta" a página e as medidas mudam: vai separado)
    const larga = await pagina.evaluate(() => {
      const st = document.createElement('style'); st.textContent = '#busca-input { width: 700px !important; min-width: 700px !important; max-width: none !important; }'; document.head.appendChild(st);
      return new Promise((ok) => setTimeout(() => ok(window.__vigiaTela.verificarTela().map((p) => p.regra)), 300));
    });
    assert.ok(larga.includes('rolagem-lateral') || larga.includes('fora-da-tela'), `devia acusar a página larga; achou: ${larga.join(', ')}`);
    const preco = achou.find((p) => p.regra === 'texto-cortado');
    assert.ok(/preço/.test(preco.nome) && preco.exemplos.includes('tomate'), `diz que é o preço do tomate: ${texto(preco)}`);
    assert.ok(achou.find((p) => p.regra === 'foto-quebrada').exemplos.includes('quebrada'));
    assert.ok(achou.find((p) => p.regra === 'coberto' && p.exemplos.includes('alface')), 'o botão coberto é o da alface');
  } finally { await fechar(); }
});

(async () => {
  servidor = await subir({
    '/api/analytics': (c) => (c.acao === 'ranking' ? { sucesso: true, nivel: 'recorrente', maisPedidos: MAIS,
      itens: MAIS.map((id, i) => ({ id, p: 0.9 - i * 0.05, motivo: i < 4 ? 'Você sempre leva' : '' })) } : {}),
  });
  // barras de rolagem de verdade (como no Windows): sem isto o navegador de teste as esconde e a janela de PC fica mais larga do que é
  navegador = await pw[MOTOR].launch(MOTOR === 'chromium' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {});
  console.log(`Motor: ${MOTOR} ${navegador.version()} · matriz ${CURTA ? 'curta' : 'inteira'} (${NOMES_TELA.join(', ')} · letra ${LETRAS.map((l) => l * 100 + '%').join(', ')})`);
  let falhas = 0;
  const lista = testes.filter(([n]) => !process.env.SO_TESTE || new RegExp(process.env.SO_TESTE).test(n));
  for (const [nome, fn] of lista) {
    const t0 = Date.now();
    try { await fn(); console.log(`  ok    ${nome}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
    catch (e) { falhas++; console.log('  FALHOU ' + nome + '\n         ' + String((e && e.message) || e).split('\n').slice(0, 30).join('\n         ')); }
  }
  await navegador.close(); servidor.srv.close();
  console.log(`\n${lista.length - falhas} de ${lista.length} testes da matriz de telas (${MOTOR}) passaram.`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('Não consegui rodar a matriz de telas:', e); process.exit(1); });
