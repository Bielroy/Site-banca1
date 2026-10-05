import { db, auth, collection, onSnapshot, signInAnonymously, onAuthStateChanged, doc, getDoc } from './firebase.js';
import { tcol, tdoc, chave, TENANT, ehLojaOriginal, fichaRef, pastaFotos, urlDaLoja } from './tenant.js';
import { fmt, escapeHTML, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, hapticFeedback, openModal, closeModal, iconeCarrinhoVazio, iconeHistoricoVazio, customConfirm, dbStorage } from './utils.js';
import { initIA } from './ia.js';
import { iniciarRanking, aplicarOrdem, scoreDe, destaques } from './ranking-loja.js';
import './melhorias-ui.js';
import { ICO } from './icones.js';
import { iniciarTema } from './tema.js';
import { criarCamposEndereco, linhaEndereco, lerEnderecoSalvo, salvarEndereco } from './endereco.js';
import { iniciarCategorias, aplicarCategorias, abasDeCategoria, assinaturaCategorias } from './categorias-loja.js';

const CART_VERSION = "3.0"; // Atualizado para suportar o Carrinho Híbrido
let unsubscribes = []; 

const STATE = {
    uid: null, produtos: [], carrinho: [], catAtiva: 'todas', busca: '',
    config: { minimo: 0, wpp: '5562999999999', lojaAberta: true, diasAbertos: [0,1,2,3,4,5,6] },
    favoritos: JSON.parse(localStorage.getItem(chave('banca_favs')) || '[]'),
    lojaRenderizada: false, checkoutSessionId: null, historicoChat: [],
    modalProdutoAtual: null, modalTipoCompra: 'kg', modalQtd: 1 // Estado do seletor do modal
};

// Celular = carrinho em gaveta. Tem de ser a MESMA medida do CSS (600px);
// antes o JS usava 900px e travava a rolagem entre 601 e 900px (celular deitado).
const ehCelular = () => window.matchMedia('(max-width: 600px)').matches;
const semAcento = (t) => String(t || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// crypto.randomUUID não existe em iPhone antigo / navegador dentro de app
const novoId = () => (crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

let inatividadeTimer;
const resetInatividadeTimer = () => {
    clearTimeout(inatividadeTimer);
    if (STATE.carrinho.length > 0 && !document.getElementById('modal-checkout')?.classList.contains('aberto') && !document.getElementById('modal-ia-chat')?.classList.contains('aberto')) {
        inatividadeTimer = setTimeout(() => {
            showToast("🧺 Quer uma ideia de receita com o que já está no pedido? Toque no Ajudante.", false);
            const btnIA = document.getElementById('btn-ia-flutuante');
            if(btnIA) { btnIA.classList.add('pulse-anim'); setTimeout(() => btnIA.classList.remove('pulse-anim'), 10000); }
        }, 180000); 
    }
};
['click', 'touchstart', 'scroll', 'keydown'].forEach(evt => document.addEventListener(evt, resetInatividadeTimer, { passive: true }));

const carregarCarrinhoDB = async () => {
    try { 
        const raw = await dbStorage.get(chave('banca_cart'));
        if(raw && raw.v === CART_VERSION && Array.isArray(raw.items)) { STATE.carrinho = raw.items; resetInatividadeTimer(); }
    } catch(e) {}
    renderCarrinhoCompleto();   // desenha também o "pedido vazio" na primeira visita
};
carregarCarrinhoDB(); 

let realTimeSyncIniciado = false;
onAuthStateChanged(auth, (user) => {
    if (user) {
        STATE.uid = user.uid;
        if (!realTimeSyncIniciado) { iniciarRealTimeSync(); realTimeSyncIniciado = true; }
        iniciarRanking(); // ordena a vitrine para este cliente (falha em silêncio)
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
        persistirCarrinhoComDebounce();
        // [PATCH 2] Não reconstrói o carrinho inteiro se o cliente está digitando a quantidade
        const editando = document.activeElement?.classList.contains('qtd-input');
        if (editando) atualizarRodapeCarrinhoDOM(); else renderCarrinhoCompleto();
        if (itensRemovidos > 0) showToast(`⚠️ ${itensRemovidos} item(ns) esgotaram.`, true);
    }
};

const getCartQty = (id) => { const item = STATE.carrinho.find(x => x.id === id); return item ? item.qtd : 0; };

// ---------------------------------------------------------------------
// ITENS "A PESAR" — pedido em unidades de um produto vendido por quilo.
// O valor só fecha na balança. Se o produto tem "peso médio" cadastrado
// no painel, mostramos uma ESTIMATIVA (sempre com o sinal ≈).
// ---------------------------------------------------------------------
const ehAPesar = (item) => item.tipo === 'un' && isFracionavel(item.unidade);
const pesoMedioDe = (item) => Number((STATE.produtos.find(p => p.id === item.id) || item).pesoMedio || 0);
const valorEstimado = (item) => { const pm = pesoMedioDe(item); return pm > 0 ? (item.preco * pm / 1000) * item.qtd : null; };

const textoQtdCard = (item) => {
    const frac = isFracionavel(item.unidade);
    if (frac && item.tipo !== 'un') return `${formatarQuantidadeVisual(item.qtd, true)} ${String(item.unidade || 'kg').toLowerCase()}`;
    return `${item.qtd} ${!frac && item.unidade && item.unidade !== 'un' ? item.unidade : 'un'}`;
};

// Área de ação do card: botão "Adicionar" que vira o seletor [ − 2 un + ].
// (o nome antigo da função foi mantido porque várias partes já a chamam)
const atualizarBadgesDOM = (produtoId, _qtd, animar = false) => {
    // o mesmo produto pode aparecer duas vezes: na vitrine e na faixa "Seus de sempre"
    document.querySelectorAll(`[data-acao="${CSS.escape(String(produtoId))}"]`).forEach(area => pintarAcao(area, produtoId, animar));
};
const pintarAcao = (area, produtoId, animar) => {
    const item = STATE.carrinho.find(x => x.id === produtoId);
    area.closest('.produto-card')?.classList.toggle('na-sacola', !!item);

    const seletor = area.querySelector('.card-qtd');
    if (item && seletor) { seletor.querySelector('output').textContent = textoQtdCard(item); return; }
    if (!item && area.querySelector('.card-add')) return;

    const tinhaFoco = area.contains(document.activeElement);
    const nome = escapeHTML((item || STATE.produtos.find(p => p.id === produtoId) || {}).nome || '');
    const classe = animar ? ' entra' : '';
    area.innerHTML = item
        ? `<div class="card-qtd${classe}">
               <button type="button" data-action="dec" data-id="${escapeHTML(produtoId)}" aria-label="Tirar um de ${nome}">−</button>
               <output aria-live="polite">${escapeHTML(textoQtdCard(item))}</output>
               <button type="button" data-action="inc" data-id="${escapeHTML(produtoId)}" aria-label="Colocar mais um de ${nome}">+</button>
           </div>`
        : `<button type="button" class="card-add${classe}" data-action="add" data-id="${escapeHTML(produtoId)}" aria-label="Adicionar ${nome}">Adicionar</button>`;
    if (tinhaFoco) area.querySelector('[data-action="inc"], .card-add')?.focus({ preventScroll: true });
};

// O produto "voa" do card até o pedido (só para quem não pediu menos movimento)
const voarParaPedido = (card) => {
    if (!card || !card.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const foto = card.querySelector('.produto-img-wrap');
    const barra = document.getElementById('btn-carrinho-mobile');
    const naBarra = barra && barra.getBoundingClientRect().width > 0;
    const alvo = naBarra ? barra.querySelector('.ico') : document.getElementById('qtd-badge');
    if (!foto || !alvo) return;
    const a = foto.getBoundingClientRect(), b = alvo.getBoundingClientRect();
    if (!b.width || b.top > window.innerHeight || b.bottom < 0) return;   // destino fora da tela: não voa

    const v = foto.cloneNode(true);
    v.querySelectorAll('button, .rec-tag').forEach(x => x.remove());
    v.className = 'voador';
    Object.assign(v.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
    document.body.appendChild(v);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = v.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.35 - 40}px) scale(.55)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0.35 },
    ], { duration: 560, easing: 'cubic-bezier(.4,0,.2,1)' });
    const chegou = () => { v.remove(); alvo.classList.remove('pulo'); void alvo.getBoundingClientRect(); alvo.classList.add('pulo'); };
    anim.onfinish = chegou; anim.oncancel = () => v.remove();
};

const precoLinhaHtml = (item) => {
    if (!ehAPesar(item)) return `<span class="item-preco">${fmt(item.preco * item.qtd)}</span>`;
    const v = valorEstimado(item);
    return v == null
        ? `<span class="item-preco item-preco--pesar">a pesar</span>`
        : `<span class="item-preco item-preco--estimado">≈ ${fmt(v)}<small>a pesar</small></span>`;
};

