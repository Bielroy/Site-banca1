#!/usr/bin/env bash
# =====================================================================
#  scripts/backup-diario.sh — guarda a cópia do banco NO DISCO DO SERVIDOR (fora do Firebase) e uma
#  segunda cópia FORA DA MÁQUINA (bucket fechado do Cloudflare R2).
#  Quem chama é o agendador do servidor (instalado por scripts/ligar-backup.sh), todo dia de madrugada.
#  Também dá para rodar na mão:  bash ~/loja/scripts/backup-diario.sh
#
#  - salva em ~/backups/banco-AAAA-MM-DD.json.gz (só troca o arquivo se a cópia nova estiver inteira);
#  - manda a mesma cópia para o R2: banco/AAAA-MM-DD.json.gz no bucket R2_BACKUP_BUCKET (PUBLICAR.md,
#    "Cópia fora da máquina"). Sem as variáveis, a cópia local continua e o registro diz o que falta;
#  - guarda os últimos 60 dias no disco e apaga os mais velhos (no R2, quem apaga é a regra de 60 dias do bucket);
#  - se o disco estiver quase cheio (menos de 500 MB livres), não grava e avisa;
#  - deu errado: escreve no registro E avisa o celular do dono (aviso de sempre do painel), se o servidor estiver de pé.
#  Registros: ~/backups/backup.log (deste script) e ~/backups/agendador.log (saída do agendador). Os dois
#  ficam com no máximo 2000 linhas (cortados para as 1000 últimas).
#
#  A CHAVE DOS DADOS (DADOS_CHAVE) NÃO vai junto: nome, telefone e endereço dos clientes estão cifrados na cópia.
#  Sem a chave, a cópia não serve para esses campos: guarde a chave num cofre de senhas FORA do servidor (PUBLICAR.md).
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
cortar() { for f in "$@"; do [ -f "$f" ] && [ "$(wc -l < "$f")" -gt 2000 ] && tail -n 1000 "$f" > "$f.tmp" && mv -f "$f.tmp" "$f"; done; return 0; }
# avisa o celular do dono (só funciona com o contêiner de pé; se ele caiu, o UptimeRobot avisa)
alertar() { docker exec "$NOME" node server/backup-ferramentas.js alertar "$1" >> "$LOG" 2>&1 || diz "(não consegui mandar o aviso para o celular)"; }
sair() { cortar "$LOG" "$PASTA_BK/agendador.log"; exit "$1"; }

livre_kb=$(df -Pk "$PASTA_BK" | awk 'NR==2 {print $4}')
if [ "${livre_kb:-0}" -lt 512000 ]; then
  diz "ERRO: disco quase cheio ($((livre_kb / 1024)) MB livres). Cópia NÃO feita. Apague arquivos velhos ou aumente o disco."
  alertar "Disco do servidor quase cheio: a cópia de hoje NÃO foi feita."
  sair 3
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NOME"; then
  diz "ERRO: o contêiner '$NOME' não está rodando. Rode: bash ~/loja/scripts/atualizar-servidor.sh"
  sair 4
fi

docker exec "$NOME" node server/backup.js 2>>"$LOG" | gzip -9 > "$tmp"
codigo=${PIPESTATUS[0]}
if gzip -t "$tmp" 2>/dev/null && [ "$(gzip -dc "$tmp" | head -c 1)" = "{" ]; then
  mv -f "$tmp" "$final"
  tam=$(du -h "$final" | cut -f1)
  if [ "$codigo" -eq 0 ]; then diz "ok: $final ($tam)"; else diz "AVISO: $final ($tam) salvo, mas alguma loja falhou (veja as linhas [backup] acima)"; alertar "A cópia de hoje saiu, mas alguma loja falhou."; fi
else
  rm -f "$tmp"
  diz "ERRO: a cópia de hoje saiu vazia ou quebrada (código $codigo). A de ontem continua guardada."
  alertar "A cópia de hoje saiu vazia ou quebrada (código $codigo)."
  sair 5
fi

# segunda cópia, FORA DA MÁQUINA (se a máquina se perder, as cópias do disco vão junto)
docker exec -i "$NOME" node server/backup-ferramentas.js enviar "banco/$dia.json.gz" < "$final" >> "$LOG" 2>&1
fora=$?
if [ "$fora" -eq 0 ]; then
  diz "ok: cópia fora da máquina (R2) banco/$dia.json.gz"
elif [ "$fora" -eq 3 ]; then
  diz "AVISO: cópia fora da máquina DESLIGADA (faltam variáveis R2_BACKUP_* no ~/segredos.env; veja a linha acima e PUBLICAR.md)."
  alertar "A cópia de hoje ficou SÓ no servidor: falta ligar a cópia fora da máquina (R2_BACKUP_BUCKET)."
else
  diz "ERRO: a cópia de hoje NÃO chegou ao R2 (código $fora). A cópia no disco está guardada."
  alertar "A cópia de hoje NÃO chegou ao R2 (fora da máquina). A do disco está guardada."
fi

# guarda só os últimos $DIAS dias
find "$PASTA_BK" -maxdepth 1 -name 'banco-*.json.gz' -mtime +"$DIAS" -print -delete | sed 's/^/apagado (velho): /' >> "$LOG"
sair 0
