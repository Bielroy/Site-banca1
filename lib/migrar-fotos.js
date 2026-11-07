'use strict';
// =====================================================================
//  lib/migrar-fotos.js — LEVA AS FOTOS DO IMGBB PARA O CLOUDFLARE R2 E TROCA OS LINKS NO BANCO.
//
//  Quem chama: server/migrar-fotos.js, rodado no servidor da AWS (dentro do contêiner, que já tem as chaves):
//      docker exec loja node server/migrar-fotos.js            → SIMULAÇÃO: só conta, não grava nada
//      docker exec loja node server/migrar-fotos.js --gravar   → copia para o R2 e troca os links
//      docker exec loja node server/migrar-fotos.js --desfazer → volta os links para o ImgBB
//
//  Como funciona
//    1. Lê os documentos de cada loja onde há foto (produtos, categorias, loja/*, calendário, a ficha da loja,
//       feiras e plataforma) e acha QUALQUER link do ImgBB, em qualquer campo, em qualquer profundidade
//       (foto, fotoMini, banco de fotos, vitrine, cartaz, logo, fundo...). Nenhum nome de campo é suposto.
//    2. Baixa cada foto UMA vez (o mesmo link em vários produtos conta uma), confere que é imagem de verdade
//       (os primeiros bytes, não o nome) e que não é a figura azul de erro do ImgBB.
//       Se o ImgBB já perdeu a foto, tenta a miniatura que o redutor do site guardou (/_vercel/image).
//    3. Guarda no R2 com nome fixo (migrado/<resumo do link>.<tipo>): rodar de novo não duplica nada.
//    4. Anota cada troca em migracao_fotos/{resumo} = { de, para } ANTES de mexer nos documentos. É a lista
//       que permite desfazer e que faz a segunda rodada pular o que já foi.
//    5. Troca os links só nos campos que mudaram (o resto do documento não é regravado).
//  Foto que não deu para salvar fica com o link antigo, e aparece no relatório com o produto onde está.
// =====================================================================
const crypto = require('crypto');
const T = require('./tenant');
const R2 = require('./r2');

const COLECOES = ['produtos', 'categorias', 'loja', 'calendario'];
const COLECAO_MAPA = 'migracao_fotos';
const MAX_BYTES = 15 * 1024 * 1024;
const MIN_BYTES = 2048;                        // a figura de erro do ImgBB é minúscula; foto de verdade nunca é
const AO_MESMO_TEMPO = 4;

// Link do ImgBB dentro de qualquer texto (campo puro, CSS url(...), HTML). Para no que não pode estar num link.
const LINK_IBB = /https?:\/\/(?:[a-z0-9-]+\.)*ibb\.co\/[^\s"'<>()\\[\]{}`,]+/gi;
// Link já migrado (para desfazer)
const LINK_MIGRADO = /https:\/\/[a-z0-9.-]+\/migrado\/[a-f0-9]{32}\.(?:webp|jpg|png|gif)/gi;

const TIPOS = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const EXT_DO_NOME = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

/** Que imagem é esta? Pelos primeiros bytes. */
function tipoDosBytes(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  return '';
}

const simples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** Todos os links (do padrão dado) dentro de um valor qualquer do banco. Datas e referências são puladas. */
function acharLinks(valor, padrao = LINK_IBB, saida = new Set()) {
  if (typeof valor === 'string') { for (const m of valor.match(new RegExp(padrao.source, 'gi')) || []) saida.add(m); }
  else if (Array.isArray(valor)) valor.forEach((x) => acharLinks(x, padrao, saida));
  else if (simples(valor)) Object.values(valor).forEach((x) => acharLinks(x, padrao, saida));
  return saida;
}
/** Cópia do valor com os links trocados pelo mapa (link que não está no mapa fica como está). */
function trocarLinks(valor, mapa, padrao = LINK_IBB) {
  if (typeof valor === 'string') return valor.replace(new RegExp(padrao.source, 'gi'), (m) => (mapa.has(m) ? mapa.get(m) : m));
  if (Array.isArray(valor)) return valor.map((x) => trocarLinks(x, mapa, padrao));
  if (simples(valor)) { const o = {}; for (const [k, x] of Object.entries(valor)) o[k] = trocarLinks(x, mapa, padrao); return o; }
  return valor;                                // data, número, referência: o mesmo objeto
}
/** Só os campos de primeiro nível que mudaram: { campo: valorNovo }. */
function camposMudados(dados, mapa, padrao = LINK_IBB) {
  const saida = {};
  for (const [k, v] of Object.entries(dados || {})) {
    const novo = trocarLinks(v, mapa, padrao);
    if (JSON.stringify(novo) !== JSON.stringify(v)) saida[k] = novo;
  }
  return saida;
}

const resumo = (url) => crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
/** O link aponta para um ARQUIVO? (ibb.co/xxxx sem "i." é a página do ImgBB, não a foto) */
const ehArquivo = (url) => { try { const u = new URL(url); return u.hostname.toLowerCase() !== 'ibb.co' && u.pathname.length > 1; } catch (_) { return false; } };
const extDoLink = (url) => { try { return EXT_DO_NOME[((new URL(url).pathname.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase()] || ''; } catch (_) { return ''; } };

async function buscar(url, fetch, tempo = 30000) {
  const ctl = new AbortController(), relogio = setTimeout(() => ctl.abort(), tempo);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'loja-migracao-fotos/1' } });
    if (!r.ok) { try { await r.body?.cancel(); } catch (_) { /* nada */ } return { motivo: `respondeu ${r.status}` }; }
    if (Number(r.headers.get('content-length')) > MAX_BYTES) return { motivo: 'grande demais' };
    const buf = Buffer.from(await r.arrayBuffer());
    return { r, buf };
  } catch (e) { return { motivo: e && e.name === 'AbortError' ? 'demorou demais' : 'não abriu' }; }
  finally { clearTimeout(relogio); }
}

