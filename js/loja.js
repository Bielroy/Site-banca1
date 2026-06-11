import { db, auth, collection, onSnapshot, signInAnonymously, onAuthStateChanged, doc } from './firebase.js';
import { fmt, escapeHTML, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, openModal, closeModal, iconeCarrinhoVazio, iconeHistoricoVazio, customConfirm, dbStorage } from './utils.js';

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
    historicoChat: [] // [IA - FASE 1] Memória de sessão do cliente
};

const carregarCarrinhoDB = async () => {
    try { 
        const raw = await dbStorage.get('banca_cart');
        if(raw && raw.v === CART_VERSION) { 
            STATE.carrinho = raw.items; 
            renderCarrinhoCompleto();
        }
    } catch(e) { console.warn("Cache vazio/inválido."); }
};
carregarCarrinhoDB(); 

let realTimeSyncIniciado = false;

onAuthStateChanged(auth, (user) => {
    if (user) {
        STATE.uid = user.uid;
        if (!realTimeSyncIniciado) {
            iniciarRealTimeSync();
            realTimeSyncIniciado = true;
        }
    } else {
        unsubscribes.forEach(unsub => unsub());
        unsubscribes = [];
        realTimeSyncIniciado = false;

        iniciarRealTimeSync();
        realTimeSyncIniciado = true;

        signInAnonymously(auth).catch(err => {
            console.warn("⚠️ Firebase Anonymous Auth desativado ou lento.", err);
        });
    }
});

const syncCarrinhoComPrecosAoVivo = () => {
    if (STATE.carrinho.length === 0 || STATE.produtos.length === 0) return;
    let modificou = false; let itensRemovidos = 0;

    STATE.carrinho.forEach(itemCart => {
        const prodAoVivo = STATE.produtos.find(p => p.id === itemCart.id);
        if (prodAoVivo) {
            if (itemCart.preco !== prodAoVivo.preco) { itemCart.preco = prodAoVivo.preco; modificou = true; }
        } else {
            itemCart.qtd = 0; itensRemovidos++; modificou = true;
        }
    });

    if (modificou) {
        STATE.carrinho = STATE.carrinho.filter(i => i.qtd > 0);
        persistirCarrinhoComDebounce();
        renderCarrinhoCompleto();
        if (itensRemovidos > 0) showToast(`⚠️ ${itensRemovidos} item(ns) esgotaram.`, true);
    }
};

