import { auth, db, storage, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut, collection, doc, setDoc, deleteDoc, onSnapshot, ref, uploadBytes, getDownloadURL, query, orderBy, limit, writeBatch, where, updateDoc } from './firebase.js';
import { fmt, escapeHTML, formatarQtdRelatorio, showToast, openModal, closeModal, customConfirm } from './utils.js';
import { exigirAdmin, iniciarLogoutPorInatividade } from './admin-guard.js';

// Chart.js agora é carregado sob demanda (só ao abrir o Dashboard).
// Isso tira ~200KB do carregamento inicial do painel.
let Chart = null;
const carregarChart = async () => {
    if (!Chart) { const mod = await import('chart.js/auto'); Chart = mod.default; }
    return Chart;
};

let produtosAtuais = [];
let pedidosGerais = [];
let unsubscribes = [];
let adminBuscaTermo = "";
let pedidoBuscaTermo = "";

const placeholderSVG = `<div class="prod-img-placeholder skeleton" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:0.8rem">Sem Foto</div>`;

const normalizar = (txt) => String(txt || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// =====================================================================
// COMPRESSÃO DE IMAGEM — agora fora da main thread + corrige EXIF
// createImageBitmap decodifica em thread separada, então o painel não
// congela ao salvar foto grande de celular. imageOrientation corrige
// fotos de retrato que apareciam deitadas.
// =====================================================================
const compressImageToJPG = async (file, maxWidth = 1000, quality = 0.8) => {
    const desenhar = (w, h, fonte) => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d', { alpha: false }).drawImage(fonte, 0, 0, w, h);
        return new Promise((resolve) => canvas.toBlob(
            (blob) => resolve(new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), { type: 'image/jpeg' })),
            'image/jpeg', quality
        ));
    };

    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (bitmap) {
        let { width, height } = bitmap;
        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        const saida = await desenhar(width, height, bitmap);
        bitmap.close?.();
        return saida;
    }

    // Fallback para navegadores sem createImageBitmap
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
            let width = img.width, height = img.height;
            if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
            resolve(await desenhar(width, height, img));
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
};

// =====================================================================
// AUTENTICAÇÃO + AUTORIZAÇÃO
// ANTES: bastava estar logado para ver o painel. Como o login é por link
// mágico, qualquer pessoa pedia um link para o próprio e-mail e entrava.
// AGORA: exige o custom claim `admin: true`, que só o servidor grava.
// =====================================================================
onAuthStateChanged(auth, async (user) => {
    unsubscribes.forEach(unsub => unsub());
    unsubscribes = [];

    if (!user) {
        document.getElementById('login-screen').style.display = 'block';
        document.getElementById('dashboard').style.display = 'none';
        return;
    }

    const autorizado = await exigirAdmin(user);
    if (!autorizado) return; // o guard já exibe a tela de bloqueio

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    iniciarLogoutPorInatividade(30);
    iniciarIAFeaturesDOM();
    iniciarRealTimeSync();
});

let isLoginProcessing = false;
document.getElementById('btn-login').addEventListener('click', async () => {
    if (isLoginProcessing) return;
    const email = document.getElementById('email').value.trim();
    const msg = document.getElementById('login-msg');

    if (!email || !email.includes('@')) {
        msg.textContent = "⚠️ Digite um e-mail válido."; msg.style.color = "var(--danger)"; return;
    }

    isLoginProcessing = true; document.getElementById('btn-login').disabled = true;
    msg.textContent = "A enviar link..."; msg.style.color = "var(--text-dark)";

    try {
        await sendSignInLinkToEmail(auth, email, { url: window.location.href, handleCodeInApp: true });
        window.sessionStorage.setItem('emailForSignIn', email);
        msg.textContent = "✅ Link enviado! Verifique o e-mail."; msg.style.color = "var(--success)";
    } catch (error) {
        msg.textContent = "❌ Erro ao enviar. Tente novamente."; msg.style.color = "var(--danger)";
    } finally {
        setTimeout(() => { isLoginProcessing = false; document.getElementById('btn-login').disabled = false; }, 5000);
    }
});

if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.sessionStorage.getItem('emailForSignIn');
    const processLogin = async () => {
        if (!email) email = prompt("Por segurança, confirme o seu e-mail:");
        if (email) {
            try {
                await signInWithEmailLink(auth, email, window.location.href);
                window.sessionStorage.removeItem('emailForSignIn');
            } catch (e) { showToast("Link expirado ou inválido.", true); }
        }
    };
    processLogin();
}

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

document.querySelector('.tabs').addEventListener('click', (e) => {
    if (e.target.classList.contains('tab')) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.aba-content').forEach(c => c.classList.remove('active'));

        e.target.classList.add('active');
        document.getElementById(`aba-${e.target.dataset.aba}`).classList.add('active');

        if (e.target.dataset.aba === 'relatorios') renderRelatoriosMaster();
        if (e.target.dataset.aba === 'balanco') carregarBalanco(Number(document.getElementById('balanco-periodo')?.value || 30));
        if (e.target.dataset.aba === 'comunicados') renderComunicados();
    }
});

document.querySelectorAll('[data-fechar]').forEach(btn => {
    btn.addEventListener('click', (e) => { closeModal(e.currentTarget.dataset.fechar); });
});

const playAlertaPedido = () => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode); gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine'; oscillator.frequency.value = 850;
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start(); oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {}
};

const iniciarRealTimeSync = () => {
    const unsubProd = onSnapshot(collection(db, "produtos"), (snap) => {
        produtosAtuais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (b.ultimaModificacao || 0) - (a.ultimaModificacao || 0));
        renderProdutos();
    });
    unsubscribes.push(unsubProd);

    const unsubConfig = onSnapshot(doc(db, "loja", "config"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('config-wpp').value = data.wpp || '';
            document.getElementById('config-minimo').value = data.minimo || 0;
            document.getElementById('config-status-loja').value = data.lojaAberta === false ? "fechada" : "aberta";
            const diasSalvos = data.diasAbertos || [0, 1, 2, 3, 4, 5, 6];
            document.querySelectorAll('.chk-dia').forEach(chk => chk.checked = diasSalvos.includes(parseInt(chk.value)));
        }
    });
    unsubscribes.push(unsubConfig);

    const unsubComunicados = onSnapshot(doc(db, "loja", "comunicados"), (snap) => {
        if (snap.exists()) comunicadosAtuais = { dias: {}, fixo: { ativo: false, texto: '' }, ...snap.data() };
        renderComunicados();
    });
    unsubscribes.push(unsubComunicados);

    // ATENÇÃO: esta consulta combina "where in" + "orderBy", o que exige um
    // ÍNDICE COMPOSTO no Firestore. Se aparecer erro no console com um link,
    // clique nele: o Firebase cria o índice sozinho (leva ~1 min).
    const pedQuery = query(
        collection(db, "pedidos"),
        where("status", "in", ["pendente", "aguardando_pesagem", "aguardando_pagamento", "preparando", "enviado"]),
        orderBy("data", "desc"), limit(100)
    );
    let cargaInicial = true;

    const unsubPedidos = onSnapshot(pedQuery, (snap) => {
        const temNovoPendente = snap.docChanges().some(change =>
            change.type === 'added' &&
            ['pendente', 'aguardando_pesagem'].includes(change.doc.data().status)
        );
        if (!cargaInicial && temNovoPendente) {
            playAlertaPedido();
            showToast("🔔 NOVO PEDIDO NA FILA!", false);
            if (Notification.permission === "granted") new Notification("Banca", { body: "Novo pedido chegou!" });
        }
        cargaInicial = false;
        pedidosGerais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (document.getElementById('aba-relatorios').classList.contains('active')) renderRelatoriosMaster();
    }, (erro) => {
        console.error('Erro na consulta de pedidos:', erro);
        showToast("Erro ao carregar pedidos. Verifique o índice do Firestore.", true);
    });
    unsubscribes.push(unsubPedidos);

    if (Notification.permission !== "denied") Notification.requestPermission();
};

document.getElementById('admin-busca-input')?.addEventListener('input', (e) => {
    adminBuscaTermo = normalizar(e.target.value);
    renderProdutos();
});

