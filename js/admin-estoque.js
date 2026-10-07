// =====================================================================
//  js/admin-estoque.js — aba "📦 Estoque" do painel.
//
//  Mostra quanto tem de cada produto, se está abaixo do mínimo e quanto
//  comprar. Cada mudança (entrada, perda, contagem) passa pelo servidor
//  (/api/estoque), que grava o produto e o histórico juntos.
//
//  A sugestão de compra junta o cadastro (mínimo e ideal) com o motor de
//  demanda (o que ele prevê para os próximos 7 dias). Regras em estoque-lib.js.
// =====================================================================
import { auth, getDoc, getDocs, query, where, orderBy, limit, setDoc } from './firebase.js';
import { tcol, tdoc } from './tenant.js';
import { lerPainel } from './painel-cache.js';
import { escapeHTML, fmt, showToast, openModal, closeModal } from './utils.js';
import { numeroDeCampo } from './aparencia-lib.js';
import { temControle, situacao, sugestaoCompra, fmtQtd, ROTULO_TIPO, MOTIVOS_PERDA, custoDaFicha, margem, UNIDADES_RECEITA, paraEstoque, taxasDePerda, comFolgaDePerda } from './estoque-lib.js';

const S = { produtos: [], filtro: 'todos', busca: '', previsto: null, previstoEm: 0, perdas: null, perdasEm: 0, ligado: false, acao: null };
const mapaProdutos = () => new Map(S.produtos.map((p) => [p.id, p]));
const pctBonito = (x) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const el = () => document.getElementById('estoque-conteudo');
const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CHIP = { 'sem-controle': ['Sem controle', 'neutro'], zerado: ['Zerado', 'ruim'], baixo: ['Abaixo do mínimo', 'alerta'], ok: ['Em dia', 'bom'], sobrando: ['Acima do máximo', 'neutro'] };

