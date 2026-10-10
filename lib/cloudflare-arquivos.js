'use strict';
// =====================================================================
//  lib/cloudflare-arquivos.js — traduz o vercel.json para o Cloudflare Pages.
//
//  O vercel.json continua sendo a fonte única (a Vercel segue funcionando para os testes).
//  Daqui saem, no build do Cloudflare (scripts/cloudflare-arquivos.js):
//     _headers    cabeçalhos de segurança (CSP etc.)
//     _redirects  link da feira e /previa
//
//  O Cloudflare NÃO tem "todas as páginas menos /previa" como a Vercel. E quando dois trechos do _headers
//  valem para o mesmo endereço, o valor do mesmo cabeçalho é SOMADO ("DENY, SAMEORIGIN"). Por isso os
//  cabeçalhos "de todas as páginas" são escritos endereço por endereço (lista abaixo), sem nunca incluir
//  /previa, que tem os dela. Os testes conferem que nenhum endereço cai em dois trechos.
//  As respostas de /api não passam pelo _headers (são de uma função): functions/api/[[caminho]].js põe os dela.
// =====================================================================
const FONTE_TODAS = '/((?!previa).*)', FONTE_PREVIA = '/previa', FONTE_API = '/api/(.*)', FONTE_ADMIN = '/admin.html', FONTE_PLATAFORMA = '/plataforma.html';

// O Cloudflare tira o ".html" dos endereços (/admin.html vira /admin), então valem os dois.
const ENDERECOS_DO_SITE = [
  '/', '/admin', '/admin.html', '/plataforma', '/plataforma.html', '/feira', '/feira.html', '/privacidade', '/privacidade.html', '/index.html',
  '/assets/*', '/sw.js', '/workbox-*', '/registerSW.js', '/push-sw.js', '/manifest.webmanifest', '/admin.webmanifest',
  '/icon-*', '/og-image.png', '/robots.txt', '/sitemap.xml',
];
// extras (noindex, Cache-Control) só nas páginas do painel; os nomes não repetem os de "todas as páginas"
const EXTRAS = { [FONTE_ADMIN]: ['/admin', '/admin.html'], [FONTE_PLATAFORMA]: ['/plataforma', '/plataforma.html'] };

const blocoDe = (vercel, fonte) => {
  const b = (vercel.headers || []).find((x) => x.source === fonte);
  if (!b) throw new Error(`vercel.json: faltou o bloco de cabeçalhos "${fonte}"`);
  return b.headers;
};

function gerarHeaders(vercel) {
  const fontes = (vercel.headers || []).map((b) => b.source);
  const conhecidas = [FONTE_TODAS, FONTE_PREVIA, FONTE_API, FONTE_ADMIN, FONTE_PLATAFORMA];
  const nova = fontes.filter((f) => !conhecidas.includes(f));
  if (nova.length) throw new Error(`vercel.json tem cabeçalhos para ${nova.join(', ')}: ensine lib/cloudflare-arquivos.js a traduzir`);
  const linhas = (hs) => hs.map((h) => `  ${h.key}: ${h.value}`).join('\n');
  const partes = ['# Gerado por scripts/cloudflare-arquivos.js a partir do vercel.json. Não edite à mão.'];
  const todas = linhas(blocoDe(vercel, FONTE_TODAS));
  for (const e of ENDERECOS_DO_SITE) partes.push(`${e}\n${todas}`);
  partes.push(`${FONTE_PREVIA}\n${linhas(blocoDe(vercel, FONTE_PREVIA))}`);
  for (const [fonte, ends] of Object.entries(EXTRAS)) for (const e of ends) partes.push(`${e}\n${linhas(blocoDe(vercel, fonte))}`);
  return partes.join('\n\n') + '\n';
}

/** Vercel: /feira/:id e /previa → _redirects do Cloudflare. */
function gerarRedirects(vercel) {
  const saida = ['# Gerado por scripts/cloudflare-arquivos.js a partir do vercel.json. Não edite à mão.'];
  for (const r of vercel.redirects || []) saida.push(`${r.source} ${r.destination} ${r.permanent ? 301 : 302}`);
  for (const r of vercel.rewrites || []) saida.push(`${r.source} ${r.destination} 200`);
  return saida.join('\n') + '\n';
}

/** Endereços do _headers que valem para o mesmo caminho concreto (para o teste de "não soma"). */
const casa = (padrao, caminho) => new RegExp('^' + padrao.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(caminho);

module.exports = { gerarHeaders, gerarRedirects, ENDERECOS_DO_SITE, EXTRAS, casa };
