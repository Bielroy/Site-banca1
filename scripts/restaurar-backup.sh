#!/usr/bin/env bash
# =====================================================================
#  scripts/restaurar-backup.sh — VOLTA UMA CÓPIA DIÁRIA PARA UM BANCO DE TESTE (ensaio trimestral ou dia ruim).
#
#  NUNCA grava na produção por padrão: não usa as chaves do ~/segredos.env; o destino é o emulador ou um projeto
#  de TESTE com a conta de serviço DELE. Fora do emulador, sempre pergunta antes (digite RESTAURAR).
#  A regra completa está em server/restaurar-backup.js.
#
#  Exemplos
#    A cópia de um dia é a PASTA ~/backups/AAAA-MM-DD (um arquivo por loja). Arquivo solto (.json.gz) também vale.
#    Só contar o que tem na cópia (não grava nada):
#      bash scripts/restaurar-backup.sh ~/backups/2026-11-17 --simular
#    Provar que a chave do cofre abre os dados (pede para colar a DADOS_CHAVE; não grava nada):
#      bash scripts/restaurar-backup.sh ~/backups/2026-11-17 --conferir-chave
#    --chave: pede a DADOS_CHAVE antes de restaurar, para apagar de novo quem pediu (LGPD) depois da restauração.
#    Ensaio no emulador (no computador, com o projeto baixado e "npm ci"; precisa de Java):
#      npx --prefix testes/regras firebase emulators:exec --only firestore --project demo-restauro \
#        "bash scripts/restaurar-backup.sh 2026-11-17 --emulador"
#    Num projeto Firebase de TESTE (no servidor da AWS ou no computador):
#      bash ~/loja/scripts/restaurar-backup.sh ~/backups/2026-11-17 --projeto banca-teste --credenciais ~/banca-teste.json --chave
#    Só uma loja:  ... --loja espetinhos
#    Cópia que está no R2 (fora da máquina): baixe os arquivos de banco/AAAA-MM-DD/ numa pasta (R2 → bucket → Download).
#
#  Onde roda: com node_modules/firebase-admin na pasta do projeto, roda direto; no servidor da AWS (sem node), roda
#  dentro da imagem do servidor (loja:latest) SEM o ~/segredos.env (as chaves da produção não entram).
# =====================================================================
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ $# -ge 1 ] || { sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 2; }

# --chave / --conferir-chave: a DADOS_CHAVE é colada aqui (não aparece na tela nem fica no histórico) e vai só pelo ambiente
pede=0; resto=()
for a in "$@"; do
  case "$a" in --chave) pede=1 ;; --conferir-chave) pede=1; resto+=("$a") ;; *) resto+=("$a") ;; esac
done
set -- ${resto[@]+"${resto[@]}"}
if [ "$pede" = 1 ] && [ -z "${DADOS_CHAVE:-}" ]; then
  read -rsp "Cole a DADOS_CHAVE (do cofre de senhas) e tecle Enter: " DADOS_CHAVE; echo
fi
if [ -n "${DADOS_CHAVE:-}" ]; then export DADOS_CHAVE; fi

if command -v node >/dev/null 2>&1 && [ -d "$RAIZ/node_modules/firebase-admin" ]; then
  exec node "$RAIZ/server/restaurar-backup.js" "$@"
fi

if command -v docker >/dev/null 2>&1 && docker image inspect loja:latest >/dev/null 2>&1; then
  # dentro da imagem do servidor: o arquivo da cópia e o das credenciais entram só para leitura
  args=() montagens=() i=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --credenciais) [ -f "${2:-}" ] || { echo "Não achei o arquivo de credenciais: ${2:-}"; exit 2; }
                     montagens+=(-v "$(realpath "$2"):/tmp/credenciais.json:ro"); args+=(--credenciais /tmp/credenciais.json); shift 2; continue ;;
      --emulador)    echo "No servidor não há emulador: use --projeto <teste> --credenciais <arquivo>, ou rode no computador."; exit 2 ;;
      --*)           args+=("$1") ;;
      *)             if [ "$i" -eq 0 ]; then [ -e "$1" ] || { echo "Não achei a cópia: $1"; exit 2; }
                       montagens+=(-v "$(realpath "$1"):/tmp/copia:ro"); args+=(/tmp/copia); i=1
                     else args+=("$1"); fi ;;
    esac
    shift
  done
  exec docker run --rm -it -e DADOS_CHAVE "${montagens[@]}" loja:latest node server/restaurar-backup.js "${args[@]}"
fi

echo "Para restaurar preciso do Node com as dependências (rode \"npm ci\" na pasta do projeto) ou da imagem do servidor (loja:latest)."
exit 2
