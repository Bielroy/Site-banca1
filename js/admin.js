import { auth, db, storage, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut, collection, doc, setDoc, deleteDoc, onSnapshot, ref, uploadBytes, getDownloadURL, query, orderBy, limit, writeBatch, where } from './firebase.js';
import { fmt, escapeHTML, formatarQtdRelatorio, showToast, openModal, closeModal, customConfirm } from './utils.js';

let produtosAtuais = [];
let pedidosGerais = [];
let unsubscribes = []; // Prevenção de Memory Leaks

const placeholderSVG = `<div class="prod-img-placeholder skeleton" style="width:100%;height:100%"></div>`;

// ----------------------------------------------------
// AUTENTICAÇÃO E GERENCIAMENTO DE MEMÓRIA
// ----------------------------------------------------

// Função Helper para o Modal de E-mail Nativo (Substitui window.prompt)
const requestEmailVerification = () => {
    return new Promise((resolve) => {
        openModal('modal-email-verify');
        const okBtn = document.getElementById('btn-verify-ok');
        const cancelBtn = document.getElementById('btn-verify-cancel');
        const input = document.getElementById('verify-email-input');

        const cleanup = () => { closeModal('modal-email-verify'); okBtn.onclick = null; cancelBtn.onclick = null; };

        okBtn.onclick = () => { if(input.value.trim()) { cleanup(); resolve(input.value.trim()); } };
        cancelBtn.onclick = () => { cleanup(); resolve(null); };
    });
};

onAuthStateChanged(auth, (user) => {
    // Matar processos antigos se o usuário mudar
    unsubscribes.forEach(unsub => unsub()); 
    unsubscribes = [];

    if (user) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        iniciarRealTimeSync(); 
    } else {
        document.getElementById('login-screen').style.display = 'block';
        document.getElementById('dashboard').style.display = 'none';
    }
});

let isLoginProcessing = false;
document.getElementById('btn-login').addEventListener('click', async () => {
    if (isLoginProcessing) return;
    const email = document.getElementById('email').value.trim();
    const msg = document.getElementById('login-msg');
    
    if (!email) { msg.textContent = "⚠️ Digite um e-mail válido."; msg.style.color = "var(--danger)"; return; }
    
    isLoginProcessing = true;
    document.getElementById('btn-login').disabled = true;
    msg.textContent = "Enviando link..."; msg.style.color = "var(--text-dark)";
    
    try {
        await sendSignInLinkToEmail(auth, email, { url: window.location.href, handleCodeInApp: true });
        window.sessionStorage.setItem('emailForSignIn', email);
        msg.textContent = "✅ Link enviado! Verifique o e-mail."; 
        msg.style.color = "var(--success)"; 
    } catch(error) {
        msg.textContent = "❌ Erro ao enviar link. Tente novamente."; 
        msg.style.color = "var(--danger)";
    } finally {
        setTimeout(() => { isLoginProcessing = false; document.getElementById('btn-login').disabled = false; }, 5000);
    }
});

if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.sessionStorage.getItem('emailForSignIn');
    const processLogin = async () => {
        if (!email) email = await requestEmailVerification(); // Uso do Modal Nativo
        if(email) {
            try {
                await signInWithEmailLink(auth, email, window.location.href);
                window.sessionStorage.removeItem('emailForSignIn');
            } catch(e) { showToast("Link expirado ou inválido. Peça um novo.", true); }
        }
    };
    processLogin();
}

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

// ----------------------------------------------------
// NAVEGAÇÃO DE ABAS
// ----------------------------------------------------
document.querySelector('.tabs').addEventListener('click', (e) => {
    if(e.target.classList.contains('tab')) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.aba-content').forEach(c => c.classList.remove('active'));
        
        e.target.classList.add('active');
        document.getElementById(`aba-${e.target.dataset.aba}`).classList.add('active');
        
        if(e.target.dataset.aba === 'relatorios') renderRelatoriosMaster();
    }
});

document.querySelectorAll('[data-fechar]').forEach(btn => { 
    btn.addEventListener('click', (e) => { closeModal(e.currentTarget.dataset.fechar); }); 
});

