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
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
