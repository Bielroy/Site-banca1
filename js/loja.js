import { db, collection, getDocs, onSnapshot, addDoc } from './firebase.js';
import { fmt, escapeHTML, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, openModal, closeModal, iconeCarrinhoVazio, iconeHistoricoVazio } from './utils.js';

const CART_VERSION = "1.2";
let STATE = {
    produtos: [], 
    carrinho: [], 
    catAtiva: 'todas', 
    busca: '',
    config: { minimo: 0, wpp: '5562999999999', lojaAberta: true, diasAbertos: [0,1,2,3,4,5,6] },
    favoritos: JSON.parse(localStorage.getItem('banca_favs') || '[]')
};

// Resgata carrinho persistente
try { 
    const raw = localStorage.getItem('banca_cart');
    if(raw) { const parsed = JSON.parse(raw); if(parsed.v === CART_VERSION) STATE.carrinho = parsed.items; }
} catch(e) {}

const getCartQty = (id) => { const item = STATE.carrinho.find(x => x.id === id); return item ? item.qtd : 0; };

// ----------------------------------------------------
// GERENCIAMENTO DE DOM (Sem InnerHTML Thrashing)
// ----------------------------------------------------

const atualizarBadgesDOM = (produtoId, qtd) => {
    const badge = document.getElementById(`badge-${produtoId}`);
    if(badge) {
        const prod = STATE.produtos.find(p => p.id === produtoId);
        badge.textContent = isFracionavel(prod?.unidade) && qtd > 0 ? formatarQuantidadeVisual(qtd, true) : qtd;
        qtd > 0 ? badge.classList.add('visivel') : badge.classList.remove('visivel');
    }
};