// ----------------------------------------------------
// SYNC REALTIME (Otimizado com Limits e Unsubscribes)
// ----------------------------------------------------
const iniciarRealTimeSync = () => {
    // 1. Produtos
    const unsubProd = onSnapshot(collection(db, "produtos"), (snap) => {
        produtosAtuais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => (b.ultimaModificacao || 0) - (a.ultimaModificacao || 0));
        renderProdutos();
    });
    unsubscribes.push(unsubProd);

    // 2. Configurações (Focado só no doc de config)
    const unsubConfig = onSnapshot(doc(db, "loja", "config"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('config-wpp').value = data.wpp || '';
            document.getElementById('config-minimo').value = data.minimo || 0;
            document.getElementById('config-status-loja').value = data.lojaAberta === false ? "fechada" : "aberta";
            const diasSalvos = data.diasAbertos || [0,1,2,3,4,5,6];
            document.querySelectorAll('.chk-dia').forEach(chk => chk.checked = diasSalvos.includes(parseInt(chk.value)));
        }
    });
    unsubscribes.push(unsubConfig);

    // 3. Pedidos OTIMIZADOS (Filtra só os pendentes para a logística e puxa só 50)
    const pedQuery = query(collection(db, "pedidos"), where("status", "==", "pendente"), orderBy("data", "desc"), limit(50));
    const unsubPedidos = onSnapshot(pedQuery, (snap) => {
        pedidosGerais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(document.getElementById('aba-relatorios').classList.contains('active')) renderRelatoriosMaster();
    });
    unsubscribes.push(unsubPedidos);
};

// ----------------------------------------------------
// GESTÃO DE PRODUTOS
// ----------------------------------------------------
const renderProdutos = () => {
    const html = produtosAtuais.map(p => `
        <article class="card-produto ${p.ativo ? '' : 'esgotado'}">
            <div class="prod-info-grande">
                <div class="prod-img-grande">${p.foto ? `<img src="${escapeHTML(p.foto)}" loading="lazy">` : placeholderSVG}</div>
                <div class="prod-detalhes">
                    <h4>${escapeHTML(p.nome)}</h4>
                    <p>${fmt(p.preco)} <span style="font-size:0.9rem; color:var(--text-light); font-weight:normal">/${escapeHTML(p.unidade)}</span></p>
                </div>
            </div>
            <div class="botoes-acao">
                ${p.ativo 
                    ? `<button class="btn-outline" style="border-color:var(--danger); color:var(--danger); padding: 12px;" data-action="toggle-estoque" data-id="${p.id}" data-status="false">Esgotar Produto</button>`
                    : `<button class="btn-outline" style="background:var(--success); border-color:var(--success); color:white; padding: 12px;" data-action="toggle-estoque" data-id="${p.id}" data-status="true">Voltar p/ Estoque</button>`
                }
                <button class="btn-outline" style="background: var(--parchment); color: var(--text-dark); border-color: #e0dcd4; padding: 12px;" data-action="editar-produto" data-id="${p.id}">Editar</button>
            </div>
        </article>
    `).join('');
    document.getElementById('lista-produtos').innerHTML = html;
};

document.body.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]'); if(!target) return;
    const action = target.dataset.action;
    
    try {
        if(action === 'novo-produto') {
            document.getElementById('modal-titulo').textContent = 'Novo Produto';
            ['edit-id', 'edit-nome', 'edit-preco', 'edit-cat', 'edit-foto', 'edit-foto-url'].forEach(i => document.getElementById(i).value = '');
            document.getElementById('btn-excluir-produto').style.display = 'none';
            openModal('modal-produto');
        }
        
        else if(action === 'editar-produto') {
            const p = produtosAtuais.find(x => x.id === target.dataset.id);
            if(!p) return;
            document.getElementById('modal-titulo').textContent = 'Editar Produto'; 
            document.getElementById('edit-id').value = p.id;
            document.getElementById('edit-nome').value = p.nome; 
            document.getElementById('edit-preco').value = p.preco;
            document.getElementById('edit-unidade').value = p.unidade || 'un'; 
            document.getElementById('edit-cat').value = p.cat || '';
            document.getElementById('edit-foto').value = ''; 
            document.getElementById('edit-foto-url').value = ''; 
            document.getElementById('btn-excluir-produto').style.display = 'block';
            openModal('modal-produto');
        }
        
        else if(action === 'toggle-estoque') {
            const id = target.dataset.id;
            const novoStatus = target.dataset.status === 'true';
            if(!novoStatus) {
                const confirmado = await customConfirm("Esgotar Produto?", "Clientes não poderão comprar até você voltar pro estoque.");
                if(!confirmado) return;
            }
            await setDoc(doc(db, "produtos", id), { ativo: novoStatus, ultimaModificacao: Date.now() }, { merge: true });
            showToast(novoStatus ? "Produto disponível!" : "Produto esgotado.");
        }
        
        // Arquivamento individual
        else if (action === 'excluir-pedido') {
            const id = target.dataset.id;
            if(await customConfirm("Limpar da Fila", "Deseja arquivar este pedido finalizado e retirá-lo da logística?")) { 
                await setDoc(doc(db, "pedidos", id), { status: 'arquivado' }, { merge: true }); 
                showToast("Pedido arquivado com sucesso!");
            }
        }
    } catch(err) {
        console.error("Ação Falhou:", err);
        showToast("Houve um erro ao processar sua ação.", true);
    }
});

