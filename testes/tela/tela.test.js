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
  if (opcoes.rotas) await opcoes.rotas(ctx);
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

teste('trocar de categoria com a página rolada para baixo leva ao primeiro produto, não ao fim da lista', async () => {
  const c = cenarioPadrao();
  c.lojas.banca.produtos = { ...c.lojas.banca.produtos };     // cópia: a lista do cenário é usada pelos outros testes
  for (let i = 1; i <= 30; i++) c.lojas.banca.produtos[`fruta${i}`] = { nome: `Fruta ${i}`, preco: 5 + i, unidade: 'kg', cat: 'frutas', ativo: true };
  const { pagina, erros, fechar } = await abrir('/', c);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));   // lá embaixo da vitrine
  await pagina.waitForTimeout(200);
  const posicao = () => pagina.evaluate(() => {
    const barra = document.querySelector('.controles').getBoundingClientRect().bottom;
    const primeiro = [...document.querySelectorAll('#lista-produtos .produto-card')].find((x) => x.offsetParent !== null);
    const r = primeiro.getBoundingClientRect();
    return { nome: primeiro.querySelector('.produto-nome').textContent.trim(), topo: Math.round(r.top), barra: Math.round(barra), altura: innerHeight };
  });
  for (const [cat, nome] of [['verduras', 'Alface crespa'], ['legumes', 'Tomate italiano'], ['verduras', 'Alface crespa']]) {
    await pagina.locator(`#categorias .cat-btn[data-cat="${cat}"]`).click();
    await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((x) => x.offsetParent !== null).length === 1);
    await pagina.waitForTimeout(150);
    const p = await posicao();
    assert.strictEqual(p.nome, nome);
    assert.ok(p.topo >= p.barra - 2 && p.topo < p.altura - 100, `${cat}: o produto tinha de aparecer logo abaixo das categorias (topo ${p.topo}, barra ${p.barra}, tela ${p.altura})`);
    await pagina.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  }
  // quem está no começo da página não é puxado para baixo
  await pagina.locator('#categorias .cat-btn[data-cat="todas"]').click();
  await pagina.evaluate(() => window.scrollTo(0, 0)); await pagina.waitForTimeout(100);
  await pagina.locator('#categorias .cat-btn[data-cat="frutas"]').click(); await pagina.waitForTimeout(150);
  assert.strictEqual(await pagina.evaluate(() => window.scrollY), 0, 'no topo, a página continua no topo');
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

teste('PIX no pedido: cartão grande "Falta pagar" acima do WhatsApp, copia o código, mostra o QR e não abre o WhatsApp sozinho', async () => {
  const c = cenarioPadrao();
  c.lojas.banca.config = { ...c.lojas.banca.config, pix: { tipo: 'celular', chave: '62991266509', nome: 'Rosiva Martins da Silva' } };
  const { pagina, erros, fechar } = await abrir('/', c, { antes: () => { window.__abertos = []; window.open = (u) => { window.__abertos.push(String(u)); return null; }; } });
  await pagina.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await abrirCheckoutComOvos(pagina);
  const lista = pagina.locator('#checkout-endereco select:visible'); if (await lista.count()) await lista.first().selectOption({ index: 1 });
  const campos = pagina.locator('#checkout-endereco input:visible');
  for (let i = 0; i < await campos.count(); i++) await campos.nth(i).fill(['Jardins Florença', '12', '7'][i] || '1');
  await pagina.fill('#cli-nome', 'Cliente PIX');
  await pagina.click('#pag-chips .pag-chip[data-pag="PIX"]');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForSelector('#sucesso-pix .pix-destaque', { timeout: 6000 });
  if (process.env.PRINT_PIX) { await pagina.waitForTimeout(700); await pagina.screenshot({ path: process.env.PRINT_PIX }); }
  // o cartão fica ANTES do botão do WhatsApp, e o botão vira o passo final
  assert.ok(await pagina.evaluate(() => { const p = document.getElementById('sucesso-pix'), w = document.getElementById('sucesso-whatsapps'); return !!(p.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'PIX acima do WhatsApp');
  assert.match(await pagina.locator('.pix-d-total').innerText(), /R\$\s*14,00/);
  assert.match(await pagina.locator('.pix-d-status').innerText(), /falta pagar/i);
  assert.match(await pagina.locator('#sucesso-whatsapps .btn-wpp').innerText(), /comprovante/i);
  assert.deepStrictEqual(await pagina.evaluate(() => window.__abertos), [], 'com PIX para pagar, o WhatsApp espera o toque');
  // copiar
  await pagina.click('.pix-destaque [data-action="copiar-pix"]');
  await pagina.waitForFunction(() => /copiado/i.test(document.querySelector('.pix-destaque [data-action="copiar-pix"]').textContent), null, { timeout: 3000 });
  // QR só quando abre
  assert.strictEqual(await pagina.locator('.pix-d-qr-caixa svg').count(), 0);
  await pagina.click('.pix-d-qr summary');
  await pagina.waitForSelector('.pix-d-qr-caixa svg', { timeout: 3000 });
  const largura = await pagina.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(largura <= 392, `a tela ficou mais larga que o celular (${largura}px)`);
  semErros(erros); await fechar();
});

teste('formas de pagamento: o cartão desligado some da tela e a nota só fala das outras', async () => {
  const c = cenarioPadrao();
  c.lojas.banca.config = { ...c.lojas.banca.config, pagamentoNaEntrega: true, formasPagamento: { pix: true, cartao: false, dinheiro: true } };
  const { pagina, erros, fechar } = await abrir('/', c);
  await abrirCheckoutComOvos(pagina);
  const chips = await pagina.locator('#pag-chips .pag-chip').evaluateAll((l) => l.map((b) => b.dataset.pag));
  assert.deepStrictEqual(chips, ['PIX', 'Dinheiro']);
  assert.doesNotMatch(await pagina.locator('#pag-nota').innerText(), /cart/i);
  semErros(erros); await fechar();
});

teste('pagamento só na entrega: sem PIX na tela, "Pedido enviado!", forma escolhida e WhatsApp abre sozinho', async () => {
  const c = cenarioPadrao();
  c.lojas.banca.config = { ...c.lojas.banca.config, pagamentoNaEntrega: true, pixAutomatico: true, pix: { tipo: 'celular', chave: '62991266509', nome: 'Rosiva Martins da Silva' } };
  const { pagina, erros, fechar } = await abrir('/', c, { antes: () => { window.__abertos = []; window.open = (u) => { window.__abertos.push(String(u)); return null; }; } });
  await abrirCheckoutComOvos(pagina);
  assert.match(await pagina.locator('#pag-chips').innerText(), /maquininha na entrega/i);
  assert.match(await pagina.locator('#pag-nota').innerText(), /quando receber o pedido/i);
  const lista = pagina.locator('#checkout-endereco select:visible'); if (await lista.count()) await lista.first().selectOption({ index: 1 });
  const campos = pagina.locator('#checkout-endereco input:visible');
  for (let i = 0; i < await campos.count(); i++) await campos.nth(i).fill(['Jardins Florença', '12', '7'][i] || '1');
  await pagina.fill('#cli-nome', 'Cliente Entrega');
  await pagina.click('#pag-chips .pag-chip[data-pag="PIX"]');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 6000 });
  assert.strictEqual(await pagina.locator('#modal-sucesso .title-success').innerText(), 'Pedido enviado!');
  assert.strictEqual(await pagina.locator('#sucesso-pix').isVisible(), false, 'nada de PIX na tela');
  assert.match(await pagina.locator('#sucesso-pag').innerText(), /Pagamento na entrega: PIX/);
  assert.strictEqual(await pagina.evaluate(() => window.__abertos.length), 1, 'o WhatsApp abre sozinho, como antes');
  semErros(erros); await fechar();
});

teste('pedido que passa para o dia da feira: com o mesmo valor, um toque em Enviar basta; com valor novo, pergunta uma vez e envia', async () => {
  const dow = new Date(Date.now() - 3 * 3600000).getUTCDay(), futuro = (dow + 2) % 7;
  const montar = (precoNoDia) => {
    const k = cenarioPadrao();
    k.feiras = { ...k.feiras, florenca: { ...k.feiras.florenca, dias: [futuro], condominios: ['Jardins Florença'] } };
    if (precoNoDia) { const pr = { ...k.lojas.banca.produtos }; pr.ovos = { ...pr.ovos, precosDia: { [futuro]: precoNoDia } }; k.lojas.banca.produtos = pr; }
    return k;
  };
  const preencherEEnviar = async (pagina) => {
    const lista = pagina.locator('#checkout-endereco select:visible'); if (await lista.count()) await lista.first().selectOption({ index: 1 });
    const campos = pagina.locator('#checkout-endereco input:visible');
    for (let i = 0; i < await campos.count(); i++) await campos.nth(i).fill(['Jardins Florença', '12', '7'][i] || '1');
    await pagina.fill('#cli-nome', 'Cliente Dia');
    await pagina.click('#btn-enviar-pedido');
  };
  // 1) mesmo valor: um toque
  let { pagina, erros, fechar } = await abrir('/', montar(0));
  let antes = pedidosEnviados().length;
  await abrirCheckoutComOvos(pagina); await preencherEEnviar(pagina);
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 6000 });
  assert.strictEqual(pedidosEnviados().length, antes + 1, 'enviou no primeiro toque');
  semErros(erros); await fechar();
  // 2) o preço do dia da feira é outro: pergunta com o total novo e "Enviar assim" já envia
  ({ pagina, erros, fechar } = await abrir('/', montar(99)));
  antes = pedidosEnviados().length;
  await abrirCheckoutComOvos(pagina); await preencherEEnviar(pagina);
  const pergunta = await pagina.waitForSelector('#overlay-confirm', { state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
  assert.ok(pergunta, 'com o preço do dia diferente, a loja pergunta antes de enviar');
  assert.match(await pagina.locator('#confirm-msg').innerText(), /99,00/);
  await pagina.click('#btn-confirm-ok');
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 6000 });
  assert.strictEqual(pedidosEnviados().length, antes + 1, 'um pedido só, sem precisar achar o botão de novo');
  semErros(erros); await fechar();
});

const abrirCheckoutComOvos = async (pagina) => {
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await cards(pagina).filter({ hasText: 'Ovos' }).locator('[data-action="add"]').first().click();
  await pagina.waitForFunction(() => Number((document.getElementById('qtd-flutuante') || {}).textContent || 0) >= 1, null, { timeout: 4000 });
  await pagina.click('#btn-carrinho-mobile');
  await pagina.click('#btn-abrir-checkout');
  await pagina.waitForSelector('#modal-checkout.active, #modal-checkout.aberto, #modal-checkout[aria-hidden="false"]', { timeout: 4000 });
};
const opcoesDe = (pagina, sel) => pagina.$$eval(`${sel} option`, (os) => os.map((o) => o.textContent.trim()));

// ---------------------------------------------------------------- PLANO B: servidor fora do ar
const preencherPedido = async (pagina, nome) => {
  const lista = pagina.locator('#checkout-endereco select:visible'); if (await lista.count()) await lista.first().selectOption({ index: 1 });
  const campos = pagina.locator('#checkout-endereco input:visible');
  for (let i = 0; i < await campos.count(); i++) await campos.nth(i).fill(['Jardins Florença', '12', '7'][i] || '1');
  await pagina.fill('#cli-nome', nome);
};
teste('plano B: servidor fora do ar (503) tenta de novo com a MESMA chave e, sem resposta, manda o pedido pronto no WhatsApp da banca', async () => {
  const { pagina, erros, ctx, fechar } = await abrir('/');
  const tentativas = [];
  await ctx.route('**/api/checkout', (r) => { const c = JSON.parse(r.request().postData() || '{}'); if (c.acao) return r.continue(); tentativas.push(c.idempotencyKey); return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fora do ar"}' }); });
  await abrirCheckoutComOvos(pagina); await preencherPedido(pagina, 'Cliente Plano B');
  await pagina.click('#btn-enviar-pedido');
  await pagina.locator('#modal-reserva.aberto').waitFor({ timeout: 8000 });
  assert.strictEqual(tentativas.length, 2, 'uma tentativa a mais, só uma');
  assert.ok(tentativas[0] && tentativas[0] === tentativas[1], 'a mesma chave nas duas (o servidor nunca cria dois)');
  const href = await pagina.getAttribute('#reserva-zap', 'href');
  assert.ok(href.startsWith('https://wa.me/5562999990000?text='), href);
  const texto = decodeURIComponent(href.split('?text=')[1]);
  assert.match(texto, /Ovos/); assert.match(texto, /Cliente Plano B/); assert.match(texto, /Jardins Florença/); assert.match(texto, /não conseguiu registrar/);
  assert.match(texto, new RegExp('Código: ' + tentativas[0].slice(-6).toUpperCase()));
  assert.ok(await pagina.locator('#reserva-depois').isHidden(), '"Pronto, mandei" só depois de abrir o WhatsApp');
  // "Tentar de novo pelo site" fecha e mantém a sacola
  await pagina.click('#modal-reserva .reserva-site');
  assert.ok(await pagina.locator('#modal-reserva').evaluate((el) => !el.classList.contains('aberto')));
  assert.ok(Number(await pagina.locator('#qtd-flutuante').textContent()) >= 1, 'a sacola continua');
  // de novo: abre o WhatsApp (sem sair da página no teste) e confirma
  await pagina.click('#btn-enviar-pedido'); await pagina.locator('#modal-reserva.aberto').waitFor({ timeout: 8000 });
  await pagina.evaluate(() => { const a = document.getElementById('reserva-zap'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); });
  await pagina.locator('#reserva-depois').waitFor({ state: 'visible', timeout: 2000 });
  await pagina.click('[data-action="reserva-pronto"]');
  await pagina.waitForFunction(() => !document.getElementById('modal-reserva').classList.contains('aberto') && Number((document.getElementById('qtd-flutuante') || {}).textContent || 0) === 0, null, { timeout: 3000 });
  semErros(erros); await fechar();
});

teste('plano B: erro que o cliente resolve (400) NÃO vai para o WhatsApp; servidor que volta na segunda tentativa registra normal', async () => {
  let { pagina, erros, ctx, fechar } = await abrir('/');
  await ctx.route('**/api/checkout', (r) => { const c = JSON.parse(r.request().postData() || '{}'); if (c.acao) return r.continue(); return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Este cupom já venceu.' }) }); });
  await abrirCheckoutComOvos(pagina); await preencherPedido(pagina, 'Cliente Cupom');
  await pagina.click('#btn-enviar-pedido'); await pagina.waitForTimeout(800);
  assert.ok(await pagina.locator('#modal-reserva').evaluate((el) => !el.classList.contains('aberto')), 'sem plano B');
  assert.match(await pagina.locator('body').innerText(), /cupom já venceu/);
  semErros(erros); await fechar();
  ({ pagina, erros, ctx, fechar } = await abrir('/'));
  let n = 0;
  await ctx.route('**/api/checkout', (r) => { const c = JSON.parse(r.request().postData() || '{}'); if (c.acao) return r.continue(); n++; return n === 1 ? r.fulfill({ status: 502, contentType: 'application/json', body: '{}' }) : r.continue(); });
  await abrirCheckoutComOvos(pagina); await preencherPedido(pagina, 'Cliente Volta');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 8000 });
  assert.strictEqual(n, 2); assert.ok(await pagina.locator('#modal-reserva').evaluate((el) => !el.classList.contains('aberto')));
  semErros(erros); await fechar();
});

teste('retirada na banca: sem a loja ligar, a escolha nem aparece; ligada, esconde o endereço, troca os horários e envia sem endereço', async () => {
  // loja que NÃO ligou a retirada: tudo como sempre foi
  let { pagina, erros, fechar } = await abrir('/');
  await abrirCheckoutComOvos(pagina);
  assert.strictEqual(await pagina.locator('#grupo-modo').isVisible(), false, 'sem retirada ligada, o cliente só vê entrega');
  assert.strictEqual(await pagina.locator('#checkout-endereco').isVisible(), true);
  semErros(erros); await fechar();

  // loja com retirada ligada, horários de entrega e de retirada diferentes
  const c = cenarioPadrao();
  c.lojas.banca.config = { ...c.lojas.banca.config, entrega: { taxa: 5, horarios: ['Manhã', 'Tarde'], retirada: { ativa: true, horarios: ['Das 7h às 11h'], local: 'Na banca, ao lado da portaria' } } };
  ({ pagina, erros, fechar } = await abrir('/', c));
  await abrirCheckoutComOvos(pagina);
  assert.strictEqual(await pagina.locator('#grupo-modo').isVisible(), true, 'a escolha aparece');
  assert.strictEqual(await pagina.locator('input[name="cli-modo"][value="entrega"]').isChecked(), true, 'começa na entrega');
  assert.strictEqual(await pagina.locator('#checkout-endereco').isVisible(), true);
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Manhã', 'Tarde']);
  // trocou para retirada: some o endereço, mudam os textos e os horários, aparece o local
  await pagina.locator('input[name="cli-modo"][value="retirada"]').check();
  assert.strictEqual(await pagina.locator('#checkout-endereco').isVisible(), false, 'quem busca não diz onde mora');
  assert.strictEqual((await pagina.locator('#checkout-sub-titulo').textContent()).trim(), 'Seus dados');   // (a tela escreve em maiúsculas, o texto é este)
  assert.strictEqual((await pagina.locator('#cli-horario-rotulo').innerText()).trim(), 'Quando vai retirar? (opcional)');
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Das 7h às 11h']);
  assert.ok((await pagina.locator('#retirada-local').innerText()).includes('Na banca, ao lado da portaria'));
  // voltou para entrega: o endereço volta e, sem ele, o site NÃO envia
  await pagina.locator('input[name="cli-modo"][value="entrega"]').check();
  assert.strictEqual(await pagina.locator('#checkout-endereco').isVisible(), true); assert.strictEqual(await pagina.locator('#retirada-local').isVisible(), false);
  await pagina.fill('#cli-nome', 'Cliente Retirada');
  const antes = pedidosEnviados().length;
  await pagina.click('#btn-enviar-pedido'); await pagina.waitForTimeout(300);
  assert.strictEqual(pedidosEnviados().length, antes, 'entrega sem endereço continua barrada');
  // retirada de novo, com horário: envia sem nenhum endereço
  await pagina.locator('input[name="cli-modo"][value="retirada"]').check();
  await pagina.selectOption('#cli-horario', 'Das 7h às 11h');
  await pagina.fill('#cli-telefone', '62999998888');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 6000 });
  const corpo = pedidosEnviados().pop().corpo;
  assert.strictEqual(corpo.modo, 'retirada'); assert.strictEqual(corpo.horarioEntrega, 'Das 7h às 11h'); assert.strictEqual(corpo.feira, '');
  assert.deepStrictEqual([corpo.condominio, corpo.quadra, corpo.lote], ['', '', ''], 'nenhum endereço vai junto');
  assert.ok((await pagina.locator('#sucesso-entrega').innerText()).includes('Retirada na banca: Das 7h às 11h'));
  assert.strictEqual(await pagina.evaluate(() => localStorage.getItem('banca_endereco')), null, 'a retirada não grava endereço vazio no aparelho');
  semErros(erros); await fechar();
});

