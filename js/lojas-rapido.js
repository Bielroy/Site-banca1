// =====================================================================
//  js/lojas-rapido.js — A LISTA DE LOJAS PARA TROCAR DE LOJA, RÁPIDA.
//
//  Quem cuida da plataforma troca de loja o dia todo. A lista completa da
//  tela Plataforma lê o movimento do mês de cada loja (devagar); para trocar
//  só precisa de nome, tipo e cor. Aqui:
//    · a lista leve vem de /api/plataforma (acao: 'lojas-leve'), só as fichas;
//    · a última lista fica guardada no aparelho (só nomes de loja, nada de
//      dinheiro nem e-mail), e aparece NA HORA enquanto a nova chega;
//    · o endereço de cada loja é montado no aparelho (urlDaLoja).
//  Sem dependências além do endereço das lojas: painel e Plataforma importam daqui.
// =====================================================================
import { auth } from './firebase.js';

const CHAVE = 'pf_lojas_leve_v1';
const VALE_MS = 7 * 24 * 3600 * 1000;      // cópia mais velha que isso não é mostrada

const limpa = (l) => (Array.isArray(l) ? l : []).filter((x) => x && typeof x.id === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(x.id))
    .map((x) => ({ id: x.id, nome: String(x.nome || x.id).slice(0, 60), tipo: String(x.tipo || '').slice(0, 30), ativo: x.ativo !== false, original: x.original === true, cor: /^#[0-9a-fA-F]{6}$/.test(String(x.cor)) ? x.cor : '#1a3a2a' }))
    .slice(0, 200);

/** A última lista guardada neste aparelho (vazia se não houver ou se for velha). */
export function listaGuardada() {
    try {
        const g = JSON.parse(localStorage.getItem(CHAVE) || 'null');
        return g && Date.now() - Number(g.em) < VALE_MS ? limpa(g.lojas) : [];
    } catch (_) { return []; }
}
const guardar = (lojas) => { try { localStorage.setItem(CHAVE, JSON.stringify({ em: Date.now(), lojas })); } catch (_) { /* aparelho cheio: segue sem guardar */ } };

/** Busca a lista leve no servidor e guarda. Só funciona para quem cuida da plataforma. */
export async function buscarLista() {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('sem login');
    const r = await fetch('/api/plataforma', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'lojas-leve' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.lojas)) throw new Error(j.error || 'não consegui a lista');
    const lojas = limpa(j.lojas);
    guardar(lojas);
    return lojas;
}

/** Guarda uma lista que a tela Plataforma já tem (a completa), para o painel abrir o seletor sem esperar. */
export function guardarDaPlataforma(lojas) {
    guardar(limpa((lojas || []).map((l) => ({ id: l.id, nome: l.nome, tipo: l.tipo, ativo: l.ativo, original: l.original, cor: l.cor }))));
}

/** Tira acento e põe em minúsculas, para a busca achar "pao" em "Pães da Lúcia". */
export const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Filtra pelo que a pessoa digitou (nome, tipo ou endereço). Vazio = tudo. */
export const filtrarLojas = (lojas, termo) => {
    const t = semAcento(termo); if (!t) return lojas;
    return lojas.filter((l) => semAcento(`${l.nome} ${l.tipo} ${l.id}`).includes(t));
};
