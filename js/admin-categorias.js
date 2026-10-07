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
import { tcol, tdoc, chave, TENANT, ehLojaOriginal, fichaRef, pastaFotos, urlDaLoja } from './tenant.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';

const S = { cats: [], numeros: [], padrao: '', getProdutos: () => [], configPronta: false, erro: '' };
let desligar = [];          // assinaturas em tempo real ativas

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'categoria';
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
// WhatsApp no formato que o wa.me exige: DDI + DDD + número, só dígitos.
// "(62) 99999-8888" e "062 99999-8888" viram 5562999998888. Devolve '' se inválido.
export const normalizarWpp = (v) => {
    let d = soDigitos(v).replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return d.length >= 12 && d.length <= 15 ? d : '';
};

// ---- ponte com o cadastro de produto (admin.js) ----
// O produto guarda a CHAVE da categoria; o dono enxerga o NOME. Sem esta
// tradução, renomear "Frutas" para "Frutas Frescas" e digitar o nome novo no
// produto criava uma aba solta, fora da ordem, que não ocultava nem roteava.
export const chaveDaCategoria = (texto) => {
    const t = String(texto || '').trim().replace(/\s+/g, ' ');
    const c = S.cats.find((x) => norm(x.chave) === norm(t)) || S.cats.find((x) => norm(x.nome) === norm(t));
    return c ? c.chave : t;
};
export const nomeDaCategoria = (chave) => {
    const c = S.cats.find((x) => norm(x.chave) === norm(chave));
    return c ? (c.nome || c.chave) : String(chave || '');
};
const fmtTel = (d) => { const t = soDigitos(d); return t.length >= 12 ? `+${t.slice(0, 2)} (${t.slice(2, 4)}) ${t.slice(4, -4)}-${t.slice(-4)}` : t; };

