import { db, auth, collection, onSnapshot, signInAnonymously, onAuthStateChanged, doc, getDoc } from './firebase.js';
import { fmt, escapeHTML, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, openModal, closeModal, iconeCarrinhoVazio, iconeHistoricoVazio, customConfirm, dbStorage } from './utils.js';
import { initIA } from './ia.js';

const CART_VERSION = "2.3"; 
let unsubscribes = []; 

const STATE = {
    uid: null, produtos: [], carrinho: [], catAtiva: 'todas', busca: '',
    config: { minimo: 0, wpp: '5562999999999', lojaAberta: true, diasAbertos: [0,1,2,3,4,5,6] },
    favoritos: JSON.parse(localStorage.getItem('banca_favs') || '[]'),
    lojaRenderizada: false, checkoutSessionId: null, historicoChat: []
};

let inatividadeTimer;
const resetInatividadeTimer = () => {
    clearTimeout(inatividadeTimer);
    if (STATE.carrinho.length > 0 && !document.getElementById('modal-checkout')?.classList.contains('aberto') && !document.getElementById('modal-ia-chat')?.classList.contains('aberto')) {
        inatividadeTimer = setTimeout(() => {
            showToast("🤖 O assistente tem uma sugestão para o seu pedido. Que tal olhar?", false);
            const btnIA = document.getElementById('btn-ia-flutuante');
            if(btnIA) { btnIA.classList.add('pulse-anim'); setTimeout(() => btnIA.classList.remove('pulse-anim'), 10000); }
        }, 180000); 
    }
};
['click', 'touchstart', 'scroll', 'keydown'].forEach(evt => document.addEventListener(evt, resetInatividadeTimer, { passive: true }));

const carregarCarrinhoDB = async () => {
    try { 
        const raw = await dbStorage.get('banca_cart');
        if(raw && raw.v === CART_VERSION) { STATE.carrinho = raw.items; renderCarrinhoCompleto(); resetInatividadeTimer(); }
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
        if(row) row.remove(); if(STATE.carrinho.length === 0) renderCarrinhoCompleto();
    } else {
        if(!row) { renderCarrinhoCompleto(); } 
        else {
            const input = row.querySelector('.qtd-input'); const price = row.querySelector('.item-preco');
            const prod = STATE.produtos.find(p => p.id === id);
            if(input) input.value = formatarQuantidadeVisual(novaQtd, isFracionavel(prod?.unidade));
            if(price) price.textContent = subtotalFmt;
        }
    }
};

const renderUpsell = () => {
    const upsellCont = document.getElementById('upsell-container');
    if (STATE.carrinho.length === 0) { upsellCont.innerHTML = ''; return; }
    const idsNoCarrinho = STATE.carrinho.map(c => c.id);
    const catsNoCarrinho = [...new Set(STATE.carrinho.map(c => c.cat))];
    let sugestoes = STATE.produtos.filter(p => p.ativo && !idsNoCarrinho.includes(p.id) && catsNoCarrinho.includes(p.cat));
    if(sugestoes.length === 0) sugestoes = STATE.produtos.filter(p => p.ativo && !idsNoCarrinho.includes(p.id));
    if (sugestoes.length > 0) {
        sugestoes.sort((a,b) => (STATE.favoritos.includes(b.id) ? -1 : 1));
        const up = sugestoes[0];
        upsellCont.innerHTML = `<div class="upsell-box"><span>Que tal levar <b>${escapeHTML(up.nome)}</b>?</span><button class="btn btn-outline" style="padding: 6px 12px;" data-action="add" data-id="${up.id}">+ Add</button></div>`;
    } else { upsellCont.innerHTML = ''; }
};

const atualizarRodapeCarrinhoDOM = () => {
    let total = 0; STATE.carrinho.forEach(item => total += (item.preco * item.qtd));
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
    renderUpsell(); resetInatividadeTimer();
};