const atualizarLinhaCarrinhoDOM = (id, novaQtd, subtotalFmt, tipo) => {
    const row = document.getElementById(`cart-row-${id}`);
    if(novaQtd <= 0) {
        if(row) row.remove(); if(STATE.carrinho.length === 0) renderCarrinhoCompleto();
    } else {
        if(!row) { renderCarrinhoCompleto(); } 
        else {
            const input = row.querySelector('.qtd-input'); const price = row.querySelector('.item-preco');
            const prod = STATE.produtos.find(p => p.id === id);
            if(input) input.value = formatarQuantidadeVisual(novaQtd, isFracionavel(prod?.unidade) && tipo !== 'un');
            
            const item = STATE.carrinho.find(x => x.id === id);
            if (price && item) price.outerHTML = precoLinhaHtml(item);
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
        sugestoes.sort((a,b) => (scoreDe(b.id) - scoreDe(a.id)) || ((STATE.favoritos.includes(b.id) ? 1 : 0) - (STATE.favoritos.includes(a.id) ? 1 : 0)));
        const up = sugestoes[0];
        upsellCont.innerHTML = `<div class="upsell-box"><span>Que tal levar <b>${escapeHTML(up.nome)}</b>?</span><button class="btn btn-outline" style="padding: 6px 12px;" data-action="add" data-id="${escapeHTML(up.id)}">Adicionar</button></div>`;
    } else { upsellCont.innerHTML = ''; }
};

const atualizarRodapeCarrinhoDOM = () => {
    let totalExato = 0, estimado = 0, qtdDistinta = 0;
    let temItensAPesar = false, semEstimativa = false;

    STATE.carrinho.forEach(item => {
        if (ehAPesar(item)) {
            temItensAPesar = true;
            qtdDistinta += item.qtd; // Conta as unidades pedidas
            const v = valorEstimado(item);
            if (v == null) semEstimativa = true; else estimado += v;
        } else {
            totalExato += (item.preco * item.qtd);
            qtdDistinta += (isFracionavel(item.unidade) ? 1 : item.qtd);
        }
    });
    const previsto = totalExato + estimado;                 // exato + estimativa dos itens a pesar
    const aprox = temItensAPesar && !semEstimativa;         // dá para mostrar "≈ total"

    document.getElementById('total-label').textContent = temItensAPesar ? 'Total estimado' : 'Total';
    document.getElementById('total-val').innerHTML = `${aprox ? '≈ ' : ''}${fmt(previsto)}`
        + (temItensAPesar ? `<small class="total-nota">${semEstimativa ? '+ itens a pesar na balança' : 'valor final na balança'}</small>` : '');
    document.getElementById('qtd-flutuante').textContent = Math.ceil(qtdDistinta);
    // Barra "Ver pedido": some com o carrinho vazio e mostra o valor
    const barra = document.getElementById('btn-carrinho-mobile');
    if (barra) {
        barra.classList.toggle('vazio', STATE.carrinho.length === 0);
        document.body.classList.toggle('tem-pedido', STATE.carrinho.length > 0);
        let valor = barra.querySelector('.barra-valor');
        if (!valor) { valor = document.createElement('span'); valor.className = 'barra-valor'; barra.appendChild(valor); }
        valor.textContent = previsto > 0 ? (aprox ? '≈ ' : '') + fmt(previsto) + (semEstimativa ? ' +' : '') : (temItensAPesar ? 'a pesar' : '');
    }
    document.getElementById('qtd-badge').textContent = Math.ceil(qtdDistinta);

    // Pedido mínimo: vale sobre o total previsto. Só não se aplica quando há
    // item a pesar SEM estimativa (não dá para saber quanto falta).
    const minimo = Number(STATE.config.minimo) || 0;
    const medeMinimo = minimo > 0 && STATE.carrinho.length > 0 && !semEstimativa;
    const falta = medeMinimo ? Math.max(0, minimo - previsto) : 0;
    const fracao = medeMinimo ? Math.min(1, previsto / minimo) : 0;
    const caixaMin = document.getElementById('min-progresso'), barraMin = document.getElementById('barra-min');
    if (caixaMin) {
        caixaMin.hidden = !medeMinimo;
        document.getElementById('min-texto').textContent = falta > 0 ? `Faltam ${fmt(falta)} para o pedido mínimo de ${fmt(minimo)}` : 'Pedido mínimo atingido';
        document.getElementById('min-barra').style.width = `${fracao * 100}%`;
    }
    if (barraMin) { barraMin.hidden = !medeMinimo || falta <= 0; barraMin.firstElementChild.style.width = `${fracao * 100}%`; }

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
        if (falta > 0) { 
            btnF.disabled = true; btnF.textContent = `Faltam ${fmt(falta)}`;
            bannerMin.textContent = `Pedido mínimo: ${fmt(minimo)}`; bannerMin.classList.add('visivel'); 
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
    STATE.produtos.forEach(p => atualizarBadgesDOM(p.id));   // cards acompanham o pedido
    if (STATE.carrinho.length === 0) {
        cont.innerHTML = `<div class="empty-state">${iconeCarrinhoVazio}<p>Seu pedido está vazio</p><span>Adicione produtos para começar.</span></div>`;
        atualizarRodapeCarrinhoDOM(); return;
    }
    let html = '';
    STATE.carrinho.forEach(item => {
        const sub = item.preco * item.qtd; 
        const isPeso = isFracionavel(item.unidade) && item.tipo !== 'un';
        
        const precoHtml = precoLinhaHtml(item);

        html += `
        <article class="carrinho-item" id="cart-row-${escapeHTML(item.id)}">
            <div class="item-emoji">${item.foto ? `<img src="${escapeHTML(item.fotoMini || item.foto)}" alt="${escapeHTML(item.nome)}" loading="lazy" width="48" height="48">` : `<div class="item-emoji skeleton"></div>`}</div>
            <div class="item-meio">
                <h3 class="item-nome">${escapeHTML(item.nome)} </h3>
                <div class="qtd-ctrl">
                    <button class="btn-qtd" data-action="dec" data-id="${escapeHTML(item.id)}" aria-label="Diminuir ${escapeHTML(item.nome)}">−</button>
                    <input class="qtd-input" type="text" inputmode="decimal" value="${formatarQuantidadeVisual(item.qtd, isPeso)}" data-id="${escapeHTML(item.id)}" aria-label="Quantidade de ${escapeHTML(item.nome)}" enterkeyhint="done">
                    <button class="btn-qtd" data-action="inc" data-id="${escapeHTML(item.id)}" aria-label="Aumentar ${escapeHTML(item.nome)}">+</button>
                    <span class="qtd-unid">${isPeso ? escapeHTML(String(item.unidade || 'kg').toLowerCase()) : 'un'}</span>
                </div>
            </div>
            ${precoHtml}
        </article>`;
    });
    cont.innerHTML = html; atualizarRodapeCarrinhoDOM();
};

let debounceSalvarCarrinho;
const persistirCarrinhoComDebounce = () => {
    clearTimeout(debounceSalvarCarrinho);
    debounceSalvarCarrinho = setTimeout(() => { dbStorage.set(chave('banca_cart'), {v: CART_VERSION, items: STATE.carrinho}); }, 400);
};

// Modificado para aceitar o "tipo" de compra (Kg ou Un)
const modificarCarrinho = (id, delta, fixo = false, tipoCompraForcado = null) => {
    const p = STATE.produtos.find(x => x.id === id); if (!p) return;
    
    const idx = STATE.carrinho.findIndex(x => x.id === id);
    const itemAtual = idx > -1 ? STATE.carrinho[idx] : null;
    
    // Determina se a operação atual é Fracionada (Kg) ou Inteira (Unidades)
    // Produto novo no pedido entra POR UNIDADE (é como a maioria compra). Quem quer por
    // peso escolhe "Por peso" na tela do produto.
    const tipoAtual = tipoCompraForcado || (itemAtual ? itemAtual.tipo : 'un');
    const isPeso = isFracionavel(p.unidade) && tipoAtual === 'kg';
    const step = isPeso ? 0.1 : 1;
    
    let valParaAplicar = fixo ? delta : (delta > 0 ? step : -step);
    let novaQtd = 0;

    if (idx > -1) { 
        // Se o cliente mudou o tipo de compra no meio, atualizamos a tag
        if (tipoCompraForcado && itemAtual.tipo !== tipoCompraForcado) {
            STATE.carrinho[idx].tipo = tipoCompraForcado;
            STATE.carrinho[idx].qtd = valParaAplicar; // Reseta a qtd para a nova métrica
            novaQtd = fixFloat(valParaAplicar);
        } else {
            novaQtd = fixFloat(fixo ? valParaAplicar : STATE.carrinho[idx].qtd + valParaAplicar);
            if (novaQtd <= 0) STATE.carrinho.splice(idx, 1); else STATE.carrinho[idx].qtd = novaQtd;
        }
    } else if (valParaAplicar > 0) { 
        novaQtd = fixFloat(fixo ? valParaAplicar : (isPeso ? 1.0 : 1)); 
        STATE.carrinho.push({...p, qtd: novaQtd, tipo: tipoAtual}); 
    }
    
    persistirCarrinhoComDebounce(); atualizarBadgesDOM(id, novaQtd, true);
    atualizarLinhaCarrinhoDOM(id, novaQtd, fmt(p.preco * novaQtd), tipoAtual); atualizarRodapeCarrinhoDOM();
};

// Etiqueta de preço do card. A UNIDADE vem em destaque; o quilo fica de referência.
const NOME_UNIDADE = { un: 'a unidade', 'maço': 'o maço', maco: 'o maço', bdj: 'a bandeja', kit: 'o kit', kg: 'o quilo', kilo: 'o quilo', quilograma: 'o quilo', l: 'o litro', litro: 'o litro', g: 'o grama', grama: 'o grama' };
const nomeUnidade = (u) => NOME_UNIDADE[String(u || 'un').toLowerCase()] || `por ${escapeHTML(u)}`;
const etiquetaHtml = (p) => {
    const frac = isFracionavel(p.unidade), pm = Number(p.pesoMedio || 0);
    if (frac && pm > 0) {
        return `<div class="etq-preco">≈ ${fmt(p.preco * pm / 1000)} <small>a unidade</small></div>
                <div class="etq-ref">${fmt(p.preco)} ${nomeUnidade(p.unidade)} · pesado na hora</div>`;
    }
    if (frac) {
        return `<div class="etq-preco">${fmt(p.preco)} <small>${nomeUnidade(p.unidade)}</small></div>
                <div class="etq-ref">por unidade, pesamos na hora</div>`;
    }
    return `<div class="etq-preco">${fmt(p.preco)} <small>${nomeUnidade(p.unidade)}</small></div>`;
};

// Um card de produto. `rapido` = foto carregada já (os primeiros da tela).
const cardHtml = (p, rapido = false) => {
        const favActive = STATE.favoritos.includes(p.id) ? 'ativo' : '';
        return `
        <article class="produto-card" data-action="detalhe" data-id="${escapeHTML(p.id)}" data-cat="${escapeHTML(p.cat)}" data-nome="${escapeHTML(semAcento(p.nome))}" style="display: flex;">
            <div class="produto-img-wrap">
                ${p.foto ? `<img src="${escapeHTML(p.fotoMini || p.foto)}" alt="${escapeHTML(p.nome)}" loading="${rapido ? 'eager' : 'lazy'}" decoding="async" width="200" height="200">` : '<div class="produto-img-placeholder skeleton" style="width:100%;height:100%"></div>'}
                <button class="btn-fav ${favActive}" data-action="fav" data-id="${escapeHTML(p.id)}" aria-label="Favoritar ${escapeHTML(p.nome)}" aria-pressed="${favActive ? 'true' : 'false'}">${ICO.coracao}</button>
            </div>
            <div class="produto-info">
                <h3 class="produto-nome">${escapeHTML(p.nome)}</h3>
                <div class="etiqueta">${etiquetaHtml(p)}</div>
                <div class="card-acao" data-acao="${escapeHTML(p.id)}"></div>
            </div>
        </article>`;
};

const construirCardsIniciais = () => {
    const grid = document.getElementById('lista-produtos');
    grid.innerHTML = STATE.produtos.map((p, i) => cardHtml(p, i < 4)).join('');
    STATE.lojaRenderizada = true;
    renderFaixaSempre(true);
    STATE.produtos.forEach(p => atualizarBadgesDOM(p.id));
};

// ---------------------------------------------------------------------
// FAIXA "SEUS DE SEMPRE" — atalho para quem volta: os produtos que o motor
// aprendeu que esta casa leva. Sem histórico no motor, usa o último pedido
// guardado no aparelho. Some durante a busca ou dentro de uma categoria.
// ---------------------------------------------------------------------
let _faixaIds = '';
const renderFaixaSempre = (forcar = false) => {
    const faixa = document.getElementById('faixa-sempre'), lista = document.getElementById('faixa-lista');
    if (!faixa || !lista) return;
    const porId = new Map(STATE.produtos.map(p => [p.id, p]));
    let ids = destaques().filter(id => porId.has(id)), titulo = 'Seus de sempre';
    if (!ids.length) {
        try {
            const ultimo = JSON.parse(localStorage.getItem(chave('banca_meus_pedidos')) || '[]')[0];
            ids = ((ultimo && ultimo.itens) || []).map(i => i.id).filter(id => porId.has(id)).slice(0, 8);
            titulo = 'Do seu último pedido';
        } catch (_) { ids = []; }
    }
    const visivel = ids.length >= 2 && !semAcento(STATE.busca).trim() && STATE.catAtiva === 'todas';
    faixa.hidden = !visivel;
    const assinatura = ids.join('|');
    if (!visivel || (!forcar && assinatura === _faixaIds)) return;
    _faixaIds = assinatura;
    document.getElementById('faixa-titulo').textContent = titulo;
    lista.innerHTML = ids.map(id => cardHtml(porId.get(id), true)).join('');
    ids.forEach(id => atualizarBadgesDOM(id));
};
document.addEventListener('ranking-pronto', () => renderFaixaSempre());

const renderLoja = (forcarRebuild = false) => {
    const grid = document.getElementById('lista-produtos');
    if(!STATE.lojaRenderizada || forcarRebuild) construirCardsIniciais();
    renderFaixaSempre();
    const termo = semAcento(STATE.busca).trim();
    const cards = grid.querySelectorAll('.produto-card');
    let itensVisiveis = 0;

    cards.forEach(card => {
        const matchBusca = (card.dataset.nome || '').includes(termo);
        // [PATCH 1] Favoritos: usar card.dataset.id (o data-id existe; produtoId não existia)
        const matchCat = !!termo || (STATE.catAtiva === 'todas') || (STATE.catAtiva === 'favoritos' && STATE.favoritos.includes(card.dataset.id)) || (card.dataset.cat === STATE.catAtiva);
        if(matchBusca && matchCat) { card.style.display = 'flex'; itensVisiveis++; } 
        else { card.style.display = 'none'; }
    });
    // aviso de "nada aqui": sempre refeito, para o texto acompanhar busca/aba
    document.getElementById('empty-grid-msg')?.remove();
    if (itensVisiveis === 0 && cards.length > 0) {
        const titulo = termo ? 'Não achei esse produto' : (STATE.catAtiva === 'favoritos' ? 'Nenhum favorito ainda' : 'Nenhum produto aqui hoje');
        const dica = termo ? 'Tente outro nome.' : (STATE.catAtiva === 'favoritos' ? 'Toque no coração de um produto para guardar aqui.' : '');
        grid.insertAdjacentHTML('beforeend', `<div id="empty-grid-msg" class="empty-state" style="grid-column: 1/-1;">${iconeHistoricoVazio}<p>${titulo}</p><span>${dica}</span></div>`);
    } else if (cards.length === 0) {
        grid.insertAdjacentHTML('beforeend', `<div id="empty-grid-msg" class="empty-state" style="grid-column: 1/-1;">${iconeHistoricoVazio}<p>A banca está sem produtos no momento</p><span>Volte daqui a pouco.</span></div>`);
    }
};

// Pedido com itens de mais de um atendimento (ex.: banca + artesanais) gera
// um botão por número. Com um só número, abre direto como sempre foi.
const mostrarLinksWhatsApp = (pedido) => {
    const links = (pedido.whatsapps && pedido.whatsapps.length) ? pedido.whatsapps : [{ nome: 'WhatsApp', url: pedido.whatsappMsg }];
    const area = document.getElementById('sucesso-whatsapps');
    const texto = document.getElementById('sucesso-texto');
    if (area) {
        area.innerHTML = links.map((l, i) => `<a class="btn-wpp" href="${escapeHTML(l.url)}" target="_blank" rel="noopener noreferrer">${links.length > 1 ? `Enviar para ${escapeHTML(l.nome)}` : 'Abrir WhatsApp'}${l.qtdItens && links.length > 1 ? ` <small>(${l.qtdItens} ${l.qtdItens === 1 ? 'item' : 'itens'})</small>` : ''}</a>`).join('');
        area.onclick = (e) => {
            const a = e.target.closest('.btn-wpp'); if (!a) return;
            a.classList.add('enviado');
            const faltam = area.querySelectorAll('.btn-wpp:not(.enviado)').length;
            if (texto && links.length > 1) texto.textContent = faltam
                ? `Falta enviar ${faltam === 1 ? 'a outra parte' : `${faltam} partes`}: volte aqui e toque no botão verde.`
                : 'Pronto! Todas as partes do pedido foram para o WhatsApp.';
        };
    }
    if (texto) texto.textContent = links.length > 1
        ? `Seu pedido tem itens de ${links.length} atendimentos da banca. Toque nos ${links.length} botões, um de cada vez, para enviar tudo:`
        : 'Vamos abrir o WhatsApp da banca com o seu pedido pronto. Se não abrir sozinho, toque no botão abaixo.';
    if (links.length === 1) window.open(links[0].url, '_blank');
};

const renderCategorias = () => {
    const abas = [{ chave: 'todas', nome: 'Todos' }, { chave: 'favoritos', nome: 'Favoritos' }, ...abasDeCategoria(STATE.produtos)];
    // se a categoria aberta sumiu (ocultada no painel), volta para "Todos"
    if (!abas.some(a => a.chave === STATE.catAtiva)) STATE.catAtiva = 'todas';
    document.getElementById('categorias').innerHTML = abas.map(a => `<button class="cat-btn ${a.chave === STATE.catAtiva ? 'active' : ''}" data-action="cat" data-cat="${escapeHTML(a.chave)}">${escapeHTML(a.nome)}</button>`).join('');
};

let buscaTimeout;
document.getElementById('busca-input').addEventListener('input', (e) => {
    clearTimeout(buscaTimeout); buscaTimeout = setTimeout(() => { STATE.busca = e.target.value; renderLoja(); }, 150);
});

const iniciarRealTimeSync = () => {
    renderSkeletons();
    const unsubConfig = onSnapshot(tdoc("loja", "config"), (snap) => {
        if(snap.exists()) STATE.config = {...STATE.config, ...snap.data()}; atualizarRodapeCarrinhoDOM();
        endCheckout.definirLista(STATE.config.condominios); endTopo.definirLista(STATE.config.condominios);
    }, (e) => console.warn('[loja] config:', e?.code || e));
    unsubscribes.push(unsubConfig);

    // [PATCH 3] Só reconstrói o grid quando o catálogo realmente muda (evita reflows/lag)
    let _assinaturaProdutos = '';
    let _produtosBrutos = [];
    let _catsProntas = false;      // espera a 1ª resposta das categorias p/ não "piscar" produto de categoria oculta
    // Junta produtos + categorias do painel (ocultas somem; renomear/ordenar reflete na hora)
    const aplicarCatalogo = () => {
        if (!_catsProntas) return;
        STATE.produtos = aplicarCategorias(_produtosBrutos);
        const assinatura = STATE.produtos.map(p => `${p.id}:${p.preco}:${p.foto || ''}:${p.nome}:${p.cat}`).join('|') + '#' + assinaturaCategorias();
        if (assinatura !== _assinaturaProdutos) {
            renderCategorias(); renderLoja(true); _assinaturaProdutos = assinatura;
            aplicarOrdem();
        }
        syncCarrinhoComPrecosAoVivo();
        STATE.carrinho.forEach(item => { atualizarBadgesDOM(item.id, item.qtd); });
    };
    const unsubProdutos = onSnapshot(tcol("produtos"), (snap) => {
        _produtosBrutos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => p.ativo && !p.soInsumo);   // ingrediente de receita não vai para a vitrine
        aplicarCatalogo();
    }, (e) => {
        console.warn('[loja] produtos:', e?.code || e);
        if (STATE.lojaRenderizada) return;      // já tem vitrine na tela: mantém
        document.getElementById('lista-produtos').innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">${iconeHistoricoVazio}<p>Não consegui carregar os produtos</p><span>Verifique a internet e tente de novo.</span><button class="btn btn-primary" style="margin-top:14px" data-action="recarregar">Tentar de novo</button></div>`;
    });
    unsubscribes.push(unsubProdutos);
    unsubscribes.push(iniciarCategorias(() => { _catsProntas = true; aplicarCatalogo(); }));
    setTimeout(() => { if (!_catsProntas) { _catsProntas = true; aplicarCatalogo(); } }, 2500);   // offline/sem resposta: segue sem categorias
};

// ==========================================
// O NOVO MODAL COM O SLIDER (QUILO VS UNIDADE)
// ==========================================
const injetarModalDetalheSeNecessario = () => {
    if(document.getElementById('modal-detalhe-produto')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="modal-detalhe-produto" role="dialog" aria-modal="true" aria-labelledby="md-nome" aria-hidden="true">
            <div class="modal modal-produto">
                <button class="btn-fechar md-fechar-flutuante" data-fechar="modal-detalhe-produto" aria-label="Fechar">&times;</button>

                <div class="md-hero">
                    <img id="md-img" src="" alt="">
                    <span id="md-tag" class="md-tag"></span>
                </div>

                <div class="modal-body md-corpo">
                    <h2 id="md-nome">Produto</h2>
                    <p id="md-desc" class="md-desc"></p>
                    <div class="md-preco-base"><span id="md-preco"></span></div>

                    <!-- Seletor de modo: Quilo x Unidade -->
                    <div id="md-tipo-compra-container" class="md-segmented" role="tablist" aria-label="Como você quer comprar">
                        <span class="md-segmented-pill" id="md-pill"></span>
                        <button class="btn-tipo-compra active" data-tipo="un" role="tab" aria-selected="true">
                            <span class="md-seg-ico">${ICO.unidade}</span><span>Por unidade</span>
                        </button>
                        <button class="btn-tipo-compra" data-tipo="kg" role="tab" aria-selected="false">
                            <span class="md-seg-ico">${ICO.balanca}</span><span>Por peso</span>
                        </button>
                    </div>

                    <!-- Atalhos rápidos (muda conforme o modo) -->
                    <div class="md-presets" id="md-presets" role="group" aria-label="Quantidades rápidas"></div>

                    <!-- Stepper grande -->
                    <div class="md-stepper" role="group" aria-label="Ajustar quantidade">
                        <button class="md-step-btn" id="md-menos" aria-label="Diminuir">−</button>
                        <div class="md-qtd-display">
                            <input id="md-qtd" class="md-qtd-input" type="text" inputmode="decimal" value="1" aria-label="Quantidade">
                            <span class="md-qtd-unid" id="md-qtd-unid">kg</span>
                        </div>
                        <button class="md-step-btn" id="md-mais" aria-label="Aumentar">+</button>
                    </div>

                    <!-- Resumo do valor ao vivo -->
                    <div class="md-resumo" id="md-resumo" aria-live="polite"></div>
                </div>

                <div class="modal-footer md-rodape">
                    <button id="md-btn-add" class="btn btn-primary w-100 md-btn-add">Adicionar ao pedido</button>
                </div>
            </div>
        </div>
    `);

    const $ = (id) => document.getElementById(id);

    // ---------- Núcleo: recalcula presets, rótulos e preço ----------
    const PRESETS_KG = [
        { rotulo: '250g', valor: 0.25 }, { rotulo: '500g', valor: 0.5 },
        { rotulo: '1kg',  valor: 1 },    { rotulo: '2kg',  valor: 2 },
    ];
    const PRESETS_UN = [1, 2, 3, 5, 10];

    const modoPeso = () => {
        const p = STATE.modalProdutoAtual;
        return p && isFracionavel(p.unidade) && STATE.modalTipoCompra === 'kg';
    };

    const passo = () => (modoPeso() ? 0.1 : 1);

    const renderPresets = () => {
        const cont = $('md-presets');
        if (modoPeso()) {
            cont.innerHTML = PRESETS_KG.map(pr =>
                `<button class="md-preset" data-valor="${pr.valor}">${pr.rotulo}</button>`).join('');
        } else {
            cont.innerHTML = PRESETS_UN.map(n =>
                `<button class="md-preset" data-valor="${n}">${n} un</button>`).join('');
        }
        marcarPresetAtivo();
    };

    const marcarPresetAtivo = () => {
        document.querySelectorAll('#md-presets .md-preset').forEach(b => {
            b.classList.toggle('ativo', parseFloat(b.dataset.valor) === STATE.modalQtd);
        });
    };

    const atualizarResumo = () => {
        const p = STATE.modalProdutoAtual; if (!p) return;
        const qtd = STATE.modalQtd;
        const resumo = $('md-resumo');
        const btn = $('md-btn-add');
        const fracionavel = isFracionavel(p.unidade);

        $('md-qtd').value = formatarQuantidadeVisual(qtd, modoPeso());
        $('md-qtd-unid').textContent = modoPeso() ? (p.unidade || 'kg') : (qtd === 1 ? 'unidade' : 'unidades');
        $('md-menos').disabled = qtd <= passo();
        marcarPresetAtivo();

        if (fracionavel && STATE.modalTipoCompra === 'un') {
            // Pedido por unidade de item vendido a peso: preço só após a balança.
            // Se o admin cadastrou peso médio (em gramas), mostramos uma ESTIMATIVA honesta.
            const pesoMedio = Number(p.pesoMedio || 0); // gramas por unidade
            if (pesoMedio > 0) {
                const kgEstimado = (pesoMedio * qtd) / 1000;
                const valorEstimado = kgEstimado * p.preco;
                resumo.className = 'md-resumo md-resumo-estimado';
                resumo.innerHTML = `
                    <div class="md-resumo-linha">
                        <span>≈ ${kgEstimado.toFixed(2).replace('.', ',')} kg</span>
                        <strong>~ ${fmt(valorEstimado)}</strong>
                    </div>
                    <small>Valor estimado. O preço final sai na balança, na hora de separar seu pedido.</small>`;
            } else {
                resumo.className = 'md-resumo md-resumo-pesar';
                resumo.innerHTML = `<small>Vamos pesar ${qtd} ${qtd === 1 ? 'unidade' : 'unidades'} e o valor final entra no seu pedido.</small>`;
            }
            btn.textContent = `Adicionar ${qtd} ${qtd === 1 ? 'unidade' : 'unidades'}`;
        } else {
            const total = p.preco * qtd;
            resumo.className = 'md-resumo md-resumo-exato';
            resumo.innerHTML = `<div class="md-resumo-linha"><span>Total</span><strong>${fmt(total)}</strong></div>`;
            btn.textContent = `Adicionar • ${fmt(total)}`;
        }
    };

    const setQtd = (valor) => {
        const min = passo();
        let v = Number(valor);
        if (!Number.isFinite(v) || v < min) v = min;
        STATE.modalQtd = modoPeso() ? fixFloat(v) : Math.round(v);
        atualizarResumo();
    };

    // Exposto para o handler que abre o modal
    window.__mdSincronizar = () => { renderPresets(); atualizarResumo(); };
    window.__mdSetQtd = setQtd;

    // ---------- Eventos ----------
    const moverPill = (btn) => {
        const pill = $('md-pill');
        const cont = $('md-tipo-compra-container');
        if (!pill || !btn || !cont) return;
        pill.style.width = `${btn.offsetWidth}px`;
        pill.style.transform = `translateX(${btn.offsetLeft - cont.clientLeft}px)`;
    };

    document.querySelectorAll('.btn-tipo-compra').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const clicado = e.currentTarget;
            document.querySelectorAll('.btn-tipo-compra').forEach(b => {
                b.classList.remove('active'); b.setAttribute('aria-selected', 'false');
            });
            clicado.classList.add('active');
            clicado.setAttribute('aria-selected', 'true');
            moverPill(clicado);
            hapticFeedback();

            STATE.modalTipoCompra = clicado.dataset.tipo;
            // Ao trocar de modo, reinicia numa quantidade que faz sentido
            STATE.modalQtd = (STATE.modalTipoCompra === 'kg') ? 1 : 1;
            renderPresets();
            atualizarResumo();
        });
    });

    $('md-presets').addEventListener('click', (e) => {
        const b = e.target.closest('.md-preset'); if (!b) return;
        setQtd(parseFloat(b.dataset.valor)); hapticFeedback();
    });

    $('md-mais').addEventListener('click', () => { setQtd(STATE.modalQtd + passo()); hapticFeedback(); });
    $('md-menos').addEventListener('click', () => { setQtd(STATE.modalQtd - passo()); hapticFeedback(); });

    $('md-qtd').addEventListener('input', (e) => {
        const v = parseFloat(String(e.target.value).replace(',', '.'));
        if (Number.isFinite(v) && v > 0) { STATE.modalQtd = modoPeso() ? fixFloat(v) : Math.round(v); atualizarResumo(); }
    });
    $('md-qtd').addEventListener('blur', () => setQtd(STATE.modalQtd));

    // Reposiciona a pilha do segmented control quando a tela muda de tamanho
    window.addEventListener('resize', () => {
        const ativo = document.querySelector('.btn-tipo-compra.active');
        if (ativo && document.getElementById('modal-detalhe-produto')?.classList.contains('aberto')) moverPill(ativo);
    });
};


// =====================================================================
// PONTE COM O SERVIDOR
//
// Duas coisas que faltavam e apareciam para a cliente como erro cru:
//
// 1) TOKEN — as APIs agora provam quem está pedindo pelo token assinado
//    do Firebase, em vez de acreditar num campo enviado pelo navegador.
//    Esta função pega o token da sessão anônima atual.
//
// 2) MENSAGEM DE ERRO — quando a internet caía no meio do envio, o
//    navegador devolvia "Failed to fetch" e isso ia direto para a tela,
//    em inglês. Agora traduzimos para algo que a pessoa entende e possa
//    resolver.
// =====================================================================

const pegarTokenSessao = async () => {
    try {
        const usuario = auth.currentUser;
        if (!usuario) return '';
        return await usuario.getIdToken();
    } catch (e) {
        return ''; // sem token a venda continua; só o cancelamento fica indisponível
    }
};

const MSG_SEM_CONEXAO = '📵 Sem conexão agora. Verifique a internet e tente de novo.';

// Traduz falhas técnicas em frases que ajudam a pessoa a agir
const mensagemDeErroAmigavel = (erro) => {
    let texto = String(erro?.message || '').trim();
    // String(new Error('')) devolve o texto "Error", que não diz nada para a
    // cliente. Se não houver mensagem de verdade, cai no texto genérico.
    if (!texto || texto === 'Error') texto = '';

    // "Failed to fetch" / "Load failed" / "NetworkError" = internet caiu
    if (/failed to fetch|load failed|networkerror|network request failed/i.test(texto)) {
        return MSG_SEM_CONEXAO;
    }
    if (/timeout|timed out|aborted/i.test(texto)) {
        return '⏳ O servidor demorou para responder. Tente de novo em instantes.';
    }
    // Os erros que o próprio servidor escreveu já vêm em português e são
    // úteis ("Este cupom já venceu", "Batata está esgotada"): repassa direto.
    if (texto) return texto;
    return 'Não consegui concluir agora. Tente de novo, por favor.';
};

// fetch com aviso antecipado de offline e tempo limite
const chamarApi = async (url, corpo, { comToken = false, limiteMs = 20000 } = {}) => {
    if (!navigator.onLine) throw new Error(MSG_SEM_CONEXAO);

    const cabecalhos = { 'Content-Type': 'application/json' };
    if (comToken) {
        const token = await pegarTokenSessao();
        if (token) cabecalhos['Authorization'] = `Bearer ${token}`;
    }

    // Sem isto, um celular com sinal fraco fica "processando" para sempre
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), limiteMs);

    try {
        const resposta = await fetch(url, {
            method: 'POST',
            headers: cabecalhos,
            body: JSON.stringify(corpo),
            signal: controle.signal,
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || 'Não foi possível concluir a operação.');
        return dados;
    } finally {
        clearTimeout(relogio);
    }
};

// =====================================================================
// MEUS PEDIDOS
//
// CORRIGIDO — ANTES ESTA TELA MOSTRAVA O VALOR ERRADO.
// O total ficava guardado no aparelho no momento do envio. Quando a banca
// pesava os itens, o valor certo era gravado no banco, mas a tela continuava
// exibindo a estimativa antiga — a cliente via um número diferente do que
// realmente pagou. Agora buscamos o pedido no banco e mostramos o valor real.
//
// Também ganhou: linha do tempo do status e cancelamento na janela inicial.
// =====================================================================

const MINUTOS_PARA_CANCELAR = 5;

const ETAPAS = [
    { chave: 'recebido',   rotulo: 'Recebido',   icone: ICO.lista },
    { chave: 'separando',  rotulo: 'Separando',  icone: ICO.balanca },
    { chave: 'a_caminho',  rotulo: 'A caminho',  icone: ICO.moto },
];

// Traduz o status do banco para a etapa da linha do tempo
const etapaDoStatus = (status) => {
    if (status === 'enviado') return 2;
    if (status === 'preparando') return 1;
    if (status === 'aguardando_pesagem') return 1;
    return 0; // pendente, aguardando_pagamento
};

const ROTULO_STATUS = {
    pendente: 'Pedido recebido',
    aguardando_pagamento: 'Aguardando o pagamento',
    aguardando_pesagem: 'Na balança',
    preparando: 'Separando seu pedido',
    enviado: 'Saiu para entrega',
    cancelado: 'Pedido cancelado',
    arquivado: 'Pedido concluído',
};

const renderLinhaDoTempo = (status) => {
    if (status === 'cancelado' || status === 'arquivado') return '';
    const atual = etapaDoStatus(status);
    const passos = ETAPAS.map((et, i) => {
        const feito = i <= atual;
        return `
            <div class="timeline-passo ${feito ? 'feito' : ''} ${i === atual ? 'atual' : ''}">
                <span class="timeline-bola">${et.icone}</span>
                <span class="timeline-rotulo">${et.rotulo}</span>
            </div>`;
    }).join('<span class="timeline-linha"></span>');
    return `<div class="timeline">${passos}</div>`;
};

const renderHistorico = async () => {
    const meusPedidos = JSON.parse(localStorage.getItem(chave('banca_meus_pedidos')) || '[]');
    const lista = document.getElementById('lista-meus-pedidos');
    if (!lista) return;

    if (meusPedidos.length === 0) {
        lista.innerHTML = `<div class="empty-state">${iconeHistoricoVazio}<p>Sem pedidos</p></div>`;
        return;
    }

    // Busca no banco os pedidos das últimas 24h, para pegar status e valor
    // atualizados. Os mais antigos ficam com o que está salvo no aparelho.
    const recentes = meusPedidos.filter(p => Date.now() - new Date(p.data).getTime() < 86400000);
    const doBanco = {};

    await Promise.all(recentes.slice(0, 5).map(async (p) => {
        try {
            const ref = await getDoc(tdoc("pedidos", p.id));
            if (ref.exists()) doBanco[p.id] = ref.data();
        } catch (e) { /* offline ou sem permissão: usa o que tem no aparelho */ }
    }));

    lista.innerHTML = meusPedidos.map(p => {
        const vivo = doBanco[p.id];
        const antigo = Date.now() - new Date(p.data).getTime() >= 86400000;
        const status = vivo ? vivo.status : (antigo ? 'arquivado' : 'pendente');

        // Valor: o do banco é a verdade. O do aparelho é só estimativa.
        const totalReal = vivo && typeof vivo.total === 'number' ? vivo.total : p.total;
        const foiPesado = vivo && vivo.temItensAPesar === false && p.total !== totalReal;

        const minutos = (Date.now() - new Date(p.data).getTime()) / 60000;
        const podeCancelar = vivo
            && ['pendente', 'aguardando_pesagem', 'aguardando_pagamento'].includes(status)
            && !(vivo.pagamento && vivo.pagamento.status === 'PAID')
            && minutos <= MINUTOS_PARA_CANCELAR;

        const corStatus = status === 'cancelado' ? 'var(--danger)'
                        : status === 'enviado' ? 'var(--success)'
                        : 'var(--forest)';

        return `
        <article class="pedido-card ${status === 'cancelado' ? 'cancelado' : ''}">
            <div class="pedido-topo">
                <strong>${new Date(p.data).toLocaleDateString('pt-BR')}</strong>
                <span class="pedido-total">${fmt(totalReal)}</span>
            </div>

            <span class="pedido-status" style="color:${corStatus};">
                ${escapeHTML(ROTULO_STATUS[status] || status)}
            </span>

            ${foiPesado ? '<p class="pedido-aviso-peso">Valor final já com os itens pesados</p>' : ''}

            ${renderLinhaDoTempo(status)}

            <p class="pedido-itens">${escapeHTML(p.descItens || 'Itens do pedido')}</p>

            <div class="pedido-acoes">
                <button class="btn btn-outline flex-1" data-action="repetir-pedido" data-id="${escapeHTML(p.id)}">Repetir pedido</button>
                ${podeCancelar ? `<button class="btn btn-danger" data-action="cancelar-pedido" data-id="${escapeHTML(p.id)}">Cancelar</button>` : ''}
            </div>
        </article>`;
    }).join('');
};

// Cancelamento pela loja: o servidor confere prazo, dono e devolve o estoque.
const cancelarPedido = async (pedidoId) => {
    const ok = await customConfirm(
        'Cancelar este pedido?',
        'Os itens voltam para o estoque da banca. Se quiser pedir de novo depois, sem problema.'
    );
    if (!ok) return;

    showToast('Cancelando...');
    try {
        // comToken: o servidor exige o token do Firebase para provar que o
        // pedido é desta sessão. Sem isso ele recusa, e é assim que deve ser.
        await chamarApi('/api/cancelar-pedido', { pedidoId }, { comToken: true });
        showToast('✅ Pedido cancelado');
        renderHistorico();
    } catch (e) {
        showToast(mensagemDeErroAmigavel(e), true);
    }
};

const repetirPedido = (pedId) => {
    const meusPedidos = JSON.parse(localStorage.getItem(chave('banca_meus_pedidos')) || '[]');
    const ped = meusPedidos.find(p => String(p.id) === String(pedId)); 
    if(!ped || !ped.itens) return;

    let itensAdicionados = 0; let itensEsgotados = []; STATE.carrinho = [];
    ped.itens.forEach(i => {
        const prodAtualizado = STATE.produtos.find(px => px.id === i.id);
        if(prodAtualizado && prodAtualizado.ativo) { STATE.carrinho.push({...prodAtualizado, qtd: i.qtd, tipo: i.tipo || 'kg'}); itensAdicionados++; } 
        else { itensEsgotados.push(i.nome || 'Produto Indisponível'); }
    });

    if (itensAdicionados > 0) {
        persistirCarrinhoComDebounce(); renderCarrinhoCompleto(); closeModal('modal-historico'); 
        if (ehCelular()) toggleCartMobile(true);
        let msgToast = "🛒 Itens adicionados com preços atualizados!";
        showToast(msgToast, itensEsgotados.length > 0);
    } else { showToast("❌ Todos os itens deste pedido encontram-se esgotados.", true); }
};

// Abre a tela do produto com a foto do card "viajando" até ela.
const transicaoFoto = (fotoCard, abrir) => {
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || semMovimento || !fotoCard) return abrir();
    fotoCard.style.viewTransitionName = 'produto-foto';
    const t = document.startViewTransition(() => {
        fotoCard.style.viewTransitionName = '';
        abrir();
        const overlay = document.getElementById('modal-detalhe-produto');
        overlay?.classList.add('sem-anim');            // a transição já anima a entrada
        const img = document.getElementById('md-img');
        if (img) img.style.viewTransitionName = 'produto-foto';
    });
    const limpar = () => {
        const img = document.getElementById('md-img'); if (img) img.style.viewTransitionName = '';
        document.getElementById('modal-detalhe-produto')?.classList.remove('sem-anim');
    };
    t.finished.then(limpar, limpar);
};

// =========================================================
// ENDEREÇO DE ENTREGA (condomínio + quadra/lote ou rua/número)
// Os campos são montados por js/endereco.js em dois lugares: no
// formulário do pedido e na tela aberta pelo botão do topo.
// =========================================================
const endCheckout = criarCamposEndereco(document.getElementById('checkout-endereco'), 'cli');
const endTopo = criarCamposEndereco(document.getElementById('endereco-campos'), 'end');
const pintarResumoEndereco = () => {
    const e = lerEnderecoSalvo();
    document.getElementById('endereco-resumo').textContent = e && e.condominio ? linhaEndereco(e, { curto: true }) : 'Escolha onde entregar';
};
pintarResumoEndereco();
document.getElementById('btn-salvar-endereco').addEventListener('click', () => {
    const falta = endTopo.validar();
    if (falta) return showToast(falta, true);
    salvarEndereco(endTopo.ler()); pintarResumoEndereco();
    closeModal('modal-endereco');
    if (history.state && history.state.modal === 'modal-endereco') history.back();
    showToast('Endereço guardado neste aparelho');
});

// =========================================================
// DELEGADOR GLOBAL
// =========================================================
document.body.addEventListener('click', async (e) => {
    
    const btnIA = e.target.closest('#btn-ia-flutuante');
    if (btnIA) { openModal('modal-ia-chat'); btnIA.classList.remove('pulse-anim'); return; }

    const btnLimpar = e.target.closest('#btn-limpar-carrinho') || e.target.closest('.btn-limpar');
    if (btnLimpar) {
        if (STATE.carrinho.length === 0) return;
        if (await customConfirm("Esvaziar Pedido", "Tem certeza que deseja esvaziar todo o pedido?")) {
            STATE.carrinho = []; dbStorage.set(chave('banca_cart'), {v: CART_VERSION, items: []}); 
            renderCarrinhoCompleto(); showToast("🛒 Carrinho esvaziado!");
            if (ehCelular() && document.getElementById('carrinho')?.classList.contains('aberto') && history.state?.cart) history.back();
        }
        return;
    }

    const fecharTarget = e.target.closest('[data-fechar]') || e.target.closest('.btn-fechar');
    if (fecharTarget) {
        let modalId = fecharTarget.dataset.fechar;
        if (!modalId) { const modalPai = fecharTarget.closest('.modal-overlay'); if (modalPai) modalId = modalPai.id; }
        if(modalId) {
            closeModal(modalId);
            if (history.state && history.state.modal === modalId) history.back();
            else if (window.location.hash === `#${modalId}`) history.replaceState(null, '', ' ');
        }
        return;
    }

    const actionTarget = e.target.closest('[data-action]'); 
    if (actionTarget) {
        const action = actionTarget.dataset.action; const id = actionTarget.dataset.id;
        if(action === 'add' || action === 'inc' || action === 'dec' || action === 'fav') e.stopPropagation();

        if (action === 'add' || action === 'inc') {
            const card = actionTarget.closest('.produto-card');
            modificarCarrinho(id, 1);
            if (card) { hapticFeedback(); voarParaPedido(card); }
            else if (action === 'add' && !actionTarget.classList.contains('ia-pill-add')) animarFeedbackBtn(actionTarget);
        }
        else if (action === 'dec') { modificarCarrinho(id, -1); }
        else if (action === 'detalhe') {
            const p = STATE.produtos.find(x => x.id === id);
            if(!p) return;

            // A foto do card "cresce" até virar a foto da tela do produto (View Transitions).
            // Onde o navegador não tem esse recurso, a tela simplesmente abre.
            const fotoCard = actionTarget.closest('.produto-card')?.querySelector('.produto-img-wrap img');
            const abrirDetalhe = () => {
            STATE.modalProdutoAtual = p;
            injetarModalDetalheSeNecessario();

            document.getElementById('md-nome').textContent = p.nome;
            const img = document.getElementById('md-img');
            if (p.foto) { img.src = p.foto; img.style.visibility = ''; } else { img.removeAttribute('src'); img.style.visibility = 'hidden'; }
            img.alt = p.nome;
            document.getElementById('md-tag').textContent = p.cat || '';
            document.getElementById('md-desc').textContent = p.descricao || "Produto fresco, selecionado no dia.";
            document.getElementById('md-preco').innerHTML =
                `${fmt(p.preco)} <span class="md-preco-unid">/ ${escapeHTML(p.unidade || 'un')}</span>`;

            // Se o cliente JÁ tem esse item no carrinho, o modal abre no estado atual dele
            const jaNoCarrinho = STATE.carrinho.find(c => c.id === p.id);
            const seletor = document.getElementById('md-tipo-compra-container');
            const fracionavel = isFracionavel(p.unidade);

            // O modal precisa estar visível antes do clique abaixo: o destaque do
            // seletor é medido na tela, e medir escondido dava largura zero
            // ("Por peso" ficava branco no branco).
            openModal('modal-detalhe-produto');

            if (fracionavel) {
                seletor.style.display = 'flex';
                const tipoInicial = jaNoCarrinho ? jaNoCarrinho.tipo : 'un';   // unidade é o padrão
                const btnAlvo = document.querySelector(`.btn-tipo-compra[data-tipo="${tipoInicial}"]`)
                             || document.querySelector('.btn-tipo-compra[data-tipo="un"]');
                btnAlvo.click(); // já dispara renderPresets + atualizarResumo
            } else {
                seletor.style.display = 'none';
                STATE.modalTipoCompra = 'un';
            }

            // Quantidade inicial: o que já está no carrinho, senão o padrão do modo
            STATE.modalQtd = jaNoCarrinho ? jaNoCarrinho.qtd : (fracionavel && STATE.modalTipoCompra === 'kg' ? 1 : 1);
            window.__mdSincronizar();

            document.getElementById('md-btn-add').onclick = () => {
                // fixo=true: usa exatamente a quantidade escolhida (não incrementa)
                modificarCarrinho(p.id, STATE.modalQtd, true, STATE.modalTipoCompra);
                const aPesar = STATE.modalTipoCompra === 'un' && isFracionavel(p.unidade);
                showToast(aPesar ? `${STATE.modalQtd} un no pedido. Pesamos na hora de separar.` : "Adicionado ao pedido");
                closeModal('modal-detalhe-produto');
                if (history.state && history.state.modal === 'modal-detalhe-produto') history.back();
            };
            };
            transicaoFoto(fotoCard, abrirDetalhe);
        }
        else if (action === 'cat') {
            STATE.catAtiva = actionTarget.dataset.cat;
            // destaca a aba tocada (antes "Todos" ficava marcado para sempre)
            document.querySelectorAll('#categorias .cat-btn').forEach(b => b.classList.toggle('active', b === actionTarget));
            actionTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            renderLoja();
        }
        else if (action === 'fav') { 
            const eraFav = STATE.favoritos.includes(id);
            if(eraFav) STATE.favoritos = STATE.favoritos.filter(f => f !== id);
            else STATE.favoritos.push(id);
            try { localStorage.setItem(chave('banca_favs'), JSON.stringify(STATE.favoritos)); } catch (_) {}
            // o coração muda na hora (antes só mudava ao recarregar a vitrine)
            document.querySelectorAll(`.btn-fav[data-id="${CSS.escape(String(id))}"]`).forEach(b => {
                b.classList.toggle('ativo', !eraFav); b.setAttribute('aria-pressed', String(!eraFav));
            });
            hapticFeedback();
            if(STATE.catAtiva === 'favoritos') renderLoja(); 
        }
        else if (action === 'recarregar') { location.reload(); }
        else if (action === 'open-historico') { renderHistorico(); openModal('modal-historico'); }
        else if (action === 'open-endereco') { endTopo.preencher(lerEnderecoSalvo()); openModal('modal-endereco'); }
        else if (action === 'repetir-pedido') { repetirPedido(id); }
        else if (action === 'cancelar-pedido') { cancelarPedido(id); }
        else if (action === 'toggle-troco') {
            const valor = actionTarget.dataset.value;
            const inputArea = document.getElementById('input-troco-area'); const cliTroco = document.getElementById('cli-troco');
            if(valor === 'nao') { cliTroco.value = 'Não preciso'; inputArea.style.display = 'none'; } 
            else { cliTroco.value = ''; inputArea.style.display = 'block'; cliTroco.focus(); }
        }
        return; 
    }
});

