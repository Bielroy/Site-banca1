'use strict';
// =====================================================================
//  lib/erros.js — REGISTRO DE ERROS DO SITE (o que quebra no celular dos clientes).
//
//  O navegador (js/erros-site.js) manda o erro para /api/analytics { acao: 'erro' }.
//  Aqui ele é limpo, agrupado e contado: o mesmo erro no mesmo dia vira UM documento
//  (erros_site/{dia}_{assinatura}) com a contagem, em vez de mil documentos iguais.
//  A Plataforma lê a lista (aba Erros). A rotina da noite apaga o que passou de 14 dias.
//
//  Também chegam os DEFEITOS DE TELA (tipo 'visual', js/vigia-tela.js: preço cortado, botão
//  coberto...) com o tamanho da tela ("390px · letra 150%"), e o aviso do cliente pelo botão
//  "Algo estranho na tela?" (tipo 'relato', só opções fixas, sem texto livre).
//  Na aba, o dono marca "Corrigi" (erros_estado/{assinatura}); se o mesmo erro aparecer de novo
//  depois da marca, a linha volta como "Voltou depois de corrigido".
//
//  Nada de dado pessoal: a página vai sem os parâmetros do endereço, o navegador vai
//  resumido ("Android · Chrome 129") e nenhum campo digitado pelo cliente entra aqui.
//  As regras do banco não deixam navegador nenhum ler nem gravar erros_site.
// =====================================================================
const crypto = require('crypto');
const H = require('./http');
const T = require('./tenant');

const COLECAO = 'erros_site';
const COLECAO_ESTADO = 'erros_estado';          // {assinatura}: { estado: 'corrigido', em, por } — o que já foi consertado
// erro: código que quebrou · promessa: promessa sem tratamento · recurso: arquivo que não veio
// visual: defeito no desenho da tela (js/vigia-tela.js) · relato: o cliente tocou em "Algo estranho na tela?"
const TIPOS = ['erro', 'promessa', 'recurso', 'visual', 'relato'];
const DIAS_GUARDADOS = 14;
const diaBR = (agora = Date.now()) => new Date(agora - 3 * 3600000).toISOString().slice(0, 10);