teste('loja: foto que sumiu do ImgBB nunca aparece como a figura azul: usa a outra versão, e sem nenhuma o card fica sem foto', async () => {
  const cen = cenarioPadrao();
  cen.lojas.banca.produtos = { ...cen.lojas.banca.produtos,
    hk: { nome: 'Heineken lata', preco: 8, unidade: 'un', cat: 'frutas', ativo: true, foto: 'https://i.ibb.co/q/hk.webp', fotoMini: 'https://i.ibb.co/q/hk-m.webp' },
    al: { nome: 'Alho sal e cheiro verde', preco: 10, unidade: 'un', cat: 'frutas', ativo: true, foto: 'https://i.ibb.co/q/al.webp', fotoMini: 'https://i.ibb.co/q/al-m.webp' },
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  const perdidas = ['q/hk.webp', 'q/al.webp', 'q/al-m.webp'], diretos = [];
  const rotas = async (ctx) => {
    await ctx.route('https://i.ibb.co/**', (r) => { diretos.push(r.request().url()); return r.fulfill({ status: 503, contentType: 'image/png', body: png }); });
    await ctx.route('**/_vercel/image**', (r) => { const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('url') || ''); return perdidas.some((x) => u.endsWith(x)) ? r.fulfill({ status: 502, body: 'fora' }) : r.fulfill({ status: 200, contentType: 'image/png', body: png }); });
  };
  const { pagina, erros, fechar } = await abrir('/', cen, { rotas, antes: () => { window.__REDUTOR_LOCAL = true; } });
  const hk = cards(pagina).filter({ hasText: 'Heineken' }).first(), al = cards(pagina).filter({ hasText: 'Alho sal' }).first();
  await hk.scrollIntoViewIfNeeded(); await al.scrollIntoViewIfNeeded();
  await pagina.waitForFunction(() => { const i = [...document.querySelectorAll('#lista-produtos .produto-card')].find((c) => /Heineken/.test(c.textContent)).querySelector('img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  assert.match(await hk.locator('img').getAttribute('src'), /hk-m\.webp/, 'a Heineken mostra a miniatura boa');
  await pagina.waitForFunction(() => [...document.querySelectorAll('#lista-produtos .produto-card')].find((c) => /Alho sal/.test(c.textContent)).querySelector('img').style.visibility === 'hidden', null, { timeout: 8000 });
  assert.deepStrictEqual(diretos, [], 'nenhuma foto do ImgBB foi aberta direto (era assim que a figura azul aparecia)');
  semErros(erros); await fechar();
});

teste('painel: foto que sumiu do ImgBB aparece como "Foto fora do ar" (nunca a figura azul), e "Consertar" reenvia a partir da versão boa', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  cen.lojas.banca.produtos = { ...cen.lojas.banca.produtos,
    hk: { nome: 'Heineken lata', preco: 8, unidade: 'un', cat: 'frutas', ativo: true, foto: 'https://i.ibb.co/q/hk.webp', fotoMini: 'https://i.ibb.co/q/hk-m.webp' },
    al: { nome: 'Alho sal e cheiro verde', preco: 10, unidade: 'un', cat: 'frutas', ativo: true, foto: 'https://i.ibb.co/q/al.webp', fotoMini: 'https://i.ibb.co/q/al-m.webp' },
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  const perdidas = ['q/hk.webp', 'q/al.webp', 'q/al-m.webp'];
  const rotas = async (ctx) => {
    await ctx.route('https://i.ibb.co/**', (r) => (perdidas.some((x) => r.request().url().endsWith(x)) ? r.fulfill({ status: 503, contentType: 'image/png', body: png }) : r.fulfill({ status: 200, contentType: 'image/png', body: png })));
    await ctx.route('**/_vercel/image**', (r) => { const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('url') || ''); return perdidas.some((x) => u.endsWith(x)) ? r.fulfill({ status: 502, body: 'fora' }) : r.fulfill({ status: 200, contentType: 'image/png', body: png }); });
    await ctx.route('**/api/foto', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://i.ibb.co/novo/' + Date.now() + '.webp' }) }));
  };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { rotas, antes: () => { window.__REDUTOR_LOCAL = true; }, contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('.tab[data-aba="produtos"]').click();
  // na lista: o Alho (as duas versões perdidas) vira "Foto fora do ar" e aparece a faixa para consertar
  await pagina.waitForSelector('#lista-produtos .pl-fora-do-ar', { timeout: 8000 });
  await pagina.waitForSelector('#pl-faixa-fotos [data-action="consertar-fotos"]', { timeout: 4000 });
  await pagina.click('#pl-faixa-fotos [data-action="consertar-fotos"]');
  await pagina.waitForSelector('#modal-conserto-fotos.aberto #cf-lista .ft-linha', { timeout: 8000 });
  const nomes = await pagina.locator('#cf-lista .ft-nome').allInnerTexts();
  assert.deepStrictEqual(nomes.sort(), ['Alho sal e cheiro verde', 'Heineken lata'], 'acha as duas: a Heineken (só a grande sumiu) e o Alho (sumiram as duas)');
  const hk = pagina.locator('#cf-lista .ft-linha', { hasText: 'Heineken' }), al = pagina.locator('#cf-lista .ft-linha', { hasText: 'Alho' });
  assert.strictEqual(await al.locator('[data-cf="usar"]').count(), 0, 'sem cópia: só "Escolher outra"');
  await hk.locator('[data-cf="usar"]').click();
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /produtos\/hk$/.test(g.path) && /i\.ibb\.co\/novo\//.test(g.dados.foto || '') && /i\.ibb\.co\/novo\//.test(g.dados.fotoMini || '')), null, { timeout: 8000 });
  await hk.locator('text=Consertada').waitFor({ timeout: 4000 });
  // Alho: escolhe a foto de novo do computador
  const [esc] = await Promise.all([pagina.waitForEvent('filechooser', { timeout: 4000 }), al.locator('[data-cf="outra"]').click()]);
  await esc.setFiles({ name: 'alho.png', mimeType: 'image/png', buffer: png });
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /produtos\/al$/.test(g.path) && /novo/.test(g.dados.foto || '')), null, { timeout: 8000 });
  semErros(erros); await fechar();
});

teste('painel: Configurações guarda a retirada na banca (ligada, horários e local) dentro de "entrega" e mostra de volta', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  cen.lojas.banca.config = { ...cen.lojas.banca.config, entrega: { taxa: 5, horarios: ['Manhã'], retirada: { ativa: false, horarios: ['Das 7h às 11h'], local: 'Na banca' } } };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('.tab[data-aba="config"]').click();
  await pagina.evaluate(() => document.querySelectorAll('#aba-config details').forEach((d) => { d.open = true; }));
  await pagina.waitForSelector('#config-retirada-ativa', { state: 'visible', timeout: 8000 });
  // o que a loja já tinha aparece de volta
  assert.strictEqual(await pagina.locator('#config-retirada-ativa').isChecked(), false);
  assert.strictEqual(await pagina.inputValue('#config-retirada-horarios'), 'Das 7h às 11h'); assert.strictEqual(await pagina.inputValue('#config-retirada-local'), 'Na banca');
  await pagina.check('#config-retirada-ativa');
  await pagina.fill('#config-retirada-horarios', 'Das 7h às 11h\nDas 15h às 18h');
  await pagina.fill('#config-retirada-local', 'Na banca, no portão 2');
  await pagina.click('#btn-salvar-config');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config' && g.dados && g.dados.entrega), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.find((x) => x.path === 'loja/config' && x.dados.entrega).dados);
  assert.deepStrictEqual(g.entrega, { taxa: 5, gratisAcima: 0, horarios: ['Manhã'], agenda: [], retirada: { ativa: true, dias: [], horarios: ['Das 7h às 11h', 'Das 15h às 18h'], local: 'Na banca, no portão 2' } });
  semErros(erros); await fechar();
});

teste('loja com cards escuros em página clara: nome e preço do produto continuam legíveis sobre o card', async () => {
  const cen = cenarioPadrao();
  cen.lojas.banca.ficha.tema = { primaria: '#1a1a1a', secundaria: '#f0b94a', destaque: '#f0b94a', fundo: '#fff6e4', superficie: '#1c1f22', texto: '#1a1a18', sobrePrimaria: '#ffffff', botao: '#fbe27a', etiqueta: 'selo' };
  const { pagina, erros, fechar } = await abrir('/', cen);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  const r = await pagina.evaluate(() => {
    const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const card = document.querySelector('#lista-produtos .produto-card'), cs = (el) => getComputedStyle(el);
    return { nome: cr(cs(card.querySelector('.produto-nome')).color, cs(card).backgroundColor), preco: cr(cs(card.querySelector('.etq-preco')).color, cs(card.querySelector('.etiqueta, .etq-preco').closest('.etiqueta') || card).backgroundColor) };
  });
  assert.ok(r.nome >= 4.5, `o nome do produto ficou ilegível sobre o card (contraste ${r.nome.toFixed(1)})`);
  assert.ok(r.preco >= 4.5, `o preço ficou ilegível (contraste ${r.preco.toFixed(1)})`);
  semErros(erros); await fechar();
});

teste('loja com card escuro e SEM cor de texto escolhida (vale a padrão, escura): o nome do produto continua legível', async () => {
  const cen = cenarioPadrao();
  cen.lojas.banca.ficha.tema = { primaria: '#1a1a1a', destaque: '#f0b94a', fundo: '#fff6e4', superficie: '#1c1f22', botao: '#fbe27a', etiqueta: 'selo' };
  const { pagina, erros, fechar } = await abrir('/', cen);
  await cards(pagina).first().waitFor({ timeout: 8000 }); await pagina.waitForTimeout(500);
  const c = await pagina.evaluate(() => {
    const lum = (rgb) => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const card = document.querySelector('#lista-produtos .produto-card'), a = lum(getComputedStyle(card.querySelector('.produto-nome')).color), b = lum(getComputedStyle(card).backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  assert.ok(c >= 4.5, `nome ilegível sobre o card (contraste ${c.toFixed(1)})`);
  semErros(erros); await fechar();
});

teste('rede de segurança: mesmo que o card escureça por fora do tema, a tela mede e deixa o nome legível', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 }); await pagina.waitForTimeout(500);
  // simula uma cor que brigou (ex.: um estilo novo): card escuro, texto escuro
  const mudou = await pagina.evaluate(async () => {
    document.documentElement.style.setProperty('--warm-white', '#1c1f22'); document.documentElement.style.setProperty('--superficie', '#1c1f22');
    const m = await import('/js/melhorias-ui.js'); return m.conferirContrasteDosCards();
  });
  assert.strictEqual(mudou, true, 'a conferência percebeu o card ilegível');
  const cor = await pagina.evaluate(() => getComputedStyle(document.querySelector('#lista-produtos .produto-card .produto-nome')).color);
  assert.strictEqual(cor, 'rgb(245, 245, 242)', 'nome fica claro sobre o card escuro');
  semErros(erros); await fechar();
});

teste('painel: aba Clientes mostra a lista guardada na hora e só depois traz o recálculo (não espera a conferência de pedido novo)', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  const t0 = Date.now();
  await pagina.locator('.tab[data-aba="crm"]').click();
  await pagina.waitForSelector('.crm-item', { timeout: 1500 });
  assert.ok(Date.now() - t0 < 1800, 'a lista guardada tem de aparecer sem esperar o recálculo de 2 s');
  assert.strictEqual(await pagina.locator('.crm-item').count(), 1, 'primeiro vem o que já estava guardado');
  await pagina.waitForFunction(() => document.querySelectorAll('.crm-item').length === 2, null, { timeout: 6000 });   // depois chega o cálculo novo
  semErros(erros); await fechar();
});

teste('painel: o Gerente liga e desliga PIX/cartão/dinheiro, mas não vê nem manda a chave PIX, o PIX automático e o WhatsApp dos pedidos', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'gerente', email: 'gerente@teste.com', isAnonymous: false, claims: { tenants: { banca: 'gerente' } } } });
  cen.lojas.banca.config = { ...cen.lojas.banca.config, wpp: '5562999990000', pix: { tipo: 'celular', chave: '+5562988887777', nome: 'Dona Rosa', cidade: 'Goiania' }, formasPagamento: { pix: true, cartao: true, dinheiro: true } };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('.tab[data-aba="config"]').click();
  await pagina.evaluate(() => document.querySelectorAll('#aba-config details').forEach((d) => { d.open = true; }));
  await pagina.waitForSelector('#config-forma-cartao', { state: 'visible', timeout: 8000 });
  // a chave PIX, o PIX automático e o WhatsApp dos pedidos nem aparecem; as formas de pagamento sim
  for (const id of ['#config-pix-chave', '#config-pix-nome', '#config-pix', '#config-wpp']) assert.strictEqual(await pagina.locator(id).isVisible(), false, `${id} escondido do gerente`);
  for (const id of ['#config-forma-pix', '#config-forma-cartao', '#config-forma-dinheiro', '#config-pag-entrega']) assert.strictEqual(await pagina.locator(id).isVisible(), true, `${id} visível para o gerente`);
  assert.ok(!(await pagina.locator('.tab[data-aba="equipe"]').isVisible()), 'gerente não vê a equipe');
  // hoje não aceita cartão: desmarca e salva
  await pagina.uncheck('#config-forma-cartao');
  await pagina.click('#btn-salvar-config');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config' && g.dados && g.dados.formasPagamento), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.find((x) => x.path === 'loja/config' && x.dados.formasPagamento).dados);
  assert.deepStrictEqual(g.formasPagamento, { pix: true, cartao: false, dinheiro: true });
  for (const k of ['pix', 'pixAutomatico', 'wpp']) assert.ok(!(k in g), `o gerente não manda "${k}" (o banco também recusaria)`);
  semErros(erros); await fechar();
});

teste('painel: Configurações guarda o Instagram (link vira só o nome) e o WhatsApp para o cliente; Instagram errado não grava', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('.tab[data-aba="config"]').click();
  await pagina.evaluate(() => document.querySelectorAll('#aba-config details').forEach((d) => { d.open = true; }));
  await pagina.waitForSelector('#config-instagram', { state: 'visible', timeout: 8000 });
  await pagina.fill('#config-instagram', 'facebook.com/banca');
  await pagina.click('#btn-salvar-config');
  await pagina.waitForTimeout(400);
  assert.ok(!(await pagina.evaluate(() => (window.__gravados || []).some((g) => g.path === 'loja/config' && g.dados && g.dados.contato))), 'Instagram errado: não grava');
  await pagina.fill('#config-instagram', 'https://www.instagram.com/BancaAdair/');
  await pagina.fill('#config-wpp-contato', '62 98888-7777');
  await pagina.check('#config-mostrar-wpp');
  await pagina.click('#btn-salvar-config');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config' && g.dados && g.dados.contato), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.find((x) => x.path === 'loja/config' && x.dados.contato).dados);
  assert.deepStrictEqual(g.contato, { instagram: 'bancaadair', whatsapp: '5562988887777', mostrarWpp: true });
  semErros(erros); await fechar();
});
teste('retirada por dia e horários de entrega por dia: no dia sem retirada a escolha some; a regra do dia troca a lista de horários', async () => {
  const hoje = new Date(Date.now() - 3 * 3600000).getUTCDay(), outros = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== hoje);
  // hoje NÃO é dia de retirada: o cliente só vê a entrega
  let c = cenarioPadrao();
  c.lojas.banca.config = { ...c.lojas.banca.config, entrega: { horarios: ['Geral'], retirada: { ativa: true, dias: outros, horarios: ['Das 7h às 11h'] } } };
  let { pagina, erros, fechar } = await abrir('/', c);
  await abrirCheckoutComOvos(pagina);
  assert.strictEqual(await pagina.locator('#grupo-modo').isVisible(), false, 'hoje não tem retirada');
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Geral']);
  semErros(erros); await fechar();
  // CLIENTE DA FEIRA (entrou pelo link da feira do Florença, que hoje acontece): hoje a agenda da banca diz "só retirada na feira"
  const cenFeira = (linha) => { const k = cenarioPadrao(); k.feiras = { ...k.feiras, florenca: { ...k.feiras.florenca, dias: [hoje] } }; k.lojas.banca.config = { ...k.lojas.banca.config, entrega: { horarios: ['Geral'], agenda: [{ feira: 'florenca', dia: hoje, ...linha }] } }; return k; };
  ({ pagina, erros, fechar } = await abrir('/feira/florenca', cenFeira({ entrega: false, retirada: true, horariosRetirada: ['Das 7h às 11h'], local: 'Na feira do Florença, banca verde' })));
  await pagina.waitForSelector('#selo-feira', { timeout: 8000 });
  await abrirCheckoutComOvos(pagina);
  assert.strictEqual(await pagina.locator('#grupo-modo').isVisible(), true);
  assert.strictEqual(await pagina.locator('#rot-modo-entrega').isVisible(), false, 'dia só de retirada: a entrega some');
  assert.strictEqual((await pagina.locator('#rot-modo-retirada').textContent()).trim(), 'Retirar na feira');
  assert.strictEqual(await pagina.locator('input[name="cli-modo"][value="retirada"]').isChecked(), true);
  assert.strictEqual(await pagina.locator('#checkout-endereco').isVisible(), false, 'sem endereço');
  assert.ok((await pagina.locator('#retirada-local').innerText()).includes('Na feira do Florença, banca verde'));
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Das 7h às 11h']);
  await pagina.selectOption('#cli-horario', 'Das 7h às 11h');
  await pagina.fill('#cli-nome', 'Cliente da Feira');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 6000 });
  const corpo = pedidosEnviados().pop().corpo;
  assert.strictEqual(corpo.modo, 'retirada'); assert.strictEqual(corpo.feira, 'florenca', 'a feira vai junto para o servidor conferir a agenda'); assert.strictEqual(corpo.horarioEntrega, 'Das 7h às 11h');
  assert.ok((await pagina.locator('#sucesso-entrega').innerText()).includes('Retirada na feira: Das 7h às 11h'));
  semErros(erros); await fechar();
  // a mesma feira num dia "só entrega, de manhã": nada para escolher e só o horário da manhã
  ({ pagina, erros, fechar } = await abrir('/feira/florenca', cenFeira({ entrega: true, horariosEntrega: ['Manhã (8h às 11h)'], retirada: false })));
  await pagina.waitForSelector('#selo-feira', { timeout: 8000 });
  await abrirCheckoutComOvos(pagina);
  assert.strictEqual(await pagina.locator('#grupo-modo').isVisible(), false, 'só entrega');
  assert.strictEqual(await pagina.locator('#checkout-endereco').isVisible(), true);
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Manhã (8h às 11h)'], 'o horário do dia da feira, não a lista geral');
  semErros(erros); await fechar();
  // entrega e retirada no mesmo dia: o cliente escolhe
  ({ pagina, erros, fechar } = await abrir('/feira/florenca', cenFeira({ entrega: true, horariosEntrega: ['Tarde'], retirada: true, horariosRetirada: ['Das 16h às 20h'], local: 'Feira' })));
  await pagina.waitForSelector('#selo-feira', { timeout: 8000 });
  await abrirCheckoutComOvos(pagina);
  assert.strictEqual(await pagina.locator('#rot-modo-entrega').isVisible(), true); assert.strictEqual(await pagina.locator('input[name="cli-modo"][value="entrega"]').isChecked(), true);
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Tarde']);
  await pagina.locator('input[name="cli-modo"][value="retirada"]').check();
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Das 16h às 20h']);
  semErros(erros); await fechar();
});

teste('painel: agenda das feiras (entrega e retirada por dia de cada feira) e dias da retirada geral são gravados e conferidos', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  cen.feiras = { ...(cen.feiras || {}), atenas: { nome: 'Atenas', dias: [3], lojas: [{ id: 'banca' }] }, madri: { nome: 'Madri', dias: [3, 5], lojas: [{ id: 'banca' }] } };
  cen.lojas.banca.ficha = { ...cen.lojas.banca.ficha, feiras: ['atenas', 'madri'] };
  cen.lojas.banca.config = { ...cen.lojas.banca.config, entrega: { horarios: ['Geral'], retirada: { ativa: true, horarios: ['Das 7h às 11h'] } } };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('.tab[data-aba="config"]').click();
  await pagina.evaluate(() => document.querySelectorAll('#aba-config details').forEach((d) => { d.open = true; }));
  await pagina.waitForSelector('#btn-add-agenda', { state: 'visible', timeout: 8000 });
  // retirada geral: sem dias gravados = todos marcados; tira a quarta
  assert.strictEqual(await pagina.locator('.chk-ret-dia:checked').count(), 7);
  await pagina.locator('#retirada-dias .dia-label', { hasText: 'Qua' }).click();
  const linha = (i) => pagina.locator('#agenda-entrega .agenda-linha').nth(i);
  // Madri na quarta: só entrega, de manhã
  await pagina.click('#btn-add-agenda');
  await pagina.waitForSelector('#agenda-entrega .agenda-linha');
  assert.deepStrictEqual(await linha(0).locator('[data-r="feira"] option').allTextContents(), ['Escolha a feira', 'Atenas', 'Madri']);
  await linha(0).locator('[data-r="feira"]').selectOption('madri');
  assert.strictEqual(await linha(0).locator('[data-r="dia"]').inputValue(), '3', 'escolheu a feira: o dia vira o primeiro dia dela');
  assert.ok((await linha(0).locator('[data-r="dia"] option:checked').textContent()).includes('(dia da feira)'));
  await linha(0).locator('[data-r="horariosEntrega"]').fill('Manhã (8h às 11h)');
  // Madri na sexta: entrega e retirada na feira
  await pagina.click('#btn-add-agenda');
  await linha(1).locator('[data-r="feira"]').selectOption('madri');
  await linha(1).locator('[data-r="dia"]').selectOption('5');
  await linha(1).locator('[data-r="retirada"]').check();
  await linha(1).locator('[data-r="horariosRetirada"]').fill('Das 16h às 20h');
  await linha(1).locator('[data-r="local"]').fill('Na feira do Madri');
  assert.strictEqual(await linha(0).locator('[data-r="horariosEntrega"]').inputValue(), 'Manhã (8h às 11h)', 'adicionar outra linha não apaga o que foi digitado');
  await pagina.click('#btn-salvar-config');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config' && g.dados && g.dados.entrega), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.filter((x) => x.path === 'loja/config' && x.dados.entrega).pop().dados);
  assert.deepStrictEqual(g.entrega.agenda, [
    { feira: 'madri', dia: 3, entrega: true, horariosEntrega: ['Manhã (8h às 11h)'], retirada: false, horariosRetirada: [], local: '' },
    { feira: 'madri', dia: 5, entrega: true, horariosEntrega: [], retirada: true, horariosRetirada: ['Das 16h às 20h'], local: 'Na feira do Madri' },
  ]);
  assert.deepStrictEqual(g.entrega.retirada.dias, [0, 1, 2, 4, 5, 6], 'retirada geral sem a quarta');
  // o painel não grava agenda errada: feira + dia repetido, dia que não é da feira, linha sem entrega nem retirada
  const tentar = async (montar, motivo) => {
    const antes = await pagina.evaluate(() => window.__gravados.length);
    await montar(); await pagina.click('#btn-salvar-config'); await pagina.waitForTimeout(300);
    assert.strictEqual(await pagina.evaluate(() => window.__gravados.length), antes, motivo);
  };
  await pagina.click('#btn-add-agenda');
  await tentar(async () => { await linha(2).locator('[data-r="feira"]').selectOption('madri'); await linha(2).locator('[data-r="dia"]').selectOption('5'); }, 'Madri na sexta já tem linha');
  await tentar(async () => { await linha(2).locator('[data-r="feira"]').selectOption('atenas'); await linha(2).locator('[data-r="dia"]').selectOption('5'); }, 'Atenas não acontece na sexta');
  await tentar(async () => { await linha(2).locator('[data-r="dia"]').selectOption('3'); await linha(2).locator('[data-r="entrega"]').uncheck(); }, 'linha sem entrega nem retirada');
  // apagar a linha
  await linha(2).locator('[data-r="remover"]').click();
  assert.strictEqual(await pagina.locator('#agenda-entrega .agenda-linha').count(), 2);
  // retirada ligada e nenhum dia marcado: não grava
  await tentar(() => pagina.evaluate(() => document.querySelectorAll('.chk-ret-dia').forEach((c) => { c.checked = false; })), 'sem nenhum dia de retirada não grava');
  semErros(erros); await fechar();
});

teste('painel no celular: a agenda das feiras cabe na tela e a linha com dia que a feira não tem fica vermelha e explica o que fazer', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  cen.feiras = { ...(cen.feiras || {}), atenas: { nome: 'Feira Atenas', dias: [3], lojas: [{ id: 'banca' }] }, madri: { nome: 'Feira Madri', dias: [5], lojas: [{ id: 'banca' }] } };
  cen.lojas.banca.ficha = { ...cen.lojas.banca.ficha, feiras: ['atenas', 'madri'] };
  const longo = 'Banca do Adair, próximo da entrada principal da feira, ao lado do quiosque de caldo de cana';
  cen.lojas.banca.config = { ...cen.lojas.banca.config, entrega: { horarios: ['Geral'], agenda: [
    { feira: 'atenas', dia: 3, entrega: true, horariosEntrega: ['Das 18h às 22h'], retirada: true, horariosRetirada: ['Das 17h às 22h'], local: longo },
    { feira: 'madri', dia: 5, entrega: true, horariosEntrega: [], retirada: true, horariosRetirada: ['Das 17h às 22h'], local: '' },
  ] } };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen);
  await pagina.waitForSelector('.tab[data-aba="config"]', { state: 'attached', timeout: 8000 });
  await pagina.evaluate(() => document.querySelector('.tab[data-aba="config"]').click());        // no celular o menu fica recolhido: abre a aba direto
  await pagina.evaluate(() => document.querySelectorAll('#aba-config details').forEach((d) => { d.open = true; }));
  await pagina.waitForSelector('#agenda-entrega .agenda-linha', { state: 'visible', timeout: 8000 });
  const sobra = () => pagina.evaluate(() => {
    const folga = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const fora = [...document.querySelectorAll('#agenda-entrega .agenda-linha')].flatMap((cartao) => { const lim = cartao.getBoundingClientRect().right + 0.5; return [...cartao.querySelectorAll('select, textarea, input, button')].filter((e) => e.getBoundingClientRect().right > lim).map((e) => e.dataset.r); });
    return { folga, fora };
  });
  const r0 = await sobra();
  assert.deepStrictEqual(r0.fora, [], 'nenhum campo da agenda passa da borda do cartão');
  assert.ok(r0.folga <= 0, 'a página não ganha rolagem para o lado');
  // a alça da caixa de texto só estica para baixo (puxar para o lado alargava o cartão e empurrava o "Apagar" para fora da tela)
  assert.ok(await pagina.locator('#agenda-entrega textarea').evaluateAll((l) => l.every((t) => getComputedStyle(t).resize === 'vertical')), 'a caixa de texto não estica para o lado');
  // mesmo que um navegador deixe esticar (largura fixa de 700px), o cartão não cresce junto
  await pagina.locator('#agenda-entrega textarea').first().evaluate((t) => { t.style.width = '700px'; });
  const r1 = await sobra();
  assert.deepStrictEqual(r1.fora, [], 'caixa esticada: nenhum campo passa da borda do cartão');
  assert.ok(r1.folga <= 0, 'caixa esticada: a página não ganha rolagem para o lado');
  await pagina.locator('#agenda-entrega textarea').first().evaluate((t) => { t.style.width = ''; });
  // a feira Madri só acontece na sexta: trocar a linha para a quarta avisa na própria linha
  await pagina.locator('#agenda-entrega .agenda-linha').nth(1).locator('[data-r="dia"]').selectOption('3');
  assert.strictEqual(await pagina.locator('#agenda-entrega .agenda-linha').nth(1).evaluate((e) => e.classList.contains('com-erro')), true);
  const dica = await pagina.locator('#agenda-entrega .agenda-linha').nth(1).locator('[data-r="dica"]').innerText();
  assert.ok(dica.includes('Feira Madri') && dica.includes('quarta') && dica.includes('Plataforma'), dica);
  const antes = await pagina.evaluate(() => (window.__gravados || []).length);
  await pagina.click('#btn-salvar-config'); await pagina.waitForTimeout(300);
  assert.strictEqual(await pagina.evaluate(() => (window.__gravados || []).length), antes, 'não grava com dia que a feira não tem');
  assert.ok((await pagina.locator('#toast, .toast').first().innerText()).includes('Plataforma'), 'o aviso diz o que fazer');
  assert.deepStrictEqual((await sobra()).fora, []);
  // volta para a sexta: a linha fica normal e grava
  await pagina.locator('#agenda-entrega .agenda-linha').nth(1).locator('[data-r="dia"]').selectOption('5');
  assert.strictEqual(await pagina.locator('#agenda-entrega .agenda-linha').nth(1).evaluate((e) => e.classList.contains('com-erro')), false);
  await pagina.click('#btn-salvar-config');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config' && g.dados && g.dados.entrega), null, { timeout: 4000 });
  semErros(erros); await fechar();
});