const renderSkeletons = () => {
    const grid = document.getElementById('lista-produtos');
    let skeletonHtml = '';
    for(let i=0; i<8; i++) {
        skeletonHtml += `<article class="produto-card"><div class="produto-img-wrap skeleton"></div><div class="produto-info"><span class="skeleton" style="width: 50%; height: 12px; display: block; margin-bottom: 8px;"></span><span class="skeleton" style="width: 80%; height: 20px; display: block;"></span><div class="produto-preco-row"><span class="skeleton" style="width: 60px; height: 24px; display: block;"></span><div class="skeleton" style="width: 44px; height: 44px; border-radius: 50%;"></div></div></div></article>`;
    }
    grid.innerHTML = skeletonHtml;
};

const renderCarrinhoCompleto = () => {
    const cont = document.getElementById('carrinho-itens');
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
            <div class="item-emoji">${item.foto ? `<img src="${escapeHTML(item.foto)}" loading="lazy" width="48" height="48">` : `<div class="item-emoji skeleton"></div>`}</div>
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
    renderSkeletons();
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

const injetarModalDetalheSeNecessario = () => {
    if(document.getElementById('modal-detalhe-produto')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="modal-detalhe-produto" aria-hidden="true">
            <div class="modal">
                <div class="modal-head">
                    <h2 id="md-nome">Produto</h2>
                    <button class="btn-fechar" data-fechar="modal-detalhe-produto">×</button>
                </div>
                <div class="modal-body" style="padding: 0 24px 24px 24px;">
                    <div class="produto-detalhe-hero"><img id="md-img" src="" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"></div>
                    <span id="md-tag" style="background:var(--foam);color:var(--forest-mid);padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:bold;margin-bottom:12px;display:inline-block;border:1px solid var(--sage);"></span>
                    <p id="md-desc" style="color:var(--text-mid);line-height:1.6;font-size:1.05rem;margin-bottom:20px;"></p>
                    <div style="display:flex; justify-content: space-between; align-items:center; border-top: 1px solid var(--parchment); padding-top: 16px;">
                        <span id="md-preco" class="produto-preco" style="font-size: 2rem;"></span>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="md-btn-add" class="btn btn-primary w-100" style="font-size:1.1rem; padding: 18px;">Adicionar ao Pedido</button>
                </div>
            </div>
        </div>
    `);
};

const renderHistorico = async () => {
    const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
    const lista = document.getElementById('lista-meus-pedidos');
    
    if(meusPedidos.length === 0) { lista.innerHTML = `<div class="empty-state">${iconeHistoricoVazio}<p>Sem pedidos</p></div>`; return; }

    let statusRealTime = 'pendente'; const ultimoPedido = meusPedidos[0];
    if (Date.now() - new Date(ultimoPedido.data).getTime() < 86400000) {
        try {
            const docRef = await getDoc(doc(db, "pedidos", ultimoPedido.id));
            if(docRef.exists()) statusRealTime = docRef.data().status;
        } catch(e) {}
    } else { statusRealTime = 'arquivado'; }

    const htmlTracker = statusRealTime !== 'arquivado' ? `
        <div style="display:flex; flex-direction:column; gap:16px; margin:20px 0; padding:20px; background:var(--warm-white); border-radius:12px; border:1px solid var(--parchment);">
            <div style="display:flex; align-items:center; gap:16px; opacity:${['pendente','preparando','enviado'].includes(statusRealTime) ? '1' : '0.4'};">
                <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;background:${['pendente','preparando','enviado'].includes(statusRealTime) ? 'var(--forest)' : 'white'};color:${['pendente','preparando','enviado'].includes(statusRealTime) ? 'white' : 'var(--text-light)'};">📋</div>
                <div><div style="font-weight:700;color:var(--text-dark);">Pedido Recebido</div></div>
            </div>
            <div style="display:flex; align-items:center; gap:16px; opacity:${['preparando','enviado'].includes(statusRealTime) ? '1' : '0.4'};">
                <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;background:${['preparando','enviado'].includes(statusRealTime) ? 'var(--forest)' : 'white'};color:${['preparando','enviado'].includes(statusRealTime) ? 'white' : 'var(--text-light)'};">📦</div>
                <div><div style="font-weight:700;color:var(--text-dark);">Em Separação</div></div>
            </div>
            <div style="display:flex; align-items:center; gap:16px; opacity:${statusRealTime === 'enviado' ? '1' : '0.4'};">
                <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;background:${statusRealTime === 'enviado' ? 'var(--forest)' : 'white'};color:${statusRealTime === 'enviado' ? 'white' : 'var(--text-light)'};">🛵</div>
                <div><div style="font-weight:700;color:var(--text-dark);">A Caminho!</div></div>
            </div>
        </div>
    ` : '';

    lista.innerHTML = htmlTracker + meusPedidos.map(p => `
        <article style="border: 1px solid var(--parchment); border-radius: 12px; padding: 16px; margin-bottom: 12px; background:var(--warm-white);">
            <div style="display:flex; justify-content: space-between; margin-bottom: 8px;">
                <strong style="color:var(--forest);">${new Date(p.data).toLocaleDateString('pt-BR')}</strong>
                <span style="color:var(--forest); font-weight:900;">${fmt(p.total)}</span>
            </div>
            <p style="font-size:0.9rem; color:var(--text-mid); line-height:1.4;">${escapeHTML(p.descItens || 'Itens do pedido')}</p>
            <button class="btn btn-outline w-100 mt-3" data-action="repetir-pedido" data-id="${p.id}">Repetir Pedido</button>
        </article>
    `).join('');
};

const repetirPedido = (pedId) => {
    const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
    const ped = meusPedidos.find(p => String(p.id) === String(pedId)); 
    if(!ped || !ped.itens) return;

    let itensAdicionados = 0; let itensEsgotados = []; STATE.carrinho = [];
    ped.itens.forEach(i => {
        const prodAtualizado = STATE.produtos.find(px => px.id === i.id);
        if(prodAtualizado && prodAtualizado.ativo) { STATE.carrinho.push({...prodAtualizado, qtd: i.qtd}); itensAdicionados++; } 
        else { itensEsgotados.push(i.nome || 'Produto Indisponível'); }
    });

    if (itensAdicionados > 0) {
        persistirCarrinhoComDebounce(); renderCarrinhoCompleto(); closeModal('modal-historico'); 
        if(window.innerWidth <= 900) toggleCartMobile(true);
        let msgToast = "🛒 Itens adicionados com preços atualizados!";
        if(itensEsgotados.length > 0) msgToast = `🛒 Alguns itens foram adicionados. Faltaram: ${itensEsgotados.join(', ')} (Esgotados)`;
        showToast(msgToast, itensEsgotados.length > 0);
    } else { showToast("❌ Todos os itens deste pedido encontram-se esgotados.", true); }
};

// =========================================================
// DELEGADOR GLOBAL BLINDADO (CORRIGE TODOS OS CLIQUES)
// =========================================================
document.body.addEventListener('click', async (e) => {
    
    // 1. Intercetar Botão IA Flutuante
    const btnIA = e.target.closest('#btn-ia-flutuante');
    if (btnIA) {
        openModal('modal-ia-chat');
        btnIA.classList.remove('pulse-anim');
        return;
    }

    // 2. Intercetar Limpar Carrinho (Esvaziar)
    const btnLimpar = e.target.closest('#btn-limpar-carrinho') || e.target.closest('.btn-limpar');
    if (btnLimpar) {
        if (STATE.carrinho.length === 0) return;
        if (await customConfirm("Esvaziar Pedido", "Tem certeza que deseja esvaziar todo o pedido?")) {
            STATE.carrinho = []; dbStorage.set('banca_cart', {v: CART_VERSION, items: []}); 
            renderCarrinhoCompleto(); showToast("🛒 Carrinho esvaziado!");
            if (window.innerWidth <= 900 && document.getElementById('carrinho')?.classList.contains('aberto')) history.back();
        }
        return;
    }

    // 3. Intercetar o Fechar de Qualquer Modal ("X") de Forma Agressiva
    const fecharTarget = e.target.closest('[data-fechar]') || e.target.closest('.btn-fechar');
    if (fecharTarget) {
        let modalId = fecharTarget.dataset.fechar;
        if (!modalId) {
            // Se o botão não tiver o data-fechar, ele procura o pai (o modal) e pega o ID dele
            const modalPai = fecharTarget.closest('.modal-overlay');
            if (modalPai) modalId = modalPai.id;
        }
        
        if(modalId) {
            closeModal(modalId);
            if (history.state && history.state.modal === modalId) history.back();
            else if (window.location.hash === `#${modalId}`) history.replaceState(null, '', ' ');
        }
        return;
    }

    // 4. Intercetar Outras Ações (Adicionar, Diminuir, Favoritar)
    const actionTarget = e.target.closest('[data-action]'); 
    if (actionTarget) {
        const action = actionTarget.dataset.action; const id = actionTarget.dataset.id;
        if(action === 'add' || action === 'inc' || action === 'dec' || action === 'fav') e.stopPropagation();

        if (action === 'add' || action === 'inc') { modificarCarrinho(id, 1); if(action === 'add') animarFeedbackBtn(actionTarget); }
        else if (action === 'dec') { modificarCarrinho(id, -1); }
        else if (action === 'detalhe') {
            const p = STATE.produtos.find(x => x.id === id);
            if(!p) return;
            injetarModalDetalheSeNecessario();
            document.getElementById('md-nome').textContent = p.nome;
            document.getElementById('md-img').src = p.foto || '';
            document.getElementById('md-tag').textContent = `Em Destaque • Categoria: ${p.cat}`;
            document.getElementById('md-desc').textContent = p.descricao || "Produto fresco selecionado com carinho."; 
            document.getElementById('md-preco').innerHTML = `${fmt(p.preco)} <span style="font-size:1rem;color:var(--text-light)">/${p.unidade||'un'}</span>`;
            const btnAdicionar = document.getElementById('md-btn-add');
            btnAdicionar.onclick = () => { modificarCarrinho(p.id, 1); showToast("Adicionado!"); closeModal('modal-detalhe-produto'); };
            openModal('modal-detalhe-produto');
        }
        else if (action === 'cat') { STATE.catAtiva = actionTarget.dataset.cat; renderLoja(); }
        else if (action === 'fav') { 
            if(STATE.favoritos.includes(id)) STATE.favoritos = STATE.favoritos.filter(f => f !== id);
            else STATE.favoritos.push(id);
            localStorage.setItem('banca_favs', JSON.stringify(STATE.favoritos)); 
            if(STATE.catAtiva === 'favoritos') renderLoja(); 
        }
        else if (action === 'open-historico') { renderHistorico(); openModal('modal-historico'); }
        else if (action === 'repetir-pedido') { repetirPedido(id); }
        else if (action === 'toggle-troco') {
            const valor = actionTarget.dataset.value;
            const inputArea = document.getElementById('input-troco-area'); const cliTroco = document.getElementById('cli-troco');
            if(valor === 'nao') { cliTroco.value = 'Não preciso'; inputArea.style.display = 'none'; } 
            else { cliTroco.value = ''; inputArea.style.display = 'block'; cliTroco.focus(); }
        }
        return; 
    }
});

