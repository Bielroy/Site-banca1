'use strict';
// =====================================================================
//  testes/tela/tela.test.js — TESTES DE TELA: abre o site num navegador de
//  verdade (Chromium, tamanho de celular) e faz o que o cliente faz.
//
//  Usa os arquivos do projeto com um Firebase de mentira (servidor.js).
//  Toda página também é vigiada: qualquer erro de código derruba o teste.
//
//  Como roda (o GitHub faz sozinho a cada mudança, ver .github/workflows):
//     npm install --prefix testes/tela
//     npx --prefix testes/tela playwright install --with-deps chromium
//     node testes/tela/tela.test.js
// =====================================================================
const assert = require('assert');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(path.join(__dirname, 'node_modules', 'playwright'))); }
const { subir, cenarioPadrao } = require('./servidor');

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
const CELULAR = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };

let navegador, servidor;
/** Página nova com o cenário. Junta os erros de código da página em `erros`. */
async function abrir(caminho, cenario = cenarioPadrao(), opcoes = {}) {
  const ctx = await navegador.newContext({ ...CELULAR, ...(opcoes.contexto || {}) });
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenario);
  if (opcoes.antes) await ctx.addInitScript(opcoes.antes);
  // fontes do Google: fora da rede de teste (a página tem de funcionar sem elas)
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const pagina = await ctx.newPage(), erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon/i.test(m.text())) erros.push('console: ' + m.text()); });
  await pagina.goto(servidor.base + caminho);
  return { pagina, erros, ctx, fechar: () => ctx.close() };
}
// pedidos enviados (o mesmo endereço também atende a conta do cliente, com "acao")
const pedidosEnviados = () => servidor.chamadas.filter((c) => c.caminho === '/api/checkout' && !c.corpo.acao);
const semErros = (erros) => assert.deepStrictEqual(erros, [], 'a página teve erro de código:\n  ' + erros.join('\n  '));
const cards = (p) => p.locator('#lista-produtos .produto-card');
// a busca e as categorias ESCONDEM os cards (não tiram da página): conta só os visíveis
const visiveis = (p) => p.evaluate(() => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).map((c) => c.querySelector('.produto-nome').textContent.trim()));
const esperarVisiveis = (p, fn) => p.waitForFunction(fn, null, { timeout: 4000 });

// ---------------------------------------------------------------- LOJA
teste('loja abre no celular, mostra só os produtos ligados e sem erro de código', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  assert.strictEqual(await cards(pagina).count(), 4, 'os 4 ligados (o desligado não aparece)');
  assert.ok(!(await pagina.locator('#lista-produtos').innerText()).includes('Produto desligado'));
  // nada passa da largura da tela (sem rolagem para o lado)
  const largura = await pagina.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(largura <= 392, `a página ficou mais larga que o celular (${largura}px)`);
  semErros(erros); await fechar();
});

teste('busca e categoria filtram a vitrine', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.fill('#busca-input', 'banana');
  await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).length === 1);
  assert.deepStrictEqual(await visiveis(pagina), ['Banana prata']);
  await pagina.fill('#busca-input', '');
  await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).length === 4);
  await pagina.click('.cat-btn[data-cat="verduras"]');
  await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).length === 1);
  assert.deepStrictEqual(await visiveis(pagina), ['Alface crespa']);
  semErros(erros); await fechar();
});

teste('pedido de ponta a ponta: põe na sacola, preenche a entrega, envia e vê o WhatsApp', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  // o produto vendido por unidade entra direto pelo botão do card (sem balança)
  const ovos = cards(pagina).filter({ hasText: 'Ovos' });
  await ovos.locator('[data-action="add"]').first().click();
  await pagina.waitForFunction(() => Number((document.getElementById('qtd-flutuante') || {}).textContent || 0) >= 1, null, { timeout: 4000 });
  await pagina.click('#btn-carrinho-mobile');
  await pagina.click('#btn-abrir-checkout');
  await pagina.waitForSelector('#modal-checkout.active, #modal-checkout.aberto, #modal-checkout[aria-hidden="false"]', { timeout: 4000 });
  // sem nome e endereço, o site avisa e NÃO envia
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForTimeout(300);
  assert.strictEqual(pedidosEnviados().length, 0, 'não enviou sem endereço');
  // preenche
  // condomínio: da lista (se a loja tiver lista) ou escrito à mão; depois quadra e lote
  const lista = pagina.locator('#checkout-endereco select:visible');
  if (await lista.count()) await lista.first().selectOption({ index: 1 });
  const campos = pagina.locator('#checkout-endereco input:visible');
  for (let i = 0; i < await campos.count(); i++) await campos.nth(i).fill(['Jardins Florença', '12', '7'][i] || '1');
  await pagina.fill('#cli-nome', 'Cliente Teste');
  await pagina.fill('#cli-telefone', '62999998888');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 6000 });
  const pedido = pedidosEnviados().pop();
  assert.ok(pedido, 'o pedido foi para o servidor');
  assert.ok(JSON.stringify(pedido.corpo).includes('ovos'), 'com o produto escolhido');
  assert.ok((await pagina.getAttribute('#sucesso-whatsapps .btn-wpp', 'href')).startsWith('https://wa.me/'));
  semErros(erros); await fechar();
});

