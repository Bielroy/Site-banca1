'use strict';
// =====================================================================
//  testes/tela/iphone.test.js — A LOJA NO MOTOR DO IPHONE (WebKit, o motor do Safari).
//
//  Todo navegador de iPhone (Safari, Chrome, Instagram...) usa o WebKit. Aqui a loja abre num
//  "iPhone" simulado e o teste faz o que a cliente faz com as FAIXAS QUE ROLAM PARA O LADO
//  (Ofertas, Seus de sempre, Os mais pedidos, Kits, categorias, bancas da feira, atalhos):
//  rola devagar e rápido até o fim, toca no "+", abre e fecha o produto, aumenta a letra, vira a tela.
//  Depois de cada passo confere que nenhum card mudou de tamanho, que nenhuma foto passou da caixa
//  dela (o "tomate que cobriu a faixa inteira"), que nada ficou solto por cima da tela e que a página
//  não rola para o lado.
//
//  Fotos de verdade (testes/tela/fotos), uma delas GRANDE (2400 px), como foto cadastrada por link.
//  Fotos de cada passo vão para testes/tela/saida-iphone/ (o GitHub guarda para conferir de olho).
//
//  Como roda (o GitHub faz sozinho, ver .github/workflows/seguranca.yml):
//     npm install --prefix testes/tela
//     npx --prefix testes/tela playwright install --with-deps webkit
//     node testes/tela/iphone.test.js            (MOTOR=chromium para conferir no Chromium)
// =====================================================================
const assert = require('assert');
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (_) { pw = require(path.join(__dirname, 'node_modules', 'playwright')); }
const { subir, cenarioPadrao } = require('./servidor');

const MOTOR = process.env.MOTOR || 'webkit';
const SAIDA = path.join(__dirname, 'saida-iphone');
fs.mkdirSync(SAIDA, { recursive: true });
const FOTOS = path.join(__dirname, 'fotos');

// Aparelhos: iPhone comum, iPhone pequeno/"Zoom da tela ampliado" (320) e deitado.
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' };
const APARELHOS = {
  'iPhone 13': IPHONE,
  'iPhone SE / zoom': { ...IPHONE, viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 },
  'iPhone deitado': { ...IPHONE, viewport: { width: 844, height: 390 } },
};
// isMobile não existe no Firefox; no WebKit e no Chromium vale
const contexto = (ap) => (MOTOR === 'firefox' ? (({ isMobile, ...r }) => r)(ap) : ap);

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
let navegador, servidor;

// ------------------------------------------------------------------ CENÁRIO: banca com todas as faixas
const foto = (n) => `https://img.exemplo.test/${n}.jpg`;
const PRODUTOS = {
  tomate: { nome: 'Tomate italiano', preco: 9.9, precoDe: 12.9, unidade: 'kg', cat: 'legumes', ativo: true, pesoMedio: 120, foto: foto('tomate') },
  alface: { nome: 'Alface crespa', preco: 4.5, unidade: 'un', cat: 'verduras', ativo: true, foto: foto('alface') },
  banana: { nome: 'Banana prata', preco: 6.9, precoDe: 7.9, unidade: 'kg', cat: 'frutas', ativo: true, pesoMedio: 130, foto: foto('banana') },
  ovos: { nome: 'Ovos caipira (dúzia)', preco: 14, unidade: 'dz', cat: 'outros', ativo: true, foto: foto('ovos') },
  cenoura: { nome: 'Cenoura', preco: 5.9, unidade: 'kg', cat: 'legumes', ativo: true, pesoMedio: 100, foto: foto('cenoura') },
  batata: { nome: 'Batata inglesa lavada de nome bem comprido para quebrar linha', preco: 6.5, unidade: 'kg', cat: 'legumes', ativo: true, foto: foto('batata') },
  cebola: { nome: 'Cebola roxa', preco: 7.9, precoDe: 9.9, unidade: 'kg', cat: 'legumes', ativo: true, foto: foto('cebola') },
  limao: { nome: 'Limão taiti', preco: 4.9, unidade: 'kg', cat: 'frutas', ativo: true, foto: foto('limao') },
  manga: { nome: 'Manga palmer', preco: 8.9, unidade: 'kg', cat: 'frutas', ativo: true, foto: foto('manga') },
  semfoto: { nome: 'Couve manteiga', preco: 3.5, unidade: 'un', cat: 'verduras', ativo: true },
  kit1: { nome: 'Kit salada', preco: 19.9, unidade: 'kit', cat: 'outros', ativo: true, foto: foto('kit') },
  kit2: { nome: 'Kit sopa', preco: 24.9, unidade: 'kit', cat: 'outros', ativo: true, foto: foto('kit') },
};
const CATS = ['frutas', 'legumes', 'verduras', 'outros', 'temperos', 'mercearia', 'bebidas', 'doces'].map((chave, i) => ({ chave, nome: chave[0].toUpperCase() + chave.slice(1), ordem: i + 1 }));
const MAIS = ['tomate', 'banana', 'ovos', 'alface', 'cenoura', 'batata', 'cebola', 'manga'];
const cenario = () => {
  const c = cenarioPadrao();
  c.lojas.banca.produtos = PRODUTOS;
  c.lojas.banca.categorias = CATS;
  c.lojas.banca.config = { ...c.lojas.banca.config, contato: { mostrarWpp: true, whatsapp: '5562999990000' } };
  return c;
};

