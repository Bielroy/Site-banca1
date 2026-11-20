'use strict';
// =====================================================================
//  lib/bot.js — A ÁREA DO DONO no app da ponte: pedir tarefas ao BOT DO SERVIDOR (.github/workflows/tarefas-servidor.yml)
//  pelo celular, com a digital, sem abrir o GitHub nem o terminal.
//
//  Quem entra: SÓ o dono da plataforma (o mesmo de plataforma/dono, que o painel já trava na primeira vez).
//    1. Na Plataforma, o dono gera um código de 8 letras (vale 10 min, uma vez): api/plataforma.js, acao 'bot-codigo'.
//    2. No app da ponte, área do dono, o código vira um token deste celular ("bd1.<id>.<segredo>"; o banco guarda só o hash).
//    3. Cada pedido confere: token certo E a conta que gerou o código ainda é a dona da plataforma (trocou o dono = todos
//       os celulares dele param de valer). A Plataforma lista os celulares e desliga qualquer um.
//  O app pede a digital antes de abrir a área e antes de cada tarefa sensível (o servidor não vê a digital: ela
//  destrava o token guardado no celular; quem não tem o celular e a digital não chega aqui).
//
//  Como pede: o servidor chama a API do GitHub com o BOT_GITHUB_TOKEN (token "fine-grained" do dono, só deste
//  repositório: Actions = leitura e escrita; Deployments = leitura e escrita para aprovar as sensíveis). Tarefa sensível
//  pedida pelo app (com a digital) é APROVADA pelo próprio servidor no ambiente "producao": a digital no app vale como
//  o "Approve" do GitHub Mobile. Pelo GitHub, continua precisando do Approve.
//  "trocar-segredo" não sai pelo app (o valor novo vai como segredo do ambiente, no GitHub).
// =====================================================================
const crypto = require('crypto');

const NORMAIS = ['estado', 'atualizar', 'reiniciar', 'copia-agora', 'ligar-copia'];
const SENSIVEIS = ['limpar-historico', 'limpar-disco'];
const CODIGO_MS = 10 * 60 * 1000;
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REPO_PADRAO = 'Bielroy/Site-banca1';
const FLUXO = 'tarefas-servidor.yml';