const contarProdutos = () => {
    const m = new Map();
    S.getProdutos().forEach((p) => { const k = norm(p.cat); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
};

// ------------------------------------------------------------------ dados
const salvarNumeros = (lista) => setDoc(tdoc('loja', 'config'), { numeros: lista }, { merge: true });

const reordenar = async (ids) => {
    const b = writeBatch(db);
    ids.forEach((id, i) => b.update(tdoc('categorias', id), { ordem: (i + 1) * 10 }));
    await b.commit();
};

const tentar = async (fn, msgErro = 'Não foi possível salvar.') => {
    try { await fn(); } catch (e) {
        console.error(e);
        showToast(e && e.code === 'permission-denied' ? 'Sem permissão para salvar. Publique as regras novas do Firestore.' : msgErro, true);
        render(true);
    }
};

// ------------------------------------------------------------------ ações
const adicionar = () => tentar(async () => {
    const campo = document.getElementById('cat-novo-nome');
    const nome = campo.value.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!nome) return showToast('Digite o nome da categoria.', true);
    const id = slug(nome);
    if (S.cats.some((c) => c.id === id || norm(c.chave) === norm(nome))) return showToast('Essa categoria já existe.', true);
    const ordem = (Math.max(0, ...S.cats.map((c) => Number(c.ordem) || 0)) || 0) + 10;
    campo.value = ''; campo.blur();      // tira o foco: com foco no campo a lista não era redesenhada
    await setDoc(tdoc('categorias', id), { chave: nome.toLowerCase(), nome, ordem, visivel: true, wppId: '' });
    showToast(`"${nome}" criada. Aparece na loja assim que tiver um produto nela.`);
    render(true);
});

const importar = () => tentar(async () => {
    const conhecidas = new Set(S.cats.map((c) => norm(c.chave)));
    const novas = new Map();
    S.getProdutos().forEach((p) => { const k = norm(p.cat); if (k && !conhecidas.has(k) && !novas.has(k)) novas.set(k, String(p.cat).trim()); });
    if (!novas.size) return showToast('Todas as categorias dos produtos já estão cadastradas.');
    const b = writeBatch(db);
    let ordem = Math.max(0, ...S.cats.map((c) => Number(c.ordem) || 0));
    const usados = new Set(S.cats.map((c) => c.id));     // nunca grava por cima de uma categoria existente
    [...novas.values()].sort((a, c) => a.localeCompare(c, 'pt-BR')).forEach((chave) => {
        ordem += 10;
        const nome = chave.charAt(0).toUpperCase() + chave.slice(1);
        let id = slug(chave), n = 2;
        while (usados.has(id)) id = `${slug(chave)}-${n++}`;
        usados.add(id);
        b.set(tdoc('categorias', id), { chave, nome, ordem, visivel: true, wppId: '' });
    });
    await b.commit();
    showToast(`${novas.size} categoria(s) importada(s).`);
    render(true);
});

const renomear = (id, valor) => tentar(async () => {
    const nome = valor.trim().replace(/\s+/g, ' ').slice(0, 40);
    const atual = S.cats.find((c) => c.id === id);
    if (!atual || !nome || nome === atual.nome) return render();
    await updateDoc(tdoc('categorias', id), { nome });
    showToast('Nome atualizado na loja.');
});

const alternar = (id, visivel) => tentar(async () => {
    await updateDoc(tdoc('categorias', id), { visivel });
    const c = S.cats.find((x) => x.id === id);
    const n = c ? (contarProdutos().get(norm(c.chave)) || 0) : 0;
    showToast(visivel ? `Voltou para a loja${n ? ` com ${n} produto(s)` : ''}.` : `Oculta: ${n} produto(s) saíram da loja.`);
});

const mover = (id, delta) => tentar(async () => {
    const ids = S.cats.map((c) => c.id);
    const i = ids.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reordenar(ids);
});

const trocarNumero = (id, wppId) => tentar(async () => {
    await updateDoc(tdoc('categorias', id), { wppId });
    showToast('Número da categoria atualizado.');
});

const apagar = (id) => tentar(async () => {
    const c = S.cats.find((x) => x.id === id);
    if (!c) return;
    const n = contarProdutos().get(norm(c.chave)) || 0;
    const aviso = n
        ? `"${c.nome}" tem ${n} produto(s). Se apagar, eles continuam na loja, mas numa aba solta (sem ordem, sem ocultar e sem número próprio). Para só tirar da loja, use "Visível". Apagar mesmo?`
        : `Apagar a categoria "${c.nome}"?`;
    if (!(await customConfirm('Apagar categoria', aviso))) return;
    await deleteDoc(tdoc('categorias', id));
    showToast('Categoria apagada.');
});

const adicionarNumero = () => tentar(async () => {
    if (!S.configPronta) return showToast('Ainda carregando os números. Tente de novo em um instante.', true);
    const cNome = document.getElementById('wpp-novo-nome'), cNum = document.getElementById('wpp-novo-numero');
    const nome = cNome.value.trim().slice(0, 40);
    const numero = normalizarWpp(cNum.value);
    if (!nome) return showToast('Dê um nome ao número (ex.: Artesanais).', true);
    if (!numero) return showToast('Número inválido. Digite com DDD, ex.: 62 99999-8888.', true);
    if (numero === normalizarWpp(S.padrao) || S.numeros.some((n) => n.numero === numero)) return showToast('Esse número já está cadastrado.', true);
    cNome.value = ''; cNum.value = ''; cNum.blur(); cNome.blur();
    await salvarNumeros([...S.numeros, { id: 'n' + Date.now().toString(36), nome, numero }]);
    showToast(`"${nome}" cadastrado. Agora escolha-o nas categorias acima.`);
    render(true);
});

// Corrigir nome ou número sem apagar (apagar desfazia o vínculo com as categorias)
const editarNumero = (id, campo, valor) => tentar(async () => {
    const atual = S.numeros.find((x) => x.id === id);
    if (!atual) return;
    const novo = { ...atual };
    if (campo === 'nome') {
        novo.nome = String(valor).trim().slice(0, 40);
        if (!novo.nome || novo.nome === atual.nome) return render(true);
    } else {
        novo.numero = normalizarWpp(valor);
        if (!novo.numero) { showToast('Número inválido. Digite com DDD, ex.: 62 99999-8888.', true); return render(true); }
        if (novo.numero === atual.numero) return render(true);
        if (novo.numero === normalizarWpp(S.padrao) || S.numeros.some((n) => n.id !== id && n.numero === novo.numero)) { showToast('Esse número já está cadastrado.', true); return render(true); }
    }
    await salvarNumeros(S.numeros.map((n) => (n.id === id ? novo : n)));
    showToast('Número atualizado.');
    render(true);
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
    usadas.forEach((c) => b.update(tdoc('categorias', c.id), { wppId: '' }));
    b.set(tdoc('loja', 'config'), { numeros: S.numeros.filter((x) => x.id !== id) }, { merge: true });
    await b.commit();
    showToast('Número removido.');
});

// ------------------------------------------------------------------ tela
const opcoesNumero = (sel) => `<option value="">Número padrão${S.padrao ? ` (${escapeHTML(fmtTel(S.padrao))})` : ''}</option>`
    + S.numeros.map((n) => `<option value="${escapeHTML(n.id)}" ${n.id === sel ? 'selected' : ''}>${escapeHTML(n.nome)} — ${escapeHTML(fmtTel(n.numero))}</option>`).join('');

const linhaCategoria = (c, i, total, qtd) => `
    <article class="cg-item ${c.visivel === false ? 'cg-oculta' : ''}" data-id="${escapeHTML(c.id)}">
        <div class="cg-topo">
            <div class="cg-setas">
                <button type="button" data-cg="subir" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${escapeHTML(c.nome || c.chave)}">▲</button>
                <button type="button" data-cg="descer" ${i === total - 1 ? 'disabled' : ''} aria-label="Descer ${escapeHTML(c.nome || c.chave)}">▼</button>
            </div>
            <input class="cg-nome" type="text" value="${escapeHTML(c.nome || c.chave)}" maxlength="40" aria-label="Nome da categoria" data-cg="nome">
            <button type="button" class="cg-apagar" data-cg="apagar" aria-label="Apagar categoria"><i class="ic" data-i="lixeira"></i></button>
        </div>
        <div class="cg-base">
            <label class="cg-chave"><input type="checkbox" data-cg="visivel" ${c.visivel === false ? '' : 'checked'}> <span>${c.visivel === false ? 'Oculta na loja' : 'Visível na loja'}</span></label>
            <span class="cg-qtd">${qtd} produto${qtd === 1 ? '' : 's'}</span>
        </div>
        <label class="cg-wpp"><i class="ic" data-i="enviar"></i> Pedidos desta categoria vão para
            <select data-cg="wpp">${opcoesNumero(c.wppId)}</select>
        </label>
    </article>`;

function render(forcar = false) {
    const el = document.getElementById('categorias-conteudo');
    if (!el) return;
    // não redesenha enquanto a pessoa digita num campo da própria aba
    if (!forcar && el.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.dataset.cg !== 'visivel') return;

    const qtd = contarProdutos();
    const conhecidas = new Set(S.cats.map((c) => norm(c.chave)));
    const soltas = new Set(); S.getProdutos().forEach((p) => { const k = norm(p.cat); if (k && !conhecidas.has(k)) soltas.add(k); });

    el.innerHTML = `
        <h3 class="cg-titulo">Categorias da Loja</h3>
        <p class="config-sub">Crie, renomeie, reordene e oculte abas. A loja do cliente muda na hora.</p>
        ${S.erro ? `<div class="cg-aviso cg-aviso--erro"><i class="ic" data-i="alerta"></i> Não consegui ler as categorias${S.erro === 'permission-denied' ? ': as regras novas do Firestore (coleção <b>categorias</b>) ainda não foram publicadas' : ''}. Enquanto isso, nada aqui é salvo.</div>` : ''}
        <button type="button" class="cg-atalho" data-cg="ir-numeros"><i class="ic" data-i="enviar"></i> Números de WhatsApp (${S.numeros.length + (S.padrao ? 1 : 0)}) — ver / cadastrar ↓</button>

        <div class="cg-novo">
            <input id="cat-novo-nome" type="text" maxlength="40" placeholder="Nova categoria (ex.: Produtos Artesanais)" aria-label="Nome da nova categoria">
            <button type="button" id="cat-btn-add" class="btn-salvar-config">+ Criar</button>
        </div>
        ${soltas.size ? `<div class="cg-aviso"><i class="ic" data-i="baixar"></i> ${soltas.size} categoria(s) dos seus produtos ainda não estão cadastradas aqui.
            <button type="button" id="cat-btn-importar">Importar agora</button></div>` : ''}

        <div class="cg-lista">${S.cats.length
            ? S.cats.map((c, i) => linhaCategoria(c, i, S.cats.length, qtd.get(norm(c.chave)) || 0)).join('')
            : '<p class="cg-vazio">Nenhuma categoria cadastrada ainda. Enquanto estiver vazio, a loja usa as categorias dos produtos, como sempre.</p>'}</div>

        <h3 class="cg-titulo cg-titulo2" id="cg-numeros">Números de WhatsApp</h3>
        <p class="config-sub">Cada categoria manda o pedido para um número. O que não tiver número próprio vai para o <b>número padrão</b>${S.padrao ? ` (<b>${escapeHTML(fmtTel(S.padrao))}</b>)` : ''}, que se troca na aba <i class="ic" data-i="ajustes"></i> Configurações.</p>
        <div class="cg-lista">${S.numeros.map((n) => `
            <article class="cg-item cg-num" data-nid="${escapeHTML(n.id)}">
                <div class="cg-topo">
                    <div class="cg-num-info">
                        <input class="cg-nome" type="text" maxlength="40" value="${escapeHTML(n.nome)}" data-cg="num-nome" aria-label="Nome do número">
                        <input class="cg-tel" type="tel" inputmode="tel" value="${escapeHTML(fmtTel(n.numero))}" data-cg="num-numero" aria-label="Número de WhatsApp de ${escapeHTML(n.nome)}">
                    </div>
                    <button type="button" class="cg-apagar" data-cg="rm-num" aria-label="Remover o número ${escapeHTML(n.nome)}"><i class="ic" data-i="lixeira"></i></button>
                </div>
                <small>${S.cats.filter((c) => c.wppId === n.id).map((c) => escapeHTML(c.nome)).join(', ') || 'Nenhuma categoria usa este número ainda. Escolha-o numa categoria acima.'}</small>
            </article>`).join('') || '<p class="cg-vazio">Nenhum número extra. Hoje todos os pedidos vão para o número padrão.</p>'}</div>
        <div class="cg-novo cg-novo--num">
            <input id="wpp-novo-nome" type="text" maxlength="40" placeholder="Nome (ex.: Artesanais)" aria-label="Nome do número">
            <input id="wpp-novo-numero" type="tel" inputmode="tel" placeholder="62 99999-8888" aria-label="Número com DDD">
            <button type="button" id="wpp-btn-add" class="btn-salvar-config">+ Cadastrar número</button>
        </div>`;

    // sugestões no campo "Classificação" do cadastro de produto
    let dl = document.getElementById('lista-categorias-admin');
    if (!dl) { document.body.insertAdjacentHTML('beforeend', '<datalist id="lista-categorias-admin"></datalist>'); dl = document.getElementById('lista-categorias-admin'); }
    dl.innerHTML = S.cats.map((c) => `<option value="${escapeHTML(c.nome || c.chave)}"></option>`).join('');
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
        else if (alvo.dataset.cg === 'ir-numeros') document.getElementById('cg-numeros')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    el.addEventListener('change', (e) => {
        const id = e.target.closest('[data-id]')?.dataset.id;
        if (e.target.dataset.cg === 'nome') renomear(id, e.target.value);
        else if (e.target.dataset.cg === 'visivel') alternar(id, e.target.checked);
        else if (e.target.dataset.cg === 'wpp') trocarNumero(id, e.target.value);
        else if (e.target.dataset.cg === 'num-nome') editarNumero(e.target.closest('[data-nid]').dataset.nid, 'nome', e.target.value);
        else if (e.target.dataset.cg === 'num-numero') editarNumero(e.target.closest('[data-nid]').dataset.nid, 'numero', e.target.value);
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.target.id === 'cat-novo-nome') adicionar();
        else if (e.target.id === 'wpp-novo-numero') adicionarNumero();
        else if (e.target.id === 'wpp-novo-nome') document.getElementById('wpp-novo-numero')?.focus();
        else if (/^(nome|num-nome|num-numero)$/.test(e.target.dataset.cg || '')) e.target.blur();
    });
}

