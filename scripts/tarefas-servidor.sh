#!/usr/bin/env bash
# =====================================================================
#  scripts/tarefas-servidor.sh — O BOT DO SERVIDOR: um CARDÁPIO FECHADO de tarefas que o GitHub pode pedir.
#
#  Quem chama: o GitHub (.github/workflows/tarefas-servidor.yml e deploy-servidor.yml), por SSH, com uma chave
#  PRESA a este arquivo no ~/.ssh/authorized_keys (ela não abre terminal nem roda outra coisa):
#    chave NORMAL    command="bash ~/loja/scripts/tarefas-servidor.sh"
#    chave SENSÍVEL  command="bash ~/loja/scripts/tarefas-servidor.sh --sensivel"
#  O que o GitHub pediu chega em $SSH_ORIGINAL_COMMAND: "<tarefa>" ou "<tarefa> <NOME>". Fora do cardápio = recusado.
#  A chave SENSÍVEL só existe no ambiente "producao" do GitHub, que só a libera depois da aprovação do dono.
#
#  NORMAIS (qualquer uma das chaves):
#    estado            versão no ar, contêiner, disco, cópia diária e R2 (ligada/desligada) — nunca mostra chave
#    atualizar         baixa o código novo e troca o servidor (volta sozinho se o novo não responder)
#    reiniciar         reinicia o contêiner e confere /saude
#    copia-agora       faz a cópia do banco agora (a mesma das 06:10)
#    ligar-copia       liga/atualiza a cópia diária no agendador (ligar-backup.sh)
#  SENSÍVEIS (só com a chave sensível, isto é, depois da aprovação):
#    trocar-segredo NOME   troca o valor de NOME no ~/segredos.env e reinicia. O VALOR chega pela entrada (stdin),
#                          nunca no pedido nem no registro. Guarda uma cópia do arquivo antes (as 3 últimas).
#                          A DADOS_CHAVE nunca é trocada por aqui: chave nova deixa os dados cifrados ilegíveis.
#    limpar-historico      apaga do ~/.bash_history as linhas com nomes de chave (DADOS_CHAVE, SECRET, TOKEN...)
#    limpar-disco          apaga imagens velhas do Docker (a "anterior", da volta automática, fica)
#
#  O repositório é PÚBLICO: o que este arquivo escreve aparece no registro do GitHub. Por isso ele nunca escreve
#  valor de chave, nome de cliente nem registro do servidor (só contagens, versões e "ok/falhou").
#  Cada pedido fica anotado em ~/backups/tarefas.log (quando, nível, tarefa, resultado; nunca valores).
#  Testes: TAREFAS_SECO=1 só diz o que faria (testes/bot-servidor.js).
# =====================================================================
set -uo pipefail

NIVEL=normal; [ "${1:-}" = "--sensivel" ] && NIVEL=sensivel
PASTA="${PASTA:-$HOME/loja}"
SEGREDOS="${SEGREDOS:-$HOME/segredos.env}"
BACKUPS="${BACKUPS:-$HOME/backups}"
HISTORICO="${HISTORICO:-$HOME/.bash_history}"
VERSAO_ARQ="${VERSAO_ARQ:-$HOME/.loja-versao}"
SECO="${TAREFAS_SECO:-0}"

NORMAIS=" estado atualizar atualizar-se-mudou reiniciar copia-agora ligar-copia "
SENSIVEIS=" trocar-segredo limpar-historico limpar-disco "

pedido="${SSH_ORIGINAL_COMMAND:-}"
# compatível com o deploy-servidor.yml, que pede o comando antigo
case "$pedido" in
  "SO_SE_MUDOU=1 bash ~/loja/scripts/atualizar-servidor.sh"|"SO_SE_MUDOU=1 bash $HOME/loja/scripts/atualizar-servidor.sh") pedido="atualizar-se-mudou" ;;
esac