teste('cliente da feira num dia futuro (hoje não tem feira): a agenda daquele dia mostra entrega e retirada', async () => {
  const dow = new Date(Date.now() - 3 * 3600000).getUTCDay(), futuro = (dow + 2) % 7;
  const k = cenarioPadrao();
  k.feiras = { ...k.feiras, florenca: { ...k.feiras.florenca, dias: [futuro] } };
  k.lojas.banca.config = { ...k.lojas.banca.config, entrega: { horarios: ['Geral'], agenda: [{ feira: 'florenca', dia: futuro, entrega: true, horariosEntrega: ['Das 18h às 22h'], retirada: true, horariosRetirada: ['Das 17h às 22h'], local: 'Banca do Adair' }] } };
  const { pagina, erros, fechar } = await abrir('/feira/florenca', k);
  await pagina.waitForSelector('#selo-feira', { timeout: 8000 });
  await abrirCheckoutComOvos(pagina);
  assert.strictEqual(await pagina.locator('#grupo-modo').isVisible(), true, 'o dia da feira é daqui a 2 dias e tem retirada: o cliente escolhe');
  assert.strictEqual(await pagina.locator('#rot-modo-entrega').isVisible(), true);
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Das 18h às 22h']);
  await pagina.locator('input[name="cli-modo"][value="retirada"]').check();
  assert.deepStrictEqual(await opcoesDe(pagina, '#cli-horario'), ['Tanto faz (a combinar)', 'Das 17h às 22h']);
  assert.ok((await pagina.locator('#retirada-local').innerText()).includes('Banca do Adair'));
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
// ---------------------------------------------------------------- VITRINE NUM DOCUMENTO SÓ (lib/catalogo.js, js/catalogo-loja.js)
teste('vitrine num documento só: a loja lê o catálogo + só os produtos mudados há pouco (não lê um por um); mudança recente do painel vale por cima', async () => {
  const c = cenarioPadrao(), agora = Date.now(), b = c.lojas.banca;
  const entrada = (id, d) => ({ id, ...d });
  // o catálogo foi montado há 1 hora; depois disso o painel mudou o preço do tomate e desligou a alface
  b.catalogo = { v: 1, geradoEm: agora - 3600e3, assinatura: 'teste', n: 4, produtos: [entrada('alface', b.produtos.alface), entrada('banana', b.produtos.banana), entrada('ovos', b.produtos.ovos), entrada('tomate', { ...b.produtos.tomate, preco: 9.9 })] };
  b.produtos = { ...b.produtos, tomate: { ...b.produtos.tomate, preco: 12.5, ultimaModificacao: agora - 60e3 }, alface: { ...b.produtos.alface, ativo: false, ultimaModificacao: agora - 30e3 },
    // está no banco mas NÃO no catálogo e não mudou há pouco: se aparecer, a loja leu os produtos um por um
    fantasma: { nome: 'Só no banco', preco: 3, unidade: 'un', cat: 'outros', ativo: true, ultimaModificacao: agora - 86400e3 } };
  const { pagina, erros, fechar } = await abrir('/', c);
  await cards(pagina).first().waitFor({ timeout: 8000 }); await pagina.waitForTimeout(300);
  const nomes = await visiveis(pagina);
  assert.ok(!nomes.includes('Só no banco'), 'não leu a coleção inteira: ' + nomes.join(', '));
  assert.ok(!nomes.includes('Alface crespa'), 'desligada há pouco pelo painel: some na hora');
  assert.ok(nomes.includes('Banana prata') && nomes.includes('Ovos caipira (dúzia)'), nomes.join(', '));
  assert.match(await cards(pagina).filter({ hasText: 'Tomate' }).first().innerText(), /12,50/, 'preço novo do painel, por cima do catálogo');
  const ouvidos = await pagina.evaluate(() => window.__ouvidos || []);
  assert.ok(ouvidos.includes('loja/catalogo'), 'leu o documento da vitrine');
  assert.ok(!ouvidos.includes('produtos'), 'NÃO ouviu a coleção inteira: ' + ouvidos.join(' | '));
  assert.ok(ouvidos.some((o) => o.startsWith('produtos?ultimaModificacao>')), 'ouviu só os mudados');
  semErros(erros); await fechar();
});

teste('vitrine num documento só: sem catálogo, catálogo grande ou de outra versão, a loja volta sozinha a ler os produtos (nunca fica vazia)', async () => {
  for (const [nome, cat] of [['sem catálogo', null], ['grande', { v: 1, grande: true, geradoEm: Date.now(), n: 5000 }], ['outra versão', { v: 99, geradoEm: Date.now(), produtos: [] }]]) {
    const c = cenarioPadrao(); if (cat) c.lojas.banca.catalogo = cat;
    const { pagina, erros, fechar } = await abrir('/', c);
    await cards(pagina).first().waitFor({ timeout: 8000 });
    assert.deepStrictEqual((await visiveis(pagina)).sort(), ['Alface crespa', 'Banana prata', 'Ovos caipira (dúzia)', 'Tomate italiano'], nome);
    assert.ok((await pagina.evaluate(() => window.__ouvidos || [])).includes('produtos'), `${nome}: leu os produtos`);
    semErros(erros); await fechar();
  }
});

teste('vitrine num documento só: categorias, aviso do dia e nota vêm junto no catálogo (a loja não lê cada um separado)', async () => {
  const c = cenarioPadrao(), b = c.lojas.banca, agora = Date.now();
  const entrada = (id, d) => ({ id, ...d });
  // o banco tem categorias com outro nome: se aparecerem, a loja leu a coleção em vez do catálogo
  b.categorias = [{ chave: 'frutas', nome: 'ERRADO', ordem: 1 }];
  b.catalogo = { v: 1, geradoEm: agora - 60e3, assinatura: 't', n: 4,
    produtos: ['alface', 'banana', 'ovos', 'tomate'].map((id) => entrada(id, b.produtos[id])),
    categorias: [{ id: 'frutas', chave: 'frutas', nome: 'Frutas do pé', ordem: 1 }, { id: 'legumes', chave: 'legumes', nome: 'Legumes', ordem: 2 }, { id: 'verduras', chave: 'verduras', nome: 'Verduras', ordem: 3 }, { id: 'outros', chave: 'outros', nome: 'Outros', ordem: 4 }],
    comunicados: { fixo: { ativo: true, texto: 'Hoje tem pamonha fresquinha' }, dias: {} },
    avaliacoes: { soma: 48, n: 10, media: 4.8 } };
  const { pagina, erros, fechar } = await abrir('/', c);
  await cards(pagina).first().waitFor({ timeout: 8000 }); await pagina.waitForTimeout(400);
  assert.match(await pagina.locator('#categorias').innerText(), /Frutas do pé/i, 'nome da categoria veio do catálogo');
  assert.ok(!/ERRADO/.test(await pagina.locator('#categorias').innerText()));
  await pagina.locator('#banner-comunicado.visivel').waitFor({ timeout: 4000 });
  assert.match(await pagina.locator('#banner-comunicado').innerText(), /pamonha/);
  assert.match(await pagina.locator('#header-avaliacao').innerText(), /4,8|4\.8/);
  const ouvidos = await pagina.evaluate(() => window.__ouvidos || []), lidos = await pagina.evaluate(() => window.__lidos || []);
  assert.ok(!ouvidos.includes('categorias'), 'não ouviu a coleção de categorias: ' + ouvidos.join(' | '));
  assert.ok(!ouvidos.includes('loja/comunicados'), 'não ouviu o aviso separado');
  assert.ok(!lidos.includes('loja/avaliacoes'), 'não leu a nota separada');
  semErros(erros); await fechar();
});

teste('vitrine num documento só: catálogo de antes (sem categorias junto) faz a loja ler categorias, aviso e nota como sempre', async () => {
  const c = cenarioPadrao(), b = c.lojas.banca;
  b.catalogo = { v: 1, geradoEm: Date.now() - 60e3, assinatura: 't', n: 4, produtos: ['alface', 'banana', 'ovos', 'tomate'].map((id) => ({ id, ...b.produtos[id] })) };
  b.comunicados = { fixo: { ativo: true, texto: 'Aviso lido do banco' }, dias: {} };
  const { pagina, erros, fechar } = await abrir('/', c);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.locator('#banner-comunicado.visivel').waitFor({ timeout: 4000 });
  assert.match(await pagina.locator('#banner-comunicado').innerText(), /lido do banco/);
  assert.match(await pagina.locator('#categorias').innerText(), /Legumes/i);
  const ouvidos = await pagina.evaluate(() => window.__ouvidos || []);
  assert.ok(ouvidos.includes('categorias') && ouvidos.includes('loja/comunicados'), ouvidos.join(' | '));
  semErros(erros); await fechar();
});

teste('painel num documento só: abre os produtos e os custos do documento (não lê um por um); produto salvo há pouco vale por cima', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const b = cen.lojas.banca, agora = Date.now();
  b.painel = { v: 1, geradoEm: agora - 3600e3, assinatura: 't', n: 3, produtos: [
    { id: 'tomate', ...b.produtos.tomate, estoqueFisico: 7 }, { id: 'banana', ...b.produtos.banana }, { id: 'escondido', ...b.produtos.escondido } ] };
  b.custosDoc = { v: 1, geradoEm: agora - 3600e3, custos: { tomate: { custo: 4.2, ficha: null } } };
  // depois do documento, o painel mudou o nome da banana; e há um produto que só existe no banco (se aparecer, leu um por um)
  b.produtos = { ...b.produtos, banana: { ...b.produtos.banana, nome: 'Banana nanica', ultimaModificacao: agora - 60e3 },
    fantasma: { nome: 'Só no banco', preco: 3, unidade: 'un', cat: 'outros', ativo: true, ultimaModificacao: agora - 86400e3 } };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.waitForFunction(() => /Tomate italiano/.test(document.getElementById('lista-produtos')?.innerText || ''), null, { timeout: 8000 });
  const txt = await pagina.locator('#lista-produtos').innerText();
  assert.ok(/Banana nanica/.test(txt), 'mudança recente vale por cima do documento');
  assert.ok(/Produto desligado/.test(txt), 'o painel mostra também os desligados');
  assert.ok(!/Só no banco/.test(txt), 'não leu a coleção inteira');
  const ouvidos = await pagina.evaluate(() => window.__ouvidos || []);
  assert.ok(ouvidos.includes('loja/painel') && ouvidos.includes('loja/custos'), ouvidos.join(' | '));
  assert.ok(!ouvidos.includes('produtos') && !ouvidos.includes('produtos_custos'), 'NÃO ouviu as coleções inteiras: ' + ouvidos.join(' | '));
  assert.ok(ouvidos.some((o) => o.startsWith('produtos?ultimaModificacao>')), 'ouviu só os mudados');
  semErros(erros); await fechar();
});

teste('painel num documento só: sem documento (ou caixa antes das regras novas) o painel lê os produtos como antes', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.waitForFunction(() => /Tomate italiano/.test(document.getElementById('lista-produtos')?.innerText || ''), null, { timeout: 8000 });
  const ouvidos = await pagina.evaluate(() => window.__ouvidos || []);
  assert.ok(ouvidos.includes('produtos') && ouvidos.includes('produtos_custos'), ouvidos.join(' | '));
  semErros(erros); await fechar();
});

// ---------------------------------------------------------------- CONVITE DO IPHONE (pôr na tela de início)
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A556E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
const jaPediu = () => { try { if (!localStorage.getItem('banca_meus_pedidos')) localStorage.setItem('banca_meus_pedidos', JSON.stringify([{ id: 'p1', data: '2026-10-01T12:00:00Z', total: 20, itens: [] }])); } catch (_) {} };
teste('convite do iPhone: aparece na vitrine para quem já pediu, "Agora não" some e não volta na próxima visita; não cobre o carrinho', async () => {
  const { pagina, erros, ctx, fechar } = await abrir('/', cenarioPadrao(), { contexto: { userAgent: UA_IPHONE }, antes: jaPediu });
  await cards(pagina).first().waitFor({ timeout: 8000 });
  const conv = pagina.locator('#convite-app');
  await conv.waitFor({ state: 'visible', timeout: 4000 });
  const txt = await conv.innerText();
  assert.match(txt, /Adicionar à Tela de Início/); assert.match(txt, /Compartilhar/);
  assert.strictEqual(await conv.locator('[data-action="convite-copiar"]').count(), 0, 'no Safari não precisa copiar link');
  if (process.env.PRINT_CONVITE) { await conv.screenshot({ path: process.env.PRINT_CONVITE }); await pagina.screenshot({ path: process.env.PRINT_CONVITE.replace('.png', '-tela.png') }); }
  const largura = await pagina.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(largura <= 390, `passou da largura do celular (${largura}px)`);
  assert.strictEqual(await conv.evaluate((el) => getComputedStyle(el).position), 'static', 'fica dentro da vitrine, não flutua por cima de nada');
  await conv.locator('.convite-agora').click();
  assert.ok(await conv.isHidden(), 'fechou');
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => erros.push(e.message));
  await p2.goto(servidor.base + '/'); await cards(p2).first().waitFor({ timeout: 8000 }); await p2.waitForTimeout(400);
  assert.ok(await p2.locator('#convite-app').isHidden(), 'não insiste na próxima visita');
  semErros(erros); await fechar();
});

teste('convite do iPhone: não aparece no Android, nem no iPhone de quem nunca pediu; no Instagram manda abrir no Safari com "Copiar link"', async () => {
  for (const [nome, ua, antes, espera] of [['android', UA_ANDROID, jaPediu, 'nada'], ['iphone sem pedido', UA_IPHONE, null, 'nada'], ['instagram', UA_IPHONE + ' Instagram 350.0.0.0', jaPediu, 'copiar']]) {
    const { pagina, erros, fechar } = await abrir('/', cenarioPadrao(), { contexto: { userAgent: ua }, ...(antes ? { antes } : {}) });
    await cards(pagina).first().waitFor({ timeout: 8000 }); await pagina.waitForTimeout(400);
    const conv = pagina.locator('#convite-app');
    if (espera === 'nada') assert.ok(await conv.isHidden(), `${nome}: sem convite`);
    else {
      assert.ok(await conv.isVisible(), `${nome}: convite aparece`);
      assert.match(await conv.innerText(), /Abrir no navegador/);
      assert.strictEqual(await conv.locator('[data-action="convite-copiar"]').count(), 1, `${nome}: botão de copiar o link`);
    }
    semErros(erros); await fechar();
  }
});

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
  // selo discreto no cabeçalho: o cliente vê de qual feira entrou
  await pagina.waitForSelector('#selo-feira', { timeout: 4000 });
  assert.strictEqual((await pagina.locator('#selo-feira').innerText()).trim(), 'Feira Florença');
  assert.ok(await pagina.evaluate(() => document.getElementById('selo-feira').nextElementSibling.id === 'header-nome'), 'fica logo acima do nome da banca');
  await pagina.click('#feira-lojas a:not(.atual)');
  await pagina.waitForURL(/loja=paes-da-lucia/, { timeout: 6000 });
  // a loja grava "a última banca desta feira" depois de abrir: espera essa gravação antes de voltar ao link
  await pagina.waitForFunction(() => /paes-da-lucia/.test(localStorage.getItem('banca_feira_ultima') || ''), null, { timeout: 6000 });
  await pagina.goto(servidor.base + '/feira/florenca');
  await pagina.waitForURL(/loja=paes-da-lucia/, { timeout: 6000 });
  semErros(erros); await fechar();
});
teste('cartaz de uma banca: /?loja=banca&feira=id cai NESSA banca (não na primeira da feira), com o selo da feira', async () => {
  const { pagina, erros, fechar } = await abrir('/?loja=paes-da-lucia&feira=florenca');
  await pagina.waitForSelector('#selo-feira', { timeout: 6000 });
  assert.strictEqual((await pagina.locator('#selo-feira').innerText()).trim(), 'Feira Florença');
  assert.ok(/paes-da-lucia/.test(pagina.url()), 'continua na banca do cartaz');
  semErros(erros); await fechar();
});
teste('loja aberta pelo endereço normal (sem link de feira) não mostra selo de feira', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForTimeout(400);
  assert.strictEqual(await pagina.locator('#selo-feira').count(), 0);
  semErros(erros); await fechar();
});

teste('feira: cliente que entrou pelo link não troca o condomínio no topo (só quadra e lote); o link da outra feira troca', async () => {
  const cen = cenarioPadrao();
  cen.feiras = { ...cen.feiras,
    florenca: { ...cen.feiras.florenca, conds: [{ id: 'jf', nome: 'Jardins Florença', formato: 'ql' }, { id: 'vf', nome: 'Vila Florença', formato: 'ql' }] },
    madri: { nome: 'Feira Madri', dias: [3], lojas: [{ id: 'banca', nome: 'Banca Adair e Pedrina', cor: '#1a3a2a' }], conds: [{ id: 'sm', nome: 'Solar Madri', formato: 'ql' }] } };
  cen.lojas.banca.ficha = { ...cen.lojas.banca.ficha, feiras: ['florenca', 'madri'] };
  const { pagina, erros, fechar } = await abrir('/feira/florenca', cen);
  await pagina.waitForSelector('#selo-feira', { timeout: 8000 });
  assert.strictEqual((await pagina.locator('#endereco-resumo').innerText()).trim(), 'Onde entregar?');
  await pagina.click('#btn-endereco');
  // lista só com os condomínios DA feira dele, sem "não está na lista" e sem o de outra feira
  assert.deepStrictEqual(await opcoesDe(pagina, '#end-cond'), ['Escolha o condomínio', 'Jardins Florença', 'Vila Florença']);
  await pagina.selectOption('#end-cond', { label: 'Jardins Florença' });
  await pagina.fill('#end-quadra', '5'); await pagina.fill('#end-lote', '12');
  await pagina.click('#btn-salvar-endereco');
  await pagina.waitForTimeout(400);
  // o topo mostra só quadra e lote
  assert.strictEqual((await pagina.locator('#endereco-resumo').innerText()).trim(), 'Entregar: Qd 5 · Lt 12');
  await pagina.click('#btn-endereco');
  assert.ok(!(await pagina.locator('#end-cond').isVisible()), 'o seletor de condomínio some');
  assert.match(await pagina.locator('#end-cond-fixo').innerText(), /Entregamos no condomínio Jardins Florença/);
  await pagina.fill('#end-lote', '14'); await pagina.click('#btn-salvar-endereco'); await pagina.waitForTimeout(300);
  assert.strictEqual((await pagina.locator('#endereco-resumo').innerText()).trim(), 'Entregar: Qd 5 · Lt 14');
  const salvo = await pagina.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^banca_endereco/.test(k)))));
  assert.strictEqual(salvo.condominio, 'Jardins Florença'); assert.strictEqual(salvo.lote, '14');
  // o link da OUTRA feira destrava e mostra os condomínios dela
  await pagina.goto(servidor.base + '/feira/madri');
  await pagina.waitForSelector('#selo-feira', { timeout: 8000 });
  assert.match(await pagina.locator('#selo-feira').innerText(), /Madri/);
  assert.notStrictEqual((await pagina.locator('#endereco-resumo').innerText()).trim().startsWith('Entregar:'), true, 'condomínio de outra feira: não fica travado');
  await pagina.click('#btn-endereco');
  assert.deepStrictEqual(await opcoesDe(pagina, '#end-cond'), ['Escolha o condomínio', 'Solar Madri']);
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

