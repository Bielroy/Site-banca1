// =====================================================================
//  js/categorias-loja.js — categorias vindas do banco (coleção `categorias`).
//
//  O painel (aba "Categorias") cadastra, renomeia, ordena e oculta; a loja
//  só LÊ, em tempo real. Produto cuja categoria não está cadastrada continua
//  aparecendo normalmente (aba criada automaticamente) — por isso nada
//  quebra enquanto a lista estiver vazia.
//
//  Cada categoria:  { chave, nome, ordem, visivel, wppId }
//    chave   = texto guardado em produtos.cat (nunca muda ao renomear)
//    nome    = o que o cliente lê na aba
//    visivel = false esconde a aba E os produtos dela
// =====================================================================
import { db, collection, onSnapshot } from './firebase.js';
import { tcol, tdoc, chave, TENANT, ehLojaOriginal, fichaRef, pastaFotos, urlDaLoja } from './tenant.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

let categorias = [];

export const iniciarCategorias = (aoMudar) => onSnapshot(
    tcol('categorias'),
    (snap) => {
        categorias = snap.docs
            .map((d) => ({ ...d.data(), id: d.id }))
            .filter((c) => c.chave)
            .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
        aoMudar();
    },
    () => { categorias = []; aoMudar(); }   // sem permissão/offline: a loja segue com as categorias dos produtos
);

const achar = (cat) => categorias.find((c) => norm(c.chave) === norm(cat));

/** Padroniza p.cat com a chave cadastrada e tira os produtos de categorias ocultas. */
export const aplicarCategorias = (produtos) => produtos
    .map((p) => { const c = achar(p.cat); return c ? { ...p, cat: c.chave } : p; })
    .filter((p) => { const c = achar(p.cat); return !c || c.visivel !== false; });

/** Abas na ordem do painel; categorias sem produto não aparecem. */
export const abasDeCategoria = (produtos) => {
    const usadas = new Set(produtos.map((p) => p.cat).filter(Boolean));
    const cadastradas = categorias.filter((c) => c.visivel !== false && usadas.has(c.chave)).map((c) => ({ chave: c.chave, nome: c.nome || c.chave }));
    const conhecidas = new Set(cadastradas.map((c) => c.chave));
    const soltas = [...usadas].filter((c) => !conhecidas.has(c) && !achar(c)).sort().map((c) => ({ chave: c, nome: c }));
    return [...cadastradas, ...soltas];
};

/** Assinatura curta: muda quando algo visível das categorias muda (para re-renderizar). */
export const assinaturaCategorias = () => categorias.map((c) => `${c.chave}:${c.nome}:${c.ordem}:${c.visivel !== false}`).join('|');
