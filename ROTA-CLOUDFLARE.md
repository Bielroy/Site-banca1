# Rota A — site no Cloudflare Pages e servidor na AWS (Lightsail)

Objetivo: tirar o site comercial da Vercel grátis (que só vale para uso pessoal) sem pagar a Vercel Pro,
e **manter a Vercel funcionando para os seus testes**. O código de `api/` não mudou: o mesmo código roda nos dois lugares.

```
cliente ─► Cloudflare Pages (páginas, cabeçalhos, fotos) ─► /api/* ─► api.usebanca.com: AWS (Caddy ─► Docker ─► server/index.js)
                                                                      └► Firebase (banco e login)
GitHub Actions (todo dia 8h UTC) ─► api.usebanca.com/api/analytics   (a "rotina da noite")
```

O que foi acrescentado (nada do que já existia foi trocado):

| Arquivo | Para quê |
|---|---|
| `server/index.js` | liga os arquivos de `api/` a um servidor comum (entrega `req.body`, `req.query`, `res.status().json()`); só confia no IP e no endereço vindos do Cloudflare com o `PROXY_SEGREDO` |
| `Dockerfile`, `.dockerignore` | a "caixa" que o Cloud Run roda (leva `api/`, `lib/`, `analytics/`, `server/`) |
| `functions/api/[[caminho]].js` | o Cloudflare repassa `/api/*` ao Cloud Run (leva login, cookie da conta, assinatura do PagBank, IP real) |
| `functions/_vercel/image.js` | redutor de fotos no lugar do `/_vercel/image` da Vercel (mesmos sites e larguras) |
| `lib/cloudflare-arquivos.js`, `scripts/cloudflare-arquivos.js` | geram `_headers` e `_redirects` a partir do `vercel.json` (que continua sendo a fonte única) |
| `.github/workflows/rotina-noite.yml` | chama a rotina da noite todo dia (substitui o `crons` da Vercel) |
| `scripts/atualizar-servidor.sh` | atualiza o servidor da AWS com um comando (e volta sozinho para a versão anterior se a nova não subir) |

---

## Antes de começar (decisões)
1. **Domínio próprio.** Compre um (`.com.br`, uns R$ 40 por ano). Trocar o endereço do site faz o cliente perder carrinho, conta salva
   e app instalado, porque o celular guarda isso por endereço. Com domínio seu, daqui em diante dá para trocar de hospedagem sem ninguém notar.
2. **Firebase de teste.** Crie um segundo projeto Firebase (grátis) para o site da Vercel, para os pedidos de teste não sujarem o caixa,
   o estoque e a previsão da loja de verdade.
3. Faça os passos abaixo **no computador**. No celular dá, mas é bem mais difícil.

## Parte 1 — Servidor na AWS Lightsail (o que está no ar)
Montado em 13/10/2026: instância `servidor-loja` (Ubuntu 24.04, São Paulo), IP fixo `54.207.72.209`, firewall com 22, 80 e 443.
O Docker roda `server/index.js`; o **Caddy** cuida do HTTPS de `api.usebanca.com` e repassa para `127.0.0.1:8080`.

- **Chaves:** `~/segredos.env` no servidor (nunca no GitHub, nunca no chat). Para ver só os nomes: `sed 's/=.*/=***/' ~/segredos.env`.
  Além das da Vercel, o servidor precisa de: `PROXY_SEGREDO` (igual ao do Cloudflare), `PUBLIC_BASE_URL=https://usebanca.com`,
  `ALLOWED_ORIGIN=https://usebanca.com,https://www.usebanca.com,https://loja-banca.pages.dev` e
  `FIREBASE_WEB_API_KEY` (a mesma chave pública `AIza...` do Firebase: sem ela o **link de entrada do painel** não sai).
  `GEMINI_MODEL=gemini-2.5-flash` (o `gemini-flash-latest` vive lotado em horário de pico).
  Ao subir, o servidor escreve no registro os nomes das variáveis que estão vazias (`docker logs loja`).
- **Conferir:** `https://api.usebanca.com/saude` → `{"ok":true}`. Pelo site: `https://usebanca.com/api/saude` → `"ponte": true`
  quer dizer que o `PROXY_SEGREDO` do Cloudflare é igual ao do servidor. Se vier `false`, os freios por IP veem todos os
  clientes como um só e podem travar login e pedidos de todo mundo: corrija o segredo nos dois lados.