teste('vigia da tela: loja sem defeito não manda nada; preço cortado vai para a aba Erros com o tamanho da tela, uma vez por aparelho', async () => {
  const avisosDeTela = (desde) => servidor.chamadas.slice(desde).filter((c) => c.caminho === '/api/analytics' && c.corpo.acao === 'erro' && c.corpo.tipo === 'visual');
  // 1) loja normal: o vigia roda (2,5 s depois da vitrine) e não acusa nada
  let desde = servidor.chamadas.length;
  let { pagina, erros, fechar } = await abrir('/', cenarioPadrao(), { antes: () => { window.__errosSiteTeste = true; } });
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForTimeout(3800);
  assert.deepStrictEqual(avisosDeTela(desde).map((c) => c.corpo.msg), [], 'loja sem defeito: nenhum aviso de tela');
  semErros(erros); await fechar();
  // 2) preço do tomate espremido (defeito de propósito): vai UM aviso, com a tela e o lugar, sem dado do cliente
  const quebrar = () => { window.__errosSiteTeste = true; document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.produto-card[data-id="tomate"] .etq-preco { width: 20px; overflow: hidden; white-space: nowrap; }'; document.head.appendChild(st); }); };
  desde = servidor.chamadas.length;
  ({ pagina, erros, fechar } = await abrir('/?tel=62999', cenarioPadrao(), { antes: quebrar }));
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForFunction(() => true); await pagina.waitForTimeout(3800);
  const av = avisosDeTela(desde);
  assert.ok(av.length >= 1, 'o defeito foi avisado');
  const preco = av.find((c) => /etq-preco/.test(c.corpo.arquivo));
  assert.ok(preco, 'aponta o preço: ' + av.map((c) => c.corpo.arquivo).join(' | '));
  assert.match(preco.corpo.msg, /^Texto cortado ou vazando: .*preço/);
  assert.strictEqual(preco.corpo.tela, '390px · letra 100%');
  assert.match(preco.corpo.pilha, /ex\.: tomate/);
  assert.ok(!JSON.stringify(preco.corpo).includes('62999'), 'nada do endereço');
  // 3) o mesmo aparelho, de novo: não manda outra vez (já avisou nesta versão do site)
  desde = servidor.chamadas.length;
  await pagina.reload();
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForTimeout(3800);
  assert.deepStrictEqual(avisosDeTela(desde).filter((c) => /etq-preco/.test(c.corpo.arquivo)).length, 0, 'não repete no mesmo aparelho');
  semErros(erros); await fechar();
});

teste('"Algo estranho na tela?" no rodapé: opções fixas, manda o aviso com a tela e o que as regras acharam, e agradece', async () => {
  const { pagina, erros, fechar } = await abrir('/', cenarioPadrao(), { antes: () => { window.__errosSiteTeste = true; } });
  await cards(pagina).first().waitFor({ timeout: 8000 });
  const desde = servidor.chamadas.length;
  await pagina.locator('[data-relatar-tela]').scrollIntoViewIfNeeded();
  await pagina.click('[data-relatar-tela]');
  await pagina.waitForSelector('#relato-tela [data-relato-opcao]', { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#relato-tela textarea, #relato-tela input').count(), 0, 'sem campo de texto (nada que o cliente escreva vai junto)');
  assert.strictEqual(await pagina.locator('#relato-tela [data-relato-opcao]').count(), 5);
  await pagina.click('#relato-tela [data-relato-opcao="cortado"]');
  await pagina.waitForSelector('.relato-obrigado', { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#relato-tela').count(), 0, 'a folha fecha');
  await pagina.waitForTimeout(300);
  const av = servidor.chamadas.slice(desde).find((c) => c.caminho === '/api/analytics' && c.corpo.tipo === 'relato');
  assert.ok(av, 'o aviso chegou');
  assert.strictEqual(av.corpo.msg, 'Cliente avisou: Alguma coisa aparece cortada');
  assert.strictEqual(av.corpo.tela, '390px · letra 100%');
  assert.match(av.corpo.pilha, /regras automáticas não acharam defeito|:/);
  // Esc fecha sem mandar
  await pagina.click('[data-relatar-tela]'); await pagina.waitForSelector('#relato-tela');
  await pagina.keyboard.press('Escape');
  assert.strictEqual(await pagina.locator('#relato-tela').count(), 0);
  semErros(erros); await fechar();
});

// ---------------------------------------------------------------- PLATAFORMA
teste('plataforma: a aba Erros mostra os erros agrupados', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dono', email: 'dono@teste.com', isAnonymous: false, claims: { plataforma: true } } });
  const { pagina, erros, fechar } = await abrir('/plataforma.html', cen, { antes: () => { try { localStorage.setItem('pf_aba', 'erros'); } catch (_) { /* segue */ } } });
  await pagina.waitForSelector('.pf-erro', { timeout: 8000 });
  const txt = await pagina.locator('.pf-erros').innerText();
  assert.ok(txt.includes("Cannot read properties of undefined") && txt.includes('3×') && txt.includes('Android · Chrome 129'));
  // "Para olhar": o de código, o de tela (com o tamanho da tela) e o que VOLTOU depois de corrigido; o corrigido fica fora
  assert.ok(txt.includes('Texto cortado ou vazando') && txt.includes('320px · letra 200%'), 'defeito de tela com a tela');
  assert.ok(txt.includes('Voltou depois de corrigido'), 'o que voltou aparece marcado');
  assert.ok(!txt.includes('Foto que não abriu'), 'o corrigido (que não voltou) não aparece em "Para olhar"');
  await pagina.click('[data-pf="filtro-erros"][data-filtro="tela"]');
  assert.strictEqual(await pagina.locator('.pf-erro').count(), 2, 'filtro Tela: os dois de tela abertos');
  await pagina.click('[data-pf="filtro-erros"][data-filtro="corrigidos"]');
  assert.ok((await pagina.locator('.pf-erros').innerText()).includes('Foto que não abriu'));
  await pagina.click('[data-pf="filtro-erros"][data-filtro="abertos"]');
  // Corrigi: chama a plataforma e o erro sai da lista
  const desde = servidor.chamadas.length;
  await pagina.locator('.pf-erro', { hasText: 'Texto cortado' }).locator('[data-pf="erro-corrigi"]').click();
  await pagina.waitForFunction(() => !document.querySelector('.pf-erros').innerText.includes('Texto cortado'), null, { timeout: 3000 });
  const marcou = servidor.chamadas.slice(desde).find((c) => c.caminho === '/api/plataforma' && c.corpo.acao === 'erro-estado');
  assert.deepStrictEqual({ a: marcou.corpo.assinatura, e: marcou.corpo.estado }, { a: 'a'.repeat(20), e: 'corrigido' });
  semErros(erros); await fechar();
});

const lojasDaPlataforma = (n) => Array.from({ length: n }, (_, i) => ({ id: i ? `loja-${i}` : 'banca', nome: i ? `Loja ${i}` : 'Banca Adair e Pedrina', tipo: i % 2 ? 'Pastelaria' : 'Hortifruti', ativo: i !== 3, original: !i, cor: '#1a3a2a' }));
teste('plataforma: as lojas da última vez aparecem na hora com "Painel" de um toque; ligar um módulo não relê a plataforma inteira', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dono', email: 'dono@teste.com', isAnonymous: false, claims: { plataforma: true } } });
  const guardadas = lojasDaPlataforma(4);
  const { pagina, ctx, erros, fechar } = await abrir('/plataforma.html', cen, { antes: `try { localStorage.setItem('pf_aba', 'lojas'); localStorage.setItem('pf_lojas_leve_v1', JSON.stringify({ em: Date.now(), lojas: ${JSON.stringify(guardadas)} })); } catch (_) {}` });
  const chamadas = [];
  await ctx.route('**/api/plataforma', async (r) => {
    const corpo = JSON.parse(r.request().postData() || '{}'); chamadas.push(corpo.acao);
    if (corpo.acao === 'lojas') { await new Promise((ok) => setTimeout(ok, 2500)); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sucesso: true, lojas: guardadas.map((l) => ({ ...l, donos: ['a@b.com'], modulos: { ia: false, pdv: true }, campos: {}, mes: { receita: 10, pedidos: 1 } })), feiras: [], condominios: [], modelos: ['hortifruti'], modulos: { ia: 'Ajudante de IA na loja', pdv: 'Balcão' }, campos: {}, pix: false, fotos: false }) }); }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sucesso: true }) });
  });
  await pagina.reload();
  // ANTES de a lista completa chegar (2,5 s): as 4 lojas já estão na tela, cada uma com o link direto do painel
  await pagina.waitForSelector('.pf-painel', { timeout: 1800 });
  assert.strictEqual(await pagina.locator('.pf-painel').count(), 4);
  assert.match(await pagina.locator('.pf-painel').nth(1).getAttribute('href'), /\/admin\?loja=loja-1$/);
  assert.ok(await pagina.locator('.pf-painel').first().getAttribute('href').then((h) => !/loja=/.test(h)), 'a loja original abre sem ?loja=');
  // depois: os números chegam e o botão continua lá
  await pagina.waitForSelector('.pf-linha-num', { timeout: 6000 });
  assert.strictEqual(await pagina.locator('.pf-painel').count(), 4);
  // abre a ficha e liga um módulo: grava (acao modulos) e NÃO relê a plataforma
  await pagina.click('[data-pf="abrir-loja"][data-loja="loja-1"]');
  await pagina.waitForSelector('[data-pf-modulo="ia"]', { timeout: 3000 });
  const antes = chamadas.filter((x) => x === 'lojas').length;
  await pagina.check('[data-pf-modulo="ia"]');
  await pagina.waitForFunction(() => document.querySelector('[data-pf-modulo="ia"]').checked, null, { timeout: 2000 });
  await pagina.waitForTimeout(400);
  assert.ok(chamadas.includes('modulos'), 'o servidor foi avisado');
  assert.strictEqual(chamadas.filter((x) => x === 'lojas').length, antes, 'sem reler a lista inteira');
  assert.ok(await pagina.locator('[data-pf-modulo="ia"]').isChecked(), 'o interruptor fica ligado');
  semErros(erros); await fechar();
});
teste('painel: o dono da plataforma troca de loja pelo menu "Trocar de loja", com busca, e a lista guardada aparece na hora', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dono', email: 'dono@teste.com', isAnonymous: false, claims: { plataforma: true } } });
  const todas = lojasDaPlataforma(9);
  const { pagina, ctx, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false }, antes: `try { localStorage.setItem('pf_lojas_leve_v1', JSON.stringify({ em: Date.now(), lojas: ${JSON.stringify(todas.slice(0, 3))} })); } catch (_) {}` });
  let leves = 0;
  await ctx.route('**/api/plataforma', async (r) => {
    const corpo = JSON.parse(r.request().postData() || '{}');
    if (corpo.acao === 'lojas-leve') { leves++; await new Promise((ok) => setTimeout(ok, 1200)); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sucesso: true, lojas: todas }) }); }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sucesso: true }) });
  });
  await pagina.reload();
  await pagina.waitForSelector('#topo-trocar:not([hidden])', { timeout: 8000 });
  assert.match(await pagina.locator('#topo-trocar').innerText(), /Trocar de loja/);
  await pagina.click('#topo-trocar');
  // a lista guardada (3 lojas) já está ali; a nova (9) chega depois
  assert.strictEqual(await pagina.locator('.menu-bancas-lista a').count(), 3);
  await pagina.waitForFunction(() => document.querySelectorAll('.menu-bancas-lista a').length === 9, null, { timeout: 5000 });
  assert.ok(leves >= 1 && leves <= 2, `a lista leve foi pedida (${leves}x, contando a abertura antes do reload)`);
  assert.ok(await pagina.locator('.menu-bancas-busca').isVisible(), 'com muitas lojas aparece a busca');
  // tocar na busca não fecha o menu; digitar filtra
  await pagina.click('.menu-bancas-busca');
  assert.ok(await pagina.locator('#menu-mais').isVisible(), 'o menu continua aberto');
  await pagina.fill('.menu-bancas-busca', 'loja 5');
  assert.deepStrictEqual(await pagina.locator('.menu-bancas-lista a').allInnerTexts(), ['Loja 5'].map((t) => t));
  assert.match(await pagina.locator('.menu-bancas-lista a').first().getAttribute('href'), /loja=loja-5$/);
  await pagina.fill('.menu-bancas-busca', 'zzz');
  assert.match(await pagina.locator('.menu-bancas-lista').innerText(), /Nenhuma loja/);
  await pagina.fill('.menu-bancas-busca', '');
  assert.ok((await pagina.locator('.menu-bancas-lista a[aria-current]').innerText()).includes('Banca Adair'), 'a loja aberta fica marcada');
  assert.ok((await pagina.locator('.menu-bancas-lista').innerText()).includes('(bloqueada)'), 'loja bloqueada aparece marcada');
  semErros(erros); await fechar();
});

teste('plataforma: "Link de entrada" do proprietário gera o link sem e-mail (o do Firebase cai no spam e lá não abre) e oferece copiar e mandar no WhatsApp', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dono', email: 'dono@teste.com', isAnonymous: false, claims: { plataforma: true } } });
  const guardadas = lojasDaPlataforma(2);
  const { pagina, ctx, erros, fechar } = await abrir('/plataforma.html', cen, { antes: `try { localStorage.setItem('pf_aba', 'lojas'); } catch (_) {}` });
  const pedidos = [];
  const LINK = 'https://projeto.firebaseapp.com/__/auth/action?mode=signIn&oobCode=ABC123&continueUrl=https%3A%2F%2Fusebanca.com%2Fadmin.html%3Floja%3Dloja-1';
  await ctx.route('**/api/plataforma', async (r) => {
    const corpo = JSON.parse(r.request().postData() || '{}'); pedidos.push(corpo);
    if (corpo.acao === 'lojas') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sucesso: true, lojas: guardadas.map((l) => ({ ...l, donos: ['cliente@icloud.com'], modulos: {}, campos: {}, mes: { receita: 0, pedidos: 0 } })), feiras: [], condominios: [], modelos: ['hortifruti'], modulos: {}, campos: {}, pix: false, fotos: false }) });
    if (corpo.acao === 'link-entrada') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sucesso: true, link: LINK, email: corpo.email }) });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sucesso: true }) });
  });
  await pagina.reload();
  await pagina.waitForSelector('[data-pf="abrir-loja"][data-loja="loja-1"]', { timeout: 8000 });
  await pagina.click('[data-pf="abrir-loja"][data-loja="loja-1"]');
  await pagina.click('[data-pf="link-entrada"][data-email="cliente@icloud.com"]');
  await pagina.waitForSelector('.pf-link-entrada', { timeout: 4000 });
  const p = pedidos.find((x) => x.acao === 'link-entrada');
  assert.deepStrictEqual({ id: p.id, email: p.email }, { id: 'loja-1', email: 'cliente@icloud.com' });
  assert.strictEqual(await pagina.locator('.pf-link-entrada input').inputValue(), LINK);
  const wa = await pagina.locator('.pf-link-entrada a[href^="https://wa.me/"]').getAttribute('href');
  assert.ok(decodeURIComponent(wa).includes(LINK) && decodeURIComponent(wa).includes('cliente@icloud.com'), 'o WhatsApp leva o link e o e-mail');
  assert.strictEqual(await pagina.locator('.pf-link-entrada [data-pf="copiar-texto"]').getAttribute('data-copiar'), LINK);
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

teste('plataforma: "Montar cartaz" da loja: um por feira, o QR abre a LOJA dentro da feira, tudo editável (textos, WhatsApp, Instagram, logo e foto) com prévia', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dono', email: 'dono@teste.com', isAnonymous: false, claims: { plataforma: true } } });
  cen.lojas.banca.ficha = { ...cen.lojas.banca.ficha, nome: 'Pastel Moe Coe', subtitulo: 'Pastel e caldo de cana, desde 1968', tema: { primaria: '#1c201f', destaque: '#ffde59', botao: '#ffde59', fundo: '#fbf4e2', texto: '#1c201f', logo: 'https://img.exemplo.test/logo.png', capa: 'https://img.exemplo.test/truck.jpg' } };
  const { pagina, erros, fechar } = await abrir('/plataforma.html', cen, { antes: () => { try { localStorage.setItem('pf_aba', 'lojas'); } catch (_) { /* segue */ } } });
  await pagina.waitForSelector('[data-pf="abrir-loja"]', { timeout: 8000 });
  await pagina.evaluate(() => { window.print = () => {}; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.tagName === 'IFRAME' && n.srcdoc) window.__cartaz = n.srcdoc; }))).observe(document.body, { childList: true }); });
  await pagina.click('[data-pf="abrir-loja"][data-loja="banca"]');
  await pagina.click('[data-pf="cartaz-abrir"]');
  await pagina.waitForSelector('#pf-cz-previa iframe[srcdoc]', { timeout: 6000 });
  const previa = () => pagina.evaluate(() => document.querySelector('#pf-cz-previa iframe').srcdoc);
  let html = await previa();
  assert.ok(html.includes('Pastel Moe Coe') && html.includes('desde 1968'), 'nome e frase da loja');
  assert.ok(html.includes('#ffde59') && html.includes('#1c201f'), 'as cores da loja');
  assert.ok(html.includes('src="https://img.exemplo.test/logo.png"') && html.includes('src="https://img.exemplo.test/truck.jpg"'), 'a logo e a foto da loja');
  assert.ok(html.includes('Feira do Bairro') && !html.includes('Feira do Lago'), 'começa na primeira feira, com o nome dela no topo');
  const qr = (html.match(/aria-label="QR Code: ([^"]*)"/) || [])[1] || '';
  assert.ok(qr.includes('feira=feira-do-bairro') && !qr.includes('/feira/'), 'o QR abre a LOJA (endereço da loja + ?feira=), não a tela da feira que cai na primeira banca: ' + qr);
  assert.ok(html.includes('(62) 99999-0000'), 'o WhatsApp da loja já vem');
  // edita: texto do topo, WhatsApp e Instagram
  await pagina.fill('#pf-cz-local', 'Feira Atenas');
  await pagina.fill('#pf-cz-insta', '@pastel moe');
  await pagina.waitForFunction(() => document.getElementById('pf-cz-aviso-insta').textContent.includes('Confira'), null, { timeout: 3000 });
  await pagina.fill('#pf-cz-insta', '@pastelmoecoe');
  await pagina.fill('#pf-cz-wpp', '61 98888-7777');
  await pagina.waitForFunction(() => { const h = document.querySelector('#pf-cz-previa iframe').srcdoc; return h.includes('Feira Atenas') && h.includes('@pastelmoecoe') && h.includes('(61) 98888-7777'); }, null, { timeout: 4000 });
  // foto do celular (só nesta página)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  await pagina.setInputFiles('[data-pf-cartaz-img="foto"]', { name: 'truck.png', mimeType: 'image/png', buffer: png });
  await pagina.waitForFunction(() => document.querySelector('#pf-cz-previa iframe').srcdoc.includes('src="data:image/jpeg;base64,'), null, { timeout: 4000 });
  // o botão "Escolher do celular" abre mesmo a galeria (antes era um <label> com o campo escondido) e a folha continua respondendo
  const [escolha] = await Promise.all([pagina.waitForEvent('filechooser', { timeout: 4000 }), pagina.click('[data-pf="cartaz-img-escolher"][data-img="logo"]')]);
  await escolha.setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await pagina.waitForFunction(() => /src="data:image\/(webp|png);base64,/.test(document.querySelector('#pf-cz-previa iframe').srcdoc), null, { timeout: 4000 });
  assert.ok(await pagina.isEnabled('[data-pf="cartaz-img-escolher"][data-img="foto"]'), 'terminou de preparar: os botões voltam');
  // outra feira: link e topo trocam; os textos da primeira ficam guardados
  await pagina.selectOption('#pf-cz-feira', 'feira-do-lago');
  await pagina.waitForFunction(() => { const h = document.querySelector('#pf-cz-previa iframe').srcdoc; return h.includes('Feira do Lago') && h.includes('feira=feira-do-lago'); }, null, { timeout: 4000 });
  await pagina.selectOption('#pf-cz-feira', 'feira-do-bairro');
  await pagina.waitForFunction(() => document.querySelector('#pf-cz-previa iframe').srcdoc.includes('Feira Atenas'), null, { timeout: 4000 });
  await pagina.click('[data-pf="cartaz-imprimir"]');
  await pagina.waitForFunction(() => !!window.__cartaz, null, { timeout: 5000 });
  html = await pagina.evaluate(() => window.__cartaz);
  assert.ok(html.includes('Feira Atenas') && html.includes('@pastelmoecoe') && html.includes('parte de trás'), 'imprime o que foi editado, com a fitinha explicada');
  assert.ok(!/<script/i.test(html), 'sem script na página do cartaz');
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
  await pagina.click('#comanda .cm-dobra > summary');   // a comanda abre fechada numa linha (itens, dia e total)
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
  assert.ok(/4 por R\$ 10/.test(await bb.locator('.etq-promo').innerText()) && /pode misturar pacotes/.test(await bb.locator('.etq-mistura').innerText()), 'a etiqueta avisa que dá para misturar');
  // nada passa da borda da etiqueta (no celular o selo saía para fora)
  const fora = await pagina.evaluate(() => [...document.querySelectorAll('#lista-produtos .etiqueta')].some((e) => { const r = e.getBoundingClientRect(); return [...e.querySelectorAll('*')].some((f) => f.getBoundingClientRect().right > r.right + 1); }));
  assert.ok(!fora, 'selo da promoção cabe dentro da etiqueta');
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
  await pagina.click('#comanda .cm-dobra > summary');   // a comanda abre fechada numa linha (itens, dia e total)
  const comanda = await pagina.locator('#comanda').innerText();
  assert.ok((comanda.match(/promoção 4 por R\$ 10/g) || []).length === 2, comanda);
  assert.ok(/R\$\s10,00/.test(await pagina.locator('#comanda .cm-total').innerText()), comanda);
  semErros(erros); await fechar();
});

teste('temperos: cantinho no fim (depois dos pacotes), "+ 1 potinho", sacola com o grupo Temperos e comanda em potinhos', async () => {
  const cen = cenarioPacotes();
  Object.assign(cen.lojas.banca.produtos, {
    colorau: { nome: 'Colorau', preco: 4, unidade: 'un', cat: 'temperos', ativo: true },
    cominho: { nome: 'Cominho', preco: 4.5, unidade: 'un', cat: 'temperos', ativo: true },
  });
  const { pagina, erros, fechar } = await abrir('/', cen);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  const ordem = await pagina.evaluate(() => [...document.querySelectorAll('#lista-produtos > .produto-card, #lista-produtos > .bloco-pacotes, #lista-produtos > .bloco-temperos')]
    .map((e, i) => ({ o: Number(e.style.order) || 0, i, k: e.classList.contains('bloco-pacotes') ? 'PACOTES' : e.classList.contains('bloco-temperos') ? 'TEMPEROS' : e.dataset.id })).sort((a, b) => a.o - b.o || a.i - b.i).map((x) => x.k));
  assert.strictEqual(ordem[ordem.length - 3], 'TEMPEROS', ordem.join(','));
  assert.deepStrictEqual(ordem.slice(-2).sort(), ['colorau', 'cominho'], 'os temperos ficam no fim, depois dos pacotes: ' + ordem.join(','));
  assert.ok(ordem.indexOf('PACOTES') < ordem.indexOf('TEMPEROS'), ordem.join(','));
  assert.ok(/Cantinho dos temperos/.test(await pagina.locator('.bloco-temperos').innerText()));
  const col = pagina.locator('#lista-produtos .produto-card[data-id="colorau"]');
  assert.ok(/TEMPERO/i.test(await col.locator('.lacre-tempero').innerText()));
  assert.ok(/o potinho/.test(await col.locator('.etiqueta').innerText()));
  await col.scrollIntoViewIfNeeded();
  assert.strictEqual((await col.locator('[data-action="add"]').innerText()).trim(), '+ 1 potinho');
  await col.locator('[data-action="add"]').click(); await col.locator('[data-action="inc"]').click();
  await pagina.waitForFunction(() => /2 potinhos/.test(document.querySelector('#lista-produtos .produto-card[data-id="colorau"] .card-qtd')?.innerText || ''), null, { timeout: 3000 });
  // a aba da categoria mostra só os temperos, com o cabeçalho do cantinho
  await pagina.locator('#categorias .cat-btn[data-cat="temperos"]').click();
  await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).length === 2);
  assert.ok(await pagina.locator('.bloco-temperos').isVisible());
  await pagina.locator('#categorias .cat-btn[data-cat="todas"]').click();
  const bb = pagina.locator('#lista-produtos .produto-card[data-id="bb"]');
  await bb.scrollIntoViewIfNeeded(); await bb.locator('[data-action="add"]').click();
  await pagina.locator('#btn-carrinho-mobile').click();
  const sacola = await pagina.locator('#carrinho-itens').innerText();
  assert.ok(/Temperos/i.test(sacola) && /2 potinhos/.test(sacola) && /Pacotes prontos/i.test(sacola), sacola);
  await pagina.locator('#btn-abrir-checkout').click();
  await pagina.click('#comanda .cm-dobra > summary');   // a comanda abre fechada numa linha (itens, dia e total)
  const comanda = await pagina.locator('#comanda').innerText();
  assert.ok(/2 potinhos/.test(comanda) && /Colorau/.test(comanda) && /R\$\s8,00/.test(comanda), comanda);
  semErros(erros); await fechar();
});

