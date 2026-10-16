'use strict';
// =====================================================================
//  lib/ponte.js — O APP PONTE: um celular Android perto da impressora térmica.
//
//  POR QUE EXISTE
//    O navegador só imprime com o painel aberto e a tela acesa. O app ponte
//    (pasta android/) roda como serviço no celular da banca, fala com a
//    impressora por Bluetooth e imprime mesmo com a tela bloqueada.
//
//  QUEM DECIDE O QUÊ
//    Servidor (aqui): escolhe o que imprimir (a MESMA regra do painel,
//      js/impressao-fila-lib.js), reserva na fila (lib/impressao.js, então
//      nada sai duas vezes, nem com o painel imprimindo junto) e monta os
//      bytes ESC/POS com o MESMO cupom do painel (js/impressao-lib.js).
//    App: só pergunta "tem papel para imprimir?", manda os bytes para a
//      impressora e diz se saiu. Nenhuma regra de negócio mora no celular.
//
//  CONVERSA (api/ponte.js), barata para a bateria:
//    O app chama "aguardar" e o servidor SEGURA a resposta até 45 s, até
//    aparecer trabalho. O servidor escuta o banco (onSnapshot) em vez de ler
//    de novo a cada chamada: parado, quase não gasta leitura do Firebase.
//    A confirmação do que saiu vai junto na chamada seguinte ("feitos").
//
//  SEGURANÇA
//    O painel gera um CÓDIGO de 8 letras (15 min, uma vez só). O app troca o
//    código por um TOKEN próprio ("pb1.<loja>.<id>.<segredo>"), que só serve
//    para buscar papel desta loja. O banco guarda só o hash do segredo.
//    Desligar o celular no painel apaga a ponte: o token morre na hora.
//    O que o painel manda imprimir fica cifrado no banco (lib/cofre.js) e é
//    apagado assim que sai no papel.
// =====================================================================
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const T = require('./tenant');
const Imp = require('./impressao');
const Cofre = require('./cofre');
const { textoCurto } = require('./http');

const ESPERA_MAX_S = 45;                         // o Cloudflare corta em 58 s (functions/api/[[caminho]].js)
const CODIGO_MS = 15 * 60 * 1000;
const MANUAL_MS = 30 * 60 * 1000;                // "imprimir" do painel que não saiu em 30 min é esquecido
const VISTO_GRAVAR_MS = 5 * 60 * 1000;           // "visto por último" no banco a cada 5 min (a memória tem o exato)
const SEM_CONTATO_MS = 12 * 60 * 1000;
const STATUS_ATIVOS = ['pendente', 'aguardando_pesagem', 'preparando'];
const MAX_POR_VEZ = 3;
const MAX_IGNORAR = 300;
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // sem 0/O, 1/I/L: não confunde ao digitar
const APK_URL = 'https://github.com/Bielroy/Site-banca1/releases/latest/download/banca-ponte.apk';
const NOME_ORIGINAL = 'Banca Adair e Pedrina';

const falha = (status, msg) => Object.assign(new Error(msg), { status });
const iso = (ms) => new Date(ms).toISOString();
const quando = (v) => Date.parse(v) || 0;

// ---------------------------------------------------------------- bibliotecas do painel (o mesmo cupom e a mesma regra)
let _libs = null;
function libs() {
  if (!_libs) {
    const de = (arq) => import(pathToFileURL(path.join(__dirname, '..', 'js', arq)).href);
    _libs = Promise.all([de('impressao-lib.js'), de('impressao-fila-lib.js')]).then(([L, F]) => ({ L, F }));
    _libs.catch(() => { _libs = null; });
  }
  return _libs;
}

