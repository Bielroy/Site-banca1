'use strict';
// =====================================================================
//  lib/aprovacao.js — APARELHO NOVO SÓ ENTRA DEPOIS QUE O DONO APROVA (opção de cada loja).
//
//  Por que precisa ser no LOGIN e não na tela: o painel lê o banco direto do navegador. Uma tela de "aguarde"
//  feita só no navegador seria pulada por quem tem o login roubado. Então a trava mora no próprio login:
//
//   - Loja com a opção ligada: o login de cada pessoa da equipe leva a marca  apr: { "id-da-loja": true }
//     (gravada só pelo servidor, junto com o papel).
//   - Com essa marca, o papel NAQUELA loja só vale se o login veio de um aparelho aprovado: o servidor dá um
//     login próprio (token do Firebase) com  apl: [lojas em que ESTE aparelho foi aprovado]  e  apd: registro do aparelho.
//     Quem entrou pelo link do e-mail troca o login por esse (api/equipe.js, ação "sessao-aparelho").
//   - As regras do banco (firestore.rules, aparelhoOk) e o servidor (lib/tenant.papelDe) conferem as duas marcas.
//
//  Aparelho novo: fica "aguardando"; o proprietário recebe aviso no celular e aprova em Equipe → Aparelhos.
//  Aparelho do próprio proprietário: ele aprova de outro aparelho dele já aprovado; sem nenhum, a plataforma aprova.
//  Ao LIGAR a opção, os aparelhos que já entravam na loja ficam aprovados (ninguém da equipe fica trancado).
//  Desconectar um aparelho: bloqueia o registro e encerra o login da conta (lib/aparelhos.bloquear).
//
//  Limite honesto: o login já aberto vale por até 1 hora (regra do Firebase). Depois disso, só com aparelho aprovado.
// =====================================================================
const COL = 'seguranca_lojas';           // fora das regras do banco: só o servidor lê e grava
const cache = new Map();

async function exige(db, tid) {
  const c = cache.get(tid);
  if (c && Date.now() - c.em < 30000) return c.v;
  const s = await db.collection(COL).doc(tid).get();
  const v = !!(s.exists && s.data().aprovarAparelhos === true);
  cache.set(tid, { em: Date.now(), v });
  return v;
}

/** Claims com a marca da loja ligada ou desligada (sem mexer no resto). */
function claimsCom(claims, tid, ligado) {
  const c = { ...(claims || {}) }, apr = { ...(c.apr && typeof c.apr === 'object' ? c.apr : {}) };
  if (ligado) apr[tid] = true; else delete apr[tid];
  if (Object.keys(apr).length) c.apr = apr; else delete c.apr;
  return c;
}

/** Lojas (das que a pessoa participa) em que este registro de aparelho foi aprovado. */
function lojasAprovadas(registro, claims) {
  const aprov = (registro && registro.aprovado) || {}, papeis = (claims && claims.tenants) || {};
  const minhas = Object.keys(papeis).concat(claims && claims.admin === true ? ['banca'] : []);
  return [...new Set(minhas.filter((t) => aprov[t]))].slice(0, 20);
}

/** Login do Firebase preso a este aparelho. */
const tokenDoAparelho = (admin, uid, apdId, lojas) => admin.auth().createCustomToken(uid, { apl: lojas, apd: apdId });

/**
 * Liga/desliga a opção da loja. Ligar: marca o login de toda a equipe e aprova os aparelhos que já entravam na loja.
 * Devolve { ligado, pessoas, aprovados }.
 */
async function definir(db, admin, tid, ligado, { extras = [] } = {}, agora = new Date()) {
  const quando = agora.toISOString();
  await db.collection(COL).doc(tid).set({ aprovarAparelhos: !!ligado, em: quando }, { merge: true });
  cache.delete(tid);
  const raiz = tid === 'banca' ? db : db.collection('tenants').doc(tid);
  const eq = await raiz.collection('equipe').get();
  const uids = [...new Set(eq.docs.map((d) => d.id).concat(extras))];
  let pessoas = 0;
  for (const uid of uids) {
    let u = null; try { u = await admin.auth().getUser(uid); } catch (_) { u = null; }
    if (!u) continue;
    const novos = claimsCom(u.customClaims, tid, ligado);
    if (JSON.stringify(novos).length > 990) continue;            // conta em lojas demais: fica sem a marca (avisado na tela pelo total)
    await admin.auth().setCustomUserClaims(u.uid, novos); pessoas++;
  }
  let aprovados = 0;
  if (ligado) {
    const aps = await db.collection('aparelhos').where('lojas', 'array-contains', tid).get();
    for (const a of aps.docs) {
      const x = a.data();
      if (x.bloqueado === true || (x.aprovado && x.aprovado[tid])) continue;
      await a.ref.set({ aprovado: { ...(x.aprovado || {}), [tid]: quando } }, { merge: true }); aprovados++;
    }
  }
  return { ligado: !!ligado, pessoas, aprovados };
}

/** Aprova um registro de aparelho nesta loja. */
async function aprovar(db, tid, id, agora = new Date()) {
  const ref = db.collection('aparelhos').doc(id), s = await ref.get();
  if (!s.exists) return null;
  const x = s.data(), pend = { ...(x.pendente || {}) }; delete pend[tid];
  await ref.set({ aprovado: { ...(x.aprovado || {}), [tid]: agora.toISOString() }, pendente: pend, bloqueado: false }, { merge: true });
  return { ...x, id };
}

/** Marca o aparelho como aguardando nesta loja. Devolve true se é a PRIMEIRA vez (para avisar o dono uma vez só). */
async function marcarPendente(db, tid, id, agora = new Date()) {
  const ref = db.collection('aparelhos').doc(id), s = await ref.get();
  const x = s.exists ? s.data() : {};
  if (x.pendente && x.pendente[tid]) return false;
  await ref.set({ pendente: { ...(x.pendente || {}), [tid]: agora.toISOString() } }, { merge: true });
  return true;
}

module.exports = { exige, definir, aprovar, marcarPendente, claimsCom, lojasAprovadas, tokenDoAparelho, COL, _cache: cache };