teste('outra loja abre com o nome, as cores e os produtos dela', async () => {
  const { pagina, erros, fechar } = await abrir('/?loja=paes-da-lucia');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  assert.ok((await cards(pagina).first().innerText()).includes('Pão francês'));
  await pagina.waitForFunction(() => /Lúcia/.test(document.getElementById('header-nome').textContent), null, { timeout: 4000 });
  const cor = await pagina.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--forest').trim().toLowerCase());
  assert.strictEqual(cor, '#5a3a22', 'cor principal da loja');
  semErros(erros); await fechar();
});

teste('loja desligada pela plataforma avisa "fora do ar" e não mostra produto', async () => {
  const { pagina, erros, fechar } = await abrir('/?loja=loja-off');
  await pagina.waitForFunction(() => /fora do ar/i.test(document.getElementById('lista-produtos').innerText), null, { timeout: 8000 });
  assert.ok(!(await pagina.locator('#lista-produtos').innerText()).includes('Não devia aparecer'));
  semErros(erros.filter((e) => !/permission|permiss/i.test(e))); await fechar();
});

// ---------------------------------------------------------------- VELOCIDADE / TELA ESTÁVEL
const medirPulos = () => { window.__pulos = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__pulos += e.value; }).observe({ type: 'layout-shift', buffered: true }); };
teste('a ordem personalizada que chega depois NÃO embaralha a vitrine; na próxima visita ela já abre na ordem', async () => {
  const { pagina, erros, ctx, fechar } = await abrir('/', cenarioPadrao(), { antes: medirPulos });
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForTimeout(2200);                                  // o ranking (de mentira) chega com 1,5 s
  const pulos = await pagina.evaluate(() => window.__pulos);
  assert.ok(pulos < 0.05, `a tela pulou ${pulos.toFixed(3)} (antes da correção: 0,43)`);
  assert.deepStrictEqual(await visiveis(pagina), ['Tomate italiano', 'Alface crespa', 'Banana prata', 'Ovos caipira (dúzia)'], 'cards ficam onde estavam');
  // segunda visita (mesmo aparelho): a ordem guardada vale desde a abertura
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => erros.push(e.message));
  await p2.goto(servidor.base + '/'); await cards(p2).first().waitFor({ timeout: 8000 });
  const ordem = await p2.evaluate(() => [...document.querySelectorAll('#lista-produtos .produto-card')].sort((a, b) => (+a.style.order || 0) - (+b.style.order || 0)).map((c) => c.dataset.id));
  assert.deepStrictEqual(ordem, ['ovos', 'banana', 'alface', 'tomate'], 'ordem do ranking guardado');
  semErros(erros); await fechar();
});

teste('letras: a banca liga as letras dela; loja com outras letras não baixa as da banca', async () => {
  let { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  assert.strictEqual(await pagina.getAttribute('#fontes-banca', 'media'), 'all', 'banca usa Fraunces/Figtree');
  semErros(erros); await fechar();
  const cen = cenarioPadrao(); cen.lojas['paes-da-lucia'].ficha.tema = { primaria: '#5a3a22', fonteTitulo: 'Playfair Display', fonteTexto: 'Lato' };
  ({ pagina, erros, fechar } = await abrir('/?loja=paes-da-lucia', cen));
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForTimeout(300);
  assert.strictEqual(await pagina.getAttribute('#fontes-banca', 'media'), 'print', 'as letras da banca ficam desligadas');
  const pedidas = await pagina.evaluate(() => [...document.querySelectorAll('link[data-fonte]')].map((l) => l.dataset.fonte).sort());
  assert.deepStrictEqual(pedidas, ['Lato', 'Playfair Display']);
  semErros(erros); await fechar();
});

// ---------------------------------------------------------------- FEIRA
teste('link da feira abre direto na banca, com a faixa das bancas no topo, e lembra a última', async () => {
  const { pagina, erros, fechar } = await abrir('/feira/florenca');
  await pagina.waitForSelector('#feira-lojas:not([hidden]) a', { timeout: 8000 });
  assert.ok(!pagina.url().includes('entrar='), 'o "entrar" sai do endereço');
  const nomes = await pagina.locator('#feira-lojas a').allInnerTexts();
  assert.deepStrictEqual(nomes.map((n) => n.trim()), ['Banca Adair e Pedrina', 'Pães da Lúcia']);
  await pagina.click('#feira-lojas a:not(.atual)');
  await pagina.waitForURL(/loja=paes-da-lucia/, { timeout: 6000 });
  // a loja grava "a última banca desta feira" depois de abrir: espera essa gravação antes de voltar ao link
  await pagina.waitForFunction(() => /paes-da-lucia/.test(localStorage.getItem('banca_feira_ultima') || ''), null, { timeout: 6000 });
  await pagina.goto(servidor.base + '/feira/florenca');
  await pagina.waitForURL(/loja=paes-da-lucia/, { timeout: 6000 });
  semErros(erros); await fechar();
});

// ---------------------------------------------------------------- REGISTRO DE ERROS
teste('erro de código na loja é avisado ao servidor (sem os parâmetros do endereço)', async () => {
  const { pagina, fechar } = await abrir('/?loja=paes-da-lucia&tel=62999', cenarioPadrao(), { antes: () => { window.__errosSiteTeste = true; } });
  await cards(pagina).first().waitFor({ timeout: 8000 });
  const antes = servidor.chamadas.length;
  await pagina.evaluate(() => { setTimeout(() => { throw new Error('quebrou de propósito'); }, 0); });
  await pagina.waitForTimeout(600);
  const aviso = servidor.chamadas.slice(antes).find((c) => c.caminho === '/api/analytics' && c.corpo.acao === 'erro');
  assert.ok(aviso, 'o aviso de erro chegou');
  assert.strictEqual(aviso.corpo.msg, 'Uncaught Error: quebrou de propósito');
  assert.strictEqual(aviso.corpo.loja, 'paes-da-lucia');
  assert.strictEqual(aviso.corpo.pagina, '/', 'página sem parâmetros');
  assert.ok(!JSON.stringify(aviso.corpo).includes('62999'));
  await fechar();
});

// ---------------------------------------------------------------- PLATAFORMA
teste('plataforma: a aba Erros mostra os erros agrupados', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dono', email: 'dono@teste.com', isAnonymous: false, claims: { plataforma: true } } });
  const { pagina, erros, fechar } = await abrir('/plataforma.html', cen, { antes: () => { try { localStorage.setItem('pf_aba', 'erros'); } catch (_) { /* segue */ } } });
  await pagina.waitForSelector('.pf-erro', { timeout: 8000 });
  const txt = await pagina.locator('.pf-erros').innerText();
  assert.ok(txt.includes("Cannot read properties of undefined") && txt.includes('3×') && txt.includes('Android · Chrome 129'));
  semErros(erros); await fechar();
});