/** Endereço sem parâmetros nem #: "https://site/x.js?v=1#a" → "/x.js" (só do nosso site; de fora vira o domínio). */
function semParametros(u) {
  const t = String(u || '').slice(0, 400);
  if (!t) return '';
  try {
    const x = new URL(t, 'https://site.invalid');
    if (x.origin === 'https://site.invalid' || /\.vercel\.app$|localhost/.test(x.hostname)) return x.pathname.slice(0, 120);
    return x.protocol.startsWith('http') ? x.hostname.slice(0, 80) : x.protocol.replace(':', '');
  } catch (_) { return H.textoCurto(t.split(/[?#]/)[0], 120); }
}

/** "Mozilla/5.0 (Linux; Android 14; ...) Chrome/129.0..." → "Android · Chrome 129". */
function navegadorResumido(ua) {
  const s = String(ua || '');
  const so = /iPhone|iPad|iPod/.test(s) ? 'iPhone' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'outro';
  const m = /(EdgA?|SamsungBrowser|OPR|Firefox|FxiOS|CriOS|Chrome|Version)\/(\d+)/.exec(s);
  const nomes = { Edg: 'Edge', EdgA: 'Edge', SamsungBrowser: 'Samsung', OPR: 'Opera', FxiOS: 'Firefox', CriOS: 'Chrome', Version: 'Safari' };
  return m ? `${so} · ${nomes[m[1]] || m[1]} ${m[2]}` : so;
}

// Barulho que não é defeito nosso: extensão do navegador, aviso do ResizeObserver, erro opaco de script de fora.
const BARULHO = [/^Script error\.?$/i, /ResizeObserver loop/i, /chrome-extension:|moz-extension:|safari-(web-)?extension:/i, /^Non-Error promise rejection captured/i, /__gCrWeb|webkit\.messageHandlers/i];

/**
 * Limpa o que o navegador mandou. Devolve null quando não vale guardar.
 * @returns {{ tipo, msg, onde, pilha, pagina, loja, navegador, versao } | null}
 */
function limparRelato(corpo, ua) {
  const b = corpo && typeof corpo === 'object' ? corpo : {};
  const msg = H.textoCurto(b.msg, 300);
  if (!msg) return null;
  const pilha = String(b.pilha == null ? '' : b.pilha).slice(0, 1500)
    .replace(/https?:\/\/[^\s)]+/g, (u) => semParametros(u))                   // endereços da pilha sem parâmetros
    .replace(/[\u0000-\u0008\u000b-\u001f<>]/g, ' ').slice(0, 900);
  if (BARULHO.some((r) => r.test(msg) || r.test(pilha) || r.test(String(b.arquivo || '')))) return null;
  const linha = Number.isFinite(+b.linha) ? Math.max(0, Math.min(999999, Math.floor(+b.linha))) : 0;
  const coluna = Number.isFinite(+b.coluna) ? Math.max(0, Math.min(999999, Math.floor(+b.coluna))) : 0;
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'erro';
  const deTela = tipo === 'visual' || tipo === 'relato';
  // defeito de tela: "onde" é o lugar na página (seletor do CSS), não um arquivo
  const arquivo = deTela ? String(b.arquivo == null ? '' : b.arquivo).replace(/[^\w#.\- >\[\]="]/g, '').slice(0, 160).trim() : semParametros(b.arquivo);
  const loja = typeof b.loja === 'string' && T.idValido(b.loja) ? b.loja : '';
  // tamanho da tela e da letra: "390px · letra 150%" / "844px deitado · letra 100%" (só esse formato entra)
  const tela = deTela && /^\d{3,4}px( deitado)? · letra \d{2,3}%$/.test(String(b.tela || '')) ? String(b.tela) : '';
  return {
    tipo,
    msg,
    tela,
    onde: deTela ? arquivo : arquivo ? `${arquivo}${linha ? `:${linha}${coluna ? `:${coluna}` : ''}` : ''}` : '',
    pilha,
    pagina: semParametros(b.pagina) || '/',
    loja,
    navegador: navegadorResumido(ua),
    versao: H.textoCurto(b.versao, 40),
  };
}

/** Mesmo erro = mesma mensagem (sem números que mudam a cada vez) no mesmo lugar. */
function assinatura(r) {
  const msgBase = r.msg.replace(/\d+/g, '#').slice(0, 200);
  return crypto.createHash('sha256').update(`${r.tipo}|${msgBase}|${r.onde.replace(/:\d+(:\d+)?$/, '')}`).digest('hex').slice(0, 20);
}

/** Grava (ou soma +1 no) erro do dia. */
async function gravar(db, r, admin, agora = Date.now()) {
  const dia = diaBR(agora), id = `${dia}_${assinatura(r)}`, quando = new Date(agora).toISOString();
  const ref = db.collection(COLECAO).doc(id), inc = admin.firestore.FieldValue.increment(1);
  const s = await ref.get();
  if (!s.exists) {
    await ref.set({ dia, tipo: r.tipo, msg: r.msg, onde: r.onde, pilha: r.pilha, pagina: r.pagina, versao: r.versao, primeiro: quando, ultimo: quando, vezes: 1,
      lojas: r.loja ? [r.loja] : [], navegadores: [r.navegador], paginas: [r.pagina], telas: r.tela ? [r.tela] : [] });
    return id;
  }
  const d = s.data(), junta = (lista, v, max) => (v && !(lista || []).includes(v) ? [...(lista || []), v].slice(-max) : lista || []);
  await ref.set({ ultimo: quando, vezes: inc, versao: r.versao || d.versao || '',
    lojas: junta(d.lojas, r.loja, 12), navegadores: junta(d.navegadores, r.navegador, 8), paginas: junta(d.paginas, r.pagina, 8), telas: junta(d.telas, r.tela, 10) }, { merge: true });
  return id;
}

/**
 * POST /api/analytics { acao: 'erro', ... } — sem login (o erro pode acontecer antes dele).
 * Freio: 10 por minuto por endereço de internet e 300 por minuto no total.
 */
async function receber(db, req, res, admin) {
  if (H.passouNaMemoria(`erro:${H.ipDe(req)}`, 10, 60000) || H.passouNaMemoria('erro:todos', 300, 60000)) return res.status(429).json({ sucesso: false });
  const r = limparRelato(req.body, req.headers && req.headers['user-agent']);
  if (!r) return res.status(204).end();
  try { await gravar(db, r, admin); }
  catch (e) { console.error('[erros] gravar', e && e.message); }
  return res.status(204).end();
}

/**
 * Para a Plataforma (aba Erros): os erros dos últimos `dias`, JUNTOS por assinatura (o mesmo defeito em dias
 * diferentes vira uma linha só, com os dias e a soma das vezes), do mais recente para o mais antigo.
 * Cada linha diz se já foi marcada como corrigida e se VOLTOU depois disso (apareceu de novo depois da marca).
 */
async function listar(db, dias = 7, agora = Date.now()) {
  const desde = diaBR(agora - (dias - 1) * 86400000);
  const s = await db.collection(COLECAO).where('dia', '>=', desde).get();
  const porAssinatura = new Map();
  const une = (a, b, max) => [...new Set([...(a || []), ...(b || [])])].slice(-max);
  for (const d of s.docs) {
    const e = d.data(), ass = String(d.id).split('_').slice(1).join('_') || d.id;
    const j = porAssinatura.get(ass);
    if (!j) { porAssinatura.set(ass, { ...e, id: d.id, assinatura: ass, dias: [e.dia], vezes: Number(e.vezes) || 1 }); continue; }
    j.vezes += Number(e.vezes) || 1;
    j.dias = une(j.dias, [e.dia], dias);
    if (String(e.ultimo) > String(j.ultimo)) Object.assign(j, { ultimo: e.ultimo, versao: e.versao || j.versao, pilha: e.pilha || j.pilha, id: d.id });
    if (String(e.primeiro) < String(j.primeiro)) j.primeiro = e.primeiro;
    j.lojas = une(j.lojas, e.lojas, 12); j.navegadores = une(j.navegadores, e.navegadores, 8); j.paginas = une(j.paginas, e.paginas, 8); j.telas = une(j.telas, e.telas, 10);
  }
  const lista = [...porAssinatura.values()];
  // estado (corrigido) de cada um: uma leitura por linha, só das que aparecem (no máximo 150)
  const saida = lista.sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo))).slice(0, 150);
  await Promise.all(saida.map(async (e) => {
    try {
      const st = await db.collection(COLECAO_ESTADO).doc(e.assinatura).get();
      if (!st.exists) return;
      const x = st.data() || {};
      if (x.estado === 'corrigido') { e.corrigidoEm = x.em || ''; e.voltou = String(e.ultimo) > String(x.em || ''); }
    } catch (_) { /* sem o estado, a linha aparece como aberta */ }
  }));
  return saida;
}

const ASSINATURA_OK = /^[a-f0-9]{20}$/;
/**
 * Plataforma: marca um defeito como corrigido (some da lista de abertos; se acontecer de novo, volta como "voltou")
 * ou reabre. { assinatura, estado: 'corrigido' | 'aberto' }
 */
async function marcarEstado(db, corpo, quem = '', agora = Date.now()) {
  const b = corpo || {};
  const ass = String(b.assinatura || '');
  if (!ASSINATURA_OK.test(ass)) throw Object.assign(new Error('Erro desconhecido.'), { status: 400 });
  const ref = db.collection(COLECAO_ESTADO).doc(ass);
  if (b.estado === 'aberto') { await ref.delete(); return { estado: 'aberto' }; }
  if (b.estado !== 'corrigido') throw Object.assign(new Error('Estado inválido.'), { status: 400 });
  const em = new Date(agora).toISOString();
  await ref.set({ estado: 'corrigido', em, por: H.textoCurto(quem, 80) });
  return { estado: 'corrigido', em };
}

/** Rotina da noite: apaga o que passou de 14 dias (até 400 por noite). */
async function faxina(db, agora = Date.now()) {
  const limite = diaBR(agora - DIAS_GUARDADOS * 86400000);
  const s = await db.collection(COLECAO).where('dia', '<', limite).limit(400).get();
  const lote = db.batch(); s.docs.forEach((d) => lote.delete(d.ref)); if (s.docs.length) await lote.commit();
  // marca de "corrigido" com mais de 30 dias: o erro nem existe mais na lista (14 dias), a marca sai também
  try {
    const velho = new Date(agora - 30 * 86400000).toISOString();
    const e = await db.collection(COLECAO_ESTADO).where('em', '<', velho).limit(200).get();
    if (e.docs.length) { const l2 = db.batch(); e.docs.forEach((d) => l2.delete(d.ref)); await l2.commit(); }
  } catch (err) { console.error('[erros] faxina das marcas', err && err.message); }
  return s.docs.length;
}

module.exports = { limparRelato, assinatura, gravar, receber, listar, marcarEstado, faxina, navegadorResumido, semParametros, COLECAO, COLECAO_ESTADO, TIPOS };