const getEstoqueBadge = (estoqueFisico, ativo) => {
    if (!ativo) return `<span class="badge-estoque esgotado">Esgotado Indefinido</span>`;
    if (estoqueFisico === undefined || estoqueFisico === null || estoqueFisico === "") return `<span class="badge-estoque alto">Stock: Ilimitado</span>`;
    if (estoqueFisico <= 0) return `<span class="badge-estoque esgotado">Stock: ZERADO</span>`;
    if (estoqueFisico <= 5) return `<span class="badge-estoque baixo">Stock Baixo: ${estoqueFisico} restam</span>`;
    return `<span class="badge-estoque alto">Stock: ${estoqueFisico} un.</span>`;
};

const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const ehFracionavel = (u) => FRACIONAVEIS.includes(String(u || '').toLowerCase());

const renderProdutos = () => {
    const listaFiltrada = produtosAtuais.filter(p => {
        if (!adminBuscaTermo) return true;
        return normalizar(p.nome).includes(adminBuscaTermo) || normalizar(p.cat).includes(adminBuscaTermo);
    });

    const html = listaFiltrada.map(p => {
        // Aviso quando falta o peso médio num produto vendido a peso:
        // sem ele, o cliente não vê estimativa ao pedir "5 unidades".
        const precisaPeso = ehFracionavel(p.unidade) && !p.pesoMedio;
        const avisoPeso = precisaPeso
            ? `<span class="badge-estoque baixo" style="margin-top:4px;display:inline-block;">⚖️ Sem peso médio</span>` : '';

        return `
        <article class="card-produto ${p.ativo ? '' : 'esgotado'}">
            <div class="prod-info-grande">
                <div class="prod-img-grande">${p.foto ? `<img src="${escapeHTML(p.foto)}" loading="lazy" alt="${escapeHTML(p.nome)}">` : placeholderSVG}</div>
                <div class="prod-detalhes">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <h4>${escapeHTML(p.nome)}</h4>
                        <button class="btn-social-media" data-action="gerar-post" data-id="${escapeHTML(p.id)}" title="Gerar Post Instagram/WPP">Post IA</button>
                    </div>
                    <p>${fmt(p.preco)} <span style="font-size:0.9rem; color:var(--text-light); font-weight:normal">/${escapeHTML(p.unidade)}</span></p>
                    ${getEstoqueBadge(p.estoqueFisico, p.ativo)}
                    ${avisoPeso}
                </div>
            </div>
            <div class="botoes-acao">
                ${p.ativo
                    ? `<button class="btn btn-outline flex-1" style="border-color:var(--danger); color:var(--danger);" data-action="toggle-estoque" data-id="${escapeHTML(p.id)}" data-status="false">Esgotar</button>`
                    : `<button class="btn btn-outline flex-1" style="background:var(--success); border-color:var(--success); color:white;" data-action="toggle-estoque" data-id="${escapeHTML(p.id)}" data-status="true">Em Estoque</button>`
                }
                <button class="btn btn-outline" style="background: var(--parchment); color: var(--text-dark); border-color: #e0dcd4;" data-action="editar-produto" data-id="${escapeHTML(p.id)}">Editar</button>
            </div>
        </article>`;
    }).join('');

    document.getElementById('lista-produtos').innerHTML = html || "<p style='color:var(--text-light)'>Nenhum produto encontrado na busca.</p>";
};

document.getElementById('edit-foto')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    const previewContainer = document.getElementById('preview-foto-wrapper');
    if (file && previewContainer) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            previewContainer.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" alt="Pré-visualização">`;
        };
        reader.readAsDataURL(file);
    }
});

// Mostra/esconde o campo de peso médio conforme a métrica de venda
const alternarCampoPesoMedio = () => {
    const grupo = document.getElementById('form-group-peso-medio');
    const unidade = document.getElementById('edit-unidade')?.value;
    if (grupo) grupo.style.display = ehFracionavel(unidade) ? 'block' : 'none';
};
document.getElementById('edit-unidade')?.addEventListener('change', alternarCampoPesoMedio);

const injetarEstoqueUI = () => {
    if (!document.getElementById('edit-estoque-fisico')) {
        const precoRow = document.getElementById('edit-preco')?.closest('.grid-2');
        if (precoRow) {
            precoRow.insertAdjacentHTML('afterend', `
                <div class="form-group-estoque">
                    <label for="edit-estoque-fisico">📦 Quantidade Física em Stock (Opcional)</label>
                    <input type="number" id="edit-estoque-fisico" min="0" placeholder="Ex: 50 (Deixe em branco p/ infinito)">
                    <small style="color:var(--text-light); font-size:0.75rem; display:block; margin-top:4px;">Se preenchido, o produto irá esgotar automaticamente quando chegar a 0 no e-commerce.</small>
                </div>
            `);
        }
    }
};

// =====================================================================
// ESTEIRA DE SEPARAÇÃO — tela cheia, um produto por vez
// Fluxo: foto grande -> peso (ou valor automático) -> seta avança ->
//        tela de conferência -> envia pro WhatsApp da cliente.
// =====================================================================
const ESTEIRA = {
    pedido: null,
    itens: [],        // cópia de trabalho, com pesoFinal/subtotal preenchidos
    indice: 0,
    conferindo: false
};

const ehItemDeBalanca = (item) => item.aPesar === true;

const valorDoItem = (item) => {
    if (ehItemDeBalanca(item)) {
        return item.pesoFinal > 0 ? item.pesoFinal * (item.precoOriginal || 0) : 0;
    }
    return (item.precoOriginal || 0) * (item.qtd || 0);
};

const totalDaEsteira = () => ESTEIRA.itens.reduce((soma, i) => soma + valorDoItem(i), 0);

const fotoDoProduto = (item) => {
    const p = produtosAtuais.find(x => x.id === item.id);
    return p && p.foto ? p.foto : null;
};

