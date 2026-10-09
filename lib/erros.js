'use strict';
// =====================================================================
//  lib/erros.js — REGISTRO DE ERROS DO SITE (o que quebra no celular dos clientes).
//
//  O navegador (js/erros-site.js) manda o erro para /api/analytics { acao: 'erro' }.
//  Aqui ele é limpo, agrupado e contado: o mesmo erro no mesmo dia vira UM documento
//  (erros_site/{dia}_{assinatura}) com a contagem, em vez de mil documentos iguais.
//  A Plataforma lê a lista (aba Erros). A rotina da noite apaga o que passou de 14 dias.
//
//  Nada de dado pessoal: a página vai sem os parâmetros do endereço, o navegador vai
//  resumido ("Android · Chrome 129") e nenhum campo digitado pelo cliente entra aqui.
//  As regras do banco não deixam navegador nenhum ler nem gravar erros_site.
// =====================================================================
const crypto = require('crypto');
const H = require('./http');
const T = require('./tenant');

const COLECAO = 'erros_site';
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
  const arquivo = semParametros(b.arquivo);
  const loja = typeof b.loja === 'string' && T.idValido(b.loja) ? b.loja : '';
  return {
    tipo: ['erro', 'promessa', 'recurso'].includes(b.tipo) ? b.tipo : 'erro',
    msg,
    onde: arquivo ? `${arquivo}${linha ? `:${linha}${coluna ? `:${coluna}` : ''}` : ''}` : '',
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
      lojas: r.loja ? [r.loja] : [], navegadores: [r.navegador], paginas: [r.pagina] });
    return id;
  }
  const d = s.data(), junta = (lista, v, max) => (v && !(lista || []).includes(v) ? [...(lista || []), v].slice(-max) : lista || []);
  await ref.set({ ultimo: quando, vezes: inc, versao: r.versao || d.versao || '',
    lojas: junta(d.lojas, r.loja, 12), navegadores: junta(d.navegadores, r.navegador, 8), paginas: junta(d.paginas, r.pagina, 8) }, { merge: true });
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

/** Para a Plataforma: os erros dos últimos `dias`, do mais recente para o mais antigo. */
async function listar(db, dias = 7, agora = Date.now()) {
  const desde = diaBR(agora - (dias - 1) * 86400000);
  const s = await db.collection(COLECAO).where('dia', '>=', desde).get();
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)))
    .slice(0, 150);
}

/** Rotina da noite: apaga o que passou de 14 dias (até 400 por noite). */
async function faxina(db, agora = Date.now()) {
  const limite = diaBR(agora - DIAS_GUARDADOS * 86400000);
  const s = await db.collection(COLECAO).where('dia', '<', limite).limit(400).get();
  const lote = db.batch(); s.docs.forEach((d) => lote.delete(d.ref)); if (s.docs.length) await lote.commit();
  return s.docs.length;
}

module.exports = { limparRelato, assinatura, gravar, receber, listar, faxina, navegadorResumido, semParametros, COLECAO };