// 'change' (ao sair do campo / OK do teclado), não 'input': aplicando a cada
// tecla, "1,5" virava 15 kg e digitar "0" apagava o item no meio da digitação.
document.getElementById('carrinho-itens').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('qtd-input')) { e.preventDefault(); e.target.blur(); }
});
document.getElementById('carrinho-itens').addEventListener('focusin', (e) => {
    if (e.target.classList.contains('qtd-input')) e.target.select?.();
});
document.getElementById('carrinho-itens').addEventListener('change', (e) => {
    if(e.target.classList.contains('qtd-input')) {
        const id = e.target.dataset.id; const p = STATE.produtos.find(x => x.id === id);
        const itemCart = STATE.carrinho.find(x => x.id === id);
        let val = parseFloat(e.target.value.replace(',', '.'));
        if(isNaN(val) || val < 0) { renderCarrinhoCompleto(); return; }   // texto inválido: volta ao valor anterior
        
        // Se o cliente escolheu Unidade no Slider, não deixa colocar gramas no input
        val = (p && !isFracionavel(p.unidade) || (itemCart && itemCart.tipo === 'un')) ? Math.round(val) : fixFloat(val);
        modificarCarrinho(id, val, true);
    }
});

// BOTÃO VOLTAR
// Antes: ao voltar para uma entrada de modal, o modal era REABERTO com
// openModal(), que cria outra entrada no histórico. Depois de um pedido
// enviado, fechar a tela de sucesso reabria o formulário, e o X dele o
// reabria de novo, sem fim. Agora uma entrada de modal que já não está na
// tela é só pulada.
const mostrarSemHistorico = (el) => {
    el.classList.add('aberto'); el.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
};
window.addEventListener('popstate', (e) => {
    // confirmação aberta: "voltar" equivale a Cancelar (senão a pergunta ficava pendurada)
    if (document.querySelector('#overlay-confirm.aberto')) document.getElementById('btn-confirm-cancel')?.click();

    const abertos = new Set([...document.querySelectorAll('.modal-overlay.aberto')].map(m => m.id));
    document.querySelectorAll('.modal-overlay').forEach(m => { m.classList.remove('aberto'); m.setAttribute('aria-hidden', 'true'); });
    document.getElementById('carrinho-overlay')?.classList.remove('aberto');
    document.getElementById('carrinho')?.classList.remove('aberto');
    document.body.style.overflow = '';

    const st = e.state;
    if (!st) return;
    if (st.modal) {
        const el = document.getElementById(st.modal);
        if (el && abertos.has(st.modal)) mostrarSemHistorico(el);   // estava por baixo de outro: continua
        else history.back();                                        // entrada velha: pula
        return;
    }
    if (st.cart) {
        if (ehCelular() && STATE.carrinho.length > 0) {
            document.getElementById('carrinho')?.classList.add('aberto');
            document.getElementById('carrinho-overlay')?.classList.add('aberto');
            document.body.style.overflow = 'hidden';
        } else history.back();                                      // carrinho vazio (pedido já enviado): pula
    }
});

