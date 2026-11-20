#!/usr/bin/env bash
# =====================================================================
#  scripts/backup-diario.sh — CÓPIA DO BANCO, UM ARQUIVO POR LOJA, NO DISCO DO SERVIDOR E FORA DA MÁQUINA (R2).
#  Quem chama é o agendador do servidor (scripts/ligar-backup.sh), todo dia às 09:10 UTC (06:10 em Brasília),
#  DEPOIS da rotina da noite (08:00 UTC). Também dá para rodar na mão:  bash ~/loja/scripts/backup-diario.sh
#
#  - grava ~/backups/AAAA-MM-DD/<loja>.json.gz (uma loja de cada vez) e _plataforma.json.gz (feiras e marcas de LGPD);
#    cada arquivo só entra se estiver inteiro;
#  - manda cada arquivo para o R2: banco/AAAA-MM-DD/<loja>.json.gz no bucket R2_BACKUP_BUCKET (PUBLICAR.md,
#    "Cópia fora da máquina"). Sem as variáveis, a cópia local continua, o registro diz o que falta e o dono é avisado;
#  - anota no banco quando terminou (plataforma/copia_fora): /api/saude mostra e o painel do dono avisa se parar;
#  - COMPLETA 1 vez por semana por loja (cada loja num dia), INCREMENTAL nos outros (só o que mudou): custo em lib/prudencia.js;
#  - guarda 7 dias no disco (uma completa + as incrementais) e 60 no R2 (regra do bucket);
#  - disco quase cheio (menos de 500 MB): não grava e avisa;
#  - deu errado: escreve no registro E avisa o celular do dono (aviso de sempre do painel), se o servidor estiver de pé.
#  Registros: ~/backups/backup.log e ~/backups/agendador.log (no máximo 2000 linhas cada).
#
#  A CHAVE DOS DADOS (DADOS_CHAVE) NÃO vai junto: nome, telefone e endereço dos clientes estão cifrados na cópia.
#  Guarde o ~/segredos.env INTEIRO num cofre de senhas FORA do servidor (PUBLICAR.md, seção 4m).
# =====================================================================
set -uo pipefail
PASTA_BK="${PASTA_BK:-$HOME/backups}"
NOME="${NOME:-loja}"
DIAS="${DIAS:-7}"                 # no disco: 7 dias (a corrente completa + incrementais cabe aí); no R2: 60 dias
mkdir -p "$PASTA_BK"
LOG="$PASTA_BK/backup.log"
dia=$(date -u +%F)
pasta="$PASTA_BK/$dia"
diz() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cortar() { for f in "$@"; do [ -f "$f" ] && [ "$(wc -l < "$f")" -gt 2000 ] && tail -n 1000 "$f" > "$f.tmp" && mv -f "$f.tmp" "$f"; done; return 0; }
alertar() { docker exec "$NOME" node server/backup-ferramentas.js alertar "$1" >> "$LOG" 2>&1 || diz "(não consegui mandar o aviso para o celular)"; }
marcar() { docker exec "$NOME" node server/backup-ferramentas.js marcar "$@" >> "$LOG" 2>&1 || diz "(não consegui anotar no banco que a cópia terminou)"; }
sair() { cortar "$LOG" "$PASTA_BK/agendador.log"; exit "$1"; }

livre_kb=$(df -Pk "$PASTA_BK" | awk 'NR==2 {print $4}')
if [ "${livre_kb:-0}" -lt 512000 ]; then
  diz "ERRO: disco quase cheio ($((livre_kb / 1024)) MB livres). Cópia NÃO feita. Apague cópias velhas ou aumente o disco."
  alertar "Disco do servidor quase cheio: a cópia de hoje NÃO foi feita."
  sair 3
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$NOME"; then
  diz "ERRO: o contêiner '$NOME' não está rodando. Rode: bash ~/loja/scripts/atualizar-servidor.sh"
  sair 4
fi
if ! lojas=$(docker exec "$NOME" node server/backup.js --listar 2>>"$LOG"); then
  diz "ERRO: não consegui listar as lojas (veja as linhas acima)."
  alertar "A cópia de hoje NÃO foi feita: não consegui listar as lojas."
  sair 5
fi
mkdir -p "$pasta"

