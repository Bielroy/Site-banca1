// =====================================================================
//  js/fila-offline.js — O PAINEL CONTINUA FUNCIONANDO SEM INTERNET (na feira o sinal cai).
//
//  O banco (Firestore) já segura as alterações feitas sem internet e manda quando ela volta. Faltavam três coisas:
//   1. A tela ficava "presa": o painel espera a confirmação do servidor (await setDoc) e, sem internet, ela não vem.
//      Agora, sem internet, a alteração é aceita na hora (o banco manda depois) e o painel segue.
//   2. No iPhone o banco não guarda cópia no aparelho (js/firebase.js explica por quê). Se o painel fechasse sem
//      internet, o que estava esperando se perdia. Agora cada alteração também vai para uma FILA no aparelho
//      (IndexedDB, como o idb-keyval) e sai dela quando o servidor confirma. Ao abrir de novo, o que sobrou é mandado.
//   3. Ninguém sabia que havia algo esperando: um aviso no topo diz "Sem internet. 3 alterações esperando".
//  Alteração com marcador do Firebase (hora do servidor, apagar campo) não entra na fila do aparelho: segue só pelo banco.
//  Use estas funções no lugar das de js/firebase.js: setDoc, deleteDoc, writeBatch.
// =====================================================================
import { db, doc, setDoc as setReal, deleteDoc as apagarReal, writeBatch as loteReal } from './firebase.js';
import { guardavel, paraReenviar, textoDoAviso } from './fila-offline-lib.js';

const ehApple = typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent || '') || (/macintosh/i.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1));
const BANCO = 'usebanca-fila', LOJA = 'alteracoes';
let seq = 0, pendentes = 0;

// ---- IndexedDB em poucas linhas (mecânica do idb-keyval). Sem IndexedDB (aba privada antiga): a fila fica só na memória.
let _idb = null;
const abrir = () => _idb || (_idb = new Promise((ok, falha) => {
    try { const r = indexedDB.open(BANCO, 1); r.onupgradeneeded = () => r.result.createObjectStore(LOJA); r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); }
    catch (e) { falha(e); }
}));
const loja = async (modo, fn) => { const d = await abrir(); return new Promise((ok, falha) => { const t = d.transaction(LOJA, modo), r = fn(t.objectStore(LOJA)); t.oncomplete = () => ok(r && r.result); t.onerror = () => falha(t.error); }); };
const guardar = (chave, v) => loja('readwrite', (s) => s.put(v, chave)).catch(() => {});
const tirar = (chave) => loja('readwrite', (s) => s.delete(chave)).catch(() => {});
const todos = () => loja('readonly', (s) => s.getAll()).catch(() => []);

// ---- aviso no topo
function pintarAviso() {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('rede-aviso');
    const texto = textoDoAviso({ online: navigator.onLine !== false, pendentes });
    if (!el) { if (!texto) return; el = document.createElement('p'); el.id = 'rede-aviso'; el.className = 'rede-aviso'; el.setAttribute('role', 'status'); document.body.prepend(el); }
    el.textContent = texto; el.hidden = !texto; el.classList.toggle('offline', navigator.onLine === false);
}
if (typeof window !== 'undefined') { window.addEventListener('online', pintarAviso); window.addEventListener('offline', pintarAviso); }

/** Faz a alteração de verdade e, enquanto o servidor não confirma, deixa uma cópia na fila do aparelho. */
function proteger(op, caminho, dados, opcoes, real) {
    const item = op === 'apagar' || guardavel(dados) ? { op, caminho, dados: op === 'apagar' ? null : dados, merge: !!(opcoes && opcoes.merge), em: Date.now(), seq: ++seq } : null;
    const chave = item ? `${item.em}-${item.seq}` : '';
    // só vai para a fila do aparelho o que está de fato esperando: feito sem internet, ou sem confirmação em 4 s.
    // (Guardar tudo faria o painel reenviar, ao abrir, uma alteração já feita e desfazer o que outro aparelho mudou depois.)
    let guardado = false;
    const guardarJa = () => { if (item && !guardado) { guardado = true; guardar(chave, item); } };
    if (navigator.onLine === false) guardarJa();
    const espera = setTimeout(guardarJa, 4000);
    pendentes++; pintarAviso();
    const p = real().finally(() => { clearTimeout(espera); pendentes = Math.max(0, pendentes - 1); pintarAviso(); if (guardado) tirar(chave); });
    if (navigator.onLine === false) {                                        // sem internet: não prende a tela esperando
        p.catch((e) => console.warn('[fila] alteração recusada quando a internet voltou:', caminho, e && (e.code || e.message)));
        return Promise.resolve();
    }
    return p;
}

export const setDoc = (ref, dados, opcoes) => proteger('set', ref.path, dados, opcoes, () => (opcoes ? setReal(ref, dados, opcoes) : setReal(ref, dados)));
export const deleteDoc = (ref) => proteger('apagar', ref.path, null, null, () => apagarReal(ref));
/** Lote: as mesmas regras, o lote inteiro como uma alteração só na contagem. */
export function writeBatch(banco) {
    const lote = loteReal(banco), itens = [];
    return {
        set(ref, dados, opcoes) { itens.push({ op: 'set', ref, dados, opcoes }); opcoes ? lote.set(ref, dados, opcoes) : lote.set(ref, dados); return this; },
        update(ref, dados) { lote.update(ref, dados); return this; },
        delete(ref) { itens.push({ op: 'apagar', ref }); lote.delete(ref); return this; },
        commit() {
            const copias = itens.filter((x) => x.op === 'apagar' || guardavel(x.dados)).map((x) => ({ op: x.op, caminho: x.ref.path, dados: x.op === 'apagar' ? null : x.dados, merge: !!(x.opcoes && x.opcoes.merge), em: Date.now(), seq: ++seq }));
            let guardado = false;
            const guardarJa = () => { if (!guardado) { guardado = true; copias.forEach((c) => guardar(`${c.em}-${c.seq}`, c)); } };
            if (navigator.onLine === false) guardarJa();
            const espera = setTimeout(guardarJa, 4000);
            pendentes++; pintarAviso();
            const p = lote.commit().finally(() => { clearTimeout(espera); pendentes = Math.max(0, pendentes - 1); pintarAviso(); if (guardado) copias.forEach((c) => tirar(`${c.em}-${c.seq}`)); });
            if (navigator.onLine === false) { p.catch((e) => console.warn('[fila] lote recusado:', e && (e.code || e.message))); return Promise.resolve(); }
            return p;
        },
    };
}

/** Ao abrir o painel: manda de novo o que sobrou na fila do aparelho (só no iPhone/iPad; nos outros o próprio banco guarda). */
export async function reenviarPendentes() {
    if (typeof indexedDB === 'undefined') return 0;
    const sobras = await todos();
    if (!sobras.length) return 0;
    await loja('readwrite', (s) => s.clear()).catch(() => {});
    if (!ehApple) return 0;
    const lista = paraReenviar(sobras);
    for (const x of lista) {
        try { if (x.op === 'apagar') await deleteDoc(doc(db, x.caminho)); else await setDoc(doc(db, x.caminho), x.dados, x.merge ? { merge: true } : undefined); }
        catch (e) { console.warn('[fila] não reenviou', x.caminho, e && (e.code || e.message)); }
    }
    return lista.length;
}
export const alteracoesEsperando = () => pendentes;