async function abrir(caminho = '/', { aparelho = 'iPhone 13', antes, cen = cenario() } = {}) {
  const ctx = await navegador.newContext(contexto(APARELHOS[aparelho]));
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cen);
  if (antes) await ctx.addInitScript(antes);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/img\.exemplo\.test\/(\w+)\.jpg/, (r) => {
    const nome = r.request().url().match(/(\w+)\.jpg/)[1];
    r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(path.join(FOTOS, `${nome}.jpg`)) });
  });
  const pagina = await ctx.newPage(), erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon|status of 404|Viewport argument key/i.test(m.text())) erros.push('console: ' + m.text()); });
  // 1ª visita guarda o ranking no aparelho; na 2ª (cliente que volta) a loja já abre com "Os mais pedidos" e "Seus de sempre"
  await pagina.goto(servidor.base + caminho);
  await pagina.locator('#lista-produtos .produto-card').first().waitFor({ timeout: 12000 });
  await pagina.waitForFunction(() => Object.keys(localStorage).some((k) => /banca_rank_v2/.test(k)), null, { timeout: 8000 }).catch(() => {});
  await pagina.reload();
  await pagina.locator('#lista-produtos .produto-card').first().waitFor({ timeout: 12000 });
  await pagina.waitForFunction(() => document.querySelectorAll('.faixa-rolo .produto-card').length > 0, null, { timeout: 8000 });
  await esperarFotos(pagina);
  return { pagina, erros, fechar: () => ctx.close() };
}
const esperarFotos = (p) => p.waitForFunction(() => [...document.querySelectorAll('.faixa-rolo img, #lista-produtos img')]
  .filter((i) => i.loading !== 'lazy' || i.getBoundingClientRect().top < innerHeight * 2).every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});
const semErros = (erros) => assert.deepStrictEqual(erros, [], 'a página teve erro de código:\n  ' + erros.join('\n  '));
const foto_ = async (p, nome, alvo) => { try { await (alvo ? p.locator(alvo).first() : p).screenshot({ path: path.join(SAIDA, `${MOTOR}-${nome}`.replace(/[^\w.-]+/g, "-") + ".png") }); } catch (_) { /* foto é só para conferir de olho */ } };

// ------------------------------------------------------------------ CONFERÊNCIAS
/**
 * Mede tudo o que pode dar errado numa faixa que rola para o lado. Devolve a lista de problemas (vazia = tudo certo).
 *  - card com largura diferente dos outros, ou muito maior que o normal
 *  - foto (ou a caixa da foto) maior que o card, ou fora dele: "a foto cobriu os vizinhos"
 *  - caixa da foto que deixou de ser do formato escolhido
 *  - card mais alto que a faixa (passou para baixo)
 */