- **Atualizar o servidor** (o site se atualiza sozinho, o servidor NÃO): no terminal da AWS,
  `bash ~/loja/scripts/atualizar-servidor.sh`. Ele baixa o código, troca o contêiner e, se o novo não responder, volta sozinho
  para o anterior. Depois de mudar o `~/segredos.env`, rode o mesmo comando (só reiniciar não relê o arquivo).
- **Preparação feita uma vez** (deixa o comando acima funcionar e protege a máquina):
  1. chave de leitura do GitHub (o repositório é privado): `ssh-keygen -t ed25519 -N "" -f ~/.ssh/loja_deploy -C servidor-loja`,
     depois `cat ~/.ssh/loja_deploy.pub` e cole em GitHub → repositório → *Settings → Deploy keys → Add* (**sem** marcar escrita);
     `printf 'Host github.com\n  IdentityFile ~/.ssh/loja_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config`,
     `ssh-keyscan github.com >> ~/.ssh/known_hosts` e `git -C ~/loja remote set-url origin git@github.com:Bielroy/Site-banca1.git`;
  2. memória extra (evita travar ao montar a imagem): arquivo de troca de 1 GB em `/swapfile`;
  3. Caddy apontando para `127.0.0.1:8080` (o script publica a porta só para a própria máquina).
- **Reinício da máquina** ("System restart required" no terminal): pode reiniciar (`sudo reboot`) num horário calmo.
  Docker, contêiner e Caddy voltam sozinhos; a loja fica fora uns 2 minutos.
- **Não ligue a "nuvem laranja"** (proxy do Cloudflare) no registro `api` do DNS: o Caddy precisa receber a conexão direto para renovar o certificado.
- **Fim do período grátis da AWS (6 meses):** antes do fim, decida entre passar para o plano pago (alguns dólares por mês) ou mudar o servidor
  de lugar. O alerta de orçamento de US$ 5 avisa se começar a cobrar.

## Fotos no Cloudflare R2 (no lugar do ImgBB)

- **Onde ficam:** bucket `fotos-bancas` no R2, aberto em `https://fotos.usebanca.com` (domínio próprio do bucket).
  Foto nova do painel vai para `lojas/<loja>/...`; foto copiada do ImgBB vai para `migrado/...`.
- **Chaves:** 5 linhas no `~/segredos.env` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `R2_URL_PUBLICA`) e `bash ~/loja/scripts/atualizar-servidor.sh`. Token do R2 com "Object Read & Write" **só** nesse bucket.
  Conferir: `https://usebanca.com/api/saude` mostra `"fotos":"r2"`; a tela Plataforma → Chaves mostra "Ligado".
  Faltou ou errou uma linha: o servidor avisa na atualização ("variáveis vazias: R2_...") e as fotos seguem para o ImgBB.
- **Migrar as fotos antigas** (no terminal da AWS, depois de atualizar o servidor):
  1. `docker exec loja node server/migrar-fotos.js` — **simulação**: conta as fotos, confere se abrem, não grava nada.
  2. `docker exec loja node server/migrar-fotos.js --gravar` — copia para o R2 e troca os links no banco.
  Pode repetir: o que já foi copiado é pulado. `--pedidos` inclui as fotos dos pedidos antigos; `--limite=20` testa com poucas;
  `--desfazer` volta os links para o ImgBB (cada troca fica anotada em `migracao_fotos`).
  Foto que o ImgBB já perdeu: tenta a miniatura guardada pelo site; sem ela, sai na lista do relatório para a loja reenviar.

## PIX pelo Asaas (conta da plataforma + carteira de cada banca)
Quando a chave do Asaas está cadastrada, o PIX de todas as lojas sai por ele (o PagBank fica de lado; sem chave, nada muda).
- **Chave:** tela Plataforma → aba Chaves → "PIX automático (Asaas)". Comece pela chave do **sandbox** (`$aact_hmlg_...`): o site
  percebe pela chave se é teste ou produção. (Ou variável `ASAAS_API_KEY` no `~/segredos.env`.)
- **Aviso de pagamento (webhook):** no Asaas, Integrações → Webhooks → Adicionar. URL `https://usebanca.com/api/pagamento-asaas`,
  o **token** que a tela Plataforma mostra (botão Copiar) e os eventos de cobrança `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`.
  Sem esse token configurado aqui, todo aviso é recusado.