teste('pacotes: no painel, peso do pacote em branco é aceito e promoção mais cara é recusada', async () => {
  const cen = cenarioPacotes(); cen.conta = { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } };
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false, hasTouch: false } });
  await pagina.locator('[data-action="editar-produto"][data-id="cb"]').first().click({ timeout: 8000 });
  await pagina.waitForFunction(() => document.activeElement && document.activeElement.id === 'edit-nome', null, { timeout: 3000 });   // a janela põe o foco no nome logo depois de abrir
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
  await pagina.locator('summary:has-text("Cantinho dos temperos")').click();
  await pagina.fill('#vt-tmp-titulo', 'Temperos da Pedrina');
  await pagina.locator('#vt-tmp-cat').selectOption({ index: 1 });
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
  assert.strictEqual(v.temperos.titulo, 'Temperos da Pedrina'); assert.ok(v.temperos.cat && v.temperos.cat !== '-', 'a categoria escolhida é gravada: ' + JSON.stringify(v.temperos));
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

teste('loja: seções coloridas (jeito "só a faixa") por categoria vêm antes dos soltos, cada uma com seu cabeçalho; capa sem película tira o véu', async () => {
  const c = cenarioPadrao();
  const prod = (nome, cat, preco = 9) => ({ nome, preco, unidade: 'un', cat, ativo: true });
  c.lojas.bie = { ficha: { nome: 'Pastel & Açaí do Bié', ativo: true, tipo: 'Pastel e açaí', tema: { primaria: '#4a1650', secundaria: '#8e3a8f', destaque: '#f0b94a', fundo: '#fff6e4', superficie: '#ffffff', texto: '#2a1230', sobrePrimaria: '#ffffff', botao: '#7b2d8b', cabecalho: 'capa', pelicula: 'nao', capa: 'https://capa.exemplo.com/capa.png' } },
    produtos: { p1: prod('Pastel de carne', 'pasteis'), p2: prod('Pastel de queijo', 'pasteis'), a1: prod('Açaí 300 ml', 'acai', 16), a2: prod('Açaí 500 ml', 'acai', 22), c1: prod('Caldo de cana', 'bebidas', 7) },
    categorias: [{ chave: 'pasteis', nome: 'Pastéis', ordem: 1 }, { chave: 'acai', nome: 'Açaí', ordem: 2 }, { chave: 'bebidas', nome: 'Bebidas', ordem: 3 }],
    config: { lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], minimo: 0, wpp: '5562999990000', vitrine: { secoes: [
      { cat: 'pasteis', titulo: 'Pastéis', texto: 'Crocantes, na hora.', cor: '#efb94a', icone: 'pastel', estilo: 'faixa' },
      { cat: 'acai', titulo: 'Açaí', texto: 'Cremoso e gelado.', cor: '#5a1f6b', icone: 'tigela', estilo: 'faixa' }] } } };
  const { pagina, erros, fechar } = await abrir('/?loja=bie', c);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  const ordem = await pagina.evaluate(() => [...document.querySelectorAll('#lista-produtos > .produto-card, #lista-produtos > .bloco-secao')]
    .map((e, i) => ({ o: Number(e.style.order) || 0, i, k: e.classList.contains('bloco-secao') ? 'SEC' + e.dataset.i : e.dataset.id })).sort((a, b) => a.o - b.o || a.i - b.i).map((x) => x.k));
  assert.strictEqual(ordem[0], 'SEC0', 'o cabeçalho dos pastéis abre a vitrine: ' + ordem.join(','));
  assert.deepStrictEqual(ordem.slice(1, 3).sort(), ['p1', 'p2'], ordem.join(','));
  assert.strictEqual(ordem[3], 'SEC1', 'depois dos pastéis vem o cabeçalho do açaí: ' + ordem.join(','));
  assert.deepStrictEqual(ordem.slice(4, 6).sort(), ['a1', 'a2'], ordem.join(','));
  assert.strictEqual(ordem[6], 'c1', 'o que não tem seção vem depois: ' + ordem.join(','));
  const sec0 = pagina.locator('.bloco-secao[data-i="0"]'), sec1 = pagina.locator('.bloco-secao[data-i="1"]');
  assert.ok(/Pastéis/.test(await sec0.innerText()) && /Crocantes/.test(await sec0.innerText()));
  assert.strictEqual(await sec0.locator('svg.arte-cat').count(), 1, 'o desenho da seção aparece');
  assert.strictEqual(await sec0.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(239, 185, 74)', 'faixa dourada');
  assert.strictEqual(await sec0.evaluate((e) => getComputedStyle(e).color), 'rgb(42, 26, 12)', 'tinta escura sobre o dourado');
  assert.strictEqual(await sec1.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(90, 31, 107)', 'faixa roxa');
  assert.strictEqual(await sec1.evaluate((e) => getComputedStyle(e).color), 'rgb(255, 255, 255)', 'tinta branca sobre o roxo');
  assert.ok(await pagina.locator('.produto-card[data-id="a1"]').evaluate((e) => e.classList.contains('produto-card--secao')));
  assert.strictEqual(await pagina.locator('.produto-card[data-id="c1"]').evaluate((e) => e.classList.contains('produto-card--secao')), false);
  // capa sem película: o véu da cor principal some
  assert.ok(await pagina.evaluate(() => document.documentElement.classList.contains('ap-pelicula-nao') && document.documentElement.classList.contains('ap-cabecalho-capa')));
  assert.strictEqual(await pagina.evaluate(() => getComputedStyle(document.getElementById('header-principal'), '::before').backgroundImage), 'none', 'sem película');
  // película com força regulável e botões do cabeçalho com fundo (vidro / claro) e opacidade
  const estilo = (js) => pagina.evaluate(js);
  await pagina.evaluate(() => { const r = document.documentElement; r.classList.remove('ap-pelicula-nao'); r.style.setProperty('--pelicula-forca', '0.4'); });
  assert.strictEqual(await estilo(() => getComputedStyle(document.getElementById('header-principal'), '::before').opacity), '0.4', 'a força regula a película');
  assert.strictEqual(await estilo(() => getComputedStyle(document.querySelector('.chip-header')).backgroundColor), 'rgba(0, 0, 0, 0)', 'por padrão o botão é só contorno');
  await pagina.evaluate(() => { const r = document.documentElement; r.classList.add('ap-botaoCab-vidro'); r.style.setProperty('--botao-cab-pct', '50%'); });
  await pagina.waitForTimeout(400);   // o botão tem transição de fundo
  { const bg = await estilo(() => getComputedStyle(document.querySelector('.chip-header')).backgroundColor); assert.ok(/(rgba\(0, 0, 0, 0\.5\)|color\(srgb 0 0 0 \/ 0\.5\))/.test(bg), 'vidro: fundo escuro a 50%: ' + bg); }
  await pagina.evaluate(() => { const r = document.documentElement; r.classList.remove('ap-botaoCab-vidro'); r.classList.add('ap-botaoCab-solido'); r.style.setProperty('--botao-cab-pct', '100%'); });
  await pagina.waitForTimeout(400);
  { const bg = await estilo(() => getComputedStyle(document.querySelector('.chip-header')).backgroundColor); assert.ok(/(rgb\(255, 255, 255\)|color\(srgb 1 1 1\))/.test(bg), 'claro: fundo cheio: ' + bg); }
  // com busca ou categoria escolhida, as faixas somem (só vale na vitrine inteira)
  await pagina.locator('#categorias .cat-btn[data-cat="acai"]').click();
  await pagina.waitForFunction(() => !document.querySelector('.bloco-secao'), null, { timeout: 3000 });
  await pagina.locator('#categorias .cat-btn[data-cat="todas"]').click();
  await pagina.waitForSelector('.bloco-secao[data-i="1"]', { timeout: 3000 });
  assert.deepStrictEqual(erros, [], 'sem erro de código: ' + erros.join(' | '));
  await fechar();
});
teste('loja: seção imersiva (fundo inteiro) pinta atrás do título e dos produtos, tira a caixa do cartão e, na aba, pinta a página; Instagram e WhatsApp da loja aparecem', async () => {
  const c = cenarioPadrao();
  const prod = (nome, cat, preco = 9) => ({ nome, preco, unidade: 'un', cat, ativo: true });
  c.lojas.bie = { ficha: { nome: 'Pastel & Açaí do Bié', ativo: true, tema: { primaria: '#4a1650', fundo: '#fff6e4', superficie: '#ffffff', texto: '#2a1230', sobrePrimaria: '#ffffff' } },
    produtos: { p1: prod('Pastel de carne', 'pasteis'), p2: prod('Pastel de queijo', 'pasteis'), p3: prod('Pastel de frango', 'pasteis'), a1: prod('Açaí 300 ml', 'acai', 16), c1: prod('Caldo de cana', 'bebidas', 7) },
    categorias: [{ chave: 'pasteis', nome: 'Pastéis', ordem: 1 }, { chave: 'acai', nome: 'Açaí', ordem: 2 }, { chave: 'bebidas', nome: 'Bebidas', ordem: 3 }],
    config: { lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], minimo: 0, wpp: '5562999990000', contato: { instagram: 'pasteldobie', mostrarWpp: true },
      vitrine: { secoes: [{ cat: 'pasteis', titulo: 'Pastéis', cor: '#efb94a', icone: 'pastel' }, { cat: 'acai', titulo: 'Açaí', cor: '#5a1f6b', icone: 'tigela' }] } } };
  const { pagina, erros, fechar } = await abrir('/?loja=bie', c);
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForSelector('.fundo-secao[data-i="0"]', { state: 'attached', timeout: 3000 });
  // o fundo cobre do título ao último pastel
  const caixa = await pagina.evaluate(() => {
    const f = document.querySelector('.fundo-secao[data-i="0"]').getBoundingClientRect();
    const els = [...document.querySelectorAll('.bloco-secao[data-i="0"], .produto-card[data-secao="0"]')].map((e) => e.getBoundingClientRect());
    return { f: { t: f.top, b: f.bottom }, t: Math.min(...els.map((r) => r.top)), b: Math.max(...els.map((r) => r.bottom)), cor: getComputedStyle(document.querySelector('.fundo-secao[data-i="0"]')).backgroundColor };
  });
  assert.ok(caixa.f.t <= caixa.t + 1 && caixa.f.b >= caixa.b - 1, 'o fundo cobre a seção inteira: ' + JSON.stringify(caixa));
  assert.strictEqual(caixa.cor, 'rgb(239, 185, 74)');
  const card = pagina.locator('.produto-card[data-id="a1"]');
  assert.ok(await card.evaluate((e) => e.classList.contains('produto-card--imersivo')));
  assert.strictEqual(await card.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'sem a caixa do cartão');
  assert.strictEqual(await card.locator('.produto-nome').evaluate((e) => getComputedStyle(e).color), 'rgb(255, 255, 255)', 'nome em branco sobre o roxo');
  assert.strictEqual(await pagina.locator('.bloco-secao[data-i="0"]').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'o título fica sobre o fundo (sem faixa à parte)');
  assert.strictEqual(await pagina.locator('.produto-card[data-id="c1"]').evaluate((e) => e.classList.contains('produto-card--imersivo')), false);
  // na aba do açaí: título continua, a página fica roxa; em "Todos" volta
  await pagina.locator('#categorias .cat-btn[data-cat="acai"]').click();
  await pagina.waitForFunction(() => document.body.classList.contains('cat-imersiva'), null, { timeout: 3000 });
  await pagina.waitForTimeout(600);          // a cor entra devagar (transição)
  assert.strictEqual(await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(90, 31, 107)');
  assert.ok(await pagina.locator('.bloco-secao[data-i="1"]').isVisible(), 'o título da seção aparece na aba dela');
  await pagina.locator('#categorias .cat-btn[data-cat="todas"]').click();
  await pagina.waitForFunction(() => !document.body.classList.contains('cat-imersiva'), null, { timeout: 3000 });
  // contato da loja: dois botões no topo e o bloco no fim
  assert.ok(await pagina.locator('#header-redes').isVisible());
  assert.strictEqual(await pagina.locator('#header-redes a[href="https://www.instagram.com/pasteldobie/"]').count(), 1);
  assert.strictEqual(await pagina.locator('#header-redes a[href^="https://wa.me/5562999990000"]').count(), 1);
  assert.ok(/@pasteldobie/.test(await pagina.locator('#fale-loja').innerText()) && /\(62\) 99999-0000/.test(await pagina.locator('#fale-loja').innerText()));
  assert.deepStrictEqual(erros, [], 'sem erro de código: ' + erros.join(' | '));
  await fechar();
});
teste('loja encaixa: celular pequeno, letra grande e computador sem rolar para o lado; com letra grande o produto deita (foto ao lado)', async () => {
  const c = cenarioPadrao();
  for (const [vw, vh, letra, mobile] of [[320, 640, '', true], [390, 844, '150%', true], [390, 844, '200%', true], [1366, 800, '', false], [768, 1024, '', true]]) {
    const { pagina, erros, fechar } = await abrir('/', c, { contexto: { viewport: { width: vw, height: vh }, isMobile: mobile, hasTouch: mobile } });
    if (letra) await pagina.evaluate((l) => { document.documentElement.style.fontSize = l; dispatchEvent(new Event('resize')); }, letra);
    await cards(pagina).first().waitFor({ timeout: 8000 });
    await pagina.waitForTimeout(400);
    const largura = await pagina.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(largura <= vw, `${vw}px ${letra || 'letra normal'}: a página tem ${largura}px (rola para o lado)`);
    if (letra === '200%') {
      assert.ok(await pagina.evaluate(() => document.documentElement.classList.contains('texto-grande')), 'liga .texto-grande');
      const dir = await cards(pagina).first().evaluate((e) => getComputedStyle(e).flexDirection);
      assert.strictEqual(dir, 'row', 'uma coluna só: foto ao lado do texto');
    }
    if (vw === 1366) {
      const cols = await pagina.evaluate(() => getComputedStyle(document.getElementById('lista-produtos')).gridTemplateColumns.split(' ').length);
      assert.ok(cols >= 4, `computador: ${cols} colunas de produtos`);
    }
    semErros(erros); await fechar();
  }
});
teste('painel: Aparência aceita o código da cor digitado (#rrggbb), mostra o que vale e o modelo "Pastel e açaí" preenche tudo', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/testes/tela/painel-aparencia.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.waitForSelector('#ap-gravar', { timeout: 8000 });
  await pagina.evaluate(() => document.querySelectorAll('#aparencia-conteudo details').forEach((d) => { d.open = true; }));
  const hex = (k) => pagina.locator(`[data-hex="${k}"]`), cor = (k) => pagina.locator(`input[type="color"][data-cor="${k}"]`);
  assert.strictEqual(await hex('primaria').inputValue(), (await cor('primaria').inputValue()), 'o campo do código mostra a cor que está valendo');
  // digitar sem o #: vale na hora e o seletor acompanha
  await hex('primaria').fill('4a1650');
  assert.strictEqual(await cor('primaria').inputValue(), '#4a1650');
  assert.strictEqual(await pagina.locator('#ap-estado').innerText(), 'Mudanças ainda não gravadas');
  // texto que não é cor: marca em vermelho, não muda nada, e ao sair volta ao código que vale
  await hex('secundaria').fill('roxo');
  assert.strictEqual(await hex('secundaria').getAttribute('aria-invalid'), 'true');
  await pagina.locator('[data-hex="destaque"]').focus();
  assert.strictEqual(await hex('secundaria').inputValue(), await cor('secundaria').inputValue(), 'saiu do campo: volta ao código que vale');
  assert.strictEqual(await hex('secundaria').getAttribute('aria-invalid'), null);
  // #abc vira #aabbcc ao sair do campo
  await hex('destaque').fill('#fa0'); await hex('texto').focus();
  assert.strictEqual(await cor('destaque').inputValue(), '#ffaa00');
  // o modelo "Pastel e açaí" traz as cores certas e o campo mostra os códigos
  await pagina.locator('[data-modelo="pastelacai"]').click();
  for (const [k, v] of Object.entries({ primaria: '#4a1650', secundaria: '#8e3a8f', destaque: '#f0b94a', fundo: '#fff6e4', superficie: '#ffffff', texto: '#2a1230', sobrePrimaria: '#ffffff', botao: '#7b2d8b' })) assert.strictEqual(await hex(k).inputValue(), v, k);
  assert.ok(await pagina.locator('[data-modelo="pastelacai"]').evaluate((b) => b.classList.contains('ativo')), 'o modelo aparece marcado');
  // o modelo já traz os botões roxos (ponte para o açaí); marcar "igual à cor principal" trava o campo, e desmarcar libera
  assert.strictEqual(await hex('botao').inputValue(), '#7b2d8b');
  await pagina.check('#ap-botao-igual'); assert.strictEqual(await hex('botao').isDisabled(), true, 'igual à principal: o campo trava');
  await pagina.uncheck('#ap-botao-igual'); await hex('botao').fill('#f0b94a');
  assert.strictEqual(await cor('botao').inputValue(), '#f0b94a');
  await pagina.click('#ap-gravar');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /^tenants\/banca$/.test(g.path)), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.filter((x) => /^tenants\/banca$/.test(x.path)).pop().dados);
  assert.strictEqual(g.tema.primaria, '#4a1650'); assert.strictEqual(g.tema.botao, '#f0b94a'); assert.strictEqual(g.tema.fonteTitulo, 'Baloo 2');
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

