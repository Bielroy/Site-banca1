# Antes de publicar — lista de conferência

Nada disto foi feito no ambiente em que o código foi escrito (sem acesso à internet,
ao Firebase e à Vercel). Os testes automáticos (`npm test`, 58 testes) passam e as telas
foram conferidas com dados simulados.

## 1. Build
1. `npm install`
2. `npm test` — deve terminar com "58 de 58 testes passaram".
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
- Limite de chamadas por minuto fica na memória do servidor (zera a cada reinício).
- A rotina diária do motor roda as lojas em sequência (60 s no plano gratuito).
- Loja bloqueada ainda deixa o proprietário editar produtos; Clientes, Calendário e Cupons desligados
  somem do painel, mas as regras do banco não bloqueiam.
- Não há impressão automática ao chegar pedido; nenhuma impressora real foi testada.
- O aplicativo instalável (PWA) ainda leva o nome e o ícone da Banca em todas as lojas.
- Acesso retirado de alguém pode valer por até 1 hora no painel que já estava aberto.