const medirFaixas = (p) => p.evaluate(() => {
  const problemas = [];
  const r = (e) => e.getBoundingClientRect();
  document.querySelectorAll('.faixa-rolo').forEach((rolo) => {
    const faixa = rolo.closest('section'), nome = (faixa && (faixa.querySelector('h2') || {}).textContent || '?').trim();
    if (faixa && faixa.offsetParent === null) return;
    const cards = [...rolo.querySelectorAll(':scope > .produto-card')];
    if (!cards.length) { problemas.push(`${nome}: faixa sem cards`); return; }
    const larguras = cards.map((c) => Math.round(r(c).width));
    const base = larguras[0];
    if (base < 100 || base > 230) problemas.push(`${nome}: card com ${base}px de largura`);
    larguras.forEach((w, i) => { if (Math.abs(w - base) > 1) problemas.push(`${nome}: card ${i + 1} com ${w}px (os outros ${base}px)`); });
    const rr = r(rolo);
    cards.forEach((c, i) => {
      const rc = r(c), wrap = c.querySelector('.produto-img-wrap'), img = c.querySelector('.produto-img-wrap img');
      if (rc.height > rr.height + 2) problemas.push(`${nome}: card ${i + 1} mais alto que a faixa (${Math.round(rc.height)} > ${Math.round(rr.height)})`);
      if (wrap) {
        const rw = r(wrap);
        if (rw.width > rc.width + 1 || rw.left < rc.left - 1 || rw.right > rc.right + 1) problemas.push(`${nome}: caixa da foto do card ${i + 1} passou do card`);
        const prop = getComputedStyle(wrap).aspectRatio;
        if (/^1( \/ 1)?$|^auto 1/.test(prop) && Math.abs(rw.height - rw.width) > 2) problemas.push(`${nome}: caixa da foto do card ${i + 1} deixou de ser quadrada (${Math.round(rw.width)}x${Math.round(rw.height)})`);
        if (rw.height > rc.width * 1.6) problemas.push(`${nome}: caixa da foto do card ${i + 1} cresceu (${Math.round(rw.height)}px de altura)`);
      }
      if (img && wrap) {
        const ri = r(img), rw = r(wrap);
        if (ri.width > rw.width + 2 || ri.height > rw.height + 2) problemas.push(`${nome}: foto do card ${i + 1} maior que a caixa (${Math.round(ri.width)}x${Math.round(ri.height)} > ${Math.round(rw.width)}x${Math.round(rw.height)})`);
        if (getComputedStyle(img).transform !== 'none') problemas.push(`${nome}: foto do card ${i + 1} ampliada (${getComputedStyle(img).transform})`);
      }
    });
  });
  // nada solto por cima da tela (o "voador" do + some sozinho) e a página não rola para o lado
  const soltos = [...document.querySelectorAll('.voador')].length;
  if (soltos) problemas.push(`${soltos} foto(s) do "voa até a sacola" ficaram na tela`);
  const folga = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (folga > 1) problemas.push(`a página rola ${folga}px para o lado`);
  return problemas;
});
const semProblemas = async (p, quando) => { const pr = await medirFaixas(p); assert.deepStrictEqual(pr, [], `${quando}:\n  ${pr.join('\n  ')}`); };

/** Rola uma faixa até o fim em passos (como o dedo) e confere a cada passo. */
async function rolarFaixa(p, seletor, { passo = 90, rapido = false, nome = '' } = {}) {
  const fim = await p.locator(seletor).evaluate((e) => e.scrollWidth - e.clientWidth);
  if (fim <= 0) return 0;
  let n = 0;
  for (let x = 0; x <= fim + passo; x += rapido ? passo * 4 : passo) {
    await p.locator(seletor).evaluate((e, v) => e.scrollTo({ left: v, behavior: 'instant' }), Math.min(x, fim));
    await p.waitForTimeout(rapido ? 30 : 60);
    await semProblemas(p, `${nome} rolando a faixa (${seletor}) em ${Math.min(x, fim)}px`);
    if (n++ === 2) await foto_(p, `${nome}-meio`, seletor);
  }
  // de volta para o começo (rolagem "suave" do próprio navegador)
  await p.locator(seletor).evaluate((e) => e.scrollTo({ left: 0, behavior: 'smooth' }));
  await p.waitForTimeout(700);
  await semProblemas(p, `${nome} voltando ao começo (${seletor})`);
  return fim;
}

