# Antes de publicar — lista de conferência

Nada disto foi feito no ambiente em que o código foi escrito (sem acesso à internet,
ao Firebase e à Vercel). Os testes automáticos (`npm test`, 82 testes) passam e as telas
foram conferidas com dados simulados.

## 1. Build
1. `npm install`
2. `npm test` — deve terminar com "82 de 82 testes passaram".
3. `npm run build` — nunca foi rodado depois das mudanças. Se der erro, copie a mensagem inteira.
4. `npm run preview` e abra: `/`, `/admin.html`, `/plataforma.html`.

## 2. Firebase
1. **Firestore → Regras:** publique `firestore.rules`. Compare antes com as regras atuais do console
   (o bloco da loja original foi reescrito a partir do código). Teste no simulador de regras:
   cliente lê produto; cliente NÃO lê pedido de outro; caixa lê pedidos e NÃO grava produto.
2. **Storage → Regras:** publique `storage.rules`.
3. **Índice:** se o painel mostrar "modo simplificado", clique no link do erro no console do navegador.
4. **Authentication → Authorized domains:** inclua todo endereço em que o painel for aberto.

## 3. Vercel
- Arquivos novos em `api/`: `estoque.js`, `pdv.js`, `equipe.js`, `plataforma.js` (10 no total; o plano
  gratuito aceita 12).
- Variáveis já usadas continuam valendo. Novas e opcionais:
  - `VITE_DOMINIO_LOJAS`, `VITE_DOMINIOS_PROPRIOS` — subdomínio por loja (ver `js/enderecos-config.js`).
- `vercel.json` traz a política de segurança (CSP) só em modo de aviso (`Report-Only`). Abra o site,
  veja o console do navegador e só troque para `Content-Security-Policy` quando não houver aviso.

## 4. Primeiro acesso
- Sua conta antiga (`admin: true`) continua sendo proprietária da Banca.
- **Tela da plataforma, sem comando:** entre no painel, toque em **Plataforma** no topo e depois em
  **Assumir a plataforma**. Vale uma vez: a primeira conta dona da loja original que tocar fica sendo a
  dona da plataforma (gravado em `plataforma/dono`). Dali você cria lojas e define o dono de cada uma.
- Equipe: aba **Equipe** do painel (e-mail + papel).

## 4a2. PIX copia e cola com a chave da loja (sem banco no meio)
Em **Configurações → Chave PIX da loja**, escolha o tipo, escreva a chave, o nome de quem recebe e a cidade.
Quem escolhe PIX recebe um código pronto com o valor do pedido (na tela de pedido enviado e em Meus pedidos).
Pedido com item a pesar só mostra o código depois da pesagem. O site NÃO confirma o pagamento: a loja confere
pelo extrato ou pelo comprovante. Funciona em todas as lojas. O código segue o padrão do Banco Central e foi
conferido com o exemplo oficial, mas nunca foi pago de verdade: faça um PIX de teste de valor baixo.

## 4b. PIX automático (PagBank) — desligado até você configurar
1. Tenha uma conta PagBank com a API liberada e copie o token.
2. Cole o token em **Plataforma → PIX automático (PagBank)** e salve. (Quem preferir, pode criar na Vercel a
   variável `PAGBANK_API_TOKEN`; se existir, ela é a que vale.) Confira `PUBLIC_BASE_URL` (endereço do site, com https).
   Para testar sem dinheiro de verdade, crie também `PAGBANK_ENV` = `sandbox` com o token de teste.
3. No painel: **Configurações → PIX automático** → marque e salve.
4. Faça um pedido de teste com PIX: aparece "Pagar com PIX agora", pede o CPF, mostra o QR Code e o
   copia e cola. Pago, o pedido aparece como PAGO no painel sozinho.
- Pedido com item a pesar só libera o PIX depois da pesagem (botão em **Meus pedidos**).
- Cancelar um pedido já pago NÃO devolve o dinheiro: devolva o PIX pelo aplicativo do banco.

## 4c. Aviso de pedido novo no celular
- No painel, botão **Avisos** no topo → **Ligar avisos neste aparelho** → **Mandar um aviso de teste**.
- Cada pessoa liga no próprio celular. Android: funciona pelo Chrome. iPhone: só com o site instalado
  na tela de início (Compartilhar → Adicionar à Tela de Início).