document.getElementById('btn-salvar-produto').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-produto'); 
    btn.textContent = "Salvando... ⏳"; btn.disabled = true;

    try {
        const id = document.getElementById('edit-id').value || crypto.randomUUID();
        let pData = { 
            nome: document.getElementById('edit-nome').value.trim(), 
            preco: parseFloat(document.getElementById('edit-preco').value), 
            unidade: document.getElementById('edit-unidade').value, 
            cat: document.getElementById('edit-cat').value.trim().toLowerCase(), 
            ativo: true,
            ultimaModificacao: Date.now()
        };
        
        if(!pData.nome || isNaN(pData.preco)) throw new Error("Preencha nome e preço.");

        const fileInput = document.getElementById('edit-foto');
        const urlInput = document.getElementById('edit-foto-url').value.trim();

        if (fileInput.files.length > 0) { 
            const storageRef = ref(storage, `fotos_produtos/${id}_${fileInput.files[0].name}`); 
            await uploadBytes(storageRef, fileInput.files[0]); 
            pData.foto = await getDownloadURL(storageRef); 
        } 
        else if (urlInput) { 
            // Validação de URL básica
            if(!urlInput.startsWith('http')) throw new Error("URL da foto inválida.");
            pData.foto = urlInput; 
        }
        else if (document.getElementById('edit-id').value) { 
            const pAntigo = produtosAtuais.find(x => x.id === id); 
            if(pAntigo && pAntigo.foto) pData.foto = pAntigo.foto; 
        }
        
        await setDoc(doc(db, "produtos", id), pData, { merge: true });
        closeModal('modal-produto'); showToast("Produto salvo com sucesso!");
    } catch (erro) {
        showToast(erro.message || "Erro ao salvar o produto.", true);
    } finally {
        btn.textContent = "💾 Gravar no Banco"; btn.disabled = false;
    }
});

document.getElementById('btn-excluir-produto').addEventListener('click', async () => {
    if(await customConfirm("Atenção Crítica", "APAGAR este produto permanentemente do banco de dados?")) { 
        await deleteDoc(doc(db, "produtos", document.getElementById('edit-id').value)); 
        closeModal('modal-produto'); showToast("Produto apagado.");
    }
});

// ----------------------------------------------------
// RELATÓRIOS E LOGÍSTICA (Refatorado - SRP Aplicado)
// ----------------------------------------------------

const extrairEstatisticas = (pedidos) => {
    let totalReceita = 0; 
    let countProdutos = {}; 
    let countClientes = {}; 
    let countDias = { 'Domingo':0, 'Segunda':0, 'Terça':0, 'Quarta':0, 'Quinta':0, 'Sexta':0, 'Sábado':0 };
    const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    pedidos.forEach(p => {
        totalReceita += p.total || 0;
        const dateObj = new Date(p.data);
        if(!isNaN(dateObj.getTime())) countDias[diasSemana[dateObj.getDay()]] += (p.total || 0);
        
        const nomeCli = escapeHTML(p.nome).trim().toUpperCase(); 
        countClientes[nomeCli] = (countClientes[nomeCli] || 0) + (p.total || 0);
        
        if (p.itens) {
            p.itens.forEach(i => {
                countProdutos[i.nome] = (countProdutos[i.nome] || 0) + i.qtd; 
            });
        }
    });

    return { totalReceita, countProdutos, countClientes, countDias };
};