// ------------------------------------------------------------------ TESTES
for (const aparelho of Object.keys(APARELHOS)) {
  teste(`${aparelho}: todas as faixas abrem com os cards do mesmo tamanho e nenhuma foto passa da caixa`, async () => {
    const { pagina, erros, fechar } = await abrir('/', { aparelho });
    const ids = await pagina.evaluate(() => [...document.querySelectorAll('.faixa-rolo')].filter((r) => r.offsetParent !== null).map((r) => (r.closest('section').querySelector('h2') || {}).textContent.trim()));
    assert.ok(ids.length >= 3, 'esperava ao menos 3 faixas (ofertas, mais pedidos, kits...): ' + ids.join(', '));
    await foto_(pagina, `${aparelho}-abertura`);
    await semProblemas(pagina, `${aparelho} na abertura`);
    semErros(erros); await fechar();
  });

  teste(`${aparelho}: rolar cada faixa devagar e rápido até o fim e voltar não deforma nada`, async () => {
    const { pagina, erros, fechar } = await abrir('/', { aparelho });
    const n = await pagina.locator('.faixa-rolo:visible').count();
    for (let i = 0; i < n; i++) {
      const sel = `.faixa-rolo:visible >> nth=${i}`;
      await pagina.locator(sel).scrollIntoViewIfNeeded();
      await rolarFaixa(pagina, sel, { nome: `${aparelho}-faixa${i}` });
      await rolarFaixa(pagina, sel, { rapido: true, nome: `${aparelho}-faixa${i}-rapido` });
    }
    // rolar a página inteira para baixo e voltar, com as faixas no meio do caminho roladas
    for (let y = 0; y < 3000; y += 400) { await pagina.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y); await pagina.waitForTimeout(40); }
    await pagina.evaluate(() => scrollTo(0, 0)); await pagina.waitForTimeout(200);
    await semProblemas(pagina, `${aparelho} depois de rolar a página`);
    semErros(erros); await fechar();
  });
}

teste('iPhone: rolar a faixa de pouco em pouco (rolagem suave) com o encaixe ligado não deixa card pela metade nem cresce', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  const sel = '.faixa--mais .faixa-rolo';
  assert.ok(await pagina.locator(sel).count(), 'a faixa "Os mais pedidos" aparece');
  await pagina.locator(sel).scrollIntoViewIfNeeded();
  // o "dedo": rolagem suave do próprio navegador, de pouco em pouco, com o encaixe (scroll-snap) puxando o card
  // (o iPhone simulado não aceita roda do mouse; a rolagem suave passa pelo mesmo caminho do toque na faixa)
  for (let k = 0; k < 14; k++) { await pagina.locator(sel).evaluate((e) => e.scrollBy({ left: 110, behavior: 'smooth' })); await pagina.waitForTimeout(140); await semProblemas(pagina, `rolando de lado (${k + 1})`); }
  for (let k = 0; k < 14; k++) { await pagina.locator(sel).evaluate((e) => e.scrollBy({ left: -110, behavior: 'smooth' })); await pagina.waitForTimeout(90); }
  await pagina.waitForTimeout(400);
  await foto_(pagina, 'mais-pedidos-depois-do-dedo', sel);
  await semProblemas(pagina, 'depois de ir e voltar com o dedo');
  semErros(erros); await fechar();
});

teste('iPhone: tocar no "+" do tomate com a faixa rolada (várias vezes, rápido) põe na sacola, a foto que voa some e nada cresce', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  const sel = '.faixa--mais .faixa-rolo';
  await pagina.locator(sel).scrollIntoViewIfNeeded();
  await pagina.locator(sel).evaluate((e) => e.scrollTo({ left: 60, behavior: 'instant' }));
  const card = pagina.locator(`${sel} .produto-card[data-id="tomate"]`);
  await card.locator('[data-action="add"]').first().click();
  for (let k = 0; k < 4; k++) { const mais = card.locator('[data-action="inc"]'); if (await mais.count()) await mais.first().click(); await pagina.waitForTimeout(80); }
  await pagina.waitForTimeout(150);
  await foto_(pagina, 'tomate-voando', sel);
  await pagina.waitForTimeout(1200);
  await semProblemas(pagina, 'depois de tocar no + do tomate');
  // o mesmo tomate aparece em vários lugares (faixas e lista): todos mostram a quantidade
  const controles = await pagina.locator('.produto-card[data-id="tomate"] .card-qtd').count();
  const cards = await pagina.locator('.produto-card[data-id="tomate"]').count();
  assert.strictEqual(controles, cards, `todos os ${cards} cards do tomate mostram a quantidade (só ${controles})`);
  await foto_(pagina, 'tomate-na-sacola');
  semErros(erros); await fechar();
});

