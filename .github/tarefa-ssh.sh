#!/usr/bin/env bash
# Usado por .github/workflows/tarefas-servidor.yml: entra no servidor por SSH e pede UMA tarefa do cardápio.
# Recebe tudo por variável de ambiente (nunca por ${{ }} dentro do comando: assim um texto estranho no campo
# "nome" não vira comando). Quem decide se a tarefa pode é o servidor (scripts/tarefas-servidor.sh).
set -uo pipefail

resumo() { echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
falhar() { echo "::error title=$1::$2"; resumo "### $1"; resumo "$2"; exit 1; }

faltam=""
[ -n "${SSH_HOST:-}" ] || faltam="$faltam SSH_HOST"
[ -n "${SSH_USER:-}" ] || faltam="$faltam SSH_USER"
[ -n "${CHAVE:-}" ]    || faltam="$faltam ${CHAVE_NOME:-SSH_KEY}"
[ -z "$faltam" ] || falhar "Tarefa NÃO foi feita" "Faltam os segredos:$faltam. Veja PUBLICAR.md, \"Bot do servidor\"."

[[ "${TAREFA:-}" =~ ^[a-z][a-z-]{1,30}$ ]] || falhar "Tarefa recusada" "Tarefa inválida."
pedido="$TAREFA"
if [ "$TAREFA" = "trocar-segredo" ]; then
  [[ "${NOME:-}" =~ ^[A-Z][A-Z0-9_]{1,40}$ ]] || falhar "Tarefa recusada" "Para trocar-segredo, o campo nome é o NOME da chave em maiúsculas (ex.: CRON_SECRET), nunca o valor."
  [ -n "${VALOR_NOVO:-}" ] || falhar "Tarefa NÃO foi feita" "Falta o segredo VALOR_NOVO no ambiente producao (Settings → Environments → producao). Nada foi mudado."
  pedido="$TAREFA $NOME"
fi

install -m 700 -d ~/.ssh
printf '%s\n' "$CHAVE" > ~/.ssh/servidor && chmod 600 ~/.ssh/servidor
if [ -n "${SSH_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
else
  echo "::warning title=SSH sem impressão digital::crie o segredo SSH_KNOWN_HOSTS (PUBLICAR.md) para o GitHub só conversar com o SEU servidor."
  ssh-keyscan -T 15 "$SSH_HOST" > ~/.ssh/known_hosts 2>/dev/null
fi

ssh_srv() { ssh -i ~/.ssh/servidor -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 "$SSH_USER@$SSH_HOST" "$pedido"; }
resumo "### Tarefa do servidor: $pedido"
if [ "$TAREFA" = "trocar-segredo" ]; then
  printf '%s\n' "$VALOR_NOVO" | ssh_srv 2>&1 | tee saida.txt; rc=${PIPESTATUS[1]}
else
  ssh_srv < /dev/null 2>&1 | tee saida.txt; rc=${PIPESTATUS[0]}
fi
rm -f ~/.ssh/servidor
{ echo '```'; tail -n 30 saida.txt; echo '```'; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
[ "$rc" = 0 ] || falhar "A tarefa falhou" "O servidor respondeu com erro ($rc). Veja o que ele disse acima."
