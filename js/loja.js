import { db, auth, collection, onSnapshot, signInAnonymously, onAuthStateChanged, doc, getDoc, signOut } from './firebase.js';
import { tcol, tdoc, chave, TENANT, ehLojaOriginal, fichaRef, pastaFotos, urlDaLoja, EM_PREVIA } from './tenant.js';
import { fmt, escapeHTML, isFracionavel, fixFloat, formatarQuantidadeVisual, showToast, animarFeedbackBtn, hapticFeedback, openModal, closeModal, iconeCarrinhoVazio, iconeHistoricoVazio, customConfirm, dbStorage, haVersaoNova, conferirVersaoAgora, recarregarFresco } from './utils.js';
import { initIA } from './ia.js';
import { iniciarRanking, aplicarOrdem, scoreDe, destaques } from './ranking-loja.js';
import './melhorias-ui.js';
import { ICO } from './icones.js';
import { iniciarTema, feiraPeloCondominio, feiraDaConta, feiraDoClienteAqui, condominiosDasFeiras } from './tema.js';
import { proximaEntrega, textoDoDia } from './plataforma-lib.js';
import { lerFeiraCliente, esquecerFeiraCliente } from './feira-cliente.js';
import { criarCamposEndereco, linhaEndereco, lerEnderecoSalvo, salvarEndereco } from './endereco.js';
import { podePagarPix } from './pix-lib.js';
import { lerEntrega, previaDaEntrega } from './entrega-lib.js';
import { limparQuantidade } from './quantidade-lib.js';
import { miniatura } from './foto-lib.js';
import { emOferta, desconto, ofertasDe, precoDoDia } from './oferta-lib.js';
import { codigoPix, pixDaLojaValido, chaveBonita } from './pix-chave-lib.js';
import { listaValida, listaDoCarrinho, separar, mesmoConjunto, podeConvidarAvaliar, nomeDoDia, textoDaNota } from './atalhos-lib.js';
import { iniciarCategorias, aplicarCategorias, abasDeCategoria, assinaturaCategorias } from './categorias-loja.js';
import { ligarVerFoto } from './ver-foto.js';
import { temDoisModos, modoPreferido, limparMemoria, botoesDoCard, textoNoPedido, proximaQtd } from './modo-lib.js';
import { juntarPedidos, perfilParaAparelho, unirFavs, unirModo, sacolaParaGuardar, sacolaVale } from './conta-lib.js';
import { buscarConta, agendarGuardar, marcarConta, sairDaConta } from './conta-loja.js';
ligarVerFoto();   // tocar na foto da janela do produto abre ela inteira