const atualizarLinhaCarrinhoDOM = (id, novaQtd, subtotalFmt) => {
    const row = document.getElementById(`cart-row-${id}`);
    if(novaQtd <= 0) {
        if(row) row.remove();
        if(STATE.carrinho.length === 0) renderCarrinhoCompleto(); // Se zerou tudo, mostra empty state
    } else {
        if(!row) {
            renderCarrinhoCompleto(); // Se a linha não existe, renderiza tudo com segurança
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
        btnF.disabled = true; btnF.textContent = "Loja Fechada";
        bannerMin.classList.remove('visivel'); bannerFechado.classList.add('visivel');
    } else { 
        bannerFechado.classList.remove('visivel'); 
        if (STATE.config.minimo > 0 && total < STATE.config.minimo && STATE.carrinho.length > 0) { 
            btnF.disabled = true; btnF.textContent = `Falta ${fmt(STATE.config.minimo - total)}`;
            bannerMin.textContent = `⚠️ Valor mínimo para pedido: ${fmt(STATE.config.minimo)}`; 
            bannerMin.classList.add('visivel'); 
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
    
    if (STATE.carrinho.length === 0) {
        cont.innerHTML = `<div class="empty-state">${iconeCarrinhoVazio}<p>Seu pedido está vazio</p><span>Adicione produtos para começar.</span></div>`;
        atualizarRodapeCarrinhoDOM();
        return;
    }

    let html = '';
    STATE.carrinho.forEach(item => {
        const sub = item.preco * item.qtd; 
        const fracionavel = isFracionavel(item.unidade);
        const step = fracionavel ? "0.1" : "1";
        
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
        if (novaQtd > 99) novaQtd = 99; 
        
        if (novaQtd <= 0) {
            STATE.carrinho.splice(idx, 1); 
        } else {
            STATE.carrinho[idx].qtd = novaQtd;
        }
    } else if (valParaAplicar > 0) { 
        novaQtd = fixFloat(fixo ? valParaAplicar : 1);
        if (novaQtd > 99) novaQtd = 99;
        STATE.carrinho.push({...p, qtd: novaQtd}); 
    }
    
    localStorage.setItem('banca_cart', JSON.stringify({v: CART_VERSION, items: STATE.carrinho})); 
    
    // Atualização Fina no DOM (Performance máxima)
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

    // Usando lazy loading nativo nas imagens
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
// INTEGRAÇÃO FIREBASE (Real-time Snapshot)
// ----------------------------------------------------
let unsubscribeProdutos = null;

const iniciarRealTimeSync = () => {
    if (!navigator.onLine) { document.getElementById('banner-offline').classList.add('visivel'); }
    
    // Configurações Globais da Loja
    onSnapshot(collection(db, "loja"), (snap) => {
        snap.forEach(d => { if(d.id === 'config') STATE.config = {...STATE.config, ...d.data()}; });
        atualizarRodapeCarrinhoDOM();
    });

    // Produtos em Tempo Real
    unsubscribeProdutos = onSnapshot(collection(db, "produtos"), (snap) => {
        STATE.produtos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderCategorias(); 
        renderLoja(); 
        // Não apaga o carrinho do usuário se o produto mudar (UX amigável), 
        // mas atualiza os crachás na loja.
        STATE.carrinho.forEach(item => { atualizarBadgesDOM(item.id, item.qtd); });
    }, (error) => {
        console.error("Erro Realtime:", error);
    });
};

// ----------------------------------------------------
// EVENT LISTENERS DELEGADOS E MODAIS
// ----------------------------------------------------
document.body.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]'); 
    if (!target) return;
    
    const action = target.dataset.action;
    const id = target.dataset.id;
    
    if (action === 'add' || action === 'inc') { 
        modificarCarrinho(id, 1); 
        if(action === 'add') animarFeedbackBtn(target); 
    }
    else if (action === 'dec') { modificarCarrinho(id, -1); }
    else if (action === 'cat') { STATE.catAtiva = target.dataset.cat; renderCategorias(); renderLoja(); }
    else if (action === 'fav') { 
        if(STATE.favoritos.includes(id)) STATE.favoritos = STATE.favoritos.filter(f => f !== id); 
        else STATE.favoritos.push(id); 
        localStorage.setItem('banca_favs', JSON.stringify(STATE.favoritos)); renderLoja(); 
    }
    else if (action === 'open-historico') {
        renderHistorico();
        openModal('modal-historico');
    }
});

// Listener Fino para o Input do Carrinho
document.getElementById('carrinho-itens').addEventListener('change', (e) => {
    if(e.target.classList.contains('qtd-input')) {
        const id = e.target.dataset.id;
        const p = STATE.produtos.find(x => x.id === id);
        let val = parseFloat(e.target.value.replace(',', '.'));
        if(isNaN(val) || val < 0) val = 0;
        
        val = (p && !isFracionavel(p.unidade)) ? Math.round(val) : fixFloat(val);
        modificarCarrinho(id, val, true);
    }
});

// HISTORY API PARA MODAIS (Corrige botão voltar)
window.addEventListener('popstate', (e) => { 
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('aberto'));
    document.getElementById('carrinho-overlay').classList.remove('aberto');
    document.getElementById('carrinho').classList.remove('aberto');

    if (e.state && e.state.modal) document.getElementById(e.state.modal).classList.add('aberto');
    if (e.state && e.state.cart) {
        document.getElementById('carrinho').classList.add('aberto');
        document.getElementById('carrinho-overlay').classList.add('aberto');
    }
});

document.querySelectorAll('[data-fechar]').forEach(btn => { 
    btn.addEventListener('click', (e) => { 
        history.back(); // Invoca o popstate que fecha os modais nativamente
    }); 
});

// Controle do Carrinho Mobile
const toggleCartMobile = (abrir) => {
    if(window.innerWidth > 900) return;
    if (abrir) { 
        document.getElementById('carrinho').classList.add('aberto'); 
        document.getElementById('carrinho-overlay').classList.add('aberto'); 
        history.pushState({cart: true}, ''); 
    } else { 
        history.back();
    }
};
document.getElementById('btn-carrinho-mobile').addEventListener('click', () => toggleCartMobile(true));
document.getElementById('carrinho-overlay').addEventListener('click', () => history.back());

// Ações do Carrinho
document.getElementById('btn-limpar-carrinho').addEventListener('click', () => {
    if (STATE.carrinho.length === 0) return;
    if (confirm("Tem certeza que deseja esvaziar todo o pedido?")) {
        STATE.carrinho = []; localStorage.removeItem('banca_cart'); 
        renderCarrinhoCompleto(); showToast("🛒 Carrinho esvaziado!");
        if (window.innerWidth <= 900) history.back();
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

// HISTÓRICO DE PEDIDOS
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
            <p style="font-size:0.9rem; color:var(--text-mid); line-height:1.4;">${escapeHTML(p.descItens)}</p>
            <button class="btn btn-outline" style="width:100%; margin-top:14px; padding:10px;" onclick="window.repetirPedido(${p.id})">Repetir Pedido</button>
        </article>
    `).join('');
};

window.repetirPedido = (pedId) => {
    const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
    const ped = meusPedidos.find(p => p.id === pedId);
    if(ped) {
        STATE.carrinho = [];
        ped.itens.forEach(i => {
            const prodInfo = STATE.produtos.find(px => px.id === i.id);
            if(prodInfo && prodInfo.ativo) STATE.carrinho.push({...prodInfo, qtd: i.qtd});
        });
        localStorage.setItem('banca_cart', JSON.stringify({v: CART_VERSION, items: STATE.carrinho}));
        renderCarrinhoCompleto();
        history.back(); // Fecha modal
        showToast('🛒 Itens adicionados ao carrinho!');
    }
};

// CHECKOUT E VALIDAÇÃO DE SEGURANÇA (Garantindo preço do Banco de Dados)
document.getElementById('cli-pagamento').addEventListener('change', (e) => { 
    document.getElementById('troco-group').style.display = e.target.value === 'Dinheiro' ? 'block' : 'none'; 
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

    if(!nome || !quadra || !lote) { showToast("⚠️ Preencha nome, quadra e lote!"); return; }

    btn.disabled = true; btn.textContent = 'Autenticando valores...';

    try {
        // SEGURANÇA: Busca o valor oficial no banco ANTES de enviar o zap
        const snapRef = await getDocs(collection(db, "produtos"));
        const dbProdutosSeguros = snapRef.docs.map(d => ({id: d.id, ...d.data()}));

        let totalReal = 0;
        let msg = `*NOVO PEDIDO*\n👤 ${nome}\n📍 Q${quadra} L${lote}\n💳 Pagamento: ${pag}\n\n*ITENS:*\n`;

        const itensValidados = STATE.carrinho.map(itemCart => {
            const prodOficial = dbProdutosSeguros.find(p => p.id === itemCart.id);
            if (!prodOficial) throw new Error(`Produto ${itemCart.nome} não existe mais.`);
            
            const precoSeguro = prodOficial.preco;
            const subtotal = precoSeguro * itemCart.qtd;
            totalReal += subtotal;
            
            const isKg = isFracionavel(prodOficial.unidade);
            const qtdStr = isKg ? `${formatarQuantidadeVisual(itemCart.qtd, true)} ${prodOficial.unidade || 'kg'}` : `${itemCart.qtd}x`;
            
            msg += `• ${qtdStr} ${prodOficial.nome} - ${fmt(subtotal)}\n`;
            return { id: itemCart.id, nome: prodOficial.nome, qtd: itemCart.qtd, preco: precoSeguro, unidade: prodOficial.unidade };
        });

        if (pag === 'Dinheiro') {
            const trocoNum = parseFloat(trocoRaw.replace(',', '.')); 
            if (isNaN(trocoNum) || trocoNum < totalReal) {
                showToast("⚠️ O valor do troco deve ser maior que o total da compra.");
                btn.disabled = false; btn.textContent = 'Enviar Pedido via WhatsApp 🚀';
                return;
            }
            msg = msg.replace(`Pagamento: ${pag}`, `Pagamento: ${pag} (Troco para: R$ ${trocoNum.toFixed(2).replace('.',',')})`);
        }

        msg += `\n*TOTAL: ${fmt(totalReal)}*`;
        if (obs) msg += `\n\n📝 *Obs:* ${obs}`;

        // Salva cliente local
        const clientes = JSON.parse(localStorage.getItem('banca_clientes') || '[]');
        const idx = clientes.findIndex(c => c.nome.toLowerCase() === nome.toLowerCase());
        if(idx >= 0) { clientes[idx] = {nome, quadra, lote}; } else { clientes.unshift({nome, quadra, lote}); }
        localStorage.setItem('banca_clientes', JSON.stringify(clientes.slice(0, 5)));

        // Salva histórico
        const meusPedidos = JSON.parse(localStorage.getItem('banca_meus_pedidos') || '[]');
        meusPedidos.unshift({
            id: Date.now(), data: new Date().toISOString(), total: totalReal,
            descItens: itensValidados.map(i => isFracionavel(i.unidade) ? `${formatarQuantidadeVisual(i.qtd, true)}${i.unidade} ${i.nome}` : `${i.qtd}x ${i.nome}`).join(', '),
            itens: itensValidados
        });
        localStorage.setItem('banca_meus_pedidos', JSON.stringify(meusPedidos.slice(0, 10)));

        // Salva Firebase Assíncrono
        addDoc(collection(db, "pedidos"), { nome, quadra, lote, pag, troco: trocoRaw, obs, total: totalReal, itens: itensValidados, data: new Date().toISOString() });

        // Abre WhatsApp e Limpa
        window.open(`https://wa.me/${STATE.config.wpp}?text=${encodeURIComponent(msg)}`, '_blank');
        
        history.back(); // Fecha checkout
        setTimeout(() => openModal('modal-sucesso'), 300); // Abre Sucesso
        
        STATE.carrinho = []; localStorage.removeItem('banca_cart'); 
        renderCarrinhoCompleto();
        document.getElementById('cli-obs').value = ''; document.getElementById('cli-troco').value = '';

    } catch(err) {
        showToast("Erro ao validar produtos. Tente recarregar.");
        console.error(err);
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar Pedido via WhatsApp 🚀';
    }
});

// Inicialização
window.addEventListener('online', () => { document.getElementById('banner-offline').classList.remove('visivel'); });
window.addEventListener('offline', () => document.getElementById('banner-offline').classList.add('visivel'));

renderCarrinhoCompleto();
iniciarRealTimeSync();