teste('plataforma: "Cartaz com QR" de cada feira manda para a impressão o cartaz com o link DAQUELA feira', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dono', email: 'dono@teste.com', isAnonymous: false, claims: { plataforma: true } } });
  const { pagina, erros, fechar } = await abrir('/plataforma.html', cen, { antes: () => { try { localStorage.setItem('pf_aba', 'feiras'); } catch (_) { /* segue */ } } });
  await pagina.waitForSelector('[data-pf="cartaz-feira"]', { timeout: 8000 });
  assert.strictEqual(await pagina.locator('[data-pf="cartaz-feira"]').count(), 2, 'um botão por feira');
  await pagina.evaluate(() => { window.print = () => {}; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.tagName === 'IFRAME' && n.srcdoc) window.__cartaz = n.srcdoc; }))).observe(document.body, { childList: true }); });
  await pagina.click('[data-pf="cartaz-feira"][data-feira="feira-do-lago"]');
  await pagina.waitForFunction(() => !!window.__cartaz, null, { timeout: 5000 });
  const html = await pagina.evaluate(() => window.__cartaz);
  assert.ok(html.includes('Feira do Lago') && html.includes('/feira/feira-do-lago') && !html.includes('feira-do-bairro'), 'cartaz da feira clicada');
  assert.ok(/aria-label="QR Code: [^"]*\/feira\/feira-do-lago"/.test(html) && /<path fill="#1a3a2a" d="M/.test(html), 'QR desenhado');
  semErros(erros); await fechar();
});

