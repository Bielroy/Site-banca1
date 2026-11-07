// =====================================================================
//  js/painel-catalogo.js — o PAINEL lê os produtos e os custos de UM documento cada (loja/painel e
//  loja/custos, montados pelo servidor em lib/catalogo.js), em vez de um por um.
//  Antes: abrir o painel = 1 leitura por produto + 1 por custo. Agora: 2 leituras + o que mudou há pouco.
//
//  Sempre certo, sem limpar cache:
//   - documento e produtos mudados ficam OUVIDOS (ao vivo, como antes);
//   - produto salvo neste aparelho aparece na hora (ele entra nos "mudados" e o Firestore mostra antes de gravar);
//   - o que este aparelho mudou sem passar pelos "mudados" (limites de estoque, custo, produto apagado) fica
//     marcado por cima até o servidor remendar o documento (segundos);
//   - documento faltando, inválido, grande demais, sem permissão (regra ainda não publicada) ou sem resposta:
//     volta para o jeito antigo (lê todos), exatamente como o painel funcionava antes.
// =====================================================================
export const VERSAO = 1;
export const MARGEM_MS = 10 * 60 * 1000;          // = lib/catalogo.js
const ESPERA_DOCUMENTO_MS = 5000;
const MARCA_MS = 2 * 60 * 1000;                   // quanto tempo uma mudança local fica por cima, no máximo

const existe = (snap) => (typeof snap.exists === 'function' ? snap.exists() : !!snap.exists);
export const painelValido = (c) => !!(c && c.v === VERSAO && !c.grande && Array.isArray(c.produtos) && Number(c.geradoEm) > 0);
export const custosValido = (c) => !!(c && c.v === VERSAO && !c.grande && c.custos && typeof c.custos === 'object' && !Array.isArray(c.custos) && Number(c.geradoEm) > 0);

/** Marcas locais: { id -> { campos, ate } }. Somem quando o documento já mostra o mesmo valor, ou depois de 2 min. */
function criarMarcas() {
    const marcas = new Map(), apagados = new Map();
    const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    return {
        marcar(id, campos) { marcas.set(String(id), { campos: { ...campos }, ate: Date.now() + MARCA_MS }); },
        apagar(id) { apagados.set(String(id), Date.now() + MARCA_MS); },
        /** Aplica por cima do que veio. `doBanco(id)` = o que o documento diz (para saber se a marca já pode sair). */
        aplicar(mapa) {
            const agora = Date.now();
            for (const [id, ate] of apagados) { if (ate < agora || !mapa.has(id)) apagados.delete(id); else mapa.delete(id); }
            for (const [id, m] of marcas) {
                const atual = mapa.get(id);
                if (m.ate < agora || (atual && Object.entries(m.campos).every(([k, v]) => igual(atual[k], v)))) { marcas.delete(id); continue; }
                if (atual) mapa.set(id, { ...atual, ...m.campos });
                else if (m.campos.nome) mapa.set(id, { ...m.campos, id });        // produto novo salvo aqui
            }
            return mapa;
        },
    };
}

/**
 * Produtos do painel. fb = { onSnapshot, query, where, docPainel, colProdutos }.
 * aoMudar(lista, modo) · aoErro(e) só no jeito antigo · aoPendentes(ids) quando este aparelho salvou produtos
 * (ids vazio = algo que não dá para saber qual, como apagar: pede remontagem inteira).
 * Devolve parar() com .marcar(id, campos) e .apagar(id).
 */
