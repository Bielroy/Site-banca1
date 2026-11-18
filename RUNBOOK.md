# RUNBOOK — o que fazer quando a loja dá problema

Uma página. Comandos do servidor: no terminal da AWS (Lightsail → `servidor-loja` → **Conectar**). Nunca cole chave ou senha no chat.

**Quem chamar:** 1º [NOME E TELEFONE DE QUEM CUIDA DO SISTEMA] · 2º [NOME E TELEFONE DA SEGUNDA PESSOA] · AWS/Cloudflare/GitHub: a conta é do dono.
**Para a 2ª pessoa conseguir agir sozinha:** acesso às contas AWS, Cloudflare e GitHub, e o **cofre de senhas compartilhado** com o
`~/segredos.env` INTEIRO (todas as chaves do servidor, inclusive a `DADOS_CHAVE`). Sem isso, se a máquina se perder, só uma pessoa reergue.

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
4. Responda ao cliente: feito; as cópias já feitas expiram sozinhas (7 dias dentro do Firebase e no servidor, 60 dias no R2) e, se uma cópia
   for restaurada, a pessoa é apagada de novo sozinha (marca em `plataforma/lgpd_apagados`); as mensagens no WhatsApp da loja precisam ser apagadas no aparelho.

## (v) Máquina nova do zero (a AWS perdeu o servidor) — ≈ 1 h, qualquer uma das duas pessoas
Precisa só do **cofre de senhas compartilhado** (o `~/segredos.env` INTEIRO está lá, PUBLICAR.md 4m) e do acesso à AWS e ao GitHub.
1. Lightsail → **Create instance** → São Paulo, Linux, **Ubuntu 24.04**, plano igual ao anterior, nome `servidor-loja`.
   Rede: **anexe o IP fixo** `54.207.72.209` (Networking → Static IP → Attach) e libere 22, 80 e 443 no firewall.
2. No terminal da máquina nova:
   `sudo apt-get update && sudo apt-get install -y docker.io git caddy && sudo usermod -aG docker $USER` — saia e entre de novo no terminal.
3. Memória extra: `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`
4. Chave de leitura do GitHub e o código (ROTA-CLOUDFLARE.md, "Preparação feita uma vez", passo 1: nova deploy key), depois
   `git clone git@github.com:Bielroy/Site-banca1.git ~/loja && git -C ~/loja checkout rota-cloudflare`
5. Chaves: `nano ~/segredos.env`, cole o conteúdo do cofre, salve (Ctrl+O, Enter, Ctrl+X) e `chmod 600 ~/segredos.env`.
   **Antes de subir o servidor, prove que a chave é a certa:** baixe do R2 a pasta do último dia (`copias-banca` → `banco/<dia>/`, todos os
   arquivos) para `~/backups/<dia>/` e rode `bash ~/loja/scripts/restaurar-backup.sh ~/backups/<dia> --conferir-chave` colando a
   `DADOS_CHAVE` do cofre. Tem de dizer "Chave OK". (Se subir com a chave errada, o servidor TRAVA o cofre: os pedidos pelo site param e
   vão pelo WhatsApp, `/api/saude` mostra `"chave":"diferente"` e o celular do dono recebe alerta.)
6. HTTPS: `printf 'api.usebanca.com {\n  reverse_proxy 127.0.0.1:8080\n}\n' | sudo tee /etc/caddy/Caddyfile && sudo systemctl reload caddy`
7. `bash ~/loja/scripts/atualizar-servidor.sh` (sobe o servidor) e `bash ~/loja/scripts/ligar-backup.sh` (cópia diária).
8. Conferir: `https://api.usebanca.com/saude` → `{"ok":true}`; `https://usebanca.com/api/saude` → `"ponte":true` e `"versao"`.
9. Se o Firebase também se perdeu: restaurar a última cópia do R2 (PUBLICAR.md, "Ensaio de restauração", com `--producao --chave`).
   Baixe de `banco/` as pastas desde a última cópia COMPLETA até o último dia (o script monta a completa + as incrementais).
   O `--credenciais` é a chave da conta de serviço do projeto: Firebase → ⚙ Configurações do projeto → **Contas de serviço** →
   **Gerar nova chave privada** (baixa um JSON). Envie pelo menu do terminal da Lightsail, use, e APAGUE o JSON do servidor e do
   computador logo depois (`rm ~/<arquivo>.json`); no Firebase, apague também a chave em Contas de serviço → Gerenciar chaves.
10. Se usava a atualização automática: refaça a chave do GitHub (PUBLICAR.md 4m, "Servidor atualizado sozinho") e troque o `SSH_KNOWN_HOSTS`.

## Atualizar o servidor
O site muda sozinho a cada mudança no GitHub; o servidor muda quando o GitHub entra por SSH (ligado em PUBLICAR.md 4m) ou à mão:
`bash ~/loja/scripts/atualizar-servidor.sh` (terminal da AWS). Ele baixa o código, troca o contêiner e volta sozinho se o novo não responder.
**Na primeira vez depois desta mudança, rode DUAS vezes:** a primeira ainda executa o script velho (ele se atualiza junto com o código);
a segunda já grava a versão. Confira em `https://usebanca.com/api/saude` que aparece `"versao"`.

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