/** Liga as assinaturas em tempo real. Pode ser chamada de novo a cada login:
 *  as anteriores são desligadas antes (antes, um segundo login deixava a aba
 *  sem atualizar — os botões pareciam mortos). */
export const iniciarCategoriasAdmin = (getProdutos) => {
    desligar.forEach((u) => { try { u(); } catch (_) { /* já desligada */ } });
    S.getProdutos = getProdutos || S.getProdutos;
    S.configPronta = false;
    const u1 = onSnapshot(tcol('categorias'), (snap) => {
        S.cats = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
            .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
        S.erro = '';
        render();
    }, (e) => { console.error('categorias:', e); S.erro = (e && e.code) || 'erro'; render(true); });
    const u2 = onSnapshot(tdoc('loja', 'config'), (snap) => {
        const d = snap.exists() ? snap.data() : {};
        S.padrao = soDigitos(d.wpp);
        S.numeros = (Array.isArray(d.numeros) ? d.numeros : []).filter((n) => n && n.id).map((n) => ({ id: String(n.id), nome: String(n.nome || ''), numero: soDigitos(n.numero) }));
        S.configPronta = true;
        render();
    }, (e) => console.error('config:', e));
    desligar = [u1, u2];
    return desligar;
};

/** Ao abrir a aba. */
export const abrirCategorias = () => { ligarEventos(); render(); };
