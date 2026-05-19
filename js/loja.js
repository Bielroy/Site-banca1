import { db, auth, collection, onSnapshot, signInAnonymously, onAuthStateChanged } from './firebase.js';
import { fmt, escapeHTML, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, openModal, closeModal, iconeCarrinhoVazio, iconeHistoricoVazio } from './utils.js';

const CART_VERSION = "2.0"; // Versão atualizada para forçar limpeza de cache antigo incompatível
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
// AUTENTICAÇÃO ANÔNIMA (Retenção de Cliente)
// ----------------------------------------------------
onAuthStateChanged(auth, (user) => {
    if (user) {
        STATE.uid = user.uid;
    } else {
        signInAnonymously(auth).catch(err => console.error("Erro na Autenticação Anônima:", err));
    }
});

// Inicialização segura do Estado do Carrinho Persistido
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
// GERENCIAMENTO DOM CIRÚRGICO (Prevenção de CLS)
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
        if(STATE.carrinho.length === 0) renderCarrinhoCompleto();
    } else {
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
        upsellCont.innerHTML = `<div class="upsell-box"><span>Que tal levar <b>${escapeHTML(up.nome)}</b>?</span><button data-action="add" data-id="${up.id}">+ Add</button></div>`;
    } else {
        upsellCont.innerHTML = '';
    }
};

const renderCarrinhoCompleto = () => {
    const cont = document.getElementById('carrinho-itens');
    const placeholderSVG = `<div class="item-emoji skeleton"></div>`;
    
    STATE.produtos.forEach(p => {
        const badgeGrid = document.getElementById(`badge-${p.id}`);
        if(badgeGrid) {
            badgeGrid.textContent = '0';
            badgeGrid.classList.remove('visivel');
        }
    });
    
    if (STATE.carrinho.length === 0) {
        cont.innerHTML = `<div class="empty-state">${iconeCarrinhoVazio}<p>Seu pedido está vazio</p><span>Adicione produtos para começar.</span></div>`;
        atualizarRodapeCarrinhoDOM();
        return;
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
                    <button class="btn-qtd" data-action="dec" data-id="${item.id}" aria-label="Diminuir quantidade">−</button>
                    <input class="qtd-input" type="text" inputmode="decimal" value="${formatarQuantidadeVisual(item.qtd, fracionavel)}" data-id="${item.id}" aria-label="Quantidade">
                    <button class="btn-qtd" data-action="inc" data-id="${item.id}" aria-label="Aumentar quantidade">+</button>
                </div>
            </div>
            <span class="item-preco">${fmt(sub)}</span>
        </article>`;
    });
    cont.innerHTML = html; 
    atualizarRodapeCarrinhoDOM();
};

// ----------------------------------------------------
// DEBOUNCE PARA SALVAR NO DISCO (Previne CPU Stuttering)
// ----------------------------------------------------
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

const renderLoja = () => {
    const grid = document.getElementById('lista-produtos');
    const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const termo = normalize(STATE.busca);
    const idsCarrinho = STATE.carrinho.map(c => c.id);
    
    const filtrados = STATE.produtos
        .filter(p => p.ativo && 
            (STATE.catAtiva === 'todas' || 
            (STATE.catAtiva === 'favoritos' && STATE.favoritos.includes(p.id)) || 
            p.cat === STATE.catAtiva) && 
            normalize(p.nome).includes(termo))
        .sort((a, b) => {
            let pesoA = (idsCarrinho.includes(a.id) ? 2 : 0) + (STATE.favoritos.includes(a.id) ? 1 : 0);
            let pesoB = (idsCarrinho.includes(b.id) ? 2 : 0) + (STATE.favoritos.includes(b.id) ? 1 : 0);
            return pesoB - pesoA;
        });
    
    if (filtrados.length === 0) { 
        grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">${iconeHistoricoVazio}<p>Nenhum produto encontrado</p><span>Tente buscar por outro termo ou limpe os filtros.</span></div>`; 
        return; 
    }

    grid.innerHTML = filtrados.map(p => {
        const qtdNoCarrinho = getCartQty(p.id);
        const badgeTexto = isFracionavel(p.unidade) && qtdNoCarrinho > 0 ? formatarQuantidadeVisual(qtdNoCarrinho, true) : qtdNoCarrinho;
        const favActive = STATE.favoritos.includes(p.id) ? 'ativo' : '';
        
        return `
        <article class="produto-card">
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
                    <span class="produto-preco">${fmt(p.preco)}<br><span>por ${escapeHTML(p.unidade || 'un')}</span></span>
                    <button class="btn-add" data-action="add" data-id="${p.id}" aria-label="Adicionar">+</button>
                </div>
            </div>
        </article>`;
    }).join('');
};