teste('iPhone: o "+" de cada card de cada faixa (do primeiro ao último, rolando) não deixa nada solto nem deforma', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  const n = await pagina.locator('.faixa-rolo:visible').count();
  for (let i = 0; i < n; i++) {
    const rolo = pagina.locator('.faixa-rolo:visible').nth(i);
    await rolo.scrollIntoViewIfNeeded();
    const total = await rolo.locator(':scope > .produto-card').count();
    for (let k = 0; k < total; k++) {
      const c = rolo.locator(':scope > .produto-card').nth(k);
      await c.scrollIntoViewIfNeeded();
      const add = c.locator('[data-action="add"]');
      if (await add.count() && await add.first().isVisible()) await add.first().click();
      await pagina.waitForTimeout(40);
    }
  }
  await pagina.waitForTimeout(1200);
  await semProblemas(pagina, 'depois de tocar no + de todos os cards das faixas');
  semErros(erros); await fechar();
});

teste('iPhone: abrir um produto pela faixa e fechar volta igual (sem tela travada, sem faixa deformada)', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  const sel = '.faixa--mais .faixa-rolo';
  await pagina.locator(sel).scrollIntoViewIfNeeded();
  await pagina.locator(sel).evaluate((e) => e.scrollTo({ left: 200, behavior: 'instant' }));
  await pagina.locator(`${sel} .produto-card .produto-nome`).nth(2).click();
  await pagina.waitForFunction(() => document.querySelector('.modal-overlay.aberto'), null, { timeout: 4000 });
  await foto_(pagina, 'produto-aberto-pela-faixa');
  await pagina.keyboard.press('Escape');
  await pagina.waitForFunction(() => !document.querySelector('.modal-overlay.aberto'), null, { timeout: 4000 }).catch(() => {});
  if (await pagina.evaluate(() => !!document.querySelector('.modal-overlay.aberto'))) await pagina.evaluate(() => history.back());
  await pagina.waitForTimeout(500);
  assert.ok(!(await pagina.evaluate(() => !!document.querySelector('.modal-overlay.aberto'))), 'o produto fecha');
  const travada = await pagina.evaluate(() => getComputedStyle(document.body).overflow === 'hidden' || getComputedStyle(document.body).position === 'fixed');
  assert.ok(!travada, 'a página não fica travada depois de fechar');
  await semProblemas(pagina, 'depois de abrir e fechar o produto');
  semErros(erros); await fechar();
});

teste('iPhone: com a faixa rolada, a vitrine se refaz (preço mudou, ranking chegou) e continua certa', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  const sel = '.faixa--mais .faixa-rolo';
  await pagina.locator(sel).scrollIntoViewIfNeeded();
  await pagina.locator(sel).evaluate((e) => e.scrollTo({ left: 300, behavior: 'instant' }));
  for (let k = 0; k < 3; k++) { await pagina.evaluate(() => document.dispatchEvent(new Event('ranking-pronto'))); await pagina.waitForTimeout(120); }
  await pagina.evaluate(() => dispatchEvent(new Event('resize')));
  await pagina.waitForTimeout(300);
  await semProblemas(pagina, 'depois de a vitrine se refazer');
  semErros(erros); await fechar();
});

teste('iPhone: letra grande (Ajustes → Tamanho do texto) e zoom: faixas continuam certas', async () => {
  const { pagina, erros, fechar } = await abrir('/', { antes: () => { try { localStorage.setItem('banca_texto_grande', '1'); } catch (_) { /* sem armazenamento */ } } });
  await pagina.evaluate(() => { document.documentElement.classList.add('texto-grande'); document.documentElement.style.fontSize = '125%'; });
  await pagina.waitForTimeout(300);
  await foto_(pagina, 'letra-grande');
  await semProblemas(pagina, 'com letra grande');
  await rolarFaixa(pagina, '.faixa-rolo:visible >> nth=0', { nome: 'letra-grande' });
  semErros(erros); await fechar();
});