const injetarEsteira = () => {
    if (document.getElementById('picking-palco')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="picking-palco" id="picking-palco" role="dialog" aria-modal="true" aria-label="Separação de pedido">
        <div class="pk-topo">
            <button class="pk-sair" id="pk-sair" aria-label="Fechar separação">&times;</button>
            <div class="pk-cliente">
                <strong id="pk-cliente-nome">Cliente</strong>
                <span id="pk-cliente-end"></span>
            </div>
        </div>
        <div class="pk-trilha" id="pk-trilha"></div>
        <div class="pk-corpo" id="pk-corpo"></div>
        <div class="pk-rodape" id="pk-rodape"></div>
    </div>`);

    document.getElementById('pk-sair').addEventListener('click', async () => {
        const ok = await customConfirm('Sair da separação?', 'Os pesos digitados até agora serão perdidos.');
        if (ok) fecharEsteira();
    });

    // Arrastar para os lados troca de produto (igual carrossel)
    const corpo = document.getElementById('pk-corpo');
    let x0 = null;
    corpo.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    corpo.addEventListener('touchend', (e) => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (ESTEIRA.conferindo) return;
        if (dx < -70) avancarEsteira();
        else if (dx > 70) voltarEsteira();
    }, { passive: true });

    // Enter no campo de peso avança
    corpo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.id === 'pk-peso') { e.preventDefault(); avancarEsteira(); }
    });
};

const fecharEsteira = () => {
    document.getElementById('picking-palco')?.classList.remove('aberto');
    document.body.style.overflow = '';
};

const renderTrilha = () => {
    const trilha = document.getElementById('pk-trilha');
    trilha.innerHTML = ESTEIRA.itens.map((item, i) => {
        const pronto = ehItemDeBalanca(item) ? item.pesoFinal > 0 : true;
        const classe = ESTEIRA.conferindo ? (pronto ? 'feito' : '')
                     : i === ESTEIRA.indice ? 'atual' : (pronto ? 'feito' : '');
        return `<button class="pk-passo ${classe}" data-ir="${i}" aria-label="Ir para item ${i + 1}"></button>`;
    }).join('');
    trilha.querySelectorAll('[data-ir]').forEach(b => {
        b.addEventListener('click', () => { ESTEIRA.conferindo = false; ESTEIRA.indice = Number(b.dataset.ir); renderEsteira(); });
    });
};

const renderItemAtual = () => {
    const item = ESTEIRA.itens[ESTEIRA.indice];
    const corpo = document.getElementById('pk-corpo');
    const rodape = document.getElementById('pk-rodape');
    const foto = fotoDoProduto(item);
    const prod = produtosAtuais.find(p => p.id === item.id);

    const blocoFoto = foto
        ? `<img class="pk-foto" src="${escapeHTML(foto)}" alt="${escapeHTML(item.nome)}">`
        : `<div class="pk-foto pk-foto-vazia">🥬</div>`;

    if (ehItemDeBalanca(item)) {
        // Se há peso médio cadastrado, sugere quanto deve dar
        let esperado = '';
        if (prod && prod.pesoMedio > 0) {
            const kg = (prod.pesoMedio * item.qtd) / 1000;
            esperado = `Deve dar por volta de ${kg.toFixed(2).replace('.', ',')} kg`;
        }
        const valorAtual = item.pesoFinal > 0 ? fmt(item.pesoFinal * item.precoOriginal) : '';

        corpo.innerHTML = `
            <span class="pk-contador">Produto ${ESTEIRA.indice + 1} de ${ESTEIRA.itens.length}</span>
            ${blocoFoto}
            <h2 class="pk-nome">${escapeHTML(item.nome)}</h2>
            <p class="pk-pedido-cliente">A cliente pediu ${item.qtd} ${item.qtd === 1 ? 'unidade' : 'unidades'}</p>
            <p class="pk-esperado">${esperado}</p>
            <div class="pk-balanca">
                <label for="pk-peso">Coloque na balança e digite o peso</label>
                <div class="pk-input-linha">
                    <input type="number" id="pk-peso" class="pk-input-peso" step="0.001" inputmode="decimal"
                           placeholder="0,000" value="${item.pesoFinal || ''}">
                    <span class="pk-unid-balanca">kg</span>
                </div>
                <div class="pk-atalhos">
                    ${[0.25, 0.5, 0.75, 1, 1.5, 2].map(v =>
                        `<button class="pk-atalho" data-peso="${v}">${v < 1 ? (v * 1000) + 'g' : String(v).replace('.', ',') + 'kg'}</button>`
                    ).join('')}
                </div>
                <div class="pk-valor-vivo" id="pk-valor">${valorAtual}</div>
            </div>`;

        const campo = document.getElementById('pk-peso');
        const alvo = document.getElementById('pk-valor');
        const btnAvancar = () => document.getElementById('pk-avancar');

        const atualizar = () => {
            const peso = parseFloat(String(campo.value).replace(',', '.'));
            if (Number.isFinite(peso) && peso > 0) {
                item.pesoFinal = peso;
                alvo.textContent = fmt(peso * item.precoOriginal);
                if (btnAvancar()) btnAvancar().disabled = false;
            } else {
                item.pesoFinal = 0;
                alvo.textContent = '';
                if (btnAvancar()) btnAvancar().disabled = true;
            }
            renderTrilha();
        };

        campo.addEventListener('input', atualizar);
        corpo.querySelectorAll('.pk-atalho').forEach(b => {
            b.addEventListener('click', () => { campo.value = b.dataset.peso; atualizar(); campo.focus(); });
        });
        setTimeout(() => campo.focus(), 120);

    } else {
        // Item de valor fechado (unidade, maço, bandeja): calcula sozinho
        const total = (item.precoOriginal || 0) * (item.qtd || 0);
        corpo.innerHTML = `
            <span class="pk-contador">Produto ${ESTEIRA.indice + 1} de ${ESTEIRA.itens.length}</span>
            ${blocoFoto}
            <h2 class="pk-nome">${escapeHTML(item.nome)}</h2>
            <p class="pk-pedido-cliente">${formatarQtdRelatorio(item.qtd, item.unidade)} ${escapeHTML(item.unidade || 'un')}</p>
            <div class="pk-fixo">
                <small>Este item não vai à balança — o valor já é fechado.</small>
                <div class="pk-valor-vivo">${fmt(total)}</div>
                <small>Só confira se separou a quantidade certa.</small>
            </div>`;
    }

    const primeiro = ESTEIRA.indice === 0;
    const ultimo = ESTEIRA.indice === ESTEIRA.itens.length - 1;
    const bloqueado = ehItemDeBalanca(item) && !(item.pesoFinal > 0);

    rodape.innerHTML = `
        <button class="pk-nav" id="pk-voltar" ${primeiro ? 'disabled' : ''} aria-label="Produto anterior">‹</button>
        <button class="pk-avancar" id="pk-avancar" ${bloqueado ? 'disabled' : ''}>
            ${ultimo ? 'Conferir pedido ✓' : 'Próximo produto ›'}
        </button>`;
    document.getElementById('pk-voltar').addEventListener('click', voltarEsteira);
    document.getElementById('pk-avancar').addEventListener('click', avancarEsteira);
};

const renderConferencia = () => {
    const corpo = document.getElementById('pk-corpo');
    const rodape = document.getElementById('pk-rodape');
    const total = totalDaEsteira();
    const estimado = Number(ESTEIRA.pedido.clientTotal || 0);

    const linhas = ESTEIRA.itens.map((item, i) => {
        const foto = fotoDoProduto(item);
        const detalhe = ehItemDeBalanca(item)
            ? `${item.qtd} un • pesou ${String(item.pesoFinal).replace('.', ',')} kg × ${fmt(item.precoOriginal)}`
            : `${formatarQtdRelatorio(item.qtd, item.unidade)} × ${fmt(item.precoOriginal)}`;
        return `
        <div class="pk-linha">
            ${foto ? `<img class="pk-linha-foto" src="${escapeHTML(foto)}" alt="">`
                   : `<div class="pk-linha-foto"></div>`}
            <div class="pk-linha-info">
                <div class="pk-linha-nome">${escapeHTML(item.nome)}</div>
                <div class="pk-linha-detalhe">${detalhe}</div>
                <button class="pk-linha-editar" data-corrigir="${i}">corrigir</button>
            </div>
            <div class="pk-linha-valor">${fmt(valorDoItem(item))}</div>
        </div>`;
    }).join('');

    corpo.innerHTML = `
        <div class="pk-conferencia">
            <h2>Confira antes de enviar</h2>
            <p class="pk-sub">Toque em "corrigir" se algum peso ficou errado.</p>
            ${linhas}
            <div class="pk-total">
                <div class="pk-total-linha"><span>Estimado no pedido</span><span>${fmt(estimado)}</span></div>
                <div class="pk-total-final"><span>Valor exato</span><strong>${fmt(total)}</strong></div>
            </div>
            <div class="pk-acoes-finais">
                <button class="pk-btn-enviar" id="pk-enviar">📲 Enviar para a cliente</button>
                <button class="pk-btn-secundario" id="pk-reconferir">🔄 Reconferir desde o início</button>
                <button class="pk-btn-secundario" id="pk-salvar-sem-enviar">Salvar sem avisar agora</button>
            </div>
        </div>`;
    rodape.innerHTML = '';

    corpo.querySelectorAll('[data-corrigir]').forEach(b => {
        b.addEventListener('click', () => {
            ESTEIRA.conferindo = false;
            ESTEIRA.indice = Number(b.dataset.corrigir);
            renderEsteira();
        });
    });
    document.getElementById('pk-reconferir').addEventListener('click', () => {
        ESTEIRA.conferindo = false; ESTEIRA.indice = 0; renderEsteira();
    });
    document.getElementById('pk-enviar').addEventListener('click', (e) => finalizarEsteira(e.currentTarget, true));
    document.getElementById('pk-salvar-sem-enviar').addEventListener('click', (e) => finalizarEsteira(e.currentTarget, false));
};

const renderEsteira = () => {
    renderTrilha();
    if (ESTEIRA.conferindo) renderConferencia(); else renderItemAtual();
};

const avancarEsteira = () => {
    const item = ESTEIRA.itens[ESTEIRA.indice];
    if (ehItemDeBalanca(item) && !(item.pesoFinal > 0)) {
        return showToast('⚠️ Digite o peso marcado na balança.', true);
    }
    if (ESTEIRA.indice < ESTEIRA.itens.length - 1) ESTEIRA.indice++;
    else ESTEIRA.conferindo = true;
    renderEsteira();
};

const voltarEsteira = () => {
    if (ESTEIRA.indice > 0) { ESTEIRA.indice--; renderEsteira(); }
};

const abrirEsteira = (pedido) => {
    injetarEsteira();
    ESTEIRA.pedido = pedido;
    ESTEIRA.itens = JSON.parse(JSON.stringify(pedido.itens || []));
    ESTEIRA.itens.forEach(i => { if (!i.pesoFinal) i.pesoFinal = 0; });
    ESTEIRA.indice = 0;
    ESTEIRA.conferindo = false;

    document.getElementById('pk-cliente-nome').textContent = pedido.nome || 'Cliente';
    document.getElementById('pk-cliente-end').textContent =
        `Quadra ${pedido.quadra || '?'} • Lote ${pedido.lote || '?'}`;

    if (ESTEIRA.itens.length === 0) return showToast('Este pedido não tem itens.', true);

    document.getElementById('picking-palco').classList.add('aberto');
    document.body.style.overflow = 'hidden';
    renderEsteira();
};

// Monta a mensagem final que a cliente recebe
const montarMensagemCliente = () => {
    const p = ESTEIRA.pedido;
    let msg = `*Banca Adair e Pedrina*\\n`;
    msg += `Olá, ${String(p.nome || '').split(' ')[0]}! Seu pedido já foi separado e pesado 🌿\\n\\n`;
    msg += `*Seu pedido:*\\n`;

    ESTEIRA.itens.forEach(item => {
        if (ehItemDeBalanca(item)) {
            msg += `• ${item.nome} — ${item.qtd} un (pesou ${String(item.pesoFinal).replace('.', ',')} kg) = ${fmt(valorDoItem(item))}\\n`;
        } else {
            msg += `• ${item.nome} — ${formatarQtdRelatorio(item.qtd, item.unidade)} = ${fmt(valorDoItem(item))}\\n`;
        }
    });

    msg += `\\n*Total: ${fmt(totalDaEsteira())}*\\n`;
    msg += `Pagamento: ${p.pag || 'a combinar'}\\n`;
    if (p.troco) msg += `Troco para: ${p.troco}\\n`;
    msg += `Entrega: Quadra ${p.quadra} • Lote ${p.lote}\\n\\n`;
    msg += `Qualquer coisa é só chamar. Obrigado pela preferência! 💚`;
    return msg;
};

const finalizarEsteira = async (btn, enviarWhats) => {
    const textoOriginal = btn.textContent;
    btn.disabled = true; btn.textContent = 'Salvando... ⏳';

    const totalExato = totalDaEsteira();
    const itensFinais = ESTEIRA.itens.map(i => ({
        ...i,
        aPesar: false,
        subtotal: valorDoItem(i),
        precoFinalCalculado: valorDoItem(i)
    }));

    try {
        await updateDoc(doc(db, 'pedidos', ESTEIRA.pedido.id), {
            itens: itensFinais,
            total: totalExato,
            totalExato,
            temItensAPesar: false,
            status: 'preparando',
            pesadoEm: new Date().toISOString()
        });

        if (enviarWhats) {
            const msg = montarMensagemCliente();
            const fone = String(ESTEIRA.pedido.telefone || '').replace(/\D/g, '');
            // Se o pedido tem telefone, abre a conversa direto.
            // Se não tem, abre o WhatsApp para escolher o contato — e o
            // texto já vai copiado para colar.
            try { await navigator.clipboard.writeText(msg); } catch (_) {}
            const url = fone
                ? `https://wa.me/${fone.startsWith('55') ? fone : '55' + fone}?text=${encodeURIComponent(msg)}`
                : `https://wa.me/?text=${encodeURIComponent(msg)}`;
            window.open(url, '_blank');
            if (!fone) showToast('Texto copiado — escolha a conversa da cliente.', false);
        } else {
            showToast('✅ Pedido salvo com os valores exatos.');
        }

        fecharEsteira();
    } catch (e) {
        console.error(e);
        showToast('Erro ao salvar o pedido.', true);
        btn.disabled = false; btn.textContent = textoOriginal;
    }
};