const renderCategorias = () => {
    const cats = ['todas', 'favoritos', ...new Set(STATE.produtos.map(p => p.cat))].filter(Boolean);
    document.getElementById('categorias').innerHTML = cats.map(c => `<button class="cat-btn ${c === STATE.catAtiva ? 'active' : ''}" data-action="cat" data-cat="${escapeHTML(c)}">${c === 'todas' ? 'Todos' : c === 'favoritos' ? '❤️ Favoritos' : escapeHTML(c)}</button>`).join('');
};

// ----------------------------------------------------
// EVENTOS DE BUSCA E VOZ (Debounce e Web Speech API)
// ----------------------------------------------------
let buscaTimeout;
document.getElementById('busca-input').addEventListener('input', (e) => {
    clearTimeout(buscaTimeout);
    buscaTimeout = setTimeout(() => {
        STATE.busca = e.target.value;
        renderLoja();
    }, 300);
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    
    document.getElementById('btn-voz').addEventListener('click', () => {
        const btn = document.getElementById('btn-voz');
        btn.classList.add('gravando');
        recognition.start();
    });

    recognition.onresult = (event) => {
        const textoGravado = event.results[0][0].transcript;
        const input = document.getElementById('busca-input');
        input.value = textoGravado;
        STATE.busca = textoGravado;
        renderLoja();
    };

    recognition.onend = () => document.getElementById('btn-voz').classList.remove('gravando');
} else {
    document.getElementById('btn-voz').style.display = 'none';
}

// ----------------------------------------------------
// FIREBASE REALTIME SYNC
// ----------------------------------------------------
const iniciarRealTimeSync = () => {
    if (!navigator.onLine) { document.getElementById('banner-offline').classList.add('visivel'); }
    
    // Otimização: Escuta apenas o documento config, não a coleção inteira
    onSnapshot(collection(db, "loja"), (snap) => {
        snap.forEach(d => { if(d.id === 'config') STATE.config = {...STATE.config, ...d.data()}; });
        atualizarRodapeCarrinhoDOM();
    });

    onSnapshot(collection(db, "produtos"), (snap) => {
        STATE.produtos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderCategorias(); 
        renderLoja(); 
        STATE.carrinho.forEach(item => { atualizarBadgesDOM(item.id, item.qtd); });
    }, (error) => console.error("Erro Realtime:", error));
};

// ----------------------------------------------------
// DELEGAÇÃO DE EVENTOS CENTRALIZADA
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
        else if (action === 'cat') { STATE.catAtiva = actionTarget.dataset.cat; renderCategorias(); renderLoja(); }
        else if (action === 'fav') { 
            if(STATE.favoritos.includes(id)) STATE.favoritos = STATE.favoritos.filter(f => f !== id); 
            else STATE.favoritos.push(id); 
            localStorage.setItem('banca_favs', JSON.stringify(STATE.favoritos)); renderLoja(); 
        }
        else if (action === 'open-historico') {
            renderHistorico();
            openModal('modal-historico');
        }
        else if (action === 'repetir-pedido') {
            repetirPedido(id);
        }
        return;
    }

    const fecharTarget = e.target.closest('[data-fechar]');
    if (fecharTarget) {
        const modalId = fecharTarget.dataset.fechar;
        closeModal(modalId);
        
        if (history.state && history.state.modal === modalId) {
            history.back();
        } else if (window.location.hash === `#${modalId}`) {
            history.replaceState(null, '', ' ');
        }
        return;
    }
});

// Tratamento suave de input de quantidade
document.getElementById('carrinho-itens').addEventListener('input', (e) => {
    if(e.target.classList.contains('qtd-input')) {
        const id = e.target.dataset.id;
        const p = STATE.produtos.find(x => x.id === id);
        let val = parseFloat(e.target.value.replace(',', '.'));
        
        // Se o valor for inválido durante a digitação, ignora sem quebrar o estado local
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
        if (e.state.modal) {
            const m = document.getElementById(e.state.modal);
            if (m) m.classList.add('aberto');
        }
        if (e.state.cart) {
            document.getElementById('carrinho').classList.add('aberto');
            document.getElementById('carrinho-overlay').classList.add('aberto');
        }
    }
});