teste('iPhone: virar a tela (em pé → deitado → em pé) com faixa rolada não deixa card gigante', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  const sel = '.faixa--mais .faixa-rolo';
  await pagina.locator(sel).scrollIntoViewIfNeeded();
  await pagina.locator(sel).evaluate((e) => e.scrollTo({ left: 250, behavior: 'instant' }));
  for (const [w, h] of [[844, 390], [390, 844], [320, 640], [390, 844]]) {
    await pagina.setViewportSize({ width: w, height: h });
    await pagina.waitForTimeout(250);
    await semProblemas(pagina, `depois de virar para ${w}x${h}`);
  }
  semErros(erros); await fechar();
});

teste('iPhone: outras listas que rolam para o lado (categorias, bancas da feira, atalhos, sugestões da sacola) não passam da tela', async () => {
  const { pagina, erros, fechar } = await abrir('/?feira=florenca&entrar=1');
  const listas = ['#categorias', '.feira-lojas', '.atalhos', '.ia-sugestoes'];
  for (const sel of listas) {
    const el = pagina.locator(sel).first();
    if (!(await el.count()) || !(await el.isVisible())) continue;
    const fim = await el.evaluate((e) => e.scrollWidth - e.clientWidth);
    for (let x = 0; x <= fim; x += 80) {
      await el.evaluate((e, v) => e.scrollTo({ left: v, behavior: 'instant' }), x);
      await pagina.waitForTimeout(30);
      const problema = await el.evaluate((e) => {
        const r = e.getBoundingClientRect(), filhos = [...e.children].filter((c) => c.offsetParent !== null);
        const alto = filhos.find((c) => c.getBoundingClientRect().height > r.height + 2);
        return alto ? `item mais alto que a lista (${Math.round(alto.getBoundingClientRect().height)} > ${Math.round(r.height)})` : '';
      });
      assert.strictEqual(problema, '', `${sel} em ${x}px: ${problema}`);
    }
    const folga = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(folga <= 1, `${sel}: a página rola ${folga}px para o lado`);
  }
  // escolher a última categoria (lá no fim da lista) e voltar para "Todos"
  const cats = pagina.locator('#categorias .cat-btn');
  const nCats = await cats.count();
  if (nCats > 2) {
    await cats.nth(nCats - 1).scrollIntoViewIfNeeded(); await cats.nth(nCats - 1).click(); await pagina.waitForTimeout(300);
    await cats.first().scrollIntoViewIfNeeded(); await cats.first().click(); await pagina.waitForTimeout(400);
    await semProblemas(pagina, 'depois de escolher categoria e voltar para Todos');
  }
  semErros(erros); await fechar();
});

(async () => {
  servidor = await subir({
    // ranking de mentira: "Os mais pedidos" e "Seus de sempre" com o tomate na frente
    '/api/analytics': (c) => (c.acao === 'ranking' ? { sucesso: true, nivel: 'recorrente', maisPedidos: MAIS,
      itens: MAIS.map((id, i) => ({ id, p: 0.9 - i * 0.05, motivo: i < 4 ? 'Você sempre leva' : '' })) } : {}),
  });
  navegador = await pw[MOTOR].launch();
  console.log(`Motor: ${MOTOR} ${navegador.version()}`);
  let falhas = 0;
  for (const [nome, fn] of testes.filter(([n]) => !process.env.SO_TESTE || new RegExp(process.env.SO_TESTE).test(n))) {
    try { await fn(); console.log('  ok    ' + nome); }
    catch (e) { falhas++; console.log('  FALHOU ' + nome + '\n         ' + String((e && e.stack) || e).split('\n').slice(0, 8).join('\n         ')); }
  }
  await navegador.close(); servidor.srv.close();
  console.log(`\n${testes.length - falhas} de ${testes.length} testes no motor do iPhone (${MOTOR}) passaram.`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('Não consegui rodar os testes do iPhone:', e); process.exit(1); });
