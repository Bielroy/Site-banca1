import { db, auth, collection, getDocs, onSnapshot, signInAnonymously, onAuthStateChanged } from './firebase.js';
import { html, safeHTML, fmt, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, openModal, closeModal, setBtnLoading } from './utils.js';

const CART_VERSION = "3.0"; 
let STATE = {
    uid: null,
    produtos: [], 
    carrinho: [], 
    catAtiva: 'todas', 
    busca: '',
    config: { minimo: 0, wpp: '5562999999999', lojaAberta: true, diasAbertos: [0,1,2,3,4,5,6] },
    favoritos: JSON.parse(localStorage.getItem('banca_favs') || '[]')
};

// ----------------------------------------------------
// AUTENTICAÇÃO ANÔNIMA
// ----------------------------------------------------
onAuthStateChanged(auth, (user) => {
    if (user) STATE.uid = user.uid;
    else signInAnonymously(auth).catch(err => console.error("Erro na Autenticação Anônima:", err));
});

try { 
    const raw = localStorage.getItem('banca_cart');
    if(raw) { 
        const parsed = JSON.parse(raw); 
        if(parsed.v === CART_VERSION) STATE.carrinho = parsed.items; 
    }
} catch(e) { console.warn("Cache do carrinho invalidado."); }

const getCartQty = (id) => { 
    const item = STATE.carrinho.find(x => x.id === id); 
    return item ? item.qtd : 0; 
};

// ----------------------------------------------------
// DOM MANIPULATION OTIMIZADO (VIRTUALIZAÇÃO SOFT)
// ----------------------------------------------------
const atualizarBadgesDOM = (produtoId, qtd) => {
    const badge = document.getElementById(`badge-${produtoId}`);
    if(badge) {
        const prod = STATE.produtos.find(p => p.id === produtoId);
        badge.textContent = isFracionavel(prod?.unidade) && qtd > 0 ? formatarQuantidadeVisual(qtd, true) : qtd;
        if(qtd > 0) badge.classList.add('visivel');
        else badge.classList.remove('visivel');
    }
};

