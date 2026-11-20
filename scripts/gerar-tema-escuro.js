'use strict';
// Escreve css/admin-escuro.css (tema escuro do painel) a partir do CSS do painel. Ver lib/tema-escuro.js.
//   node scripts/gerar-tema-escuro.js          -> escreve o arquivo
//   node scripts/gerar-tema-escuro.js --conferir -> só diz se está em dia (sai com erro se não estiver)
const fs = require('fs'), path = require('path');
const { gerar } = require('../lib/tema-escuro');
const raiz = path.join(__dirname, '..'), ler = (a) => fs.readFileSync(path.join(raiz, a), 'utf8');
const css = gerar(ler, ler('css/admin-escuro-extra.css')), destino = path.join(raiz, 'css/admin-escuro.css');
if (process.argv.includes('--conferir')) {
  const atual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
  if (atual !== css) { console.error('css/admin-escuro.css está desatualizado. Rode: node scripts/gerar-tema-escuro.js'); process.exit(1); }
  console.log('css/admin-escuro.css está em dia.');
} else { fs.writeFileSync(destino, css); console.log(`css/admin-escuro.css escrito (${(css.length / 1024).toFixed(1)} kB).`); }