document.getElementById('carrinho-itens').addEventListener('input', (e) => {
    if(e.target.classList.contains('qtd-input')) {
        const id = e.target.dataset.id; const p = STATE.produtos.find(x => x.id === id);
        let val = parseFloat(e.target.value.replace(',', '.'));
        if(isNaN(val) || val < 0) return; 
        val = (p && !isFracionavel(p.unidade)) ? Math.round(val) : fixFloat(val);
        modificarCarrinho(id, val, true);
    }
});

window.addEventListener('popstate', (e) => { 
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('aberto'));
    document.getElementById('carrinho-overlay')?.classList.remove('aberto');
    document.getElementById('carrinho')?.classList.remove('aberto');
    document.body.style.overflow = '';
    if (e.state) {
        if (e.state.modal) openModal(e.state.modal);
        if (e.state.cart) {
            document.getElementById('carrinho')?.classList.add('aberto');
            document.getElementById('carrinho-overlay')?.classList.add('aberto');
            document.body.style.overflow = 'hidden';
        }
    }
});

const toggleCartMobile = (abrir) => {
    if(window.innerWidth > 900) return;
    if (abrir) { 
        document.getElementById('carrinho').classList.add('aberto'); document.getElementById('carrinho-overlay').classList.add('aberto'); 
        document.body.style.overflow = 'hidden'; history.pushState({cart: true}, ''); 
    } else { 
        if(history.state && history.state.cart) history.back();
    }
};
document.getElementById('btn-carrinho-mobile')?.addEventListener('click', () => toggleCartMobile(true));
document.getElementById('carrinho-overlay')?.addEventListener('click', () => history.back());

