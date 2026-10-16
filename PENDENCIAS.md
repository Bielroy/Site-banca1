# Pendências da Banca Adair e Pedrina

Lista viva do que falta fazer. Atualizada em 15/10/2026.
Regra de sempre: nada vai para a `main` (reserva da Vercel); só a `rota-cloudflare`.

## Segurança (prioridade, nesta ordem)

1. **Ligar a trava `EXIGIR_PROXY=1` no servidor.**
   - Hoje não sei se está ligada. Sem ela, quem chamar o servidor direto escreve o próprio `X-Forwarded-For` e escapa do limite de pedidos por IP.
   - Passos: conferir (sem mostrar o valor) que `PROXY_SEGREDO` é igual no Cloudflare Pages e no servidor, ligar `EXIGIR_PROXY=1`, reiniciar com `bash ~/loja/scripts/atualizar-servidor.sh`, e testar: chamada direta ao servidor deve dar 403 e o site `usebanca.com` deve continuar funcionando.
   - Depois: baixar `LIMITE_POR_MINUTO` (hoje 600 por IP, folgado demais para uma banca).
2. **Histórico do servidor.**
   - `grep -c DADOS_CHAVE ~/.bash_history` — se der mais que zero, apagar com `sed -i '/DADOS_CHAVE/d' ~/.bash_history` e pensar em gerar chave nova.
   - Teste de recuperação da chave: conferir que a cópia guardada tem 44 caracteres e termina em `=`.
3. **Regras do Firebase.** Nada publica `firestore.rules` e `storage.rules` sozinho. Comparar o que está no console do Firebase (data e texto) com os arquivos do repositório e publicar se estiver diferente.
4. **Contas.** Verificação em duas etapas em Google, GitHub, Cloudflare, Firebase e AWS.
5. **Firewall da Lightsail.** Só 80/443 abertos para o mundo; SSH restrito.
6. **Para o site não cair.** Backup do banco fora do Firebase, alerta de gasto/cota (Firebase e AWS), espaço em disco, "7 updates" e "System restart required" no servidor.
7. **`npm audit`** (só leitura) para ver dependências com problema.
8. **PIX/PagBank.** Token vazio: PIX online está desligado de propósito. Quando o token chegar, testar primeiro no `PAGBANK_ENV=sandbox`, incluindo o webhook, antes de ligar de verdade.

## Funcionalidades

- Impressão automática (Golden Sky GS-FJ80M-UB, Bluetooth direto): testar no celular da banca — ao chegar, ao aceitar, depois de fechar e abrir o painel, e com a impressora desligada. Etapa 2 (se precisar imprimir com o celular bloqueado): app Android próprio.

- Kit/cesta como pacote: decisão pendente (minha recomendação: não fazer).
- Promoção "4 por R$ 10" no balcão (`api/pdv.js`) ainda não considera a mistura de pacotes.
- Temperos aparecem como "2x" no WhatsApp e no painel; ficaria melhor "2 potinhos".
- Deploy no Cloudflare dos últimos commits e reinstalar o app do Painel no Android.
- Teste em celular de verdade.

## Já resolvido (para não repetir)

- Cupom de 100% (família/cortesia) gera pedido de R$ 0,00 **de propósito**. Não é brecha.
- Cofre ativo em produção, dados antigos cifrados, chave guardada.
