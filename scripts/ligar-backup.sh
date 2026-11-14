#!/usr/bin/env bash
# =====================================================================
#  scripts/ligar-backup.sh — LIGA A CÓPIA DIÁRIA DO BANCO NO SERVIDOR (rode UMA vez, no terminal da AWS).
#
#      bash ~/loja/scripts/ligar-backup.sh
#
#  Põe no agendador do servidor (crontab) a cópia de todo dia às 06:40 UTC (03:40 em Brasília) e já faz
#  a primeira, para você ver funcionando. Rodar de novo não duplica nada.
#  Para ver as cópias:   ls -lh ~/backups
#  Para desligar:        crontab -l | grep -v backup-diario.sh | crontab -
# =====================================================================
set -euo pipefail
SCRIPT="$HOME/loja/scripts/backup-diario.sh"
[ -f "$SCRIPT" ] || { echo "Não achei $SCRIPT. Rode antes: bash ~/loja/scripts/atualizar-servidor.sh"; exit 1; }
LINHA="40 6 * * * bash $SCRIPT >/dev/null 2>&1"
atual=$(crontab -l 2>/dev/null || true)
if echo "$atual" | grep -q "backup-diario.sh"; then
  echo "A cópia diária já estava ligada."
else
  { [ -n "$atual" ] && echo "$atual"; echo "$LINHA"; } | crontab -
  echo "Cópia diária ligada: todo dia às 03:40 (horário de Brasília)."
fi
echo "Fazendo a primeira cópia agora..."
if bash "$SCRIPT"; then
  echo; ls -lh "$HOME/backups" | tail -n 5
  echo; echo "Pronto. As cópias ficam em ~/backups (últimos 60 dias)."
else
  echo; echo "A primeira cópia não deu certo. Veja o motivo:  tail -n 20 ~/backups/backup.log"
  exit 1
fi