export function ouvirProdutosPainel(fb, { aoMudar, aoErro, aoPendentes, aoTrocarModo, forcarAntigo = false } = {}) {
    let modo = 'painel', cancelado = false, base = null, mudados = [], limite = null, relogio = null, pararMudados = null;
    const paradas = [], marcas = criarMarcas();
    const pendentesDe = (snap) => {
        if (!snap.metadata || !snap.metadata.hasPendingWrites || !aoPendentes) return;
        const ids = snap.docChanges().filter((c) => c.type !== 'removed' && c.doc.metadata && c.doc.metadata.hasPendingWrites).map((c) => c.doc.id);
        aoPendentes(ids);
    };
    const lista = (m) => [...marcas.aplicar(m).values()];
    let ultimaAntiga = null;
    const antigo = (motivo) => {
        if (cancelado || modo === 'antigo') return;
        modo = 'antigo'; clearTimeout(relogio);
        if (pararMudados) { pararMudados(); pararMudados = null; }
        while (paradas.length) { try { paradas.pop()(); } catch (_) { /* já parado */ } }
        if (aoTrocarModo) aoTrocarModo('antigo', motivo);
        paradas.push(fb.onSnapshot(fb.colProdutos, (snap) => {
            ultimaAntiga = new Map(snap.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
            aoMudar(lista(new Map(ultimaAntiga)), 'antigo');
            pendentesDe(snap);
        }, (e) => aoErro && aoErro(e)));
    };
    const desenhar = () => {
        if (cancelado || modo !== 'painel' || !base) return;
        const m = new Map(base.map((p) => [String(p.id), p]));
        for (const p of mudados) m.set(String(p.id), p);
        aoMudar(lista(m), 'painel');
    };
    const ouvirMudados = (desde) => {
        if (limite === desde && pararMudados) return;
        if (pararMudados) pararMudados();
        limite = desde; mudados = [];
        pararMudados = fb.onSnapshot(fb.query(fb.colProdutos, fb.where('ultimaModificacao', '>', desde)), (snap) => {
            mudados = snap.docs.map((d) => ({ ...d.data(), id: d.id })); desenhar(); pendentesDe(snap);
        }, () => antigo('erro-mudados'));
    };
    const parar = () => { cancelado = true; clearTimeout(relogio); if (pararMudados) pararMudados(); while (paradas.length) { try { paradas.pop()(); } catch (_) { /* já parado */ } } };
    parar.marcar = (id, campos) => { marcas.marcar(id, campos); if (modo === 'painel') desenhar(); else if (ultimaAntiga) aoMudar(lista(new Map(ultimaAntiga)), 'antigo'); };
    parar.apagar = (id) => { marcas.apagar(id); if (modo === 'painel') desenhar(); };
    parar.modo = () => modo;
    if (forcarAntigo || !fb.docPainel) { antigo('forcado'); return parar; }

    relogio = setTimeout(() => { if (!base) antigo('sem-resposta'); }, ESPERA_DOCUMENTO_MS);
    paradas.push(fb.onSnapshot(fb.docPainel, (snap) => {
        if (cancelado || modo !== 'painel') return;
        const c = existe(snap) ? snap.data() : null;
        if (!painelValido(c)) {
            if (!existe(snap) && snap.metadata && snap.metadata.fromCache && (typeof navigator === 'undefined' || navigator.onLine !== false)) return;   // espera a internet
            return antigo(c && c.grande ? 'grande' : 'sem-documento');
        }
        clearTimeout(relogio);
        base = c.produtos;
        ouvirMudados(Number(c.geradoEm) - MARGEM_MS);
        desenhar();
    }, () => antigo('erro-documento')));          // regra ainda não publicada (caixa, estoque): o jeito antigo resolve
    return parar;
}

/**
 * Custos e fichas (privados). fb = { onSnapshot, docCustos, colCustos }. aoMudar(Map id -> { custo, ficha }).
 * Devolve parar() com .marcar(id, campos) (custo salvo neste aparelho, até o servidor remendar).
 */
export function ouvirCustosPainel(fb, { aoMudar, aoErro, forcarAntigo = false } = {}) {
    let modo = 'painel', cancelado = false, ultimo = null, relogio = null;
    const paradas = [], marcas = criarMarcas();
    const entregar = () => { if (ultimo) aoMudar(marcas.aplicar(new Map(ultimo))); };
    const antigo = () => {
        if (cancelado || modo === 'antigo') return;
        modo = 'antigo'; clearTimeout(relogio);
        while (paradas.length) { try { paradas.pop()(); } catch (_) { /* já parado */ } }
        paradas.push(fb.onSnapshot(fb.colCustos, (snap) => { ultimo = new Map(snap.docs.map((d) => [d.id, d.data()])); entregar(); }, (e) => aoErro && aoErro(e)));
    };
    const parar = () => { cancelado = true; clearTimeout(relogio); while (paradas.length) { try { paradas.pop()(); } catch (_) { /* já parado */ } } };
    parar.marcar = (id, campos) => { marcas.marcar(id, campos); entregar(); };
    parar.modo = () => modo;
    if (forcarAntigo || !fb.docCustos) { antigo(); return parar; }
    relogio = setTimeout(() => { if (!ultimo) antigo(); }, ESPERA_DOCUMENTO_MS);
    paradas.push(fb.onSnapshot(fb.docCustos, (snap) => {
        if (cancelado || modo !== 'painel') return;
        const c = existe(snap) ? snap.data() : null;
        if (!custosValido(c)) {
            if (!existe(snap) && snap.metadata && snap.metadata.fromCache && (typeof navigator === 'undefined' || navigator.onLine !== false)) return;
            return antigo();
        }
        clearTimeout(relogio);
        ultimo = new Map(Object.entries(c.custos));
        entregar();
    }, () => antigo()));
    return parar;
}

// O painel guarda aqui as escutas abertas, para outras telas (estoque, custos) marcarem o que salvaram.
const ESCUTAS = { produtos: null, custos: null };
export const guardarEscutas = (produtos, custos) => { ESCUTAS.produtos = produtos || null; ESCUTAS.custos = custos || null; };
/** Este aparelho salvou campos de um produto que não mexem em ultimaModificacao (limites de estoque). */
export const marcarProdutoLocal = (id, campos) => { try { ESCUTAS.produtos && ESCUTAS.produtos.marcar(id, campos); } catch (_) { /* sem painel aberto */ } };
/** Este aparelho apagou um produto. */
export const marcarApagadoLocal = (id) => { try { ESCUTAS.produtos && ESCUTAS.produtos.apagar(id); } catch (_) { /* sem painel aberto */ } };
/** Este aparelho salvou custo ou ficha técnica. */
export const marcarCustoLocal = (id, campos) => { try { ESCUTAS.custos && ESCUTAS.custos.marcar(id, campos); } catch (_) { /* sem painel aberto */ } };
