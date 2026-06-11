import { db, auth, collection, onSnapshot, signInAnonymously, onAuthStateChanged, doc, getDoc } from './firebase.js';
import { fmt, escapeHTML, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, openModal, closeModal, iconeCarrinhoVazio, iconeHistoricoVazio, customConfirm, dbStorage } from './utils.js';
// [FASE 3] Modularização da IA (3.06)
import { initIA } from './ia.js';

const CART_VERSION = "2.3"; 
let unsubscribes = []; 

const STATE = {
    uid: null,
    produtos: [], 
    carrinho: [], 
    catAtiva: 'todas', 
    busca: '',
    config: { minimo: 0, wpp: '5562999999999', lojaAberta: true, diasAbertos: [0,1,2,3,4,5,6] },
    favoritos: JSON.parse(localStorage.getItem('banca_favs') || '[]'),
    lojaRenderizada: false,
    checkoutSessionId: null,
    historicoChat: []
};

let inatividadeTimer;
const resetInatividadeTimer = () => {
    clearTimeout(inatividadeTimer);
    if (STATE.carrinho.length > 0 && !document.getElementById('modal-checkout')?.classList.contains('aberto') && !document.getElementById('modal-ia-chat')?.classList.contains('aberto')) {
        inatividadeTimer = setTimeout(() => {
            showToast("🤖 O assistente tem uma sugestão para o seu pedido. Que tal dar uma olhada?", false);
            const btnIA = document.getElementById('btn-ia-flutuante');
            if(btnIA) {
                btnIA.classList.add('pulse-anim');
                setTimeout(() => btnIA.classList.remove('pulse-anim'), 10000);
            }
        }, 180000); 
    }
};
['click', 'touchstart', 'scroll', 'keydown'].forEach(evt => document.addEventListener(evt, resetInatividadeTimer, { passive: true }));

const carregarCarrinhoDB = async () => {
    try { 
        const raw = await dbStorage.get('banca_cart');
        if(raw && raw.v === CART_VERSION) { 
            STATE.carrinho = raw.items; 
            renderCarrinhoCompleto(); resetInatividadeTimer();
        }
    } catch(e) {}
};
carregarCarrinhoDB(); 

let realTimeSyncIniciado = false;
onAuthStateChanged(auth, (user) => {
    if (user) {
        STATE.uid = user.uid;
        if (!realTimeSyncIniciado) { iniciarRealTimeSync(); realTimeSyncIniciado = true; }
    } else {
        unsubscribes.forEach(u => u()); unsubscribes = []; realTimeSyncIniciado = false;
        iniciarRealTimeSync(); realTimeSyncIniciado = true;
        signInAnonymously(auth).catch(e => console.warn(e));
    }
});

const syncCarrinhoComPrecosAoVivo = () => {
    if (STATE.carrinho.length === 0 || STATE.produtos.length === 0) return;
    let modificou = false; let itensRemovidos = 0;
    STATE.carrinho.forEach(itemCart => {
        const prodAoVivo = STATE.produtos.find(p => p.id === itemCart.id);
        if (prodAoVivo) {
            if (itemCart.preco !== prodAoVivo.preco) { itemCart.preco = prodAoVivo.preco; modificou = true; }
        } else { itemCart.qtd = 0; itensRemovidos++; modificou = true; }
    });
    if (modificou) {
        STATE.carrinho = STATE.carrinho.filter(i => i.qtd > 0);
        persistirCarrinhoComDebounce(); renderCarrinhoCompleto();
        if (itensRemovidos > 0) showToast(`⚠️ ${itensRemovidos} item(ns) esgotaram.`, true);
    }
};

const getCartQty = (id) => { const item = STATE.carrinho.find(x => x.id === id); return item ? item.qtd : 0; };

const atualizarBadgesDOM = (produtoId, qtd) => {
    const badge = document.getElementById(`badge-${produtoId}`);
    if(badge) {
        const prod = STATE.produtos.find(p => p.id === produtoId);
        badge.textContent = isFracionavel(prod?.unidade) && qtd > 0 ? formatarQuantidadeVisual(qtd, true) : qtd;
        if(qtd > 0) badge.classList.add('visivel'); else badge.classList.remove('visivel');
    }
};

const atualizarLinhaCarrinhoDOM = (id, novaQtd, subtotalFmt) => {
    const row = document.getElementById(`cart-row-${id}`);
    if(novaQtd <= 0) {
        if(row) row.remove();
        if(STATE.carrinho.length === 0) renderCarrinhoCompleto();
    } else {
        if(!row) { renderCarrinhoCompleto(); } 
        else {
            const input = row.querySelector('.qtd-input');
            const price = row.querySelector('.item-preco');
            const prod = STATE.produtos.find(p => p.id === id);
            if(input) input.value = formatarQuantidadeVisual(novaQtd, isFracionavel(prod?.unidade));
            if(price) price.textContent = subtotalFmt;
        }
    }
};