const getCartQty = (id) => { 
    const item = STATE.carrinho.find(x => x.id === id); 
    return item ? item.qtd : 0; 
};

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
    renderUpsell();
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
    } else {
        upsellCont.innerHTML = '';
    }
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
        const sub = item.preco * item.qtd; 
        const fracionavel = isFracionavel(item.unidade);
        html += `
        <article class="carrinho-item" id="cart-row-${item.id}">
            <div class="item-emoji">${item.foto ? `<img src="${escapeHTML(item.foto)}" loading="lazy" width="48" height="48" alt="${escapeHTML(item.nome)}">` : placeholderSVG}</div>
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
    const p = STATE.produtos.find(x => x.id === id);
    if (!p) return;

    const fracionavel = isFracionavel(p.unidade);
    const step = fracionavel ? 0.1 : 1;
    let valParaAplicar = fixo ? delta : (delta > 0 ? step : -step);
    
    const idx = STATE.carrinho.findIndex(x => x.id === id);
    let novaQtd = 0;

    if (idx > -1) { 
        novaQtd = fixFloat(fixo ? valParaAplicar : STATE.carrinho[idx].qtd + valParaAplicar);
        if (novaQtd <= 0) STATE.carrinho.splice(idx, 1); else STATE.carrinho[idx].qtd = novaQtd;
    } else if (valParaAplicar > 0) { 
        novaQtd = fixFloat(fixo ? valParaAplicar : 1);
        STATE.carrinho.push({...p, qtd: novaQtd}); 
    }
    
    persistirCarrinhoComDebounce();
    atualizarBadgesDOM(id, novaQtd);
    atualizarLinhaCarrinhoDOM(id, novaQtd, fmt(p.preco * novaQtd));
    atualizarRodapeCarrinhoDOM();
};

const construirCardsIniciais = () => {
    const grid = document.getElementById('lista-produtos');
    const html = STATE.produtos.map(p => {
        const qtdNoCarrinho = getCartQty(p.id);
        const badgeTexto = isFracionavel(p.unidade) && qtdNoCarrinho > 0 ? formatarQuantidadeVisual(qtdNoCarrinho, true) : qtdNoCarrinho;
        const favActive = STATE.favoritos.includes(p.id) ? 'ativo' : '';
        return `
        <article class="produto-card" data-produto-id="${p.id}" data-cat="${escapeHTML(p.cat)}" data-nome="${p.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}" style="display: flex;">
            <div class="produto-img-wrap">
                ${p.foto ? `<img src="${escapeHTML(p.foto)}" loading="lazy" width="200" height="200" alt="${escapeHTML(p.nome)}">` : '<div class="produto-img-placeholder skeleton" style="width:100%;height:100%"></div>'}
                <button class="btn-fav ${favActive}" data-action="fav" data-id="${p.id}" aria-label="Favoritar">❤️</button>
                <span class="produto-unidade-tag">${escapeHTML(p.unidade || 'un')}</span>
                <div class="card-badge ${qtdNoCarrinho > 0 ? 'visivel':''}" id="badge-${p.id}">${badgeTexto}</div>
            </div>
            <div class="produto-info">
                <span class="produto-categoria">${escapeHTML(p.cat)}</span>
                <h3 class="produto-nome">${escapeHTML(p.nome)}</h3>
                <div class="produto-preco-row">
                    <span class="produto-preco">${fmt(p.preco)}<br><span style="font-size: 0.8rem; color: var(--text-light); font-weight: 600;">por ${escapeHTML(p.unidade || 'un')}</span></span>
                    <button class="btn-add" data-action="add" data-id="${p.id}" aria-label="Adicionar">+</button>
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
        if(!emptyMsg) grid.insertAdjacentHTML('beforeend', `<div id="${emptyId}" class="empty-state" style="grid-column: 1/-1;">${iconeHistoricoVazio}<p>Nenhum produto encontrado</p></div>`);
    } else if(emptyMsg) { emptyMsg.remove(); }
};

const renderCategorias = () => {
    const cats = ['todas', 'favoritos', ...new Set(STATE.produtos.map(p => p.cat))].filter(Boolean);
    document.getElementById('categorias').innerHTML = cats.map(c => `<button class="cat-btn ${c === STATE.catAtiva ? 'active' : ''}" data-action="cat" data-cat="${escapeHTML(c)}">${c === 'todas' ? 'Todos' : c === 'favoritos' ? '❤️ Favoritos' : escapeHTML(c)}</button>`).join('');
};

let buscaTimeout;
document.getElementById('busca-input').addEventListener('input', (e) => {
    clearTimeout(buscaTimeout);
    buscaTimeout = setTimeout(() => { STATE.busca = e.target.value; renderLoja(); }, 150);
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition(); recognition.lang = 'pt-BR';
    document.getElementById('btn-voz').addEventListener('click', () => { document.getElementById('btn-voz').classList.add('gravando'); recognition.start(); });
    recognition.onresult = (event) => { STATE.busca = event.results[0][0].transcript; document.getElementById('busca-input').value = STATE.busca; renderLoja(); };
    recognition.onerror = () => { document.getElementById('btn-voz').classList.remove('gravando'); showToast("Erro no reconhecimento de voz.", true); }
    recognition.onend = () => document.getElementById('btn-voz').classList.remove('gravando');
} else document.getElementById('btn-voz').style.display = 'none';

const iniciarRealTimeSync = () => {
    if (!navigator.onLine) document.getElementById('banner-offline').classList.add('visivel');
    
    const unsubConfig = onSnapshot(doc(db, "loja", "config"), (snap) => {
        if(snap.exists()) STATE.config = {...STATE.config, ...snap.data()}; atualizarRodapeCarrinhoDOM();
    });
    unsubscribes.push(unsubConfig);
    
    const unsubProdutos = onSnapshot(collection(db, "produtos"), (snap) => {
        STATE.produtos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => p.ativo);
        renderCategorias(); renderLoja(true); syncCarrinhoComPrecosAoVivo(); 
        STATE.carrinho.forEach(item => { atualizarBadgesDOM(item.id, item.qtd); });
    }, (error) => console.error("Erro Realtime:", error));
    unsubscribes.push(unsubProdutos);
};