// Lista guardada no aparelho. Dado corrompido ou armazenamento bloqueado NÃO pode derrubar a loja:
// antes, um JSON estragado aqui deixava a vitrine parada no carregamento.
const lerLista = (nome) => { try { const v = JSON.parse(localStorage.getItem(chave(nome)) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };

const CART_VERSION = "3.0"; // Atualizado para suportar o Carrinho Híbrido
let unsubscribes = []; 

const STATE = {
    uid: null, produtos: [], carrinho: [], catAtiva: 'todas', busca: '',
    config: { minimo: 0, wpp: '', lojaAberta: true, diasAbertos: [0,1,2,3,4,5,6] },
    favoritos: lerLista('banca_favs'),
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
['click', 'touchstart', 'keydown'].forEach(evt => document.addEventListener(evt, resetInatividadeTimer, { passive: true }));

const carregarCarrinhoDB = async () => {
    try { 
        const raw = await dbStorage.get(chave('banca_cart'));
        // O carrinho guardado no aparelho é conferido antes de ir para a tela: quantidade tem de ser número,
        // tipo só 'kg' ou 'un'. O que estiver fora do formato é descartado (nunca vira página).
        if(raw && raw.v === CART_VERSION && Array.isArray(raw.items)) {
            STATE.carrinho = raw.items.filter((i) => i && typeof i === 'object' && (typeof i.id === 'string' || typeof i.id === 'number') && Number.isFinite(Number(i.qtd)) && Number(i.qtd) > 0)
                .map((i) => ({ ...i, id: String(i.id), qtd: Number(i.qtd), tipo: i.tipo === 'kg' ? 'kg' : 'un' }));
            resetInatividadeTimer();
        }
    } catch(e) {}
    renderCarrinhoCompleto();   // desenha também o "pedido vazio" na primeira visita
};
const carrinhoPronto = carregarCarrinhoDB();

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
// UNIDADE ou QUILO: o que este cliente escolheu da última vez em cada produto (fica só neste aparelho).
let MODO_MEM = {};
try { MODO_MEM = limparMemoria(JSON.parse(localStorage.getItem(chave('banca_modo')) || '{}')); } catch (_) { /* sem memória: vale o cadastro da loja */ }
const lembrarModo = (id, modo) => {
    if (MODO_MEM[id] === modo) return;
    MODO_MEM[id] = modo;
    try { localStorage.setItem(chave('banca_modo'), JSON.stringify(limparMemoria(MODO_MEM))); } catch (_) { /* aparelho cheio */ }
    guardarNaConta();
};
// Produto vendido por quilo: dois botões, cada um dizendo o que põe no pedido e quanto custa.
// Depois do toque, o escolhido vira o contador e o outro vira "Trocar para ...".
const pintarDoisModos = (area, p, item) => {
    const sig = `${item ? `${item.tipo}:${item.qtd}` : '-'}|${modoPreferido(p, MODO_MEM)}|${p.preco}|${p.pesoMedio || ''}`;
    if (area.dataset.sig === sig) return;
    area.dataset.sig = sig;
    const foco = area.contains(document.activeElement) ? document.activeElement.dataset.action : null;
    const id = escapeHTML(p.id), nome = escapeHTML(p.nome || '');
    area.classList.add('dupla');
    if (!item) {
        const botao = (b, principal) => `<button type="button" class="modo-btn${principal ? ' principal' : ''}" data-action="add" data-modo="${b.modo}" data-id="${id}" aria-label="${escapeHTML(b.fala)}"><b>${escapeHTML(b.titulo)}</b><small>${escapeHTML(b.preco)}</small></button>`;
        const [primeiro, segundo] = botoesDoCard(p, MODO_MEM);
        area.innerHTML = botao(primeiro, true) + botao(segundo, false);
    } else {
        const t = textoNoPedido(p, item), outro = item.tipo === 'kg' ? 'un' : 'kg';
        const [bOutro] = botoesDoCard(p, { [p.id]: outro });
        area.innerHTML = `
            <div class="card-qtd modo-qtd">
               <button type="button" data-action="dec" data-id="${id}" aria-label="Tirar de ${nome}">−</button>
               <output aria-live="polite"><b><span class="longo">${escapeHTML(t.titulo)}</span><span class="curto" aria-hidden="true">${escapeHTML(t.curto)}</span></b><small>${escapeHTML(t.valor)}</small></output>
               <button type="button" data-action="inc" data-id="${id}" aria-label="Colocar mais de ${nome}">+</button>
            </div>
            <button type="button" class="modo-btn trocar" data-action="trocar" data-modo="${outro}" data-id="${id}" aria-label="Trocar ${nome} para ${outro === 'kg' ? 'quilo' : 'unidade'}"><b>Trocar para ${outro === 'kg' ? 'kg' : 'unidade'}</b><small>${escapeHTML(bOutro.preco)}${outro === 'kg' ? ' o quilo' : ' cada'}</small></button>`;
    }
    if (foco) (area.querySelector(`[data-action="${foco}"]`) || area.querySelector('[data-action="inc"], .modo-btn'))?.focus({ preventScroll: true });
};
const pintarAcao = (area, produtoId, animar) => {
    const item = STATE.carrinho.find(x => x.id === produtoId);
    area.closest('.produto-card')?.classList.toggle('na-sacola', !!item);
    const prod = STATE.produtos.find(p => p.id === produtoId);
    if (prod && temDoisModos(prod)) return pintarDoisModos(area, prod, item);
    if (area.classList.contains('dupla')) { area.classList.remove('dupla'); delete area.dataset.sig; area.textContent = ''; }   // o produto deixou de ser por quilo

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
            const porPeso = isFracionavel(prod?.unidade) && tipo !== 'un';
            if(input) input.value = formatarQuantidadeVisual(novaQtd, porPeso);
            // o rótulo acompanha a troca "por unidade" ↔ "por peso" (ficava "0,5 un" e travava a vírgula)
            const unid = row.querySelector('.qtd-unid');
            if (unid) unid.textContent = porPeso ? String(prod?.unidade || 'kg').toLowerCase() : 'un';
            
            const item = STATE.carrinho.find(x => x.id === id);
            if (price && item) price.outerHTML = precoLinhaHtml(item);
        }
    }
};

const renderUpsell = () => {
    const upsellCont = document.getElementById('upsell-container');
    if (STATE.carrinho.length === 0) { upsellCont.innerHTML = ''; upsellCont.dataset.sugestao = ''; return; }
    const idsNoCarrinho = STATE.carrinho.map(c => c.id);
    const catsNoCarrinho = [...new Set(STATE.carrinho.map(c => c.cat))];
    let sugestoes = STATE.produtos.filter(p => p.ativo && !idsNoCarrinho.includes(p.id) && catsNoCarrinho.includes(p.cat));
    if(sugestoes.length === 0) sugestoes = STATE.produtos.filter(p => p.ativo && !idsNoCarrinho.includes(p.id));
    if (sugestoes.length > 0) {
        sugestoes.sort((a,b) => (scoreDe(b.id) - scoreDe(a.id)) || ((STATE.favoritos.includes(b.id) ? 1 : 0) - (STATE.favoritos.includes(a.id) ? 1 : 0)));
        const up = sugestoes[0];
        // só redesenha quando a sugestão MUDA: assim a entrada animada acontece uma vez, e não a cada toque no + e no −
        if (upsellCont.dataset.sugestao === up.id) return;
        upsellCont.dataset.sugestao = up.id;
        upsellCont.innerHTML = `<div class="upsell-box">
            ${up.foto ? `<img class="upsell-foto" src="${escapeHTML(up.fotoMini || miniatura(up.foto, 128))}" data-original="${escapeHTML(up.foto)}" alt="" width="52" height="52" loading="lazy">` : ''}
            <span class="upsell-texto"><small>Que tal levar?</small><b>${escapeHTML(up.nome)}</b><em>${fmt(up.preco)} ${nomeUnidade(up.unidade)}</em></span>
            <button class="upsell-botao" data-action="add" data-id="${escapeHTML(up.id)}">Adicionar</button>
        </div>`;
    } else { upsellCont.innerHTML = ''; upsellCont.dataset.sugestao = ''; }
};

const atualizarRodapeCarrinhoDOM = () => {
    try { renderAtalhos(); } catch (_) { /* ainda carregando */ }
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
    // Entrega: prévia da taxa (quem cobra de verdade é o servidor, com a mesma conta).
    const entrega = STATE.carrinho.length ? previaDaEntrega(lerEntrega(STATE.config), totalExato, fmt) : { taxa: 0, texto: '' };
    const linhaEnt = document.getElementById('linha-entrega');
    // Com "grátis acima de X", a espera vira uma barra: ver quanto falta puxa mais um item para o pedido.
    const gratisAcima = lerEntrega(STATE.config).gratisAcima, abaixoDoMinimo = Number(STATE.config.minimo) > 0 && (totalExato + estimado) < Number(STATE.config.minimo);
    // uma meta de cada vez: enquanto falta o pedido mínimo, só a barra dele aparece
    const temBarra = STATE.carrinho.length > 0 && gratisAcima > 0 && !abaixoDoMinimo && (entrega.falta > 0 || entrega.gratis);
    if (linhaEnt) {
        linhaEnt.hidden = !entrega.texto || !!(temBarra && entrega.gratis);
        linhaEnt.textContent = (temBarra || abaixoDoMinimo) && !entrega.gratis ? `Entrega ${fmt(entrega.taxa)}` : entrega.texto;
        linhaEnt.classList.toggle('gratis', !!entrega.gratis);
    }
    const caixaFrete = document.getElementById('frete-progresso');
    if (caixaFrete) {
        caixaFrete.hidden = !temBarra; caixaFrete.classList.toggle('ganhou', !!entrega.gratis);
        // Item "a pesar" ainda não tem valor exato, mas tem estimativa: a barra usa a estimativa, e o texto avisa
        // que a confirmação é na balança (o servidor refaz a conta da entrega depois de pesar).
        const comEstimativa = totalExato + (semEstimativa ? 0 : estimado), deveGanhar = !entrega.gratis && temItensAPesar && comEstimativa >= gratisAcima;
        const faltaEstimada = Math.max(0, Math.round((gratisAcima - comEstimativa) * 100) / 100);
        document.getElementById('frete-texto').textContent = entrega.gratis ? 'Entrega grátis garantida'
            : deveGanhar ? 'Pelo peso estimado, a entrega deve sair de graça. Confirmamos na balança.'
            : `Faltam ${temItensAPesar ? 'cerca de ' : ''}${fmt(faltaEstimada)} para a entrega sair de graça`;
        caixaFrete.classList.toggle('quase', deveGanhar);
        document.getElementById('frete-barra').style.width = `${entrega.gratis || deveGanhar ? 100 : Math.max(4, Math.min(100, (comEstimativa / gratisAcima) * 100))}%`;
    }
    const previstoItens = totalExato + estimado;            // só os itens: é sobre isto que vale o pedido mínimo
    const previsto = previstoItens + entrega.taxa;          // exato + estimativa dos itens a pesar + entrega
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
    const falta = medeMinimo ? Math.max(0, minimo - previstoItens) : 0;
    const fracao = medeMinimo ? Math.min(1, previstoItens / minimo) : 0;
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
    // Cliente da feira: quem manda são os dias da FEIRA. Fora do dia, o pedido vai para o próximo dia de feira.
    const ent = entregaDaFeira();
    const hojePermitido = ent ? true : feiraDoClienteAqui() ? false : (STATE.config.diasAbertos || [0,1,2,3,4,5,6]).includes(new Date(Date.now() - 3 * 3600000).getUTCDay());
    const bannerFeira = document.getElementById('banner-feira');
    if (bannerFeira) { const futuro = lojaAberta && ent && !ent.hoje; bannerFeira.textContent = futuro ? `Hoje não tem feira. Seu pedido vai para ${textoDoDia(ent.dia)}.` : ''; bannerFeira.classList.toggle('visivel', !!futuro); }
    
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
            <div class="item-emoji">${item.foto ? `<img src="${escapeHTML(item.fotoMini || miniatura(item.foto, 128))}" data-original="${escapeHTML(item.foto)}" alt="${escapeHTML(item.nome)}" loading="lazy" width="48" height="48">` : ''}</div>
            <div class="item-meio">
                <h3 class="item-nome">${escapeHTML(item.nome)} </h3>
                <div class="qtd-ctrl">
                    <button class="btn-qtd" data-action="dec" data-id="${escapeHTML(item.id)}" aria-label="Diminuir ${escapeHTML(item.nome)}">−</button>
                    <input class="qtd-input" type="text" inputmode="decimal" value="${escapeHTML(formatarQuantidadeVisual(Number(item.qtd) || 0, isPeso))}" data-id="${escapeHTML(item.id)}" aria-label="Quantidade de ${escapeHTML(item.nome)}" enterkeyhint="done">
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
    guardarNaConta();
};
// CONTA DO CLIENTE: a sacola, os favoritos e o "unidade ou quilo" também ficam guardados na loja,
// para voltarem se o aparelho apagar tudo (o iPhone faz isso depois de 7 dias sem abrir o site).
const guardarNaConta = () => agendarGuardar(() => ({ sacola: sacolaParaGuardar(STATE.carrinho), prefs: { favs: STATE.favoritos, modo: MODO_MEM, feira: lerFeiraCliente() } }));
// Condomínio que é de uma feira desta banca: o cliente passa a ser daquela feira (e a conta lembra).
// Se o condomínio tem duas feiras aqui, a pessoa escolhe.
const perguntarFeira = (lista) => customConfirm('Qual é a sua feira?', `O seu condomínio é atendido em mais de uma feira desta banca. Escolha a sua: cada feira tem os seus preços e o seu dia.`, { ok: lista[0].nome, nao: lista[1].nome }).then((sim) => (sim ? lista[0].id : lista[1].id));
// Relógio da loja: o do celular, corrigido pela hora do servidor quando o pedido volta com "o dia mudou"
// (celular com a hora errada mostraria preços de outro dia).
let ACERTO_RELOGIO = 0;
const agoraLoja = () => Date.now() + ACERTO_RELOGIO;
// LISTA DE CONDOMÍNIOS do endereço: os que a banca cadastrou + os das feiras dela (cadastro da plataforma).
// Sem isto, o cliente da feira não achava o condomínio dele na lista e caía em "não está na lista".
const pintarListaDeCondominios = () => {
    const daLoja = Array.isArray(STATE.config.condominios) ? STATE.config.condominios : [];
    const ja = new Set(daLoja.filter((c) => c && c.nome).map((c) => normNome(c.nome)));
    const lista = daLoja.concat(condominiosDasFeiras().filter((c) => ![c.nome, ...(c.apelidos || [])].some((n) => ja.has(normNome(n)))).map(({ apelidos, ...c }) => c));
    try { endCheckout.definirLista(lista); endTopo.definirLista(lista); } catch (_) { /* campos ainda não montados */ }
};
const normNome = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
document.addEventListener('feiras-da-loja', () => pintarListaDeCondominios());
/** Para quando é o pedido de um cliente da feira (null = não é cliente de feira desta banca). */
const entregaDaFeira = () => { const f = feiraDoClienteAqui(); return f ? proximaEntrega(f, agoraLoja()) : null; };
/** Dia da semana que decide o preço: o da entrega da feira do cliente, ou hoje (Brasília). Mesmo critério do servidor. */
const diaDoPreco = () => { const e = entregaDaFeira(); return e ? e.dow : new Date(agoraLoja() - 3 * 3600000).getUTCDay(); };
/** Aviso "seu pedido é para..." dentro da tela de envio. */
const pintarAvisoDeEntrega = () => {
    const ent = entregaDaFeira(), aviso = document.getElementById('checkout-entrega'); if (!aviso) return;
    aviso.textContent = ent ? (ent.hoje ? '📅 Seu pedido é para hoje.' : `📅 Hoje não tem feira: seu pedido vai para ${textoDoDia(ent.dia)}.`) : ''; aviso.hidden = !ent;
};
document.addEventListener('feira-do-cliente', () => { try { atualizarRodapeCarrinhoDOM(); } catch (_) { /* carrinho ainda não montado */ } });
const feiraDoEnderecoSalvo = (e) => { if (e && e.condominio) feiraPeloCondominio(e.condominio, perguntarFeira).then((id) => { if (id) guardarNaConta(); }).catch(() => {}); };

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
const etiquetaHtml = (p) => etiquetaDeOferta(p) + etiquetaBase(p);
// preço antigo riscado (o preço que vale continua sendo o de baixo; o servidor só conhece esse)
// Quando a etiqueta mostra o preço POR UNIDADE (item pesado com peso médio), o preço antigo também vai por unidade:
// comparar "R$ 14,85 o quilo" com "R$ 4,46 a unidade" faria a oferta parecer maior do que é.
const etiquetaDeOferta = (p) => {
    if (!emOferta(p)) return '';
    const pm = Number(p.pesoMedio || 0), porUnidade = isFracionavel(p.unidade) && pm > 0 && !temDoisModos(p);
    return `<div class="etq-de">de <s>${fmt(porUnidade ? p.precoDe * pm / 1000 : p.precoDe)}</s> por</div>`;
};
const etiquetaBase = (p) => {
    const frac = isFracionavel(p.unidade), pm = Number(p.pesoMedio || 0);
    // por quilo com os dois botões: a etiqueta mostra o quilo; o preço da unidade vai escrito no botão dela
    if (temDoisModos(p)) {
        return `<div class="etq-preco">${fmt(p.preco)} <small>${nomeUnidade(p.unidade)}</small></div>
                <div class="etq-ref">pesado na hora</div>`;
    }
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
                ${p.foto ? `<img src="${escapeHTML(p.fotoMini || miniatura(p.foto, 384))}" data-original="${escapeHTML(p.foto)}" alt="${escapeHTML(p.nome)}" loading="${rapido ? 'eager' : 'lazy'}" decoding="async" width="200" height="200">` : '<div class="produto-img-placeholder"></div>'}
                ${emOferta(p) ? `<span class="selo-oferta">${desconto(p) >= 5 ? '−' + desconto(p) + '%' : 'Oferta'}</span>` : ''}
                <button class="btn-fav ${favActive}" data-action="fav" data-id="${escapeHTML(p.id)}" aria-label="Favoritar ${escapeHTML(p.nome)}" aria-pressed="${favActive ? 'true' : 'false'}">${ICO.coracao}</button>
            </div>
            <div class="produto-info">
                <h3 class="produto-nome">${escapeHTML(p.nome)}</h3>
                <div class="etiqueta">${etiquetaHtml(p)}</div>
                <div class="card-acao" data-acao="${escapeHTML(p.id)}"></div>
            </div>
        </article>`;
};

// Miniatura falhou (redutor fora do ar, site que não deixa copiar a foto)? Volta para a foto original.
document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.original) return;
    const original = img.dataset.original; delete img.dataset.original;
    if (img.getAttribute('src') !== original) img.src = original;
}, true);

// As fotos de baixo da tela começam "preguiçosas" para a loja abrir rápido. Assim que o
// aparelho sossega, vamos buscando as demais em lotes: quando a cliente rolar, mesmo
// depressa, a foto já está no aparelho em vez de aparecer atrasada.
let _adiantando = 0;
const adiantarFotos = () => {
    clearTimeout(_adiantando);
    if (navigator.connection && navigator.connection.saveData) return;      // quem pediu economia de dados fica como estava
    const passo = () => {
        const lote = [...document.querySelectorAll('#lista-produtos img[loading="lazy"]')].slice(0, 6);
        if (!lote.length) return;
        lote.forEach(img => { img.loading = 'eager'; });
        _adiantando = setTimeout(passo, 350);
    };
    _adiantando = setTimeout(passo, 1500);
};

const construirCardsIniciais = () => {
    const grid = document.getElementById('lista-produtos');
    grid.innerHTML = STATE.produtos.map((p, i) => cardHtml(p, i < 4)).join('');
    STATE.lojaRenderizada = true;
    renderFaixaSempre(true);
    STATE.produtos.forEach(p => atualizarBadgesDOM(p.id));
    adiantarFotos();
};

// Mudou UM produto (preço, foto, nome)? Troca só o card dele. Antes a vitrine inteira era
// refeita, e todas as fotos piscavam no meio da rolagem de quem estava comprando.
const trocarCards = (produtos) => {
    produtos.forEach(p => {
        document.querySelectorAll(`.produto-card[data-id="${CSS.escape(p.id)}"]`).forEach(card => {
            const molde = document.createElement('template'); molde.innerHTML = cardHtml(p, true).trim();
            const novo = molde.content.firstElementChild; novo.style.order = card.style.order;
            card.replaceWith(novo);
        });
        atualizarBadgesDOM(p.id);
    });
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
            const ultimo = lerLista('banca_meus_pedidos')[0];
            ids = ((ultimo && ultimo.itens) || []).map(i => i.id).filter(id => porId.has(id)).slice(0, 8);
            titulo = 'Do seu último pedido';
        } catch (_) { ids = []; }
    }
    const visivel = ids.length >= 2 && !semAcento(STATE.busca).trim() && STATE.catAtiva === 'todas';
    faixa.hidden = !visivel;
    const assinatura = ids.join('|');
    if (forcar) _faixaIds = '';          // catálogo mudou: o que estiver guardado ficou velho, mesmo com a faixa escondida
    if (!visivel || assinatura === _faixaIds) return;
    _faixaIds = assinatura;
    document.getElementById('faixa-titulo').textContent = titulo;
    const sub = document.getElementById('faixa-sub'); if (sub) sub.textContent = titulo === 'Seus de sempre' ? 'O que você mais leva, a um toque.' : 'Para repetir sem procurar de novo.';
    lista.innerHTML = ids.map(id => cardHtml(porId.get(id), true)).join('');
    ids.forEach(id => atualizarBadgesDOM(id));
};
document.addEventListener('ranking-pronto', () => renderFaixaSempre());

// FAIXA "OFERTAS DE HOJE": produtos com preço antigo riscado. Some na busca e dentro de uma categoria.
let _ofertasCara = '';
const renderFaixaOfertas = (forcar = false) => {
    const faixa = document.getElementById('faixa-ofertas'), lista = document.getElementById('ofertas-lista');
    if (!faixa || !lista) return;
    const ofertas = ofertasDe(STATE.produtos);
    const visivel = ofertas.length > 0 && !semAcento(STATE.busca).trim() && STATE.catAtiva === 'todas';
    faixa.hidden = !visivel;
    const cara = ofertas.map(p => `${p.id}:${p.preco}:${p.precoDe}`).join('|');
    if (forcar) _ofertasCara = '';
    if (!visivel || cara === _ofertasCara) return;
    _ofertasCara = cara;
    lista.innerHTML = ofertas.map(p => cardHtml(p, true)).join('');
    ofertas.forEach(p => atualizarBadgesDOM(p.id));
};

const renderLoja = (forcarRebuild = false) => {
    const grid = document.getElementById('lista-produtos');
    if (!STATE.catalogoChegou) return;     // produtos ainda a caminho: fica o carregando, e não um falso "sem produtos"
    if(!STATE.lojaRenderizada || forcarRebuild) construirCardsIniciais();
    renderFaixaSempre(); renderFaixaOfertas(forcarRebuild); renderAtalhos();
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
        // iPhone: o navegador costuma barrar a abertura automática (ela acontece depois de o servidor responder,
        // e o iPhone só deixa abrir outro app no instante do toque). O texto pede o toque em vez de prometer.
        : (ehIphone() ? 'Pedido recebido! Agora toque no botão verde para mandar a mensagem no WhatsApp.'
            : 'Vamos abrir o WhatsApp da banca com o seu pedido pronto. Se não abrir sozinho, toque no botão abaixo.');
    if (area) area.classList.toggle('precisa-toque', ehIphone() && links.length === 1);
    // só abre o que for mesmo um link do WhatsApp (o endereço vem do servidor; isto é a segunda conferência)
    if (links.length === 1 && /^https:\/\/wa\.me\/\d{8,15}\?/.test(String(links[0].url))) window.open(links[0].url, '_blank', 'noopener');
};

// PIX automático: a tela (js/pix-loja.js) só é baixada quando alguém vai pagar.
const pagarComPix = async (pedidoId, total) => {
    try {
        const { abrirPix } = await import('./pix-loja.js');
        abrirPix({ pedidoId, total, chamarApi, erroAmigavel: mensagemDeErroAmigavel, aoPagar: () => { if (document.getElementById('modal-historico')?.classList.contains('aberto')) renderHistorico(); } });
    } catch (e) { showToast('Não foi possível abrir o PIX. Combine o pagamento pelo WhatsApp.', true); }
};
// Depois de enviar o pedido: se a loja ligou o PIX automático e o valor já está fechado, oferece pagar na hora.
// PIX no pedido, em duas formas:
//  1. automático (PagBank): QR na tela e o pedido vira PAGO sozinho. Só com a conta ligada.
//  2. copia e cola com a chave da loja: o código já sai com o valor; quem confere o pagamento é a loja.
// Se o automático estiver ligado, ele vence. Pedido com item a pesar espera a balança (o valor ainda muda).
const pixAutomaticoHtml = (pedido) => `<button type="button" class="btn-pix" data-action="pagar-pix" data-id="${escapeHTML(pedido.id)}" data-total="${Number(pedido.total) || 0}">Pagar ${fmt(pedido.total)} com PIX agora</button>`;
const pixCopiaColaHtml = (pedido) => {
    if (!(Number(pedido.total) > 0)) return '';          // pedido de cortesia (cupom de 100%): nada a pagar
    const pix = STATE.config.pix, codigo = codigoPix(pix, pedido.total, pedido.id);
    if (!codigo) return '';
    return `<div class="pix-cola">
        <b>Pague ${fmt(pedido.total)} com PIX</b>
        <span>Para ${escapeHTML(pix.nome)} · chave ${escapeHTML(chaveBonita(pix))}</span>
        <button type="button" class="btn-pix" data-action="copiar-pix" data-codigo="${escapeHTML(codigo)}">Copiar código PIX</button>
        <small>Cole no aplicativo do seu banco, em "PIX copia e cola". O valor já vem preenchido. Depois, mande o comprovante no WhatsApp.</small>
    </div>`;
};
const pixDoPedidoHtml = (pedido) => {
    if (ehLojaOriginal && podePagarPix(STATE.config.pixAutomatico === true, pedido)) return pixAutomaticoHtml(pedido);
    if (pixDaLojaValido(STATE.config.pix) && podePagarPix(true, pedido)) return pixCopiaColaHtml(pedido);
    if (pixDaLojaValido(STATE.config.pix) && String(pedido.pag || '').toUpperCase() === 'PIX' && pedido.temItensAPesar && pedido.status !== 'cancelado')
        return '<p class="pix-espera">O código PIX aparece aqui, em Meus pedidos, assim que a banca pesar os itens e fechar o valor.</p>';
    return '';
};
const oferecerPixNoSucesso = (pedido) => {
    const area = document.getElementById('sucesso-pix'); if (!area) return;
    const html = pixDoPedidoHtml(pedido);
    area.hidden = !html; area.innerHTML = html;
};
const copiarPix = async (botao) => {
    const codigo = botao.dataset.codigo || '';
    let ok = false;
    try { await navigator.clipboard.writeText(codigo); ok = true; }
    catch (_) {           // navegador sem permissão de copiar: usa o jeito antigo
        const t = document.createElement('textarea'); t.value = codigo; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(t); t.select(); try { ok = document.execCommand('copy'); } catch (__) { ok = false; } t.remove();
    }
    if (ok) { botao.textContent = 'Código copiado'; showToast('Código PIX copiado. Agora cole no aplicativo do seu banco.'); setTimeout(() => { botao.textContent = 'Copiar código PIX'; }, 4000); }
    else showToast('Não consegui copiar sozinho. Use a chave que aparece acima do botão.', true);
};

// Horário de entrega: o campo só aparece se a loja cadastrou horários no painel.
const pintarHorariosDeEntrega = () => {
    const grupo = document.getElementById('grupo-horario'), campo = document.getElementById('cli-horario'); if (!grupo || !campo) return;
    const { horarios } = lerEntrega(STATE.config), atual = campo.value;
    grupo.hidden = !horarios.length;
    campo.innerHTML = horarios.length ? '<option value="">Tanto faz (a combinar)</option>' + horarios.map((h) => `<option value="${escapeHTML(h)}">${escapeHTML(h)}</option>`).join('') : '';
    if (horarios.includes(atual)) campo.value = atual;
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
        pintarListaDeCondominios();
        pintarHorariosDeEntrega();
    }, (e) => console.warn('[loja] config:', e?.code || e));
    unsubscribes.push(unsubConfig);

    // Nota da loja no cabeçalho (só com 5 avaliações ou mais). Uma leitura só, sem ficar ouvindo.
    getDoc(tdoc('loja', 'avaliacoes')).then((s) => {
        const el = document.getElementById('header-avaliacao'), txt = s.exists() ? textoDaNota(s.data()) : '';
        if (el && txt) { el.textContent = '★ ' + txt; el.hidden = false; }
    }).catch(() => { /* sem nota não muda nada */ });

    // [PATCH 3] Só reconstrói o grid quando o catálogo realmente muda (evita reflows/lag)
    let _assinaturaProdutos = '';
    let _produtosBrutos = [], _diaDoPrecoAplicado = null;
    let _produtosChegaram = false; // a vitrine só é desenhada depois da 1ª resposta dos produtos
    let _catsProntas = false;      // espera a 1ª resposta das categorias p/ não "piscar" produto de categoria oculta
    // Junta produtos + categorias do painel (ocultas somem; renomear/ordenar reflete na hora)
    let _lista = '', _porProduto = new Map();
    const assinaturaDe = (p) => `${p.preco}:${p.precoDe || ''}:${p.foto || ''}:${p.fotoMini || ''}:${p.nome}:${p.cat}:${p.unidade || ''}:${p.pesoMedio || ''}:${p.mostrarPrimeiro || ''}`;
    const aplicarCatalogo = () => {
        if (!_catsProntas || !_produtosChegaram) return;
        STATE.catalogoChegou = true;
        // preço do DIA DA ENTREGA (feira do cliente, ou hoje): todo o resto da loja usa p.preco
        const dia = diaDoPreco(); _diaDoPrecoAplicado = dia; STATE.diaDoPreco = dia;
        STATE.produtos = aplicarCategorias(_produtosBrutos.map((p) => ({ ...p, precoNormal: p.preco, preco: precoDoDia(p, dia) })));
        const lista = STATE.produtos.map(p => p.id).join('|') + '#' + assinaturaCategorias();
        const porProduto = new Map(STATE.produtos.map(p => [p.id, assinaturaDe(p)]));
        const assinatura = lista + '#' + [...porProduto.values()].join('|');
        if (assinatura !== _assinaturaProdutos) {
            const mudaram = STATE.produtos.filter(p => _porProduto.get(p.id) !== porProduto.get(p.id));
            if (STATE.lojaRenderizada && lista === _lista && mudaram.length <= 12) {
                trocarCards(mudaram); renderCategorias(); renderLoja();          // mesmos produtos, na mesma ordem: só os cards que mudaram
            } else {
                renderCategorias(); renderLoja(true);
            }
            _assinaturaProdutos = assinatura; _lista = lista; _porProduto = porProduto;
            aplicarOrdem();
        }
        syncCarrinhoComPrecosAoVivo();
        STATE.carrinho.forEach(item => { atualizarBadgesDOM(item.id, item.qtd); });
        tentarRestaurarSacola();
    };
    // a feira do cliente mudou (link, condomínio, conta) ou virou o dia: os preços mudam junto
    document.addEventListener('feira-do-cliente', aplicarCatalogo);
    setInterval(() => { if (diaDoPreco() !== _diaDoPrecoAplicado) aplicarCatalogo(); }, 60000);
    const unsubProdutos = onSnapshot(tcol("produtos"), (snap) => {
        _produtosChegaram = true;
        _produtosBrutos = snap.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(p => p.ativo && !p.soInsumo);   // ingrediente de receita não vai para a vitrine
        aplicarCatalogo();
    }, (e) => {
        console.warn('[loja] produtos:', e?.code || e);
        // o banco recusou: a plataforma desligou esta loja. Avisa, mesmo que houvesse vitrine guardada no aparelho.
        if (e && e.code === 'permission-denied') {
            document.getElementById('lista-produtos').innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">${iconeHistoricoVazio}<p>Esta loja está fora do ar no momento</p><span>Os pedidos por aqui estão pausados. Fale direto com a loja.</span></div>`;
            STATE.lojaRenderizada = false; return;
        }
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

                <div class="md-hero" tabindex="0" role="button" aria-label="Ver a foto inteira">
                    <img id="md-img" src="" alt="">
                    <span id="md-tag" class="md-tag"></span>
                    <span class="md-ampliar" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>Ver inteira</span>
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

    // escreverCampo = false enquanto a pessoa DIGITA: reescrever o campo a cada tecla apagava a vírgula
    // ("1," virava "1" e "1,5" acabava como 15 quilos).
    const atualizarResumo = (escreverCampo = true) => {
        const p = STATE.modalProdutoAtual; if (!p) return;
        const qtd = STATE.modalQtd;
        const resumo = $('md-resumo');
        const btn = $('md-btn-add');
        const fracionavel = isFracionavel(p.unidade);

        if (escreverCampo) $('md-qtd').value = formatarQuantidadeVisual(qtd, modoPeso());
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
                resumo.innerHTML = `<small>Vamos pesar ${Number(qtd) || 0} ${qtd === 1 ? 'unidade' : 'unidades'} e o valor final entra no seu pedido.</small>`;
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
        if (Number.isFinite(v) && v > 0) { STATE.modalQtd = modoPeso() ? fixFloat(v) : Math.round(v); atualizarResumo(false); }
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
        // Com sinal fraco, renovar o login pode demorar dezenas de segundos e o botão ficava em "Enviando pedido...".
        // Depois de 8 s o pedido segue sem o login (a venda acontece; só "Meus pedidos" não acompanha este).
        return await Promise.race([usuario.getIdToken(), new Promise((r) => setTimeout(() => r(''), 8000))]);
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
    // Prévia da aparência (aba do painel): dá para montar o pedido, mas nada é enviado nem cancelado.
    if (EM_PREVIA) throw new Error('Esta é só a prévia da aparência: aqui nenhum pedido é enviado.');
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
        if (!resposta.ok) throw Object.assign(new Error(dados.error || 'Não foi possível concluir a operação.'), { dados, status: resposta.status });
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
    const meusPedidos = lerLista('banca_meus_pedidos');
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
        // sem leitura ao vivo (pedido que voltou pela conta, feito em outro aparelho): vale o status que o servidor mandou
        const status = vivo ? vivo.status : (p.status === 'cancelado' || p.cancelado ? 'cancelado' : antigo ? 'arquivado' : (ROTULO_STATUS[p.status] ? p.status : 'pendente'));

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
            ${avaliacaoHtml(p, vivo, status)}
            ${vivo && vivo.pagamento && vivo.pagamento.status === 'PAID' ? '<p class="pedido-pago">Pago por PIX</p>' : ''}
            ${vivo ? pixDoPedidoHtml({ ...vivo, id: p.id, total: totalReal }) : ''}
        </article>`;
    }).join('');
};

// Cancelamento pela loja: o servidor confere prazo, dono e devolve o estoque.
const cancelarPedido = async (pedidoId) => {
    const ok = await customConfirm(
        'Cancelar este pedido?',
        'Os itens voltam para o estoque da banca. Se quiser pedir de novo depois, sem problema.',
        { ok: 'Cancelar o pedido', nao: 'Voltar' }
    );
    if (!ok) return;

    showToast('Cancelando...');
    try {
        // comToken: o servidor exige o token do Firebase para provar que o
        // pedido é desta sessão. Sem isso ele recusa, e é assim que deve ser.
        await chamarApi('/api/cancelar-pedido', { pedidoId }, { comToken: true });
        showToast('✅ Pedido cancelado');
        try { const meus = lerLista('banca_meus_pedidos'), alvo = meus.find(p => String(p.id) === String(pedidoId)); if (alvo) { alvo.cancelado = true; localStorage.setItem(chave('banca_meus_pedidos'), JSON.stringify(meus)); } } catch (_) { /* só afeta os atalhos */ }
        renderHistorico(); renderAtalhos();
    } catch (e) {
        showToast(mensagemDeErroAmigavel(e), true);
    }
};

// ---------------------------------------------------------------------
// ATALHOS DE QUEM VOLTA: pedir de novo, lista da semana, avaliar.
// ---------------------------------------------------------------------
const CHAVE_LISTA = 'banca_lista_semana';
const lerListaSemana = () => { try { return listaValida(JSON.parse(localStorage.getItem(chave(CHAVE_LISTA)) || 'null')); } catch (_) { return null; } };

// Põe um conjunto de itens no pedido, com os preços e a disponibilidade DE HOJE.
// Se já houver outro pedido em montagem, pergunta antes de trocar.
const porNoPedido = async (itens) => {
    const { entram, faltam } = separar(itens, STATE.produtos);
    if (!entram.length) { showToast('Todos estes itens estão em falta hoje.', true); return false; }
    if (STATE.carrinho.length && !mesmoConjunto(STATE.carrinho, entram)) {
        const n = STATE.carrinho.length;
        const ok = await customConfirm('Trocar o pedido atual?', `Seu pedido tem ${n} ${n === 1 ? 'item' : 'itens'}. ${n === 1 ? 'Ele sai' : 'Eles saem'} para entrar ${entram.length === 1 ? 'o item escolhido' : 'os ' + entram.length + ' itens escolhidos'}.`, { ok: 'Trocar', nao: 'Manter o atual' });
        if (!ok) return false;
    }
    STATE.carrinho = entram;
    persistirCarrinhoComDebounce(); renderCarrinhoCompleto(); STATE.produtos.forEach(p => atualizarBadgesDOM(p.id));
    closeModal('modal-historico');
    if (ehCelular()) toggleCartMobile(true);
    showToast(faltam.length ? `${entram.length} no pedido, com os preços de hoje. Em falta: ${faltam.slice(0, 3).join(', ')}${faltam.length > 3 ? '...' : ''}.` : `${entram.length} ${entram.length === 1 ? 'item' : 'itens'} no pedido, com os preços de hoje.`, faltam.length > 0);
    return true;
};

const repetirPedido = (pedId) => {
    const ped = lerLista('banca_meus_pedidos').find(p => String(p.id) === String(pedId));
    if (!ped || !Array.isArray(ped.itens)) return;
    return porNoPedido(ped.itens);
};

const guardarListaDaSemana = () => {
    const lista = listaDoCarrinho(STATE.carrinho);
    if (!lista) return;
    try { localStorage.setItem(chave(CHAVE_LISTA), JSON.stringify(lista)); } catch (_) { showToast('Não consegui guardar a lista neste aparelho.', true); return; }
    showToast(`Lista da semana guardada com ${lista.itens.length} ${lista.itens.length === 1 ? 'item' : 'itens'}. Ela fica no topo da loja.`);
    renderAtalhos();
};
const verListaDaSemana = async () => {
    const lista = lerListaSemana(); if (!lista) return;
    const nomes = lista.itens.map(i => i.nome).filter(Boolean).join(', ');
    const apagar = await customConfirm('Minha lista da semana', `${nomes || lista.itens.length + ' itens'}. Para mudar a lista, monte o pedido como quiser e toque em "Guardar como minha lista da semana".`, { ok: 'Apagar a lista', nao: 'Fechar' });
    if (!apagar) return;
    try { localStorage.removeItem(chave(CHAVE_LISTA)); } catch (_) {}
    showToast('Lista apagada.'); renderAtalhos();
};

// O desenho que já está no cabeçalho desta loja (o caixote na banca, o traço do tipo de negócio nas outras),
// copiado em miniatura para o botão "Pedir de novo". Sem desenho no cabeçalho, uma sacola simples.
const arteDaLoja = () => {
    const svg = document.querySelector('.header-arte');
    if (svg && svg.innerHTML.trim() && !document.documentElement.classList.contains('sem-arte'))
        return `<svg viewBox="${escapeHTML(svg.getAttribute('viewBox') || '0 0 120 120')}">${svg.innerHTML}</svg>`;   // desenho fixo do projeto, já presente na página
    return `<svg viewBox="0 0 120 120"><circle cx="48" cy="40" r="17" fill="#E9A862"/><circle cx="76" cy="44" r="13" fill="#7CC99B"/><path d="M0 0C1-11 9-16 18-15 18-6 10 0 0 0Z" fill="#7CC99B" transform="translate(48 25) rotate(0) scale(0.8)"/><path d="M20 46h80l-6 54a8 8 0 0 1-8 7H34a8 8 0 0 1-8-7z" fill="#D9C7A3"/><rect x="44" y="60" width="32" height="10" rx="5" fill="#F6F1E4"/></svg>`;
};
// ---------------------------------------------------------------------
// INSTALAR NA TELA INICIAL. O site já funciona como aplicativo, mas quase ninguém sabe.
// O botão só aparece quando dá para instalar: no Android/Chrome, quando o navegador avisa
// que pode; no iPhone, sempre que a loja não estiver aberta como app (lá não existe o
// aviso, então o botão explica o caminho pelo Safari).
// ---------------------------------------------------------------------
let _conviteInstalar = null;
const jaEhApp = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const mostrarInstalar = (sim) => { const b = document.getElementById('btn-instalar'); if (b) b.hidden = !sim || jaEhApp(); };
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); _conviteInstalar = e; mostrarInstalar(true); });
window.addEventListener('appinstalled', () => { _conviteInstalar = null; mostrarInstalar(false); showToast('Pronto! A loja está na sua tela inicial.'); });
if (ehIphone()) mostrarInstalar(true);
const instalarApp = async () => {
    if (_conviteInstalar) {
        const convite = _conviteInstalar; _conviteInstalar = null;
        convite.prompt();
        try { const { outcome } = await convite.userChoice; if (outcome === 'accepted') mostrarInstalar(false); } catch (_) { /* fechou a janela */ }
        return;
    }
    if (ehIphone()) await customConfirm('Pôr a loja na tela inicial', 'No Safari, toque no botão Compartilhar (o quadrado com a seta para cima) e depois em "Adicionar à Tela de Início". A loja passa a abrir como um aplicativo.', { ok: 'Entendi', nao: 'Fechar' });
};

// "Indicar para um vizinho": abre o compartilhar do celular (WhatsApp, etc.) com um recado pronto e o link da loja.
const indicarLoja = async () => {
    const nome = (document.getElementById('header-nome')?.textContent || 'a loja').trim(), url = location.href.split('#')[0];
    const texto = `Estou pedindo na ${nome} e entregam aqui no condomínio. Dá uma olhada:`;
    try { if (navigator.share) { await navigator.share({ title: nome, text: texto, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto + ' ' + url)}`, '_blank', 'noopener');
};
const dataCurta = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch (_) { return ''; } };
function renderAtalhos() {
    const nav = document.getElementById('atalhos'); if (!nav) return;
    const guardar = document.getElementById('btn-guardar-lista'); if (guardar) guardar.hidden = STATE.carrinho.length < 2;
    const livre = STATE.catalogoChegou && !semAcento(STATE.busca).trim() && STATE.catAtiva === 'todas';
    const pedidos = lerLista('banca_meus_pedidos'), ultimo = pedidos.find(p => Array.isArray(p.itens) && p.itens.length && !p.cancelado), lista = lerListaSemana();
    const avaliar = pedidos.find(p => podeConvidarAvaliar(p));
    const botoes = [];
    if (lista) {
        const hoje = lista.dia === new Date().getDay();
        botoes.push(`<span class="atalho-par"><button type="button" class="atalho${hoje ? ' destaque' : ''}" data-action="por-lista"><b>Minha lista da semana</b><small>${hoje ? 'hoje é ' + nomeDoDia(lista.dia) + ', dia da sua lista · ' : ''}${lista.itens.length} ${lista.itens.length === 1 ? 'item' : 'itens'}</small></button><button type="button" class="atalho-ver" data-action="ver-lista" aria-label="Ver ou apagar a lista da semana">ver</button></span>`);
    }
    // "Pedir de novo" é o atalho principal: vem primeiro, preenchido, com o ícone de repetir.
    if (ultimo) botoes.unshift(`<button type="button" class="atalho principal" data-action="repetir-pedido" data-id="${escapeHTML(String(ultimo.id))}"><i class="atalho-arte" aria-hidden="true">${arteDaLoja()}<span class="atalho-volta"><svg class="ico" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/></svg></span></i><span><b>Pedir de novo</b><small>o pedido de ${dataCurta(ultimo.data)} · ${ultimo.itens.length} ${ultimo.itens.length === 1 ? 'item' : 'itens'}</small></span></button>`);
    if (avaliar) botoes.push(`<button type="button" class="atalho" data-action="open-historico"><b>Chegou tudo fresquinho?</b><small>avalie seu pedido em um toque</small></button>`);
    nav.hidden = !livre || !botoes.length;
    const html = botoes.join('');
    if (nav.dataset.cara !== html) { nav.innerHTML = html; nav.dataset.cara = html; }
}