document.getElementById('cli-pagamento').addEventListener('change', (e) => { 
    const isDinheiro = e.target.value === 'Dinheiro';
    document.getElementById('troco-group').style.display = isDinheiro ? 'block' : 'none'; 
    if(!isDinheiro) document.getElementById('cli-troco').value = '';
});

// UI Checkout
document.getElementById('btn-abrir-checkout').addEventListener('click', () => {
    const clientes = JSON.parse(localStorage.getItem('banca_clientes') || '[]');
    if (clientes.length > 0) {
        document.getElementById('cli-nome').value = clientes[0].nome || '';
        document.getElementById('cli-quadra').value = clientes[0].quadra || '';
        document.getElementById('cli-lote').value = clientes[0].lote || '';
    }
    STATE.checkoutSessionId = crypto.randomUUID(); 
    
    const pagamentoArea = document.getElementById('cli-pagamento')?.closest('.form-group');
    if(pagamentoArea && !document.getElementById('form-group-cupom')) {
        pagamentoArea.insertAdjacentHTML('afterend', `
            <div class="form-group" id="form-group-cupom">
                <label>Cupão de Desconto (Opcional)</label>
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
    const trocoRaw = document.getElementById('cli-troco').value.trim();
    const obs = document.getElementById('cli-obs').value.trim();
    const cupom = document.getElementById('cli-cupom')?.value.trim().toUpperCase() || '';
    
    if(!nome || !quadra || !lote) return showToast("⚠️ Preencha nome, quadra e lote!", true);
    btn.disabled = true; btn.textContent = 'A processar pedido... ⏳';

    try {
        const payload = {
            nome, quadra, lote, pag, troco: trocoRaw, obs, cupom,
            itens: STATE.carrinho.map(item => ({ id: item.id, qtd: item.qtd })),
            clientTotal: STATE.carrinho.reduce((acc, item) => acc + (item.preco * item.qtd), 0),
            idempotencyKey: STATE.checkoutSessionId, userId: STATE.uid 
        };

        const response = await fetch('/api/checkout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });

        let data = {};
        try { data = await response.json(); } catch(err){}
        if (!response.ok) throw new Error(data.error || "Ocorreu um erro ao enviar o pedido.");

        const clientes = JSON.parse(localStorage.getItem('banca_clientes') || '[]');
        const idx = clientes.findIndex(c => c.nome.toLowerCase() === nome.toLowerCase());
        if(idx >= 0) { clientes[idx] = {nome, quadra, lote}; } else { clientes.unshift({nome, quadra, lote}); }
        localStorage.setItem('banca_clientes', JSON.stringify(clientes.slice(0, 5)));

        const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
        meusPedidos.unshift({
            id: data.pedido.id, data: new Date().toISOString(), total: data.pedido.total,
            descItens: STATE.carrinho.map(i => isFracionavel(i.unidade) ? `${formatarQuantidadeVisual(i.qtd, true)}${i.unidade} ${i.nome}` : `${i.qtd}x ${i.nome}`).join(', '),
            itens: STATE.carrinho.map(item => ({ id: item.id, qtd: item.qtd, nome: item.nome }))
        });
        localStorage.setItem('banca_meus_pedidos', JSON.stringify(meusPedidos.slice(0, 10)));

        window.open(data.pedido.whatsappMsg, '_blank');
        closeModal('modal-checkout');
        setTimeout(() => openModal('modal-sucesso'), 300); 
        STATE.carrinho = []; dbStorage.set('banca_cart', {v: CART_VERSION, items: []});
        renderCarrinhoCompleto(); document.getElementById('cli-obs').value = ''; document.getElementById('cli-troco').value = '';

    } catch(err) {
        showToast(err.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar Pedido 🚀';
    }
});

window.addEventListener('online', () => document.getElementById('banner-offline').classList.remove('visivel'));
window.addEventListener('offline', () => document.getElementById('banner-offline').classList.add('visivel'));

initIA(STATE);