anotar() {
  [ "$SECO" = "1" ] && return 0
  mkdir -p "$BACKUPS" 2>/dev/null && printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NIVEL" "$1" "$2" >> "$BACKUPS/tarefas.log" 2>/dev/null || true
}
recusar() { echo "Recusado: $1"; anotar "${tarefa:-?}" "recusado"; exit 2; }

re='^([a-z][a-z-]{1,30})( ([A-Z][A-Z0-9_]{1,40}))?$'
[[ "$pedido" =~ $re ]] || { tarefa="?"; recusar "o pedido não está no cardápio."; }
tarefa="${BASH_REMATCH[1]}"; nome="${BASH_REMATCH[3]:-}"

if [[ "$SENSIVEIS" == *" $tarefa "* ]]; then
  [ "$NIVEL" = "sensivel" ] || recusar "\"$tarefa\" é sensível: precisa da chave liberada pela aprovação do dono (ambiente producao)."
elif [[ "$NORMAIS" != *" $tarefa "* ]]; then
  recusar "\"$tarefa\" não está no cardápio."
fi
[ "$tarefa" = "trocar-segredo" ] || [ -z "$nome" ] || recusar "\"$tarefa\" não leva nome."

# no modo seco (testes) só diz o que faria
fazer() { if [ "$SECO" = "1" ]; then echo "FARIA: $*"; else "$@"; fi; }