const toggleCartMobile = (abrir) => {
    if (!ehCelular()) return;
    if (abrir) { 
        document.getElementById('carrinho').classList.add('aberto'); document.getElementById('carrinho-overlay').classList.add('aberto'); 
        document.body.style.overflow = 'hidden'; history.pushState({cart: true}, ''); 
    } else { 
        if(history.state && history.state.cart) history.back();
    }
};
document.getElementById('btn-carrinho-mobile')?.addEventListener('click', () => toggleCartMobile(true));
document.getElementById('carrinho-overlay')?.addEventListener('click', () => { if (history.state?.cart) history.back(); });

document.getElementById('cli-pagamento').addEventListener('change', (e) => { 
    const isDinheiro = e.target.value === 'Dinheiro';
    document.getElementById('troco-group').style.display = isDinheiro ? 'block' : 'none'; 
    if(!isDinheiro) document.getElementById('cli-troco').value = '';
});

// UI Checkout
document.getElementById('btn-abrir-checkout').addEventListener('click', () => {
    const clientes = JSON.parse(localStorage.getItem(chave('banca_clientes')) || '[]');
    if (clientes.length > 0) {
        document.getElementById('cli-nome').value = clientes[0].nome || '';
    }
    endCheckout.preencher(lerEnderecoSalvo());
    STATE.checkoutSessionId = novoId(); 
    openModal('modal-checkout');
});

