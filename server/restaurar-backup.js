'use strict';
// =====================================================================
//  server/restaurar-backup.js — VOLTA UMA CÓPIA DIÁRIA (banco-AAAA-MM-DD.json.gz) PARA UM BANCO DE TESTE.
//
//  Quem chama é scripts/restaurar-backup.sh (ele escolhe se roda aqui ou dentro da imagem do servidor).
//  Serve para o ENSAIO de restauração (uma vez por trimestre, PUBLICAR.md) e para o dia ruim.
//
//  NUNCA NA PRODUÇÃO POR PADRÃO:
//   - as chaves do Firebase da produção (FIREBASE_* do ~/segredos.env) NUNCA são usadas aqui: o destino é o
//     emulador (--emulador) ou um projeto dado com --projeto + --credenciais (arquivo da conta de serviço DELE);
//   - se o projeto for o da produção (banca-adair-e-pedrina, ou o FIREBASE_PROJECT_ID/PRODUCAO_PROJECT_ID do ambiente),
//     recusa, a não ser com --producao E digitando o nome do projeto na hora (nunca sem perguntar);
//   - fora do emulador sempre pergunta antes de gravar (digite RESTAURAR).
//  O que faz: regrava por cima, documento por documento, o que está na cópia (cadastro, configurações, equipe,
//  clientes, pedidos dos últimos 31 dias, ficha da loja e feiras). Não apaga nada que não esteja na cópia.
//  Os campos cifrados (nome, telefone, endereço) continuam cifrados: para lê-los, o servidor de teste precisa
//  da MESMA DADOS_CHAVE (guardada no cofre de senhas).
// =====================================================================
const fs = require('fs');
const zlib = require('zlib');
const T = require('../lib/tenant');

const PRODUCAO_CONHECIDA = ['banca-adair-e-pedrina'];
const NOME_COLECAO = /^[a-z_]{2,40}$/;

const lerJson = (caminho) => { let b = fs.readFileSync(caminho); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); return JSON.parse(b.toString('utf8')); };

/**
 * Lê a cópia e devolve sempre { versao: 1, feitaEm, lojas: { id: copia }, feiras, lgpd }.
 * Aceita: o arquivo antigo (tudo num JSON, versao 1), um arquivo de UMA loja (versao 2), ou a PASTA do dia
 * (~/backups/AAAA-MM-DD/, um <loja>.json.gz por loja + _plataforma.json.gz), como o backup-diario.sh grava hoje.
 */
function lerArquivo(caminho) {
  const junta = { versao: 1, feitaEm: '', lojas: {}, feiras: {}, lgpd: {} };
  const somar = (d, nome) => {
    if (d && d.versao === 1 && d.lojas && typeof d.lojas === 'object') { Object.assign(junta.lojas, d.lojas); Object.assign(junta.feiras, d.feiras || {}); Object.assign(junta.lgpd, d.lgpd || {}); junta.feitaEm = junta.feitaEm || d.feitaEm; return; }
    if (d && d.versao === 2 && d.tipo === 'loja' && d.loja && d.copia && d.copia.colecoes) { junta.lojas[d.loja] = d.copia; junta.feitaEm = junta.feitaEm || d.feitaEm; return; }
    if (d && d.versao === 2 && d.tipo === 'plataforma') { Object.assign(junta.feiras, d.feiras || {}); Object.assign(junta.lgpd, d.lgpd || {}); return; }
    throw new Error(`${nome} não é uma cópia do backup diário.`);
  };
  if (fs.statSync(caminho).isDirectory()) {
    const arqs = fs.readdirSync(caminho).filter((f) => /^[a-z0-9_][a-z0-9_-]*\.json(\.gz)?$/.test(f)).sort();
    if (!arqs.length) throw new Error(`A pasta ${caminho} não tem arquivos de cópia (<loja>.json.gz).`);
    for (const f of arqs) somar(lerJson(require('path').join(caminho, f)), f);
  } else somar(lerJson(caminho), caminho);
  return junta;
}