document.body.addEventListener('click', async (e) => {
    const actionTarget = e.target.closest('[data-action]'); 
    if (actionTarget) {
        const action = actionTarget.dataset.action; const id = actionTarget.dataset.id;
        
        if (action === 'add' || action === 'inc') { modificarCarrinho(id, 1); if(action === 'add') animarFeedbackBtn(actionTarget); }
        else if (action === 'dec') { modificarCarrinho(id, -1); }
        else if (action === 'cat') { 
            STATE.catAtiva = actionTarget.dataset.cat; 
            document.querySelectorAll('.cat-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.cat === STATE.catAtiva));
            renderLoja(); 
        }
        else if (action === 'fav') { 
            if(STATE.favoritos.includes(id)) { STATE.favoritos = STATE.favoritos.filter(f => f !== id); actionTarget.classList.remove('ativo'); } 
            else { STATE.favoritos.push(id); actionTarget.classList.add('ativo'); }
            localStorage.setItem('banca_favs', JSON.stringify(STATE.favoritos)); 
            if(STATE.catAtiva === 'favoritos') renderLoja(); 
        }
        else if (action === 'open-historico') { renderHistorico(); openModal('modal-historico'); }
        else if (action === 'repetir-pedido') { repetirPedido(id); }
        else if (action === 'toggle-troco') {
            const valor = actionTarget.dataset.value;
            const btnSim = document.querySelector('[data-value="sim"]'); const btnNao = document.querySelector('[data-value="nao"]');
            const inputArea = document.getElementById('input-troco-area'); const cliTroco = document.getElementById('cli-troco');
            if(valor === 'nao') {
                cliTroco.value = 'Não preciso'; btnNao.classList.add('active'); btnSim.classList.remove('active'); inputArea.style.display = 'none';
            } else {
                cliTroco.value = ''; btnSim.classList.add('active'); btnNao.classList.remove('active'); inputArea.style.display = 'block'; cliTroco.focus();
            }
        }
        return;
    }
    const fecharTarget = e.target.closest('[data-fechar]');
    if (fecharTarget) {
        const modalId = fecharTarget.dataset.fechar; closeModal(modalId);
        if (history.state && history.state.modal === modalId) history.back();
        else if (window.location.hash === `#${modalId}`) history.replaceState(null, '', ' ');
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
    document.getElementById('carrinho-overlay').classList.remove('aberto');
    document.getElementById('carrinho').classList.remove('aberto');
    document.body.style.overflow = '';
    if (e.state) {
        if (e.state.modal) openModal(e.state.modal);
        if (e.state.cart) {
            document.getElementById('carrinho').classList.add('aberto');
            document.getElementById('carrinho-overlay').classList.add('aberto');
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
document.getElementById('btn-carrinho-mobile').addEventListener('click', () => toggleCartMobile(true));
document.getElementById('carrinho-overlay').addEventListener('click', () => history.back());

document.getElementById('btn-limpar-carrinho').addEventListener('click', async () => {
    if (STATE.carrinho.length === 0) return;
    if (await customConfirm("Esvaziar Pedido", "Tem certeza que deseja esvaziar todo o pedido?")) {
        STATE.carrinho = []; dbStorage.set('banca_cart', {v: CART_VERSION, items: []}); 
        renderCarrinhoCompleto(); showToast("🛒 Carrinho esvaziado!");
        if (window.innerWidth <= 900 && document.getElementById('carrinho').classList.contains('aberto')) history.back();
    }
});

document.getElementById('btn-abrir-checkout').addEventListener('click', () => {
    const clientes = JSON.parse(localStorage.getItem('banca_clientes') || '[]');
    if (clientes.length > 0) {
        document.getElementById('cli-nome').value = clientes[0].nome || '';
        document.getElementById('cli-quadra').value = clientes[0].quadra || '';
        document.getElementById('cli-lote').value = clientes[0].lote || '';
    }
    STATE.checkoutSessionId = crypto.randomUUID(); openModal('modal-checkout');
});

const renderHistorico = () => {
    const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
    const lista = document.getElementById('lista-meus-pedidos');
    if(meusPedidos.length === 0) { lista.innerHTML = `<div class="empty-state">${iconeHistoricoVazio}<p>Sem pedidos</p></div>`; return; }
    lista.innerHTML = meusPedidos.map(p => `
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
        if(prodAtualizado && prodAtualizado.ativo) { 
            STATE.carrinho.push({...prodAtualizado, qtd: i.qtd}); itensAdicionados++;
        } else { itensEsgotados.push(i.nome || 'Produto Indisponível'); }
    });

    if (itensAdicionados > 0) {
        persistirCarrinhoComDebounce(); renderCarrinhoCompleto(); closeModal('modal-historico'); toggleCartMobile(true);
        let msgToast = "🛒 Itens adicionados com preços atualizados!";
        if(itensEsgotados.length > 0) msgToast = `🛒 Alguns itens foram adicionados. Faltaram: ${itensEsgotados.join(', ')} (Esgotados)`;
        showToast(msgToast, itensEsgotados.length > 0);
    } else { showToast("❌ Todos os itens deste pedido encontram-se esgotados.", true); }
};

document.getElementById('cli-pagamento').addEventListener('change', (e) => { 
    const isDinheiro = e.target.value === 'Dinheiro';
    document.getElementById('troco-group').style.display = isDinheiro ? 'block' : 'none'; 
    if(!isDinheiro) document.getElementById('cli-troco').value = '';
});

document.getElementById('btn-enviar-pedido').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;

    const nome = document.getElementById('cli-nome').value.trim();
    const quadra = document.getElementById('cli-quadra').value.trim();
    const lote = document.getElementById('cli-lote').value.trim();
    const pag = document.getElementById('cli-pagamento').value;
    const trocoRaw = document.getElementById('cli-troco').value.trim();
    const obs = document.getElementById('cli-obs').value.trim();

    if(!nome || !quadra || !lote) { showToast("⚠️ Preencha nome, quadra e lote!", true); return; }

    btn.disabled = true; btn.textContent = 'Processando pedido... ⏳';

    try {
        const payload = {
            nome, quadra, lote, pag, troco: trocoRaw, obs,
            itens: STATE.carrinho.map(item => ({ id: item.id, qtd: item.qtd })),
            clientTotal: STATE.carrinho.reduce((acc, item) => acc + (item.preco * item.qtd), 0),
            idempotencyKey: STATE.checkoutSessionId,
            userId: STATE.uid 
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        let data;
        try { data = await response.json(); } catch(e) { throw new Error(`Falha grave de processamento (Status HTTP: ${response.status})`); }
        
        if (!response.ok) throw new Error(data.error || "Ocorreu um erro ao enviar o pedido.");
        if (!data.sucesso) throw new Error(data.error || "Falha ao processar pedido.");

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
        if(err.name === 'AbortError') showToast("Sua internet falhou. Verifique o sinal e tente novamente.", true);
        else showToast(err.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar Pedido 🚀';
    }
});

window.addEventListener('online', () => document.getElementById('banner-offline').classList.remove('visivel'));
window.addEventListener('offline', () => document.getElementById('banner-offline').classList.add('visivel'));

document.getElementById('btn-ia-flutuante').addEventListener('click', () => { openModal('modal-ia-chat'); });

const enviarMensagemParaIA = async () => {
    const input = document.getElementById('input-ia-mensagem');
    const texto = input.value.trim();
    if (!texto) return;

    const corpoChat = document.getElementById('chat-ia-corpo');
    const containerSugestoes = document.getElementById('ia-sugestoes-container');
    const btnEnviar = document.getElementById('btn-ia-enviar');

    // Echo da mensagem do cliente
    corpoChat.insertAdjacentHTML('beforeend', `
        <div style="align-self: flex-end; background: var(--forest); color: white; padding: 12px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; box-shadow: var(--shadow-sm);">
            ${escapeHTML(texto)}
        </div>
    `);
    
    STATE.historicoChat.push({ role: 'user', content: texto });
    input.value = ''; containerSugestoes.innerHTML = '';
    btnEnviar.disabled = true; btnEnviar.textContent = '⏱️...';

    // [IA - FASE 1] Interceptador Local (FAQ rápido para evitar custo de API)
    const txtLimpo = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (txtLimpo.includes('horario') || txtLimpo.includes('que horas')) {
        const msgH = `Nosso horário de funcionamento é das 08h às 18h. E olha, a loja está atualmente ${STATE.config.lojaAberta ? 'ABERTA ✅' : 'FECHADA ❌'}. Posso ajudar com mais algo?`;
        corpoChat.insertAdjacentHTML('beforeend', `
            <div style="align-self: flex-start; background: white; color: var(--text-dark); padding: 14px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; border: 1px solid #e0dcd4; box-shadow: var(--shadow-sm); line-height: 1.5;">
                🤖 ${msgH}
            </div>
        `);
        STATE.historicoChat.push({ role: 'ia', content: msgH });
        btnEnviar.disabled = false; btnEnviar.textContent = 'Enviar';
        corpoChat.scrollTop = corpoChat.scrollHeight;
        return;
    }

    const idDigitando = 'typing-' + Date.now();
    corpoChat.insertAdjacentHTML('beforeend', `
        <div id="${idDigitando}" style="align-self: flex-start; background: white; padding: 14px 20px; border-radius: var(--radius-sm); border: 1px solid #e0dcd4; box-shadow: var(--shadow-sm); display: flex; gap: 6px; align-items: center;">
            <span style="width: 6px; height: 6px; background: var(--forest); border-radius: 50%; animation: fadeIn 0.6s infinite alternate;"></span>
            <span style="width: 6px; height: 6px; background: var(--forest); border-radius: 50%; animation: fadeIn 0.6s infinite alternate 0.2s;"></span>
            <span style="width: 6px; height: 6px; background: var(--forest); border-radius: 50%; animation: fadeIn 0.6s infinite alternate 0.4s;"></span>
        </div>
    `);
    corpoChat.scrollTop = corpoChat.scrollHeight;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const payloadParams = {
            mensagemCliente: texto,
            historico: STATE.historicoChat.slice(-8), 
            carrinho: STATE.carrinho.map(i => ({id: i.id, nome: i.nome, qtd: i.qtd, unidade: i.unidade}))
        };

        const response = await fetch('/api/assistente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadParams),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const bolhaDigitando = document.getElementById(idDigitando);
        if (bolhaDigitando) bolhaDigitando.remove();

        let data;
        try { data = await response.json(); } catch(e) { throw new Error(`Falha do Engine (Status: ${response.status})`); }

        if (!response.ok) {
            if (response.status === 429) throw new Error("RATE_LIMIT");
            throw new Error(data.error || `Erro interno (Status: ${response.status})`);
        }

        // [SEGURANÇA - FASE 1] Prevenção de XSS Crítico (S01/1.01)
        const respostaSegura = escapeHTML(data.resposta).replace(/\n/g, '<br>');
        STATE.historicoChat.push({ role: 'ia', content: data.resposta });

        corpoChat.insertAdjacentHTML('beforeend', `
            <div style="align-self: flex-start; background: white; color: var(--text-dark); padding: 14px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; border: 1px solid #e0dcd4; box-shadow: var(--shadow-sm); line-height: 1.5;">
                ${respostaSegura}
            </div>
        `);

        if (data.sugestoes && data.sugestoes.length > 0) {
            let botoesHtml = '';
            data.sugestoes.forEach(prodId => {
                const produtoNoBanco = STATE.produtos.find(p => String(p.id) === String(prodId));
                if (produtoNoBanco) {
                    botoesHtml += `
                        <button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.85rem; white-space: nowrap; border-color: var(--earth); color: var(--earth);" data-action="add" data-id="${produtoNoBanco.id}">
                            🛒 + ${escapeHTML(produtoNoBanco.nome)}
                        </button>
                    `;
                }
            });
            containerSugestoes.innerHTML = botoesHtml;
        }

    } catch (err) {
        const bolhaDigitando = document.getElementById(idDigitando);
        if (bolhaDigitando) bolhaDigitando.remove();

        let msgErro = `🚨 ${escapeHTML(err.message)}`; 
        if (err.name === 'AbortError') msgErro = "O assistente demorou muito para responder (Timeout).";
        if (err.message === "RATE_LIMIT") msgErro = "Você enviou muitas mensagens. Aguarde alguns segundos.";

        corpoChat.insertAdjacentHTML('beforeend', `
            <div style="align-self: flex-start; background: var(--danger-light); color: var(--danger); padding: 12px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; border: 1px solid #fca5a5;">
                ${msgErro}
            </div>
        `);
    } finally {
        btnEnviar.disabled = false; btnEnviar.textContent = 'Enviar';
        corpoChat.scrollTop = corpoChat.scrollHeight;
    }
};

document.getElementById('btn-ia-enviar').addEventListener('click', enviarMensagemParaIA);
document.getElementById('input-ia-mensagem').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarMensagemParaIA(); });