async function api(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/estoque', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não foi possível registrar.');
    return j;
}
/** Usado também pelo cadastro de produto (admin.js) para que a mudança entre no histórico. */
export const contarEstoque = (produtoId, contagem, obs = '') => api({ acao: 'movimentar', produtoId, tipo: 'ajuste', contagem, obs, chave: novaChave() });
const novaChave = () => (crypto.randomUUID ? crypto.randomUUID() : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

// Previsão do motor (1 chamada, guardada por 10 min). Se falhar, a aba funciona só com mínimo e ideal.
async function carregarPrevisao() {
    if (S.previsto && Date.now() - S.previstoEm < 600000) return;
    try {
        const j = await lerPainel(); if (!j.produtos) return;
        const m = {};
        for (const [id, p] of Object.entries(j.produtos)) { const h = p.horizontes && p.horizontes.prox7; if (h && h.recomendacao) m[id] = { alvo: h.recomendacao.sugestao, vende: h.previsto }; }
        S.previsto = m; S.previstoEm = Date.now(); render();
    } catch (_) { /* sem previsão: segue */ }
}

// Desperdício: lê só 2 documentos (resumo deste mês e do anterior), guardados por 10 min.
async function carregarPerdas() {
    if (S.perdas && Date.now() - S.perdasEm < 600000) return;
    try {
        const agora = new Date(Date.now() - 3 * 3600000), mes = agora.toISOString().slice(0, 7);
        const ant = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
        const docs = await Promise.all([mes, ant].map((m) => getDoc(tdoc('estoque_resumo', m))));
        S.perdas = taxasDePerda(docs.filter((d) => d.exists()).map((d) => d.data())); S.perdasEm = Date.now(); render();
    } catch (_) { /* sem resumo: a aba funciona sem a folga de perda */ }
}

const linhaDe = (p) => {
    const sit = situacao(p), pv = S.previsto && S.previsto[p.id], perda = S.perdas && S.perdas[p.id];
    const sug = sugestaoCompra({ atual: p.estoqueFisico, min: p.estoqueMin, ideal: p.estoqueIdeal, previsto: pv ? pv.alvo : null, unidade: p.unidade });
    if (sug.comprar > 0 && perda && perda.taxa) {
        const comFolga = comFolgaDePerda(sug.comprar, perda.taxa, p.unidade);
        if (comFolga > sug.comprar) { sug.comprar = comFolga; sug.motivo += ', com folga para a perda'; }
    }
    const ficha = p.ficha ? custoDaFicha(p.ficha, mapaProdutos()) : null;
    return { p, sit, pv, sug, perda, ficha };
};

function render() {
    if (!el()) return;
    const todas = S.produtos.map(linhaDe);
    const n = (f) => todas.filter(f).length;
    const termo = norm(S.busca);
    const filtro = { todos: () => true, comprar: (l) => l.sug.comprar > 0, baixo: (l) => l.sit === 'baixo' || l.sit === 'zerado', sem: (l) => l.sit === 'sem-controle' }[S.filtro];
    const lista = todas.filter(filtro).filter((l) => !termo || norm(l.p.nome).includes(termo))
        .sort((a, b) => (b.sug.comprar > 0) - (a.sug.comprar > 0) || String(a.p.nome).localeCompare(String(b.p.nome), 'pt-BR'));
    const chip = (k, rot, q) => `<button class="es-chip${S.filtro === k ? ' on' : ''}" data-es-filtro="${k}">${rot}${q != null ? ` <b>${q}</b>` : ''}</button>`;

    el().innerHTML = `
    <div class="es-topo">
        <div><h3>Estoque</h3><p class="config-sub">Quanto tem, o que está acabando e quanto comprar.</p></div>
        <button class="btn-outline es-hist-geral" data-es-acao="historico">Histórico</button>
    </div>
    <div class="es-filtros">
        ${chip('todos', 'Todos', todas.length)}${chip('comprar', 'Comprar', n((l) => l.sug.comprar > 0))}${chip('baixo', 'Acabando', n((l) => l.sit === 'baixo' || l.sit === 'zerado'))}${chip('sem', 'Sem controle', n((l) => l.sit === 'sem-controle'))}
    </div>
    <input type="search" id="es-busca" class="es-busca" placeholder="Buscar produto..." value="${escapeHTML(S.busca)}" aria-label="Buscar produto">
    <div class="es-lista">${lista.length ? lista.map(({ p, sit, pv, sug, perda, ficha }) => `
        <article class="es-item es-${CHIP[sit][1]}">
            <div class="es-cab">
                <strong>${escapeHTML(p.nome)}</strong>
                <span class="es-sit">${CHIP[sit][0]}</span>
            </div>
            ${sit === 'sem-controle'
                ? `<p class="es-nota">Este produto não tem estoque controlado. Faça uma contagem para começar.</p>`
                : `<p class="es-qtd">${fmtQtd(p.estoqueFisico, p.unidade)}</p>
                   <p class="es-nota">${[temControle(p.estoqueMin) && `mínimo ${fmtQtd(p.estoqueMin, p.unidade)}`, temControle(p.estoqueIdeal) && `ideal ${fmtQtd(p.estoqueIdeal, p.unidade)}`, pv && `previsão de 7 dias: ${fmtQtd(pv.vende, p.unidade)}`].filter(Boolean).join(' · ') || 'Sem mínimo e ideal definidos'}</p>`}
            ${perda ? `<p class="es-nota es-perda">${perda.taxa !== null ? `Perde ${pctBonito(perda.taxa)} do que entra` : `Perdeu ${fmtQtd(perda.perdeu, p.unidade)}`}${perda.valor ? ` (${fmt(perda.valor)} nos últimos 2 meses)` : ''}</p>` : ''}
            ${(() => { const m = margem(p.preco, p.custo); return m && !p.soInsumo ? `<p class="es-nota">Custo ${fmt(p.custo)} · margem <b class="${m.pct < 0 ? 'es-neg' : ''}">${pctBonito(m.pct)}</b></p>` : (p.soInsumo ? '<p class="es-nota">Só ingrediente (não aparece na loja)</p>' : ''); })()}
            ${sug.comprar > 0 ? `<p class="es-comprar">${p.ficha ? 'Produzir' : 'Comprar'} ${fmtQtd(sug.comprar, p.unidade)} <small>${sug.motivo}</small></p>` : ''}
            <div class="es-acoes">
                ${sit === 'sem-controle' ? '' : `<button data-es-acao="compra" data-id="${escapeHTML(p.id)}">Entrada</button><button data-es-acao="perda" data-id="${escapeHTML(p.id)}">Perda</button>`}
                <button data-es-acao="ajuste" data-id="${escapeHTML(p.id)}">Contar</button>
                <button data-es-acao="limites" data-id="${escapeHTML(p.id)}">Limites</button>
                <button data-es-acao="ficha" data-id="${escapeHTML(p.id)}">Ficha</button>
                ${ficha && ficha.valida ? `<button class="es-forte" data-es-acao="produzir" data-id="${escapeHTML(p.id)}">Produzir</button>` : ''}
                <button data-es-acao="historico" data-id="${escapeHTML(p.id)}">Histórico</button>
            </div>
        </article>`).join('') : '<p class="config-sub">Nenhum produto neste filtro.</p>'}
    </div>`;
}

// ---------------------------------------------------------------- formulário (um modal para todas as ações)
function garantirModal() {
    if ($('modal-estoque')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-estoque" role="dialog" aria-modal="true" aria-labelledby="es-m-titulo">
        <div class="modal">
            <header class="modal-head"><h2 id="es-m-titulo"></h2><button class="btn-fechar" data-fechar="modal-estoque" aria-label="Fechar">&times;</button></header>
            <div class="modal-body" id="es-m-corpo"></div>
            <footer class="modal-footer" id="es-m-rodape"><button class="btn-salvar-config" id="es-m-gravar">Gravar</button></footer>
        </div>
    </div>`);
    $('es-m-gravar').addEventListener('click', gravar);
}
const campo = (id, rot, attrs = '', dica = '') => `<div class="form-group"><label for="${id}">${rot}</label><input id="${id}" ${attrs}>${dica ? `<small class="dica-campo">${dica}</small>` : ''}</div>`;
const numero = (id) => { const v = String($(id)?.value || '').replace(',', '.').trim(); return v === '' ? null : Number(v); };

function abrirAcao(tipo, p) {
    if (tipo === 'ficha') return abrirFicha(p);
    if (tipo === 'produzir') return abrirProduzir(p);
    garantirModal(); S.acao = { tipo, p, chave: novaChave() };
    $('es-m-gravar').textContent = 'Gravar'; $('es-m-corpo').oninput = null; $('es-m-corpo').onchange = null; $('es-m-corpo').onclick = null;
    const un = escapeHTML(p.unidade || 'un'), tem = temControle(p.estoqueFisico) ? `Tem agora: <b>${fmtQtd(p.estoqueFisico, p.unidade)}</b>` : 'Ainda sem estoque controlado.';
    const dec = 'type="text" inputmode="decimal" autocomplete="off"';
    const T = { compra: 'Entrada de', perda: 'Perda de', ajuste: 'Contar', limites: 'Limites de' }[tipo];
    $('es-m-titulo').textContent = `${T} ${p.nome}`;
    $('es-m-rodape').hidden = false;
    $('es-m-corpo').innerHTML = `<p class="config-sub">${tem}</p>` + (
        tipo === 'compra' ? campo('es-qtd', `Quanto entrou (${un})`, dec) + campo('es-custo', `Quanto pagou por ${un} (opcional)`, dec, p.custo ? `Último custo: ${fmt(p.custo)}` : 'Serve para calcular margem e o valor das perdas.') + campo('es-obs', 'Observação (opcional)', 'type="text" maxlength="140" placeholder="Ex.: Ceasa, fornecedor João"')
        : tipo === 'perda' ? campo('es-qtd', `Quanto perdeu (${un})`, dec) + `<div class="form-group"><label for="es-motivo">Motivo</label><select id="es-motivo">${MOTIVOS_PERDA.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}</select></div>` + campo('es-obs', 'Observação (opcional)', 'type="text" maxlength="140"')
        : tipo === 'ajuste' ? campo('es-contagem', `Quanto tem de verdade (${un})`, dec, 'Conte na banca e digite o total. O sistema calcula a diferença e guarda no histórico.')
        : campo('es-min', `Mínimo (${un})`, `${dec} value="${numeroDeCampo(p.estoqueMin)}"`, 'Abaixo disso, o produto aparece em "Comprar".') + campo('es-ideal', `Ideal (${un})`, `${dec} value="${numeroDeCampo(p.estoqueIdeal)}"`, 'Até quanto comprar para ficar tranquilo.') + campo('es-max', `Máximo (${un}, opcional)`, `${dec} value="${numeroDeCampo(p.estoqueMax)}"`, 'Acima disso tende a sobrar e estragar.') + campo('es-prazo', 'Dias até a compra chegar (opcional)', `type="text" inputmode="numeric" autocomplete="off" value="${numeroDeCampo(p.prazoDias)}"`, 'Para fornecedor que entrega depois: a lista de compras soma o que vende nesse intervalo.') + campo('es-custo', `Custo por ${un} (opcional)`, `${dec} value="${numeroDeCampo(p.custo)}"`));
    openModal('modal-estoque');
}

async function gravar() {
    const a = S.acao; if (!a) return;
    const b = $('es-m-gravar'); if (b.disabled) return;
    if (a.tipo === 'ficha') return gravarFicha(a, b);
    if (a.tipo === 'produzir') return gravarProducao(a, b);
    try {
        if (a.tipo === 'limites') {
            const min = numero('es-min'), ideal = numero('es-ideal'), max = numero('es-max'), custo = numero('es-custo'), prazoDias = numero('es-prazo');
            if (prazoDias !== null && !(Number.isInteger(prazoDias) && prazoDias >= 0 && prazoDias <= 30)) throw new Error('O prazo é em dias inteiros, de 0 a 30.');
            for (const v of [min, ideal, max, custo]) if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error('Use só números, zero ou maiores.');
            if (min !== null && ideal !== null && ideal < min) throw new Error('O ideal precisa ser maior ou igual ao mínimo.');
            if (max !== null && ideal !== null && max < ideal) throw new Error('O máximo precisa ser maior ou igual ao ideal.');
            b.disabled = true;
            await setDoc(tdoc('produtos', a.p.id), { estoqueMin: min, estoqueIdeal: ideal, estoqueMax: max, prazoDias }, { merge: true });
            if (custo !== (a.p.custo ?? null)) await setDoc(tdoc('produtos_custos', a.p.id), { custo }, { merge: true });      // custo é privado
            showToast('Limites gravados.');
        } else {
            const corpo = { acao: 'movimentar', produtoId: a.p.id, tipo: a.tipo, chave: a.chave, obs: $('es-obs')?.value || '' };
            if (a.tipo === 'ajuste') { corpo.contagem = numero('es-contagem'); if (corpo.contagem === null) throw new Error('Digite quanto tem.'); }
            else { corpo.qtd = numero('es-qtd'); if (!(corpo.qtd > 0)) throw new Error('Digite a quantidade.'); }
            if (a.tipo === 'perda') corpo.motivo = $('es-motivo').value;
            if (a.tipo === 'compra') corpo.custoUnit = numero('es-custo');
            b.disabled = true;
            const r = await api(corpo);
            showToast(r.semMudanca ? 'A contagem bateu com o sistema. Nada mudou.' : `Registrado. Agora tem ${fmtQtd(r.saldo, a.p.unidade)}.`);
        }
        closeModal('modal-estoque'); if (history.state && history.state.modal === 'modal-estoque') history.back();
    } catch (e) { showToast(e.message || 'Não consegui gravar.', true); }
    finally { b.disabled = false; }
}

// ---------------------------------------------------------------- ficha técnica
const fatoresDe = (un) => UNIDADES_RECEITA[String(un || '').toLowerCase()] || null;
const linhaFichaHtml = (item, p, n) => {
    const ing = S.produtos.find((x) => x.id === item.id), fat = fatoresDe(ing && ing.unidade);
    // mostra em gramas/ml quando a quantidade é pequena (0,15 kg → 150 g)
    // a quantidade gravada é conferida: só número vai para o campo (o que está no banco pode ter sido escrito por fora da tela)
    const qtdN = Number.isFinite(Number(item.qtd)) && typeof item.qtd !== 'object' ? Number(item.qtd) : 0;
    const emPequeno = fat && qtdN > 0 && qtdN < 1, valor = qtdN ? (emPequeno ? Math.round(qtdN * 1000 * 100) / 100 : qtdN) : '';
    const opcoes = S.produtos.filter((x) => x.id !== p.id).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
        .map((x) => `<option value="${escapeHTML(x.id)}"${x.id === item.id ? ' selected' : ''}>${escapeHTML(x.nome)}</option>`).join('');
    return `<div class="fi-linha" data-n="${escapeHTML(n)}">
        <select class="fi-prod" aria-label="Ingrediente"><option value="">Ingrediente</option>${opcoes}</select>
        <input class="fi-qtd" type="text" inputmode="decimal" autocomplete="off" value="${String(valor).replace('.', ',')}" aria-label="Quantidade" placeholder="Qtd">
        ${fat ? `<select class="fi-un" aria-label="Unidade">${fat.map(([r, f]) => `<option value="${f}"${(emPequeno ? f < 1 : f === 1) ? ' selected' : ''}>${r}</option>`).join('')}</select>` : `<span class="fi-un-fixa">${escapeHTML((ing && ing.unidade) || '')}</span>`}
        <button type="button" class="fi-tirar" aria-label="Tirar ingrediente">&times;</button>
    </div>`;
};
const lerFicha = () => {
    const txt = (el) => { const v = String(el?.value || '').replace(',', '.').trim(); return v === '' ? null : Number(v); };
    const itens = [...document.querySelectorAll('#fi-linhas .fi-linha')].map((l) => {
        const id = l.querySelector('.fi-prod').value, q = txt(l.querySelector('.fi-qtd')), f = Number(l.querySelector('.fi-un')?.value || 1);
        return { id, qtd: q === null ? 0 : paraEstoque(q, f) };
    }).filter((i) => i.id);
    return { rende: txt($('fi-rende')), validadeDias: txt($('fi-validade')), itens };
};
function pintarCustoFicha(p) {
    const f = lerFicha(), c = custoDaFicha(f, mapaProdutos()), alvo = $('fi-custo'); if (!alvo) return;
    if (!c.valida) { alvo.innerHTML = '<p class="es-nota">Preencha quanto a receita rende e os ingredientes para ver o custo.</p>'; return; }
    const m = c.completo ? margem(p.preco, c.porUnidade) : null;
    alvo.innerHTML = `
        <ul class="fi-contas">${c.linhas.map((l) => `<li><span>${escapeHTML(l.nome)} · ${fmtQtd(l.qtd, l.unidade)}</span><b>${l.custo === null ? 'sem custo' : fmt(l.qtd * l.custo)}</b></li>`).join('')}</ul>
        <p class="fi-total"><span>Custo da receita</span><b>${fmt(c.total)}${c.completo ? '' : ' +'}</b></p>
        <p class="fi-total"><span>Custo por unidade (rende ${c.rende})</span><b>${fmt(c.porUnidade)}${c.completo ? '' : ' +'}</b></p>
        ${m ? `<p class="fi-total"><span>Margem vendendo a ${fmt(p.preco)}</span><b class="${m.pct < 0 ? 'es-neg' : ''}">${fmt(m.lucro)} · ${pctBonito(m.pct)}</b></p>` : ''}
        ${c.completo ? '' : `<p class="es-nota">${c.semCusto} ingrediente(s) sem custo cadastrado: o valor real é maior. Cadastre o custo em "Limites" ou numa "Entrada".</p>`}`;
}
function abrirFicha(p) {
    garantirModal(); S.acao = { tipo: 'ficha', p };
    const bruta = p.ficha && typeof p.ficha === 'object' ? p.ficha : {};
    const f = { rende: numeroDeCampo(bruta.rende), validadeDias: numeroDeCampo(bruta.validadeDias), itens: (Array.isArray(bruta.itens) ? bruta.itens : []).filter((i) => i && typeof i === 'object').slice(0, 40) };
    $('es-m-titulo').textContent = `Ficha técnica de ${p.nome}`; $('es-m-rodape').hidden = false; $('es-m-gravar').textContent = 'Gravar ficha';
    $('es-m-corpo').innerHTML = `
        <p class="config-sub">Do que este produto é feito. Com a ficha, o sistema calcula o custo e, ao produzir, baixa os ingredientes do estoque.</p>
        <div class="grid-2">
            ${campo('fi-rende', 'Uma receita rende (unidades)', `type="text" inputmode="numeric" autocomplete="off" value="${escapeHTML(f.rende === '0' ? '' : f.rende)}"`)}
            ${campo('fi-validade', 'Validade (dias, opcional)', `type="text" inputmode="numeric" autocomplete="off" value="${escapeHTML(f.validadeDias === '0' ? '' : f.validadeDias)}"`)}
        </div>
        <label class="fi-rotulo">Ingredientes de uma receita</label>
        <div id="fi-linhas">${(f.itens.length ? f.itens : [{ id: '', qtd: 0 }]).map((i, n) => linhaFichaHtml(i, p, n)).join('')}</div>
        <button type="button" class="btn-outline fi-mais" id="fi-mais">+ Ingrediente</button>
        <div id="fi-custo" class="fi-custo" aria-live="polite"></div>`;
    const corpo = $('es-m-corpo');
    corpo.oninput = () => pintarCustoFicha(p);
    corpo.onchange = (e) => {
        if (e.target.classList.contains('fi-prod')) {          // trocou o ingrediente: a unidade muda junto
            const l = e.target.closest('.fi-linha'), atual = { id: e.target.value, qtd: 0 };
            l.outerHTML = linhaFichaHtml(atual, p, l.dataset.n);
        }
        pintarCustoFicha(p);
    };
    corpo.onclick = (e) => {
        if (e.target.closest('.fi-tirar')) { e.target.closest('.fi-linha').remove(); pintarCustoFicha(p); }
        if (e.target.closest('#fi-mais')) $('fi-linhas').insertAdjacentHTML('beforeend', linhaFichaHtml({ id: '', qtd: 0 }, p, Date.now()));
    };
    pintarCustoFicha(p); openModal('modal-estoque');
}
async function gravarFicha(a, b) {
    try {
        const f = lerFicha();
        const vazia = !f.itens.length && !f.rende;
        if (!vazia) {
            if (!(f.rende > 0) || !Number.isInteger(f.rende)) throw new Error('Diga quantas unidades uma receita rende (número inteiro).');
            if (!f.itens.length) throw new Error('Inclua pelo menos um ingrediente.');
            if (f.itens.some((i) => !(i.qtd > 0))) throw new Error('Todo ingrediente precisa de quantidade maior que zero.');
            if (new Set(f.itens.map((i) => i.id)).size !== f.itens.length) throw new Error('O mesmo ingrediente aparece duas vezes.');
            if (f.validadeDias !== null && !(f.validadeDias > 0 && f.validadeDias <= 3650)) throw new Error('A validade precisa ser em dias (1 a 3650).');
        }
        b.disabled = true;
        await setDoc(tdoc('produtos_custos', a.p.id), { ficha: vazia ? null : { rende: f.rende, validadeDias: f.validadeDias, itens: f.itens } }, { merge: true });   // ficha é privada
        showToast(vazia ? 'Ficha removida.' : 'Ficha gravada.');
        closeModal('modal-estoque'); if (history.state && history.state.modal === 'modal-estoque') history.back();
    } catch (e) { showToast(e.message || 'Não consegui gravar a ficha.', true); }
    finally { b.disabled = false; }
}

// ---------------------------------------------------------------- produção
function pintarNecessidade(p) {
    const n = Number(String($('pr-unidades').value).replace(',', '.')), c = custoDaFicha(p.ficha, mapaProdutos()), alvo = $('pr-precisa');
    if (!(n > 0) || !c.valida) { alvo.innerHTML = ''; return; }
    const fator = n / c.rende; let falta = false;
    alvo.innerHTML = `<label class="fi-rotulo">Vai usar</label><ul class="fi-contas">${c.linhas.map((l) => {
        const ing = S.produtos.find((x) => x.id === l.id), precisa = Math.round(l.qtd * fator * 1000) / 1000, controla = temControle(ing.estoqueFisico), ok = !controla || Number(ing.estoqueFisico) >= precisa;
        if (!ok) falta = true;
        return `<li class="${ok ? '' : 'es-neg'}"><span>${escapeHTML(l.nome)}</span><b>${fmtQtd(precisa, l.unidade)}${controla ? ` · tem ${fmtQtd(ing.estoqueFisico, l.unidade)}` : ' · sem controle'}</b></li>`;
    }).join('')}</ul>${c.completo ? `<p class="fi-total"><span>Custo desta produção</span><b>${fmt(c.porUnidade * n)}</b></p>` : ''}${falta ? '<p class="es-nota es-neg">Falta ingrediente para essa quantidade.</p>' : ''}`;
}
function abrirProduzir(p) {
    garantirModal(); S.acao = { tipo: 'produzir', p, chave: novaChave() };
    $('es-m-titulo').textContent = `Produzir ${p.nome}`; $('es-m-rodape').hidden = false; $('es-m-gravar').textContent = 'Registrar produção';
    $('es-m-corpo').innerHTML = `${campo('pr-unidades', 'Quantas unidades você produziu', 'type="text" inputmode="numeric" autocomplete="off"')}<div id="pr-precisa" aria-live="polite"></div>`;
    $('es-m-corpo').oninput = () => pintarNecessidade(p); $('es-m-corpo').onchange = null; $('es-m-corpo').onclick = null;
    openModal('modal-estoque');
}
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
async function gravarProducao(a, b) {
    try {
        const unidades = Number(String($('pr-unidades').value).replace(',', '.'));
        if (!Number.isInteger(unidades) || unidades < 1) throw new Error('Digite quantas unidades produziu (número inteiro).');
        b.disabled = true;
        const r = await api({ acao: 'produzir', produtoId: a.p.id, unidades, chave: a.chave });
        // fica na tela o resumo do lote (é o que vai na etiqueta)
        S.acao = null; $('es-m-rodape').hidden = true; $('es-m-titulo').textContent = 'Produção registrada';
        $('es-m-corpo').oninput = null;
        $('es-m-corpo').innerHTML = `
            <div class="pr-lote">
                <strong>${escapeHTML(r.nome)}</strong>
                <span>${r.unidades} unidade(s)${r.saldo != null ? ` · agora tem ${fmtQtd(r.saldo, r.unidade)}` : ''}</span>
                <dl><dt>Lote</dt><dd>${escapeHTML(r.lote)}</dd><dt>Fabricação</dt><dd>${dataBR(r.fabricadoEm)}</dd>${r.validade ? `<dt>Validade</dt><dd>${dataBR(r.validade)}</dd>` : ''}${r.custoUn ? `<dt>Custo por unidade</dt><dd>${fmt(r.custoUn)}</dd><dt>Custo total</dt><dd>${fmt(r.custoTotal)}</dd>` : ''}</dl>
            </div>
            <div class="pr-etq"><label for="pr-etq-n">Etiquetas</label><input type="number" id="pr-etq-n" inputmode="numeric" min="1" max="200" value="${Math.min(r.unidades, 200)}"><button type="button" class="btn-outline" id="pr-etq-imprimir"><i class="ic" data-i="etiqueta"></i> Imprimir etiquetas</button></div>
            <p class="es-nota">Os ingredientes já saíram do estoque e os dados do lote ficam guardados. A etiqueta leva nome, lote, fabricação${r.validade ? ', validade' : ''} e preço.</p>`;
        $('pr-etq-imprimir').onclick = async (ev) => {
            ev.currentTarget.disabled = true;
            try { const m = await import('./admin-impressao.js'); await m.imprimirLote({ ...r, preco: a.p.preco }, $('pr-etq-n').value); }
            catch (_) { showToast('Não consegui abrir a impressão. Confira a internet.', true); }
            if ($('pr-etq-imprimir')) $('pr-etq-imprimir').disabled = false;
        };
    } catch (e) { showToast(e.message || 'Não consegui registrar a produção.', true); }
    finally { b.disabled = false; }
}

async function abrirHistorico(p) {
    garantirModal(); S.acao = null; $('es-m-corpo').oninput = null; $('es-m-corpo').onchange = null; $('es-m-corpo').onclick = null;
    $('es-m-titulo').textContent = p ? `Histórico de ${p.nome}` : 'Últimas movimentações';
    $('es-m-rodape').hidden = true;
    $('es-m-corpo').innerHTML = '<p class="config-sub">Carregando...</p>';
    openModal('modal-estoque');
    try {
        // por produto: filtro simples (não exige índice composto) e ordenação aqui mesmo
        const q = p ? query(tcol('estoque_mov'), where('produtoId', '==', p.id), limit(300)) : query(tcol('estoque_mov'), orderBy('em', 'desc'), limit(60));
        const movs = (await getDocs(q)).docs.map((d) => d.data()).sort((x, y) => (x.em < y.em ? 1 : -1)).slice(0, 60);
        $('es-m-corpo').innerHTML = movs.length ? `<ul class="es-hist">${movs.map((m) => `
            <li class="${m.qtd < 0 ? 'neg' : 'pos'}">
                <div><b>${escapeHTML(ROTULO_TIPO[m.tipo] || m.tipo)}</b>${p ? '' : ` · ${escapeHTML(m.nome)}`}${m.motivo ? ` · ${escapeHTML((MOTIVOS_PERDA.find(([v]) => v === m.motivo) || [0, m.motivo])[1])}` : ''}
                    <small>${new Date(m.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${m.obs ? ` · ${escapeHTML(m.obs)}` : ''}${m.valor && m.tipo === 'perda' ? ` · perda de ${fmt(m.valor)}` : ''}</small></div>
                <div class="es-hist-num"><b>${m.qtd > 0 ? '+' : ''}${fmtQtd(m.qtd, m.unidade)}</b><small>ficou ${fmtQtd(m.saldo, m.unidade)}</small></div>
            </li>`).join('')}</ul>` : '<p class="config-sub">Nenhuma movimentação registrada ainda.</p>';
    } catch (e) {
        $('es-m-corpo').innerHTML = `<p class="config-sub">${e && e.code === 'permission-denied' ? 'Sem permissão para ler o histórico. Publique as regras novas do Firestore.' : 'Não consegui carregar o histórico. Confira a internet.'}</p>`;
    }
}

function ligar() {
    if (S.ligado) return; S.ligado = true;
    el().addEventListener('click', (e) => {
        const f = e.target.closest('[data-es-filtro]'); if (f) { S.filtro = f.dataset.esFiltro; render(); return; }
        const a = e.target.closest('[data-es-acao]'); if (!a) return;
        const p = S.produtos.find((x) => x.id === a.dataset.id);
        if (a.dataset.esAcao === 'historico') abrirHistorico(p || null); else if (p) abrirAcao(a.dataset.esAcao, p);
    });
    el().addEventListener('input', (e) => {
        if (e.target.id !== 'es-busca') return;
        S.busca = e.target.value; const pos = e.target.selectionStart; render();
        const b = $('es-busca'); b.focus(); b.setSelectionRange(pos, pos);
    });
}

/** Previsão do motor e desperdício já carregados (a aba Compras usa os mesmos, sem ler de novo). */
export const carregarApoio = () => Promise.all([carregarPrevisao(), carregarPerdas()]);
export const apoio = () => ({ previsto: S.previsto || {}, perdas: S.perdas || {} });
export const movimentar = (corpo) => api({ acao: 'movimentar', chave: novaChave(), ...corpo });

/** Chamado ao abrir a aba e sempre que os produtos mudam com a aba aberta. */
export function abrirEstoque(produtos) {
    if (!el()) return;
    S.produtos = produtos || [];
    ligar();
    if (document.activeElement?.id !== 'es-busca') render();
    carregarPrevisao(); carregarPerdas();
}
