# Antes de publicar — lista de conferência

Nada disto foi feito no ambiente em que o código foi escrito (sem acesso à internet,
ao Firebase e à Vercel). Os testes automáticos (`npm test`, 67 testes) passam e as telas
foram conferidas com dados simulados.

## 1. Build
1. `npm install`
2. `npm test` — deve terminar com "67 de 67 testes passaram".
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

## 4b. PIX automático (PagBank) — desligado até você configurar
1. Tenha uma conta PagBank com a API liberada e copie o token.
2. Na Vercel, crie `PAGBANK_API_TOKEN` (o token) e confira `PUBLIC_BASE_URL` (endereço do site, com https).
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
- A cópia de segurança não tem botão de restaurar; a lista da semana e o "pedir de novo" ficam no aparelho
  da cliente (trocou de celular, começa do zero).
- A miniatura das fotos usa o redutor de imagens da Vercel, que tem limite mensal no plano gratuito.
- A rotina diária do motor roda as lojas em sequência (60 s no plano gratuito).
- Loja bloqueada ainda deixa o proprietário editar produtos; Clientes, Calendário e Cupons desligados
  somem do painel, mas as regras do banco não bloqueiam.
- Não há impressão automática ao chegar pedido; nenhuma impressora real foi testada.
- O aplicativo instalável (PWA) ainda leva o nome e o ícone da Banca em todas as lojas.
- Acesso retirado de alguém pode valer por até 1 hora no painel que já estava aberto.