saude_local() { curl -fsS -m 5 http://127.0.0.1:8080/saude >/dev/null 2>&1; }
esperar_saude() {
  [ "$SECO" = "1" ] && { echo "FARIA: conferir /saude"; return 0; }
  for _ in $(seq 1 15); do saude_local && return 0; sleep 2; done; return 1
}

estado() {
  [ "$SECO" = "1" ] && { echo "FARIA: estado"; return 0; }
  local v; v=$(tr -dc '0-9a-f' < "$VERSAO_ARQ" 2>/dev/null | cut -c1-7)
  echo "Versão no ar: ${v:-(sem registro)}"
  echo "Contêiner: $(docker ps --filter name=^loja$ --format '{{.Status}}' 2>/dev/null | head -1 || true)"
  if saude_local; then echo "Servidor: respondendo"; else echo "Servidor: NÃO responde"; fi
  echo "Disco: $(df -h / | awk 'NR==2{print $5" usado de "$2}')"
  if crontab -l 2>/dev/null | grep -q backup-diario.sh; then echo "Cópia diária: ligada (06:10)"; else echo "Cópia diária: DESLIGADA"; fi
  if grep -q '^R2_BACKUP_BUCKET=.' "$SEGREDOS" 2>/dev/null; then echo "Cópia no R2: configurada"; else echo "Cópia no R2: falta configurar"; fi
  local ult; ult=$(grep -E '^(ok|ERRO|erro|falha|FALHA)' "$BACKUPS/backup.log" 2>/dev/null | tail -1 | cut -c1-160)
  [ -n "$ult" ] && echo "Última cópia: $ult"
  return 0
}

trocar_segredo() {
  [ "$nome" = "DADOS_CHAVE" ] && recusar "a DADOS_CHAVE não se troca por aqui (a chave nova deixaria os dados cifrados ilegíveis)."
  [ -n "$nome" ] || recusar "diga o NOME da chave (ex.: trocar-segredo CRON_SECRET)."
  local valor; IFS= read -r valor || true; valor="${valor%$'\r'}"
  [ -n "$valor" ] || recusar "o valor novo não chegou (segredo VALOR_NOVO do ambiente producao vazio?). Nada foi mudado."
  [ "${#valor}" -le 4096 ] || recusar "valor grande demais. Nada foi mudado."
  if [ "$SECO" = "1" ]; then echo "FARIA: trocar $nome (${#valor} caracteres) no $(basename "$SEGREDOS") e atualizar"; return 0; fi
  [ -f "$SEGREDOS" ] || recusar "não achei o $SEGREDOS. Nada foi mudado."
  umask 077
  cp -p "$SEGREDOS" "$SEGREDOS.antes-$(date -u +%Y%m%d%H%M%S)"
  # guarda só as 3 cópias mais novas
  ls -1t "$SEGREDOS".antes-* 2>/dev/null | tail -n +4 | xargs -r rm -f
  local tmp="$SEGREDOS.novo.$$"
  VALOR="$valor" CHAVE="$nome" awk 'BEGIN{k=ENVIRON["CHAVE"]"="; f=0}
    index($0,k)==1 { if(!f) print k ENVIRON["VALOR"]; f=1; next } { print }
    END{ if(!f) print k ENVIRON["VALOR"] }' "$SEGREDOS" > "$tmp" && chmod 600 "$tmp" && mv "$tmp" "$SEGREDOS" \
    || { rm -f "$tmp"; recusar "não consegui gravar. Nada foi mudado."; }
  echo "$nome trocado no $(basename "$SEGREDOS") (cópia do antes guardada). Atualizando o servidor para ler o valor novo..."
  SO_SE_MUDOU=1 bash "$PASTA/scripts/atualizar-servidor.sh"
}

limpar_historico() {
  local padrao='(DADOS_CHAVE|SECRET|PRIVATE_KEY|ACCESS_KEY|SENHA|TOKEN|PASSWORD)'
  [ -f "$HISTORICO" ] || { echo "Não há histórico ($HISTORICO)."; return 0; }
  local n; n=$(grep -cE "$padrao" "$HISTORICO" 2>/dev/null || true)
  if [ "$SECO" = "1" ]; then echo "FARIA: apagar ${n:-0} linha(s) do histórico"; return 0; fi
  [ "${n:-0}" -gt 0 ] && sed -i -E "/$padrao/d" "$HISTORICO"
  echo "Histórico: ${n:-0} linha(s) com nome de chave apagada(s)."
}

limpar_disco() {
  [ "$SECO" = "1" ] && { echo "FARIA: docker image prune -f e builder prune -f"; return 0; }
  echo "Antes: $(df -h / | awk 'NR==2{print $5" usado"}')"
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f >/dev/null 2>&1 || true
  echo "Depois: $(df -h / | awk 'NR==2{print $5" usado"}')"
}

echo "Tarefa: $tarefa${nome:+ $nome} (chave $NIVEL)"
cd "$PASTA" 2>/dev/null || [ "$SECO" = "1" ] || recusar "não achei a pasta $PASTA."
rc=0
case "$tarefa" in
  estado)             estado || rc=$? ;;
  atualizar)          fazer bash "$PASTA/scripts/atualizar-servidor.sh" || rc=$? ;;
  atualizar-se-mudou) SO_SE_MUDOU=1 fazer bash "$PASTA/scripts/atualizar-servidor.sh" || rc=$? ;;
  reiniciar)          { fazer docker restart loja >/dev/null && esperar_saude && echo "Reiniciado e respondendo."; } || { echo "Reiniciei, mas o servidor NÃO respondeu em 30 s."; rc=1; } ;;
  copia-agora)        if fazer bash "$PASTA/scripts/backup-diario.sh" >/dev/null 2>&1; then echo "Cópia feita."; else echo "A cópia falhou (o celular do dono recebe o motivo)."; rc=1; fi
                      [ "$SECO" = "1" ] || { grep -E '^(ok|ERRO|erro|falha|FALHA)' "$BACKUPS/backup.log" 2>/dev/null | tail -1 | cut -c1-160; } ;;
  ligar-copia)        fazer bash "$PASTA/scripts/ligar-backup.sh" >/dev/null 2>&1 && echo "Cópia diária ligada e primeira cópia feita." || { echo "Não deu certo ligar a cópia diária."; rc=1; } ;;
  trocar-segredo)     trocar_segredo || rc=$? ;;
  limpar-historico)   limpar_historico || rc=$? ;;
  limpar-disco)       limpar_disco || rc=$? ;;
esac
anotar "$tarefa${nome:+ $nome}" "$([ "$rc" = 0 ] && echo ok || echo "falhou ($rc)")"
exit "$rc"
