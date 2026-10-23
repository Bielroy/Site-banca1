'use strict';
// Roda depois do "vite build" no Cloudflare Pages (npm run build:cloudflare): escreve dist/_headers, dist/_redirects e dist/_routes.json.
const fs = require('fs'), path = require('path');
const { gerarHeaders, gerarRedirects, gerarRotas, copiasDePagina } = require('../lib/cloudflare-arquivos');
const raiz = path.join(__dirname, '..'), saida = path.join(raiz, process.argv[2] || 'dist');
if (!fs.existsSync(saida)) { console.error(`Não achei a pasta ${saida}. Rode "npm run build" antes.`); process.exit(1); }
const vercel = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8'));
fs.writeFileSync(path.join(saida, '_headers'), gerarHeaders(vercel));
fs.writeFileSync(path.join(saida, '_redirects'), gerarRedirects(vercel));
fs.writeFileSync(path.join(saida, '_routes.json'), gerarRotas());   // estáticos fora das Functions (ver lib/cloudflare-arquivos.js)
for (const { de, para } of copiasDePagina(vercel)) {
  if (!fs.existsSync(path.join(saida, de))) { console.error(`Não achei ${de} em ${saida}.`); process.exit(1); }
  fs.copyFileSync(path.join(saida, de), path.join(saida, para));
  console.log(`Cloudflare: ${para} (cópia de ${de})`);
}
console.log('Cloudflare: _headers, _redirects e _routes.json escritos em', saida);
