// =====================================================================
//  js/admin-categorias.js — aba "🏷️ Categorias" do painel admin.
//
//   • cadastrar / renomear / reordenar / ocultar categorias (coleção `categorias`)
//   • cadastrar números extras de WhatsApp (loja/config.numeros)
//   • escolher, por categoria, qual número recebe os pedidos dela
//
//  A loja lê tudo em tempo real (js/categorias-loja.js); o servidor usa o
//  mesmo cadastro para dividir o pedido (lib/roteamentoWhatsapp.js).
// =====================================================================
import { db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch } from './firebase.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';

const S = { cats: [], numeros: [], padrao: '', getProdutos: () => [], iniciado: false };

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'categoria';
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const fmtTel = (d) => { const t = soDigitos(d); return t.length >= 12 ? `+${t.slice(0, 2)} (${t.slice(2, 4)}) ${t.slice(4, -4)}-${t.slice(-4)}` : t; };

const contarProdutos = () => {
    const m = new Map();
    S.getProdutos().forEach((p) => { const k = norm(p.cat); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
};

// ------------------------------------------------------------------ dados
const salvarNumeros = (lista) => setDoc(doc(db, 'loja', 'config'), { numeros: lista }, { merge: true });

const reordenar = async (ids) => {
    const b = writeBatch(db);
    ids.forEach((id, i) => b.update(doc(db, 'categorias', id), { ordem: (i + 1) * 10 }));
    await b.commit();
};

const tentar = async (fn, msgErro = 'Não foi possível salvar.') => {
    try { await fn(); } catch (e) { console.error(e); showToast(msgErro, true); }
};

// ------------------------------------------------------------------ ações
const adicionar = () => tentar(async () => {
    const campo = document.getElementById('cat-novo-nome');
    const nome = campo.value.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!nome) return showToast('Digite o nome da categoria.', true);
    const id = slug(nome);
    if (S.cats.some((c) => c.id === id || norm(c.chave) === norm(nome))) return showToast('Essa categoria já existe.', true);
    const ordem = (Math.max(0, ...S.cats.map((c) => Number(c.ordem) || 0)) || 0) + 10;
    await setDoc(doc(db, 'categorias', id), { chave: nome.toLowerCase(), nome, ordem, visivel: true, wppId: '' });
    campo.value = '';
    showToast(`✅ "${nome}" criada. Já aparece na loja quando tiver produto.`);
});

const importar = () => tentar(async () => {
    const conhecidas = new Set(S.cats.map((c) => norm(c.chave)));
    const novas = new Map();
    S.getProdutos().forEach((p) => { const k = norm(p.cat); if (k && !conhecidas.has(k) && !novas.has(k)) novas.set(k, String(p.cat).trim()); });
    if (!novas.size) return showToast('Todas as categorias dos produtos já estão cadastradas.');
    const b = writeBatch(db);
    let ordem = Math.max(0, ...S.cats.map((c) => Number(c.ordem) || 0));
    [...novas.values()].sort((a, c) => a.localeCompare(c, 'pt-BR')).forEach((chave) => {
        ordem += 10;
        const nome = chave.charAt(0).toUpperCase() + chave.slice(1);
        b.set(doc(db, 'categorias', slug(chave)), { chave, nome, ordem, visivel: true, wppId: '' });
    });
    await b.commit();
    showToast(`✅ ${novas.size} categoria(s) importada(s).`);
});

const renomear = (id, valor) => tentar(async () => {
    const nome = valor.trim().replace(/\s+/g, ' ').slice(0, 40);
    const atual = S.cats.find((c) => c.id === id);
    if (!atual || !nome || nome === atual.nome) return render();
    await updateDoc(doc(db, 'categorias', id), { nome });
    showToast('✏️ Nome atualizado na loja.');
});

const alternar = (id, visivel) => tentar(async () => {
    await updateDoc(doc(db, 'categorias', id), { visivel });
    showToast(visivel ? '👁️ Categoria visível na loja.' : '🙈 Categoria oculta na loja.');
});

const mover = (id, delta) => tentar(async () => {
    const ids = S.cats.map((c) => c.id);
    const i = ids.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reordenar(ids);
});

const trocarNumero = (id, wppId) => tentar(async () => {
    await updateDoc(doc(db, 'categorias', id), { wppId });
    showToast('📲 Número da categoria atualizado.');
});

const apagar = (id) => tentar(async () => {
    const c = S.cats.find((x) => x.id === id);
    if (!c) return;
    const n = contarProdutos().get(norm(c.chave)) || 0;
    const aviso = n
        ? `"${c.nome}" tem ${n} produto(s). Se apagar, eles continuam na loja, mas numa aba solta (sem ordem, sem ocultar e sem número próprio). Para só tirar da loja, use "Visível". Apagar mesmo?`
        : `Apagar a categoria "${c.nome}"?`;
    if (!(await customConfirm('Apagar categoria', aviso))) return;
    await deleteDoc(doc(db, 'categorias', id));
    showToast('🗑️ Categoria apagada.');
});

const adicionarNumero = () => tentar(async () => {
    const nome = document.getElementById('wpp-novo-nome').value.trim().slice(0, 40);
    let numero = soDigitos(document.getElementById('wpp-novo-numero').value);
    if (numero.length === 10 || numero.length === 11) numero = '55' + numero;   // sem DDI: assume Brasil (o wa.me exige)
    if (!nome) return showToast('Dê um nome ao número (ex.: Artesanais).', true);
    if (numero.length < 10 || numero.length > 15) return showToast('Número inválido. Use DDI+DDD+número, ex.: 5562999998888.', true);
    if (numero === S.padrao || S.numeros.some((n) => n.numero === numero)) return showToast('Esse número já está cadastrado.', true);
    await salvarNumeros([...S.numeros, { id: 'n' + Date.now().toString(36), nome, numero }]);
    document.getElementById('wpp-novo-nome').value = ''; document.getElementById('wpp-novo-numero').value = '';
    showToast(`✅ Número "${nome}" cadastrado. Agora escolha-o nas categorias.`);
});

const removerNumero = (id) => tentar(async () => {
    const n = S.numeros.find((x) => x.id === id);
    if (!n) return;
    const usadas = S.cats.filter((c) => c.wppId === id);
    const aviso = usadas.length
        ? `${usadas.length} categoria(s) usam "${n.nome}" e voltarão ao número padrão. Remover?`
        : `Remover o número "${n.nome}"?`;
    if (!(await customConfirm('Remover número', aviso))) return;
    const b = writeBatch(db);
    usadas.forEach((c) => b.update(doc(db, 'categorias', c.id), { wppId: '' }));
    b.set(doc(db, 'loja', 'config'), { numeros: S.numeros.filter((x) => x.id !== id) }, { merge: true });
    await b.commit();
    showToast('🗑️ Número removido.');
});

// ------------------------------------------------------------------ tela
const opcoesNumero = (sel) => `<option value="">Número padrão${S.padrao ? ` (${escapeHTML(fmtTel(S.padrao))})` : ''}</option>`
    + S.numeros.map((n) => `<option value="${escapeHTML(n.id)}" ${n.id === sel ? 'selected' : ''}>${escapeHTML(n.nome)} — ${escapeHTML(fmtTel(n.numero))}</option>`).join('');

const linhaCategoria = (c, i, total, qtd) => `
    <article class="cg-item ${c.visivel === false ? 'cg-oculta' : ''}" data-id="${escapeHTML(c.id)}">
        <div class="cg-topo">
            <div class="cg-setas">
                <button type="button" data-cg="subir" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
                <button type="button" data-cg="descer" ${i === total - 1 ? 'disabled' : ''} aria-label="Descer">▼</button>
            </div>
            <input class="cg-nome" type="text" value="${escapeHTML(c.nome || c.chave)}" maxlength="40" aria-label="Nome da categoria" data-cg="nome">
            <button type="button" class="cg-apagar" data-cg="apagar" aria-label="Apagar categoria">🗑️</button>
        </div>
        <div class="cg-base">
            <label class="cg-chave"><input type="checkbox" data-cg="visivel" ${c.visivel === false ? '' : 'checked'}> <span>${c.visivel === false ? 'Oculta na loja' : 'Visível na loja'}</span></label>
            <span class="cg-qtd">${qtd} produto${qtd === 1 ? '' : 's'}</span>
        </div>
        <label class="cg-wpp">📲 Pedidos desta categoria vão para
            <select data-cg="wpp">${opcoesNumero(c.wppId)}</select>
        </label>
    </article>`;

function render() {
    const el = document.getElementById('categorias-conteudo');
    if (!el) return;
    // não redesenha enquanto a pessoa digita num campo da própria aba
    if (el.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.dataset.cg !== 'visivel') return;

    const qtd = contarProdutos();
    const conhecidas = new Set(S.cats.map((c) => norm(c.chave)));
    const soltas = new Set(); S.getProdutos().forEach((p) => { const k = norm(p.cat); if (k && !conhecidas.has(k)) soltas.add(k); });

    el.innerHTML = `
        <h3 class="cg-titulo">Categorias da Loja</h3>
        <p class="config-sub">Crie, renomeie, reordene e oculte abas. A loja do cliente muda na hora.</p>

        <div class="cg-novo">
            <input id="cat-novo-nome" type="text" maxlength="40" placeholder="Nova categoria (ex.: Produtos Artesanais)" aria-label="Nome da nova categoria">
            <button type="button" id="cat-btn-add" class="btn-salvar-config">+ Criar</button>
        </div>
        ${soltas.size ? `<div class="cg-aviso">📥 ${soltas.size} categoria(s) dos seus produtos ainda não estão cadastradas aqui.
            <button type="button" id="cat-btn-importar">Importar agora</button></div>` : ''}

        <div class="cg-lista">${S.cats.length
            ? S.cats.map((c, i) => linhaCategoria(c, i, S.cats.length, qtd.get(norm(c.chave)) || 0)).join('')
            : '<p class="cg-vazio">Nenhuma categoria cadastrada ainda. Enquanto estiver vazio, a loja usa as categorias dos produtos, como sempre.</p>'}</div>

        <h3 class="cg-titulo cg-titulo2">Números de WhatsApp</h3>
        <p class="config-sub">O número padrão (aba ⚙️ Operacional) recebe tudo que não tiver número próprio.${S.padrao ? ` Hoje: <b>${escapeHTML(fmtTel(S.padrao))}</b>.` : ''}</p>
        <div class="cg-lista">${S.numeros.map((n) => `
            <article class="cg-item cg-num" data-nid="${escapeHTML(n.id)}">
                <div class="cg-topo"><div class="cg-num-info"><strong>${escapeHTML(n.nome)}</strong><span>${escapeHTML(fmtTel(n.numero))}</span></div>
                <button type="button" class="cg-apagar" data-cg="rm-num" aria-label="Remover número">🗑️</button></div>
                <small>${S.cats.filter((c) => c.wppId === n.id).map((c) => escapeHTML(c.nome)).join(', ') || 'Nenhuma categoria usa este número ainda.'}</small>
            </article>`).join('')}</div>
        <div class="cg-novo cg-novo--num">
            <input id="wpp-novo-nome" type="text" maxlength="40" placeholder="Nome (ex.: Artesanais)" aria-label="Nome do número">
            <input id="wpp-novo-numero" type="tel" inputmode="numeric" placeholder="5562999998888" aria-label="Número com DDI e DDD">
            <button type="button" id="wpp-btn-add" class="btn-salvar-config">+ Cadastrar</button>
        </div>`;

    // sugestões no campo "Classificação" do cadastro de produto
    let dl = document.getElementById('lista-categorias-admin');
    if (!dl) { document.body.insertAdjacentHTML('beforeend', '<datalist id="lista-categorias-admin"></datalist>'); dl = document.getElementById('lista-categorias-admin'); }
    dl.innerHTML = S.cats.map((c) => `<option value="${escapeHTML(c.chave)}">${escapeHTML(c.nome || c.chave)}</option>`).join('');
    document.getElementById('edit-cat')?.setAttribute('list', 'lista-categorias-admin');
}

function ligarEventos() {
    const el = document.getElementById('categorias-conteudo');
    if (!el || el.dataset.ligado) return;
    el.dataset.ligado = '1';
    el.addEventListener('click', (e) => {
        const alvo = e.target.closest('button'); if (!alvo) return;
        const id = alvo.closest('[data-id]')?.dataset.id;
        if (alvo.id === 'cat-btn-add') adicionar();
        else if (alvo.id === 'cat-btn-importar') importar();
        else if (alvo.id === 'wpp-btn-add') adicionarNumero();
        else if (alvo.dataset.cg === 'subir') mover(id, -1);
        else if (alvo.dataset.cg === 'descer') mover(id, 1);
        else if (alvo.dataset.cg === 'apagar') apagar(id);
        else if (alvo.dataset.cg === 'rm-num') removerNumero(alvo.closest('[data-nid]').dataset.nid);
    });
    el.addEventListener('change', (e) => {
        const id = e.target.closest('[data-id]')?.dataset.id;
        if (e.target.dataset.cg === 'nome') renomear(id, e.target.value);
        else if (e.target.dataset.cg === 'visivel') alternar(id, e.target.checked);
        else if (e.target.dataset.cg === 'wpp') trocarNumero(id, e.target.value);
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.target.id === 'cat-novo-nome') adicionar();
        else if (e.target.id === 'wpp-novo-numero') adicionarNumero();
        else if (e.target.dataset.cg === 'nome') e.target.blur();
    });
}

/** Liga as assinaturas em tempo real. Chamar uma vez, depois do login de admin. */
export const iniciarCategoriasAdmin = (getProdutos) => {
    if (S.iniciado) return [];
    S.iniciado = true;
    S.getProdutos = getProdutos || S.getProdutos;
    const u1 = onSnapshot(collection(db, 'categorias'), (snap) => {
        S.cats = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
        render();
    }, (e) => console.error('categorias:', e));
    const u2 = onSnapshot(doc(db, 'loja', 'config'), (snap) => {
        const d = snap.exists() ? snap.data() : {};
        S.padrao = soDigitos(d.wpp);
        S.numeros = (Array.isArray(d.numeros) ? d.numeros : []).filter((n) => n && n.id).map((n) => ({ id: String(n.id), nome: String(n.nome || ''), numero: soDigitos(n.numero) }));
        render();
    });
    return [u1, u2];
};

/** Ao abrir a aba. */
export const abrirCategorias = () => { ligarEventos(); render(); };