/** Baixa a foto do ImgBB e confere que é a foto mesmo. { buf, ext } ou { motivo }. */
async function baixar(url, { fetch = global.fetch } = {}) {
  const { r, buf, motivo } = await buscar(url, fetch);
  if (motivo) return { motivo };
  if (buf.length > MAX_BYTES) return { motivo: 'grande demais' };
  if (buf.length < MIN_BYTES) return { motivo: 'arquivo minúsculo (figura de erro do ImgBB)' };
  const ext = tipoDosBytes(buf);
  if (!ext) return { motivo: 'não é imagem' };
  // O ImgBB, quando perde o arquivo, manda para OUTRO arquivo (a figura de erro)
  try { if (r.redirected && r.url && new URL(r.url).pathname !== new URL(url).pathname) return { motivo: 'o ImgBB mandou para outra imagem (foto perdida)' }; } catch (_) { /* segue */ }
  const doNome = extDoLink(url);
  if (doNome && doNome !== ext) return { motivo: `o arquivo .${doNome} veio como ${ext} (figura de erro do ImgBB)` };
  return { buf, ext };
}

/** A foto sumiu do ImgBB: a miniatura de 828 px que o redutor do site pode ter guardado. */
async function resgatar(url, { fetch = global.fetch, site = '' } = {}) {
  if (!site) return { motivo: 'sem endereço do site' };
  const { buf, motivo } = await buscar(`${site}/_vercel/image?url=${encodeURIComponent(url)}&w=828&q=75&v=4`, fetch);
  if (motivo) return { motivo };
  const ext = tipoDosBytes(buf);
  if (!ext || buf.length < MIN_BYTES) return { motivo: 'nenhuma cópia guardada' };
  return { buf, ext, resgatada: true };
}

/** Endereço do site (para o resgate pelo redutor). */
function siteDaLoja() {
  try { const u = new URL(String(process.env.PUBLIC_BASE_URL || '')); if (u.protocol === 'https:') return u.origin; } catch (_) { /* padrão */ }
  return 'https://usebanca.com';
}

/** Os documentos onde pode haver foto. [{ ref, data }] */
async function lerDocumentos(db, { pedidos = false } = {}) {
  const fichas = await db.collection('tenants').get();
  const lojas = [...new Set([T.TENANT_PADRAO, ...fichas.docs.map((d) => d.id).filter(T.idValido)])];
  const cols = pedidos ? [...COLECOES, 'pedidos'] : COLECOES;
  const docs = fichas.docs.map((d) => ({ ref: d.ref, data: d.data() }));         // a ficha de cada loja (logo, tema...)
  for (const tid of lojas) {
    for (const c of cols) {
      const s = await T.tcol(db, tid, c).get();
      for (const d of s.docs) docs.push({ ref: d.ref, data: d.data() });
    }
  }
  for (const c of ['feiras', 'plataforma']) {
    const s = await db.collection(c).get();
    for (const d of s.docs) if (!(c === 'plataforma' && d.id === 'segredos')) docs.push({ ref: d.ref, data: d.data() });
  }
  return docs;
}

async function lerMapa(db) {
  const s = await db.collection(COLECAO_MAPA).get();
  const mapa = new Map();
  for (const d of s.docs) { const x = d.data(); if (x && typeof x.de === 'string' && typeof x.para === 'string') mapa.set(x.de, x.para); }
  return mapa;
}

/** Roda várias tarefas, poucas por vez. */
async function emGrupos(itens, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k], k); } }));
}

