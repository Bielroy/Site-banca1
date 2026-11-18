#!/usr/bin/env bash
# =====================================================================
#  scripts/atualizar-servidor.sh — ATUALIZA O SERVIDOR DA LOJA NA AWS.
#
#  O site (Cloudflare Pages) se atualiza sozinho a cada mudança no GitHub. O servidor (a pasta api/)
#  NÃO: ele roda num contêiner Docker na AWS e só muda quando você roda este arquivo lá.
#
#  Uso, no terminal da AWS (Lightsail → Conectar):
#      bash ~/loja/scripts/atualizar-servidor.sh
#  Ou sozinho, a cada mudança no GitHub: .github/workflows/deploy-servidor.yml entra por SSH e roda
#      SO_SE_MUDOU=1 bash ~/loja/scripts/atualizar-servidor.sh
#  (ligar: PUBLICAR.md, "Servidor atualizado sozinho").
#
#  VERSÃO: o commit que está no ar fica em ~/.loja-versao, que o servidor lê (/api/saude → "versao").
#  O painel compara com a versão do site e avisa quando estão diferentes.
#  SO_SE_MUDOU=1: se nada do servidor mudou desde a versão no ar (api/, lib/, server/... e o ~/segredos.env),
#  só anota a versão nova, sem reiniciar (a loja não pisca a cada mudança que é só do site).
#
#  O que ele faz:
#    1. baixa o código novo do GitHub (ramo rota-cloudflare);
#    2. monta a imagem nova e guarda a atual como "anterior";
#    3. troca o contêiner (com limite de tamanho dos registros e porta só para o Caddy);
#    4. confere /saude. Se o servidor novo não responder em 30 s, VOLTA SOZINHO para a versão anterior.
#  Nunca mostra o conteúdo do ~/segredos.env.
# =====================================================================
set -euo pipefail

PASTA="${PASTA:-$HOME/loja}"
SEGREDOS="${SEGREDOS:-$HOME/segredos.env}"
RAMO="${RAMO:-rota-cloudflare}"
NOME="loja"
VERSAO_ARQ="${VERSAO_ARQ:-$HOME/.loja-versao}"            # o commit no ar (o contêiner lê como /app/VERSAO)
MARCA_SEGREDOS="$VERSAO_ARQ.segredos"                      # resumo (sha256) do ~/segredos.env da última troca, nunca o conteúdo
# o que vai para dentro da imagem (Dockerfile): se nada disto mudou, o servidor não precisa ser trocado
DO_SERVIDOR="api lib server analytics Dockerfile .dockerignore package.json package-lock.json js/impressao-lib.js js/impressao-fila-lib.js scripts/apagar-cliente.js"

cd "$PASTA"
[ -f "$SEGREDOS" ] || { echo "Não achei o arquivo de chaves ($SEGREDOS). Nada foi mudado."; exit 1; }
ANTES=$(tr -dc '0-9a-f' 2>/dev/null < "$VERSAO_ARQ" || true)
resumo_segredos() { sha256sum "$SEGREDOS" | cut -c1-64; }

echo "1/4 Baixando o código novo ($RAMO)..."
if ! git fetch --quiet origin "$RAMO"; then
  echo "Não consegui baixar do GitHub. O repositório é privado: o servidor precisa da chave de leitura"
  echo "(Deploy key) configurada. Veja ROTA-CLOUDFLARE.md, parte \"Servidor na AWS\". Nada foi mudado."
  exit 1
fi
git checkout --quiet "$RAMO"
if ! git merge --quiet --ff-only "origin/$RAMO"; then
  echo "A pasta $PASTA tem mudanças feitas à mão que impedem a atualização. Nada foi mudado."
  exit 1
fi

NOVO=$(git rev-parse HEAD)

if [ "${SO_SE_MUDOU:-0}" = "1" ] && [ -n "$ANTES" ] && git cat-file -e "$ANTES^{commit}" 2>/dev/null \
   && docker ps --format '{{.Names}}' | grep -qx "$NOME" \
   && [ "$(cat "$MARCA_SEGREDOS" 2>/dev/null)" = "$(resumo_segredos)" ] \
   && git diff --quiet "$ANTES" "$NOVO" -- $DO_SERVIDOR; then
  printf '%s\n' "$NOVO" > "$VERSAO_ARQ"
  echo "Nada do servidor mudou desde ${ANTES:0:7}: só anotei a versão nova, sem reiniciar."
  echo "Pronto: servidor no ar com a versão ${NOVO:0:7}."
  exit 0
fi

echo "2/4 Montando a imagem (pode levar 1 ou 2 minutos)..."
docker image inspect "$NOME:latest" >/dev/null 2>&1 && docker tag "$NOME:latest" "$NOME:anterior"
docker build --quiet --build-arg VERSAO_COMMIT="$NOVO" -t "$NOME:latest" . >/dev/null

rodar() {
  # -p 127.0.0.1:...  a porta 8080 só aceita o Caddy, da própria máquina (o cliente entra pelo HTTPS)
  # --log-opt          os registros não crescem até encher o disco (3 arquivos de 10 MB)
  # -v ...:/app/VERSAO  o servidor lê a versão daqui (o arquivo é reescrito no lugar, sem trocar o contêiner)
  docker run -d --name "$NOME" --restart unless-stopped \
    -p 127.0.0.1:8080:8080 --env-file "$SEGREDOS" \
    -v "$VERSAO_ARQ:/app/VERSAO:ro" \
    --log-opt max-size=10m --log-opt max-file=3 "$1" >/dev/null
}

echo "3/4 Trocando o servidor..."
[ -f "$VERSAO_ARQ" ] || : > "$VERSAO_ARQ"          # tem de existir antes (senão o Docker cria uma PASTA com esse nome)
printf '%s\n' "$NOVO" > "$VERSAO_ARQ"              # reescreve no lugar (o contêiner enxerga a mudança)
docker rm -f "$NOME" >/dev/null 2>&1 || true
rodar "$NOME:latest"

echo "4/4 Conferindo..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/saude >/dev/null 2>&1; then
    resumo_segredos > "$MARCA_SEGREDOS"
    echo "Pronto: servidor no ar com a versão ${NOVO:0:7}."
    docker logs "$NOME" 2>&1 | grep -E "variáveis vazias" || true
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done

echo "O servidor novo não respondeu. Últimas linhas do registro:"
docker logs --tail 20 "$NOME" 2>&1 || true
docker rm -f "$NOME" >/dev/null 2>&1 || true
if docker image inspect "$NOME:anterior" >/dev/null 2>&1; then
  printf '%s\n' "$ANTES" > "$VERSAO_ARQ"            # o painel volta a mostrar a versão que está mesmo no ar
  rodar "$NOME:anterior"
  echo "Voltei para a versão anterior (${ANTES:0:7}): a loja continua funcionando como antes."
fi
exit 1