/**
 * A chave do cofre abre os dados desta cópia? Procura um campo cifrado ("c1:...") e tenta abrir com a DADOS_CHAVE
 * do ambiente. Devolve { ok: true|false, loja, onde } ou { semCifrado: true } (cópia sem nada cifrado: não dá para provar).
 */
function conferirChave(dados) {
  const Cofre = require('../lib/cofre');
  for (const [tid, copia] of Object.entries(dados.lojas || {})) {
    for (const nome of ['pedidos', 'contas']) {
      for (const [id, doc] of Object.entries((copia.colecoes || {})[nome] || {})) {
        for (const campo of Cofre.CAMPOS) {
          if (!Cofre.cifrado(doc && doc[campo])) continue;
          const aberto = Cofre.abrir(doc[campo], tid, campo);
          return { ok: aberto !== Cofre.PROTEGIDO, loja: tid, onde: `${nome}/${id}.${campo}` };
        }
      }
    }
  }
  return { semCifrado: true };
}

/** Datas do Firestore viram {_seconds, _nanoseconds} no JSON: aqui voltam a ser datas do Firestore. */
function reviver(valor, Timestamp) {
  if (!Timestamp || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map((v) => reviver(v, Timestamp));
  const ks = Object.keys(valor);
  if (ks.length === 2 && Number.isInteger(valor._seconds) && Number.isInteger(valor._nanoseconds)) return new Timestamp(valor._seconds, valor._nanoseconds);
  if (ks.length === 3 && Number.isInteger(valor.seconds) && Number.isInteger(valor.nanoseconds) && /^firestore\/timestamp\//.test(String(valor.type))) return new Timestamp(valor.seconds, valor.nanoseconds);
  return Object.fromEntries(ks.map((k) => [k, reviver(valor[k], Timestamp)]));
}

/** É o projeto da produção? */
const ehProducao = (projeto, env = process.env) => !!projeto && [...PRODUCAO_CONHECIDA, env.FIREBASE_PROJECT_ID, env.PRODUCAO_PROJECT_ID].filter(Boolean).includes(projeto);

/**
 * Grava a cópia no banco `db`. lojas: lista de ids (null = todas, e as feiras junto). simular: só conta.
 * Devolve { lojas: { id: { colecao: n } }, feiras: n, documentos: n }.
 */
async function restaurarDados(db, dados, { lojas = null, simular = false, Timestamp = null } = {}) {
  const escritas = [], resumo = { lojas: {}, feiras: 0, documentos: 0 };
  const ref = (fazer) => (simular ? null : fazer());                       // simulando, nem precisa de banco
  for (const [tid, copia] of Object.entries(dados.lojas)) {
    if (lojas && !lojas.includes(tid)) continue;
    if (!(tid === T.TENANT_PADRAO || T.idValido(tid)) || !copia || !copia.colecoes) continue;
    resumo.lojas[tid] = {};
    for (const [nome, docs] of Object.entries(copia.colecoes)) {
      if (!NOME_COLECAO.test(nome) || !docs || typeof docs !== 'object') continue;
      resumo.lojas[tid][nome] = 0;
      for (const [id, doc] of Object.entries(docs)) {
        if (!id || id.includes('/') || !doc || typeof doc !== 'object') continue;
        escritas.push([ref(() => T.tdoc(db, tid, nome, id)), doc]); resumo.lojas[tid][nome]++;
      }
    }
    if (copia.ficha && tid !== T.TENANT_PADRAO) { escritas.push([ref(() => db.collection('tenants').doc(tid)), copia.ficha]); resumo.lojas[tid].ficha = 1; }
  }
  if (!lojas) for (const [id, doc] of Object.entries(dados.feiras || {})) if (id && !id.includes('/') && doc && typeof doc === 'object') { escritas.push([ref(() => db.collection('feiras').doc(id)), doc]); resumo.feiras++; }
  // marcas de quem pediu para apagar (LGPD): voltam junto, para reaplicar() achar essas pessoas depois
  const marcas = Object.entries(dados.lgpd || {}).filter(([k, v]) => /^[0-9a-f]{40}$/.test(k) && v && typeof v === 'object');
  if (marcas.length) { escritas.push([ref(() => db.doc('plataforma/lgpd_apagados')), Object.fromEntries(marcas), true]); resumo.marcasLgpd = marcas.length; }
  resumo.documentos = escritas.length;
  if (simular) return resumo;
  for (let i = 0; i < escritas.length; i += 400) {
    const lote = db.batch();
    escritas.slice(i, i + 400).forEach(([r, doc, juntar]) => (juntar ? lote.set(r, doc, { merge: true }) : lote.set(r, reviver(doc, Timestamp))));
    await lote.commit();
  }
  // quem já pediu para apagar some de novo (lib/apagar-cliente.js → reaplicar; precisa da DADOS_CHAVE)
  const L = require('../lib/apagar-cliente');
  const re = await L.reaplicar(db, Object.keys(resumo.lojas));
  resumo.lgpd = { marcas: re.marcas, semChave: !!re.semChave, reaplicado: Object.fromEntries(Object.entries(re.lojas).map(([tid, r]) => [tid, r.pedidos.length])) };
  return resumo;
}

/** Lê os argumentos. Erro com mensagem clara quando falta ou sobra algo. */
function lerOpcoes(argv, env = process.env) {
  const o = { arquivo: '', emulador: false, projeto: '', credenciais: '', lojas: null, simular: false, sim: false, producao: false, conferirChave: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], prox = () => { const v = argv[++i]; if (!v || v.startsWith('--')) throw new Error(`${a} precisa de um valor.`); return v; };
    if (a === '--emulador') o.emulador = true;
    else if (a === '--projeto') o.projeto = prox();
    else if (a === '--credenciais') o.credenciais = prox();
    else if (a === '--loja') o.lojas = prox().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--simular') o.simular = true;
    else if (a === '--sim') o.sim = true;
    else if (a === '--producao') o.producao = true;
    else if (a === '--conferir-chave') o.conferirChave = true;
    else if (a.startsWith('--')) throw new Error(`Opção desconhecida: ${a}`);
    else if (!o.arquivo) o.arquivo = a;
    else throw new Error(`Sobrou: ${a}`);
  }
  if (!o.arquivo) throw new Error('Diga qual cópia restaurar (a pasta ~/backups/AAAA-MM-DD ou um arquivo .json.gz).');
  if (o.conferirChave) return o;                                     // só abre um campo com a chave: não grava em lugar nenhum
  if (o.emulador) {
    if (!env.FIRESTORE_EMULATOR_HOST) throw new Error('--emulador precisa do emulador ligado (FIRESTORE_EMULATOR_HOST). Ex.: firebase emulators:exec --only firestore "bash scripts/restaurar-backup.sh ..."');
    o.projeto = o.projeto || 'demo-restauro';
    if (o.credenciais) throw new Error('No emulador não se usa --credenciais.');
  } else {
    if (env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST está ligado: use --emulador (ou desligue a variável para gravar num projeto de verdade).');
    if (!o.simular && (!o.projeto || !o.credenciais)) throw new Error('Diga o destino: --emulador, ou --projeto <id-do-projeto-de-TESTE> --credenciais <arquivo-da-conta-de-servico.json>. (Ou --simular, só para contar.)');
    if (o.sim) throw new Error('--sim (sem perguntar) só vale no emulador.');
  }
  if (ehProducao(o.projeto, env) && !o.producao) throw new Error(`"${o.projeto}" é o projeto da PRODUÇÃO. Restaurar ali regrava os dados da loja que está no ar. Se é isso mesmo (dia ruim, com a cópia certa), repita com --producao.`);
  return o;
}

const perguntar = (texto) => new Promise((ok) => { const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout }); rl.question(texto, (r) => { rl.close(); ok(String(r || '').trim()); }); });