// ---------------------------------------------------------------- PACOTES
const cenarioPacotes = () => {
  const cen = cenarioPadrao();
  cen.lojas.banca.produtos = {
    batata: { nome: 'Batata inglesa', preco: 6.5, unidade: 'kg', cat: 'legumes', ativo: true, pesoMedio: 180, nomeUn: 'batata' },
    alface: { nome: 'Alface crespa', preco: 4.5, unidade: 'un', cat: 'verduras', ativo: true },
    bb: { nome: 'Batata baby', preco: 3, unidade: 'un', cat: 'legumes', ativo: true, pacote: true, pesoPacote: '500 g', promoQtd: 4, promoPreco: 10 },
    cb: { nome: 'Cenoura baby', preco: 3, unidade: 'un', cat: 'legumes', ativo: true, pacote: true },
  };
  return cen;
};
teste('pacotes: bloco no fim da vitrine, atalho "Pacotes", "+ 1 pacote", sacola em palavras e comanda com a promoção', async () => {
  const { pagina, erros, fechar } = await abrir('/', cenarioPacotes());
  await cards(pagina).first().waitFor({ timeout: 8000 });
  // o bloco "Pacotes prontos" vem DEPOIS de tudo que é solto (CSS order), com os dois pacotes
  const ordem = await pagina.evaluate(() => [...document.querySelectorAll('#lista-produtos > .produto-card, #lista-produtos > .bloco-pacotes')]
    .map((e, i) => ({ o: Number(e.style.order) || 0, i, k: e.classList.contains('bloco-pacotes') ? 'BLOCO' : e.dataset.id })).sort((a, b) => a.o - b.o || a.i - b.i).map((x) => x.k));
  assert.strictEqual(ordem[ordem.length - 3], 'BLOCO', 'o cabeçalho vem logo antes dos pacotes: ' + ordem.join(','));
  assert.deepStrictEqual(ordem.slice(-2).sort(), ['bb', 'cb'], 'os pacotes ficam no fim: ' + ordem.join(','));
  assert.ok(ordem.indexOf('BLOCO') > ordem.indexOf('batata') && ordem.indexOf('BLOCO') > ordem.indexOf('alface'), ordem.join(','));
  assert.ok(/Pacotes prontos/.test(await pagina.locator('.bloco-pacotes').innerText()));
  const bb = pagina.locator('#lista-produtos .produto-card[data-id="bb"]'), cb = pagina.locator('#lista-produtos .produto-card[data-id="cb"]');
  assert.ok(/PACOTE/i.test(await bb.locator('.lacre-pacote').innerText()) && (await bb.locator('.peso-pacote').innerText()) === '500 g');
  assert.strictEqual(await cb.locator('.peso-pacote').count(), 0, 'sem peso cadastrado: só "PACOTE"');
  assert.ok(/4 por R\$ 10/.test(await bb.locator('.etq-promo').innerText()));
  // atalho "Pacotes" mostra só os pacotes
  await pagina.locator('#categorias .cat-btn[data-cat="pacotes"]').click();
  await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).length === 2);
  assert.deepStrictEqual((await visiveis(pagina)).sort(), ['Batata baby', 'Cenoura baby']);
  await pagina.locator('#categorias .cat-btn[data-cat="todas"]').click();
  // + 1 pacote, 4 vezes: entra a promoção
  await bb.scrollIntoViewIfNeeded();
  assert.strictEqual((await bb.locator('[data-action="add"]').innerText()).trim(), '+ 1 pacote');
  await bb.locator('[data-action="add"]').click();
  for (let i = 0; i < 3; i++) await bb.locator('[data-action="inc"]').click();
  await pagina.waitForFunction(() => /4 pacotes/.test(document.querySelector('#lista-produtos .produto-card[data-id="bb"] .card-qtd')?.innerText || ''), null, { timeout: 3000 });
  { const t = await bb.locator('.card-qtd').innerText(); assert.ok(/R\$\s*10,00/.test(t), 'o contador já mostra o valor com a promoção: ' + JSON.stringify(t)); }
  // 1 batata inglesa (por unidade): o botão diz "+ 1 batata"
  const batata = pagina.locator('#lista-produtos .produto-card[data-id="batata"]');
  await batata.scrollIntoViewIfNeeded();
  await batata.locator('[data-action="add"][data-modo="un"]').click();
  // sacola: grupos, palavras e o aviso "também tem em pacote"
  await pagina.locator('#btn-carrinho-mobile').click();
  const sacola = await pagina.locator('#carrinho-itens').innerText();
  assert.ok(/Pesados na hora/i.test(sacola) && /Pacotes prontos/i.test(sacola), sacola);
  assert.ok(/1 batata · ≈ 180 g/.test(sacola) && /4 pacotes de 500 g/.test(sacola) && /promoção 4 por R\$ 10/.test(sacola), sacola);
  assert.ok(/Também tem em pacote: Batata baby/.test(sacola), sacola);
  assert.ok(/R\$\s10,00/.test(await pagina.locator('#cart-row-bb .item-preco').innerText()));
  // comanda: o pedido como a banca recebe
  await pagina.locator('#btn-abrir-checkout').click();
  const comanda = await pagina.locator('#comanda').innerText();
  assert.ok(/4 pacotes/.test(comanda) && /1 batata/.test(comanda) && /pacote de 500 g/.test(comanda) && /promoção 4 por R\$ 10/.test(comanda), comanda);
  assert.ok(/≈ R\$\s11,17/.test(comanda), 'total estimado = R$ 10 (pacotes) + ≈ R$ 1,17 (1 batata)\n' + comanda);
  assert.ok(!/tem certeza/i.test(comanda));
  semErros(erros); await fechar();
});