const renderHtmlPedidos = (pedidos) => {
    return pedidos.map(p => {
        const dateObj = new Date(p.data);
        const dataFmt = isNaN(dateObj.getTime()) ? "Desconhecida" : dateObj.toLocaleString('pt-BR');
        const itensStr = p.itens ? p.itens.map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${escapeHTML(i.nome)}`).join(', ') : '';
        
        return `
        <article class="card-pedido">
            <div class="card-pedido-topo">
                <span class="card-pedido-cliente">👤 ${escapeHTML(p.nome)} (Q${escapeHTML(p.quadra)} L${escapeHTML(p.lote)})</span>
                <span class="card-pedido-total">${fmt(p.total||0)}</span>
            </div>
            <div class="card-pedido-meta">📅 ${dataFmt} | 💳 ${escapeHTML(p.pag)}</div>
            <div class="card-pedido-itens">📦 ${itensStr}</div>
            <button class="btn-outline" style="border-color: var(--danger); color: var(--danger); padding: 8px 16px; margin-top: 10px; width: max-content; font-size: 0.9rem;" data-action="excluir-pedido" data-id="${escapeHTML(p.id)}">Limpar da Fila</button>
        </article>`;
    }).join('');
};

const renderRankingGenerico = (dados, divId, formatador) => { 
    const arr = Object.entries(dados).sort((a,b) => b[1] - a[1]).slice(0,5); 
    const html = arr.length ? arr.map(i => `<div class="ranking-item"><span>${escapeHTML(i[0])}</span> <strong>${formatador(i[1])}</strong></div>`).join('') : '<p style="color: var(--text-light)">Sem dados.</p>'; 
    document.getElementById(divId).innerHTML = html;
};

// Função Master Controladora (SRP Core)
const renderRelatoriosMaster = () => {
    const listDiv = document.getElementById('lista-historico');
    
    if(pedidosGerais.length === 0) { 
        listDiv.innerHTML = "<p style='color:var(--text-light)'>Nenhum pedido recente na fila.</p>"; 
        return; 
    }

    // 1. Processar dados matemáticos puros
    const stats = extrairEstatisticas(pedidosGerais);

    // 2. Renderizar Estatísticas de Topo
    document.getElementById('stat-pedidos').textContent = pedidosGerais.length;
    document.getElementById('stat-receita').textContent = fmt(stats.totalReceita);

    // 3. Renderizar Rankings
    renderRankingGenerico(stats.countProdutos, 'ranking-produtos', val => val % 1 !== 0 ? `${val.toFixed(2).replace('.',',')} med.` : `${val} un.`);
    renderRankingGenerico(stats.countClientes, 'ranking-clientes', val => fmt(val));
    renderRankingGenerico(stats.countDias, 'ranking-dias', val => fmt(val));

    // 4. Renderizar a Logística (Cards HTML)
    listDiv.innerHTML = renderHtmlPedidos(pedidosGerais);
};

// ----------------------------------------------------
// EXPORTAÇÃO E BATCH UPDATE (Segurança Fiscal)
// ----------------------------------------------------
document.getElementById('btn-exportar').addEventListener('click', () => {
    if(pedidosGerais.length === 0) return showToast("Não há pedidos pendentes.", true);
    let csv = "Data,Cliente,Quadra,Lote,Pagamento,Total,Itens\n";
    pedidosGerais.forEach(p => { 
        const itensTxt = p.itens ? p.itens.map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${i.nome}`).join(' | ') : '';
        csv += `"${p.data}","${p.nome}","${p.quadra}","${p.lote}","${p.pag}","${p.total.toFixed(2).replace('.',',')}","${itensTxt}"\n`; 
    });
    const link = document.createElement("a"); 
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' })); 
    link.download = `Vendas_Logistica_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`; 
    link.click();
});

document.getElementById('btn-limpar-hist').addEventListener('click', async () => {
    if(pedidosGerais.length === 0) return;
    
    if(await customConfirm("Limpeza em Massa", "Isto ARQUIVARÁ todos os pedidos da tela de logística. Eles sairão da fila, mas os dados fiscais e financeiros permanecerão intactos no banco. Confirmar?")) { 
        try {
            const batch = writeBatch(db);
            pedidosGerais.forEach(p => {
                const docRef = doc(db, "pedidos", p.id);
                // ATUALIZA STATUS PARA ARQUIVADO EM VEZ DE DELETAR
                batch.update(docRef, { status: 'arquivado' }); 
            });
            await batch.commit();
            showToast("Logística esvaziada e pedidos arquivados!");
        } catch (error) {
            console.error(error);
            showToast("Erro ao processar limpeza em lote.", true);
        }
    }
});

// ----------------------------------------------------
// CONFIGURAÇÕES OPERACIONAIS
// ----------------------------------------------------
document.getElementById('btn-salvar-config').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-config'); 
    btn.textContent = "Salvando... ⏳";
    btn.disabled = true;

    try {
        let wpp = document.getElementById('config-wpp').value.replace(/\D/g, ''); 
        const minimo = parseFloat(document.getElementById('config-minimo').value) || 0;
        const lojaAberta = document.getElementById('config-status-loja').value === "aberta";
        const diasAbertos = Array.from(document.querySelectorAll('.chk-dia:checked')).map(chk => parseInt(chk.value));

        if(wpp.length < 10) throw new Error("Número de WhatsApp muito curto.");

        await setDoc(doc(db, "loja", "config"), { wpp, minimo, lojaAberta, diasAbertos }, { merge: true });
        showToast("Configurações atualizadas!");
    } catch(err) {
        showToast(err.message, true);
    } finally {
        btn.textContent = "💾 Gravar Definições";
        btn.disabled = false;
    }
});
