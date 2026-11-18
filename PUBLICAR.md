# Antes de publicar — lista de conferência

Nada disto foi feito no ambiente em que o código foi escrito (sem acesso à internet,
ao Firebase e à Vercel). Os testes automáticos (`npm test`, 83 testes) passam e as telas
foram conferidas com dados simulados.

## 1. Build
1. `npm install`
2. `npm test` — deve terminar com "83 de 83 testes passaram".
3. `npm run build` — nunca foi rodado depois das mudanças. Se der erro, copie a mensagem inteira.
4. `npm run preview` e abra: `/`, `/admin.html`, `/plataforma.html`.

## 2. Firebase
1. **Firestore → Regras:** publique `firestore.rules` (passo a passo na seção 4l). As regras são testadas no
   emulador do Firebase a cada mudança (GitHub → Actions → "Testes de segurança").
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

## 4b2. Pedido na tela do cliente, senha de chamada e plaquinha (NFC / QR Code)
- **Faixa do pedido:** depois de pedir, o cliente vê embaixo da loja em que pé está o pedido (Recebido, Separando,
  Pronto para retirar, Saiu para entrega). Muda sozinha: não precisa abrir "Meus pedidos". Some quando o pedido é entregue ou retirado.
- **Pedido para retirar:** no painel, o cartão em "Separando" ganha o botão **Pronto para retirar**. A tela do cliente abre
  sozinha, vibra e toca um aviso curto (com a tela do celular apagada o navegador não toca nada). Depois, **Cliente retirou**.
- **Senha:** em **Configurações → Senha de chamada**: desligada (padrão), ligada (senha na tela) ou ligada com a caixinha de senhas.
  A senha tem 3 dígitos, de 001 a 999, recomeça à meia-noite e quem conta é o servidor (duas pessoas nunca pegam a mesma).
  "Chamar de novo" repete o aviso. Com a caixinha, o cartão mostra o número para digitar nela: **a ligação automática com a
  caixinha ainda não existe** (falta saber o modelo e como ela recebe o número).
- **Plaquinha:** em **Configurações**, logo abaixo da senha, copie o **link da plaquinha** (o endereço da loja com `?placa=1`)
  e grave no NFC ou gere o QR Code com ele. Sem pedido aberto no celular, abre o cardápio. Com PIX por pagar, abre o PIX já com
  o valor. Com o pedido pronto, mostra a senha. O celular é reconhecido pelo navegador: quem fez o pedido em outro navegador
  (ex.: dentro do Instagram) não é reconhecido na plaquinha e vê o cardápio.
- **Segurança do PIX pela plaquinha:**
  - Cada celular só enxerga os próprios pedidos (regra do banco). Duas pessoas lendo a mesma plaquinha ao mesmo tempo não se
    misturam: o link não carrega pedido nenhum.
  - O PIX só abre com o dado confirmado pelo servidor (sem internet, mostra só o andamento), só de pedido feito há menos de
    12 h e nunca antes da pesagem.
  - **Já paguei** (na tela do PIX): o cliente avisa e a plaquinha não cobra de novo. Se o pedido mudar de valor depois,
    a tela pede para falar com a banca, sem oferecer o PIX cheio.
  - **PIX recebido** (no cartão do pedido, no painel): a equipe confere no app do banco e marca. A tela do cliente diz
    "pago" e a plaquinha não cobra mais. O identificador do PIX (aparece no extrato) é o número do pedido: serve para achar
    o pagamento feito por outra pessoa. Dá para desfazer. Cancelar um pedido com PIX recebido lembra de devolver o PIX.
  - A tela de "Pedido registrado" se atualiza sozinha: pesou, tirou item ou cancelou, o PIX muda ou some na hora.
  - PIX pela chave tem valor no código, mas alguns bancos deixam o cliente mudar o valor: confira o valor no extrato.

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

## 4e. Fotos automáticas (Cloudflare R2)
1. Ligue o R2 no servidor: veja ROTA-CLOUDFLARE.md, "Fotos no Cloudflare R2" (5 linhas no `~/segredos.env`).
   A tela **Plataforma → Chaves** mostra "Fotos dos produtos (Cloudflare R2): Ligado".
2. Em qualquer loja: **Produtos → Enviar várias fotos**. Escolha as fotos; o sistema reduz, envia
   ao R2 (fotos.usebanca.com) e grava o link em cada produto. Arquivo com o nome do produto (tomate.jpg) já vem marcado.
   Foto sem produto marcado vai para o **banco de fotos** da loja; depois, na tela de cada produto,
   toque em "Escolher do banco de fotos".