const atualizarRodapeCarrinhoDOM = () => {
    let total = 0;
    STATE.carrinho.forEach(item => total += (item.preco * item.qtd));
    document.getElementById('total-val').textContent = fmt(total);
    const qtdDistinta = Math.ceil(STATE.carrinho.reduce((acc, item) => acc + (isFracionavel(item.unidade) ? 1 : item.qtd), 0));
    document.getElementById('qtd-flutuante').textContent = qtdDistinta; 
    document.getElementById('qtd-badge').textContent = qtdDistinta;

    const btnF = document.getElementById('btn-abrir-checkout');
    const bannerMin = document.getElementById('banner-minimo');
    const bannerFechado = document.getElementById('banner-fechado');
    const lojaAberta = STATE.config.lojaAberta !== false; 
    const hojePermitido = (STATE.config.diasAbertos || [0,1,2,3,4,5,6]).includes(new Date().getDay());
    
    if (!lojaAberta || !hojePermitido) {
        btnF.disabled = true; btnF.textContent = "Loja Fechada";
        bannerMin.classList.remove('visivel'); bannerFechado.classList.add('visivel');
    } else { 
        bannerFechado.classList.remove('visivel'); 
        if (STATE.config.minimo > 0 && total < STATE.config.minimo && STATE.carrinho.length > 0) { 
            btnF.disabled = true; btnF.textContent = `Falta ${fmt(STATE.config.minimo - total)}`;
            bannerMin.textContent = `⚠️ Valor mínimo: ${fmt(STATE.config.minimo)}`; bannerMin.classList.add('visivel'); 
        } else { 
            btnF.disabled = STATE.carrinho.length === 0; btnF.textContent = "Finalizar Pedido";
            bannerMin.classList.remove('visivel'); 
        }
    }
    resetInatividadeTimer();
};

const renderCarrinhoCompleto = () => {
    const cont = document.getElementById('carrinho-itens');
    const placeholderSVG = `<div class="item-emoji skeleton"></div>`;
    STATE.produtos.forEach(p => {
        const badgeGrid = document.getElementById(`badge-${p.id}`);
        if(badgeGrid && getCartQty(p.id) === 0) { badgeGrid.textContent = '0'; badgeGrid.classList.remove('visivel'); }
    });
    if (STATE.carrinho.length === 0) {
        cont.innerHTML = `<div class="empty-state">${iconeCarrinhoVazio}<p>Seu pedido está vazio</p><span>Adicione produtos para começar.</span></div>`;
        atualizarRodapeCarrinhoDOM(); return;
    }
    let html = '';
    STATE.carrinho.forEach(item => {
        const sub = item.preco * item.qtd; const fracionavel = isFracionavel(item.unidade);
        html += `
        <article class="carrinho-item" id="cart-row-${item.id}">
            <div class="item-emoji">${item.foto ? `<img src="${escapeHTML(item.foto)}" loading="lazy" width="48" height="48">` : placeholderSVG}</div>
            <div class="item-meio">
                <h3 class="item-nome">${escapeHTML(item.nome)}</h3>
                <div class="qtd-ctrl">
                    <button class="btn-qtd" data-action="dec" data-id="${item.id}">−</button>
                    <input class="qtd-input" type="text" inputmode="decimal" value="${formatarQuantidadeVisual(item.qtd, fracionavel)}" data-id="${item.id}">
                    <button class="btn-qtd" data-action="inc" data-id="${item.id}">+</button>
                </div>
            </div>
            <span class="item-preco">${fmt(sub)}</span>
        </article>`;
    });
    cont.innerHTML = html; atualizarRodapeCarrinhoDOM();
};

let debounceSalvarCarrinho;
const persistirCarrinhoComDebounce = () => {
    clearTimeout(debounceSalvarCarrinho);
    debounceSalvarCarrinho = setTimeout(() => { dbStorage.set('banca_cart', {v: CART_VERSION, items: STATE.carrinho}); }, 400);
};