// ---------------------------------------------------------------- token e código
const hashDe = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function novoToken(tid) {
  const id = 'pt' + crypto.randomBytes(8).toString('hex');
  const segredo = crypto.randomBytes(32).toString('base64url');
  return { id, token: `pb1.${tid}.${id}.${segredo}`, hash: hashDe(segredo) };
}
/** "pb1.<loja>.<id>.<segredo>" → { tid, id, segredo } ou null. */
function lerToken(t) {
  const m = /^pb1\.([a-z0-9][a-z0-9-]{1,39})\.(pt[0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/.exec(String(t || '').trim());
  return m ? { tid: m[1], id: m[2], segredo: m[3] } : null;
}
function segredoConfere(segredo, hash) {
  const a = Buffer.from(hashDe(segredo), 'hex'), b = Buffer.from(/^[0-9a-f]{64}$/.test(String(hash || '')) ? hash : '', 'hex');
  return b.length === 32 && crypto.timingSafeEqual(a, b);
}
function novoCodigo() { return [...crypto.randomBytes(8)].map((x) => ALFABETO[x % ALFABETO.length]).join(''); }
function limparCodigo(c) {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return new RegExp(`^[${ALFABETO}]{8}$`).test(s) ? s : null;
}
const idPonteOk = (id) => typeof id === 'string' && /^pt[0-9a-f]{16}$/.test(id);

// ---------------------------------------------------------------- configuração de cada celular
const MODOS = ['manual', 'chegada', 'aceite'];
const CFG_PADRAO = { auto: 'chegada', autoEtiqueta: false, autoPesado: false, autoCancelado: true, largura: 80, acentos: false, copias: 1 };
/** Configuração limpa. `base` = a que já estava (o que não veio continua igual). */
function limparCfg(c, base) {
  const x = c && typeof c === 'object' ? c : {}, b = { ...CFG_PADRAO, ...(base && typeof base === 'object' ? base : {}) };
  const bool = (k) => (typeof x[k] === 'boolean' ? x[k] : !!b[k]);
  const larg = (v) => ([58, 80].includes(Number(v)) ? Number(v) : null);
  return {
    auto: MODOS.includes(x.auto) ? x.auto : (MODOS.includes(b.auto) ? b.auto : CFG_PADRAO.auto),
    autoEtiqueta: bool('autoEtiqueta'), autoPesado: bool('autoPesado'), autoCancelado: bool('autoCancelado'),
    largura: larg(x.largura) || larg(b.largura) || 80,
    acentos: bool('acentos'),
    copias: Math.min(3, Math.max(1, parseInt(x.copias != null ? x.copias : b.copias, 10) || 1)),
  };
}
/** O que o app conta de si e da impressora (texto curto, nada de comando). */
function limparEstado(e) {
  const x = e && typeof e === 'object' ? e : {}, imp = x.impressora && typeof x.impressora === 'object' ? x.impressora : {}, app = x.app && typeof x.app === 'object' ? x.app : {};
  return {
    impressora: { estado: ['ok', 'erro', 'nenhuma', '?'].includes(imp.estado) ? imp.estado : '?', msg: textoCurto(imp.msg, 160), nome: textoCurto(imp.nome, 60) },
    app: { versao: textoCurto(app.versao, 20), android: textoCurto(app.android, 20), modelo: textoCurto(app.modelo, 60), bateria: textoCurto(app.bateria, 30) },
  };
}

// ---------------------------------------------------------------- o que o painel manda imprimir
const TIPOS_LINHA = ['txt', 'par', 'sep', 'esp', 'corte'];
const semControle = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);   // nada de comando ESC/POS escondido no texto
/** Folhas (listas de linhas de js/impressao-lib.js) conferidas, ou null. */
function limparFolhas(folhas) {
  if (!Array.isArray(folhas) || !folhas.length || folhas.length > 250) return null;
  let total = 0; const out = [];
  for (const f of folhas) {
    if (!Array.isArray(f) || !f.length || f.length > 400) return null;
    total += f.length; if (total > 6000) return null;
    const linhas = [];
    for (const l of f) {
      if (!l || typeof l !== 'object' || !TIPOS_LINHA.includes(l.t)) return null;
      const est = { ...(l.b ? { b: true } : {}), ...(l.g ? { g: true } : {}) };
      if (l.t === 'txt') linhas.push({ t: 'txt', v: semControle(l.v, 400), ...(['e', 'c', 'd'].includes(l.al) ? { al: l.al } : {}), ...est });
      else if (l.t === 'par') linhas.push({ t: 'par', e: semControle(l.e, 200), d: semControle(l.d, 60), ...est });
      else if (l.t === 'esp') linhas.push({ t: 'esp', n: Math.min(10, Math.max(1, parseInt(l.n, 10) || 1)) });
      else linhas.push({ t: l.t });
    }
    out.push(linhas);
  }
  return out;
}
const MAX_BYTES = 600 * 1024;                    // rótulo em imagem cabe; o documento do banco aceita até 1 MB
function limparBytes(b64) {
  const s = String(b64 || '');
  if (!s || s.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  return Buffer.from(s, 'base64').length ? s : null;
}

// ---------------------------------------------------------------- papel pronto (bytes ESC/POS)
async function nomeDaLoja(db, tid) {
  try { const f = await T.fichaDaLoja(db, tid); if (f && f.nome) return String(f.nome); } catch (_) { /* sem ficha: segue */ }
  return tid === T.TENANT_PADRAO ? NOME_ORIGINAL : '';
}
async function paraBytes(folhas, cfg) {
  const { L } = await libs();
  return Buffer.concat(folhas.map((f) => Buffer.from(L.paraEscPos(f, { largura: cfg.largura, acentos: cfg.acentos }))));
}
/** As folhas de um pedido: o mesmo que o painel imprimiria (js/impressao-auto.js, folhasDe). */
async function folhasDoPedido(p, versao, cfg, loja) {
  const { L } = await libs();
  if (versao === 'cancelado') return [L.avisoDeCancelamento(p, { loja })];
  const cupom = L.cupomDoPedido(p, { loja, aviso: versao === 'pesado' ? 'CUPOM ATUALIZADO (depois da balança)' : '' });
  const folhas = Array.from({ length: cfg.copias || 1 }, () => cupom);
  if (cfg.autoEtiqueta && !(p.impressao && p.impressao.saiu)) folhas.push(L.etiquetaDeEntrega(p, { loja }));
  return folhas;
}

// ---------------------------------------------------------------- o banco, escutado (uma escuta por loja, só enquanto há ponte chamando)
const lerMapa = (snap) => new Map(snap.docs.map((s) => [s.id, { ...s.data(), id: s.id }]));
class Fonte {
  constructor(db, tid) {
    this.db = db; this.tid = tid; this.d = { pedidos: new Map(), cancelados: new Map(), manuais: new Map(), pontes: new Map() };
    this.prontos = new Set(); this.esperando = new Set(); this.desligar = []; this.usadoEm = Date.now(); this.modo = null; this.quebrouEm = 0; this.renovar = null;
  }
  consultas() {
    const col = (n) => T.tcol(this.db, this.tid, n);
    return {
      pedidos: col('pedidos').where('status', 'in', STATUS_ATIVOS),                                             // sem orderBy: não precisa de índice composto
      cancelados: col('pedidos').where('canceladoEm', '>=', iso(Date.now() - 26 * 3600 * 1000)),
      manuais: col('impressoes'),
      pontes: col('pontes'),
    };
  }
  iniciar() {
    if (this.modo) return;
    const q = this.consultas();
    // sem escuta (testes, Vercel) ou escuta que caiu há pouco: lê a cada vez
    if (typeof q.pontes.onSnapshot !== 'function' || Date.now() - this.quebrouEm < 5 * 60 * 1000) { this.modo = 'leitura'; return; }
    this.modo = 'vivo';
    for (const [nome, consulta] of Object.entries(q)) {
      this.desligar.push(consulta.onSnapshot((snap) => { this.d[nome] = lerMapa(snap); this.prontos.add(nome); this.acordar(); },
        (e) => { console.error('[ponte] a escuta do banco caiu:', nome, e && e.message); this.quebrouEm = Date.now(); this.parar(); this.acordar(); }));
    }
    // a janela dos cancelados anda: renova as escutas de tempos em tempos
    this.renovar = setTimeout(() => { this.parar(); this.acordar(); }, 6 * 3600 * 1000);
    if (this.renovar.unref) this.renovar.unref();
  }
  parar() {
    for (const f of this.desligar) { try { f(); } catch (_) { /* já desligada */ } }
    this.desligar = []; this.prontos.clear(); this.modo = null; clearTimeout(this.renovar);
  }
  acordar() { const fs = [...this.esperando]; this.esperando.clear(); fs.forEach((f) => f()); }
  esperar(ms) {
    return new Promise((resolve) => {
      let t = null; const f = () => { clearTimeout(t); this.esperando.delete(f); resolve(); };
      t = setTimeout(f, Math.max(0, ms)); this.esperando.add(f);
    });
  }
  async lerTudo() {
    const out = {};
    for (const [nome, consulta] of Object.entries(this.consultas())) out[nome] = lerMapa(await consulta.get());
    return out;
  }
  /** Os dados de agora. Na escuta, espera a primeira leva chegar (até 10 s); se não chegar, lê direto. */
  async dados() {
    this.usadoEm = Date.now();
    this.iniciar();
    if (this.modo !== 'vivo') return this.lerTudo();
    const ate = Date.now() + 10000;
    while (this.modo === 'vivo' && this.prontos.size < 4 && Date.now() < ate) await this.esperar(ate - Date.now());
    return this.modo === 'vivo' && this.prontos.size >= 4 ? this.d : this.lerTudo();
  }
  /** Quanto esperar antes de olhar de novo: na escuta, até algo mudar; lendo, a cada 10 s. */
  pausa(restante) { return this.modo === 'vivo' ? restante : Math.min(restante, 10000); }
}
const fontes = new Map();
function fonteDa(db, tid) {
  let f = fontes.get(tid);
  if (!f || f.db !== db) { if (f) f.parar(); f = new Fonte(db, tid); fontes.set(tid, f); }
  return f;
}
// Uma faxina só por processo (os testes carregam este arquivo várias vezes):
//  - loja sem ponte chamando há 15 min: desliga a escuta (não gasta nada);
//  - servidor desligando (atualização): responde quem está esperando, para o app reconectar no novo.
const TODAS = globalThis.__ponteFontes || (globalThis.__ponteFontes = new Set());
TODAS.add(fontes);
if (!globalThis.__ponteFaxina) {
  globalThis.__ponteFaxina = setInterval(() => {
    for (const mapa of TODAS) for (const [tid, f] of mapa) if (Date.now() - f.usadoEm > 15 * 60 * 1000) { f.parar(); mapa.delete(tid); }
  }, 60 * 1000);
  if (globalThis.__ponteFaxina.unref) globalThis.__ponteFaxina.unref();
  process.once('SIGTERM', () => { for (const mapa of TODAS) for (const f of mapa.values()) { f.parar(); f.acordar(); } });
}

// ---------------------------------------------------------------- o que imprimir
function manualDisponivel(j, pid, agora) {
  if (agora - quando(j.criadoEm) > MANUAL_MS) return false;
  return j.estado !== 'reservado' || j.ponte === pid || agora - quando(j.em) > Imp.RESERVA_MS;
}
/** Pedidos que este celular imprime sozinho agora (chaves "id:versao" da regra do painel). */
async function candidatos(pedidos, cfg, pid, ignorar, agora) {
  const { F } = await libs();
  return F.trabalhosDe(pedidos, { ...cfg, aparelho: pid }, { ignorados: new Set(ignorar || []), agora });
}
/** Fila deste celular: primeiro o que alguém mandou imprimir no painel, depois os pedidos (o mais antigo primeiro). */
async function trabalhosPara(d, ponte, agora) {
  const manuais = [...d.manuais.values()].filter((j) => manualDisponivel(j, ponte.id, agora))
    .sort((a, b) => quando(a.criadoEm) - quando(b.criadoEm)).map((j) => ({ chave: `m:${j.id}`, tipo: 'manual', id: j.id }));
  const pedidos = [...new Map([...d.pedidos, ...d.cancelados]).values()];
  const autos = (await candidatos(pedidos, limparCfg(ponte.cfg), ponte.id, ponte.ignorar, agora))
    .map((t) => ({ chave: `p:${t.id}:${t.versao}`, tipo: 'pedido', id: t.id, versao: t.versao }));
  return [...manuais, ...autos];
}
const vencidos = (d, agora) => [...d.manuais.values()].filter((j) => agora - quando(j.criadoEm) > MANUAL_MS).map((j) => j.id);

/** Reserva na fila e monta o papel. Devolve { chave, titulo, bytes } ou null (outro pegou, mudou, sumiu). */
async function reservarEMontar(db, tid, t, ponte, loja, agora) {
  const cfg = limparCfg(ponte.cfg);
  if (t.tipo === 'manual') {
    const ref = T.tdoc(db, tid, 'impressoes', t.id);
    const j = await db.runTransaction(async (tr) => {
      const s = await tr.get(ref); if (!s.exists) return null;
      const x = { ...s.data(), id: t.id };
      if (!manualDisponivel(x, ponte.id, agora)) return null;
      tr.update(ref, { estado: 'reservado', ponte: ponte.id, em: iso(agora) });
      return x;
    });
    if (!j) return null;
    let bytes;
    if (j.tipo === 'bytes') bytes = Buffer.from(String(j.bytes || ''), 'base64');
    else {
      const folhas = limparFolhas(Cofre.abrirJSON(j.folhas, tid, 'impressao', null));
      if (!folhas) { await ref.delete().catch(() => {}); return null; }          // não abriu (chave do cofre trocada): não fica preso na fila
      const n = Math.min(20, Math.max(1, parseInt(j.copias, 10) || (j.tipo === 'cupom' ? cfg.copias : 1)));
      bytes = await paraBytes(Array.from({ length: n }, () => folhas).flat(), cfg);
    }
    if (!bytes.length) { await ref.delete().catch(() => {}); return null; }
    return { chave: t.chave, titulo: 'Impressão pedida no painel', bytes: bytes.toString('base64') };
  }
  const ref = T.tdoc(db, tid, 'pedidos', t.id);
  const p = await db.runTransaction(async (tr) => {
    const s = await tr.get(ref); if (!s.exists) return null;
    const x = s.data();
    if (x.origem === 'balcao' || x.resumoDoDia) return null;
    if ((t.versao === 'cancelado') !== (x.status === 'cancelado')) return null;
    const r = Imp.decidirReserva(x.impressao, t.versao, ponte.id, agora);
    if (!r.ok) return null;
    tr.update(ref, { impressao: r.novo });
    return { ...x, id: t.id };                       // como estava antes da reserva (a etiqueta só sai no primeiro papel)
  });
  if (!p) return null;
  const { L } = await libs();
  const aberto = Cofre.abrirCampos(p, tid);
  const bytes = await paraBytes(await folhasDoPedido(aberto, t.versao, cfg, loja), cfg);
  return { chave: t.chave, titulo: t.versao === 'cancelado' ? `Aviso: pedido ${L.numeroDoPedido(p)} cancelado` : `Pedido ${L.numeroDoPedido(p)}`, bytes: bytes.toString('base64') };
}

/** O que saiu (ok) ou não saiu no papel, contado pelo app na chamada seguinte. */
async function aplicarFeitos(db, tid, ponte, feitos, agora) {
  const lista = Array.isArray(feitos) ? feitos.slice(0, 30) : [];
  const cfg = limparCfg(ponte.cfg);
  for (const f of lista) {
    if (!f || typeof f !== 'object') continue;
    const ok = f.ok === true, chave = String(f.chave || '');
    try {
      let m = /^p:([\w-]{6,80}):(inicial|pesado|cancelado)$/.exec(chave);
      if (m) {
        const ref = T.tdoc(db, tid, 'pedidos', m[1]), versao = m[2];
        await db.runTransaction(async (tr) => {
          const s = await tr.get(ref); if (!s.exists) return;
          const a = s.data().impressao || {};
          if (!ok) { const solto = Imp.liberar(a, ponte.id, agora); if (solto) tr.update(ref, { impressao: solto }); return; }
          // confirmação repetida (a resposta anterior se perdeu): não conta duas vezes
          if (a.estado === 'impresso' && a.aparelho === ponte.id && a.versao === versao && agora - quando(a.saiuEm) < 10 * 60 * 1000) return;
          tr.update(ref, { impressao: Imp.confirmar(a, versao, ponte.id, agora) });
        });
        continue;
      }
      m = /^m:([\w-]{6,80})$/.exec(chave);
      if (!m) continue;
      const ref = T.tdoc(db, tid, 'impressoes', m[1]);
      const pedidoId = await db.runTransaction(async (tr) => {
        const s = await tr.get(ref); if (!s.exists) return null;
        const j = s.data();
        if (ok) { tr.delete(ref); return j.tipo === 'cupom' && j.pedidoId ? j.pedidoId : null; }    // saiu: some do banco (tinha dados do cliente)
        if (j.ponte === ponte.id) tr.update(ref, { estado: 'falhou', em: iso(agora), tentativas: (Number(j.tentativas) || 0) + 1 });
        return null;
      });
      // cupom de pedido mandado pelo painel: conta como impresso, para o automático não repetir
      if (pedidoId && /^[\w-]{6,80}$/.test(pedidoId)) {
        const { F } = await libs(), pref = T.tdoc(db, tid, 'pedidos', pedidoId);
        await db.runTransaction(async (tr) => {
          const s = await tr.get(pref); if (!s.exists) return;
          const p = s.data(); if (p.status === 'cancelado' || p.origem === 'balcao') return;
          tr.update(pref, { impressao: Imp.confirmar(p.impressao, F.versaoDesejada(p, cfg), ponte.id, agora) });
        });
      }
    } catch (e) { console.error('[ponte] não consegui registrar um papel:', e && e.message); }
  }
}

// ---------------------------------------------------------------- "visto por último" e estado da impressora
const vistos = new Map();       // "loja/ponte" → { gravadoEm, ultimo, assin }
async function registrarContato(db, tid, ponte, estado, agora) {
  const est = limparEstado(estado), assin = JSON.stringify(est), k = `${tid}/${ponte.id}`;
  const v = vistos.get(k) || { gravadoEm: 0, assin: '' };
  v.ultimo = agora; vistos.set(k, v);
  if (agora - v.gravadoEm < VISTO_GRAVAR_MS && v.assin === assin) return;
  v.gravadoEm = agora; v.assin = assin;
  // update (e não set): se a ponte foi apagada no painel, não volta à vida
  await T.tdoc(db, tid, 'pontes', ponte.id).update({ visto: iso(agora), ...est }).catch(() => {});
}
function vistoDe(tid, id, doc) { const v = vistos.get(`${tid}/${id}`); return Math.max(quando(doc && doc.visto), (v && v.ultimo) || 0); }

// ---------------------------------------------------------------- ignorar o que já estava na fila (não gasta papel de uma vez ao ligar)
async function pedidosParaRegra(db, tid) {
  const col = T.tcol(db, tid, 'pedidos');
  const [a, c] = await Promise.all([col.where('status', 'in', STATUS_ATIVOS).get(), col.where('canceladoEm', '>=', iso(Date.now() - 26 * 3600 * 1000)).get()]);
  return [...new Map([...lerMapa(a), ...lerMapa(c)]).values()];
}
/** Lista nova de "ignorar": o que já está na fila e sairia agora com `novo` mas não sairia com `antes`. */
async function ignorarNovos(db, tid, pid, antes, novo, ignorarAntes, agora = Date.now()) {
  const pedidos = await pedidosParaRegra(db, tid), vivos = new Set(pedidos.map((p) => p.id));
  const tinha = new Set(antes ? (await candidatos(pedidos, antes, pid, [], agora)).map((t) => t.chave) : []);
  const novos = (await candidatos(pedidos, novo, pid, [], agora)).map((t) => t.chave).filter((k) => !tinha.has(k));
  const mantidos = (ignorarAntes || []).filter((k) => vivos.has(String(k).split(':')[0]));        // pedido que saiu da fila não precisa mais ficar na lista
  const ignorar = [...new Set([...mantidos, ...novos])].slice(-MAX_IGNORAR);
  return { ignorar, pulados: novos.filter((k) => !(ignorarAntes || []).includes(k)).length };
}

// ---------------------------------------------------------------- o que o painel faz (api/pdv.js, acao 'ponte')
async function criarCodigo(db, tid, { por, cfg } = {}) {
  for (let i = 0; i < 5; i++) {
    const codigo = novoCodigo(), ref = db.collection('ponteCodigos').doc(codigo), agora = Date.now();
    const criado = await db.runTransaction(async (tr) => {
      const s = await tr.get(ref);
      if (s.exists && quando(s.data().expira) > agora) return false;
      tr.set(ref, { tid, por: textoCurto(por, 120), criadoEm: iso(agora), expira: iso(agora + CODIGO_MS), cfg: limparCfg(cfg) });
      return true;
    });
    if (criado) return { codigo, expira: iso(agora + CODIGO_MS), minutos: CODIGO_MS / 60000 };
  }
  throw falha(500, 'Não consegui gerar o código agora. Tente de novo.');
}
async function listar(db, tid, agora = Date.now()) {
  const s = await T.tcol(db, tid, 'pontes').get();
  return s.docs.map((d) => {
    const x = d.data(), visto = vistoDe(tid, d.id, x);
    return { id: d.id, nome: textoCurto(x.nome, 60) || 'Celular da banca', criadoEm: x.criadoEm || '', visto: visto ? iso(visto) : '', online: !!visto && agora - visto < SEM_CONTATO_MS,
      impressora: limparEstado(x).impressora, app: limparEstado(x).app, cfg: limparCfg(x.cfg) };
  }).sort((a, b) => quando(a.criadoEm) - quando(b.criadoEm));
}
async function salvarConfig(db, tid, ponteId, cfg, { imprimirFila = false } = {}) {
  if (!idPonteOk(ponteId)) throw falha(400, 'Celular inválido.');
  const ref = T.tdoc(db, tid, 'pontes', ponteId), s = await ref.get();
  if (!s.exists) throw falha(404, 'Este celular não está mais ligado. Atualize a tela.');
  const x = s.data(), antes = limparCfg(x.cfg), novo = limparCfg(cfg, antes);
  let ignorar = Array.isArray(x.ignorar) ? x.ignorar : [], pulados = 0;
  if (imprimirFila) ignorar = [];
  else { const r = await ignorarNovos(db, tid, ponteId, antes, novo, ignorar); ignorar = r.ignorar; pulados = r.pulados; }
  await ref.update({ cfg: novo, ignorar });
  fontes.get(tid)?.acordar();
  return { cfg: novo, pulados };
}
async function remover(db, tid, ponteId) {
  if (!idPonteOk(ponteId)) throw falha(400, 'Celular inválido.');
  await T.tdoc(db, tid, 'pontes', ponteId).delete();
  vistos.delete(`${tid}/${ponteId}`);
  fontes.get(tid)?.acordar();
}
/** "Imprimir" no painel com o caminho "App da banca": entra na fila do celular da banca. */
async function novoTrabalho(db, tid, b, por, agora = Date.now()) {
  const pontes = await T.tcol(db, tid, 'pontes').get();
  if (pontes.empty) throw falha(409, 'Nenhum celular da banca está ligado. Toque em "Impressora" para ligar um.');
  const j = { criadoEm: iso(agora), por: textoCurto(por, 120), estado: 'pendente' };
  if (b.bytes != null) {
    const bytes = limparBytes(b.bytes); if (!bytes) throw falha(400, 'Impressão grande demais ou inválida.');
    Object.assign(j, { tipo: 'bytes', bytes });
  } else {
    const folhas = limparFolhas(b.folhas); if (!folhas) throw falha(400, 'Nada para imprimir.');
    Object.assign(j, { tipo: b.tipo === 'cupom' ? 'cupom' : 'folhas', folhas: Cofre.fecharJSON(folhas, tid, 'impressao') });
    if (b.copias != null) j.copias = Math.min(20, Math.max(1, parseInt(b.copias, 10) || 1));
    if (typeof b.pedidoId === 'string' && /^[\w-]{6,80}$/.test(b.pedidoId)) j.pedidoId = b.pedidoId;
  }
  const id = 'im' + crypto.randomBytes(9).toString('hex');
  await T.tdoc(db, tid, 'impressoes', id).set(j);
  fontes.get(tid)?.acordar();
  const visto = Math.max(0, ...pontes.docs.map((d) => vistoDe(tid, d.id, d.data())));
  return { id, online: !!visto && agora - visto < SEM_CONTATO_MS, visto: visto ? iso(visto) : '' };
}

// ---------------------------------------------------------------- o que o app faz (api/ponte.js)
/** Troca o código do painel pelo token deste celular. */
async function entrar(db, b) {
  const codigo = limparCodigo(b && b.codigo);
  if (!codigo) throw falha(400, 'Código inválido. Confira as 8 letras e números que aparecem no painel.');
  const ref = db.collection('ponteCodigos').doc(codigo), agora = Date.now();
  const est = limparEstado({ app: b && b.app });
  const r = await db.runTransaction(async (tr) => {
    const s = await tr.get(ref);
    if (!s.exists) throw falha(404, 'Código não encontrado ou já usado. Gere um novo no painel.');
    const k = s.data();
    tr.delete(ref);                                                       // vale uma vez só
    if (quando(k.expira) < agora) throw falha(410, 'Este código venceu. Gere um novo no painel.');
    if (!T.idValido(k.tid)) throw falha(400, 'Código inválido.');
    const tk = novoToken(k.tid), cfg = limparCfg(k.cfg);
    tr.set(T.tdoc(db, k.tid, 'pontes', tk.id), { hash: tk.hash, criadoEm: iso(agora), criadoPor: textoCurto(k.por, 120), nome: est.app.modelo || 'Celular da banca', cfg, ignorar: [], visto: iso(agora), ...est });
    return { tid: k.tid, ...tk, cfg };
  });
  // o que já estava na fila não sai de uma vez ao ligar (se quiser, o painel manda imprimir)
  try { const ig = await ignorarNovos(db, r.tid, r.id, null, r.cfg, []); if (ig.ignorar.length) await T.tdoc(db, r.tid, 'pontes', r.id).update({ ignorar: ig.ignorar }); }
  catch (e) { console.error('[ponte] não consegui olhar a fila ao ligar:', e && e.message); }
  return { token: r.token, ponteId: r.id, loja: await nomeDaLoja(db, r.tid), cfg: r.cfg };
}
/** A ponte dona deste token, ou null (token errado, ou celular desligado no painel). */
async function ponteDoToken(db, tk) {
  const f = fontes.get(tk.tid);
  let x = f && f.db === db && f.modo === 'vivo' && f.prontos.has('pontes') ? f.d.pontes.get(tk.id) : undefined;
  if (x === undefined) { const s = await T.tdoc(db, tk.tid, 'pontes', tk.id).get(); x = s.exists ? { ...s.data(), id: tk.id } : null; }
  return x && segredoConfere(tk.segredo, x.hash) ? { ...x, id: tk.id } : null;
}
const cfgParaApp = (c) => { const x = limparCfg(c); return { auto: x.auto, largura: x.largura, acentos: x.acentos }; };

/**
 * "aguardar": registra o que saiu, conta que está vivo e devolve papel para imprimir.
 * Sem papel, segura a resposta até `espera` segundos (o app fica parado, sem gastar bateria).
 * pausa=true: o app está esperando a impressora voltar; só segura, não entrega papel.
 */
async function aguardar(db, tid, ponte, b, { fechou = () => false, aoFechar } = {}) {
  const espera = Math.min(ESPERA_MAX_S, Math.max(0, Number(b.espera) || 0)) * 1000, inicio = Date.now(), fim = inicio + espera;
  await aplicarFeitos(db, tid, ponte, b.feitos, inicio);
  await registrarContato(db, tid, ponte, { impressora: b.impressora, app: b.app }, inicio);
  const fonte = fonteDa(db, tid), loja = await nomeDaLoja(db, tid);
  if (aoFechar) aoFechar(() => fonte.acordar());
  for (;;) {
    const agora = Date.now(), d = await fonte.dados();
    let atual = d.pontes.get(ponte.id);
    if (!atual) {
      // a escuta pode ainda não ter visto um celular que acabou de ser ligado: confere no banco antes de dizer "desligado"
      const s = await T.tdoc(db, tid, 'pontes', ponte.id).get();
      if (!s.exists) throw falha(401, 'Este celular foi desligado no painel.');
      atual = { ...s.data(), id: ponte.id };
    }
    const velhos = vencidos(d, agora);
    if (velhos.length) { const lote = db.batch(); velhos.slice(0, 50).forEach((id) => lote.delete(T.tdoc(db, tid, 'impressoes', id))); lote.commit().catch(() => {}); }
    if (b.pausa !== true) {
      const saida = [];
      for (const t of await trabalhosPara(d, atual, agora)) {
        if (saida.length >= MAX_POR_VEZ) break;
        const pronto = await reservarEMontar(db, tid, t, atual, loja, agora);
        if (pronto) saida.push(pronto);
      }
      if (saida.length) return { trabalhos: saida, cfg: cfgParaApp(atual.cfg), loja };
    }
    const restante = fim - Date.now();
    if (restante <= 0 || fechou()) return { trabalhos: [], cfg: cfgParaApp(atual.cfg), loja };
    await fonte.esperar(fonte.pausa(restante));
  }
}

module.exports = {
  ESPERA_MAX_S, CODIGO_MS, MANUAL_MS, SEM_CONTATO_MS, STATUS_ATIVOS, APK_URL, CFG_PADRAO,
  novoToken, lerToken, segredoConfere, novoCodigo, limparCodigo, idPonteOk, limparCfg, limparEstado, limparFolhas, limparBytes,
  folhasDoPedido, paraBytes, trabalhosPara, reservarEMontar, aplicarFeitos, ignorarNovos,
  criarCodigo, listar, salvarConfig, remover, novoTrabalho, entrar, ponteDoToken, aguardar, fonteDa,
  _fontes: fontes, _vistos: vistos,
};