// ==========================================
// DELEGADOR GLOBAL DE CLIQUES
// ==========================================
document.body.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]'); if (!target) return;
    const action = target.dataset.action;

    try {
        if (action === 'novo-produto') {
            injetarEstoqueUI();
            document.getElementById('modal-titulo').textContent = 'Novo Produto';
            ['edit-id', 'edit-nome', 'edit-preco', 'edit-cat', 'edit-foto', 'edit-foto-url'].forEach(i => document.getElementById(i).value = '');
            if (document.getElementById('edit-descricao')) document.getElementById('edit-descricao').value = '';
            if (document.getElementById('edit-estoque-fisico')) document.getElementById('edit-estoque-fisico').value = '';
            if (document.getElementById('edit-peso-medio')) document.getElementById('edit-peso-medio').value = '';
            alternarCampoPesoMedio();

            const previewContainer = document.getElementById('preview-foto-wrapper');
            if (previewContainer) previewContainer.innerHTML = placeholderSVG;
            document.getElementById('btn-excluir-produto').style.display = 'none';
            openModal('modal-produto');
        }

        else if (action === 'editar-produto') {
            injetarEstoqueUI();
            const p = produtosAtuais.find(x => x.id === target.dataset.id);
            if (!p) return;
            document.getElementById('modal-titulo').textContent = 'Editar Produto';
            document.getElementById('edit-id').value = p.id;
            document.getElementById('edit-nome').value = p.nome;
            document.getElementById('edit-preco').value = p.preco;
            document.getElementById('edit-unidade').value = p.unidade || 'un';
            document.getElementById('edit-cat').value = p.cat || '';
            document.getElementById('edit-foto').value = '';
            document.getElementById('edit-foto-url').value = '';

            if (document.getElementById('edit-descricao')) document.getElementById('edit-descricao').value = p.descricao || '';
            if (document.getElementById('edit-estoque-fisico')) document.getElementById('edit-estoque-fisico').value = p.estoqueFisico !== undefined && p.estoqueFisico !== null ? p.estoqueFisico : '';
            if (document.getElementById('edit-peso-medio')) document.getElementById('edit-peso-medio').value = p.pesoMedio || '';
            alternarCampoPesoMedio();

            const previewContainer = document.getElementById('preview-foto-wrapper');
            if (previewContainer) previewContainer.innerHTML = p.foto ? `<img src="${escapeHTML(p.foto)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" alt="${escapeHTML(p.nome)}">` : placeholderSVG;

            document.getElementById('btn-excluir-produto').style.display = 'block';
            openModal('modal-produto');
        }

        else if (action === 'gerar-post') {
            const p = produtosAtuais.find(x => x.id === target.dataset.id);
            if (!p) return;
            const originHtml = target.innerHTML;
            target.innerHTML = "⏳"; target.disabled = true;
            try {
                const res = await fetch('/api/assistente', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'social_post', produtoInfo: { nome: p.nome, cat: p.cat, preco: p.preco } })
                });
                const data = await res.json();
                if (!data.sucesso) throw new Error("Falha na IA");

                // Substitui o alert() por um modal legível e copiável
                mostrarTextoGerado('Post gerado pela IA', data.post);
                try { await navigator.clipboard.writeText(data.post); showToast("✨ Texto copiado!"); } catch (_) {}
            } catch (e) {
                showToast("Erro ao gerar post.", true);
            } finally {
                target.innerHTML = originHtml; target.disabled = false;
            }
        }

        else if (action === 'toggle-estoque') {
            const id = target.dataset.id;
            const novoStatus = target.dataset.status === 'true';
            if (!novoStatus) {
                const confirmado = await customConfirm("Esgotar Produto?", "Clientes não poderão comprar até você voltar pro stock.");
                if (!confirmado) return;
            }
            await setDoc(doc(db, "produtos", id), { ativo: novoStatus, ultimaModificacao: Date.now() }, { merge: true });
            showToast(novoStatus ? "Produto disponível!" : "Produto esgotado.");
        }

        // --- AÇÕES DE LOGÍSTICA KANBAN ---
        else if (action === 'iniciar-separacao') {
            const pedido = pedidosGerais.find(p => p.id === target.dataset.id);
            if (!pedido) return showToast("Pedido não encontrado", true);
            abrirEsteira(pedido);
        }

        // CORRIGIDO: antes o botão era renderizado com data-action="preparando"
        // (o próprio status), que nenhum handler tratava — "Aceitar e Preparar"
        // e "Despachar" não faziam nada. Agora o render usa 'avancar-pedido'.
        else if (action === 'avancar-pedido') {
            const id = target.dataset.id;
            const nextStatus = target.dataset.next;
            target.disabled = true;
            await setDoc(doc(db, "pedidos", id), { status: nextStatus }, { merge: true });
            showToast(`Pedido movido para: ${nextStatus.toUpperCase()}`);
        }

        else if (action === 'excluir-pedido') {
            const id = target.dataset.id;
            if (await customConfirm("Concluir e Arquivar", "Deseja finalizar este pedido e retirá-lo da logística visual? (Os dados financeiros serão mantidos).")) {
                await setDoc(doc(db, "pedidos", id), { status: 'arquivado' }, { merge: true });
                showToast("Pedido concluído e arquivado!");
            }
        }
    } catch (err) {
        console.error("Ação Falhou:", err);
        showToast("Houve um erro ao processar sua ação.", true);
    }
});