// Envio de Pedido com o novo formato de Unidades
document.getElementById('btn-enviar-pedido').addEventListener('click', async (e) => {
    const btn = e.currentTarget; if (btn.disabled) return;
    const nome = document.getElementById('cli-nome').value.trim();
    const endereco = endCheckout.ler();
    const { quadra, lote } = endereco;
    const telefone = (document.getElementById('cli-telefone')?.value || '').replace(/\D/g, '');
    const pag = document.getElementById('cli-pagamento').value;
    const trocoRaw = document.getElementById('cli-troco')?.value.trim();
    const obs = document.getElementById('cli-obs').value.trim();
    const cupom = (document.getElementById('cli-cupom')?.value || '').trim().toUpperCase();
    
    const faltaEndereco = endCheckout.validar();
    if (faltaEndereco) return showToast(faltaEndereco, true);
    if (!nome) return showToast("Escreva o seu nome para a entrega.", true);
    btn.disabled = true; btn.textContent = 'Enviando pedido...';

    try {
        let totalEstimado = 0;
        const itensFormatados = STATE.carrinho.map(item => {
            // Se for unidade a pesar, envia com preco 0 e tag de pendente
            const isAPesar = item.tipo === 'un' && isFracionavel(item.unidade);
            if (!isAPesar) totalEstimado += (item.preco * item.qtd);
            return { 
                id: item.id, 
                nome: item.nome,
                qtd: item.qtd, 
                tipo: item.tipo, // 'kg' ou 'un'
                aPesar: isAPesar,
                precoOriginal: item.preco
            };
        });

        const payload = {
            nome, quadra, lote, telefone, pag, troco: trocoRaw, obs, cupom,
            condominio: endereco.condominio, condominioId: endereco.condominioId, formatoEndereco: endereco.formatoEndereco,
            aceitaOfertas: !!document.getElementById('cli-ofertas')?.checked,
            itens: itensFormatados,
            clientTotal: totalEstimado, // Manda só o valor do que é exato
            status: itensFormatados.some(i => i.aPesar) ? 'aguardando_pesagem' : 'pendente', // Avisa o Admin!
            idempotencyKey: STATE.checkoutSessionId
            // userId saiu daqui de propósito: o servidor tira o dono do pedido
            // do token de autenticação, que é assinado e não pode ser forjado.
        };

        // comToken faz a requisição levar o token da sessão. É ele que permite
        // à cliente cancelar o pedido depois pela própria loja.
        const data = await chamarApi('/api/checkout', payload, { comToken: true });

        const clientes = JSON.parse(localStorage.getItem(chave('banca_clientes')) || '[]');
        const idx = clientes.findIndex(c => c.nome.toLowerCase() === nome.toLowerCase());
        if(idx >= 0) { clientes[idx] = {nome, quadra, lote}; } else { clientes.unshift({nome, quadra, lote}); }
        localStorage.setItem(chave('banca_clientes'), JSON.stringify(clientes.slice(0, 5)));
        salvarEndereco(endereco); pintarResumoEndereco();

        const meusPedidos = JSON.parse(localStorage.getItem(chave('banca_meus_pedidos')) || '[]');
        meusPedidos.unshift({
            id: data.pedido.id, data: new Date().toISOString(), total: data.pedido.total,
            descItens: STATE.carrinho.map(i => i.tipo === 'un' && isFracionavel(i.unidade) ? `${i.qtd} un de ${i.nome} (A Pesar)` : `${i.qtd}x ${i.nome}`).join(', '),
            itens: itensFormatados
        });
        localStorage.setItem(chave('banca_meus_pedidos'), JSON.stringify(meusPedidos.slice(0, 10)));

        mostrarLinksWhatsApp(data.pedido);
        closeModal('modal-checkout');
        setTimeout(() => openModal('modal-sucesso'), 300); 
        STATE.carrinho = []; dbStorage.set(chave('banca_cart'), {v: CART_VERSION, items: []});
        renderCarrinhoCompleto();
        document.getElementById('cli-obs').value = '';
        const campoCupom = document.getElementById('cli-cupom');
        if (campoCupom) campoCupom.value = '';
        

    } catch(err) {
        // Antes ia "Failed to fetch" cru, em inglês, para a tela da cliente
        showToast(mensagemDeErroAmigavel(err), true);
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar pedido';
    }
});

