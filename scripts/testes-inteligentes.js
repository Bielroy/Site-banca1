#!/usr/bin/env node
'use strict';
// =====================================================================
//  scripts/testes-inteligentes.js — QUAIS TESTES PRECISAM RODAR para uma mudança.
//
//  Olha os arquivos que mudaram e escolhe só as baterias que eles podem afetar:
//     servidor  testes/index.js + carga (banco de mentira, ~1 min) — qualquer código
//     build     npm ci + build + arquivos do Cloudflare             — o que vai para o site
//     regras    regras do banco no emulador do Firebase            — firestore.rules, storage.rules
//     tela      testes de tela (loja e painel, Chromium, ~5 min)    — páginas, js e css de qualquer tela
//     matriz    matriz de telas (tamanhos e letra, ~11 min)         — só o que a LOJA usa
//     iphone    loja no motor do Safari (~4 min)                    — só o que a LOJA usa
//
//  Como sabe o que é "da loja": segue os <script>/<link> de index.html e feira.html e, a partir deles,
//  cada import (também os import('./x.js') que carregam depois) e cada @import do css.
//  O que só o painel usa (admin.html, plataforma.html, sistema.html) roda a bateria "tela", sem matriz nem iPhone.
//
//  NA DÚVIDA, RODA TUDO: arquivo que o mapa não conhece, mudança na própria máquina de testes
//  (.github/, package.json, testes/tela/servidor.js, testes/banco-falso.js) ou este script.
//  Texto e documentação (*.md) não rodam nada.
//
//  Uso:
//    node scripts/testes-inteligentes.js                  diferença para origin/rota-cloudflare
//    node scripts/testes-inteligentes.js --base <ref>     diferença para outra referência
//    node scripts/testes-inteligentes.js --github         escreve "servidor=true" ... em $GITHUB_OUTPUT
//    node scripts/testes-inteligentes.js --rodar          roda aqui as baterias escolhidas (menos regras e build)
//    node scripts/testes-inteligentes.js a.js b.css       escolhe para esta lista de arquivos
// =====================================================================
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const BATERIAS = ['servidor', 'build', 'regras', 'tela', 'matriz', 'iphone'];
const PAGINAS_LOJA = ['index.html', 'feira.html'];
const PAGINAS_PAINEL = ['admin.html', 'plataforma.html', 'sistema.html', 'privacidade.html'];

const ler = (rel) => { try { return fs.readFileSync(path.join(RAIZ, rel), 'utf8'); } catch (_) { return null; } };
const norm = (rel) => path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/^\//, '');
const resolver = (de, alvo) => norm(alvo.startsWith('/') ? alvo : path.posix.join(path.posix.dirname(de), alvo));