As chaves ficam só no servidor; nenhuma tela mostra chave. O ImgBB não é mais usado.

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
- Acesso retirado de alguém: vendas, estoque, fotos, equipe e plataforma são recusados na hora; a LEITURA direta
  do banco (ver a fila de pedidos num painel que já estava aberto) pode durar até 1 hora, que é quanto vale o
  login do Firebase.
- Entrar no painel gasta um link de e-mail, e o plano gratuito do Firebase envia só **5 links de entrada por dia**
  para o projeto inteiro. Por isso o painel não desloga mais sozinho a cada 30 minutos (agora são 12 horas).

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

## 4l. Segurança (auditoria de outubro/2026) — o que só você consegue fazer
O código novo já vai para o ar sozinho. **Estes passos são no console e não vão sozinhos.** Faça 1 e 2 no mesmo dia
da publicação; os outros, quando puder. O desenho completo está em `SEGURANCA.md`.

1. **Publicar as regras do banco.** Firebase → Firestore Database → aba **Regras** → apague o que está lá, cole o
   conteúdo de `firestore.rules` → **Publicar**. Enquanto não publicar, continuam valendo as regras antigas (o site
   funciona igual, mas sem as travas novas: status de pedido só para frente, estoque e produção sem ver pedidos,
   formato conferido em limites, custos e aparência).
2. **Publicar as regras das fotos.** Firebase → Storage → aba **Regras** → cole `storage.rules` → **Publicar**.
   (Se o Storage nunca foi ligado no projeto, pule: as fotos vão pelo Cloudflare R2.)
3. **Domínios autorizados.** Firebase → Authentication → Configurações → **Domínios autorizados**. Deixe só os que
   são seus: `localhost`, os dois do Firebase (`...firebaseapp.com` e `...web.app`) e `site-banca1.vercel.app`.
   Se aparecer `bancaadairepedrina.com.br` (ou qualquer outro que você não controla), **remova**: quem registrar
   esse domínio poderia receber os links de entrada do painel.
4. **Proteção contra descoberta de e-mail.** Authentication → Configurações → Ações do usuário → deixe ligada a
   "Proteção contra enumeração de e-mail".
5. **Verificação em duas etapas no e-mail.** Quem entra no painel entra pelo e-mail: ligue a verificação em duas
   etapas na conta Google (ou do provedor) de cada pessoa da equipe, principalmente a sua e a do proprietário.
   É o segundo fator do painel.
6. **Restringir a chave pública do Firebase.** Google Cloud → APIs e serviços → Credenciais → chave "Browser key":
   - Restrição de aplicativo: **Sites** → `https://site-banca1.vercel.app/*` e `https://SEU-PROJETO.firebaseapp.com/*`;
   - Restrição de API: Identity Toolkit, Token Service, Cloud Firestore, Cloud Storage for Firebase, Firebase Installations;
   - confira que **Generative Language API (Gemini) NÃO** está na lista dessa chave;
   - se existir uma chave antiga sem uso (o histórico do projeto mostra duas), apague a que não é usada.
   Teste depois: abrir a loja, fazer um pedido de teste e pedir o link de entrada do painel.
7. **Variáveis opcionais na Vercel** (só se quiser mudar o padrão): `DIAGNOSTICO_SECRET` (abre o diagnóstico da IA
   por segredo; sem ela, só o dono da plataforma logado abre), `LOGIN_TETO_HORA` (padrão 30 pedidos de link por hora),
   `CHECKOUT_TETO_LOJA` (padrão 150 pedidos por loja a cada 10 minutos), `IA_PAINEL_LIMITE_DIA` (padrão 300).
8. **Plano do Firebase.** No plano gratuito são 5 links de entrada por dia. Se a equipe crescer, o plano Blaze
   sobe para 25 mil — mas ele cobra por uso: só mude depois de criar um **alerta de orçamento** no Google Cloud.

### Para depois (não está ligado)
- **App Check** (barra programas que não são o seu site falando com o banco): Firebase → App Check → registrar o app
  da Web com reCAPTCHA v3, acompanhar as métricas por uns dias e só então ligar "Aplicar". Precisa de mudança no
  código (carregar o App Check e liberar `https://www.google.com/recaptcha/` e `https://www.gstatic.com/recaptcha/`
  na política de conteúdo do `vercel.json`). Peça quando quiser ligar.
- **Limite na borda:** Vercel → projeto → Firewall → regra de limite por IP em `/api/*` (barra antes de chegar ao servidor).
- **Segundo fator dentro do site / chave de acesso (passkey):** exige o upgrade do login do Firebase (Identity Platform).