- **Carteira de cada banca:** na mesma tela, o `walletId` da conta Asaas da banca. A cobrança sai com split de 100% do valor
  líquido para ela (menos `ASAAS_COMISSAO_PCT`, se definida). Sem carteira, a loja não mostra PIX automático. A loja original
  recebe na conta da plataforma.
- Depois, em cada loja: painel → Configurações → ligar "PIX automático".
- O servidor precisa estar atualizado (`atualizar-servidor.sh`) para as rotas novas existirem.

<details><summary>Como era o plano antigo (Google Cloud Run), só para referência</summary>

1. Abra https://console.cloud.google.com e entre com a mesma conta do Firebase. Escolha **o mesmo projeto** do Firebase da loja.
2. **Cobrança:** o Cloud Run pede uma conta de cobrança com cartão. Há uma faixa grátis mensal (confira os números atuais na página de
   preços do Cloud Run). **Antes de qualquer coisa**, em *Faturamento → Orçamentos e alertas*, crie um orçamento de R$ 10 por mês com
   alerta por e-mail em 50%, 90% e 100%.
3. **Cloud Run → Criar serviço → "Implantar continuamente a partir de um repositório"** → conectar o GitHub → repositório `Bielroy/Site-banca1`,
   ramo `main` (para testar antes, escolha `rota-cloudflare`), tipo de build **Dockerfile**.
4. Região: **southamerica-east1 (São Paulo)**. Autenticação: **permitir invocações não autenticadas** (o login é feito pelo próprio código).
5. Em *Contêiner → Configurações*: memória 512 MiB, CPU 1, **tempo limite 300 s**, **instâncias mínimas 0**, **máximas 3** (3 é o teto de gasto).
6. **Variáveis e segredos** (copie os valores de Vercel → Settings → Environment Variables; **nunca cole senha ou chave no chat**):
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (cole inteira, com os `\n`), `PAGBANK_API_TOKEN`, `PAGBANK_ENV`,
   `GEMINI_API_KEY`, `IMGBB_API_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `CRON_SECRET`, `DIAGNOSTICO_SECRET`, e as outras que você usa
   (`GEMINI_MODEL`, `CHAT_LIMITE_DIA`, `COPILOTO_LIMITE_DIA`, `IA_PAINEL_LIMITE_DIA`, `LOGIN_TETO_HORA`, `CHECKOUT_TETO_LOJA`, `WHATSAPP_FALLBACK`).
   Novas:
   - `PROXY_SEGREDO`: um texto longo e aleatório (30 letras ou mais), gerado no gerenciador de senhas. Guarde para a Parte 2.
   - `PUBLIC_BASE_URL`: o endereço do site novo, ex. `https://www.seudominio.com.br`
   - `ALLOWED_ORIGIN`: o mesmo endereço (se tiver mais de um, separe por vírgula)
7. Quando terminar, copie o endereço do serviço (`https://...a.run.app`). Abra `ESSE_ENDEREÇO/saude`: deve mostrar `{"ok":true}`.

</details>

## Parte 2 — Cloudflare Pages (o site)
1. Crie conta em https://dash.cloudflare.com (grátis). **Workers e Pages → Criar → Pages → Conectar ao Git** → `Bielroy/Site-banca1`.
2. Ramo de produção: `main` (para testar, `rota-cloudflare`).
3. **Comando de build:** `npm run build:cloudflare`   **Pasta de saída:** `dist`
4. Variáveis (Configurações → Variáveis e segredos), nas duas abas (produção e prévia):
   - `NODE_VERSION` = `22`
   - `VITE_FIREBASE_API_KEY` (**obrigatória**: sem ela a loja abre mas os produtos nunca aparecem; é a chave pública `AIza...`
     de Firebase → Configurações do projeto → Seus apps → Config). Entra no site na hora do build: mudou, faça um deploy novo.
   - `VITE_VAPID_PUBLIC_KEY` = o `VAPID_PUBLIC_KEY` do servidor (o par tem de ser o mesmo, senão os avisos de pedido novo não chegam).
     `VITE_DOMINIO_LOJAS`, `VITE_DOMINIOS_PROPRIOS`: só se usar endereço por loja (sem elas, qualquer endereço abre a loja principal).
   - `API_ORIGEM` = `https://api.usebanca.com`, sem barra no fim
   - `PROXY_SEGREDO` = o **mesmo** texto do servidor (tipo *Segredo*)
5. Salvar e implantar. Abra o endereço `*.pages.dev` e confira a loja.

