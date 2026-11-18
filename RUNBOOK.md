# RUNBOOK — o que fazer quando a loja dá problema

Uma página. Comandos do servidor: no terminal da AWS (Lightsail → `servidor-loja` → **Conectar**). Nunca cole chave ou senha no chat.

**Quem chamar:** 1º [NOME E TELEFONE DE QUEM CUIDA DO SISTEMA] · 2º [NOME E TELEFONE DA SEGUNDA PESSOA] · AWS/Cloudflare/GitHub: a conta é do dono.

## Primeiro, 30 segundos de diagnóstico
| Abra | Certo | Se não |
|---|---|---|
| `https://api.usebanca.com/saude` | `{"ok":true}` | servidor fora → (i) |
| `https://usebanca.com/api/saude` | `"ponte":true`, `"versao"` igual ao do site | `ponte:false` → `PROXY_SEGREDO` diferente (ROTA-CLOUDFLARE.md) · 503 → `API_ORIGEM` no Cloudflare |
| `https://usebanca.com/versao.json` | `commit` do site | — |

**Registros (logs):** servidor `docker logs --tail 100 loja` (procurar: `docker logs loja 2>&1 | grep -iE "erro|falha" | tail -30`) ·
HTTPS (Caddy) `sudo journalctl -u caddy --since "1 hour ago" | tail -50` · cópia diária `tail -n 30 ~/backups/backup.log` e `~/backups/agendador.log` ·
site: Cloudflare → Workers & Pages → projeto → **Deployments** · GitHub → **Actions** (testes, "Atualizar o servidor", "Rotina da noite").

## (i) A loja não recebe pedidos
O cliente que não consegue pedir é mandado sozinho para o WhatsApp da loja (plano B), então os pedidos chegam por lá enquanto isso.
1. `docker ps` — tem de aparecer `loja` com "Up". Se não: `docker start loja` (ou `bash ~/loja/scripts/atualizar-servidor.sh`).
2. Está "Up" mas `/saude` não responde: `docker restart loja`, espere 20 s, abra `/saude` de novo.
3. Começou logo depois de uma atualização: **voltar o servidor** (abaixo).
4. A máquina não responde nem ao "Conectar": Lightsail → instância → **Reiniciar**. Volta sozinha em ~2 min (Docker e Caddy sobem juntos).
5. Disco cheio (`df -h` acima de 95%): `docker image prune -f` e apague cópias velhas em `~/backups`.

## (ii) O painel não abre
1. A loja abre e o painel não: o site novo pode ter quebrado. **Voltar o site** (abaixo).
2. "Não chegou o link de entrada": o plano gratuito do Firebase manda só 5 links por dia para o projeto inteiro. Entre com Face ID/digital
   em um aparelho que já entrou, ou espere o dia virar.
3. Só num celular: apague os dados do site no navegador (ou reinstale o app do Painel) e entre de novo.
4. Firebase fora: https://status.firebase.google.com.

## (iii) O PIX não aparece
- **PIX copia e cola** (chave da loja): painel → Configurações → Chave PIX da loja preenchida? Pedido com item a pesar só mostra o PIX depois da pesagem.
- **PIX automático** (Asaas/PagBank): painel → Configurações → "PIX automático" ligado? Plataforma → Chaves → chave do Asaas e carteira da loja preenchidas?
  `docker logs loja 2>&1 | grep -iE "pix|asaas|pagbank" | tail -20` mostra o motivo (CPF recusado, chave errada, banco fora).
- Pago e não marcou "PAGO": aviso de pagamento (webhook) no Asaas apontando para `https://usebanca.com/api/pagamento-asaas` com o token da tela Plataforma.
  Enquanto isso, a equipe confere no extrato e marca **PIX recebido** no cartão do pedido.

## (iv) Um cliente pede para apagar os dados (LGPD) — prazo: 15 dias
1. Anote a data do pedido, a loja e o telefone usado nos pedidos.
2. Ver o que será apagado: `docker exec -it loja node scripts/apagar-cliente.js --loja <id-da-loja> --telefone <DDD+número>` (a loja original é `banca`).
3. Apagar: o mesmo comando com `--gravar`, e digite `APAGAR`. Os pedidos ficam com os valores (caixa) e sem nome, telefone e endereço.
4. Responda ao cliente: feito; cópias de segurança antigas somem sozinhas em até 60 dias; as mensagens no WhatsApp da loja precisam ser apagadas no aparelho.

## Voltar uma versão
- **Servidor:** o `atualizar-servidor.sh` já volta sozinho se o novo não responder. Para voltar à mão para a versão anterior:
  `docker rm -f loja && docker run -d --name loja --restart unless-stopped -p 127.0.0.1:8080:8080 --env-file ~/segredos.env -v ~/.loja-versao:/app/VERSAO:ro --log-opt max-size=10m --log-opt max-file=3 loja:anterior`
  Depois desfaça a mudança no GitHub (botão **Revert** no PR): com a atualização automática ligada, a próxima mudança traria o erro de volta.
- **Site:** Cloudflare → Workers & Pages → projeto → **Deployments** → no deploy de antes do problema, **⋯ → Rollback to this deployment**. Em seguida, **Revert** no PR.

## Alerta de queda (UptimeRobot, grátis) — passo do dono, 10 min
uptimerobot.com → criar conta → **Add New Monitor**:
1. Tipo **Keyword**, URL `https://api.usebanca.com/saude`, palavra `"ok":true`, intervalo **5 min**, nome "Servidor da loja".
2. Tipo **Keyword**, URL `https://usebanca.com/api/saude`, palavra `"ponte":true`, intervalo **5 min**, nome "Site → servidor".
3. Tipo **HTTP(s)**, URL `https://usebanca.com/`, intervalo **5 min**, nome "Site".
4. **Alert Contacts**: o e-mail do dono E o da segunda pessoa, e o app do UptimeRobot no celular dos dois (aviso por push). Alertar quando cair e quando voltar.