teste('pacotes: "4 por R$ 10" misturando 2 de batata e 2 de cenoura (cartão, sacola e comanda)', async () => {
  const cen = cenarioPacotes();
  Object.assign(cen.lojas.banca.produtos.cb, { promoQtd: 4, promoPreco: 10 });
  const { pagina, erros, fechar } = await abrir('/', cen);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  const bb = pagina.locator('#lista-produtos .produto-card[data-id="bb"]'), cb = pagina.locator('#lista-produtos .produto-card[data-id="cb"]');
  assert.ok(/4 por R\$ 10 · pode misturar/.test(await bb.locator('.etq-promo').innerText()), 'a etiqueta avisa que dá para misturar');
  await bb.scrollIntoViewIfNeeded();
  await bb.locator('[data-action="add"]').click();
  await cb.locator('[data-action="add"]').click(); await cb.locator('[data-action="inc"]').click();
  await pagina.waitForFunction(() => /Mais 1, de qualquer pacote,/.test(document.querySelector('#lista-produtos .produto-card[data-id="cb"] .card-acao')?.innerText || ''), null, { timeout: 3000 });
  await bb.locator('[data-action="inc"]').click();
  // 2 + 2 = R$ 10: cada cartão mostra R$ 5 (o da batata muda também quando a cenoura completa)
  await pagina.waitForFunction(() => ['bb', 'cb'].every((id) => /R\$\s*5,00/.test(document.querySelector(`#lista-produtos .produto-card[data-id="${id}"] .card-qtd`)?.innerText || '')), null, { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#lista-produtos .promo-falta').count(), 0, 'promoção completa: some o "falta"');
  await pagina.locator('#btn-carrinho-mobile').click();
  for (const id of ['bb', 'cb']) assert.ok(/R\$\s5,00/.test(await pagina.locator(`#cart-row-${id} .item-preco`).innerText()), id);
  await pagina.locator('#btn-abrir-checkout').click();
  const comanda = await pagina.locator('#comanda').innerText();
  assert.ok((comanda.match(/promoção 4 por R\$ 10/g) || []).length === 2, comanda);
  assert.ok(/R\$\s10,00/.test(await pagina.locator('#comanda .cm-total').innerText()), comanda);
  semErros(erros); await fechar();
});

teste('pacotes: no painel, peso do pacote em branco é aceito e promoção mais cara é recusada', async () => {
  const cen = cenarioPacotes(); cen.conta = { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('[data-action="editar-produto"][data-id="cb"]').first().click({ timeout: 8000 });
  assert.ok(await pagina.locator('#edit-pacote').isChecked());
  assert.strictEqual(await pagina.locator('#edit-peso-pacote').inputValue(), '');
  await pagina.fill('#edit-promo-qtd', '4'); await pagina.fill('#edit-promo-preco', '15');
  assert.ok(/não sai mais barato/.test(await pagina.locator('#promo-previa').innerText()));
  await pagina.click('#btn-salvar-produto');
  await pagina.waitForTimeout(400);
  assert.ok(!(await pagina.evaluate(() => (window.__gravados || []).some((g) => /produtos\/cb$/.test(g.path)))), 'promoção mais cara não grava');
  await pagina.fill('#edit-promo-preco', '10');
  await pagina.click('#btn-salvar-produto');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /produtos\/cb$/.test(g.path)), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.filter((x) => /produtos\/cb$/.test(x.path)).pop().dados);
  assert.strictEqual(g.pacote, true); assert.strictEqual(g.pesoPacote, ''); assert.strictEqual(g.promoQtd, 4); assert.strictEqual(g.promoPreco, 10);
  assert.strictEqual(g.nome, 'Cenoura baby', 'o nome é o que a loja escreveu');
  semErros(erros); await fechar();
});

teste('pacotes: no painel da Vitrine, título do bloco dos pacotes e faixa "Molhos" por categoria são gravados', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/testes/tela/painel-aparencia.html', cen);
  await pagina.waitForSelector('#vt-gravar', { timeout: 8000 });
  await pagina.locator('summary:has-text("Bloco dos pacotes")').click();
  await pagina.fill('#vt-pac-titulo', 'Pacotinhos da banca');
  await pagina.locator('summary:has-text("Faixas que você cria")').click();
  await pagina.click('[data-acao-vt="mais-faixa"]');
  await pagina.fill('[data-fx="0"][data-campo="titulo"]', 'Frutas da semana');
  await pagina.click('#vt-gravar');
  await pagina.waitForTimeout(300);
  assert.ok(!(await pagina.evaluate(() => (window.__gravados || []).some((g) => g.path === 'loja/config'))), 'faixa sem categoria não grava');
  await pagina.selectOption('select[data-fx="0"]', 'frutas');
  await pagina.click('#vt-gravar');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config'), null, { timeout: 4000 });
  const v = await pagina.evaluate(() => window.__gravados.find((x) => x.path === 'loja/config').dados.vitrine);
  assert.deepStrictEqual(v.pacotes, { titulo: 'Pacotinhos da banca', texto: '' });
  assert.deepStrictEqual(v.faixas, [{ titulo: 'Frutas da semana', texto: '', cat: 'frutas' }]);
  semErros(erros); await fechar();
});

// ---------------------------------------------------------------- PAINEL
teste('painel: a aba Aparência abre e a prévia da loja carrega dentro dela', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/testes/tela/painel-aparencia.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.waitForSelector('#aparencia-conteudo iframe', { timeout: 8000 });
  const quadro = pagina.frameLocator('#aparencia-conteudo iframe');
  await quadro.locator('#lista-produtos .produto-card').first().waitFor({ timeout: 10000 });
  assert.ok(await pagina.locator('#ap-previa-falhou').isHidden().catch(() => true), 'sem o aviso de prévia que não abriu');
  semErros(erros); await fechar();
});