/** Arquivos locais que uma página, um js ou um css puxa (sem endereços de fora). */
function dependencias(rel) {
    const txt = ler(rel); if (txt == null) return [];
    const achados = [];
    const pega = (re) => { for (const m of txt.matchAll(re)) { const a = m[1]; if (a && !/^(https?:)?\/\//.test(a) && !a.startsWith('data:')) achados.push(resolver(rel, a.split(/[?#]/)[0])); } };
    if (rel.endsWith('.html')) { pega(/<script[^>]+src="([^"]+)"/g); pega(/<link[^>]+href="([^"]+\.css[^"]*)"/g); }
    else if (rel.endsWith('.js')) { pega(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g); pega(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g); pega(/^\s*import\s+['"]([^'"]+)['"]/gm); }
    else if (rel.endsWith('.css')) { pega(/@import\s+(?:url\()?['"]?([^'")\s;]+)/g); }
    return achados;
}
/** Tudo o que se alcança a partir destas páginas. */
function alcance(paginas) {
    const visto = new Set(), fila = [...paginas];
    while (fila.length) { const f = fila.pop(); if (visto.has(f)) continue; visto.add(f); dependencias(f).forEach((d) => fila.push(d)); }
    return visto;
}

/** Arquivos de lib/ que os testes de tela carregam (require) direto. */
let _libsTela = null;
function libsDosTestesDeTela() {
    if (_libsTela) return _libsTela;
    _libsTela = new Set();
    for (const t of ['testes/tela/tela.test.js', 'testes/tela/iphone.test.js', 'testes/tela/matriz.test.js', 'testes/tela/servidor.js']) {
        for (const m of String(ler(t) || '').matchAll(/['"]((?:\.\.\/)*lib\/[\w-]+(?:\.js)?)['"]|'lib',\s*'([\w-]+\.js)'/g)) _libsTela.add(norm('lib/' + (m[2] || m[1].replace(/^(\.\.\/)*lib\//, ''))).replace(/(\.js)?$/, '.js'));
    }
    return _libsTela;
}
/** Fontes que um gerador junta em outro arquivo (o que a página carrega é o gerado). */
const VIRA = { 'css/admin-escuro-extra.css': 'css/admin-escuro.css' };
const RODA_TUDO = [/^\.github\//, /^package(-lock)?\.json$/, /^testes\/tela\/(servidor\.js|package\.json)$/, /^testes\/banco-falso\.js$/, /^scripts\/testes-inteligentes\.js$/, /^vite\.config\.js$/];
const NADA = [/\.md$/i, /^LICENSE/i, /^\.gitignore$/, /^\.dockerignore$/];

/** { servidor, build, regras, tela, matriz, iphone, porque: { bateria: 'arquivo que a ligou' } } */
function escolher(arquivos) {
    const loja = alcance(PAGINAS_LOJA), painel = alcance(PAGINAS_PAINEL);
    const r = Object.fromEntries(BATERIAS.map((b) => [b, false])); const porque = {};
    const liga = (bs, arq) => bs.forEach((b) => { if (!r[b]) { r[b] = true; porque[b] = arq; } });
    for (const bruto of arquivos) {
        const f0 = norm(bruto); if (!f0) continue;
        const f = VIRA[f0] || f0;                       // fonte de um arquivo gerado conta como o arquivo gerado
        if (NADA.some((re) => re.test(f))) continue;
        if (RODA_TUDO.some((re) => re.test(f))) { liga(BATERIAS, f); continue; }
        let conhecido = false;
        const ehLoja = loja.has(f), ehPainel = painel.has(f);
        if (ehLoja) { liga(['servidor', 'build', 'tela', 'matriz', 'iphone'], f); conhecido = true; }
        if (ehPainel) { liga(['servidor', 'build', 'tela'], f); conhecido = true; }
        if (/^(api|lib|server|functions)\//.test(f) || f === 'Dockerfile') { liga(['servidor', 'build'], f); conhecido = true; }
        if (libsDosTestesDeTela().has(f)) liga(['tela'], f);       // o teste de tela usa este arquivo do servidor direto
        if (/^(firestore|storage)\.rules$/.test(f) || f === 'firebase.json' || /^testes\/regras\//.test(f)) { liga(['regras', 'servidor'], f); conhecido = true; }
        if (/^testes\/(index|seguranca|mundo-simulado)\.js$/.test(f) || /^testes\/(carga|velocidade)\//.test(f)) { liga(['servidor'], f); conhecido = true; }
        if (f === 'testes/tela/tela.test.js' || /^testes\/tela\/(painel-.*\.html|fotos\/)/.test(f)) { liga(['tela'], f); conhecido = true; }
        if (f === 'testes/tela/matriz.test.js') { liga(['matriz', 'iphone'], f); conhecido = true; }   // o iPhone roda a matriz curta
        if (f === 'testes/tela/iphone.test.js') { liga(['iphone'], f); conhecido = true; }
        if (/^scripts\//.test(f) || f === 'vercel.json' || /^[^/]+\.(png|webmanifest|txt|xml)$/.test(f) || /^(sw|push-sw)\.js$/.test(f)) { liga(['servidor', 'build'], f); conhecido = true; }
        // js/css que nenhuma página puxa (carregado por outro caminho, ou novo): não dá para saber quem usa → tudo
        if (!conhecido) liga(BATERIAS, `${f} (não sei quem usa: roda tudo)`);
    }
    return { ...r, porque };
}

function arquivosMudados(base) {
    const saida = execSync(`git diff --name-only ${base}...HEAD`, { cwd: RAIZ, encoding: 'utf8' });
    const soltos = execSync('git status --porcelain', { cwd: RAIZ, encoding: 'utf8' }).split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    return [...new Set([...saida.split('\n'), ...soltos].map((s) => s.trim()).filter(Boolean))];
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const iBase = args.indexOf('--base'), base = iBase >= 0 ? args[iBase + 1] : 'origin/rota-cloudflare';
    const soltos = args.filter((a, i) => !a.startsWith('--') && !(iBase >= 0 && i === iBase + 1));
    const tudo = args.includes('--tudo');
    const arquivos = soltos.length ? soltos : arquivosMudados(base);
    const r = tudo ? { ...Object.fromEntries(BATERIAS.map((b) => [b, true])), porque: Object.fromEntries(BATERIAS.map((b) => [b, 'pedido: --tudo'])) } : escolher(arquivos);
    console.log(`${arquivos.length} arquivo(s) mudaram.`);
    for (const b of BATERIAS) console.log(`  ${r[b] ? 'RODA ' : 'pula '} ${b.padEnd(9)} ${r[b] ? `← ${r.porque[b]}` : ''}`);
    if (args.includes('--github') && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, BATERIAS.map((b) => `${b}=${r[b]}`).join('\n') + '\n');
    if (args.includes('--rodar')) {
        const cmds = { servidor: ['node', ['testes/index.js']], tela: ['node', ['testes/tela/tela.test.js']], iphone: ['node', ['testes/tela/iphone.test.js']], matriz: ['node', ['testes/tela/matriz.test.js']] };
        let falhou = false;
        for (const b of Object.keys(cmds)) {
            if (!r[b]) continue;
            console.log(`\n=== ${b} ===`);
            const x = spawnSync(cmds[b][0], cmds[b][1], { cwd: RAIZ, stdio: 'inherit', env: process.env });
            if (x.status !== 0) falhou = true;
        }
        if (r.regras || r.build) console.log('\n(regras e build rodam no GitHub)');
        process.exit(falhou ? 1 : 0);
    }
}

module.exports = { escolher, alcance, dependencias, BATERIAS };