## Parte 3 — Domínio e endereços
1. Cloudflare Pages → *Domínios personalizados* → adicione o seu domínio. (Lojas em subendereço, tipo `loja.seudominio.com.br`: o plano grátis
   do Pages pode não aceitar "curinga"; teste antes de prometer isso a um cliente.)
2. **Firebase → Authentication → Configurações → Domínios autorizados:** acrescente o domínio novo (e o `*.pages.dev`, se for testar nele).
3. **PagBank:** o aviso de pagamento usa `PUBLIC_BASE_URL/api/pagamento-webhook`. Pedidos novos já saem com o endereço novo.
4. Feito: `index.html`, `privacidade.html`, `feira.html`, `sitemap.xml` e `robots.txt` já apontam para `https://usebanca.com`.
   Falta (quando a Vercel sair de vez): `.github/workflows/velocidade.yml` e a origem fixa de `lib/http.js`.
5. **Fotos menores:** em Cloudflare → `usebanca.com` → *Images → Transformations*, ligue para a zona. Sem isso as fotos vêm no tamanho
   original (mais lentas). No endereço `*.pages.dev` o Cloudflare não guarda cópia das fotos: teste a velocidade no domínio próprio.
   Plano grátis: 5.000 transformações únicas por mês (cada foto em cada tamanho conta uma vez). Passou disso, a loja usa a foto original.
6. **Functions só onde precisa:** o build escreve `dist/_routes.json` (lib/cloudflare-arquivos.js). Só `/`, `/index.html`, `/api/*` e
   `/_vercel/image` passam pelas Functions; o resto (código, estilos, ícones) é estático, grátis e ilimitado. Sem esse arquivo, cada
   abertura de loja gastava ~75 das 100 mil Functions por dia do plano grátis. Conferir: Workers e Pages → projeto → Métricas.

## Parte 4 — Rotina da noite
GitHub → repositório → *Settings → Secrets and variables → Actions → New repository secret*:
`API_ORIGEM` (`https://api.usebanca.com`) e `CRON_SECRET` (o mesmo do servidor). Depois, *Actions → Rotina da noite → Run workflow* para testar:
deve terminar verde. **Atenção:** o GitHub só roda rotinas agendadas do ramo principal (`main`). Enquanto a rota estiver só no
`rota-cloudflare`, quem roda a rotina é a Vercel (e está certo assim). Quando juntar no `main`, crie os segredos acima e apague o
bloco `"crons"` do `vercel.json` no mesmo dia, para a rotina não rodar duas vezes.

## Parte 5 — Conferir antes de divulgar
- [ ] Loja abre, mostra produtos e **fotos** (as fotos pequenas passam por `/_vercel/image`; se o Cloudflare não reduzir, vêm no tamanho original, mais pesadas)
- [ ] Fazer um pedido de teste (cupom de 100%) e pesar no painel
- [ ] Login do painel e da equipe (link por e-mail)
- [ ] PIX: gerar o código e, com o PagBank liberado, pagar um valor pequeno e ver o pedido virar "pago" (é o aviso que passa por `x-authenticity-token`)
- [ ] Chat/assistente responde (resposta em tempo real)
- [ ] Instalar o app no celular e abrir a loja
- [ ] Preview da aparência no painel (`/previa`) abre dentro do painel
- [ ] Rodar a rotina da noite à mão e ver verde

## Voltar atrás
Nada da Vercel foi desligado nem mudado. Se algo der errado, a Vercel continua no ar com o mesmo código. Para voltar a produção para lá é só apontar o
domínio de volta.

## Limites que você precisa conhecer
- **Servidor único:** é uma máquina só. Se ela cair, o site abre e mostra produtos (vêm do Firebase), mas pedido, chat e PIX param até ela voltar.
- **Cloudflare grátis:** 100 mil chamadas de função por dia (todo `/api` e toda foto reduzida contam). Dá para milhares de visitas por dia; acima disso, o plano pago é uns US$ 5 por mês.
- **Firebase grátis (Spark):** limite diário de leituras e gravações. Se o painel avisar que estourou, o plano pago por uso costuma ficar bem barato; ative alertas de orçamento.
- **Páginas inexistentes:** no Cloudflare Pages, um endereço que não existe abre a página inicial (na Vercel dava erro 404).
- Os endereços `/admin.html` e `/plataforma.html` passam a abrir como `/admin` e `/plataforma` (o Cloudflare tira o `.html`); parâmetros como `?loja=` são mantidos.