const toggleCartMobile = (abrir) => {
    if(window.innerWidth > 900) return;
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
    if (confirm("Tem certeza que deseja esvaziar todo o pedido?")) {
        STATE.carrinho = []; 
        localStorage.setItem('banca_cart', JSON.stringify({v: CART_VERSION, items: []})); 
        renderCarrinhoCompleto(); 
        showToast("🛒 Carrinho esvaziado!");
        
        if (window.innerWidth <= 900 && document.getElementById('carrinho').classList.contains('aberto')) {
            history.back();
        }
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
        lista.innerHTML = `<div class="empty-state">${iconeHistoricoVazio}<p>Sem pedidos anteriores</p><span>Você ainda não fez nenhum pedido.</span></div>`;
        return;
    }
    
    lista.innerHTML = meusPedidos.map(p => `
        <article style="border: 1px solid var(--parchment); border-radius: 12px; padding: 16px; margin-bottom: 12px; background:var(--warm-white);">
            <div style="display:flex; justify-content: space-between; margin-bottom: 8px;">
                <strong style="color:var(--forest);">${new Date(p.data).toLocaleDateString('pt-BR')}</strong>
                <span style="color:var(--forest); font-weight:900;">${fmt(p.total)}</span>
            </div>
            <p style="font-size:0.9rem; color:var(--text-mid); line-height:1.4;">${escapeHTML(p.descItens || 'Itens do pedido')}</p>
            <button class="btn btn-outline" style="width:100%; margin-top:14px; padding:10px;" data-action="repetir-pedido" data-id="${p.id}">Repetir Pedido</button>
        </article>
    `).join('');
};

const repetirPedido = (pedId) => {
    const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
    const ped = meusPedidos.find(p => p.id === String(pedId) || p.id === Number(pedId)); // Garante compatibilidade de tipo
    if(ped && ped.itens) {
        STATE.carrinho = [];
        ped.itens.forEach(i => {
            const prodInfo = STATE.produtos.find(px => px.id === i.id);
            if(prodInfo && prodInfo.ativo) STATE.carrinho.push({...prodInfo, qtd: i.qtd});
        });
        persistirCarrinhoComDebounce();
        renderCarrinhoCompleto();
        closeModal('modal-historico');
        showToast('🛒 Itens adicionados ao carrinho!');
    }
};

document.getElementById('cli-pagamento').addEventListener('change', (e) => { 
    const isDinheiro = e.target.value === 'Dinheiro';
    document.getElementById('troco-group').style.display = isDinheiro ? 'block' : 'none'; 
    if(!isDinheiro) document.getElementById('cli-troco').value = '';
});

// ----------------------------------------------------
// INTEGRAÇÃO SERVERLESS SEGURA (Vercel API)
// ----------------------------------------------------
document.getElementById('btn-enviar-pedido').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;

    const nome = document.getElementById('cli-nome').value.trim();
    const quadra = document.getElementById('cli-quadra').value.trim();
    const lote = document.getElementById('cli-lote').value.trim();
    const pag = document.getElementById('cli-pagamento').value;
    const trocoRaw = document.getElementById('cli-troco').value.trim();
    const obs = document.getElementById('cli-obs').value.trim();

    if(!nome || !quadra || !lote) { showToast("⚠️ Preencha nome, quadra e lote!"); return; }

    btn.disabled = true; 
    btn.textContent = 'Processando pedido... ⏳';

    try {
        // Envia apenas o payload mínimo (Trust No Client)
        const payload = {
            nome, quadra, lote, pag, troco: trocoRaw, obs,
            itens: STATE.carrinho.map(item => ({ id: item.id, qtd: item.qtd }))
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // Timeout de 10s para redes 3G ruins

        const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // CORREÇÃO CRÍTICA: Intercepta erros 500 do Vercel sem quebrar o JSON parser
        const contentType = response.headers.get("content-type");
        let data;
        
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            const erroCru = await response.text();
            console.error("Vercel Crash Log:", erroCru);
            throw new Error("O servidor (Vercel) falhou. Verifique os logs na Vercel.");
        }

        if (!response.ok || !data.sucesso) {
            throw new Error(data.error || "Falha ao processar pedido no servidor.");
        }

        // Salva metadados seguros no LocalStorage para o histórico
        const clientes = JSON.parse(localStorage.getItem('banca_clientes') || '[]');
        const idx = clientes.findIndex(c => c.nome.toLowerCase() === nome.toLowerCase());
        if(idx >= 0) { clientes[idx] = {nome, quadra, lote}; } else { clientes.unshift({nome, quadra, lote}); }
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

        // Redireciona com segurança
        window.open(data.pedido.whatsappMsg, '_blank');
        
        closeModal('modal-checkout');
        setTimeout(() => openModal('modal-sucesso'), 300); 
        
        STATE.carrinho = []; 
        localStorage.setItem('banca_cart', JSON.stringify({v: CART_VERSION, items: []}));
        renderCarrinhoCompleto();
        document.getElementById('cli-obs').value = ''; 
        document.getElementById('cli-troco').value = '';

    } catch(err) {
        if(err.name === 'AbortError') showToast("Tempo esgotado. Verifique sua internet.");
        else showToast(err.message); // Exibe o erro real de falha do servidor na tela
        console.error("Falha no Checkout:", err);
    } finally {
        btn.disabled = false; 
        btn.textContent = 'Enviar Pedido 🚀';
    }
});

window.addEventListener('online', () => document.getElementById('banner-offline').classList.remove('visivel'));
window.addEventListener('offline', () => document.getElementById('banner-offline').classList.add('visivel'));

renderCarrinhoCompleto();
iniciarRealTimeSync();