async function principal(argv) {
  const o = lerOpcoes(argv);
  const dados = lerArquivo(o.arquivo);
  if (o.conferirChave) {
    if (!require('../lib/cofre').ligado()) { console.log('Informe a chave: bash scripts/restaurar-backup.sh <cópia> --conferir-chave (o script pede para colar a DADOS_CHAVE).'); return 2; }
    const c = conferirChave(dados);
    if (c.semCifrado) { console.log('Esta cópia não tem nenhum campo cifrado: não dá para provar a chave com ela.'); return 1; }
    console.log(c.ok ? `Chave OK: abriu ${c.onde} da loja ${c.loja}.` : `Chave ERRADA: não abriu ${c.onde} da loja ${c.loja}. Os nomes, telefones e endereços desta cópia NÃO podem ser lidos com ela.`);
    return c.ok ? 0 : 1;
  }
  console.log(`Cópia de ${dados.feitaEm || '?'} com ${Object.keys(dados.lojas).length} loja(s)${(dados.falhas || []).length ? ` (e ${dados.falhas.length} falha(s) anotadas nela)` : ''}.`);
  const contar = await restaurarDados(null, dados, { lojas: o.lojas, simular: true }).catch(() => null);
  if (contar) for (const [tid, c] of Object.entries(contar.lojas)) console.log(`  ${tid}: ${Object.entries(c).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (o.simular) { console.log(`Simulação: ${contar ? contar.documentos : '?'} documento(s). Nada foi gravado.`); return 0; }
  const destino = o.emulador ? `EMULADOR (${process.env.FIRESTORE_EMULATOR_HOST}), projeto ${o.projeto}` : `projeto ${o.projeto}`;
  if (ehProducao(o.projeto)) {
    console.log(`\n*** ATENÇÃO: ${o.projeto} é a PRODUÇÃO. Os documentos da cópia vão SUBSTITUIR os que estão no ar. ***`);
    if (await perguntar(`Para continuar, digite o nome do projeto (${o.projeto}): `) !== o.projeto) { console.log('Nada foi gravado.'); return 1; }
  } else if (!o.sim && await perguntar(`Gravar no ${destino}? Digite RESTAURAR: `) !== 'RESTAURAR') { console.log('Nada foi gravado.'); return 1; }

  const admin = require('firebase-admin');
  const app = o.emulador
    ? admin.initializeApp({ projectId: o.projeto }, `restauro-${Date.now()}`)
    : admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(o.credenciais, 'utf8'))), projectId: o.projeto }, `restauro-${Date.now()}`);
  const r = await restaurarDados(app.firestore(), dados, { lojas: o.lojas, Timestamp: admin.firestore.Timestamp });
  console.log(`Pronto: ${r.documentos} documento(s) gravados no ${destino}.`);
  await app.delete().catch(() => {});
  if (r.lgpd.semChave) { console.log(`\n*** LGPD: há ${r.lgpd.marcas} marca(s) de clientes que pediram para apagar, e a DADOS_CHAVE não foi informada. Rode de novo com --chave para apagá-los outra vez. ***`); return 3; }
  const n = Object.values(r.lgpd.reaplicado).reduce((a, b) => a + b, 0);
  if (n) console.log(`LGPD: ${n} pedido(s) de quem já tinha pedido para apagar foram anonimizados de novo.`);
  return 0;
}

module.exports = { lerArquivo, conferirChave, reviver, ehProducao, restaurarDados, lerOpcoes, PRODUCAO_CONHECIDA };

if (require.main === module) {
  principal(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => { console.error(`Não restaurei: ${e && e.message}`); process.exitCode = 2; });
}
