# Servidor da banca para o Google Cloud Run (a Rota A do guia ROTA-CLOUDFLARE.md).
# Só leva o que o servidor usa: api/, lib/ e server/. O site (páginas) vai para o Cloudflare Pages.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# só o firebase-admin é preciso aqui (o resto do package.json é do site)
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY api ./api
COPY lib ./lib
COPY analytics ./analytics
COPY server ./server
# o app ponte (lib/ponte.js) monta o cupom com as MESMAS regras do painel: só estes dois arquivos do site
COPY js/impressao-lib.js js/impressao-fila-lib.js ./js/
RUN printf '{"type":"module"}' > ./js/package.json
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