teste('painel: Vitrine (na aba Aparência) cria um quadro com botão de categoria e grava em loja/config', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/testes/tela/painel-aparencia.html', cen);
  await pagina.waitForSelector('#vt-gravar', { timeout: 8000 });
  // sem mudança o botão continua tocável (apagado parecia quebrado): só avisa e não grava nada
  assert.ok(await pagina.locator('#vt-gravar').isEnabled(), 'Gravar sempre tocável fora do envio de foto');
  await pagina.click('#vt-gravar');
  await pagina.waitForTimeout(300);
  assert.ok(!(await pagina.evaluate(() => (window.__gravados || []).some((g) => g.path === 'loja/config'))), 'sem mudança: não grava');
  await pagina.click('[data-acao-vt="mais"]');
  await pagina.fill('[data-q="0"][data-campo="titulo"]', 'Manga no ponto');
  await pagina.fill('[data-q="0"][data-campo="texto"]', 'Aperte de leve.');
  await pagina.selectOption('select[data-q="0"]', 'frutas');
  await pagina.fill('#vt-donos-titulo', 'Adair e Pedrina');
  await pagina.fill('#vt-donos-texto', 'Escolhemos cada pedido.');
  await pagina.click('#vt-gravar');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config'), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.find((x) => x.path === 'loja/config').dados);
  assert.deepStrictEqual(g, { vitrine: { quadros: [{ titulo: 'Manga no ponto', texto: 'Aperte de leve.', cat: 'frutas' }], donos: { titulo: 'Adair e Pedrina', texto: 'Escolhemos cada pedido.' } } });
  assert.ok(await pagina.locator('#vt-funil table').isVisible(), 'quadro de visitas aparece (zerado)');
  semErros(erros); await fechar();
});

teste('loja: quadro e "quem escolhe" entram no meio da vitrine, selos aparecem e o botão do quadro abre a categoria', async () => {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const cen = cenarioPadrao();
  const b = cen.lojas.banca;
  for (let i = 0; i < 12; i++) b.produtos['extra' + i] = { nome: 'Fruta ' + i, preco: 5, unidade: 'un', cat: 'frutas', ativo: true };
  b.produtos.banana = { ...b.produtos.banana, chegouEm: hoje, estacao: true };
  b.produtos.alface = { ...b.produtos.alface, chegouEm: hoje };
  b.config = { ...b.config, vitrine: { escolha: 'Escolha da Pedrina', quadros: [{ titulo: 'Manga no ponto', texto: 'Aperte de leve.', cat: 'verduras' }], donos: { titulo: 'Adair e Pedrina', texto: 'Escolhemos cada pedido.' } } };
  b.produtos.ovos = { ...b.produtos.ovos, escolha: true };
  const { pagina, erros, fechar } = await abrir('/', cen);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForSelector('.bloco-quadro', { timeout: 4000 });
  assert.strictEqual(await pagina.locator('#faixas-topo .faixa--chegou .produto-card').count(), 2, 'faixa "Chegou hoje" com os 2 marcados hoje');
  assert.strictEqual(await pagina.locator('#lista-produtos .produto-card[data-id="ovos"] .selo--escolha').innerText(), 'Escolha da Pedrina');
  const ordem = await pagina.evaluate(() => [...document.querySelectorAll('#lista-produtos > *')].filter((e) => e.offsetParent).map((e) => (e.classList.contains('bloco-quadro') ? 'Q' : e.classList.contains('bloco-donos') ? 'D' : 'p')).join(''));
  assert.strictEqual(ordem.indexOf('Q'), 6, 'quadro depois do 6º produto: ' + ordem);
  assert.strictEqual(ordem.replace('Q', '').indexOf('D'), 14, '"quem escolhe" depois do 14º: ' + ordem);
  await pagina.fill('#busca-input', 'banana');
  await pagina.waitForFunction(() => !document.querySelector('.bloco-quadro') || document.querySelector('.bloco-quadro').offsetParent === null, null, { timeout: 4000 });
  await pagina.fill('#busca-input', '');
  await pagina.waitForFunction(() => document.querySelector('.bloco-quadro')?.offsetParent, null, { timeout: 4000 });
  // como uma pessoa: rola até o quadro, espera parar e toca (a rolagem da loja é suave)
  await pagina.locator('.bloco-quadro').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await pagina.waitForTimeout(600);
  await pagina.click('.bloco-quadro .bloco-bt');
  await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).length === 1);
  assert.deepStrictEqual(await visiveis(pagina), ['Alface crespa'], 'o botão "Ver Verduras" abriu a categoria');
  const largura = await pagina.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(largura <= 392, `a página ficou mais larga que o celular (${largura}px)`);
  semErros(erros); await fechar();
});

