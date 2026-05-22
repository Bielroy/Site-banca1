import { auth, db, storage, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut, collection, doc, setDoc, deleteDoc, onSnapshot, ref, uploadBytes, getDownloadURL, query, orderBy, limit, writeBatch, where } from './firebase.js';
import { fmt, escapeHTML, formatarQtdRelatorio, showToast, openModal, closeModal, customConfirm } from './utils.js';

let produtosAtuais = [];
let pedidosGerais = [];
let unsubscribes = []; 

const placeholderSVG = `<div class="prod-img-placeholder skeleton" style="width:100%;height:100%"></div>`;

// 1. UTILITÁRIO DE ALTA PERFORMANCE (NOVO) - COMPRESSÃO DE IMAGEM CLIENT-SIDE
const compressImageToJPG = (file, maxWidth = 800, quality = 0.8) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    }));
                }, 'image/jpeg', quality);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

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
        if (!email) email = await requestEmailVerification(); 
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

const iniciarRealTimeSync = () => {
    const unsubProd = onSnapshot(collection(db, "produtos"), (snap) => {
        produtosAtuais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => (b.ultimaModificacao || 0) - (a.ultimaModificacao || 0));
        renderProdutos();
    });
    unsubscribes.push(unsubProd);

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

    // 2. QUERY AMPLIADA PARA KANBAN LOGÍSTICO
    const pedQuery = query(collection(db, "pedidos"), where("status", "in", ["pendente", "preparando", "enviado"]), orderBy("data", "desc"), limit(100));
    const unsubPedidos = onSnapshot(pedQuery, (snap) => {
        pedidosGerais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(document.getElementById('aba-relatorios').classList.contains('active')) renderRelatoriosMaster();
    });
    unsubscribes.push(unsubPedidos);
};

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
                    ? `<button class="btn btn-outline flex-1" style="border-color:var(--danger); color:var(--danger);" data-action="toggle-estoque" data-id="${p.id}" data-status="false">Esgotar Produto</button>`
                    : `<button class="btn btn-outline flex-1" style="background:var(--success); border-color:var(--success); color:white;" data-action="toggle-estoque" data-id="${p.id}" data-status="true">Voltar p/ Estoque</button>`
                }
                <button class="btn btn-outline" style="background: var(--parchment); color: var(--text-dark); border-color: #e0dcd4;" data-action="editar-produto" data-id="${p.id}">Editar</button>
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
        
        // 3. NOVO FLUXO DE KANBAN PARA PEDIDOS
        else if (action === 'avancar-pedido') {
            const id = target.dataset.id;
            const nextStatus = target.dataset.next;
            await setDoc(doc(db, "pedidos", id), { status: nextStatus }, { merge: true });
            showToast(`Pedido atualizado para: ${nextStatus.toUpperCase()}`);
        }

        else if (action === 'excluir-pedido') {
            const id = target.dataset.id;
            if(await customConfirm("Concluir e Arquivar", "Deseja finalizar este pedido e retirá-lo da logística visual? (Os dados financeiros serão mantidos).")) { 
                await setDoc(doc(db, "pedidos", id), { status: 'arquivado' }, { merge: true }); 
                showToast("Pedido concluído e arquivado!");
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
            // 4. INTEGRAÇÃO DA COMPRESSÃO (ECONOMIA DE STORAGE)
            showToast("Otimizando imagem...", false);
            const optimizedFile = await compressImageToJPG(fileInput.files[0], 800, 0.8);
            const storageRef = ref(storage, `fotos_produtos/${id}.jpg`); 
            await uploadBytes(storageRef, optimizedFile); 
            pData.foto = await getDownloadURL(storageRef); 
        } 
        else if (urlInput) { 
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

// 5. RENDERIZAÇÃO DO KANBAN DE ESTADOS (UI PREMIUM DE GESTÃO)
const renderHtmlPedidos = (pedidos) => {
    const dicsStatus = {
        'pendente': { tag: '🚨 NOVO', classColor: 'var(--danger)', nextBtn: 'Aceitar e Preparar', nextAction: 'preparando' },
        'preparando': { tag: '📦 PREPARANDO', classColor: 'var(--warning)', nextBtn: 'Despachar (Enviado)', nextAction: 'enviado' },
        'enviado': { tag: '🛵 A CAMINHO', classColor: 'var(--info)', nextBtn: 'Marcar como Entregue', nextAction: 'arquivado' }
    };

    return pedidos.map(p => {
        const dateObj = new Date(p.data);
        const dataFmt = isNaN(dateObj.getTime()) ? "Desconhecida" : dateObj.toLocaleString('pt-BR');
        const itensStr = p.itens ? p.itens.map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${escapeHTML(i.nome)}`).join(', ') : '';
        const st = dicsStatus[p.status] || dicsStatus['pendente'];
        
        return `
        <article class="card-pedido" style="border-left: 5px solid ${st.classColor};">
            <div class="card-pedido-topo">
                <span class="card-pedido-cliente">👤 ${escapeHTML(p.nome)} (Q${escapeHTML(p.quadra)} L${escapeHTML(p.lote)})</span>
                <span class="card-pedido-total">${fmt(p.total||0)}</span>
            </div>
            <div class="card-pedido-meta">
                <span style="background: ${st.classColor}; color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 0.75rem; margin-right: 8px;">${st.tag}</span>
                📅 ${dataFmt} | 💳 ${escapeHTML(p.pag)}
            </div>
            <div class="card-pedido-itens">📦 ${itensStr}</div>
            
            <div style="display: flex; gap: 8px; margin-top: 10px;">
                ${st.nextAction === 'arquivado' 
                    ? `<button class="btn btn-outline flex-1" style="border-color: var(--success); color: var(--success);" data-action="excluir-pedido" data-id="${escapeHTML(p.id)}">${st.nextBtn}</button>` 
                    : `<button class="btn btn-primary flex-1" style="background: ${st.classColor}; border-color: ${st.classColor};" data-action="avancar-pedido" data-next="${st.nextAction}" data-id="${escapeHTML(p.id)}">${st.nextBtn}</button>`
                }
            </div>
        </article>`;
    }).join('');
};

const renderRankingGenerico = (dados, divId, formatador) => { 
    const arr = Object.entries(dados).sort((a,b) => b[1] - a[1]).slice(0,5); 
    const html = arr.length ? arr.map(i => `<div class="ranking-item"><span>${escapeHTML(i[0])}</span> <strong>${formatador(i[1])}</strong></div>`).join('') : '<p style="color: var(--text-light)">Sem dados.</p>'; 
    document.getElementById(divId).innerHTML = html;
};

const renderRelatoriosMaster = () => {
    const listDiv = document.getElementById('lista-historico');
    if(pedidosGerais.length === 0) { 
        listDiv.innerHTML = "<p style='color:var(--text-light)'>A fila está limpa! Nenhum pedido em andamento.</p>"; 
        document.getElementById('stat-pedidos').textContent = "0";
        document.getElementById('stat-receita').textContent = "R$ 0,00";
        return; 
    }

    const stats = extrairEstatisticas(pedidosGerais);

    document.getElementById('stat-pedidos').textContent = pedidosGerais.length;
    document.getElementById('stat-receita').textContent = fmt(stats.totalReceita);

    renderRankingGenerico(stats.countProdutos, 'ranking-produtos', val => val % 1 !== 0 ? `${val.toFixed(2).replace('.',',')} med.` : `${val} un.`);
    renderRankingGenerico(stats.countClientes, 'ranking-clientes', val => fmt(val));

    listDiv.innerHTML = renderHtmlPedidos(pedidosGerais);
};

document.getElementById('btn-exportar').addEventListener('click', () => {
    if(pedidosGerais.length === 0) return showToast("Não há pedidos para exportar.", true);
    let csv = "Data,Cliente,Quadra,Lote,Status,Pagamento,Total,Itens\n";
    pedidosGerais.forEach(p => { 
        const itensTxt = p.itens ? p.itens.map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${i.nome}`).join(' | ') : '';
        csv += `"${p.data}","${p.nome}","${p.quadra}","${p.lote}","${p.status}","${p.pag}","${p.total.toFixed(2).replace('.',',')}","${itensTxt}"\n`; 
    });
    const link = document.createElement("a"); 
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' })); 
    link.download = `Vendas_Logistica_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`; 
    link.click();
});

document.getElementById('btn-limpar-hist').addEventListener('click', async () => {
    if(pedidosGerais.length === 0) return;
    
    if(await customConfirm("Limpeza de Final de Expediente", "Isto ARQUIVARÁ todos os pedidos da tela atual (mesmo os que ainda não foram marcados como entregues). Confirmar encerramento em lote?")) { 
        try {
            const batch = writeBatch(db);
            pedidosGerais.forEach(p => {
                const docRef = doc(db, "pedidos", p.id);
                batch.update(docRef, { status: 'arquivado' }); 
            });
            await batch.commit();
            showToast("Expediente finalizado. Pedidos arquivados.");
        } catch (error) {
            console.error(error);
            showToast("Erro ao processar lote.", true);
        }
    }
});

document.getElementById('btn-salvar-config').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-config'); 
    btn.textContent = "Salvando... ⏳"; btn.disabled = true;

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
        btn.textContent = "💾 Gravar Definições"; btn.disabled = false;
    }
});