const modificarCarrinho = (id, delta, fixo = false) => {
    const p = STATE.produtos.find(x => x.id === id); if (!p) return;
    const fracionavel = isFracionavel(p.unidade); const step = fracionavel ? 0.1 : 1;
    let valParaAplicar = fixo ? delta : (delta > 0 ? step : -step);
    const idx = STATE.carrinho.findIndex(x => x.id === id);
    let novaQtd = 0;

    if (idx > -1) { 
        novaQtd = fixFloat(fixo ? valParaAplicar : STATE.carrinho[idx].qtd + valParaAplicar);
        if (novaQtd <= 0) STATE.carrinho.splice(idx, 1); else STATE.carrinho[idx].qtd = novaQtd;
    } else if (valParaAplicar > 0) { 
        novaQtd = fixFloat(fixo ? valParaAplicar : 1); STATE.carrinho.push({...p, qtd: novaQtd}); 
    }
    
    persistirCarrinhoComDebounce(); atualizarBadgesDOM(id, novaQtd);
    atualizarLinhaCarrinhoDOM(id, novaQtd, fmt(p.preco * novaQtd)); atualizarRodapeCarrinhoDOM();
};

const construirCardsIniciais = () => {
    const grid = document.getElementById('lista-produtos');
    const html = STATE.produtos.map(p => {
        const qtdNoCarrinho = getCartQty(p.id);
        const badgeTexto = isFracionavel(p.unidade) && qtdNoCarrinho > 0 ? formatarQuantidadeVisual(qtdNoCarrinho, true) : qtdNoCarrinho;
        const favActive = STATE.favoritos.includes(p.id) ? 'ativo' : '';
        return `
        <article class="produto-card" data-action="detalhe" data-id="${p.id}" data-cat="${escapeHTML(p.cat)}" data-nome="${p.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}" style="display: flex;">
            <div class="produto-img-wrap">
                ${p.foto ? `<img src="${escapeHTML(p.foto)}" loading="lazy" width="200" height="200">` : '<div class="produto-img-placeholder skeleton" style="width:100%;height:100%"></div>'}
                <button class="btn-fav ${favActive}" data-action="fav" data-id="${p.id}">❤️</button>
                <span class="produto-unidade-tag">${escapeHTML(p.unidade || 'un')}</span>
                <div class="card-badge ${qtdNoCarrinho > 0 ? 'visivel':''}" id="badge-${p.id}">${badgeTexto}</div>
            </div>
            <div class="produto-info">
                <span class="produto-categoria">${escapeHTML(p.cat)}</span>
                <h3 class="produto-nome">${escapeHTML(p.nome)}</h3>
                <div class="produto-preco-row">
                    <span class="produto-preco">${fmt(p.preco)}<br><span style="font-size: 0.8rem; font-weight: 600;">por ${escapeHTML(p.unidade || 'un')}</span></span>
                    <button class="btn-add" data-action="add" data-id="${p.id}">+</button>
                </div>
            </div>
        </article>`;
    }).join('');
    grid.innerHTML = html; STATE.lojaRenderizada = true;
};

const renderLoja = (forcarRebuild = false) => {
    const grid = document.getElementById('lista-produtos');
    if(!STATE.lojaRenderizada || forcarRebuild) construirCardsIniciais();
    const termo = STATE.busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const cards = grid.querySelectorAll('.produto-card');
    let itensVisiveis = 0;

    cards.forEach(card => {
        const matchBusca = card.dataset.nome.includes(termo);
        const matchCat = (STATE.catAtiva === 'todas') || (STATE.catAtiva === 'favoritos' && STATE.favoritos.includes(card.dataset.produtoId)) || (card.dataset.cat === STATE.catAtiva);
        if(matchBusca && matchCat) { card.style.display = 'flex'; itensVisiveis++; } 
        else { card.style.display = 'none'; }
    });
    const emptyId = 'empty-grid-msg'; let emptyMsg = document.getElementById(emptyId);
    if (itensVisiveis === 0) {
        if(!emptyMsg) grid.insertAdjacentHTML('beforeend', `<div id="${emptyId}" class="empty-state" style="grid-column: 1/-1;">${iconeHistoricoVazio}<p>Nenhum produto</p></div>`);
    } else if(emptyMsg) { emptyMsg.remove(); }
};

const renderCategorias = () => {
    const cats = ['todas', 'favoritos', ...new Set(STATE.produtos.map(p => p.cat))].filter(Boolean);
    document.getElementById('categorias').innerHTML = cats.map(c => `<button class="cat-btn ${c === STATE.catAtiva ? 'active' : ''}" data-action="cat" data-cat="${escapeHTML(c)}">${c === 'todas' ? 'Todos' : c === 'favoritos' ? '❤️ Favoritos' : escapeHTML(c)}</button>`).join('');
};

let buscaTimeout;
document.getElementById('busca-input').addEventListener('input', (e) => {
    clearTimeout(buscaTimeout); buscaTimeout = setTimeout(() => { STATE.busca = e.target.value; renderLoja(); }, 150);
});