teste('lista da semana: cartão na sacola guarda a lista, "Só guardar" esvazia a sacola e a lista vai para o topo', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  assert.ok(await pagina.locator('#lista-semana-card').isHidden(), 'sacola vazia: sem cartão');
  await pagina.locator('#lista-produtos .produto-card[data-id="alface"] .card-add').click();
  await pagina.locator('#lista-produtos .produto-card[data-id="ovos"] .card-add').click();
  await pagina.locator('#btn-carrinho-mobile').click();
  await pagina.waitForSelector('#lista-semana-card:not([hidden])', { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#btn-guardar-lista').innerText(), 'Guardar lista');
  await pagina.click('#btn-guardar-lista');
  await pagina.getByRole('button', { name: 'Só guardar' }).click();
  await pagina.waitForFunction(() => document.getElementById('qtd-badge')?.textContent.trim() === '0', null, { timeout: 3000 });
  await pagina.waitForSelector('#atalhos [data-action="por-lista"]', { timeout: 3000 });
  assert.match(await pagina.locator('#atalhos [data-action="por-lista"]').innerText(), /Minha lista da semana[\s\S]*2 itens/);
  await pagina.click('#atalhos [data-action="por-lista"]');
  await pagina.waitForFunction(() => document.getElementById('qtd-badge')?.textContent.trim() === '2', null, { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#lista-semana-titulo').innerText(), 'Esta é a sua lista da semana');
  semErros(erros); await fechar();
});

teste('painel: rótulo adesivo do milho é montado, salvo no produto e 15 cópias vão para a impressão', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/testes/tela/painel-rotulos.html?p=milho', cen);
  await pagina.waitForSelector('#modal-rotulos.aberto', { timeout: 8000 });
  assert.strictEqual(await pagina.locator('#rt-produto').inputValue(), 'milho');
  assert.ok(await pagina.locator('#rt-montar').evaluate((d) => d.open), 'produto sem rótulo: já abre para montar');
  await pagina.fill('#rt-nome', 'Milho da roça');
  await pagina.fill('#rt-sub', 'Colhido hoje');
  await pagina.selectOption('#rt-validade', '5');
  await pagina.click('#rt-salvar');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'produtos/milho'), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.find((x) => x.path === 'produtos/milho').dados.rotulo);
  assert.deepStrictEqual(g, { titulo: 'Milho da roça', sub: 'Colhido hoje', preco: false, loja: true, validadeDias: 5, borda: 'feira' });
  // a prévia desenhou alguma coisa (não ficou branca)
  const tinta = await pagina.evaluate(() => { const c = document.getElementById('rt-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return { n, w: c.width }; });
  assert.ok(tinta.n > 500 && tinta.w === 762, 'rótulo desenhado no tamanho da folha A4 de 21: ' + JSON.stringify(tinta));
  await pagina.fill('#rt-qtd', '15');
  assert.match(await pagina.locator('#rt-resumo').innerText(), /15 rótulos .* 1 folha A4/);
  await pagina.evaluate(() => { window.print = () => {}; HTMLIFrameElement.prototype.__x = 1; });
  await pagina.click('#rt-imprimir');
  await pagina.waitForFunction(() => [...document.querySelectorAll('iframe')].some((f) => /Rótulos/.test(f.srcdoc || '')), null, { timeout: 6000 });
  const n = await pagina.evaluate(() => ([...document.querySelectorAll('iframe')].find((f) => /Rótulos/.test(f.srcdoc)).srcdoc.match(/<img /g) || []).length);
  assert.strictEqual(n, 15, '15 rótulos na página de impressão');
  // produto com rótulo salvo: abre fechado, pronto para imprimir
  await pagina.selectOption('#rt-produto', 'tomatinho');
  assert.ok(!(await pagina.locator('#rt-montar').evaluate((d) => d.open)), 'com rótulo salvo: só dizer quantos e imprimir');
  assert.strictEqual(await pagina.locator('#rt-nome').inputValue(), 'Tomatinhos');
  semErros(erros); await fechar();
});

// ---------------------------------------------------------------- PAINEL: FILA DE PEDIDOS
const cenarioFila = (extra = {}) => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } }, ...extra });
  const agora = new Date().toISOString(), base = { total: 0, pag: 'PIX', quadra: '1', data: agora, cupom: { codigo: 'FAMILIA', percentual: 100, desconto: 0 } };
  cen.lojas.banca.pedidos = {
    'ped-a-pesar': { ...base, nome: 'Cliente Novo', lote: '3', status: 'aguardando_pesagem', temItensAPesar: true, itens: [{ id: 'tomate', nome: 'Tomate italiano', qtd: 2, tipo: 'un', unidade: 'kg', aPesar: true, precoOriginal: 9.9, subtotal: 0 }] },
    // gravado como "a pesar", mas os itens já foram pesados (cópia velha no aparelho, ou status atrasado)
    'ped-pesado': { ...base, nome: 'Namorada', lote: '2', status: 'aguardando_pesagem', itens: [{ id: 'tomate', nome: 'Tomate italiano', qtd: 3, tipo: 'un', unidade: 'kg', aPesar: false, pesoFinal: 0.9, precoOriginal: 9.9, subtotal: 8.91 }] },
  };
  return cen;
};
const abrirFila = async (cen) => {
  const aberto = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await aberto.pagina.locator('.tab[data-aba="relatorios"]').click();
  await aberto.pagina.locator('.card-pedido').first().waitFor({ timeout: 8000 });
  return aberto;
};
const cartao = (p, nome) => p.locator('.card-pedido', { hasText: nome });