- As chaves ficam na Vercel: `VITE_VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. Não troque: quem já ligou
  teria de ligar de novo.
- Nunca foi testado num celular de verdade: confira com um pedido de teste e o painel fechado.

## 4d. Taxa e horário de entrega
- Painel → **Configurações**: taxa de entrega, valor para entrega grátis e horários (um por linha).
- Tudo em branco/zero = a loja se comporta como antes (não cobra, não pergunta horário).
- A taxa é calculada pelo servidor e entra no total do pedido, do cupom impresso e da mensagem do WhatsApp.
- Pedido com item a pesar: a taxa é cobrada no envio e sai sozinha se, depois da balança, o pedido
  passar do valor de entrega grátis.
- A taxa entra no faturamento do Balanço junto com os itens. Vendas no Balcão não têm taxa.

## 4e. Fotos automáticas (ImgBB)
1. Crie uma conta grátis em imgbb.com, abra api.imgbb.com e toque em "Get API key".
2. No painel, abra **Plataforma → Fotos dos produtos**, cole a chave e toque em Salvar.
3. Em qualquer loja: **Produtos → Enviar várias fotos**. Escolha as fotos; o sistema reduz, envia
   ao ImgBB e grava o link em cada produto. Arquivo com o nome do produto (tomate.jpg) já vem marcado.
   Foto sem produto marcado vai para o **banco de fotos** da loja; depois, na tela de cada produto,
   toque em "Escolher do banco de fotos".
A chave fica só no servidor (`plataforma/segredos`); nenhuma tela mostra a chave de volta.
Nunca foi testado com o ImgBB de verdade: confira o primeiro envio.

## 4f. Cópia de segurança, alertas e limite
- **Cópia diária**: a rotina da madrugada guarda, por loja, produtos, configurações e os pedidos dos
  últimos 90 dias em `backups/` (ficam as últimas 7). O proprietário baixa uma cópia na hora em
  **Configurações → Cópia de segurança**. A cópia fica no MESMO banco: protege de apagar por engano,
  não de perder a conta do Firebase. Por isso, baixe uma de vez em quando e guarde fora.
  Restaurar uma cópia ainda é manual (não há botão).
- **Alerta de falha**: erro interno no envio de pedido ou na venda do balcão avisa os aparelhos com
  avisos ligados (no máximo um a cada 30 min por assunto).
- **Limite de pedidos**: 8 por conexão a cada 10 minutos, contado no banco.
- **Venda no balcão** também dispara aviso nos aparelhos da equipe.

## 4g. Oferta, entrega grátis, app por loja e restaurar cópia
- **Oferta**: no cadastro do produto, preencha "preço antigo, que aparece riscado". Se for maior que o
  preço de venda, o produto ganha o selo e entra na faixa "Ofertas de hoje". Apague o campo para encerrar.
  O servidor continua cobrando só o preço de venda.
- **Entrega grátis**: com "grátis acima de" configurado, o pedido mostra uma barra de quanto falta.
- **App por loja**: cada loja (menos a original) é instalada com o nome, a cor e o ícone dela
  (`/api/manifest`). Nunca foi testado num celular de verdade; o iPhone é o caso mais incerto.
- **Restaurar cópia**: Configurações → Cópia de segurança → escolha o dia → Restaurar. Volta produtos,
  categorias, configurações e cupons; não mexe em pedidos, equipe nem clientes, e não apaga o que foi
  criado depois. Antes de voltar, guarda uma cópia do estado atual (aparece na lista como "antes de restaurar").
- O projeto está com **12 funções em `api/`**, que é o teto do plano gratuito da Vercel: a próxima
  função nova precisa entrar dentro de um arquivo que já existe.

## 4i. Dois aplicativos: a loja e o painel
- **Loja** ("Banca Adair", ícone escuro): botão "Instalar o app" no topo da loja.
- **Painel** ("Painel", ícone claro com a prancheta): botão "Instalar o painel" no topo do painel
  (`/admin.html`). Abre direto no painel, sem precisar do link.
Os botões só aparecem quando o aparelho permite instalar. No Android, o login feito no Chrome vale no
aplicativo. No iPhone, o aplicativo tem memória separada: é preciso entrar de novo por dentro dele, e o
link de acesso enviado por e-mail abre no Safari, não no aplicativo. Nunca testado em celular de verdade.

## 4h. Maquininha (PagBank) no painel
1. No PagBank, abra um chamado "Novas Ativações - EDI → Geração de token API EDI". O token chega por
   e-mail, com o número do estabelecimento. (Não é o mesmo token do PIX.)
2. No painel da loja: **Configurações → Maquininha (PagBank) → Ligar ou trocar a maquininha**.
3. Toque em "Buscar as vendas de ontem agora" para testar. Daí em diante a rotina da madrugada busca sozinha.
- O PagBank só entrega as vendas no dia seguinte, e vale-refeição não entra.
- A tela mostra a maquininha AO LADO do que o painel registrou; não soma os dois, para não contar em
  dobro o pedido do site pago no cartão na entrega.
- **Nunca testado com uma conta de verdade.** A leitura foi escrita pela documentação pública do PagBank
  (https://developer.pagbank.com.br/docs/api-do-extrato-edi). Se aparecer "formato não reconhecido", o
  resumo do dia guarda os nomes dos campos recebidos em `maquininha/{dia}.formatoDesconhecido` para ajustar.

## 5. Testar com a loja de verdade
- [ ] Pedido pela loja: preço, estoque, cupom, WhatsApp.
- [ ] Pesagem: desconto do cupom mantido e estoque por quilo baixado.
- [ ] Balcão: venda entra no Balanço e baixa o estoque.
- [ ] Estoque: entrada, perda, produção por ficha técnica, lote e validade.
- [ ] Fotos: enviar, trocar, miniatura na loja.
- [ ] Calendário, Compras, Clientes, Copiloto (o copiloto usa a IA de verdade: confira o custo).
- [ ] Impressora: botão **Impressora** no topo → "Imprimir teste" em cada aparelho.
- [ ] Um login de cada papel (caixa, produção, estoque, funcionário).
- [ ] Fontes e gráficos (não carregam no ambiente de teste).

## 6. Limites conhecidos
- PIX automático só na loja original (a conta do banco no servidor é uma só) e nunca foi testado com o PagBank de verdade.
- A lista da semana e o "pedir de novo" ficam no aparelho
  da cliente (trocou de celular, começa do zero).
- A miniatura das fotos usa o redutor de imagens da Vercel, que tem limite mensal no plano gratuito.
- A rotina diária do motor roda as lojas em sequência (60 s no plano gratuito).
- Loja bloqueada ainda deixa o proprietário editar produtos; Clientes, Calendário e Cupons desligados
  somem do painel, mas as regras do banco não bloqueiam.
- Não há impressão automática ao chegar pedido; nenhuma impressora real foi testada.
- O link compartilhado (og:image, canonical, sitemap) aponta para https://site-banca1.vercel.app. Quando houver
  domínio próprio, troque nos arquivos index.html, privacidade.html, sitemap.xml e robots.txt.
- A prévia do link no WhatsApp é sempre a da Banca, mesmo no link de outra loja (?loja=...).
- Acesso retirado de alguém pode valer por até 1 hora no painel que já estava aberto.

## 4j. Começar do zero (depois dos testes)

Painel → Configurações → "Começar do zero" (só o proprietário vê). Escreve ZERAR e confirma.
Apaga pedidos, caixa, fechamentos, histórico de estoque, anotações de clientes, avaliações, vendas da
maquininha já buscadas e tudo o que o motor de previsão aprendeu; zera os usos dos cupons.
Ficam produtos (com o estoque marcado), categorias, configurações, cupons, equipe, calendário e fotos.
Antes de apagar, guarda uma cópia "AAAA-MM-DD-antes-de-zerar" (some depois de 7 cópias diárias mais novas).
Vale só para a loja em que o painel está aberto.

## 4k. Motor de previsão 1.2 (clima, preço, pagamento)

O que o motor passou a considerar, além do dia da semana e do calendário:

- **Clima** da cidade da loja (chuva, calor e frio fora do normal). Fonte: Open-Meteo, gratuito e sem chave.
  A cidade vem de Operacional → "Cidade da loja" (em branco, vale a cidade da chave PIX). O que chega fica em
  `analytics_config/clima`. Sem cidade ou sem resposta do serviço, a previsão segue sem o clima.
- **Preço e oferta**: o preço cobrado em cada dia (dos pedidos) e um retrato diário do cadastro
  (`analytics_vendas/{dia}.precos` e `.fora`), guardado no primeiro cálculo do dia.
- **Dias de pagamento** (5 a 10 do mês), depois de aparecer em dois meses diferentes.
- **Dia em que a loja não funcionou** (nenhum pedido numa loja que costuma ter vários): sai da conta.
- **Estoque que zerou numa venda**: conta como dia de falta, mesmo sem marcar no Fechamento.

Cada efeito só é usado quando se destaca do sobe-e-desce normal (ver `analytics/config.js`, bloco
"Fatores externos"). A aba Previsão mostra o que já foi aprendido em "O que o motor já aprendeu".

Para medir numa loja simulada: `node scripts/medir-motor.js 1,2,3` (leva cerca de um minuto).
O erro de verdade, da loja real, aparece na aba Previsão em "Erro das previsões anteriores".

Nenhuma regra do Firestore mudou. Nenhuma variável nova na Vercel.