total=0 feitas=0 enviadas=0 falhas=0 desligada=0
# grava e manda UM arquivo: $1 = nome (loja ou _plataforma), o resto = argumentos do server/backup.js
copiar() {
  local nome="$1"; shift
  local final="$pasta/$nome.json.gz" tmp="$pasta/.$nome.json.gz.parcial" codigo fora
  docker exec "$NOME" node server/backup.js "$@" 2>>"$LOG" | gzip -9 > "$tmp"
  codigo=${PIPESTATUS[0]}
  if [ "$codigo" -ne 0 ] || ! gzip -t "$tmp" 2>/dev/null || [ "$(gzip -dc "$tmp" | head -c 1)" != "{" ]; then
    rm -f "$tmp"; falhas=$((falhas + 1))
    diz "ERRO: cópia de $nome saiu vazia ou quebrada (código $codigo)."
    return
  fi
  mv -f "$tmp" "$final"; feitas=$((feitas + 1))
  # cópia de loja gravada inteira: marca a corrente (a próxima incremental parte daqui)
  if [ "$1" = "--loja" ]; then
    local cab tipo feita
    cab=$(gzip -dc "$final" | head -c 400)
    tipo=$(printf '%s' "$cab" | grep -o '"tipo":"\(completa\|incremental\)"' | head -1 | cut -d'"' -f4)
    feita=$(printf '%s' "$cab" | grep -o '"feitaEm":"[^"]*"' | head -1 | cut -d'"' -f4)
    docker exec "$NOME" node server/backup.js --confirmar "$nome" "$tipo" "$feita" 2>>"$LOG" || diz "AVISO: não marquei a cópia de $nome (a próxima será maior)."
    diz "$nome: cópia $tipo"
  fi
  [ "$desligada" = 1 ] && return
  docker exec -i "$NOME" node server/backup-ferramentas.js enviar "banco/$dia/$nome.json.gz" < "$final" >> "$LOG" 2>&1
  fora=$?
  if [ "$fora" -eq 0 ]; then enviadas=$((enviadas + 1))
  elif [ "$fora" -eq 3 ]; then desligada=1
  else falhas=$((falhas + 1)); diz "ERRO: $nome NÃO chegou ao R2 (código $fora). A cópia no disco está guardada."
  fi
}

for loja in $lojas; do
  [[ "$loja" =~ ^[a-z0-9][a-z0-9-]{1,39}$ ]] || { diz "AVISO: id de loja estranho ignorado"; continue; }
  total=$((total + 1))
  copiar "$loja" --loja "$loja"
done
copiar "_plataforma" --plataforma

tam=$(du -sh "$pasta" | cut -f1)
if [ "$desligada" = 1 ]; then
  diz "AVISO: $feitas arquivo(s) em $pasta ($tam), mas a cópia fora da máquina está DESLIGADA (faltam variáveis R2_BACKUP_*; PUBLICAR.md)."
  alertar "A cópia de hoje ficou SÓ no servidor: falta ligar a cópia fora da máquina (R2_BACKUP_BUCKET)."
  marcar desligada "$total" "$enviadas" "$falhas"
elif [ "$falhas" -gt 0 ]; then
  diz "ERRO: $falhas falha(s); $feitas arquivo(s) no disco ($tam), $enviadas no R2."
  alertar "A cópia de hoje teve $falhas falha(s): $enviadas de $((total + 1)) arquivo(s) chegaram ao R2."
  marcar falha "$total" "$enviadas" "$falhas"
else
  diz "ok: $feitas arquivo(s) em $pasta ($tam) e no R2 (banco/$dia/)"
  marcar ok "$total" "$enviadas" 0
fi

# guarda só os últimos $DIAS dias (pastas do dia e arquivos do formato antigo)
find "$PASTA_BK" -maxdepth 1 -type d -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' -mtime +"$DIAS" -print -exec rm -rf {} + | sed 's/^/apagado (velho): /' >> "$LOG"
find "$PASTA_BK" -maxdepth 1 -name 'banco-*.json.gz' -mtime +"$DIAS" -print -delete | sed 's/^/apagado (velho): /' >> "$LOG"
[ "$falhas" -gt 0 ] && sair 5
sair 0