// Modal simples para exibir textos gerados pela IA (substitui o alert)
const mostrarTextoGerado = (titulo, texto) => {
    if (!document.getElementById('modal-texto-ia')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal-overlay" id="modal-texto-ia">
                <div class="modal" style="max-width: 480px;">
                    <header class="modal-head">
                        <h2 id="texto-ia-titulo">Texto</h2>
                        <button class="btn-fechar" data-fechar="modal-texto-ia">&times;</button>
                    </header>
                    <div class="modal-body">
                        <textarea id="texto-ia-conteudo" rows="10" style="width:100%; font-size:0.95rem; line-height:1.5;"></textarea>
                    </div>
                    <footer class="modal-footer">
                        <button class="btn btn-primary w-100" id="btn-copiar-texto-ia">📋 Copiar texto</button>
                    </footer>
                </div>
            </div>`);
        document.getElementById('modal-texto-ia').querySelector('[data-fechar]')
            .addEventListener('click', () => closeModal('modal-texto-ia'));
        document.getElementById('btn-copiar-texto-ia').addEventListener('click', async () => {
            const campo = document.getElementById('texto-ia-conteudo');
            try { await navigator.clipboard.writeText(campo.value); showToast("📋 Copiado!"); }
            catch (_) { campo.select(); document.execCommand('copy'); showToast("📋 Copiado!"); }
        });
    }
    document.getElementById('texto-ia-titulo').textContent = titulo;
    document.getElementById('texto-ia-conteudo').value = texto;
    openModal('modal-texto-ia');
};

const iniciarIAFeaturesDOM = () => {
    const catInput = document.getElementById('edit-cat');
    if (catInput && !document.getElementById('form-group-descricao')) {
        catInput.closest('.form-group').insertAdjacentHTML('afterend', `
            <div class="form-group w-100" id="form-group-descricao">
                <label style="display:flex; justify-content:space-between; align-items:center;">
                    Descrição (Exibida no detalhe do produto)
                    <button type="button" id="btn-ia-descricao" class="btn-ia-action">✨ IA Copywriter</button>
                </label>
                <textarea id="edit-descricao" rows="3" placeholder="Deixe a nossa IA redigir um texto de conversão irresistível para este produto..." style="resize: vertical;"></textarea>
            </div>
        `);

        document.getElementById('btn-ia-descricao').addEventListener('click', async (e) => {
            const nome = document.getElementById('edit-nome').value;
            const cat = document.getElementById('edit-cat').value;
            if (!nome || !cat) return showToast("⚠️ Preencha Nome e Categoria primeiro.", true);
            const btn = e.currentTarget; const originText = btn.innerHTML;
            btn.innerHTML = "A gerar... ⏳"; btn.disabled = true;
            try {
                const res = await fetch('/api/assistente', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'gerar_descricao', produtoInfo: { nome, cat } })
                });
                const data = await res.json();
                if (!data.sucesso) throw new Error(data.error);
                document.getElementById('edit-descricao').value = data.descricao;
                showToast("✨ Descrição de Alta Conversão gerada!");
            } catch (err) { showToast("Falha na geração via IA.", true); }
            finally { btn.innerHTML = originText; btn.disabled = false; }
        });
    }

    const dashboardControls = document.querySelector('.dash-header');
    if (dashboardControls && !document.getElementById('btn-ia-kit')) {
        dashboardControls.insertAdjacentHTML('beforeend', `
            <div style="display:flex; gap:10px; align-items:center;">
                <button id="btn-ia-kit" class="btn-ia-action" style="padding: 10px 18px; font-size: 0.95rem;">🪄 Criar Kit c/ IA</button>
            </div>
        `);

        document.getElementById('btn-ia-kit').addEventListener('click', async (e) => {
            if (produtosAtuais.length < 5) return showToast("Precisa de mais produtos no catálogo.", true);
            const btn = e.currentTarget; const originText = btn.innerHTML;
            btn.innerHTML = "⏳ A criar kit..."; btn.disabled = true;
            try {
                const res = await fetch('/api/assistente', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'gerar_kit' })
                });
                const data = await res.json();
                if (!data.sucesso) throw new Error(data.error);

                injetarEstoqueUI();
                document.getElementById('modal-titulo').textContent = '⭐ ' + data.kit.nome;
                document.getElementById('edit-id').value = ''; document.getElementById('edit-nome').value = data.kit.nome;
                document.getElementById('edit-preco').value = data.kit.preco;
                document.getElementById('edit-cat').value = 'Kits Inteligentes';
                document.getElementById('edit-unidade').value = 'kit';
                alternarCampoPesoMedio();
                if (document.getElementById('edit-descricao')) document.getElementById('edit-descricao').value = `${data.kit.descricao}\n\n📦 O que inclui:\n${data.kit.itensInclusos}`;
                openModal('modal-produto');
                showToast("✨ Kit formulado! Ajuste o preço e guarde.");
            } catch (err) { showToast("Falha ao montar kit.", true); }
            finally { btn.innerHTML = originText; btn.disabled = false; }
        });
    }
};

document.getElementById('btn-salvar-produto').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-produto');
    btn.textContent = "A guardar... ⏳"; btn.disabled = true;

    try {
        const id = document.getElementById('edit-id').value || crypto.randomUUID();
        const rawEstoque = document.getElementById('edit-estoque-fisico') ? document.getElementById('edit-estoque-fisico').value : '';
        const estoqueFinal = rawEstoque === '' ? null : parseFloat(rawEstoque);

        const rawPeso = document.getElementById('edit-peso-medio') ? document.getElementById('edit-peso-medio').value : '';
        const pesoMedioFinal = rawPeso === '' ? null : parseFloat(rawPeso);

        const pData = {
            nome: document.getElementById('edit-nome').value.trim(),
            preco: parseFloat(document.getElementById('edit-preco').value),
            unidade: document.getElementById('edit-unidade').value,
            cat: document.getElementById('edit-cat').value.trim().toLowerCase(),
            descricao: document.getElementById('edit-descricao') ? document.getElementById('edit-descricao').value.trim() : '',
            estoqueFisico: estoqueFinal,
            pesoMedio: pesoMedioFinal, // gramas por unidade — alimenta a estimativa na loja
            ativo: estoqueFinal !== null ? (estoqueFinal > 0) : true,
            ultimaModificacao: Date.now()
        };

        if (!pData.nome) throw new Error("Preencha o nome do produto.");
        if (isNaN(pData.preco) || pData.preco <= 0) throw new Error("Informe um preço válido.");

        const fileInput = document.getElementById('edit-foto');
        const urlInput = document.getElementById('edit-foto-url').value.trim();

        if (fileInput.files.length > 0) {
            showToast("A otimizar imagem...", false);
            const optimizedFile = await compressImageToJPG(fileInput.files[0], 1000, 0.8);
            const storageRef = ref(storage, `fotos_produtos/${id}.jpg`);
            await uploadBytes(storageRef, optimizedFile);
            pData.foto = await getDownloadURL(storageRef);
        }
        else if (urlInput) {
            if (!urlInput.startsWith('https://')) throw new Error("A URL da foto precisa começar com https://");
            pData.foto = urlInput;
        }
        else if (document.getElementById('edit-id').value) {
            const pAntigo = produtosAtuais.find(x => x.id === id);
            if (pAntigo && pAntigo.foto) pData.foto = pAntigo.foto;
        }

        await setDoc(doc(db, "produtos", id), pData, { merge: true });
        closeModal('modal-produto'); showToast("Produto guardado com sucesso!");
    } catch (erro) {
        showToast(erro.message || "Erro ao guardar o produto.", true);
    } finally {
        btn.textContent = "💾 Gravar no Banco"; btn.disabled = false;
    }
});

document.getElementById('btn-excluir-produto').addEventListener('click', async () => {
    if (await customConfirm("Atenção Crítica", "APAGAR este produto permanentemente do banco de dados?")) {
        await deleteDoc(doc(db, "produtos", document.getElementById('edit-id').value));
        closeModal('modal-produto'); showToast("Produto apagado.");
    }
});

const extrairEstatisticas = (pedidos) => {
    let totalReceita = 0;
    const countProdutos = {};
    const countClientes = {};
    const countDias = { 'Domingo': 0, 'Segunda': 0, 'Terça': 0, 'Quarta': 0, 'Quinta': 0, 'Sexta': 0, 'Sábado': 0 };
    const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    pedidos.forEach(p => {
        const valor = Number(p.total) || 0;
        totalReceita += valor;
        const dateObj = new Date(p.data);
        if (!isNaN(dateObj.getTime())) countDias[diasSemana[dateObj.getDay()]] += valor;

        // Guarda o nome CRU aqui; o escape acontece só na hora de renderizar.
        // Antes escapava duas vezes e nomes com apóstrofo saíam corrompidos.
        const nomeCli = String(p.nome || 'Sem nome').trim().toUpperCase();
        countClientes[nomeCli] = (countClientes[nomeCli] || 0) + valor;

        if (p.itens) p.itens.forEach(i => { countProdutos[i.nome] = (countProdutos[i.nome] || 0) + (Number(i.qtd) || 0); });
    });
    return { totalReceita, countProdutos, countClientes, countDias };
};

// ==========================================
// KANBAN DE PEDIDOS
// ==========================================
const renderHtmlPedidos = (pedidos) => {
    const dicsStatus = {
        'pendente':             { tag: '🚨 NOVO',        cor: 'var(--danger)',  btn: 'Aceitar e Preparar',      proximo: 'preparando' },
        'aguardando_pagamento': { tag: '💠 AGUARDA PIX', cor: 'var(--info)',    btn: 'Confirmar Recebimento',   proximo: 'preparando' },
        'aguardando_pesagem':   { tag: '⚖️ A PESAR',     cor: 'var(--earth)',   btn: 'Lançar Pesos na Balança', proximo: null },
        'preparando':           { tag: '📦 PREPARANDO',  cor: 'var(--warning)', btn: 'Despachar (Enviado)',     proximo: 'enviado' },
        'enviado':              { tag: '🛵 A CAMINHO',   cor: 'var(--info)',    btn: 'Marcar como Entregue',    proximo: 'arquivado' }
    };

    let colNovos = '', colPrep = '', colEnv = '';
    let nNovos = 0, nPrep = 0, nEnv = 0;

    const termo = pedidoBuscaTermo;
    const filtrados = termo
        ? pedidos.filter(p => normalizar(p.nome).includes(termo) || String(p.quadra || '').includes(termo) || String(p.lote || '').includes(termo))
        : pedidos;

    filtrados.forEach(p => {
        const dateObj = new Date(p.data);
        const dataFmt = isNaN(dateObj.getTime()) ? "Desconhecida" : dateObj.toLocaleString('pt-BR');

        const itensStr = p.itens ? p.itens.map(i => {
            const extra = i.aPesar ? ' <span style="color:var(--earth);font-weight:bold;">(A Pesar)</span>' : '';
            return `${formatarQtdRelatorio(i.qtd, i.unidade)} ${escapeHTML(i.nome)}${extra}`;
        }).join('<br> • ') : '';

        const temAPesar = p.itens && p.itens.some(i => i.aPesar);
        const stKey = (temAPesar && p.status === 'pendente') ? 'aguardando_pesagem' : p.status;
        const st = dicsStatus[stKey] || dicsStatus['pendente'];

        // Botão de ação: pesagem tem fluxo próprio; arquivar pede confirmação;
        // o resto avança o status pelo handler 'avancar-pedido'.
        let botao;
        if (stKey === 'aguardando_pesagem') {
            botao = `<button class="btn-outline flex-1" style="background:${st.cor};color:white;border:none;width:100%;padding:12px;" data-action="iniciar-separacao" data-id="${escapeHTML(p.id)}">${st.btn}</button>`;
        } else if (st.proximo === 'arquivado') {
            botao = `<button class="btn-outline flex-1" style="border-color:var(--success);color:var(--success);width:100%;padding:12px;" data-action="excluir-pedido" data-id="${escapeHTML(p.id)}">${st.btn}</button>`;
        } else {
            botao = `<button class="btn-outline flex-1" style="background:${st.cor};color:white;border:none;width:100%;padding:12px;" data-action="avancar-pedido" data-next="${st.proximo}" data-id="${escapeHTML(p.id)}">${st.btn}</button>`;
        }

        const infoPag = p.pagamento?.status === 'PAID'
            ? `<span style="background:var(--success);color:white;padding:3px 8px;border-radius:12px;font-size:0.72rem;font-weight:700;">✓ PAGO</span>` : '';
        const infoTroco = p.troco ? `<div style="font-size:0.82rem;color:var(--earth);margin-top:4px;">💵 Troco para: ${escapeHTML(p.troco)}</div>` : '';
        const infoObs = p.obs ? `<div style="font-size:0.82rem;color:var(--text-mid);margin-top:4px;font-style:italic;">📝 ${escapeHTML(p.obs)}</div>` : '';

        const cardHtml = `
        <article class="card-pedido" style="border-left: 5px solid ${st.cor}; background: var(--warm-white); border-radius: 8px; padding: 15px; margin-bottom: 15px; border-right: 1px solid var(--parchment); border-top: 1px solid var(--parchment); border-bottom: 1px solid var(--parchment);">
            <div style="display:flex; justify-content: space-between; gap:8px; margin-bottom: 5px;">
                <h3 style="font-size: 1.1rem; color: var(--forest); margin: 0;">${escapeHTML(p.nome)}</h3>
                <strong style="font-size: 1.1rem; white-space:nowrap;">${fmt(p.total || 0)}</strong>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-mid); margin-bottom: 8px;">📍 Q${escapeHTML(p.quadra)} - L${escapeHTML(p.lote)} • ${escapeHTML(p.pag || '')}</p>
            <div style="margin-bottom: 10px; font-size: 0.8rem; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="background: ${st.cor}; color: white; padding: 3px 8px; border-radius: 12px; font-weight: bold;">${st.tag}</span>
                ${infoPag}
                <span>📅 ${dataFmt}</span>
            </div>
            <div style="font-size: 0.9rem; color: var(--text-dark); margin-bottom: 12px; background: white; padding: 10px; border-radius: 6px; border: 1px solid #eee;">
                • ${itensStr}
                ${infoTroco}
                ${infoObs}
            </div>
            <div style="display: flex; gap: 8px;">${botao}</div>
        </article>`;

        if (['pendente', 'aguardando_pesagem', 'aguardando_pagamento'].includes(stKey)) { colNovos += cardHtml; nNovos++; }
        else if (stKey === 'preparando') { colPrep += cardHtml; nPrep++; }
        else if (stKey === 'enviado') { colEnv += cardHtml; nEnv++; }
    });

    const coluna = (titulo, conteudo, contador, corBadge, vazio) => `
        <div style="background: white; padding: 15px; border-radius: 12px; border: 1px solid var(--parchment); box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <h3 style="border-bottom: 2px solid var(--foam); padding-bottom: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items:center; font-size:1.05rem;">
                ${titulo}
                <span style="background: ${corBadge}; color: white; border-radius: 12px; padding: 2px 10px; font-size: 0.85rem;">${contador}</span>
            </h3>
            ${conteudo || `<p style="color:var(--text-light); text-align:center; padding: 20px 0;">${vazio}</p>`}
        </div>`;

    return `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
        ${coluna('Novos &amp; A Pesar', colNovos, nNovos, 'var(--forest)', 'Sem pedidos novos.')}
        ${coluna('Em Preparação', colPrep, nPrep, 'var(--warning)', 'Nada na bancada.')}
        ${coluna('Enviados', colEnv, nEnv, 'var(--info)', 'Nenhum envio agora.')}
    </div>`;
};

// Busca dentro do Kanban (cliente, quadra ou lote)
document.getElementById('pedido-busca-input')?.addEventListener('input', (e) => {
    pedidoBuscaTermo = normalizar(e.target.value);
    const listDiv = document.getElementById('lista-historico');
    if (listDiv) listDiv.innerHTML = renderHtmlPedidos(pedidosGerais);
});

const renderRankingGenerico = (dados, divId, formatador) => {
    const arr = Object.entries(dados).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const html = arr.length
        ? arr.map(i => `<div class="ranking-item"><span>${escapeHTML(i[0])}</span> <strong>${formatador(i[1])}</strong></div>`).join('')
        : '<p style="color: var(--text-light)">Sem dados.</p>';
    const cont = document.getElementById(divId);
    if (cont) cont.innerHTML = html;
};

const acoplarRelatorioIADemanda = (historicoMap) => {
    const painelArea = document.getElementById('area-grafico-receita');
    if (!painelArea) return;

    if (!document.getElementById('btn-gerar-relatorio-ia')) {
        painelArea.insertAdjacentHTML('beforebegin', `
            <div style="display:flex; justify-content:flex-end; margin-bottom: 12px;">
                <button id="btn-gerar-relatorio-ia" class="btn-ia-action">🧠 Pedir Relatório de Previsão de Demanda à IA</button>
            </div>
            <div id="container-relatorio-ia"></div>
        `);

        document.getElementById('btn-gerar-relatorio-ia').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.innerHTML = "A analisar cruzamento de dados... ⏳"; btn.disabled = true;

            const historicoLeve = Object.entries(historicoMap).map(i => ({ data: i[0], faturacao_dia: i[1] }));

            try {
                const res = await fetch('/api/assistente', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'demand_prediction', historicoVendas: historicoLeve })
                });
                const data = await res.json();
                if (!data.sucesso) throw new Error("Erro na rede neural.");

                document.getElementById('container-relatorio-ia').innerHTML = `
                    <div class="ia-relatorio-box animation-slide-up">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                            <span style="font-size:1.5rem">📊</span>
                            <h3 style="margin:0;">Insight Logístico da Inteligência Artificial</h3>
                        </div>
                        <p style="color:var(--text-light); font-size:0.8rem; margin-bottom:16px;">Análise em Tempo Real • Baseado nas vendas faturadas</p>
                        ${data.relatorio}
                    </div>
                `;
            } catch (e) {
                showToast("A IA não conseguiu gerar o relatório de momento.", true);
            } finally {
                btn.innerHTML = "🧠 Atualizar Previsão de Demanda"; btn.disabled = false;
            }
        });
    }
};

const renderRelatoriosMaster = async () => {
    const listDiv = document.getElementById('lista-historico');
    if (pedidosGerais.length === 0) {
        listDiv.innerHTML = "<p style='color:var(--text-light)'>A fila está limpa! Nenhum pedido em andamento.</p>";
        document.getElementById('stat-pedidos').textContent = "0";
        document.getElementById('stat-receita').textContent = "R$ 0,00";
        return;
    }

    const stats = extrairEstatisticas(pedidosGerais);

    document.getElementById('stat-pedidos').textContent = pedidosGerais.length;
    document.getElementById('stat-receita').textContent = fmt(stats.totalReceita);

    let containerGrafico = document.getElementById('area-grafico-receita');
    if (!containerGrafico) {
        const rankingContainer = document.getElementById('ranking-dias')?.closest('.ranking-container');
        if (rankingContainer) {
            rankingContainer.insertAdjacentHTML('beforebegin', `
                <div id="area-grafico-receita" class="chart-wrapper">
                    <h3>📊 Receita Logística Recente</h3>
                    <canvas id="receita-chart" height="70"></canvas>
                </div>
            `);
        }
    }

    if (document.getElementById('receita-chart')) {
        const historicoMap = {};
        pedidosGerais.forEach(p => {
            const dataObj = new Date(p.data);
            if (!isNaN(dataObj.getTime())) {
                const label = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
                historicoMap[label] = (historicoMap[label] || 0) + (Number(p.total) || 0);
            }
        });

        acoplarRelatorioIADemanda(historicoMap);

        const labels = Object.keys(historicoMap).reverse();
        const valores = Object.values(historicoMap).reverse();

        const ChartLib = await carregarChart();
        if (window.graficoAdmin) window.graficoAdmin.destroy();

        const ctx = document.getElementById('receita-chart').getContext('2d');
        window.graficoAdmin = new ChartLib(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Faturação (R$)', data: valores,
                    borderColor: '#1a3a2a', backgroundColor: 'rgba(74, 148, 103, 0.2)',
                    borderWidth: 3, fill: true, tension: 0.4,
                    pointBackgroundColor: '#4a9467', pointRadius: 4
                }]
            },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f2ede3' } }, x: { grid: { display: false } } } }
        });
    }

    renderRankingGenerico(stats.countProdutos, 'ranking-produtos', val => val % 1 !== 0 ? `${val.toFixed(2).replace('.', ',')} med.` : `${val} un.`);
    renderRankingGenerico(stats.countClientes, 'ranking-clientes', val => fmt(val));
    renderRankingGenerico(stats.countDias, 'ranking-dias', val => fmt(val));

    listDiv.innerHTML = renderHtmlPedidos(pedidosGerais);
};

// Escapa campo de CSV: aspas duplicadas e prefixo contra injeção de fórmula
// (um nome começando com "=" seria executado como fórmula ao abrir no Excel)
const csvCampo = (valor) => {
    let txt = String(valor ?? '');
    if (/^[=+\-@]/.test(txt)) txt = `'${txt}`;
    return `"${txt.replace(/"/g, '""')}"`;
};