### Como conferir que as regras publicadas estão certas
No GitHub, aba **Actions** → "Testes de segurança": o trabalho "Regras do banco no emulador do Firebase" roda
`firestore.rules` e `storage.rules` de verdade e tenta ler e gravar o que não pode, com cada tipo de conta.
Verde = as regras do arquivo fazem o que prometem. (Ele testa o ARQUIVO; publicar no console continua sendo com você.)

## 4m. Infra e processo — o que só o dono liga (novembro/2026)
O código já está pronto; cada item abaixo fica DESLIGADO (e avisando) até você fazer o passo. Quando algo der errado: `RUNBOOK.md`.
Antes de tudo, atualize o servidor uma vez à mão (`bash ~/loja/scripts/atualizar-servidor.sh`): é ele que passa a informar a versão.

### Servidor atualizado sozinho (≈ 20 min)
O site se atualiza a cada mudança; o servidor só quando alguém roda o script. Agora `/api/saude` mostra `"versao"` (commit) e o painel do dono
mostra uma faixa amarela quando site e servidor ficam diferentes por mais de 20 min. Para o GitHub atualizar o servidor sozinho
(`.github/workflows/deploy-servidor.yml`, a cada mudança no `rota-cloudflare`; se nada do servidor mudou, só anota a versão, sem reiniciar):
1. No terminal da AWS, crie uma chave **só para isto**: `ssh-keygen -t ed25519 -N "" -f ~/gh_deploy -C github-deploy`
2. Prenda a chave ao comando de atualização (ela não abre terminal nem faz outra coisa):
   `printf 'command="SO_SE_MUDOU=1 bash %s/loja/scripts/atualizar-servidor.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' "$HOME" "$(cat ~/gh_deploy.pub)" >> ~/.ssh/authorized_keys`
3. GitHub → repositório → **Settings → Secrets and variables → Actions → New repository secret**, quatro segredos:
   - `SSH_HOST` = `54.207.72.209` · `SSH_USER` = `ubuntu` (o usuário do terminal: `whoami`)
   - `SSH_KEY` = todo o conteúdo de `cat ~/gh_deploy` (de `-----BEGIN` até `-----END ...-----`)
   - `SSH_KNOWN_HOSTS` = a saída de `ssh-keyscan -t ed25519 localhost 2>/dev/null | sed 's/^localhost/54.207.72.209/'` (rodado no servidor)
4. Apague a cópia da chave privada do servidor: `rm ~/gh_deploy` (a pública fica no `authorized_keys`).
5. Firewall da Lightsail: a porta 22 precisa aceitar o GitHub (endereços variáveis). A chave presa ao comando é a proteção; o login por senha
   continua desligado. Se preferir a porta 22 fechada, deixe os segredos sem criar e atualize à mão.
6. Teste: GitHub → Actions → "Atualizar o servidor (AWS)" → **Run workflow**. Verde com "Pronto: servidor no ar com a versão ...".
Sem os segredos, o trabalho termina com aviso amarelo "Servidor NÃO foi atualizado" e o resumo diz o que falta.

### Cópia fora da máquina (≈ 15 min)
As cópias diárias ficam no disco do servidor; se a máquina se perder, vão junto. Agora o `backup-diario.sh` manda a mesma cópia para o R2.
1. Cloudflare → R2 → **Create bucket** `copias-banca` (NÃO ligue domínio público nem "Public access": as fotos são públicas, as cópias não).
2. No bucket → Settings → **Object lifecycle rules** → apagar objetos com prefixo `banco/` depois de **60 dias**.
3. R2 → **Manage API tokens** → token "Object Read & Write" **só no bucket `copias-banca`**.
4. No `~/segredos.env`: `R2_BACKUP_BUCKET=copias-banca`, `R2_BACKUP_ACCESS_KEY_ID=...`, `R2_BACKUP_SECRET_ACCESS_KEY=...` (a conta é o mesmo `R2_ACCOUNT_ID`).
5. `bash ~/loja/scripts/atualizar-servidor.sh` e depois `bash ~/loja/scripts/ligar-backup.sh` (troca a linha antiga do agendador, que jogava a
   saída fora, pela nova, com registro em `~/backups/agendador.log`, e já faz uma cópia). No fim do `tail ~/backups/backup.log`:
   "ok: cópia fora da máquina (R2)". No R2 aparece `banco/AAAA-MM-DD.json.gz`.
Sem as variáveis, a cópia local continua, o registro diz "cópia fora da máquina DESLIGADA" e o celular do dono recebe aviso.
Qualquer falha da cópia (disco cheio, cópia quebrada, R2 recusou) avisa o celular do dono pelo aviso de sempre do painel.