const iniciarRealTimeSync = () => {
    const unsubConfig = onSnapshot(doc(db, "loja", "config"), (snap) => {
        if(snap.exists()) STATE.config = {...STATE.config, ...snap.data()}; atualizarRodapeCarrinhoDOM();
    });
    unsubscribes.push(unsubConfig);
    const unsubProdutos = onSnapshot(collection(db, "produtos"), (snap) => {
        STATE.produtos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => p.ativo);
        renderCategorias(); renderLoja(true); syncCarrinhoComPrecosAoVivo(); 
        STATE.carrinho.forEach(item => { atualizarBadgesDOM(item.id, item.qtd); });
    });
    unsubscribes.push(unsubProdutos);
};

// Modais e Eventos Base
document.body.addEventListener('click', async (e) => {
    const actionTarget = e.target.closest('[data-action]'); 
    if (actionTarget) {
        const action = actionTarget.dataset.action; const id = actionTarget.dataset.id;
        if(action === 'add' || action === 'inc' || action === 'dec' || action === 'fav') e.stopPropagation();

        if (action === 'add' || action === 'inc') { modificarCarrinho(id, 1); if(action === 'add') animarFeedbackBtn(actionTarget); }
        else if (action === 'dec') { modificarCarrinho(id, -1); }
        else if (action === 'cat') { STATE.catAtiva = actionTarget.dataset.cat; renderLoja(); }
        else if (action === 'fav') { 
            if(STATE.favoritos.includes(id)) STATE.favoritos = STATE.favoritos.filter(f => f !== id);
            else STATE.favoritos.push(id);
            localStorage.setItem('banca_favs', JSON.stringify(STATE.favoritos)); 
            if(STATE.catAtiva === 'favoritos') renderLoja(); 
        }
        else if (action === 'toggle-troco') {
            const valor = actionTarget.dataset.value;
            const inputArea = document.getElementById('input-troco-area'); const cliTroco = document.getElementById('cli-troco');
            if(valor === 'nao') { cliTroco.value = 'Não preciso'; inputArea.style.display = 'none'; } 
            else { cliTroco.value = ''; inputArea.style.display = 'block'; cliTroco.focus(); }
        }
        return;
    }
    const fecharTarget = e.target.closest('[data-fechar]');
    if (fecharTarget) closeModal(fecharTarget.dataset.fechar);
});

// UI Checkout
document.getElementById('btn-abrir-checkout').addEventListener('click', () => {
    STATE.checkoutSessionId = crypto.randomUUID(); 
    
    // Injeção do Campo de Cupão da IA (FASE 3)
    const pagamentoArea = document.getElementById('cli-pagamento')?.closest('.form-group');
    if(pagamentoArea && !document.getElementById('form-group-cupom')) {
        pagamentoArea.insertAdjacentHTML('afterend', `
            <div class="form-group" id="form-group-cupom">
                <label>Cupão de Desconto (IA)</label>
                <input type="text" id="cli-cupom" placeholder="Ex: IA-DESCONTO-10" style="text-transform: uppercase;">
            </div>
        `);
    }
    openModal('modal-checkout');
});

// Processamento Logístico do Checkout
document.getElementById('btn-enviar-pedido').addEventListener('click', async (e) => {
    const btn = e.currentTarget; if (btn.disabled) return;
    const nome = document.getElementById('cli-nome').value.trim();
    const quadra = document.getElementById('cli-quadra').value.trim();
    const lote = document.getElementById('cli-lote').value.trim();
    const pag = document.getElementById('cli-pagamento').value;
    const cupom = document.getElementById('cli-cupom')?.value.trim().toUpperCase() || '';
    
    if(!nome || !quadra || !lote) return showToast("⚠️ Preencha nome, quadra e lote!", true);

    btn.disabled = true; btn.textContent = 'A processar pedido... ⏳';

    try {
        const payload = {
            nome, quadra, lote, pag, cupom,
            itens: STATE.carrinho.map(item => ({ id: item.id, qtd: item.qtd })),
            clientTotal: STATE.carrinho.reduce((acc, item) => acc + (item.preco * item.qtd), 0),
            idempotencyKey: STATE.checkoutSessionId, userId: STATE.uid 
        };

        const response = await fetch('/api/checkout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!data.sucesso) throw new Error(data.error || "Falha ao processar pedido.");

        window.open(data.pedido.whatsappMsg, '_blank');
        closeModal('modal-checkout');
        STATE.carrinho = []; dbStorage.set('banca_cart', {v: CART_VERSION, items: []});
        renderCarrinhoCompleto(); 
        showToast("Pedido enviado com sucesso!");

    } catch(err) {
        showToast(err.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar Pedido 🚀';
    }
});

// Arranca com a IA Modularizada e injeta o estado principal nela
initIA(STATE);