document.getElementById('btn-exportar').addEventListener('click', () => {
    if (pedidosGerais.length === 0) return showToast("Não há pedidos para exportar.", true);
    let csv = "Data,Cliente,Quadra,Lote,Status,Pagamento,Total,Itens\n";
    pedidosGerais.forEach(p => {
        const itensTxt = p.itens ? p.itens.map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${i.nome}`).join(' | ') : '';
        const total = (Number(p.total) || 0).toFixed(2).replace('.', ',');
        csv += [p.data, p.nome, p.quadra, p.lote, p.status, p.pag, total, itensTxt].map(csvCampo).join(',') + "\n";
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `Vendas_Logistica_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
});

document.getElementById('btn-limpar-hist').addEventListener('click', async () => {
    if (pedidosGerais.length === 0) return;
    if (await customConfirm("Limpeza de Final de Expediente", "Isto ARQUIVARÁ todos os pedidos da tela atual. Confirmar encerramento em lote?")) {
        try {
            const batch = writeBatch(db);
            pedidosGerais.forEach(p => batch.update(doc(db, "pedidos", p.id), { status: 'arquivado' }));
            await batch.commit();
            showToast("Expediente finalizado. Pedidos arquivados.");
        } catch (error) {
            console.error(error); showToast("Erro ao processar lote.", true);
        }
    }
});


// =====================================================================
// COMUNICADOS — mensagem automática por dia da semana + aviso fixo
// Guardado em loja/comunicados. A loja lê e mostra no topo.
// =====================================================================
const DIAS_NOMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
let comunicadosAtuais = { dias: {}, fixo: { ativo: false, texto: '' } };

const renderComunicados = () => {
    const cont = document.getElementById('lista-comunicados');
    if (!cont) return;
    const hoje = new Date().getDay();

    const blocoFixo = `
        <div class="com-dia" style="border-color: var(--earth);">
            <div class="com-dia-topo">
                <span class="com-dia-nome">📢 Aviso fixo / Oferta do momento</span>
                <label class="com-switch">
                    <input type="checkbox" id="com-fixo-ativo" ${comunicadosAtuais.fixo?.ativo ? 'checked' : ''}> mostrar
                </label>
            </div>
            <textarea id="com-fixo-texto" placeholder="Ex: 🍓 Morango na promoção hoje: R$ 8,90 a bandeja!">${escapeHTML(comunicadosAtuais.fixo?.texto || '')}</textarea>
            <small style="color:var(--text-light); font-size:.78rem;">Aparece sempre que estiver ligado, em qualquer dia. Tem prioridade sobre a mensagem do dia.</small>
        </div>`;

    const blocosDias = DIAS_NOMES.map((nome, i) => {
        const d = comunicadosAtuais.dias?.[i] || { ativo: false, texto: '' };
        return `
        <div class="com-dia">
            <div class="com-dia-topo">
                <span class="com-dia-nome">${nome} ${i === hoje ? '<span class="com-hoje-tag">HOJE</span>' : ''}</span>
                <label class="com-switch">
                    <input type="checkbox" class="com-dia-ativo" data-dia="${i}" ${d.ativo ? 'checked' : ''}> mostrar
                </label>
            </div>
            <textarea class="com-dia-texto" data-dia="${i}" placeholder="Ex: Chegou verdura fresquinha hoje!">${escapeHTML(d.texto || '')}</textarea>
        </div>`;
    }).join('');

    cont.innerHTML = blocoFixo + blocosDias;
};

const salvarComunicados = async () => {
    const btn = document.getElementById('btn-salvar-comunicados');
    btn.disabled = true; btn.textContent = 'Salvando... ⏳';
    try {
        const dias = {};
        document.querySelectorAll('.com-dia-texto').forEach(t => {
            const i = t.dataset.dia;
            const chk = document.querySelector(`.com-dia-ativo[data-dia="${i}"]`);
            dias[i] = { ativo: !!chk?.checked, texto: t.value.trim().slice(0, 220) };
        });
        const fixo = {
            ativo: !!document.getElementById('com-fixo-ativo')?.checked,
            texto: (document.getElementById('com-fixo-texto')?.value || '').trim().slice(0, 220)
        };
        await setDoc(doc(db, 'loja', 'comunicados'), { dias, fixo, atualizadoEm: Date.now() }, { merge: true });
        showToast('📢 Comunicados atualizados!');
    } catch (e) {
        showToast('Erro ao salvar comunicados.', true);
    } finally {
        btn.disabled = false; btn.textContent = '💾 Gravar Comunicados';
    }
};
document.getElementById('btn-salvar-comunicados')?.addEventListener('click', salvarComunicados);

// =====================================================================
// BALANÇO GERAL — carrega TODOS os pedidos do período (inclusive
// arquivados), porque o Kanban só traz os que estão em andamento.
// Carrega sob demanda para não gastar leituras à toa.
// =====================================================================
let balancoCache = [];

const carregarBalanco = async (dias = 30) => {
    const alvo = document.getElementById('balanco-conteudo');
    if (!alvo) return;
    alvo.innerHTML = '<p style="color:var(--text-light)">Somando os números... ⏳</p>';

    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    try {
        const q = query(collection(db, 'pedidos'), where('data', '>=', desde), orderBy('data', 'desc'), limit(800));

        // Busca única. Se o seu firebase.js ainda não exporta getDocs,
        // cai automaticamente num onSnapshot que se desinscreve na 1ª resposta —
        // assim funciona sem você precisar editar o firebase.js.
        const mod = await import('./firebase.js');
        const snap = mod.getDocs
            ? await mod.getDocs(q)
            : await new Promise((resolve, reject) => {
                const parar = onSnapshot(q, (s) => { parar(); resolve(s); }, reject);
              });

        balancoCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBalanco(dias);
    } catch (e) {
        console.error(e);
        alvo.innerHTML = `<p style="color:var(--danger)">Não consegui carregar o balanço.<br><small>Se o console mostrar um link de índice do Firestore, clique nele para criar.</small></p>`;
    }
};

const renderBalanco = async (dias) => {
    const alvo = document.getElementById('balanco-conteudo');
    const validos = balancoCache.filter(p => p.status !== 'cancelado');

    const hojeStr = new Date().toDateString();
    const inicioSemana = Date.now() - 7 * 86400000;

    let totalPeriodo = 0, totalHoje = 0, totalSemana = 0;
    let nHoje = 0, nSemana = 0;
    let aReceber = 0, jaPago = 0;
    const porDia = {};
    const porProduto = {};

    validos.forEach(p => {
        const v = Number(p.total) || 0;
        const d = new Date(p.data);
        totalPeriodo += v;
        if (!isNaN(d.getTime())) {
            if (d.toDateString() === hojeStr) { totalHoje += v; nHoje++; }
            if (d.getTime() >= inicioSemana) { totalSemana += v; nSemana++; }
            const rot = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            porDia[rot] = (porDia[rot] || 0) + v;
        }
        if (p.pagamento?.status === 'PAID') jaPago += v; else aReceber += v;
        (p.itens || []).forEach(i => {
            const q = Number(i.qtd) || 0;
            porProduto[i.nome] = (porProduto[i.nome] || 0) + q;
        });
    });

    const ticket = validos.length ? totalPeriodo / validos.length : 0;

    const cartao = (rotulo, valor, sub, cor) => `
        <article class="stat-box" style="border-left:4px solid ${cor};">
            <span class="stat-label">${rotulo}</span>
            <strong class="stat-val">${valor}</strong>
            ${sub ? `<small style="color:var(--text-light); font-size:.78rem;">${sub}</small>` : ''}
        </article>`;

    alvo.innerHTML = `
        <div class="stats-grid" style="margin-bottom:20px;">
            ${cartao('HOJE', fmt(totalHoje), `${nHoje} pedido(s)`, 'var(--success)')}
            ${cartao('ÚLTIMOS 7 DIAS', fmt(totalSemana), `${nSemana} pedido(s)`, 'var(--forest)')}
            ${cartao(`PERÍODO (${dias} DIAS)`, fmt(totalPeriodo), `${validos.length} pedido(s)`, 'var(--info)')}
            ${cartao('TICKET MÉDIO', fmt(ticket), 'por pedido', 'var(--earth)')}
        </div>
        <div class="stats-grid" style="margin-bottom:20px;">
            ${cartao('JÁ PAGO (PIX)', fmt(jaPago), 'confirmado pelo banco', 'var(--success)')}
            ${cartao('A RECEBER', fmt(aReceber), 'dinheiro, cartão ou PIX pendente', 'var(--warning)')}
        </div>
        <div class="chart-wrapper" style="margin-bottom:20px;">
            <h3>📈 Faturamento por dia</h3>
            <canvas id="balanco-chart" height="90"></canvas>
        </div>
        <div class="ranking-box">
            <h3>🥇 Mais vendidos no período</h3>
            <div id="balanco-ranking"></div>
        </div>`;

    // Gráfico em ordem cronológica
    const rotulos = Object.keys(porDia).reverse();
    const valores = Object.values(porDia).reverse();
    const ChartLib = await carregarChart();
    if (window.graficoBalanco) window.graficoBalanco.destroy();
    window.graficoBalanco = new ChartLib(document.getElementById('balanco-chart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: rotulos,
            datasets: [{ label: 'R$', data: valores, backgroundColor: 'rgba(74,148,103,.75)', borderRadius: 6 }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f2ede3' } }, x: { grid: { display: false } } } }
    });

    renderRankingGenerico(porProduto, 'balanco-ranking',
        val => val % 1 !== 0 ? `${val.toFixed(2).replace('.', ',')} kg` : `${val} un.`);
};

document.getElementById('balanco-periodo')?.addEventListener('change', (e) => {
    carregarBalanco(Number(e.target.value));
});
document.getElementById('btn-atualizar-balanco')?.addEventListener('click', () => {
    carregarBalanco(Number(document.getElementById('balanco-periodo')?.value || 30));
});

document.getElementById('btn-salvar-config').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-config');
    btn.textContent = "A guardar... ⏳"; btn.disabled = true;

    try {
        const wpp = document.getElementById('config-wpp').value.replace(/\D/g, '');
        const minimo = parseFloat(document.getElementById('config-minimo').value) || 0;
        const lojaAberta = document.getElementById('config-status-loja').value === "aberta";
        const diasAbertos = Array.from(document.querySelectorAll('.chk-dia:checked')).map(chk => parseInt(chk.value));

        if (wpp.length < 10) throw new Error("Número de WhatsApp muito curto.");

        await setDoc(doc(db, "loja", "config"), { wpp, minimo, lojaAberta, diasAbertos }, { merge: true });
        showToast("Configurações atualizadas!");
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.textContent = "💾 Gravar Definições"; btn.disabled = false;
    }
});