teste('painel: pedido pesado sai de "Pesar os itens"; item por unidade aparece em "un", não "kg"', async () => {
  const { pagina, erros, fechar } = await abrirFila(cenarioFila());
  const novo = await cartao(pagina, 'Cliente Novo').innerText(), pesado = await cartao(pagina, 'Namorada').innerText();
  assert.ok(/2 un Tomate/.test(novo) && /Pesar os itens/.test(novo), 'pedido a pesar: "2 un" e o botão de pesar\n' + novo);
  assert.ok(!/2 kg/.test(novo), 'pedido por unidade não aparece em kg');
  assert.ok(/SEPARANDO/.test(pesado) && /3 un \(0,9 kg\)/.test(pesado) && !/Pesar os itens/.test(pesado), 'já pesado vai para Separando\n' + pesado);
  assert.ok(await pagina.locator('#faixa-fila-copia').count() === 0, 'com o banco respondendo, sem faixa de fila desatualizada');
  semErros(erros); await fechar();
});

teste('painel: depois de salvar a pesagem, o cartão muda na hora (sem esperar o banco)', async () => {
  const { pagina, erros, fechar } = await abrirFila(cenarioFila());
  await cartao(pagina, 'Cliente Novo').getByRole('button', { name: 'Pesar os itens' }).click();
  await pagina.locator('#pk-peso').fill('0.8');
  await pagina.locator('#pk-avancar').click();
  await pagina.locator('#pk-salvar-sem-enviar').click();
  await pagina.waitForFunction(() => !document.getElementById('picking-palco')?.classList.contains('aberto'), null, { timeout: 5000 });
  const chamada = servidor.chamadas.filter((c) => c.caminho === '/api/pdv').pop();
  assert.ok(chamada && chamada.corpo.acao === 'pesagem' && chamada.corpo.pedidoId === 'ped-a-pesar', 'mandou a pesagem para o servidor');
  await pagina.waitForFunction(() => /SEPARANDO/.test([...document.querySelectorAll('.card-pedido')].find((c) => c.innerText.includes('Cliente Novo'))?.innerText || ''), null, { timeout: 4000 });
  const depois = await cartao(pagina, 'Cliente Novo').innerText();
  assert.ok(!/Pesar os itens/.test(depois) && /2 un \(0,8 kg\)/.test(depois), 'o cartão mostra o pedido pesado\n' + depois);
  semErros(erros); await fechar();
});

teste('painel: fila vinda da cópia do aparelho (sem conexão com o banco) mostra o aviso', async () => {
  const { pagina, erros, fechar } = await abrirFila(cenarioFila({ daCopia: true }));
  await pagina.locator('#faixa-fila-copia').waitFor({ timeout: 7000 });
  assert.ok(/fila pode estar desatualizada/.test(await pagina.locator('#faixa-fila-copia').innerText()));
  semErros(erros); await fechar();
});

(async () => {
  servidor = await subir({
    // pesagem (de mentira): devolve o pedido pesado como o api/pdv.js de verdade
    '/api/pdv': (c) => (c.acao === 'pesagem' ? { sucesso: true, total: 0, desconto: 7.92, entrega: 0, itens: [{ id: 'tomate', nome: 'Tomate italiano', qtd: 2, tipo: 'un', unidade: 'kg', aPesar: false, pesoFinal: 0.8, precoOriginal: 9.9, subtotal: 7.92 }] } : {}),
    // ranking (de mentira) da banca, ao contrário da ordem do cadastro, chegando 1,5 s depois
    '/api/analytics': (c) => (c.acao === 'ranking' ? new Promise((ok) => setTimeout(() => ok({ sucesso: true, nivel: 'popular', itens: ['ovos', 'banana', 'alface', 'tomate'].map((id, i) => ({ id, p: 0.9 - i * 0.2 })) }), 1500)) : {}),
    '/api/checkout': (c) => (c.acao ? {} : { sucesso: true, temConta: false, pedido: { id: 'PED123', total: 14, paraHoje: true, whatsapps: [{ nome: 'Banca', url: 'https://wa.me/5562999990000?text=Pedido' }] } }),
    '/api/plataforma': (c) => (c.acao === 'situacao' ? { sucesso: true, temDono: true, souEu: true }
      : c.acao === 'erros' ? { sucesso: true, erros: [{ id: 'e1', msg: "Cannot read properties of undefined (reading 'preco')", vezes: 3, ultimo: new Date().toISOString(), onde: '/assets/main-X.js:10:5', paginas: ['/'], navegadores: ['Android · Chrome 129'], lojas: ['banca'], pilha: 'at x' }] }
      : c.acao === 'lojas' ? { sucesso: true, lojas: [{ id: 'banca', nome: 'Banca Adair e Pedrina', ativo: true, original: true, donos: ['dona@teste.com'], cor: '#1a3a2a', mes: { receita: 0, pedidos: 0 } }], feiras: [{ id: 'feira-do-bairro', nome: 'Feira do Bairro', dias: [2], lojas: ['banca'], condominiosIds: [] }, { id: 'feira-do-lago', nome: 'Feira do Lago', dias: [4], lojas: ['banca'], condominiosIds: [] }], condominios: [], pix: false, fotos: false } : {}),
  });
  navegador = await chromium.launch();
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('  ok    ' + nome); }
    catch (e) { falhas++; console.log('  FALHOU ' + nome + '\n         ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n         ')); }
  }
  await navegador.close(); servidor.srv.close();
  console.log(`\n${testes.length - falhas} de ${testes.length} testes de tela passaram.`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('Não consegui rodar os testes de tela:', e); process.exit(1); });
