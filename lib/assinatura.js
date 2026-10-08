'use strict';
// =====================================================================
//  lib/assinatura.js — MENSALIDADE de cada banca (o que o feirante paga à plataforma).
//
//  Fica em assinaturas/{idDaLoja}, na raiz do banco, SEM regra no firestore.rules:
//  nenhum navegador lê nem grava direto (nem o próprio feirante).
//   - o dono da plataforma define e vê todas (api/plataforma.js → 'assinatura');
//   - o proprietário de uma banca vê SÓ a dele, pelo servidor (api/equipe.js → 'minha-assinatura').
// =====================================================================
const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** { valor (R$ por mês), dia (vencimento 1..28, ou null), obs } — valor vazio = sem mensalidade definida (null). */
function limpar(b) {
  const x = b || {};
  const valor = Math.round(Number(String(x.valor == null ? '' : x.valor).replace(',', '.')) * 100) / 100;
  if (!(Number.isFinite(valor) && valor >= 0 && valor <= 100000) || String(x.valor == null ? '' : x.valor).trim() === '') return null;
  const dia = Number(x.dia);
  return { valor, dia: Number.isInteger(dia) && dia >= 1 && dia <= 28 ? dia : null, obs: texto(x.obs, 140) };
}
const ref = (db, tid) => db.collection('assinaturas').doc(tid);
async function ler(db, tid) { const s = await ref(db, tid).get(); return s.exists ? limpar(s.data()) : null; }
module.exports = { limpar, ler, ref };
