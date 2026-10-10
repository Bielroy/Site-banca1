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
      : c.acao === 'lojas' ? { sucesso: true, lojas: [{ id: 'banca', nome: 'Banca Adair e Pedrina', ativo: true, original: true, donos: ['dona@teste.com'], cor: '#1a3a2a', mes: { receita: 0, pedidos: 0 } }], feiras: [], condominios: [], pix: false, fotos: false } : {}),
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
