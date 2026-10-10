# Rota A — site no Cloudflare Pages e servidor no Google Cloud Run

Objetivo: tirar o site comercial da Vercel grátis (que só vale para uso pessoal) sem pagar a Vercel Pro,
e **manter a Vercel funcionando para os seus testes**. O código de `api/` não mudou: o mesmo código roda nos dois lugares.

```
cliente ─► Cloudflare Pages (páginas, cabeçalhos, fotos) ─► /api/* ─► Google Cloud Run (server/index.js)
                                                                      └► Firebase (banco e login)
GitHub Actions (todo dia 8h UTC) ─► Cloud Run /api/analytics   (a "rotina da noite")
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

---

## Antes de começar (decisões)
1. **Domínio próprio.** Compre um (`.com.br`, uns R$ 40 por ano). Trocar o endereço do site faz o cliente perder carrinho, conta salva
   e app instalado, porque o celular guarda isso por endereço. Com domínio seu, daqui em diante dá para trocar de hospedagem sem ninguém notar.
2. **Firebase de teste.** Crie um segundo projeto Firebase (grátis) para o site da Vercel, para os pedidos de teste não sujarem o caixa,
   o estoque e a previsão da loja de verdade.
3. Faça os passos abaixo **no computador**. No celular dá, mas é bem mais difícil.

## Parte 1 — Google Cloud Run (o servidor)
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

## Parte 2 — Cloudflare Pages (o site)
1. Crie conta em https://dash.cloudflare.com (grátis). **Workers e Pages → Criar → Pages → Conectar ao Git** → `Bielroy/Site-banca1`.
2. Ramo de produção: `main` (para testar, `rota-cloudflare`).
3. **Comando de build:** `npm run build:cloudflare`   **Pasta de saída:** `dist`
4. Variáveis (Configurações → Variáveis e segredos), nas duas abas (produção e prévia):
   - `NODE_VERSION` = `22`
   - `VITE_FIREBASE_API_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_DOMINIO_LOJAS`, `VITE_DOMINIOS_PROPRIOS` (os mesmos da Vercel)
   - `API_ORIGEM` = o endereço do Cloud Run, sem barra no fim
   - `PROXY_SEGREDO` = o **mesmo** texto do Cloud Run (tipo *Segredo*)
5. Salvar e implantar. Abra o endereço `*.pages.dev` e confira a loja.

## Parte 3 — Domínio e endereços
1. Cloudflare Pages → *Domínios personalizados* → adicione o seu domínio. (Lojas em subendereço, tipo `loja.seudominio.com.br`: o plano grátis
   do Pages pode não aceitar "curinga"; teste antes de prometer isso a um cliente.)
2. **Firebase → Authentication → Configurações → Domínios autorizados:** acrescente o domínio novo (e o `*.pages.dev`, se for testar nele).
3. **PagBank:** o aviso de pagamento usa `PUBLIC_BASE_URL/api/pagamento-webhook`. Pedidos novos já saem com o endereço novo.
4. Troque `site-banca1.vercel.app` pelo domínio novo em `index.html` (canonical, og:url, og:image), `sitemap.xml`, `robots.txt` e
   `.github/workflows/velocidade.yml`. A lista de origens fixas de `lib/http.js` também (os testes avisam onde falta).

## Parte 4 — Rotina da noite
GitHub → repositório → *Settings → Secrets and variables → Actions → New repository secret*:
`API_ORIGEM` (endereço do Cloud Run) e `CRON_SECRET` (o mesmo do Cloud Run). Depois, *Actions → Rotina da noite → Run workflow* para testar:
deve terminar verde. **Se a Vercel e o Cloud Run usarem o mesmo Firebase**, apague o bloco `"crons"` do `vercel.json`
para a rotina não rodar duas vezes.

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
- **Primeira chamada depois de um tempo parado:** o Cloud Run com 0 instâncias leva 1 a 3 segundos para acordar. Pedidos em horário de pico não sentem. Se incomodar, `instâncias mínimas = 1` custa dinheiro.
- **Cloudflare grátis:** 100 mil chamadas de função por dia (todo `/api` e toda foto reduzida contam). Dá para milhares de visitas por dia; acima disso, o plano pago é uns US$ 5 por mês.
- **Firebase grátis (Spark):** limite diário de leituras e gravações. Se o painel avisar que estourou, o plano pago por uso costuma ficar bem barato; ative alertas de orçamento.
- **Páginas inexistentes:** no Cloudflare Pages, um endereço que não existe abre a página inicial (na Vercel dava erro 404).
- Os endereços `/admin.html` e `/plataforma.html` passam a abrir como `/admin` e `/plataforma` (o Cloudflare tira o `.html`); parâmetros como `?loja=` são mantidos.