const atualizarLinhaCarrinhoDOM = (id, novaQtd, subtotalFmt) => {
    const row = document.getElementById(`cart-row-${id}`);
    if(novaQtd <= 0) {
        if(row) row.remove();
        if(STATE.carrinho.length === 0) document.getElementById('empty-cart').classList.remove('hidden');
    } else {
        document.getElementById('empty-cart').classList.add('hidden');
        if(!row) {
            renderCarrinhoCompleto(); 
        } else {
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
        btnF.disabled = true; 
        btnF.textContent = "Loja Fechada";
        bannerMin.classList.remove('visivel'); 
        bannerFechado.classList.add('visivel');
    } else { 
        bannerFechado.classList.remove('visivel'); 
        if (STATE.config.minimo > 0 && total < STATE.config.minimo && STATE.carrinho.length > 0) { 
            btnF.disabled = true; 
            btnF.textContent = `Falta ${fmt(STATE.config.minimo - total)}`;
            bannerMin.textContent = `⚠️ Valor mínimo para pedido: ${fmt(STATE.config.minimo)}`; 
            bannerMin.classList.add('visivel'); 
        } else { 
            btnF.disabled = STATE.carrinho.length === 0; 
            btnF.textContent = "Finalizar Pedido";
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
        sugestoes.sort((a,b) => (STATE.favoritos.includes(b.id) ? 1 : 0) - (STATE.favoritos.includes(a.id) ? 1 : 0));
        const up = sugestoes[0];
        // Proteção XSS com Template Tag
        upsellCont.innerHTML = html`<div class="upsell-box"><span>Que tal levar <b>${up.nome}</b>?</span><button class="btn btn-outline" style="padding: 6px 12px" data-action="add" data-id="${up.id}">+ Add</button></div>`;
    } else {
        upsellCont.innerHTML = '';
    }
};

const renderCarrinhoCompleto = () => {
    const cont = document.getElementById('carrinho-itens');
    const emptyState = document.getElementById('empty-cart');
    
    // Limpa a lista atual exceto o empty state
    Array.from(cont.children).forEach(child => {
        if (child.id !== 'empty-cart') child.remove();
    });
    
    STATE.produtos.forEach(p => {
        const badgeGrid = document.getElementById(`badge-${p.id}`);
        if(badgeGrid) {
            badgeGrid.textContent = '0';
            badgeGrid.classList.remove('visivel');
        }
    });
    
    if (STATE.carrinho.length === 0) {
        emptyState.classList.remove('hidden');
        atualizarRodapeCarrinhoDOM();
        return;
    }

    emptyState.classList.add('hidden');
    let htmlContent = '';
    
    STATE.carrinho.forEach(item => {
        const sub = item.preco * item.qtd; 
        const fracionavel = isFracionavel(item.unidade);
        const fotoHTML = item.foto ? safeHTML(`<img src="${item.foto}" loading="lazy" width="48" height="48" alt="Foto do produto">`) : safeHTML(`<div class="item-emoji skeleton"></div>`);
        
        // Uso estrito do html tag p/ segurança
        htmlContent += html`
        <article class="carrinho-item" id="cart-row-${item.id}">
            <div class="item-emoji">${fotoHTML}</div>
            <div class="item-meio">
                <h3 class="item-nome">${item.nome}</h3>
                <div class="qtd-ctrl">
                    <button class="btn-qtd" data-action="dec" data-id="${item.id}" aria-label="Diminuir quantidade">−</button>
                    <input class="qtd-input" type="text" inputmode="decimal" value="${formatarQuantidadeVisual(item.qtd, fracionavel)}" data-id="${item.id}" aria-label="Quantidade">
                    <button class="btn-qtd" data-action="inc" data-id="${item.id}" aria-label="Aumentar quantidade">+</button>
                </div>
            </div>
            <span class="item-preco">${fmt(sub)}</span>
        </article>`;
    });
    
    // Injeta de forma segura mantendo o empty state no topo
    cont.insertAdjacentHTML('beforeend', htmlContent); 
    atualizarRodapeCarrinhoDOM();
};

let debounceSalvarCarrinho;
const persistirCarrinhoComDebounce = () => {
    clearTimeout(debounceSalvarCarrinho);
    debounceSalvarCarrinho = setTimeout(() => {
        localStorage.setItem('banca_cart', JSON.stringify({v: CART_VERSION, items: STATE.carrinho}));
    }, 400);
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
        
        if (novaQtd <= 0) {
            STATE.carrinho.splice(idx, 1); 
        } else {
            STATE.carrinho[idx].qtd = novaQtd;
        }
    } else if (valParaAplicar > 0) { 
        novaQtd = fixFloat(fixo ? valParaAplicar : 1);
        STATE.carrinho.push({...p, qtd: novaQtd}); 
    }
    
    persistirCarrinhoComDebounce();
    atualizarBadgesDOM(id, novaQtd);
    atualizarLinhaCarrinhoDOM(id, novaQtd, fmt(p.preco * novaQtd));
    atualizarRodapeCarrinhoDOM();
};

// ----------------------------------------------------
// FIM DO LAYOUT THRASHING (RENDERIZAÇÃO ÚNICA E CSS TOGGLE)
// ----------------------------------------------------
const renderLojaInicial = () => {
    const grid = document.getElementById('lista-produtos');
    const loader = document.getElementById('loader-produtos');
    if(loader) loader.remove();

    const htmlContent = STATE.produtos.map(p => {
        const qtdNoCarrinho = getCartQty(p.id);
        const badgeTexto = isFracionavel(p.unidade) && qtdNoCarrinho > 0 ? formatarQuantidadeVisual(qtdNoCarrinho, true) : qtdNoCarrinho;
        const favActive = STATE.favoritos.includes(p.id) ? 'ativo' : '';
        const normalizeName = p.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        
        const fotoHTML = p.foto ? safeHTML(`<img src="${p.foto}" loading="lazy" width="200" height="200" alt="Foto">`) : safeHTML('<div class="produto-img-placeholder skeleton" style="width:100%;height:100%"></div>');

        // Note o data-busca usado para a filtragem em CSS depois
        return html`
        <article class="produto-card ${p.ativo ? '' : 'hidden'}" id="card-${p.id}" data-busca="${normalizeName}" data-cat="${p.cat}" data-id="${p.id}">
            <div class="produto-img-wrap">
                ${fotoHTML}
                <button class="btn-fav ${favActive}" data-action="fav" data-id="${p.id}" aria-label="Favoritar">❤️</button>
                <span class="produto-unidade-tag">${p.unidade || 'un'}</span>
                <div class="card-badge ${qtdNoCarrinho > 0 ? 'visivel':''}" id="badge-${p.id}">${badgeTexto}</div>
            </div>
            <div class="produto-info">
                <span class="produto-categoria">${p.cat}</span>
                <h3 class="produto-nome">${p.nome}</h3>
                <div class="produto-preco-row">
                    <span class="produto-preco">${fmt(p.preco)}<br><span>por ${p.unidade || 'un'}</span></span>
                    <button class="btn-add" data-action="add" data-id="${p.id}" aria-label="Adicionar">+</button>
                </div>
            </div>
        </article>`;
    }).join('');

    grid.innerHTML = htmlContent;
    filtrarLojaVisivel(); // Aplica estado inicial
};

const filtrarLojaVisivel = () => {
    const termo = STATE.busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const cards = document.querySelectorAll('.produto-card');
    let visibleCount = 0;

    cards.forEach(card => {
        const p = STATE.produtos.find(x => x.id === card.dataset.id);
        if(!p || !p.ativo) return; // Se esgotou no Firebase, nunca mostra

        const matchesBusca = card.dataset.busca.includes(termo);
        const matchesCat = STATE.catAtiva === 'todas' || 
                           (STATE.catAtiva === 'favoritos' && STATE.favoritos.includes(card.dataset.id)) || 
                           card.dataset.cat === STATE.catAtiva;

        if (matchesBusca && matchesCat) {
            card.classList.remove('hidden');
            visibleCount++;
        } else {
            card.classList.add('hidden');
        }
    });

    const emptySearch = document.getElementById('empty-search');
    if (visibleCount === 0 && STATE.produtos.length > 0) {
        emptySearch.classList.remove('hidden');
    } else {
        emptySearch.classList.add('hidden');
    }
};

const renderCategorias = () => {
    const cats = ['todas', 'favoritos', ...new Set(STATE.produtos.filter(p => p.ativo).map(p => p.cat))].filter(Boolean);
    document.getElementById('categorias').innerHTML = cats.map(c => {
        const label = c === 'todas' ? 'Todos' : c === 'favoritos' ? '❤️ Favoritos' : c;
        return html`<button class="cat-btn ${c === STATE.catAtiva ? 'active' : ''}" data-action="cat" data-cat="${c}">${label}</button>`;
    }).join('');
};

// ----------------------------------------------------
// OTIMIZAÇÃO DE BUSCA E VOZ
// ----------------------------------------------------
let buscaTimeout;
document.getElementById('busca-input').addEventListener('input', (e) => {
    clearTimeout(buscaTimeout);
    buscaTimeout = setTimeout(() => {
        STATE.busca = e.target.value;
        filtrarLojaVisivel(); // Modifica apenas CSS, 0 layout thrashing
    }, 150); // Menos delay, pois agora é leve
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    
    document.getElementById('btn-voz').addEventListener('click', () => {
        document.getElementById('btn-voz').classList.add('gravando');
        recognition.start();
    });

    recognition.onresult = (event) => {
        const txt = event.results[0][0].transcript;
        document.getElementById('busca-input').value = txt;
        STATE.busca = txt;
        filtrarLojaVisivel();
    };

    recognition.onend = () => document.getElementById('btn-voz').classList.remove('gravando');
} else {
    document.getElementById('btn-voz').classList.add('hidden');
}

// ----------------------------------------------------
// FIREBASE GETDOCS (Economia de Dinheiro)
// ----------------------------------------------------
const carregarDadosFirebase = async () => {
    if (!navigator.onLine) document.getElementById('banner-offline').classList.add('visivel');
    
    // Config da Loja fica em tempo real (é barato)
    onSnapshot(collection(db, "loja"), (snap) => {
        snap.forEach(d => { if(d.id === 'config') STATE.config = {...STATE.config, ...d.data()}; });
        atualizarRodapeCarrinhoDOM();
    });

    try {
        // Produtos lidos UMA vez por sessão. Firestore usa Cache Local por baixo dos panos.
        const snap = await getDocs(collection(db, "produtos"));
        STATE.produtos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        renderLojaInicial();
        renderCategorias(); 
        STATE.carrinho.forEach(item => atualizarBadgesDOM(item.id, item.qtd));
    } catch(err) {
        console.error("Erro ao carregar catálogo:", err);
        showToast("Erro ao carregar produtos. Atualize a página.");
    }
};

// ----------------------------------------------------
// EVENT DELEGATION
// ----------------------------------------------------
document.body.addEventListener('click', (e) => {
    const actionTarget = e.target.closest('[data-action]'); 
    if (actionTarget) {
        const action = actionTarget.dataset.action;
        const id = actionTarget.dataset.id;
        
        if (action === 'add' || action === 'inc') { 
            modificarCarrinho(id, 1); 
            if(action === 'add') animarFeedbackBtn(actionTarget); 
        }
        else if (action === 'dec') { modificarCarrinho(id, -1); }
        else if (action === 'cat') { 
            STATE.catAtiva = actionTarget.dataset.cat; 
            renderCategorias(); 
            filtrarLojaVisivel(); 
        }
        else if (action === 'fav') { 
            if(STATE.favoritos.includes(id)) {
                STATE.favoritos = STATE.favoritos.filter(f => f !== id);
                document.querySelector(`#card-${id} .btn-fav`).classList.remove('ativo');
            } else {
                STATE.favoritos.push(id); 
                document.querySelector(`#card-${id} .btn-fav`).classList.add('ativo');
            }
            localStorage.setItem('banca_favs', JSON.stringify(STATE.favoritos)); 
            if(STATE.catAtiva === 'favoritos') filtrarLojaVisivel(); // Atualiza a vista se estiver na aba de favoritos
        }
        else if (action === 'open-historico') { renderHistorico(); openModal('modal-historico'); }
        else if (action === 'repetir-pedido') { repetirPedido(id); }
        return;
    }

    const fecharTarget = e.target.closest('[data-fechar]');
    if (fecharTarget) {
        closeModal(fecharTarget.dataset.fechar);
        if (history.state && history.state.modal === fecharTarget.dataset.fechar) history.back();
        return;
    }
});

// UI Tratamento do Pagamento e Troco 
document.getElementById('cli-pagamento').addEventListener('change', (e) => { 
    const isDinheiro = e.target.value === 'Dinheiro';
    const trocoGroup = document.getElementById('troco-group');
    if(isDinheiro) trocoGroup.classList.remove('hidden');
    else {
        trocoGroup.classList.add('hidden');
        document.getElementById('cli-troco').value = '';
        // Reseta os botões de troco
        document.getElementById('btn-troco-nao').classList.add('ativo');
        document.getElementById('btn-troco-sim').classList.remove('ativo');
        document.getElementById('input-troco-area').classList.add('hidden');
    }
});

document.getElementById('btn-troco-nao').addEventListener('click', () => {
    document.getElementById('btn-troco-nao').classList.add('ativo');
    document.getElementById('btn-troco-sim').classList.remove('ativo');
    document.getElementById('input-troco-area').classList.add('hidden');
    document.getElementById('cli-troco').value = 'Não preciso';
});

document.getElementById('btn-troco-sim').addEventListener('click', () => {
    document.getElementById('btn-troco-sim').classList.add('ativo');
    document.getElementById('btn-troco-nao').classList.remove('ativo');
    document.getElementById('input-troco-area').classList.remove('hidden');
    document.getElementById('cli-troco').value = '';
    document.getElementById('cli-troco').focus();
});


document.getElementById('carrinho-itens').addEventListener('input', (e) => {
    if(e.target.classList.contains('qtd-input')) {
        const id = e.target.dataset.id;
        const p = STATE.produtos.find(x => x.id === id);
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

    if (e.state) {
        if (e.state.modal) document.getElementById(e.state.modal)?.classList.add('aberto');
        if (e.state.cart) {
            document.getElementById('carrinho').classList.add('aberto');
            document.getElementById('carrinho-overlay').classList.add('aberto');
        }
    }
});

const toggleCartMobile = (abrir) => {
    if(window.innerWidth > 1024) return;
    if (abrir) { 
        document.getElementById('carrinho').classList.add('aberto'); 
        document.getElementById('carrinho-overlay').classList.add('aberto'); 
        history.pushState({cart: true}, ''); 
    } else { 
        if(history.state && history.state.cart) history.back();
    }
};
document.getElementById('btn-carrinho-mobile').addEventListener('click', () => toggleCartMobile(true));
document.getElementById('carrinho-overlay').addEventListener('click', () => history.back());

document.getElementById('btn-limpar-carrinho').addEventListener('click', () => {
    if (STATE.carrinho.length === 0) return;
    if (confirm("Esvaziar o pedido inteiro?")) {
        STATE.carrinho = []; 
        localStorage.setItem('banca_cart', JSON.stringify({v: CART_VERSION, items: []})); 
        renderCarrinhoCompleto(); 
        showToast("🛒 Carrinho esvaziado!");
        if (window.innerWidth <= 1024 && document.getElementById('carrinho').classList.contains('aberto')) history.back();
    }
});

document.getElementById('btn-abrir-checkout').addEventListener('click', () => {
    const clientes = JSON.parse(localStorage.getItem('banca_clientes') || '[]');
    if (clientes.length > 0) {
        document.getElementById('cli-nome').value = clientes[0].nome || '';
        document.getElementById('cli-quadra').value = clientes[0].quadra || '';
        document.getElementById('cli-lote').value = clientes[0].lote || '';
    }
    openModal('modal-checkout');
});

const renderHistorico = () => {
    const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
    const lista = document.getElementById('lista-meus-pedidos');
    
    if(meusPedidos.length === 0) {
        lista.innerHTML = html`<div class="empty-state"><svg><use href="#icon-history-empty" /></svg><p>Sem pedidos anteriores</p></div>`;
        return;
    }
    
    lista.innerHTML = meusPedidos.map(p => html`
        <article class="historico-card">
            <div class="historico-header">
                <strong class="historico-data">${new Date(p.data).toLocaleDateString('pt-BR')}</strong>
                <span class="historico-total">${fmt(p.total)}</span>
            </div>
            <p class="historico-desc">${p.descItens || 'Itens do pedido'}</p>
            <button class="btn btn-outline" style="width:100%; margin-top:14px; padding:10px;" data-action="repetir-pedido" data-id="${p.id}">Repetir Pedido</button>
        </article>
    `).join('');
};

const repetirPedido = (pedId) => {
    const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
    const ped = meusPedidos.find(p => p.id === String(pedId) || p.id === Number(pedId));
    if(ped && ped.itens) {
        STATE.carrinho = [];
        ped.itens.forEach(i => {
            const prodInfo = STATE.produtos.find(px => px.id === i.id);
            if(prodInfo && prodInfo.ativo) STATE.carrinho.push({...prodInfo, qtd: i.qtd});
        });
        persistirCarrinhoComDebounce();
        renderCarrinhoCompleto();
        closeModal('modal-historico');
        showToast('🛒 Itens adicionados!');
    }
};

// ----------------------------------------------------
// INTEGRAÇÃO SERVERLESS
// ----------------------------------------------------
document.getElementById('btn-enviar-pedido').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;

    const nome = document.getElementById('cli-nome').value.trim();
    const quadra = document.getElementById('cli-quadra').value.trim();
    const lote = document.getElementById('cli-lote').value.trim();
    const pag = document.getElementById('cli-pagamento').value;
    const isDinheiro = pag === 'Dinheiro';
    
    // Trata o troco a partir dos botões novos
    let trocoFinal = '';
    if (isDinheiro) {
        const inputTroco = document.getElementById('cli-troco').value.trim();
        trocoFinal = inputTroco === '' ? 'Não informado' : inputTroco;
    }

    const obs = document.getElementById('cli-obs').value.trim();

    if(!nome || !quadra || !lote) { showToast("⚠️ Preencha nome, quadra e lote!"); return; }

    setBtnLoading('btn-enviar-pedido', true, 'Processando pedido... 🚀');

    try {
        const payload = {
            nome, quadra, lote, pag, troco: trocoFinal, obs,
            itens: STATE.carrinho.map(item => ({ id: item.id, qtd: item.qtd }))
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

        const contentType = response.headers.get("content-type");
        let data;
        
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            throw new Error("Erro Crítico no Vercel. Contate o administrador.");
        }

        if (!response.ok || !data.sucesso) throw new Error(data.error || "Falha ao processar.");

        const clientes = JSON.parse(localStorage.getItem('banca_clientes') || '[]');
        const idx = clientes.findIndex(c => c.nome.toLowerCase() === nome.toLowerCase());
        if(idx >= 0) clientes[idx] = {nome, quadra, lote}; else clientes.unshift({nome, quadra, lote});
        localStorage.setItem('banca_clientes', JSON.stringify(clientes.slice(0, 5)));

        const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
        meusPedidos.unshift({
            id: data.pedido.id, 
            data: new Date().toISOString(), 
            total: data.pedido.total,
            descItens: STATE.carrinho.map(i => isFracionavel(i.unidade) ? `${formatarQuantidadeVisual(i.qtd, true)}${i.unidade} ${i.nome}` : `${i.qtd}x ${i.nome}`).join(', '),
            itens: STATE.carrinho.map(item => ({ id: item.id, qtd: item.qtd }))
        });
        localStorage.setItem('banca_meus_pedidos', JSON.stringify(meusPedidos.slice(0, 10)));

        window.open(data.pedido.whatsappMsg, '_blank');
        
        closeModal('modal-checkout');
        setTimeout(() => openModal('modal-sucesso'), 300); 
        
        STATE.carrinho = []; 
        localStorage.setItem('banca_cart', JSON.stringify({v: CART_VERSION, items: []}));
        renderCarrinhoCompleto();
        document.getElementById('cli-obs').value = ''; 
        document.getElementById('cli-troco').value = '';

    } catch(err) {
        if(err.name === 'AbortError') showToast("Conexão fraca. Verifique sua internet.");
        else showToast(err.message); 
    } finally {
        setBtnLoading('btn-enviar-pedido', false);
    }
});

window.addEventListener('online', () => document.getElementById('banner-offline').classList.remove('visivel'));
window.addEventListener('offline', () => document.getElementById('banner-offline').classList.add('visivel'));

renderCarrinhoCompleto();
carregarDadosFirebase();