teste('painel: Vitrine monta uma seção colorida (categoria, cor pelo código, desenho) e grava em loja/config', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/testes/tela/painel-aparencia.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.waitForSelector('#vt-gravar', { timeout: 8000 });
  await pagina.click('[data-acao-vt="mais-secao"]');
  await pagina.selectOption('select[data-sc="0"][data-campo="cat"]', 'frutas');
  assert.strictEqual(await pagina.inputValue('input[data-sc="0"][data-campo="titulo"]'), 'Frutas', 'escolher a categoria já preenche o título');
  await pagina.fill('input[data-sc="0"][data-campo="corhex"]', '#5a1f6b');
  assert.strictEqual(await pagina.inputValue('input[type="color"][data-sc="0"]'), '#5a1f6b', 'o seletor acompanha o código digitado');
  await pagina.selectOption('select[data-sc="0"][data-campo="icone"]', 'tigela');
  // seção sem título não grava
  await pagina.fill('input[data-sc="0"][data-campo="titulo"]', '');
  await pagina.click('#vt-gravar');
  await pagina.waitForTimeout(300);
  assert.ok(!(await pagina.evaluate(() => (window.__gravados || []).some((g) => g.path === 'loja/config'))), 'seção incompleta: não grava');
  await pagina.fill('input[data-sc="0"][data-campo="titulo"]', 'Frutas do dia');
  await pagina.click('#vt-gravar');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => g.path === 'loja/config'), null, { timeout: 4000 });
  const g = await pagina.evaluate(() => window.__gravados.find((x) => x.path === 'loja/config').dados);
  assert.deepStrictEqual(g.vitrine.secoes, [{ cat: 'frutas', titulo: 'Frutas do dia', texto: '', cor: '#5a1f6b', icone: 'tigela', estilo: 'fundo' }], 'o jeito padrão é o fundo inteiro');
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
  await pagina.waitForTimeout(300);
  assert.ok(await pagina.locator('#lista-semana-card').isHidden(), 'com 1 ou 2 itens o cartão não aparece (não empurra o total)');
  await pagina.click('#btn-fechar-sacola'); await pagina.waitForTimeout(400);
  await pagina.locator('#lista-produtos .produto-card[data-id="tomate"] .modo-btn.principal').click();
  await pagina.locator('#btn-carrinho-mobile').click();
  await pagina.waitForSelector('#lista-semana-card:not([hidden])', { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#btn-guardar-lista').innerText(), 'Guardar lista');
  await pagina.click('#btn-guardar-lista');
  await pagina.getByRole('button', { name: 'Só guardar' }).click();
  await pagina.waitForFunction(() => document.getElementById('qtd-badge')?.textContent.trim() === '0', null, { timeout: 3000 });
  await pagina.waitForSelector('#atalhos [data-action="por-lista"]', { timeout: 3000 });
  assert.match(await pagina.locator('#atalhos [data-action="por-lista"]').innerText(), /Minha lista da semana[\s\S]*3 itens/);
  await pagina.click('#atalhos [data-action="por-lista"]');
  await pagina.waitForFunction(() => document.getElementById('qtd-badge')?.textContent.trim() === '3', null, { timeout: 3000 });
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

// ---------------------------------------------------------------- IMPRESSÃO AUTOMÁTICA
// impressora de mentira no "cabo" (porta serial): guarda os bytes em window.__impresso
const impressoraFalsa = (cfg) => {
  localStorage.setItem('banca_impressora', JSON.stringify(cfg));
  window.__impresso = [];
  const porta = { writable: null, async open() { porta.writable = { getWriter: () => ({ write: async (b) => { window.__impresso.push(...b); }, releaseLock() {} }) }; } };
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { getPorts: async () => [porta], requestPort: async () => porta } });
};
const cenarioImpressao = () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const agora = new Date().toISOString(), base = { total: 14, pag: 'PIX', quadra: '1', lote: '3', data: agora, itens: [{ id: 'ovos', nome: 'Ovos caipira', qtd: 1, tipo: 'un', unidade: 'dz', subtotal: 14 }] };
  cen.lojas.banca.pedidos = {
    'ped-novo-0001': { ...base, nome: 'Cliente Novo', status: 'pendente' },
    'ped-feito-001': { ...base, nome: 'Ja Impresso', status: 'pendente', impressao: { saiu: 'inicial', saiuEm: agora, estado: 'impresso', vezes: 1 } },
    'ped-aceito-01': { ...base, nome: 'Cliente Aceito', status: 'preparando' },
  };
  return cen;
};
const textoImpresso = (p) => p.evaluate(() => String.fromCharCode(...(window.__impresso || [])));
const chamadasDaFila = () => servidor.chamadas.filter((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'impressao');

teste('impressão automática "ao chegar": pedido novo sai sozinho, reservado e confirmado na fila; já impresso não sai de novo', async () => {
  const antes = servidor.chamadas.length;
  // a impressora de mentira é configurada ANTES da página abrir
  const ctx = await navegador.newContext({ viewport: { width: 1200, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
  await ctx.addInitScript(impressoraFalsa, { modo: 'serial', largura: 80, acentos: true, auto: 'chegada', aparelho: 'ap-teste-01' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
  await p.goto(servidor.base + '/admin.html');
  await p.waitForFunction(() => /Cliente Novo/.test(String.fromCharCode(...(window.__impresso || []))), null, { timeout: 8000 });
  await p.waitForTimeout(600);
  const txt = await textoImpresso(p);
  assert.ok(/Cliente Novo/.test(txt) && /Cliente Aceito/.test(txt), 'novo e aceito (nunca impresso) saem no "ao chegar"');
  assert.ok(!/Ja Impresso/.test(txt), 'o que já saiu no papel não sai de novo');
  assert.ok(txt.indexOf('Cliente Novo') > -1 && (txt.match(/Cliente Novo/g) || []).length === 1, 'sai uma vez só');
  const fila = servidor.chamadas.slice(antes).filter((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'impressao');
  const ops = fila.filter((c) => c.corpo.pedidoId === 'ped-novo-0001').map((c) => c.corpo.op);
  assert.deepStrictEqual(ops.slice(0, 2), ['reservar', 'confirmar'], 'reserva antes de imprimir e confirma depois: ' + ops.join(','));
  assert.ok(fila.every((c) => c.corpo.aparelho === 'ap-teste-01'));
  assert.ok(!fila.some((c) => c.corpo.pedidoId === 'ped-feito-001'), 'nem pergunta à fila sobre o já impresso');
  assert.ok(/Impressão automática ligada/.test(await p.locator('#imp-auto').innerText()), 'faixa no topo diz que está ligada');
  semErros(errosP);
  await ctx.close();
});

teste('impressão automática "ao aceitar": pedido novo espera; o aceito sai; manual não imprime nada', async () => {
  for (const [auto, espera] of [['aceite', /Cliente Aceito/], ['manual', null]]) {
    const ctx = await navegador.newContext({ viewport: { width: 1200, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
    await ctx.addInitScript(impressoraFalsa, { modo: 'serial', largura: 80, acentos: true, auto, aparelho: 'ap-teste-02' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
    await p.goto(servidor.base + '/admin.html');
    if (espera) await p.waitForFunction(() => /Cliente Aceito/.test(String.fromCharCode(...(window.__impresso || []))), null, { timeout: 8000 });
    await p.waitForTimeout(1500);
    const txt = await textoImpresso(p);
    if (espera) assert.ok(espera.test(txt) && !/Cliente Novo/.test(txt), `${auto}: só o aceito sai\n${txt}`);
    else { assert.strictEqual(txt, '', 'manual: nada sai sozinho'); assert.ok(await p.locator('#imp-auto').isHidden(), 'manual: sem faixa'); }
    assert.deepStrictEqual(errosP, []);
    await ctx.close();
  }
});

teste('pedido do WhatsApp: depois de imprimir e tocar em "Agora não", sair da tela e voltar encontra o campo limpo', async () => {
  const ctx = await navegador.newContext({ ...CELULAR });
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
  await ctx.addInitScript(impressoraFalsa, { modo: 'ponte', largura: 80, acentos: true, auto: 'manual', aparelho: 'ap-teste-08' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
  await p.goto(servidor.base + '/admin.html');
  await p.waitForTimeout(800);
  await p.click('#btn-mais'); await p.click('#btn-impressora');
  await p.locator('#ipr-itens').waitFor({ timeout: 6000 });
  // antes de imprimir, o rascunho sobrevive a sair e voltar
  await p.fill('#ipr-itens', '2 alfaces'); await p.fill('#ipr-nome', 'Rascunho');
  await p.reload(); await p.waitForTimeout(800);
  await p.click('#btn-mais'); await p.click('#btn-impressora');
  await p.locator('#ipr-itens').waitFor({ timeout: 6000 });
  assert.strictEqual(await p.locator('#ipr-itens').inputValue(), '2 alfaces', 'rascunho não impresso continua');
  await p.click('#ipr-imprimir');
  await p.locator('#ipr-conf .iconf-convite').waitFor({ timeout: 4000 });
  await p.reload(); await p.waitForTimeout(800);
  await p.click('#btn-mais'); await p.click('#btn-impressora');
  await p.locator('#ipr-itens').waitFor({ timeout: 6000 });
  assert.strictEqual(await p.locator('#ipr-itens').inputValue(), '', 'pedido que já saiu no papel não volta');
  assert.strictEqual(await p.locator('#ipr-nome').inputValue(), '');
  assert.deepStrictEqual(errosP, []);
  await ctx.close();
});

teste('pedido do WhatsApp: imprime só o texto; depois "Conferir e registrar" casa com os produtos, registra e limpa; o próximo colado não junta com o anterior', async () => {
  const antes = servidor.chamadas.length;
  const ctx = await navegador.newContext({ ...CELULAR });
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
  await ctx.addInitScript(impressoraFalsa, { modo: 'ponte', largura: 80, acentos: true, auto: 'manual', aparelho: 'ap-teste-07' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
  await p.goto(servidor.base + '/admin.html');
  await p.waitForTimeout(800);
  await p.click('#btn-mais'); await p.click('#btn-impressora');
  await p.locator('#ipr-itens').waitFor({ timeout: 6000 });
  await p.fill('#ipr-itens', '[09:12, 21/10/2026] Viviane: 2 kg de tomatw; 3 bananas prata; 2 alfaces\n[09:13, 21/10/2026] Viviane: eu passo pegar por volta das 18 horas, so me avisar');
  await p.fill('#ipr-nome', 'Viviane'); await p.fill('#ipr-pagamento', 'pix');
  assert.strictEqual(await p.locator('#ipr-conf').isVisible(), false, 'antes de imprimir, só o papel');
  await p.click('#ipr-imprimir');
  await p.locator('#ipr-conf .iconf-convite').waitFor({ timeout: 4000 });
  assert.ok(!servidor.chamadas.slice(antes).some((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'mensagem'), 'imprimir não registra nada');
  await p.click('[data-conf="abrir"]');
  await p.locator('#ipr-conf .iconf-linha').first().waitFor({ timeout: 3000 });
  const linhas = await p.$$eval('#ipr-conf .iconf-linha', (ls) => ls.map((l) => ({ cls: l.className, prod: l.querySelector('[data-k="produto"]').selectedOptions[0].textContent.replace('★ ', ''), qtd: l.querySelector('[data-k="qtd"]')?.value || '', tipo: l.querySelector('[data-k="tipo"]')?.value || '' })));
  assert.deepStrictEqual(linhas.map((l) => [l.prod, l.qtd, l.tipo]), [['Tomate italiano', '2', 'kg'], ['Banana prata', '3', 'un'], ['Alface crespa', '2', ''], ['Recado (não entra)', '', '']], JSON.stringify(linhas));
  assert.ok(linhas[3].cls.includes('iconf-recado'));
  assert.strictEqual(await p.locator('#iconf-pag').inputValue(), 'PIX', 'pagamento do campo de cima');
  if (process.env.PRINT_CONF) { await p.locator('#ipr-conf').scrollIntoViewIfNeeded(); await p.locator('#ipr-conf').screenshot({ path: process.env.PRINT_CONF }); }
  const largura = await p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(largura <= 392, `a conferência passou da largura do celular (${largura}px)`);
  // troca a banana para "kg" com 1,5: o valor da linha muda na hora
  const ban = p.locator('#ipr-conf .iconf-linha').nth(1);
  await ban.locator('[data-k="tipo"]').selectOption('kg');
  await p.locator('#ipr-conf .iconf-linha').nth(1).locator('[data-k="qtd"]').fill('1,5');
  await p.locator('#ipr-conf .iconf-linha').nth(1).locator('[data-k="qtd"]').dispatchEvent('change');
  assert.match(await p.locator('#ipr-conf .iconf-linha').nth(1).locator('.iconf-valor').innerText(), /10,35/, '1,5 kg × 6,90');
  await p.click('[data-conf="registrar"]');
  await p.waitForFunction(() => document.getElementById('ipr-conf').hidden, null, { timeout: 4000 });
  const reg = servidor.chamadas.slice(antes).filter((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'mensagem').pop();
  assert.ok(reg, 'registrou');
  assert.deepStrictEqual(reg.corpo.itens, [{ id: 'tomate', tipo: 'kg', qtd: 2 }, { id: 'banana', tipo: 'kg', qtd: 1.5 }, { id: 'alface', tipo: 'un', qtd: 2 }]);
  assert.strictEqual(reg.corpo.pag, 'PIX'); assert.strictEqual(reg.corpo.cliente.nome, 'Viviane'); assert.match(reg.corpo.obs, /passo pegar/, 'o recado vai na observação');
  assert.strictEqual(await p.locator('#ipr-itens').inputValue(), '', 'tela limpa para o próximo pedido');
  // imprime um, cola outro: o novo SUBSTITUI o anterior
  await p.fill('#ipr-itens', '1 alface'); await p.fill('#ipr-nome', 'Primeiro');
  await p.click('#ipr-imprimir'); await p.locator('#ipr-conf .iconf-convite').waitFor({ timeout: 4000 });
  await p.locator('#ipr-itens').focus();
  await p.evaluate(() => { const t = document.getElementById('ipr-itens'); t.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: false })); t.value += '2 kg de tomate'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.strictEqual(await p.locator('#ipr-itens').inputValue(), '2 kg de tomate', 'o pedido anterior saiu');
  assert.strictEqual(await p.locator('#ipr-nome').inputValue(), '', 'o nome do anterior também');
  semErros(errosP); await ctx.close();
});

teste('celular da banca (app Ponte): este painel não imprime sozinho, mostra o celular e o "Cupom" vai para a fila dele', async () => {
  const antes = servidor.chamadas.length;
  const ctx = await navegador.newContext({ viewport: { width: 1200, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
  await ctx.addInitScript(impressoraFalsa, { modo: 'ponte', largura: 80, acentos: true, auto: 'chegada', aparelho: 'ap-teste-03' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
  await p.goto(servidor.base + '/admin.html');
  await p.waitForFunction(() => /pelo celular da banca/.test(document.getElementById('imp-auto')?.innerText || ''), null, { timeout: 8000 });
  await p.waitForTimeout(800);
  assert.strictEqual(await textoImpresso(p), '', 'quem imprime é o celular da banca, não este painel');
  assert.ok(!servidor.chamadas.slice(antes).some((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'impressao'), 'nem reserva na fila');
  // a tela "Impressora" mostra o celular
  await p.click('#btn-mais'); await p.click('#btn-impressora');
  await p.locator('#ipr-status.ok').waitFor({ timeout: 4000 });
  assert.ok(/Moto G/.test(await p.locator('#ipr-status').innerText()), 'a faixa mostra o celular da banca');
  await p.click('#ipr-tab-ajustes');
  await p.locator('.imp-ponte-card').waitFor({ timeout: 4000 });
  const tela = await p.locator('#imp-corpo').innerText();
  assert.ok(/Moto G/.test(tela) && /Conectado/.test(tela) && /Impressora funcionando/.test(tela), tela);
  await p.locator('#imp-corpo select[data-campo="copias"]').selectOption('2');
  await p.waitForTimeout(500);
  const cfg = servidor.chamadas.slice(antes).filter((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'ponte' && c.corpo.op === 'config').pop();
  assert.ok(cfg && cfg.corpo.ponteId === 'pt0123456789abcdef' && cfg.corpo.cfg.copias === 2, 'vias do celular salvas no servidor');
  // pedido que chegou pelo WhatsApp: colado, sai no celular da banca sem o carimbo do WhatsApp nem emoji
  await p.click('#ipr-tab-whats');
  await p.fill('#ipr-itens', '[09:12, 16/10/2026] Dona Rosa: 2 kg de tomate 🍅\n- 1 alface crespa');
  await p.fill('#ipr-nome', 'Dona Rosa');
  assert.ok(/Dona Rosa/.test(await p.locator('#ipr-previa').innerText()) && /1 alface crespa/.test(await p.locator('#ipr-previa').innerText()), 'o papel ao lado mostra o pedido');
  await p.click('[data-vias="1"]');
  await p.click('#ipr-imprimir');
  await p.waitForTimeout(500);
  const avulso = servidor.chamadas.slice(antes).filter((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'ponte' && c.corpo.op === 'imprimir').pop();
  assert.ok(avulso, 'pedido do WhatsApp foi para o celular da banca');
  const papelAvulso = JSON.stringify(avulso.corpo.folhas);
  assert.ok(/Pedido do WhatsApp/.test(papelAvulso) && /2 kg de tomate/.test(papelAvulso) && !/09:12/.test(papelAvulso) && !/🍅/.test(papelAvulso), papelAvulso);
  assert.strictEqual(avulso.corpo.copias, 2, 'duas vias');
  assert.ok(!avulso.corpo.pedidoId, 'não conta como pedido do sistema');
  // foto: vira imagem em preto e branco e vai como bytes para o celular
  await p.click('#ipr-tab-foto');
  await p.setInputFiles('#ipr-galeria', { name: 'lista.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAAAAAB7tgMBAAAAIUlEQVR4nGN4TSRgGFVIRYVy+AEtFVLfM8NK4WjMDGGFAEcNuMzg6iY5AAAAAElFTkSuQmCC', 'base64') });
  await p.locator('#ipr-canvas:not([hidden])').waitFor({ timeout: 4000 });
  await p.click('#ipr-imprimir');
  await p.waitForTimeout(500);
  const foto = servidor.chamadas.slice(antes).filter((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'ponte' && c.corpo.op === 'imprimir').pop();
  assert.ok(foto && typeof foto.corpo.bytes === 'string' && foto.corpo.bytes.length > 100 && !foto.corpo.folhas, 'foto foi como imagem');
  assert.ok(Buffer.from(foto.corpo.bytes, 'base64').includes(Buffer.from([0x1d, 0x76, 0x30, 0x00])), 'comando de imagem da térmica');
  await p.locator('.tab[data-aba="relatorios"]').click();
  await p.locator('.card-pedido').first().waitFor({ timeout: 8000 });
  // "Cupom" num pedido: vai para o servidor (fila do celular), com o pedido e o nome do cliente
  await cartao(p, 'Cliente Novo').locator('[data-tipo="cupom"]').click();
  await p.waitForTimeout(600);
  const env = servidor.chamadas.slice(antes).filter((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'ponte' && c.corpo.op === 'imprimir').pop();
  assert.ok(env, 'mandou para o celular da banca');
  assert.strictEqual(env.corpo.pedidoId, 'ped-novo-0001'); assert.strictEqual(env.corpo.tipo, 'cupom');
  assert.ok(JSON.stringify(env.corpo.folhas).includes('Cliente Novo'));
  assert.ok(!servidor.chamadas.slice(antes).some((c) => c.caminho === '/api/pdv' && c.corpo.acao === 'impressao' && c.corpo.op === 'confirmar'), 'o servidor marca impresso quando o celular confirmar, não o painel');
  assert.strictEqual(await textoImpresso(p), '');
  semErros(errosP);
  await ctx.close();
});

teste('dois celulares da banca: a faixa mostra cada um; atalho dos rótulos abre a tela de rótulos', async () => {
  doisCelulares = true;
  try {
    const ctx = await navegador.newContext({ viewport: { width: 1200, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
    await ctx.addInitScript(impressoraFalsa, { modo: 'ponte', largura: 80, acentos: true, auto: 'chegada', aparelho: 'ap-teste-04' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
    await p.goto(servidor.base + '/admin.html');
    await p.click('#btn-mais'); await p.click('#btn-impressora');
    await p.locator('#ipr-status .ipr-cel').nth(1).waitFor({ timeout: 4000 });
    const faixa = await p.locator('#ipr-status').innerText();
    assert.ok(/Moto G/.test(faixa) && /Samsung da casa/.test(faixa) && /sem contato/.test(faixa), faixa);
    assert.ok(await p.locator('#ipr-status.ok').count(), 'um com contato: a faixa fica verde');
    assert.strictEqual(await p.locator('.ipr-cel.ok').count(), 1); assert.strictEqual(await p.locator('.ipr-cel.erro').count(), 1);
    // o atalho dos rótulos aparece para o dono e abre a tela
    await p.locator('#ipr-mais:not([hidden])').waitFor({ timeout: 2000 });
    await p.click('#ipr-mais [data-action="rotulos"]');
    await p.locator('#modal-rotulos').waitFor({ state: 'visible', timeout: 4000 });
    await p.keyboard.press('Escape');
    await p.click('#ipr-tab-ajustes');
    assert.ok(await p.locator('#ipr-mais').isHidden(), 'nos ajustes o atalho some');
    semErros(errosP);
    await ctx.close();
  } finally { doisCelulares = false; }
});

teste('produtos no painel: botões de categoria filtram a lista e "Selecionar vários" marca "chegou hoje" de uma vez', async () => {
  const cen = cenarioImpressao();
  Object.assign(cen.lojas.banca.produtos, {
    oregano: { nome: 'Orégano', preco: 3, unidade: 'un', cat: 'temperos', ativo: false },
    colorau: { nome: 'Colorau', preco: 3, unidade: 'un', cat: 'temperos', ativo: true },
  });
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript((c) => { window.__CENARIO = c; }, cen);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
  await p.goto(servidor.base + '/admin.html');
  await p.locator('#pl-cats [data-pl-cat="temperos"]').waitFor({ timeout: 8000 });
  assert.ok(/Temperos\s*2/.test(await p.locator('#pl-cats [data-pl-cat="temperos"]').innerText()), 'temperos com 2 produtos');
  await p.click('#pl-cats [data-pl-cat="temperos"]');
  const nomes = await p.locator('#lista-produtos .pl-txt b').allInnerTexts();
  assert.deepStrictEqual(nomes, ['Colorau', 'Orégano'], 'só os temperos');
  assert.ok(/Temperos/.test(await p.locator('#pl-cabeca').innerText()));
  // comprei tempero hoje: marca os dois e "Chegou hoje" põe na loja com o selo
  await p.click('[data-pl-sel="ligar"]');
  assert.ok(await p.locator('#pl-lote').isVisible(), 'barra dos marcados aparece');
  await p.click('[data-pl-sel="todos"]');
  assert.ok(/2 marcados/.test(await p.locator('#pl-lote').innerText()));
  await p.click('[data-pl-lote="chegou"]');
  await p.waitForFunction(() => (window.__gravados || []).filter((g) => g.lote).length === 2, null, { timeout: 4000 });
  const g = await p.evaluate(() => window.__gravados.filter((x) => x.lote));
  assert.deepStrictEqual(g.map((x) => x.path.split('/').pop()).sort(), ['colorau', 'oregano']);
  assert.ok(g.every((x) => x.dados.ativo === true && typeof x.dados.chegouEm === 'string' && x.dados.chegouEm.length === 10), JSON.stringify(g));
  assert.ok(await p.locator('#pl-lote').isHidden(), 'depois de salvar, sai da seleção');
  // tocar na linha volta a abrir o produto
  assert.ok(await p.locator('#lista-produtos [data-action="editar-produto"]').count() === 2);
  await p.click('#pl-cats [data-pl-cat="__todas__"]');
  assert.ok((await p.locator('#lista-produtos .pl-item').count()) >= 6, 'todos de novo');
  semErros(errosP);
  await ctx.close();
});

teste('aparelho novo da equipe (nunca escolheu como imprimir) passa a mandar para o celular da banca; quem escolheu fica', async () => {
  for (const [inicial, espera] of [[null, 'ponte'], [{ modo: 'sistema', modoEscolhido: true }, 'sistema'], [{ modo: 'bluetooth' }, 'bluetooth']]) {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
    if (inicial) await ctx.addInitScript((c) => localStorage.setItem('banca_impressora', JSON.stringify(c)), inicial);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
    await p.goto(servidor.base + '/admin.html');
    await p.waitForTimeout(2500);
    const modo = await p.evaluate(() => (JSON.parse(localStorage.getItem('banca_impressora') || '{}').modo || 'sistema'));
    assert.strictEqual(modo, espera, JSON.stringify(inicial));
    semErros(errosP);
    await ctx.close();
  }
});

// o servidor de mentira do app Ponte: um celular ligado, com a impressora funcionando
teste('celular da banca com horário: fora dele aparece "desligado pelo horário" (não erro) e o horário muda pelo painel', async () => {
  celularDescansando = true;
  try {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.addInitScript((c) => { window.__CENARIO = c; }, cenarioImpressao());
    await ctx.addInitScript(impressoraFalsa, { modo: 'ponte', largura: 80, acentos: true, auto: 'chegada', aparelho: 'ap-teste-05' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage(), errosP = []; p.on('pageerror', (e) => errosP.push(e.message));
    await p.goto(servidor.base + '/admin.html');
    await p.click('#btn-mais'); await p.click('#btn-impressora');
    await p.waitForFunction(() => /desligado pelo horário/i.test((document.getElementById('ipr-status') || {}).innerText || ''), null, { timeout: 5000 });
    const faixa = await p.locator('#ipr-status').innerText();
    assert.ok(/06:00/.test(faixa) && !/sem contato/i.test(faixa), faixa);
    assert.strictEqual(await p.locator('#ipr-status.erro').count(), 0, 'desligado de propósito não fica vermelho');
    await p.click('#ipr-tab-ajustes');
    const desl = p.locator('input[data-campo="desligarAs"]');
    await desl.waitFor({ timeout: 4000 });
    assert.strictEqual(await p.locator('input[data-campo="ligarAs"]').inputValue(), '06:00');
    assert.strictEqual(await desl.inputValue(), '13:30');
    assert.ok(/Desligado pelo horário · liga às 06:00/.test(await p.locator('.imp-ponte-card').innerText()));
    const antes = servidor.chamadas.length;
    await desl.fill('15:00'); await desl.dispatchEvent('change');
    await p.waitForFunction(() => true, null, { timeout: 500 }).catch(() => {});
    await p.waitForTimeout(400);
    const env = servidor.chamadas.slice(antes).find((c) => c.caminho === '/api/pdv' && c.corpo.op === 'config');
    assert.ok(env && env.corpo.cfg && env.corpo.cfg.desligarAs === '15:00', 'o horário novo vai para o servidor: ' + JSON.stringify(env && env.corpo));
    semErros(errosP); await ctx.close();
  } finally { celularDescansando = false; }
});

// (com doisCelulares, aparece também um segundo, sem contato desde ontem)
let doisCelulares = false;
const outroCelular = () => ({ id: 'ptfedcba9876543210', nome: 'Samsung da casa', criadoEm: new Date(Date.now() - 3 * 864e5).toISOString(), visto: new Date(Date.now() - 864e5).toISOString(), online: false, impressora: { estado: 'ok', nome: 'MP-58', msg: '' }, app: { versao: '1.0.9' }, cfg: { auto: 'chegada', largura: 58, acentos: true, copias: 1, autoEtiqueta: false, autoPesado: false, autoCancelado: true } });
// (com celularDescansando, só existe um celular, desligado pelo horário 06:00–13:30)
let celularDescansando = false;
const descansando = () => ({ id: 'pt0123456789abcdef', nome: 'Moto G', criadoEm: new Date(Date.now() - 864e5).toISOString(), visto: new Date(Date.now() - 2 * 3600e3).toISOString(), online: false, foraDoHorario: true, impressora: { estado: 'ok', nome: 'GS-FJ80M', msg: '' }, app: { versao: '1.0.12' }, cfg: { auto: 'chegada', largura: 80, acentos: true, copias: 1, autoEtiqueta: false, autoPesado: false, autoCancelado: true, ligarAs: '06:00', desligarAs: '13:30' } });
const ponteFalsa = (c) => (c.op === 'listar' && celularDescansando ? { sucesso: true, pontes: [descansando()] } : c.op === 'listar' ? { sucesso: true, pontes: [{ id: 'pt0123456789abcdef', nome: 'Moto G', criadoEm: new Date().toISOString(), visto: new Date().toISOString(), online: true, impressora: { estado: 'ok', nome: 'GS-FJ80M', msg: '' }, app: { versao: '1.0.1' }, cfg: { auto: 'chegada', largura: 80, acentos: true, copias: 1, autoEtiqueta: false, autoPesado: false, autoCancelado: true } }, ...(doisCelulares ? [outroCelular()] : [])] }
  : c.op === 'config' ? { sucesso: true, cfg: { auto: 'chegada', largura: 80, acentos: true, copias: 2, autoEtiqueta: false, autoPesado: false, autoCancelado: true }, pulados: 0 }
  : c.op === 'imprimir' ? { sucesso: true, id: 'im-teste-1', online: true, visto: new Date().toISOString() } : { sucesso: true });

// ------------------------------------------------------------------ cadastro rápido de produtos
const cenarioPastelaria = () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const prod = (nome, cat, preco, unidade = 'un') => ({ nome, preco, unidade, cat, ativo: true });
  cen.lojas.banca.ficha = { ...cen.lojas.banca.ficha, tipo: 'Pastel e açaí', campos: { duracao: false } };
  cen.lojas.banca.produtos = { q: prod('Pastel de queijo', 'pasteis', 15), c: prod('Pastel de calabresa', 'pasteis', 15), e: prod('Pastel especial', 'pasteis', 18), a: prod('Açaí 300 ml', 'acai', 16), b: prod('Banana', 'frutas', 6, 'kg'), m: prod('Maçã', 'frutas', 9, 'kg'), l: prod('Laranja', 'frutas', 5, 'kg') };
  cen.lojas.banca.categorias = [{ chave: 'pasteis', nome: 'Pastéis', ordem: 1 }, { chave: 'acai', nome: 'Açaí', ordem: 2 }, { chave: 'frutas', nome: 'Frutas', ordem: 3 }];
  return cen;
};
const gravadosDe = (pagina, re) => pagina.evaluate((r) => (window.__gravados || []).filter((g) => new RegExp(r).test(g.path)).map((g) => g.dados), re.source);

teste('painel: produto novo já vem na categoria aberta e na unidade dela; "Salvar e criar outro igual" e Enter só trocam o nome; campo desligado pela plataforma some', async () => {
  const { pagina, erros, fechar } = await abrir('/admin.html', cenarioPastelaria(), { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false, hasTouch: false } });
  await pagina.locator('#pl-cats [data-pl-cat="pasteis"]').click({ timeout: 8000 });
  await pagina.locator('[data-action="novo-produto"]').click();
  await pagina.waitForFunction(() => document.activeElement && document.activeElement.id === 'edit-nome', null, { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#edit-cat').inputValue(), 'Pastéis');
  assert.strictEqual(await pagina.locator('#cat-chips .prod-chip.on').innerText(), 'Pastéis');
  assert.strictEqual(await pagina.locator('#unidade-chips .prod-chip.on').innerText(), 'Unidade', 'em Pastéis tudo é unidade (e não quilo)');
  assert.match(await pagina.locator('#edit-preco').getAttribute('placeholder'), /15,00.*Pastéis/);
  assert.ok(!(await pagina.locator('#edit-duracao').isVisible()), 'gaveta "Mais opções" fechada');
  await pagina.locator('#prod-mais > summary').click();
  assert.ok(!(await pagina.locator('#edit-duracao').isVisible()), '"Quanto tempo dura" desligado pela plataforma nesta loja');
  assert.ok(await pagina.locator('#edit-preco-de').isVisible(), 'oferta continua');
  assert.ok(!/quanto dura/.test(await pagina.locator('#prod-mais-resumo').innerText()));
  // primeiro: escreve nome e preço e toca em "Salvar e criar outro igual"
  await pagina.fill('#edit-nome', 'Pastel de pizza'); await pagina.fill('#edit-preco', '15');
  await pagina.click('#btn-salvar-outro');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /^produtos\//.test(g.path) && g.dados.nome === 'Pastel de pizza'), null, { timeout: 4000 });
  assert.ok(await pagina.locator('#modal-produto').evaluate((m) => m.classList.contains('aberto')), 'o formulário continua aberto');
  assert.strictEqual(await pagina.locator('#edit-nome').inputValue(), ''); assert.strictEqual(await pagina.locator('#edit-preco').inputValue(), '15');
  assert.match(await pagina.locator('#prod-repetindo').innerText(), /Pastel de pizza guardado/);
  // segundo: só o nome e Enter
  await pagina.fill('#edit-nome', 'Pastel de frango'); await pagina.press('#edit-nome', 'Enter');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /^produtos\//.test(g.path) && g.dados.nome === 'Pastel de frango'), null, { timeout: 4000 });
  const novos = (await gravadosDe(pagina, /^produtos\//)).filter((d) => /pizza|frango/.test(d.nome));
  assert.strictEqual(novos.length, 2);
  for (const d of novos) { assert.strictEqual(d.preco, 15); assert.strictEqual(d.unidade, 'un'); assert.strictEqual(d.cat, 'pasteis'); assert.strictEqual(d.ativo, true); }
  const caminhos = await pagina.evaluate(() => window.__gravados.filter((g) => /^produtos\//.test(g.path)).map((g) => g.path));
  assert.strictEqual(new Set(caminhos).size, caminhos.length, 'cada um é um produto novo (não regrava o anterior)');
  assert.match(await pagina.locator('#prod-repetindo').innerText(), /2 nesta leva/);
  // "Criar outro parecido" a partir de um produto aberto
  await pagina.locator('[data-fechar="modal-produto"]').click();
  await pagina.locator('[data-action="editar-produto"][data-id="e"]').click();
  assert.ok(await pagina.locator('#btn-duplicar').isVisible()); assert.ok(!(await pagina.locator('#btn-salvar-outro').isVisible()));
  await pagina.click('#btn-duplicar');
  assert.strictEqual(await pagina.locator('#edit-id').inputValue(), ''); assert.strictEqual(await pagina.locator('#edit-nome').inputValue(), '');
  assert.strictEqual(await pagina.locator('#edit-preco').inputValue(), '18'); assert.match(await pagina.locator('#prod-repetindo').innerText(), /Copiado de Pastel especial/);
  // categoria de quilo: num produto novo, tocar em Frutas troca a unidade para Quilo
  await pagina.locator('[data-fechar="modal-produto"]').click();
  await pagina.locator('#pl-cats [data-pl-cat="__todas__"]').first().click();
  await pagina.locator('[data-action="novo-produto"]').click();
  await pagina.locator('#cat-chips [data-cat-nome="Frutas"]').click();
  assert.strictEqual(await pagina.locator('#unidade-chips .prod-chip.on').innerText(), 'Quilo');
  await pagina.locator('#unidade-chips [data-unidade="un"]').click();
  await pagina.locator('#cat-chips [data-cat-nome="Açaí"]').click();
  assert.strictEqual(await pagina.locator('#unidade-chips .prod-chip.on').innerText(), 'Unidade', 'escolheu a unidade na mão: trocar a categoria não muda mais');
  semErros(erros); await fechar();
});

teste('painel: "Vários de uma vez" cria os pastéis com o mesmo preço (preço diferente depois do traço) e "Mudar preço" muda os marcados', async () => {
  const { pagina, erros, fechar } = await abrir('/admin.html', cenarioPastelaria(), { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('#pl-cats [data-pl-cat="pasteis"]').click({ timeout: 8000 });
  await pagina.locator('[data-action="varios-produtos"]').click();
  await pagina.waitForSelector('#modal-varios.aberto', { timeout: 4000 }); await pagina.waitForTimeout(120);   // o foco automático da janela chega depois de 60 ms
  assert.strictEqual(await pagina.locator('#vv-cats .prod-chip.on').innerText(), 'Pastéis');
  assert.strictEqual(await pagina.locator('#vv-unidades .prod-chip.on').innerText(), 'Unidade');
  assert.strictEqual(await pagina.locator('#vv-preco').inputValue(), '15,00', 'sugere o preço mais comum dos pastéis');
  await pagina.fill('#vv-lista', 'Pastel de carne\nPastel de palmito - 17,50\nPastel de queijo\n\nPastel de carne');
  const previa = await pagina.locator('#vv-previa').innerText();
  assert.match(previa, /Pastel de palmito[\s\S]*17,50/); assert.match(previa, /já cadastrado/); assert.match(previa, /repetido na lista/);
  assert.strictEqual(await pagina.locator('#vv-criar').innerText(), 'Criar 2 produtos');
  await pagina.click('#vv-criar');
  await pagina.waitForFunction(() => (window.__gravados || []).filter((g) => g.lote && /^produtos\//.test(g.path)).length === 2, null, { timeout: 4000 });
  const criados = await pagina.evaluate(() => window.__gravados.filter((g) => g.lote && /^produtos\//.test(g.path)).map((g) => g.dados));
  assert.deepStrictEqual(criados.map((d) => [d.nome, d.preco, d.unidade, d.cat, d.ativo]), [['Pastel de carne', 15, 'un', 'pasteis', true], ['Pastel de palmito', 17.5, 'un', 'pasteis', true]]);
  assert.ok(!(await pagina.locator('#modal-varios').evaluate((m) => m.classList.contains('aberto'))), 'fecha depois de criar');
  // preço de vários: marca dois pastéis e põe 16
  await pagina.locator('[data-pl-sel="ligar"]').click();
  await pagina.locator('[data-pl-marcar="q"]').click(); await pagina.locator('[data-pl-marcar="c"]').click();
  await pagina.locator('[data-pl-sel="preco"]').click();
  await pagina.fill('#pl-lote-preco', '16'); await pagina.press('#pl-lote-preco', 'Enter');
  await pagina.waitForFunction(() => (window.__gravados || []).filter((g) => g.lote && /^produtos\/(q|c)$/.test(g.path)).length === 2, null, { timeout: 4000 });
  const precos = await pagina.evaluate(() => window.__gravados.filter((g) => g.lote && /^produtos\/(q|c)$/.test(g.path)).map((g) => [g.path, g.dados.preco, g.dados.precoDe]));
  assert.deepStrictEqual(precos.sort(), [['produtos/c', 16, null], ['produtos/q', 16, null]]);
  semErros(erros); await fechar();
});

(async () => {
  servidor = await subir({
    // pesagem (de mentira): devolve o pedido pesado como o api/pdv.js de verdade
    '/api/pdv': (c) => (c.acao === 'impressao' ? { sucesso: true, ok: true } : c.acao === 'ponte' ? ponteFalsa(c) : c.acao === 'mensagem' ? { sucesso: true, id: c.chave, total: 24.3, itens: c.itens.length, aPesar: c.itens.filter((i) => i.id === 'banana' && i.tipo === 'un').length } : c.acao === 'pesagem' ? { sucesso: true, total: 0, desconto: 7.92, entrega: 0, itens: [{ id: 'tomate', nome: 'Tomate italiano', qtd: 2, tipo: 'un', unidade: 'kg', aPesar: false, pesoFinal: 0.8, precoOriginal: 9.9, subtotal: 7.92 }] } : {}),
    // ranking (de mentira) da banca, ao contrário da ordem do cadastro, chegando 1,5 s depois
    '/api/analytics': (c) => (c.acao === 'painel' ? (c.atualizar
        // com "atualizar" o servidor confere pedido novo e recalcula: demora 2 s e traz 1 cliente a mais
        ? new Promise((ok) => setTimeout(() => ok({ sucesso: true, meta: { geradoEm: '2026-10-26T15:00:00.000Z' }, indiceClientes: [{ id: 'c1', nome: 'Ana Lima', condominio: 'Alfa', quadra: '1', lote: '2', n: 2, ult: '2026-10-20', pri: '2026-09-01', gasto: 50 }, { id: 'c2', nome: 'Bruno Reis', condominio: 'Alfa', quadra: '3', lote: '4', n: 1, ult: '2026-10-25', pri: '2026-10-25', gasto: 20 }] }), 2000))
        : { sucesso: true, meta: { geradoEm: '2026-10-26T10:00:00.000Z' }, indiceClientes: [{ id: 'c1', nome: 'Ana Lima', condominio: 'Alfa', quadra: '1', lote: '2', n: 2, ult: '2026-10-20', pri: '2026-09-01', gasto: 50 }] })
      : c.acao === 'ranking' ? new Promise((ok) => setTimeout(() => ok({ sucesso: true, nivel: 'popular', itens: ['ovos', 'banana', 'alface', 'tomate'].map((id, i) => ({ id, p: 0.9 - i * 0.2 })) }), 1500)) : {}),
    '/api/checkout': (c) => (c.acao ? {} : { sucesso: true, temConta: false, pedido: { id: 'PED123', total: 14, paraHoje: true, whatsapps: [{ nome: 'Banca', url: 'https://wa.me/5562999990000?text=Pedido' }] } }),
    '/api/plataforma': (c) => (c.acao === 'situacao' ? { sucesso: true, temDono: true, souEu: true }
      : c.acao === 'erros' ? { sucesso: true, erros: [{ id: 'e1', assinatura: 'e'.repeat(20), tipo: 'erro', msg: "Cannot read properties of undefined (reading 'preco')", vezes: 3, ultimo: new Date().toISOString(), onde: '/assets/main-X.js:10:5', paginas: ['/'], navegadores: ['Android · Chrome 129'], lojas: ['banca'], pilha: 'at x' },
        { id: 'v1', assinatura: 'a'.repeat(20), tipo: 'visual', msg: 'Texto cortado ou vazando: faixa › card de produto › preço', vezes: 12, dias: ['2026-10-22', '2026-10-23'], telas: ['320px · letra 200%', '375px · letra 150%'], ultimo: new Date().toISOString(), onde: '.faixa-rolo .produto-card .etq-preco', paginas: ['/'], navegadores: ['iPhone · Safari 17'], lojas: ['banca'], pilha: 'cortado sem "..."' },
        { id: 'v2', assinatura: 'b'.repeat(20), tipo: 'visual', msg: 'Tem algo por cima: botão Adicionar', vezes: 2, telas: ['390px · letra 100%'], ultimo: new Date().toISOString(), corrigidoEm: '2026-10-20T10:00:00.000Z', voltou: true, onde: '#lista-produtos .card-add', paginas: ['/'], navegadores: ['Android · Chrome 129'], lojas: ['banca'] },
        { id: 'v3', assinatura: 'c'.repeat(20), tipo: 'visual', msg: 'Foto que não abriu: foto', vezes: 1, ultimo: '2026-10-19T10:00:00.000Z', corrigidoEm: '2026-10-20T10:00:00.000Z', voltou: false, onde: '#lista-produtos img', paginas: ['/'], navegadores: ['Android · Chrome 129'], lojas: ['banca'] }] }
      : c.acao === 'erro-estado' ? { sucesso: true, estado: c.estado, em: new Date().toISOString() }
      : c.acao === 'lojas' ? { sucesso: true, lojas: [{ id: 'banca', nome: 'Banca Adair e Pedrina', ativo: true, original: true, donos: ['dona@teste.com'], cor: '#1a3a2a', modulos: {}, campos: {}, mes: { receita: 0, pedidos: 0 } }], modulos: {}, campos: {}, feiras: [{ id: 'feira-do-bairro', nome: 'Feira do Bairro', dias: [2], lojas: ['banca'], condominiosIds: [] }, { id: 'feira-do-lago', nome: 'Feira do Lago', dias: [4], lojas: ['banca'], condominiosIds: [] }], condominios: [], pix: false, fotos: false } : {}),
  });
  navegador = await chromium.launch();
  let falhas = 0;
  // SO_TESTE="trecho|outro trecho" roda só os testes cujo nome combina (para conferir um de cada vez)
  for (const [nome, fn] of testes.filter(([n]) => !process.env.SO_TESTE || new RegExp(process.env.SO_TESTE).test(n))) {
    try { await fn(); console.log('  ok    ' + nome); }
    catch (e) { falhas++; console.log('  FALHOU ' + nome + '\n         ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n         ')); }
  }
  await navegador.close(); servidor.srv.close();
  console.log(`\n${testes.length - falhas} de ${testes.length} testes de tela passaram.`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('Não consegui rodar os testes de tela:', e); process.exit(1); });

// ------------------------------------------------------------------ MONTAR PEDIDO
const cenarioAcai = () => {
  const cen = cenarioPastelaria();
  cen.lojas.banca.produtos.a = { nome: 'Açaí 300 ml', preco: 16, unidade: 'un', cat: 'acai', ativo: true, montar: { grupos: [
    { id: 'tam', nome: 'Calda', min: 1, max: 1, opcoes: [{ id: 'mor', nome: 'Morango', preco: 0 }, { id: 'cho', nome: 'Chocolate', preco: 0 }] },
    { id: 'comp', nome: 'Complementos', min: 0, max: 3, gratis: 2, opcoes: [{ id: 'gra', nome: 'Granola', preco: 1 }, { id: 'ban', nome: 'Banana', preco: 2 }, { id: 'nut', nome: 'Nutella', preco: 4 }, { id: 'kiw', nome: 'Kiwi', preco: 3, ativo: false }] },
  ] } };
  return cen;
};

// mede TODO texto visível dentro da janela aberta contra o fundo de verdade atrás dele (primeiro ancestral com fundo opaco)
const textosIlegiveis = (pagina, sel) => pagina.evaluate((sel) => {
  const lum = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const cor = (s) => { const n = (s.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(s) ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const fundoDe = (el) => { for (let e = el; e; e = e.parentElement) { const c = cor(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.85) && getComputedStyle(e).backgroundImage === 'none') return c; if (getComputedStyle(e).backgroundImage !== 'none' && e !== el) return null; } return [255, 255, 255]; };
  const ruins = [];
  document.querySelectorAll(`${sel} *`).forEach((el) => {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (!txt || !el.getClientRects().length) return;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const f = fundoDe(el); if (!f) return;
    const c = cor(cs.color), a = lum(c), b = lum(f), k = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (k < 3) ruins.push(`"${txt.slice(0, 30)}" ${k.toFixed(1)}`);
  });
  return ruins;
}, sel);

teste('tema de card escuro em página clara: as janelas do produto e do montar ficam legíveis (nome, tamanhos, quantidades)', async () => {
  const cen = cenarioAcai();
  cen.lojas.banca.ficha.tema = { primaria: '#1c201f', destaque: '#ffde59', fundo: '#fbf4e2', superficie: '#1c1d1f', texto: '#1c201f', botao: '#fbe27a', etiqueta: 'selo' };
  const { pagina, erros, fechar } = await abrir('/', cen);
  await cards(pagina).first().waitFor({ timeout: 8000 }); await pagina.waitForTimeout(500);
  // produto comum
  const comum = cards(pagina).filter({ hasNot: pagina.locator('text=Açaí') }).first();
  await comum.locator('.produto-nome').click();
  await pagina.waitForSelector('#modal-detalhe-produto.aberto', { timeout: 4000 }); await pagina.waitForTimeout(500);
  if (process.env.FOTO) await pagina.screenshot({ path: '/tmp/moe/md.png' });
  let ruins = await textosIlegiveis(pagina, '#modal-detalhe-produto .modal');
  assert.ok(!ruins.length, 'texto ilegível na janela do produto: ' + ruins.join(' | '));
  await pagina.keyboard.press('Escape'); await pagina.waitForTimeout(400);
  // montar (tamanho)
  await cards(pagina).filter({ hasText: 'Açaí' }).first().locator('.produto-nome').click();
  await pagina.waitForSelector('.mt-overlay.aberto', { timeout: 4000 }); await pagina.waitForTimeout(500);
  if (process.env.FOTO) await pagina.screenshot({ path: '/tmp/moe/mt.png' });
  ruins = await textosIlegiveis(pagina, '.mt-overlay .mt-modal');
  assert.ok(!ruins.length, 'texto ilegível na tela de montar: ' + ruins.join(' | '));
  semErros(erros); await fechar();
});

teste('tema de card escuro + seção colorida no jeito "faixa": o nome do produto (card claro da seção) continua legível', async () => {
  const c = cenarioPadrao();
  const prod = (nome, cat, preco = 15) => ({ nome, preco, unidade: 'un', cat, ativo: true });
  c.lojas.cremes = { ficha: { nome: 'Cremes e Sucos', ativo: true, tipo: 'Açaí', tema: { primaria: '#1c201f', destaque: '#ffde59', fundo: '#fbf4e2', superficie: '#1c1d1f', texto: '#1c201f', botao: '#fbe27a', etiqueta: 'selo' } },
    produtos: { c1: prod('Creme de açaí', 'cremes'), c2: prod('Creme de abacaxi com hortelã', 'cremes'), s1: prod('Suco de laranja', 'sucos') },
    categorias: [{ chave: 'cremes', nome: 'Cremes', ordem: 1 }, { chave: 'sucos', nome: 'Sucos', ordem: 2 }],
    config: { lojaAberta: true, diasAbertos: [0, 1, 2, 3, 4, 5, 6], minimo: 0, wpp: '5562999990000', vitrine: { secoes: [
      { cat: 'cremes', titulo: 'Cremes', texto: 'Gelados.', cor: '#f3a6b5', icone: 'tigela', estilo: 'faixa' }] } } };
  const { pagina, erros, fechar } = await abrir('/?loja=cremes', c);
  await cards(pagina).first().waitFor({ timeout: 8000 }); await pagina.waitForTimeout(700);
  const r = await pagina.evaluate(() => ({ cls: document.documentElement.classList.contains('ap-card-contraste') }));
  if (process.env.FOTO) await pagina.screenshot({ path: '/tmp/moe/secao.png' });
  assert.ok(r.cls, 'o tema de card escuro ligou a tinta própria dos cards');
  // nome, preço e "a unidade" de TODOS os cards (o botão "Adicionar" tem degradê e é medido à parte)
  for (const sel of ['.produto-card--secao', '.produto-card[data-id="s1"]']) {
    const ruins = (await textosIlegiveis(pagina, sel)).filter((x) => !/Adicionar/.test(x));
    assert.ok(!ruins.length, `texto ilegível em ${sel}: ${ruins.join(' | ')}`);
  }
  semErros(erros); await fechar();
});

teste('ajudante da pastelaria: fala do jeito da loja e a sugestão "Montar assim" abre a tela de montar já marcada', async () => {
  const cen = cenarioPadrao();
  cen.lojas.moecoe = { ficha: { nome: 'Pastel Moe Coe', ativo: true, tipo: 'Pastelaria', modulos: { ia: true } }, categorias: [{ chave: 'pasteis', nome: 'Pastéis', ordem: 1 }],
    produtos: { pc: { nome: 'Pastel', preco: 10, unidade: 'un', cat: 'pasteis', ativo: true, montar: { grupos: [
      { id: 'sabor', nome: 'Sabor', min: 1, max: 1, opcoes: [{ id: 'carne', nome: 'Carne', preco: 0 }, { id: 'frango', nome: 'Frango', preco: 0 }] },
      { id: 'adicionais', nome: 'Adicionais', min: 0, max: 2, opcoes: [{ id: 'catupiry', nome: 'Catupiry', preco: 2 }, { id: 'milho', nome: 'Milho', preco: 1 }] }] } } } };
  const { pagina, erros, ctx, fechar } = await abrir('/?loja=moecoe', cen);
  let pedidoIA = null;
  await ctx.route('**/api/assistente', (r) => { pedidoIA = JSON.parse(r.request().postData() || '{}'); r.fulfill({ status: 200, contentType: 'text/event-stream',
    body: 'data: {"text":"Boa! Pastel de frango com catupiry fica ótimo."}\n\ndata: {"text":"\\n[MONTAR:pc|sabor=frango|adicionais=catupiry,inventado]"}\n\ndata: [DONE]\n\n' }); });
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForFunction(() => !document.body.classList.contains('sem-ia') && /Pastel Moe Coe/.test(document.querySelector('#modal-ia-chat .ia-topo-sub').textContent), null, { timeout: 5000 });
  const saudacao = await pagina.locator('#chat-ia-corpo .ia-msg--bot p').first().innerText();
  assert.ok(/Pastel Moe Coe/.test(saudacao) && /montar/.test(saudacao) && !/fresquinh|cozinhar/.test(saudacao), saudacao);
  assert.ok(!/Vinagrete/.test(await pagina.locator('#chat-ia-corpo .ia-etiquetas').innerText()), 'nada de receita de hortifruti');
  await pagina.click('#btn-ia-flutuante');
  await pagina.waitForSelector('#modal-ia-chat.aberto', { timeout: 3000 });
  await pagina.fill('#input-ia-mensagem', 'quero um pastel de frango');
  await pagina.click('#btn-ia-enviar');
  const pilula = pagina.locator('#ia-sugestoes-container .ia-pill--montar');
  await pilula.waitFor({ timeout: 4000 });
  assert.match(await pilula.innerText(), /Frango, Catupiry[\s\S]*Montar assim/);
  assert.ok(!/MONTAR/.test(await pagina.locator('#chat-ia-corpo').innerText()), 'a marcação não aparece na conversa');
  assert.strictEqual(pedidoIA.action, 'chat_stream');
  await pilula.locator('[data-action="montar"]').click();
  await pagina.waitForSelector('#modal-montar.aberto', { timeout: 3000 });
  const marcadas = await pagina.$$eval('#modal-montar .mt-op.on', (bs) => bs.map((b) => b.dataset.o).sort());
  assert.deepStrictEqual(marcadas, ['catupiry', 'frango'], 'abre com a combinação sugerida (e só com opções que existem)');
  await pagina.click('#mt-ok');
  await pagina.waitForFunction(() => !document.querySelector('#modal-montar.aberto'), null, { timeout: 3000 });
  await pagina.waitForFunction(() => /12,00/.test(document.body.innerText), null, { timeout: 3000 });
  semErros(erros); await fechar();
});

teste('montar pedido: o açaí abre a tela de montar, obrigatório segura o botão, grátis e pagos somam certo, duas montagens viram duas linhas e o pedido leva as escolhas', async () => {
  const { pagina, erros, fechar } = await abrir('/', cenarioAcai());
  const card = pagina.locator('#lista-produtos .produto-card[data-id="a"]');
  await card.waitFor({ timeout: 8000 });
  assert.match(await card.locator('.card-add--montar').innerText(), /Montar o seu/);
  assert.match(await card.locator('.etiqueta').innerText(), /a partir de/);
  await card.locator('.card-add--montar').click();
  await pagina.waitForSelector('#modal-montar.aberto', { timeout: 3000 });
  assert.match(await pagina.locator('#mt-ok').innerText(), /Escolha: Calda/, 'grupo obrigatório ainda não escolhido');
  assert.ok(await pagina.locator('#modal-montar .mt-op[data-o="kiw"]').isDisabled(), 'opção que acabou não dá para escolher');
  await pagina.click('#mt-ok');
  assert.ok(await pagina.locator('#modal-montar.aberto').count(), 'sem a calda, não entra na sacola');
  await pagina.click('#modal-montar .mt-op[data-o="cho"]');
  for (const o of ['gra', 'ban', 'nut']) await pagina.click(`#modal-montar .mt-op[data-o="${o}"]`);
  // 3 complementos, 2 grátis (os mais caros: Nutella e Banana) → paga só a Granola (R$ 1)
  assert.match(await pagina.locator('#mt-ok').innerText(), /Pôr na sacola[\s\S]*17,00/);
  assert.ok(await pagina.locator('#modal-montar .mt-op[data-o="kiw"]').evaluate((b) => b.classList.contains('cheio') || b.disabled));
  await pagina.click('#modal-montar [data-mt="mais"]');
  assert.match(await pagina.locator('#mt-ok').innerText(), /34,00/);
  await pagina.click('#mt-ok');
  await pagina.waitForSelector('#modal-montar.aberto', { state: 'detached', timeout: 100 }).catch(() => {});
  await pagina.waitForFunction(() => !document.querySelector('#modal-montar.aberto'), null, { timeout: 3000 });
  assert.match(await card.locator('.card-add--montar').innerText(), /Mais um[\s\S]*2/);
  // outro açaí, de outro jeito
  await card.locator('.card-add--montar').click();
  await pagina.waitForSelector('#modal-montar.aberto', { timeout: 3000 });
  await pagina.click('#modal-montar .mt-op[data-o="mor"]'); await pagina.click('#mt-ok');
  await pagina.waitForFunction(() => !document.querySelector('#modal-montar.aberto'), null, { timeout: 3000 });
  await pagina.click('#btn-carrinho-mobile');
  const linhas = pagina.locator('#carrinho-itens .carrinho-item--montado');
  assert.strictEqual(await linhas.count(), 2, 'dois jeitos de montar = duas linhas');
  assert.match(await linhas.first().locator('.item-adicionais').innerText(), /Calda: Chocolate · Complementos: Granola, Banana, Nutella/);
  assert.match(await pagina.locator('#total-val').innerText(), /50,00/);
  // + na linha montada soma só nela
  await linhas.nth(1).locator('[data-action="inc"]').click();
  assert.match(await pagina.locator('#total-val').innerText(), /66,00/);
  // envia: as escolhas vão como ids
  await pagina.click('#btn-abrir-checkout');
  await pagina.waitForSelector('#modal-checkout.aberto', { timeout: 4000 });
  const lista = pagina.locator('#checkout-endereco select:visible'); if (await lista.count()) await lista.first().selectOption({ index: 1 });
  const campos = pagina.locator('#checkout-endereco input:visible');
  for (let i = 0; i < await campos.count(); i++) await campos.nth(i).fill(['Jardins Florença', '12', '7'][i] || '1');
  await pagina.fill('#cli-nome', 'Cliente Açaí');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForSelector('#sucesso-whatsapps .btn-wpp', { timeout: 6000 });
  const itens = pedidosEnviados().pop().corpo.itens;
  assert.deepStrictEqual(itens.map((i) => [i.id, i.qtd, i.opcoes]), [['a', 2, { tam: ['cho'], comp: ['gra', 'ban', 'nut'] }], ['a', 2, { tam: ['mor'] }]]);
  semErros(erros); await fechar();
});

teste('teclado: no celular, "Editar" produto não abre o teclado sozinho (só ao tocar no campo); fechar não reabre; no computador o cursor vai para o 1º campo', async () => {
  const digitando = (p) => p.evaluate(() => { const a = document.activeElement; return !!a && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea'); });
  // celular
  const cel = await abrir('/admin.html', cenarioPastelaria(), { contexto: CELULAR });
  try {
    await cel.pagina.locator('#pl-cats [data-pl-cat="acai"]').click({ timeout: 8000 });
    await cel.pagina.locator('[data-action="editar-produto"][data-id="a"]').first().click();
    await cel.pagina.waitForSelector('#modal-produto.aberto', { timeout: 3000 });
    await cel.pagina.waitForTimeout(250);
    assert.strictEqual(await digitando(cel.pagina), false, 'abriu a janela com o cursor num campo (o teclado subiria sozinho)');
    assert.ok(await cel.pagina.evaluate(() => document.getElementById('modal-produto').contains(document.activeElement)), 'o foco fica dentro da janela');
    await cel.pagina.locator('#edit-nome').tap();
    assert.strictEqual(await digitando(cel.pagina), true, 'tocando no campo, o teclado abre');
    await cel.pagina.locator('[data-fechar="modal-produto"]').first().tap();
    await cel.pagina.waitForTimeout(250);
    assert.strictEqual(await digitando(cel.pagina), false, 'fechar a janela não põe o cursor num campo');
    semErros(cel.erros);
  } finally { await cel.fechar(); }
  // computador (mouse, sem tela de toque): segue indo direto para o 1º campo
  const pc = await abrir('/admin.html', cenarioPastelaria(), { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false, hasTouch: false } });
  try {
    await pc.pagina.locator('#pl-cats [data-pl-cat="acai"]').click({ timeout: 8000 });
    await pc.pagina.locator('[data-action="editar-produto"][data-id="a"]').first().click();
    await pc.pagina.waitForSelector('#modal-produto.aberto', { timeout: 3000 });
    await pc.pagina.waitForTimeout(250);
    assert.strictEqual(await digitando(pc.pagina), true, 'no computador o cursor vai para o 1º campo');
    semErros(pc.erros);
  } finally { await pc.fechar(); }
});

teste('montar pedido no painel: modelo de açaí, ajusta, salva no produto; "Escolhe 1" e opção que acabou ficam gravadas', async () => {
  const { pagina, erros, fechar } = await abrir('/admin.html', cenarioPastelaria(), { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('#pl-cats [data-pl-cat="acai"]').click({ timeout: 8000 });
  await pagina.locator('[data-action="editar-produto"][data-id="a"]').first().click();
  await pagina.waitForSelector('#modal-produto.aberto', { timeout: 3000 });
  await pagina.locator('#prod-montar > summary').click();
  await pagina.click('[data-mt-modelo="acai"]');
  assert.strictEqual(await pagina.locator('#montar-corpo .mt-ad-grupo').count(), 2);
  assert.match(await pagina.locator('#montar-resumo').innerText(), /2 grupos · 13 opções/);
  // o 2º grupo vira "Escolhe 1 (obrigatório)" com outro nome, e a primeira opção dele acaba
  const g2 = pagina.locator('#montar-corpo .mt-ad-grupo').nth(1);
  await g2.locator('.mt-ad-nome').fill('Cobertura');
  await g2.locator('[data-mt-tipo="uma"]').click();
  await pagina.locator('#montar-corpo .mt-ad-grupo').nth(1).locator('li').first().locator('[data-mt-acao="ativo"]').click();
  await pagina.click('#btn-salvar-produto');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /^produtos\/a$/.test(g.path)), null, { timeout: 4000 });
  const salvo = (await gravadosDe(pagina, /^produtos\/a$/)).pop().montar;
  assert.strictEqual(salvo.grupos.length, 2);
  assert.strictEqual(salvo.grupos[0].nome, 'Complementos'); assert.strictEqual(salvo.grupos[0].max, 4);
  assert.deepStrictEqual([salvo.grupos[1].nome, salvo.grupos[1].min, salvo.grupos[1].max], ['Cobertura', 1, 1]);
  assert.strictEqual(salvo.grupos[1].opcoes[0].ativo, false);
  assert.strictEqual(salvo.grupos[1].opcoes[0].preco, 4);
  semErros(erros); await fechar();
});

teste('checkout com o teclado: comanda fechada numa linha, pagamento em botões, opcional recolhido e "próximo" pula de campo', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await cards(pagina).filter({ hasText: 'Ovos' }).locator('[data-action="add"]').first().click();
  await pagina.click('#btn-carrinho-mobile'); await pagina.click('#btn-abrir-checkout');
  await pagina.waitForSelector('#modal-checkout.aberto', { timeout: 4000 });
  assert.ok(!(await pagina.locator('#comanda .cm-itens').isVisible()), 'a lista começa fechada');
  assert.match(await pagina.locator('#comanda summary').innerText(), /1 item[\s\S]*R\$\s14,00/);
  assert.ok(!(await pagina.locator('#cli-obs').isVisible()), 'observação fica em "Observação, troca e cupom"');
  assert.strictEqual(await pagina.locator('#pag-chips .pag-chip').count(), 3);
  await pagina.click('#pag-chips .pag-chip[data-pag="Dinheiro"]');
  assert.strictEqual(await pagina.locator('#cli-pagamento').inputValue(), 'Dinheiro');
  assert.ok(await pagina.locator('#troco-group').isVisible(), 'dinheiro mostra o troco');
  await pagina.fill('#cli-nome', 'Ana'); await pagina.press('#cli-nome', 'Enter');
  assert.strictEqual(await pagina.evaluate(() => document.activeElement.id), 'cli-telefone', 'Enter = próximo campo');
  await pagina.locator('#checkout-mais > summary').click();
  await pagina.fill('#cli-cupom', 'feira10');
  assert.match(await pagina.locator('#checkout-mais-resumo').innerText(), /cupom FEIRA10/);
  semErros(erros); await fechar();
});

teste('busca à prova de erro: "folhas" acha a alface, plural e letra errada também, e sem resultado oferece o WhatsApp da banca', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  for (const [termo, nome] of [['folhas', 'Alface crespa'], ['Tomates', 'Tomate italiano'], ['verdura', 'Alface crespa'], ['tomatte', 'Tomate italiano'], ['alfase', 'Alface crespa']]) {
    await pagina.fill('#busca-input', termo);
    await pagina.waitForFunction((n) => { const v = [...document.querySelectorAll('#lista-produtos .produto-card')].filter((c) => c.offsetParent !== null).map((c) => c.querySelector('.produto-nome').textContent.trim()); return v.length === 1 && v[0] === n; }, nome, { timeout: 4000 })
      .catch(async () => assert.fail(`"${termo}" devia achar só ${nome}; achou ${JSON.stringify(await visiveis(pagina))}`));
  }
  await pagina.fill('#busca-input', 'pizza');
  await pagina.waitForSelector('#empty-grid-msg .btn-nao-achei', { timeout: 3000 });
  const href = await pagina.getAttribute('#empty-grid-msg .btn-nao-achei', 'href');
  assert.ok(href.startsWith('https://wa.me/5562999990000?text='), href);
  assert.match(decodeURIComponent(href), /Vocês têm pizza\?/);
  semErros(erros); await fechar();
});

const amanhaDow = () => new Date(Date.now() - 3 * 3600000 + 864e5).getUTCDay();
const cenarioDias = () => {
  const c = cenarioPadrao();
  c.lojas.banca.produtos = { ...c.lojas.banca.produtos, alface: { ...c.lojas.banca.produtos.alface, dias: [amanhaDow()] } };
  return c;
};

teste('produto de dia certo: a alface só de amanhã some de hoje, a busca avisa, "Amanhã" mostra, a sacola segura e o pedido vai para amanhã', async () => {
  const { pagina, erros, fechar } = await abrir('/', cenarioDias());
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForSelector('#escolha-dia:not([hidden]) .ed-op', { timeout: 4000 });
  assert.match(await pagina.locator('#escolha-dia').innerText(), /Para quando é o pedido\?[\s\S]*Hoje[\s\S]*Amanhã/);
  assert.ok(!(await visiveis(pagina)).includes('Alface crespa'), 'hoje a alface não aparece');
  // a busca não deixa a pessoa achando que a banca não vende: diz o dia e oferece trocar
  await pagina.fill('#busca-input', 'alface');
  await pagina.waitForSelector('#busca-outro-dia .btn-outro-dia', { timeout: 3000 });
  assert.match(await pagina.locator('#busca-outro-dia').innerText(), /Alface crespa/);
  await pagina.click('#busca-outro-dia .btn-outro-dia');
  await esperarVisiveis(pagina, () => [...document.querySelectorAll('#lista-produtos .produto-card')].some((c) => c.offsetParent !== null && /Alface/.test(c.textContent)));
  assert.strictEqual(await pagina.getAttribute('#escolha-dia [data-dia-pedido="amanha"]', 'aria-checked'), 'true');
  await pagina.fill('#busca-input', '');
  await cards(pagina).filter({ hasText: 'Alface' }).locator('[data-action="add"]').first().click();
  // volta para hoje: a alface FICA na sacola, marcada, e o botão de finalizar explica
  await pagina.click('#escolha-dia [data-dia-pedido="hoje"]');
  await pagina.click('#btn-carrinho-mobile');
  await pagina.waitForSelector('#carrinho-itens .item-fora', { timeout: 3000 });
  assert.match(await pagina.locator('#btn-abrir-checkout').innerText(), /Tire "Alface crespa"/);
  assert.ok(await pagina.locator('#btn-abrir-checkout').isDisabled());
  await pagina.click('#carrinho-itens .item-fora button');
  await pagina.waitForFunction(() => !document.querySelector('#carrinho-itens .item-fora'), null, { timeout: 3000 });
  // de novo para amanhã, com a alface e os ovos: o pedido leva o dia
  await pagina.click('#btn-fechar-sacola').catch(() => {});
  await pagina.click('#escolha-dia [data-dia-pedido="amanha"]');
  await cards(pagina).filter({ hasText: 'Alface' }).locator('[data-action="add"]').first().click();
  await pagina.click('#btn-carrinho-mobile'); await pagina.click('#btn-abrir-checkout');
  await pagina.waitForSelector('#modal-checkout.aberto', { timeout: 4000 });
  assert.match(await pagina.locator('#comanda summary').innerText(), /para amanhã/);
  const lista = pagina.locator('#checkout-endereco select:visible');
  if (await lista.count()) await lista.first().selectOption({ index: 1 });
  const campos = pagina.locator('#checkout-endereco input:visible');
  for (let i = 0; i < await campos.count(); i++) await campos.nth(i).fill(['Jardins Florença', '12', '7'][i] || '1');
  await pagina.fill('#cli-nome', 'Ana'); await pagina.fill('#cli-telefone', '62999998888');
  await pagina.click('#btn-enviar-pedido');
  await pagina.waitForFunction(() => true, null, { timeout: 100 });
  await pagina.waitForTimeout(800);
  const enviado = pedidosEnviados().pop();
  assert.ok(enviado, 'o pedido foi para o servidor');
  assert.strictEqual(enviado.corpo.paraAmanha, true);
  assert.strictEqual(enviado.corpo.diaPreco, amanhaDow());
  assert.strictEqual(enviado.corpo.entregaDia, new Date(Date.now() - 3 * 3600000 + 864e5).toISOString().slice(0, 10));
  semErros(erros); await fechar();
});

teste('loja sem produto de dia certo não pergunta "para quando"', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await cards(pagina).first().waitFor({ timeout: 8000 });
  await pagina.waitForTimeout(300);
  assert.ok(await pagina.locator('#escolha-dia').isHidden());
  semErros(erros); await fechar();
});

teste('checkout: observação, troca e cupom ficam dentro da caixa (nada passa da margem) e a bolinha não cobre o texto', async () => {
  const { pagina, erros, fechar } = await abrir('/');
  await abrirCheckoutComOvos(pagina);
  await pagina.locator('#checkout-mais > summary').click();
  const medidas = await pagina.evaluate(() => {
    const caixa = document.getElementById('checkout-mais').getBoundingClientRect();
    const fora = [...document.querySelectorAll('#checkout-mais *')].filter((el) => el.offsetParent !== null).map((el) => ({ el: el.id || el.className || el.tagName, d: Math.round(el.getBoundingClientRect().right - caixa.right) })).filter((x) => x.d > 0);
    const bola = document.querySelector('#checkout-mais .troca-op input').getBoundingClientRect(), texto = document.querySelector('#checkout-mais .troca-op span').getBoundingClientRect();
    return { fora, bola: Math.round(bola.width), separado: bola.right <= texto.left, larguraPagina: document.documentElement.scrollWidth };
  });
  assert.deepStrictEqual(medidas.fora, [], 'passou da caixa: ' + JSON.stringify(medidas.fora));
  assert.ok(medidas.bola <= 22, `bolinha com ${medidas.bola}px`);
  assert.ok(medidas.separado, 'a bolinha encosta no texto');
  assert.match(await pagina.locator('#pag-nota').innerText(), /Nada é cobrado pelo site/);
  semErros(erros); await fechar();
});

teste('painel: "Sai em quais dias?" grava os dias do produto; palavras da busca também', async () => {
  const cen = cenarioPadrao({ conta: { uid: 'dona', email: 'dona@teste.com', isAnonymous: false, claims: { tenants: { banca: 'proprietario' } } } });
  const { pagina, erros, fechar } = await abrir('/admin.html', cen, { contexto: { viewport: { width: 1200, height: 900 }, isMobile: false } });
  await pagina.locator('#pl-cats [data-pl-cat="verduras"]').click({ timeout: 8000 });
  await pagina.locator('[data-action="editar-produto"][data-id="alface"]').first().click();
  await pagina.waitForSelector('#modal-produto.aberto', { timeout: 3000 });
  assert.strictEqual(await pagina.locator('#dias-chips .prod-dia.on').count(), 7, 'começa em todo dia');
  for (const d of [0, 1, 2, 4, 5]) await pagina.click(`#dias-chips [data-dia="${d}"]`);   // fica quarta e sábado
  assert.match(await pagina.locator('#dias-previa').innerText(), /quarta e sábado/);
  await pagina.evaluate(() => { document.getElementById('prod-mais').open = true; });
  assert.match(await pagina.locator('#palavras-previa').textContent(), /folhas/);
  await pagina.fill('#edit-palavras', 'pé de alface, verdinha');
  await pagina.click('#btn-salvar-produto');
  await pagina.waitForFunction(() => (window.__gravados || []).some((g) => /^produtos\/alface$/.test(g.path)), null, { timeout: 4000 });
  const salvo = (await gravadosDe(pagina, /^produtos\/alface$/)).pop();
  assert.deepStrictEqual(salvo.dias, [3, 6]);
  assert.deepStrictEqual(salvo.palavras, ['pé de alface', 'verdinha']);
  semErros(erros); await fechar();
});
