# Pendências da Banca Adair e Pedrina

Lista viva do que falta fazer. Atualizada em 22/10/2026.
Regra de sempre: nada vai para a `main` (reserva da Vercel); só a `rota-cloudflare`.

## Segurança (prioridade, nesta ordem)

1. **Ligar a trava `EXIGIR_PROXY=1` no servidor.**
   - Hoje não sei se está ligada. Sem ela, quem chamar o servidor direto escreve o próprio `X-Forwarded-For` e escapa do limite de pedidos por IP.
   - Passos: conferir (sem mostrar o valor) que `PROXY_SEGREDO` é igual no Cloudflare Pages e no servidor, ligar `EXIGIR_PROXY=1`, reiniciar com `bash ~/loja/scripts/atualizar-servidor.sh`, e testar: chamada direta ao servidor deve dar 403 e o site `usebanca.com` deve continuar funcionando.
   - `LIMITE_POR_MINUTO` fica em 600 por endereço: dá folga para muita gente atrás do mesmo endereço da operadora.
2. **Histórico do servidor.**
   - `grep -c DADOS_CHAVE ~/.bash_history` — se der mais que zero, apagar com `sed -i '/DADOS_CHAVE/d' ~/.bash_history` e pensar em gerar chave nova.
   - Teste de recuperação da chave: conferir que a cópia guardada tem 44 caracteres e termina em `=`.
3. **Regras do Firebase.** Nada publica `firestore.rules` e `storage.rules` sozinho. Comparar o que está no console do Firebase (data e texto) com os arquivos do repositório e publicar se estiver diferente.
4. **Contas.** Verificação em duas etapas em Google, GitHub, Cloudflare, Firebase e AWS.
5. **Firewall da Lightsail.** Só 80/443 abertos para o mundo; SSH restrito.
6. **Para o site não cair (aguentar o pico).** O código já está pronto; falta você ligar no servidor e nos painéis:
   1. **Conferir a ponte do Cloudflare (o mais importante).** Abra `https://usebanca.com/api/saude`. Tem de aparecer `"ponte":true`.
      Se aparecer `false`, o servidor vê TODOS os clientes como um só e os freios por endereço barram a loja inteira no pico:
      acerte o `PROXY_SEGREDO` (igual no Cloudflare Pages e no `~/segredos.env`) e rode `bash ~/loja/scripts/atualizar-servidor.sh`.
   2. **Atualizar o servidor** (`bash ~/loja/scripts/atualizar-servidor.sh`): leva a vitrine num documento só, o backup e os limites novos.
   3. **Publicar as regras do Firebase** (`firestore.rules`; passo a passo no PUBLICAR.md, seção 4l): sem isso a loja continua funcionando,
      mas no jeito antigo (lê produto por produto), sem a economia de leituras.
   4. **Ligar o backup diário fora do Firebase**: `bash ~/loja/scripts/ligar-backup.sh` (uma vez). As cópias ficam em `~/backups`, 60 dias.
   5. **Alerta de queda:** UptimeRobot (grátis) olhando `https://api.usebanca.com/saude` a cada 5 min, avisando por e-mail/app.
   6. **Firebase Blaze com orçamento:** Google Cloud → Faturamento → Orçamentos e alertas (ex.: R$ 20/mês, aviso em 50% e 90%).
   7. **AWS:** Lightsail → instância → ver o plano (memória). Antes de acabar o período grátis, decidir o plano pago; ligar o alerta de orçamento.
   8. Espaço em disco (`df -h`), "7 updates" e "System restart required" no servidor (reiniciar num horário calmo).
7. **`npm audit`** (só leitura) para ver dependências com problema.
8. **PIX/PagBank.** Token vazio: PIX online está desligado de propósito. Quando o token chegar, testar primeiro no `PAGBANK_ENV=sandbox`, incluindo o webhook, antes de ligar de verdade.

## Funcionalidades

- Impressão automática (Golden Sky GS-FJ80M-UB, Bluetooth direto): testar no celular da banca — ao chegar, ao aceitar, depois de fechar e abrir o painel, e com a impressora desligada.
- **App Ponte da Banca (etapa 2, imprime com a tela bloqueada)** — ramo `app-impressora`, ainda NÃO juntado ao `rota-cloudflare`.
  1. Criar o segredo `PONTE_SENHA` no GitHub (Settings → Secrets and variables → Actions → New repository secret; valor: uma frase longa qualquer). Sem ele o APK sai com chave de TESTE e o definitivo pede desinstalar o de teste.
  2. Testar o APK no celular da banca: escolher a impressora, imprimir teste, ligar à loja com o código do painel, pedido de teste com a tela bloqueada, impressora desligada e ligada de novo, celular reiniciado.
  3. Depois do teste: juntar `app-impressora` ao `rota-cloudflare` (só com ok) e atualizar o servidor (`bash ~/loja/scripts/atualizar-servidor.sh`): a rota `/api/ponte` mora lá.

- Kit/cesta como pacote: decisão pendente (minha recomendação: não fazer).
- Promoção "4 por R$ 10" no balcão (`api/pdv.js`) ainda não considera a mistura de pacotes.
- Temperos aparecem como "2x" no WhatsApp e no painel; ficaria melhor "2 potinhos".
- Deploy no Cloudflare dos últimos commits e reinstalar o app do Painel no Android.
- Teste em celular de verdade.

## Já resolvido (para não repetir)

- **Pico de pedidos (22/10/2026):** plano B do pedido (servidor fora do ar → o pedido vai pronto no WhatsApp da banca), vitrine num documento só (1 leitura por visita em vez de 1 por produto; `lib/catalogo.js`, `js/catalogo-loja.js`, volta sozinha ao jeito antigo se algo falhar), limite de pedidos por endereço 8 → 20 em 10 min (operadora/feira), backup diário fora do Firebase (`server/backup.js`, `scripts/ligar-backup.sh`), teste de carga (`node testes/carga/carga.js`, roda também no GitHub). A cópia diária dentro do Firebase guarda pedidos de 31 dias (era 90: gastava leitura demais).

- Cupom de 100% (família/cortesia) gera pedido de R$ 0,00 **de propósito**. Não é brecha.
- Cofre ativo em produção, dados antigos cifrados, chave guardada.
