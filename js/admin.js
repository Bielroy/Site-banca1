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

// ==========================================
// LÓGICA DO PICKING GUIADO
// ==========================================
const PICKING_STATE = { pedidoId: null, itensAPesar: [], indiceAtual: 0, pedidoOriginal: null, totalOriginal: 0, valorExtraPesado: 0 };

const injetarModalPickingSeNecessario = () => {
    if (document.getElementById('modal-picking')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="modal-picking" aria-hidden="true">
            <div class="modal" style="max-width: 500px; text-align: center;">
                <div class="modal-head" style="background: var(--forest); color: white;">
                    <h2 id="picking-title" style="color:white;">Separação de Pedido</h2>
                    <button class="btn-fechar" data-fechar="modal-picking" style="color: white;">×</button>
                </div>
                <div class="modal-body" style="padding: 30px 20px;">
                    <div id="picking-step-container">
                        <span id="picking-contador" style="background: var(--foam); color: var(--forest); padding: 4px 12px; border-radius: 20px; font-weight: bold; font-size: 0.9rem; margin-bottom: 15px; display: inline-block;"></span>
                        <h3 id="picking-nome-produto" style="font-size: 1.8rem; margin-bottom: 5px; color: var(--text-dark);"></h3>
                        <p id="picking-qtd-pedida" style="font-size: 1.2rem; color: var(--earth); font-weight: bold; margin-bottom: 8px;"></p>
                        <p id="picking-estimativa" style="font-size: 0.95rem; color: var(--text-light); margin-bottom: 20px;"></p>

                        <div style="background: var(--warm-white); border: 2px dashed var(--parchment); padding: 20px; border-radius: 12px; margin-bottom: 25px;">
                            <label for="picking-input-peso" style="display: block; font-weight: 600; margin-bottom: 10px; color: var(--text-mid);">Coloque na balança e digite o peso (Kg):</label>
                            <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                                <input type="number" id="picking-input-peso" step="0.001" placeholder="Ex: 1.250" style="width: 150px; font-size: 1.5rem; text-align: center; padding: 15px; border: 2px solid var(--forest); border-radius: 8px;">
                                <span style="font-size: 1.5rem; font-weight: bold; color: var(--text-light);">kg</span>
                            </div>
                            <p id="picking-preview-valor" style="margin-top:12px; font-weight:700; color:var(--forest); min-height:22px;"></p>
                        </div>
                        <button class="btn-outline" style="background: var(--forest); color: white; width: 100%; padding: 18px; font-size: 1.2rem;" data-action="picking-proximo">Salvar Peso e Avançar ➔</button>
                    </div>

                    <div id="picking-resumo-container" style="display: none;">
                        <div style="font-size: 3rem; margin-bottom: 10px;">✅</div>
                        <h3 style="font-size: 1.5rem; color: var(--forest); margin-bottom: 15px;">Tudo Separado e Pesado!</h3>
                        <div style="background: var(--foam); padding: 20px; border-radius: 12px; text-align: left; margin-bottom: 25px;">
                            <p style="margin-bottom: 8px; color: var(--text-mid);">Valor S/ Pesagem: <span id="resumo-valor-antigo" style="float: right; text-decoration: line-through;"></span></p>
                            <p style="font-size: 1.3rem; font-weight: 900; color: var(--text-dark); border-top: 1px solid var(--sage); padding-top: 8px; margin-top: 8px;">Novo Valor Exato: <span id="resumo-valor-novo" style="float: right; color: var(--forest);"></span></p>
                        </div>
                        <button class="btn-outline" style="background: #25D366; color: white; border-color: #25D366; width: 100%; padding: 18px; font-size: 1.2rem;" data-action="picking-finalizar">Concluir e Avisar Cliente 🚀</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    // Prévia do valor enquanto digita o peso — evita erro de digitação
    document.getElementById('picking-input-peso').addEventListener('input', (e) => {
        const item = PICKING_STATE.itensAPesar[PICKING_STATE.indiceAtual];
        const peso = parseFloat(String(e.target.value).replace(',', '.'));
        const alvo = document.getElementById('picking-preview-valor');
        if (item && Number.isFinite(peso) && peso > 0) {
            alvo.textContent = `= ${fmt(peso * item.precoOriginal)}`;
        } else { alvo.textContent = ''; }
    });
};

const renderPickingStep = () => {
    const itemAtual = PICKING_STATE.itensAPesar[PICKING_STATE.indiceAtual];
    document.getElementById('picking-contador').textContent = `Produto ${PICKING_STATE.indiceAtual + 1} de ${PICKING_STATE.itensAPesar.length}`;
    document.getElementById('picking-nome-produto').textContent = itemAtual.nome;
    document.getElementById('picking-qtd-pedida').textContent = `O cliente quer: ${itemAtual.qtd} unidade(s)`;

    // Se o produto tem peso médio cadastrado, mostra quanto deveria dar
    const prod = produtosAtuais.find(p => p.id === itemAtual.id);
    const estimativa = document.getElementById('picking-estimativa');
    if (prod && prod.pesoMedio > 0) {
        const kgEsperado = (prod.pesoMedio * itemAtual.qtd) / 1000;
        estimativa.textContent = `Esperado: ≈ ${kgEsperado.toFixed(2).replace('.', ',')} kg`;
    } else { estimativa.textContent = ''; }

    const inputPeso = document.getElementById('picking-input-peso');
    inputPeso.value = '';
    document.getElementById('picking-preview-valor').textContent = '';
    setTimeout(() => inputPeso.focus(), 100);
};

const mostrarResumoPicking = () => {
    document.getElementById('picking-step-container').style.display = 'none';
    document.getElementById('picking-resumo-container').style.display = 'block';

    const novoTotalExato = PICKING_STATE.totalOriginal + PICKING_STATE.valorExtraPesado;
    document.getElementById('resumo-valor-antigo').textContent = fmt(PICKING_STATE.totalOriginal);
    document.getElementById('resumo-valor-novo').textContent = fmt(novoTotalExato);
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
            const pedidoId = target.dataset.id;
            const pedido = pedidosGerais.find(p => p.id === pedidoId);
            if (!pedido) return showToast("Pedido não encontrado", true);

            const itensParaBalanca = (pedido.itens || []).filter(item => item.aPesar === true);

            PICKING_STATE.pedidoId = pedido.id;
            PICKING_STATE.pedidoOriginal = pedido;
            PICKING_STATE.itensAPesar = JSON.parse(JSON.stringify(itensParaBalanca));
            PICKING_STATE.indiceAtual = 0;
            PICKING_STATE.totalOriginal = pedido.clientTotal || pedido.total || 0;
            PICKING_STATE.valorExtraPesado = 0;

            injetarModalPickingSeNecessario();
            document.getElementById('picking-title').textContent = `Separar: ${String(pedido.nome || '').split(' ')[0]}`;

            if (PICKING_STATE.itensAPesar.length > 0) {
                document.getElementById('picking-step-container').style.display = 'block';
                document.getElementById('picking-resumo-container').style.display = 'none';
                renderPickingStep();
            } else {
                document.getElementById('picking-step-container').style.display = 'none';
                mostrarResumoPicking();
            }
            openModal('modal-picking');
        }

        else if (action === 'picking-proximo') {
            const inputPeso = document.getElementById('picking-input-peso');
            const pesoInformado = parseFloat(String(inputPeso.value).replace(',', '.'));

            if (isNaN(pesoInformado) || pesoInformado <= 0) return showToast("⚠️ Digite um peso válido marcado na balança!", true);

            const itemAtual = PICKING_STATE.itensAPesar[PICKING_STATE.indiceAtual];
            const valorDesteItem = pesoInformado * itemAtual.precoOriginal;

            PICKING_STATE.valorExtraPesado += valorDesteItem;
            itemAtual.pesoFinal = pesoInformado;
            itemAtual.precoFinalCalculado = valorDesteItem;
            itemAtual.subtotal = valorDesteItem;
            itemAtual.aPesar = false;

            PICKING_STATE.indiceAtual++;
            if (PICKING_STATE.indiceAtual >= PICKING_STATE.itensAPesar.length) mostrarResumoPicking();
            else renderPickingStep();
        }

        else if (action === 'picking-finalizar') {
            const btn = target;
            btn.disabled = true; btn.textContent = 'A processar... ⏳';

            const novoTotalExato = PICKING_STATE.totalOriginal + PICKING_STATE.valorExtraPesado;
            const itensAtualizados = PICKING_STATE.pedidoOriginal.itens.map(itemOri => {
                const itemPesado = PICKING_STATE.itensAPesar.find(ip => ip.id === itemOri.id);
                return itemPesado ? itemPesado : itemOri;
            });

            try {
                await updateDoc(doc(db, "pedidos", PICKING_STATE.pedidoId), {
                    itens: itensAtualizados,
                    totalExato: novoTotalExato,
                    total: novoTotalExato,
                    temItensAPesar: false,
                    status: 'preparando'
                });

                fetch('/api/whatsapp-trigger', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'notificar_peso_concluido', pedidoId: PICKING_STATE.pedidoId, novoTotal: fmt(novoTotalExato) })
                }).catch(() => {});

                showToast("✅ Pedido pesado e finalizado!");
                closeModal('modal-picking');
            } catch (e) {
                showToast("Erro ao finalizar pedido.", true);
            } finally {
                btn.disabled = false; btn.textContent = 'Concluir e Avisar Cliente 🚀';
            }
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
