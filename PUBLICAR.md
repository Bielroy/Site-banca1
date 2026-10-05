# Antes de publicar — lista de conferência

Nada disto foi feito no ambiente em que o código foi escrito (sem acesso à internet,
ao Firebase e à Vercel). Os testes automáticos (`npm test`, 54 testes) passam e as telas
foram conferidas com dados simulados.

## 1. Build
1. `npm install`
2. `npm test` — deve terminar com "53 de 54 testes passaram".
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
- Para a tela da plataforma, rode UMA vez no seu computador, com as variáveis do Firebase
  (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`):
  `node scripts/plataforma.js dono-da-plataforma seu@email.com`
  Depois saia e entre de novo no painel: aparece o botão **Plataforma** no topo.
- Equipe: aba **Equipe** do painel (e-mail + papel).

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
- Cancelar pedido pelo painel não devolve o estoque.
- PIX automático só na loja original.
- Limite de chamadas por minuto fica na memória do servidor (zera a cada reinício).
- A rotina diária do motor roda as lojas em sequência (60 s no plano gratuito).
- Loja bloqueada ainda deixa o proprietário editar produtos; Clientes, Calendário e Cupons desligados
  somem do painel, mas as regras do banco não bloqueiam.
- Não há impressão automática ao chegar pedido; nenhuma impressora real foi testada.
- O aplicativo instalável (PWA) ainda leva o nome e o ícone da Banca em todas as lojas.
- Acesso retirado de alguém pode valer por até 1 hora no painel que já estava aberto.