const falha = (status, msg) => Object.assign(new Error(msg), { status });
const iso = (ms) => new Date(ms).toISOString();
const curto = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const hashDe = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function novoCodigo() { return [...crypto.randomBytes(8)].map((x) => ALFABETO[x % ALFABETO.length]).join(''); }
function limparCodigo(c) {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return new RegExp(`^[${ALFABETO}]{8}$`).test(s) ? s : null;
}
/** "bd1.<id>.<segredo>" → { id, segredo } ou null. */
function lerToken(t) {
  const m = /^bd1\.(bd[0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/.exec(String(t || '').trim());
  return m ? { id: m[1], segredo: m[2] } : null;
}
function confere(segredo, hash) {
  const a = Buffer.from(hashDe(segredo), 'hex'), b = Buffer.from(/^[0-9a-f]{64}$/.test(String(hash || '')) ? hash : '', 'hex');
  return b.length === 32 && crypto.timingSafeEqual(a, b);
}

async function donoDaPlataforma(db) {
  const s = await db.collection('plataforma').doc('dono').get();
  return s.exists ? s.data() : null;
}

/** Plataforma (só o dono): código de 8 letras para ligar a área do dono num celular. */
async function criarCodigo(db, dec) {
  const dono = await donoDaPlataforma(db);
  if (!dono || dono.uid !== dec.uid) throw falha(403, 'Só o dono da plataforma liga a área do dono no app.');
  for (let i = 0; i < 5; i++) {
    const codigo = novoCodigo(), ref = db.collection('botCodigos').doc(codigo), agora = Date.now();
    const ok = await db.runTransaction(async (tr) => {
      const s = await tr.get(ref);
      if (s.exists && Date.parse(s.data().expira) > agora) return false;
      tr.set(ref, { uid: dec.uid, email: curto(dec.email, 120), criadoEm: iso(agora), expira: iso(agora + CODIGO_MS) });
      return true;
    });
    if (ok) return { codigo, minutos: CODIGO_MS / 60000 };
  }
  throw falha(500, 'Não consegui gerar o código agora. Tente de novo.');
}

/** App: troca o código pelo token deste celular. */
async function entrar(db, { codigo, app } = {}) {
  const c = limparCodigo(codigo);
  if (!c) throw falha(400, 'Código inválido. Confira as 8 letras na Plataforma.');
  const ref = db.collection('botCodigos').doc(c), agora = Date.now();
  const id = 'bd' + crypto.randomBytes(8).toString('hex'), segredo = crypto.randomBytes(32).toString('base64url');
  const modelo = curto(app && app.modelo, 60) || 'Celular do dono';
  await db.runTransaction(async (tr) => {
    const s = await tr.get(ref);
    if (!s.exists || Date.parse(s.data().expira) <= agora) throw falha(400, 'Código vencido ou já usado. Gere outro na Plataforma.');
    const k = s.data();
    tr.delete(ref);
    tr.set(db.collection('botAparelhos').doc(id), { hash: hashDe(segredo), uid: k.uid, email: k.email || '', modelo, criadoEm: iso(agora), visto: iso(agora) });
  });
  return { token: `bd1.${id}.${segredo}`, modelo };
}

/** Token válido E dono ainda é dono → o aparelho; senão null. */
async function aparelhoDoToken(db, token) {
  const tk = lerToken(token);
  if (!tk) return null;
  const s = await db.collection('botAparelhos').doc(tk.id).get();
  if (!s.exists || !confere(tk.segredo, s.data().hash)) return null;
  const ap = { ...s.data(), id: tk.id };
  const dono = await donoDaPlataforma(db);
  if (!dono || dono.uid !== ap.uid) return null;
  return ap;
}

async function listarAparelhos(db) {
  const q = await db.collection('botAparelhos').get();
  return q.docs.map((d) => ({ id: d.id, modelo: d.data().modelo || '', email: d.data().email || '', criadoEm: d.data().criadoEm || '', visto: d.data().visto || '' }))
    .sort((a, b) => String(b.visto).localeCompare(String(a.visto)));
}
async function removerAparelho(db, id) {
  if (!/^bd[0-9a-f]{16}$/.test(String(id || ''))) throw falha(400, 'Celular inválido.');
  await db.collection('botAparelhos').doc(id).delete();
  return { removido: id };
}

// ---------------------------------------------------------------- GitHub
function github(env = process.env, fetchFn = globalThis.fetch) {
  const token = env.BOT_GITHUB_TOKEN, repo = /^[\w.-]+\/[\w.-]+$/.test(env.BOT_REPO || '') ? env.BOT_REPO : REPO_PADRAO;
  if (!token) throw falha(503, 'Falta o BOT_GITHUB_TOKEN no servidor (PUBLICAR.md, "Área do dono no app da ponte").');
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetchFn(`https://api.github.com/repos/${repo}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'usebanca-bot', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (_) { /* resposta sem JSON */ }
    if (!r.ok) {
      const motivo = r.status === 401 || r.status === 403 ? 'o GitHub recusou o BOT_GITHUB_TOKEN (vencido ou sem permissão)' : `o GitHub respondeu ${r.status}`;
      throw falha(502, `Não deu para pedir ao bot: ${motivo}.`);
    }
    return j;
  };
  return { chamar, repo };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pede a tarefa. Sensível: depois de pedir, acha o trabalho (pela marca única) e aprova o ambiente "producao".
 * Devolve { pedido, tarefa, sensivel, aprovada, link }.
 */
async function pedirTarefa(db, ap, { tarefa } = {}, { env = process.env, fetchFn = globalThis.fetch, espera = 3000, tentativas = 15 } = {}) {
  const t = String(tarefa || '');
  const sensivel = SENSIVEIS.includes(t);
  if (!sensivel && !NORMAIS.includes(t)) throw falha(400, 'Tarefa fora do cardápio.');
  const gh = github(env, fetchFn);
  const pedido = 'app-' + crypto.randomBytes(4).toString('hex');
  const desde = Date.now() - 60000;
  await gh.chamar('POST', `/actions/workflows/${FLUXO}/dispatches`, { ref: 'main', inputs: { tarefa: t, nome: '', pedido } });
  await db.collection('botAparelhos').doc(ap.id).set({ visto: iso(Date.now()) }, { merge: true });
  let run = null, aprovada = false;
  for (let i = 0; i < tentativas && !(run && (!sensivel || aprovada)); i++) {
    await dormir(espera);
    if (!run) {
      const r = await gh.chamar('GET', `/actions/workflows/${FLUXO}/runs?event=workflow_dispatch&per_page=10`);
      run = ((r && r.workflow_runs) || []).find((x) => String(x.display_title || '').includes(pedido) && Date.parse(x.created_at) >= desde) || null;
    }
    if (run && sensivel && !aprovada) {
      const pend = await gh.chamar('GET', `/actions/runs/${run.id}/pending_deployments`);
      const amb = (pend || []).find((p) => p && p.environment && p.environment.name === 'producao');
      if (amb) {
        await gh.chamar('POST', `/actions/runs/${run.id}/pending_deployments`, { environment_ids: [amb.environment.id], state: 'approved', comment: `Aprovado no app da ponte com a digital (${curto(ap.modelo, 40)}).` });
        aprovada = true;
      }
    }
  }
  return { pedido, tarefa: t, sensivel, aprovada: sensivel ? aprovada : null, link: run ? run.html_url : null, encontrado: !!run };
}

/** As últimas tarefas pedidas (de qualquer lugar), para a tela do app. */
async function ultimas(env = process.env, fetchFn = globalThis.fetch) {
  const gh = github(env, fetchFn);
  const r = await gh.chamar('GET', `/actions/workflows/${FLUXO}/runs?per_page=8`);
  return ((r && r.workflow_runs) || []).map((x) => ({
    titulo: curto(String(x.display_title || '').replace(/\s*app-[0-9a-f]{8}\s*$/, ''), 60),
    situacao: x.status === 'completed' ? (x.conclusion === 'success' ? 'ok' : 'falhou') : x.status === 'waiting' ? 'esperando aprovação' : 'rodando',
    em: x.created_at, link: x.html_url,
  }));
}

module.exports = { NORMAIS, SENSIVEIS, criarCodigo, entrar, aparelhoDoToken, listarAparelhos, removerAparelho, pedirTarefa, ultimas, lerToken, limparCodigo };
