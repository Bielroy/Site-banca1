#!/usr/bin/env bash
# =====================================================================
#  scripts/ligar-backup.sh — LIGA A CÓPIA DIÁRIA DO BANCO NO SERVIDOR (rode UMA vez, no terminal da AWS).
#
#      bash ~/loja/scripts/ligar-backup.sh
#
#  Põe no agendador do servidor (crontab) a cópia de todo dia às 09:10 UTC (06:10 em Brasília), depois da rotina da noite das 08:00 UTC, e já faz
#  a primeira, para você ver funcionando. Rodar de novo não duplica nada (e troca a linha antiga, que jogava
#  a saída fora, pela nova, que guarda em ~/backups/agendador.log).
#  Para ver as cópias:   ls -lh ~/backups
#  Para ver o que houve: tail -n 30 ~/backups/backup.log   (e ~/backups/agendador.log)
#  Para desligar:        crontab -l | grep -v backup-diario.sh | crontab -
# =====================================================================
set -euo pipefail
SCRIPT="$HOME/loja/scripts/backup-diario.sh"
[ -f "$SCRIPT" ] || { echo "Não achei $SCRIPT. Rode antes: bash ~/loja/scripts/atualizar-servidor.sh"; exit 1; }
mkdir -p "$HOME/backups"
# a saída do agendador vai para um arquivo (antes ia para /dev/null: erro do agendador sumia sem rastro).
# O próprio backup-diario.sh corta esse arquivo para não crescer sem fim.
LINHA="10 9 * * * bash $SCRIPT >> $HOME/backups/agendador.log 2>&1"
atual=$(crontab -l 2>/dev/null || true)
if echo "$atual" | grep -qxF "$LINHA"; then
  echo "A cópia diária já estava ligada."
else
  { echo "$atual" | grep -v "backup-diario.sh" | sed '/^$/d' || true; echo "$LINHA"; } | crontab -
  if echo "$atual" | grep -q "backup-diario.sh"; then echo "Cópia diária atualizada (agora com registro em ~/backups/agendador.log)."
  else echo "Cópia diária ligada: todo dia às 06:10 de Brasília (09:10 UTC, depois da rotina da noite)."; fi
fi
echo "Fazendo a primeira cópia agora..."
if bash "$SCRIPT"; then
  echo; ls -lh "$HOME/backups" | tail -n 5
  echo; echo "Pronto. As cópias ficam em ~/backups/AAAA-MM-DD (uma por loja, últimos 60 dias)."
else
  echo; echo "A primeira cópia não deu certo. Veja o motivo:  tail -n 20 ~/backups/backup.log"
  exit 1
fi
