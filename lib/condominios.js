'use strict';
// =====================================================================
//  lib/condominios.js — CADASTRO DE CONDOMÍNIOS DA PLATAFORMA.
//
//  O dono da plataforma cadastra os condomínios uma vez (aba Condomínios) e,
//  em cada feira, só marca quais ela atende. Fica em plataforma/condominios
//  (só o servidor lê e grava). A feira guarda uma CÓPIA do que precisa:
//    feiras/{id}.conds        = [{ id, nome, formato }]  → a loja mostra na lista de endereço
//    feiras/{id}.condominios  = [nomes]                   → o condomínio escolhido leva à feira
//  Mudar o nome ou o formato aqui atualiza as feiras que usam o condomínio.
//
//  formato: 'ql' (quadra e lote) · 'rua' (rua e número) · 'livre' (endereço escrito à mão)
//  — o mesmo de js/endereco.js e da lista de condomínios de cada loja.
// =====================================================================
const FORMATOS = ['ql', 'rua', 'livre'];
const MAX = 300;
const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const normCond = (c) => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (nome) => normCond(nome).replace(/\s+/g, '-').slice(0, 40).replace(/-+$/, '') || 'condominio';
const formatoOk = (f) => (FORMATOS.includes(f) ? f : 'ql');
const ref = (db) => db.collection('plataforma').doc('condominios');

/** Lista limpa: sem nome repetido (ignorando acento e maiúscula), id único, no máximo 300. */
function limparLista(lista) {
  const out = [], nomes = new Set(), ids = new Set();
  for (const c of Array.isArray(lista) ? lista : []) {
    const nome = texto(c && c.nome, 80), k = normCond(nome);
    if (k.length < 2 || nomes.has(k)) continue;
    let id = /^[a-z0-9][a-z0-9-]{0,47}$/.test(String(c && c.id || '')) ? c.id : slug(nome);
    for (let n = 2; ids.has(id); n++) id = `${slug(nome)}-${n}`;
    nomes.add(k); ids.add(id);
    out.push({ id, nome, formato: formatoOk(c && c.formato) });
    if (out.length >= MAX) break;
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Lê o cadastro. Na PRIMEIRA vez ele nasce com o que já existe: os condomínios que cada loja cadastrou
 * no painel dela e os nomes escritos nas feiras antes do cadastro existir. Ninguém precisa digitar de novo.
 */
async function garantir(db, T) {
  const s = await ref(db).get();
  if (s.exists) return limparLista(s.data().lista);
  const achados = [];
  try {
    const lojas = await T.listarLojas(db);
    for (const tid of lojas) {
      const c = await T.docDe(db, tid, 'loja/config').get().catch(() => null);
      for (const x of (c && c.exists && Array.isArray(c.data().condominios) ? c.data().condominios : [])) if (x && x.nome && x.ativo !== false) achados.push({ nome: x.nome, formato: x.formato });
    }
  } catch (_) { /* segue com o que achou */ }
  try { (await db.collection('feiras').get()).docs.forEach((d) => (d.data().condominios || []).forEach((nome) => achados.push({ nome }))); } catch (_) { /* idem */ }
  const lista = limparLista(achados);
  await ref(db).set({ lista, atualizadoEm: new Date().toISOString() });
  return lista;
}
const salvar = (db, lista) => ref(db).set({ lista: limparLista(lista), atualizadoEm: new Date().toISOString() });

/** Os condomínios do cadastro com estes ids (na ordem do cadastro). Id desconhecido é ignorado. */
const escolher = (lista, ids) => { const quer = new Set((Array.isArray(ids) ? ids : []).map(String)); return lista.filter((c) => quer.has(c.id)).slice(0, 40); };
/** Ids do cadastro que uma feira usa: pelas cópias (conds) ou, nas feiras antigas, pelo nome. */
function idsDaFeira(lista, f) {
  const porId = new Set(lista.map((c) => c.id)), porNome = new Map(lista.map((c) => [normCond(c.nome), c.id]));
  const ids = (Array.isArray(f && f.conds) ? f.conds : []).map((c) => c && c.id).filter((id) => porId.has(id));
  for (const nome of Array.isArray(f && f.condominios) ? f.condominios : []) { const id = porNome.get(normCond(nome)); if (id && !ids.includes(id)) ids.push(id); }
  return ids;
}
/** O que a feira guarda de cada condomínio. */
const copiaParaFeira = (escolhidos) => ({ conds: escolhidos.map((c) => ({ id: c.id, nome: c.nome, formato: c.formato })), condominios: escolhidos.map((c) => c.nome) });

module.exports = { FORMATOS, MAX, normCond, slug, limparLista, garantir, salvar, escolher, idsDaFeira, copiaParaFeira, ref };
