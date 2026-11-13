'use strict';
// =====================================================================
//  scripts/gerar-marca-termica.js — atualiza o desenho do UseBanca dentro de js/impressao-lib.js
//  O desenho do UseBanca (o caixote com as frutas) em PRETO E BRANCO, no tamanho que a térmica imprime:
//  128 x 128 pontos (cerca de 16 mm). Roda com:  node scripts/gerar-marca-termica.js
//  O resultado já está no repositório; só rode de novo se o desenho mudar.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// o mesmo desenho do ícone do app (viewBox 96 76 320 320), com preto, branco e tracejado no lugar das cores
const MARCA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 76 320 320" fill="none">'
  + '<defs><pattern id="r" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="#fff"/><rect width="4.5" height="9" fill="#000"/></pattern></defs>'
  + '<circle cx="322" cy="204" r="56" fill="url(#r)" stroke="#000" stroke-width="6"/>'
  + '<circle cx="216" cy="188" r="76" fill="#000"/>'
  + '<path d="M216 118C218 92 238 80 260 82C260 104 242 118 216 118Z" fill="#000"/>'
  + '<g fill="#fff" stroke="#000" stroke-width="7"><rect x="115" y="235" width="282" height="36" rx="8"/><rect x="115" y="292" width="282" height="36" rx="8"/><rect x="115" y="349" width="282" height="36" rx="8"/></g>'
  + '<rect x="104" y="224" width="40" height="168" rx="10" fill="#000"/><rect x="368" y="224" width="40" height="168" rx="10" fill="#000"/></svg>';
const TAM = 128;

(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: TAM, height: TAM }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0;background:#fff"><img id="i" width="${TAM}" height="${TAM}" src="data:image/svg+xml;utf8,${encodeURIComponent(MARCA_SVG)}"></body>`);
  await p.waitForFunction(() => document.getElementById('i').complete);
  const bits = await p.evaluate((n) => {
    const c = document.createElement('canvas'); c.width = n; c.height = n; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); x.drawImage(document.getElementById('i'), 0, 0, n, n);
    const d = x.getImageData(0, 0, n, n).data, out = [];
    for (let y = 0; y < n; y++) for (let bx = 0; bx < n / 8; bx++) { let v = 0; for (let k = 0; k < 8; k++) { const i = (y * n + bx * 8 + k) * 4; v = (v << 1) | ((d[i] + d[i + 1] + d[i + 2]) / 3 < 128 ? 1 : 0); } out.push(v); }
    return out;
  }, TAM);
  await b.close();
  const b64 = Buffer.from(bits).toString('base64');
  const alvo = path.join(__dirname, '..', 'js', 'impressao-lib.js'), fonte = fs.readFileSync(alvo, 'utf8');
  const bloco = fonte.match(/\/\/ <marca-gerada>[\s\S]*?\/\/ <\/marca-gerada>\n/);
  if (!bloco) throw new Error('marcadores <marca-gerada> não achados em js/impressao-lib.js');
  const novo = bloco[0].replace(/const MARCA_SVG = .*;\n/, () => `const MARCA_SVG = ${JSON.stringify(MARCA_SVG)};\n`).replace(/const MARCA_BITS = .*;\n/, () => `const MARCA_BITS = { w: ${TAM}, h: ${TAM}, b64: '${b64}' };\n`);
  fs.writeFileSync(alvo, fonte.replace(bloco[0], () => novo));
  // prévia em texto para conferir o desenho
  const rows = []; for (let y = 0; y < TAM; y += 4) { let s = ''; for (let x = 0; x < TAM; x += 2) s += (bits[y * (TAM / 8) + (x >> 3)] >> (7 - (x & 7))) & 1 ? '#' : '.'; rows.push(s); }
  console.log(rows.join('\n')); console.log('bytes:', bits.length);
})();