window.addEventListener('online', () => document.getElementById('banner-offline').classList.remove('visivel'));
window.addEventListener('offline', () => document.getElementById('banner-offline').classList.add('visivel'));
if (!navigator.onLine) document.getElementById('banner-offline')?.classList.add('visivel');

// [PATCH 4] Swipe para baixo fecha o carrinho no mobile (padrão iFood/Uber)
(() => {
  const cart = document.getElementById('carrinho');
  if (!cart) return;
  let y0 = null;
  cart.addEventListener('touchstart', (e) => {
    // Quem rola é a LISTA de itens, não a gaveta. Se o toque começou na lista
    // já rolada (ou num campo), é rolagem/edição — não é para fechar.
    const lista = e.target.closest('.carrinho-itens');
    const editando = e.target.closest('input, textarea, select');
    y0 = (editando || (lista && lista.scrollTop > 0)) ? null : e.touches[0].clientY;
  }, { passive: true });
  cart.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 110) { y0 = null; if (history.state?.cart) history.back(); }
  }, { passive: true });
  cart.addEventListener('touchend', () => { y0 = null; }, { passive: true });
})();


// =====================================================================
// COMUNICADO DA LOJA — aviso fixo ou mensagem do dia da semana,
// configurado pelo painel admin (loja/comunicados).
// =====================================================================
const iniciarComunicados = () => {
    const alvo = document.getElementById('banner-comunicado');
    if (!alvo) return;
    onSnapshot(tdoc("loja", "comunicados"), (snap) => {
        if (!snap.exists()) { alvo.classList.remove('visivel'); return; }
        const dados = snap.data();

        // Um aviso pode ter data de validade. Depois dela, some sozinho —
        // assim uma oferta "de hoje" não fica no ar semana que vem porque
        // ninguém lembrou de desligar.
        const noPrazo = (bloco) => {
            if (!bloco?.validoAte) return true;          // sem validade = vale sempre
            // A data chega como "2026-07-24" (só o dia). Interpretada crua, ela
            // vira meia-noite em UTC — que no Brasil é 21h do dia ANTERIOR, e o
            // aviso sumiria um dia antes do combinado. Por isso fixamos o fim
            // do dia no horário de Brasília.
            const limite = new Date(`${bloco.validoAte}T23:59:59-03:00`);
            if (isNaN(limite)) return true;
            return new Date() <= limite;
        };

        // O aviso fixo tem prioridade sobre a mensagem do dia
        const doDia = dados.dias?.[String(new Date().getDay())];
        const fixoVale = dados.fixo?.ativo && dados.fixo?.texto && noPrazo(dados.fixo);
        const diaVale  = doDia?.ativo && doDia?.texto && noPrazo(doDia);
        const escolhido = fixoVale ? dados.fixo.texto : (diaVale ? doDia.texto : '');
        if (escolhido) { alvo.textContent = escolhido; alvo.classList.add('visivel'); }
        else { alvo.classList.remove('visivel'); }
    }, (e) => console.warn('[loja] comunicados:', e?.code || e));
    // NÃO vai para "unsubscribes": aquela lista é desligada logo no primeiro
    // carregamento (antes do login anônimo) e o aviso nunca aparecia na 1ª visita.
};

iniciarComunicados();
initIA(STATE);
iniciarTema();   // cores, fontes e nome desta loja + faixa de lojas da feira
