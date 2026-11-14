#!/usr/bin/env bash
# =====================================================================
#  scripts/atualizar-servidor.sh — ATUALIZA O SERVIDOR DA LOJA NA AWS.
#
#  O site (Cloudflare Pages) se atualiza sozinho a cada mudança no GitHub. O servidor (a pasta api/)
#  NÃO: ele roda num contêiner Docker na AWS e só muda quando você roda este arquivo lá.
#
#  Uso, no terminal da AWS (Lightsail → Conectar):
#      bash ~/loja/scripts/atualizar-servidor.sh
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

cd "$PASTA"
[ -f "$SEGREDOS" ] || { echo "Não achei o arquivo de chaves ($SEGREDOS). Nada foi mudado."; exit 1; }

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

echo "2/4 Montando a imagem (pode levar 1 ou 2 minutos)..."
docker image inspect "$NOME:latest" >/dev/null 2>&1 && docker tag "$NOME:latest" "$NOME:anterior"
docker build --quiet -t "$NOME:latest" . >/dev/null

rodar() {
  # -p 127.0.0.1:...  a porta 8080 só aceita o Caddy, da própria máquina (o cliente entra pelo HTTPS)
  # --log-opt          os registros não crescem até encher o disco (3 arquivos de 10 MB)
  docker run -d --name "$NOME" --restart unless-stopped \
    -p 127.0.0.1:8080:8080 --env-file "$SEGREDOS" \
    --log-opt max-size=10m --log-opt max-file=3 "$1" >/dev/null
}

echo "3/4 Trocando o servidor..."
docker rm -f "$NOME" >/dev/null 2>&1 || true
rodar "$NOME:latest"

echo "4/4 Conferindo..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/saude >/dev/null 2>&1; then
    echo "Pronto: servidor no ar com a versão $(git rev-parse --short HEAD)."
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
  rodar "$NOME:anterior"
  echo "Voltei para a versão anterior: a loja continua funcionando como antes."
fi
exit 1
