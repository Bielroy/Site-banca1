#!/usr/bin/env bash
# =====================================================================
#  scripts/backup-diario.sh — guarda a cópia do banco NO DISCO DO SERVIDOR (fora do Firebase).
#  Quem chama é o agendador do servidor (instalado por scripts/ligar-backup.sh), todo dia de madrugada.
#  Também dá para rodar na mão:  bash ~/loja/scripts/backup-diario.sh
#
#  - salva em ~/backups/banco-AAAA-MM-DD.json.gz (só troca o arquivo se a cópia nova estiver inteira);
#  - guarda os últimos 60 dias e apaga os mais velhos;
#  - se o disco estiver quase cheio (menos de 500 MB livres), não grava e avisa no registro.
#  Registro: ~/backups/backup.log
# =====================================================================
set -uo pipefail
PASTA_BK="${PASTA_BK:-$HOME/backups}"
NOME="${NOME:-loja}"
DIAS="${DIAS:-60}"
mkdir -p "$PASTA_BK"
LOG="$PASTA_BK/backup.log"
dia=$(date +%F)
final="$PASTA_BK/banco-$dia.json.gz"
tmp="$PASTA_BK/.banco-$dia.json.gz.parcial"
diz() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

livre_kb=$(df -Pk "$PASTA_BK" | awk 'NR==2 {print $4}')
if [ "${livre_kb:-0}" -lt 512000 ]; then
  diz "ERRO: disco quase cheio ($((livre_kb / 1024)) MB livres). Cópia NÃO feita. Apague arquivos velhos ou aumente o disco."
  exit 3
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NOME"; then
  diz "ERRO: o contêiner '$NOME' não está rodando. Rode: bash ~/loja/scripts/atualizar-servidor.sh"
  exit 4
fi

docker exec "$NOME" node server/backup.js 2>>"$LOG" | gzip -9 > "$tmp"
codigo=${PIPESTATUS[0]}
if gzip -t "$tmp" 2>/dev/null && [ "$(gzip -dc "$tmp" | head -c 1)" = "{" ]; then
  mv -f "$tmp" "$final"
  tam=$(du -h "$final" | cut -f1)
  if [ "$codigo" -eq 0 ]; then diz "ok: $final ($tam)"; else diz "AVISO: $final ($tam) salvo, mas alguma loja falhou (veja as linhas [backup] acima)"; fi
else
  rm -f "$tmp"
  diz "ERRO: a cópia de hoje saiu vazia ou quebrada (código $codigo). A de ontem continua guardada."
  exit 5
fi

# guarda só os últimos $DIAS dias
find "$PASTA_BK" -maxdepth 1 -name 'banco-*.json.gz' -mtime +"$DIAS" -print -delete | sed 's/^/apagado (velho): /' >> "$LOG"
# o registro não cresce sem fim
if [ "$(wc -l < "$LOG")" -gt 2000 ]; then tail -n 1000 "$LOG" > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"; fi
exit 0