/** Grava só os campos que mudaram (o resto do documento fica intacto). */
async function gravarCampos(ref, campos) {
  const nomes = Object.keys(campos);
  if (!nomes.length) return;
  if (nomes.every((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) await ref.set(campos, { mergeFields: nomes });
  else await ref.set(campos, { merge: true });
}

/**
 * A migração. opcoes: { gravar, pedidos, fetch, log, limite, site }.
 * Devolve o relatório: { documentos, links, unicos, jaMigrados, copiados, resgatados, perdidas: [...], paginas: [...], documentosTrocados, simulacao }.
 */
async function migrar(db, opcoes = {}) {
  const { gravar = false, fetch = global.fetch, log = () => {}, limite = Infinity, site = siteDaLoja() } = opcoes;
  if (gravar && !R2.config()) throw Object.assign(new Error(`O R2 não está configurado no servidor. Falta: ${R2.faltando().join(', ')}.`), { codigo: 'sem-r2' });

  log('Lendo o banco...');
  const docs = await lerDocumentos(db, opcoes);
  const onde = new Map();                                        // link → caminhos dos documentos (para o relatório)
  let links = 0;
  for (const d of docs) for (const u of acharLinks(d.data)) { links++; if (!onde.has(u)) onde.set(u, []); onde.get(u).push(d.ref.path); }
  const mapa = await lerMapa(db);
  const rel = { simulacao: !gravar, documentos: docs.length, links, unicos: onde.size, jaMigrados: 0, copiados: 0, resgatados: 0, perdidas: [], paginas: [], documentosTrocados: 0 };

  const pendentes = [];
  for (const [u, caminhos] of onde) {
    if (mapa.has(u)) { rel.jaMigrados++; continue; }
    if (!ehArquivo(u)) { rel.paginas.push({ link: u, onde: caminhos.slice(0, 3) }); continue; }
    pendentes.push(u);
  }
  const fila = pendentes.slice(0, limite);
  log(`${docs.length} documentos, ${onde.size} fotos diferentes do ImgBB. Já copiadas antes: ${rel.jaMigrados}. A conferir agora: ${fila.length}.`);

  let feitos = 0;
  await emGrupos(fila, AO_MESMO_TEMPO, async (u) => {
    let foto = await baixar(u, { fetch });
    if (!foto.buf) { const salva = await resgatar(u, { fetch, site }); foto = salva.buf ? salva : { motivo: foto.motivo }; }
    if (!foto.buf) { rel.perdidas.push({ link: u, motivo: foto.motivo, onde: onde.get(u).slice(0, 3) }); }
    else {
      if (foto.resgatada) rel.resgatados++;
      if (gravar) {
        const nome = `migrado/${resumo(u)}.${foto.ext}`;
        try {
          if (!(await R2.existe(nome, { fetch }))) await R2.enviar(nome, foto.buf, TIPOS[foto.ext], { fetch });
          const para = R2.urlPublica(nome);
          await db.collection(COLECAO_MAPA).doc(resumo(u)).set({ de: u, para, em: new Date().toISOString(), resgatada: !!foto.resgatada, bytes: foto.buf.length });
          mapa.set(u, para);
          rel.copiados++;
        } catch (e) { rel.perdidas.push({ link: u, motivo: `não gravou no R2 (${(e && e.message) || 'erro'})`, onde: onde.get(u).slice(0, 3) }); }
      } else rel.copiados++;                                     // na simulação: "daria para copiar"
    }
    if (++feitos % 25 === 0) log(`  ${feitos}/${fila.length}...`);
  });

  if (gravar) {
    for (const d of docs) {
      const campos = camposMudados(d.data, mapa);
      if (!Object.keys(campos).length) continue;
      await gravarCampos(d.ref, campos);
      rel.documentosTrocados++;
    }
  }
  return rel;
}

/** Volta os links do R2 para os do ImgBB (pela lista migracao_fotos). As fotos ficam no R2. */
async function desfazer(db, { log = () => {} } = {}) {
  const ida = await lerMapa(db);
  const volta = new Map([...ida].map(([de, para]) => [para, de]));
  const docs = await lerDocumentos(db, { pedidos: true });
  let trocados = 0;
  for (const d of docs) {
    const campos = camposMudados(d.data, volta, LINK_MIGRADO);
    if (!Object.keys(campos).length) continue;
    await gravarCampos(d.ref, campos);
    trocados++;
  }
  log(`${trocados} documentos voltaram para os links do ImgBB.`);
  return { documentosTrocados: trocados, links: volta.size };
}

module.exports = { migrar, desfazer, acharLinks, trocarLinks, camposMudados, baixar, resgatar, tipoDosBytes, ehArquivo, resumo, lerDocumentos, LINK_IBB, LINK_MIGRADO, COLECAO_MAPA, COLECOES };