// ---------------------------------------------------------------------
// AVALIAÇÃO DEPOIS DA ENTREGA ("Meus pedidos")
// ---------------------------------------------------------------------
const estrelas = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const avaliacaoHtml = (p, vivo, status) => {
    const nota = Math.min(5, Math.max(0, Math.round(Number((vivo && vivo.avaliacao && vivo.avaliacao.nota) || p.avaliado) || 0)));   // sempre um número de 0 a 5
    if (nota) return `<p class="avaliado" aria-label="Você deu ${nota} de 5 estrelas">Sua avaliação: <span>${estrelas(Number(nota))}</span> Obrigado!</p>`;
    // Aparece quando a loja marcou o pedido como entregue, ou 3 horas depois do envio (nem toda banca
    // atualiza a etapa no painel). Pedido cancelado ou com mais de uma semana não pergunta.
    const horas = (Date.now() - new Date(p.data).getTime()) / 3600000;
    if (status === 'cancelado' || horas > 7 * 24 || !(['enviado', 'arquivado'].includes(status) || horas >= 3)) return '';
    return `<div class="avaliar" data-avaliar="${escapeHTML(String(p.id))}">
                <span class="avaliar-pergunta">Chegou tudo fresquinho?</span>
                <div class="avaliar-estrelas" role="group" aria-label="Dê de 1 a 5 estrelas">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-action="estrela" data-id="${escapeHTML(String(p.id))}" data-nota="${n}" aria-label="${n} ${n === 1 ? 'estrela' : 'estrelas'}">☆</button>`).join('')}</div>
                <div class="avaliar-envio" hidden>
                    <textarea maxlength="300" rows="2" placeholder="Quer contar algo para a banca? (opcional)" aria-label="Comentário (opcional)"></textarea>
                    <button type="button" class="btn btn-primary" data-action="enviar-avaliacao" data-id="${escapeHTML(String(p.id))}">Enviar avaliação</button>
                </div>
            </div>`;
};
const marcarEstrela = (botao) => {
    const caixa = botao.closest('.avaliar'), nota = Number(botao.dataset.nota);
    caixa.dataset.nota = String(nota);
    caixa.querySelectorAll('[data-action="estrela"]').forEach(b => { const on = Number(b.dataset.nota) <= nota; b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on); });
    caixa.querySelector('.avaliar-envio').hidden = false;
};
const enviarAvaliacao = async (botao) => {
    const caixa = botao.closest('.avaliar'), nota = Number(caixa.dataset.nota), pedidoId = botao.dataset.id;
    if (!(nota >= 1)) return;
    botao.disabled = true; botao.textContent = 'Enviando...';
    try {
        await chamarApi('/api/cancelar-pedido', { acao: 'avaliar', pedidoId, nota, texto: caixa.querySelector('textarea').value.trim() }, { comToken: true });
    } catch (e) {
        // "já foi avaliado" não é problema para a cliente: guarda e segue
        if (!/já foi avaliado/.test(String(e && e.message))) { botao.disabled = false; botao.textContent = 'Enviar avaliação'; showToast(mensagemDeErroAmigavel(e), true); return; }
    }
    try {
        const meus = lerLista('banca_meus_pedidos'), alvo = meus.find(p => String(p.id) === String(pedidoId));
        if (alvo) { alvo.avaliado = nota; localStorage.setItem(chave('banca_meus_pedidos'), JSON.stringify(meus)); }
    } catch (_) { /* a nota já está no servidor */ }
    showToast(nota >= 4 ? 'Obrigado pela avaliação!' : 'Obrigado por avisar. A banca vai ver o seu recado.');
    renderHistorico(); renderAtalhos();
};

// Abre a tela do produto com a foto do card "viajando" até ela.
const transicaoFoto = (fotoCard, abrir) => {
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || semMovimento || !fotoCard) {
        document.getElementById('modal-detalhe-produto')?.classList.remove('sem-anim');
        return abrir();
    }
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
        // 'sem-anim' fica até a tela fechar: tirar aqui fazia a animação de abrir tocar de novo por cima.
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

// =========================================================
// CONTA DO CLIENTE (sem login). O servidor guarda nome, endereço, pedidos, favoritos e sacola
// ligados a um crachá que a limpeza do iPhone não apaga. Aqui os dados voltam para o aparelho:
//   - sozinhos, quando a loja abre sem nada guardado;
//   - pelo link pessoal que vai no fim da mensagem do WhatsApp (celular novo).
// Regras de quem pode o quê: lib/conta.js (servidor).
// =========================================================
let sacolaDaConta = null;
const tentarRestaurarSacola = () => {
    if (!sacolaDaConta || !STATE.catalogoChegou) return;
    const itens = sacolaDaConta; sacolaDaConta = null;
    if (STATE.carrinho.length) return;                       // a pessoa já começou outro pedido: não mexe
    const { entram } = separar(itens, STATE.produtos);       // preço e disponibilidade DE HOJE
    if (!entram.length) return;
    STATE.carrinho = entram;
    persistirCarrinhoComDebounce(); renderCarrinhoCompleto(); STATE.produtos.forEach(p => atualizarBadgesDOM(p.id));
    setTimeout(() => showToast(`Sua sacola voltou com ${entram.length} ${entram.length === 1 ? 'item' : 'itens'}, nos preços de hoje.`), 2600);
};
const aplicarConta = async (conta, porLink) => {
    const { cliente, endereco } = perfilParaAparelho(conta);
    // cada coisa no seu "try": aparelho com o armazenamento cheio ou bloqueado ainda fica com o resto
    const guardar = (nome, valor) => { try { localStorage.setItem(chave(nome), JSON.stringify(valor)); } catch (e) { console.warn('[conta] não guardei', nome, e && e.message); } };
    // lido ANTES de gravar o nome: o endereço salvo "empresta" quadra e lote da lista de nomes quando não tem o seu
    const clientes = lerLista('banca_clientes'), semEndereco = !lerEnderecoSalvo();
    if (cliente && (porLink || !clientes.length)) guardar('banca_clientes', [cliente, ...clientes.filter(c => String(c && c.nome || '').toLowerCase() !== cliente.nome.toLowerCase())].slice(0, 5));
    if (endereco && (porLink || semEndereco)) salvarEndereco(endereco);
    feiraDaConta(conta.feira);                               // celular novo: volta para a feira de antes
    guardar('banca_meus_pedidos', juntarPedidos(lerLista('banca_meus_pedidos'), conta.pedidos));
    STATE.favoritos = unirFavs(STATE.favoritos, conta.favs); guardar('banca_favs', STATE.favoritos);
    MODO_MEM = limparMemoria(unirModo(MODO_MEM, conta.modo)); guardar('banca_modo', MODO_MEM);
    pintarResumoEndereco(); renderAtalhos();
    if (STATE.lojaRenderizada) renderLoja(true);            // corações e "unidade ou quilo" de cada card
    await carrinhoPronto;
    if (!STATE.carrinho.length && sacolaVale(conta.sacola, conta.sacolaEm)) { sacolaDaConta = conta.sacola; tentarRestaurarSacola(); }
    const primeiro = String(conta.nome || '').trim().split(/\s+/)[0];
    showToast(porLink ? `Pronto${primeiro ? ', ' + primeiro : ''}! Seus dados e pedidos voltaram para este aparelho.` : `Que bom te ver de novo${primeiro ? ', ' + primeiro : ''}! A loja lembrou do seu endereço e dos seus pedidos.`);
};
// Link pessoal: antes de entrar, mostra de quem é a conta. Link mandado por outra pessoa faria os pedidos caírem na conta dela.
const confirmarConta = (previa) => customConfirm(`Entrar como ${previa.nome || 'cliente'}?`,
    `Este link é da conta de ${previa.nome || 'um cliente'}${linhaEndereco(previa, { curto: true }) ? ` (${linhaEndereco(previa, { curto: true })})` : ''}. Se for você, a loja traz seu endereço e seus pedidos para este aparelho. Se você recebeu este link de outra pessoa, toque em "Não sou eu".`,
    { ok: 'Sou eu', nao: 'Não sou eu' });
(EM_PREVIA ? Promise.resolve({ conta: null }) : buscarConta({ semDados: !lerLista('banca_clientes').length && !lerEnderecoSalvo(), confirmar: confirmarConta })).then(({ conta, porLink, erro }) => {
    if (conta) return aplicarConta(conta, porLink);
    if (porLink && erro) showToast(erro, true);
}).catch((e) => console.warn('[conta]', e && e.message));

const esquecerDados = async () => {
    const ok = await customConfirm('Esquecer seus dados neste aparelho?', 'Saem daqui o seu nome, endereço, pedidos e favoritos. Para trazer tudo de volta, toque no link "Meu acesso" que fica no fim de uma mensagem de pedido sua no WhatsApp.', { ok: 'Esquecer', nao: 'Voltar' });
    if (!ok) return;
    try { await sairDaConta(); } catch (e) { return showToast(mensagemDeErroAmigavel(e), true); }
    // o login anônimo deste aparelho também sai: o próximo pedido daqui não herda os pedidos de quem usou antes
    // (só o login anônimo de cliente: quem está logado no painel neste navegador continua logado)
    try { if (auth.currentUser && auth.currentUser.isAnonymous) await signOut(auth); } catch (_) { /* segue */ }
    ['banca_clientes', 'banca_endereco', 'banca_meus_pedidos', 'banca_favs', 'banca_modo', CHAVE_LISTA].forEach((k) => { try { localStorage.removeItem(chave(k)); } catch (_) { /* segue */ } });
    esquecerFeiraCliente();
    showToast('Pronto. Este aparelho esqueceu os seus dados.');
    setTimeout(() => location.reload(), 1300);
};

document.getElementById('btn-salvar-endereco').addEventListener('click', () => {
    const falta = endTopo.validar();
    if (falta) return showToast(falta, true);
    const endNovo = endTopo.ler(); salvarEndereco(endNovo); pintarResumoEndereco(); feiraDoEnderecoSalvo(endNovo);
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
            STATE.carrinho = []; dbStorage.set(chave('banca_cart'), {v: CART_VERSION, items: []}); guardarNaConta();
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
        if(action === 'add' || action === 'inc' || action === 'dec' || action === 'fav' || action === 'trocar') e.stopPropagation();

        // CARD COM UNIDADE E QUILO: cada botão diz o que faz, e o toque faz exatamente isso
        const modo = actionTarget.dataset.modo === 'kg' ? 'kg' : actionTarget.dataset.modo === 'un' ? 'un' : null;
        const noContador = actionTarget.closest('.modo-qtd');
        // o card é achado ANTES de mexer no pedido: mexer redesenha os botões, e o botão tocado deixa de existir
        const cardDoToque = actionTarget.closest('.produto-card');
        if (modo && (action === 'add' || action === 'trocar')) {
            lembrarModo(id, modo);
            modificarCarrinho(id, 1, true, modo);
            if (action === 'add' && cardDoToque) { hapticFeedback(); voarParaPedido(cardDoToque); }
            if (action === 'trocar') showToast(modo === 'kg' ? 'Agora por quilo: 1 kg no pedido.' : 'Agora por unidade: 1 unidade no pedido. Pesamos na hora.');
        }
        else if (noContador && (action === 'inc' || action === 'dec')) {
            const item = STATE.carrinho.find(x => x.id === id);
            if (item) { modificarCarrinho(id, proximaQtd(item, action === 'inc' ? 1 : -1), true); if (action === 'inc') { hapticFeedback(); if (cardDoToque) voarParaPedido(cardDoToque); } }
        }
        else if (action === 'add' || action === 'inc') {
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
            if (p.foto) {
                // Abre JÁ com a foto que está na tela (a miniatura do card), para não piscar em branco,
                // e troca pela foto grande só quando ela terminar de chegar e de ser aberta pelo aparelho.
                const jaNaTela = (fotoCard && fotoCard.complete && fotoCard.naturalWidth ? fotoCard.currentSrc : '') || p.fotoMini || miniatura(p.foto, 384);
                img.dataset.original = p.foto; img.src = jaNaTela; img.style.visibility = '';
                if (jaNaTela !== p.foto) {
                    const grande = new Image();
                    // troca a peça inteira pela foto grande JÁ pronta: mudar só o endereço deixava um instante sem imagem
                    const trocar = () => {
                        const atual = document.getElementById('md-img');
                        if (!atual || STATE.modalProdutoAtual !== p || !document.getElementById('modal-detalhe-produto')?.classList.contains('aberto')) return;
                        grande.id = 'md-img'; grande.alt = p.nome; grande.dataset.original = p.foto; grande.className = atual.className; grande.style.cssText = atual.style.cssText;
                        atual.replaceWith(grande);
                    };
                    grande.onload = () => (grande.decode ? grande.decode().then(trocar, trocar) : trocar());
                    grande.src = p.foto;
                }
            } else { delete img.dataset.original; img.removeAttribute('src'); img.style.visibility = 'hidden'; }
            img.alt = p.nome;
            document.getElementById('md-tag').textContent = p.cat || '';
            document.getElementById('md-desc').textContent = p.descricao || "Produto fresco, selecionado no dia.";
            document.getElementById('md-preco').innerHTML =
                `${emOferta(p) ? `<s class="md-preco-de">${fmt(p.precoDe)}</s> ` : ''}${fmt(p.preco)} <span class="md-preco-unid">/ ${escapeHTML(p.unidade || 'un')}</span>`;

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
                const tipoInicial = jaNoCarrinho ? (jaNoCarrinho.tipo === 'kg' ? 'kg' : 'un') : modoPreferido(p, MODO_MEM);   // o que já está no pedido; senão, o jeito que este cliente (ou a loja) prefere
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
                if (!STATE.produtos.some(x => x.id === p.id)) { showToast('Este produto acabou de sair da loja.', true); closeModal('modal-detalhe-produto'); if (history.state && history.state.modal === 'modal-detalhe-produto') history.back(); return; }
                // fixo=true: usa exatamente a quantidade escolhida (não incrementa)
                if (temDoisModos(p)) lembrarModo(p.id, STATE.modalTipoCompra === 'kg' ? 'kg' : 'un');
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
            guardarNaConta();
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
        else if (action === 'indicar') { indicarLoja(); }
        else if (action === 'esquecer-dados') { esquecerDados(); }
        else if (action === 'copiar-pix') { copiarPix(actionTarget); }
        else if (action === 'instalar') { instalarApp(); }
        else if (action === 'por-lista') { const l = lerListaSemana(); if (l) porNoPedido(l.itens); }
        else if (action === 'ver-lista') { verListaDaSemana(); }
        else if (action === 'guardar-lista') { guardarListaDaSemana(); }
        else if (action === 'estrela') { marcarEstrela(actionTarget); }
        else if (action === 'enviar-avaliacao') { enviarAvaliacao(actionTarget); }
        else if (action === 'cancelar-pedido') { cancelarPedido(id); }
        else if (action === 'pagar-pix') { pagarComPix(id, Number(actionTarget.dataset.total) || 0); }
        else if (action === 'toggle-troco') {
            const valor = actionTarget.dataset.value;
            const inputArea = document.getElementById('input-troco-area'); const cliTroco = document.getElementById('cli-troco');
            if(valor === 'nao') { cliTroco.value = 'Não preciso'; inputArea.style.display = 'none'; } 
            else { cliTroco.value = ''; inputArea.style.display = 'block'; cliTroco.focus(); }
        }
        return; 
    }
});

// Campos de quantidade (carrinho e tela do produto) só aceitam número. No celular o teclado
// já é numérico; no computador dava para digitar letra ("x" no lugar de 1). A limpeza roda
// antes dos outros tratadores (captura), para eles nunca verem o texto sujo.
document.addEventListener('input', (e) => {
    const campo = e.target;
    if (!campo.classList || !(campo.classList.contains('qtd-input') || campo.classList.contains('md-qtd-input'))) return;
    const soInteiro = campo.classList.contains('qtd-input') && campo.closest('.qtd-ctrl')?.querySelector('.qtd-unid')?.textContent.trim() === 'un';
    const limpo = limparQuantidade(campo.value, soInteiro);
    if (limpo !== campo.value) { const pos = Math.max(0, (campo.selectionStart || limpo.length) - (campo.value.length - limpo.length)); campo.value = limpo; try { campo.setSelectionRange(pos, pos); } catch (_) { /* campo sem seleção */ } }
}, true);

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
        // colar texto (Ctrl+V) também passa pela limpeza: "2x" não vira 2 por acidente
        const texto = e.target.value.trim();
        let val = /^\d{1,4}([.,]\d{0,3})?$/.test(texto) ? parseFloat(texto.replace(',', '.')) : NaN;
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
const assinaturaDoCarrinho = () => STATE.carrinho.map(i => `${i.id}:${i.qtd}:${i.tipo || ''}`).join('|');
// Guarda o carrinho JÁ (sem esperar) e recarrega buscando a versão nova no servidor.
const recarregarComPedidoGuardado = (aviso) => {
    try { clearTimeout(debounceSalvarCarrinho); dbStorage.set(chave('banca_cart'), { v: CART_VERSION, items: STATE.carrinho }); } catch (_) { /* segue */ }
    try { sessionStorage.setItem('banca_atualizou', '1'); } catch (_) { /* sem armazenamento */ }
    showToast(aviso);
    setTimeout(recarregarFresco, 1600);
};
try { if (sessionStorage.getItem('banca_atualizou')) { sessionStorage.removeItem('banca_atualizou'); setTimeout(() => showToast('Loja atualizada. Seu pedido continua aqui: é só finalizar.'), 1800); } } catch (_) { /* sem armazenamento */ }

document.getElementById('btn-abrir-checkout').addEventListener('click', () => {
    // TELA DESATUALIZADA: fechar o pedido numa tela velha é onde dá problema (campo que não existe mais,
    // regra que mudou). Se já sabemos que há versão nova, atualiza ANTES de abrir a tela de entrega.
    if (haVersaoNova()) return recarregarComPedidoGuardado('A loja foi atualizada. Um instante: seu pedido continua na sacola.');
    const clientes = lerLista('banca_clientes');
    if (clientes.length > 0) {
        document.getElementById('cli-nome').value = clientes[0].nome || '';
        const campoTel = document.getElementById('cli-telefone');
        if (campoTel && !campoTel.value && clientes[0].tel) campoTel.value = clientes[0].tel;
    }
    endCheckout.preencher(lerEnderecoSalvo());
    // A chave identifica ESTE pedido no servidor. Ela só muda quando o pedido muda: se o envio
    // cair no meio e a pessoa abrir de novo e reenviar, o servidor reconhece e não cria um segundo pedido.
    const cara = assinaturaDoCarrinho();
    if (!STATE.checkoutSessionId || STATE.checkoutCara !== cara) { STATE.checkoutSessionId = novoId(); STATE.checkoutCara = cara; }
    pintarHorariosDeEntrega();      // garante a lista de horários na hora de abrir (não depende de a configuração ter chegado antes)
    pintarAvisoDeEntrega();
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
    // Horário de entrega: escolher é OPCIONAL. Sem escolha, o pedido chega à loja como "horário a combinar".
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

        // o condomínio escolhido agora pode ser de uma feira desta banca. Se a feira mudou, os preços e a data
        // mudam junto: NÃO envia com um valor que a pessoa não viu. Atualiza a sacola e pede para conferir.
        const feiraAntes = lerFeiraCliente();
        if (endereco.condominio) { try { await feiraPeloCondominio(endereco.condominio, perguntarFeira); } catch (_) { /* segue */ } }
        if (lerFeiraCliente() !== feiraAntes || (STATE.diaDoPreco != null && diaDoPreco() !== STATE.diaDoPreco)) {
            document.dispatchEvent(new CustomEvent('feira-do-cliente')); pintarAvisoDeEntrega();
            const ent = entregaDaFeira();
            showToast(ent && !ent.hoje ? `Seu condomínio é atendido na feira de ${textoDoDia(ent.dia)}: os preços são os desse dia. Confira e toque em enviar de novo.` : 'Os preços foram atualizados. Confira e toque em enviar de novo.');
            return;
        }
        const ent = entregaDaFeira();
        const payload = {
            feira: lerFeiraCliente(),
            diaPreco: STATE.diaDoPreco, ...(ent ? { entregaDia: ent.dia } : {}),   // o dia que a loja mostrou: o servidor confere
            nome, quadra, lote, telefone, pag, troco: trocoRaw, obs, cupom,
            condominio: endereco.condominio, condominioId: endereco.condominioId, formatoEndereco: endereco.formatoEndereco,
            aceitaOfertas: !!document.getElementById('cli-ofertas')?.checked,
            itens: itensFormatados,
            horarioEntrega: document.getElementById('cli-horario')?.value || '',
            clientTotal: totalEstimado, // Manda só o valor do que é exato
            status: itensFormatados.some(i => i.aPesar) ? 'aguardando_pesagem' : 'pendente', // Avisa o Admin!
            idempotencyKey: STATE.checkoutSessionId
            // userId saiu daqui de propósito: o servidor tira o dono do pedido
            // do token de autenticação, que é assinado e não pode ser forjado.
        };

        // comToken faz a requisição levar o token da sessão. É ele que permite
        // à cliente cancelar o pedido depois pela própria loja.
        const data = await chamarApi('/api/checkout', payload, { comToken: true });

        // O pedido JÁ FOI ACEITO. Guardar no aparelho é só conveniência: se falhar (memória cheia,
        // armazenamento bloqueado), a cliente não pode ver "erro" nem ficar com o pedido ainda aberto.
        STATE.checkoutSessionId = null;
        try {
            const clientes = lerLista('banca_clientes');
            const idx = clientes.findIndex(c => String(c && c.nome || '').toLowerCase() === nome.toLowerCase());
            // o cliente deste pedido vai para a frente da lista (é ele que preenche o próximo pedido)
            const este = { nome, quadra, lote, ...(telefone ? { tel: telefone } : {}) };
            if (idx >= 0) clientes.splice(idx, 1);
            clientes.unshift(este);
            localStorage.setItem(chave('banca_clientes'), JSON.stringify(clientes.slice(0, 5)));
            if (data.temConta) marcarConta(true);
            salvarEndereco(endereco); pintarResumoEndereco(); feiraDoEnderecoSalvo(endereco);

            const meusPedidos = lerLista('banca_meus_pedidos');
            meusPedidos.unshift({
                id: data.pedido.id, data: new Date().toISOString(), total: data.pedido.total,
                descItens: STATE.carrinho.map(i => i.tipo === 'un' && isFracionavel(i.unidade) ? `${i.qtd} un de ${i.nome} (A Pesar)` : `${i.qtd}x ${i.nome}`).join(', '),
                itens: itensFormatados
            });
            localStorage.setItem(chave('banca_meus_pedidos'), JSON.stringify(meusPedidos.slice(0, 10)));

        } catch (e) { console.warn('[loja] pedido enviado, mas não consegui guardar no aparelho:', e && e.message); }

        mostrarLinksWhatsApp(data.pedido);
        const dicaAcesso = document.getElementById('sucesso-dica-acesso'); if (dicaAcesso) dicaAcesso.hidden = !data.temConta;
        const sucEnt = document.getElementById('sucesso-entrega');
        if (sucEnt) { const futuro = data.pedido && data.pedido.paraHoje === false && data.pedido.entregaDia; sucEnt.textContent = futuro ? `📅 Seu pedido é para ${textoDoDia(data.pedido.entregaDia)}.` : ''; sucEnt.hidden = !futuro; }
        oferecerPixNoSucesso({ id: data.pedido.id, total: data.pedido.total, pag, status: 'pendente', temItensAPesar: itensFormatados.some(i => i.aPesar) });
        closeModal('modal-checkout');
        setTimeout(() => openModal('modal-sucesso'), 300); 
        STATE.carrinho = []; dbStorage.set(chave('banca_cart'), {v: CART_VERSION, items: []}); guardarNaConta();
        renderCarrinhoCompleto();
        document.getElementById('cli-obs').value = '';
        const campoCupom = document.getElementById('cli-cupom');
        if (campoCupom) campoCupom.value = '';
        

    } catch(err) {
        // O dia virou (horário limite, meia-noite, relógio do celular): o pedido NÃO foi criado. Acerta o relógio,
        // refaz os preços e a data na tela e deixa a pessoa conferir antes de enviar de novo.
        if (err && err.dados && err.dados.codigo === 'dia-mudou') {
            if (Number.isFinite(err.dados.agora)) ACERTO_RELOGIO = err.dados.agora - Date.now();
            document.dispatchEvent(new CustomEvent('feira-do-cliente')); pintarAvisoDeEntrega();
            showToast(err.message, true);
            return;
        }
        // Antes ia "Failed to fetch" cru, em inglês, para a tela da cliente
        showToast(mensagemDeErroAmigavel(err), true);
        // O servidor recusou e esta tela está desatualizada? Então o motivo pode ser a própria tela velha:
        // guarda nome e endereço, atualiza e deixa a pessoa enviar de novo (o pedido NÃO foi criado).
        // (sem "await": o botão volta a funcionar na hora; a conferência corre por fora)
        if (navigator.onLine) conferirVersaoAgora().then((velha) => {
            if (!velha) return;
            try { salvarEndereco(endereco); const cl = lerLista('banca_clientes').filter(c => String(c && c.nome || '').toLowerCase() !== nome.toLowerCase()); cl.unshift({ nome, quadra, lote }); localStorage.setItem(chave('banca_clientes'), JSON.stringify(cl.slice(0, 5))); } catch (_) { /* segue */ }
            recarregarComPedidoGuardado('A loja foi atualizada. Vou recarregar: seu pedido continua na sacola.');
        }).catch(() => { /* sem sinal: fica o aviso de cima */ });
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