### A chave dos dados (DADOS_CHAVE) num cofre fora do servidor (≈ 5 min, OBRIGATÓRIO)
Nome, telefone e endereço dos clientes estão cifrados com a `DADOS_CHAVE`, que fica só no `~/segredos.env`. As cópias NÃO levam a chave.
Se o servidor se perder sem a chave guardada fora, esses dados das cópias ficam ilegíveis para sempre.
1. No servidor: `grep '^DADOS_CHAVE=' ~/segredos.env` (aparece na tela; não cole em chat, e-mail ou WhatsApp).
2. Guarde num **gerenciador de senhas** (Bitwarden, 1Password, o do Google) com o nome "usebanca DADOS_CHAVE", com acesso de uma segunda pessoa de confiança.
3. Feche o terminal e confira o histórico: `grep -c DADOS_CHAVE ~/.bash_history` (se passar de 0: `sed -i '/DADOS_CHAVE/d' ~/.bash_history`).

### Ensaio de restauração — uma vez por trimestre (≈ 30 min)
Cópia que nunca foi restaurada não é cópia. O GitHub ensaia o ciclo no emulador a cada mudança (testes de segurança → "Backup → restaurar no
emulador"), mas o ensaio com o arquivo de verdade é com você:
1. Crie (uma vez) um projeto Firebase de TESTE (ex.: `banca-teste`), com Firestore, e baixe a chave de uma conta de serviço dele (JSON).
   Nunca use o arquivo da produção.
2. No servidor (envie o JSON pelo menu do terminal da Lightsail): `bash ~/loja/scripts/restaurar-backup.sh ~/backups/banco-<ontem>.json.gz --simular`
   (só conta) e depois `bash ~/loja/scripts/restaurar-backup.sh ~/backups/banco-<ontem>.json.gz --projeto banca-teste --credenciais ~/banca-teste.json`
   (pergunta antes; digite RESTAURAR).
3. Confira no console do Firebase do projeto de teste: produtos, pedidos de ontem, lojas. Repita com um arquivo baixado do R2 (`copias-banca` → banco/).
4. Apague o JSON da conta de teste do servidor e anote a data do ensaio aqui: [DATA DO ÚLTIMO ENSAIO].
O script recusa o projeto da produção sem `--producao` e, mesmo com ele, exige digitar o nome do projeto.

### Rotina da noite com o código novo (≈ 15 min, no mesmo dia)
Hoje quem roda a rotina (cópia do dia no Firebase, previsão, faxinas) é a **Vercel**, pelo `crons` do `vercel.json` da `main` — código de
206 mudanças atrás. O GitHub só agenda fluxos do **ramo padrão** (`main`), e a `main` nem tem o `rotina-noite.yml`. Para virar:
1. GitHub → Settings → Secrets → Actions: `API_ORIGEM` = `https://api.usebanca.com` e `CRON_SECRET` = o mesmo do `~/segredos.env`.
2. **No mesmo dia**, um dos dois:
   - **(recomendado) mesclar o PR #3** (`rota-cloudflare` → `main`): leva o `rotina-noite.yml` para a `main` e tira o `crons` do `vercel.json`
     (este ramo já está sem ele), então a Vercel para e o GitHub começa; ou
   - trocar o ramo padrão: Settings → General → **Default branch** → `rota-cloudflare`, e na Vercel → projeto → Settings → **Cron Jobs → Disable**.
3. GitHub → Actions → "Rotina da noite" → **Run workflow**: verde, e `https://usebanca.com/api/saude` passa a mostrar `"rotina"` com a hora.
Sem os segredos, o trabalho fica **vermelho** (antes terminava verde sem fazer nada). O painel do dono avisa quando a rotina não roda há
mais de 30 h, ou nunca rodou por este servidor.

### Página de privacidade (≈ 10 min)
`privacidade.html` lista os fornecedores de verdade (Cloudflare, AWS, Firebase, Asaas, PagBank, WhatsApp, Gemini). Preencha as lacunas
`[NOME/CNPJ DO CONTROLADOR]` e `[E-MAIL DO ENCARREGADO]` (aparecem 1 e 2 vezes) e leia o texto com quem cuida da parte jurídica.
Pedido de apagar dados: `RUNBOOK.md`, item (iv), prazo de 15 dias.

### Alerta de queda
UptimeRobot olhando o servidor e o site: `RUNBOOK.md`, última seção (≈ 10 min). Preencha também "Quem chamar" no topo do RUNBOOK.
