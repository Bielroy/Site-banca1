import { auth, db, storage, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut, collection, doc, setDoc, deleteDoc, onSnapshot, ref, uploadBytes, getDownloadURL } from './firebase.js';
import { fmt, escapeHTML, formatarQtdRelatorio, showToast, openModal, closeModal } from './utils.js';

let produtosAtuais = [];
let pedidosGerais = [];
const placeholderSVG = `<div class="prod-img-placeholder skeleton" style="width:100%;height:100%"></div>`;

// ----------------------------------------------------
// AUTENTICAÇÃO
// ----------------------------------------------------
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        iniciarRealTimeSync(); 
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('dashboard').style.display = 'none';
    }
});

let isLoginProcessing = false;
document.getElementById('btn-login').addEventListener('click', () => {
    if (isLoginProcessing) return;
    const email = document.getElementById('email').value.trim();
    const msg = document.getElementById('login-msg');
    
    if (!email) { msg.textContent = "⚠️ Digite um e-mail válido."; msg.style.color = "var(--danger)"; return; }
    
    isLoginProcessing = true;
    document.getElementById('btn-login').disabled = true;
    msg.textContent = "Enviando link..."; msg.style.color = "var(--text-dark)";
    
    sendSignInLinkToEmail(auth, email, { url: window.location.href, handleCodeInApp: true })
        .then(() => { 
            window.sessionStorage.setItem('emailForSignIn', email);
            msg.textContent = "✅ Link enviado! Verifique o e-mail."; msg.style.color = "var(--success)"; 
        })
        .catch((e) => { msg.textContent = "❌ Erro ao enviar link."; msg.style.color = "var(--danger)"; })
        .finally(() => {
            setTimeout(() => { isLoginProcessing = false; document.getElementById('btn-login').disabled = false; }, 5000);
        });
});

if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.sessionStorage.getItem('emailForSignIn');
    if (!email) email = window.prompt('Confirme seu e-mail para acessar:');
    signInWithEmailLink(auth, email, window.location.href)
        .then(() => window.sessionStorage.removeItem('emailForSignIn'))
        .catch(() => alert("O link expirou ou é inválido. Tente novamente."));
}

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

// ----------------------------------------------------
// NAVEGAÇÃO E MODAIS
// ----------------------------------------------------
document.querySelector('.tabs').addEventListener('click', (e) => {
    if(e.target.classList.contains('tab')) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.aba-content').forEach(c => c.classList.remove('active'));
        
        e.target.classList.add('active');
        document.getElementById(`aba-${e.target.dataset.aba}`).classList.add('active');
        
        if(e.target.dataset.aba === 'relatorios') renderRelatorios();
    }
});

document.querySelectorAll('[data-fechar]').forEach(btn => { 
    btn.addEventListener('click', (e) => { closeModal(e.currentTarget.dataset.fechar); }); 
});

const customConfirm = (title, msg) => {
    return new Promise((resolve) => {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-msg').textContent = msg;
        openModal('overlay-confirm');
        
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const cleanup = () => { 
            closeModal('overlay-confirm'); 
            document.getElementById('btn-confirm-ok').removeEventListener('click', onOk); 
            document.getElementById('btn-confirm-cancel').removeEventListener('click', onCancel); 
        };
        document.getElementById('btn-confirm-ok').addEventListener('click', onOk); 
        document.getElementById('btn-confirm-cancel').addEventListener('click', onCancel);
    });
};

// ----------------------------------------------------
// SYNC EM TEMPO REAL (Firestore)
// ----------------------------------------------------
const iniciarRealTimeSync = () => {
    // Escuta Produtos
    onSnapshot(collection(db, "produtos"), (snap) => {
        produtosAtuais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => (b.ultimaModificacao || 0) - (a.ultimaModificacao || 0));
        renderProdutos();
    });

    // Escuta Configurações
    onSnapshot(doc(db, "loja", "config"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('config-wpp').value = data.wpp || '';
            document.getElementById('config-minimo').value = data.minimo || 0;
            document.getElementById('config-status-loja').value = data.lojaAberta === false ? "fechada" : "aberta";
            const diasSalvos = data.diasAbertos || [0,1,2,3,4,5,6];
            document.querySelectorAll('.chk-dia').forEach(chk => chk.checked = diasSalvos.includes(parseInt(chk.value)));
        } else {
            document.querySelectorAll('.chk-dia').forEach(chk => chk.checked = true);
        }
    });

    // Escuta Pedidos (Histórico vivo)
    onSnapshot(collection(db, "pedidos"), (snap) => {
        pedidosGerais = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => new Date(b.data) - new Date(a.data));
        if(document.getElementById('aba-relatorios').classList.contains('active')) renderRelatorios();
    });
};

// ----------------------------------------------------
// PRODUTOS (CRUD)
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
                    ? `<button class="btn btn-outline" style="border-color:var(--danger); color:var(--danger);" data-action="toggle-estoque" data-id="${p.id}" data-status="false">Esgotar Produto</button>`
                    : `<button class="btn btn-success" data-action="toggle-estoque" data-id="${p.id}" data-status="true">Voltar p/ Estoque</button>`
                }
                <button class="btn" style="width: auto; padding: 16px 20px;" data-action="editar-produto" data-id="${p.id}">Editar</button>
            </div>
        </article>
    `).join('');
    document.getElementById('lista-produtos').innerHTML = html;
};

document.body.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]'); if(!target) return;
    const action = target.dataset.action;
    
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
        else if (urlInput) { pData.foto = urlInput; }
        else if (document.getElementById('edit-id').value) { 
            const pAntigo = produtosAtuais.find(x => x.id === id); 
            if(pAntigo && pAntigo.foto) pData.foto = pAntigo.foto; 
        }
        
        await setDoc(doc(db, "produtos", id), pData, { merge: true });
        closeModal('modal-produto'); showToast("Produto salvo com sucesso!");
    } catch (erro) {
        alert(erro.message || "Erro ao salvar o produto.");
    } finally {
        btn.textContent = "💾 Salvar"; btn.disabled = false;
    }
});

document.getElementById('btn-excluir-produto').addEventListener('click', async () => {
    if(await customConfirm("Atenção Crítica", "APAGAR este produto permanentemente do banco de dados?")) { 
        await deleteDoc(doc(db, "produtos", document.getElementById('edit-id').value)); 
        closeModal('modal-produto'); showToast("Produto apagado.");
    }
});

// ----------------------------------------------------
// RELATÓRIOS E HISTÓRICO
// ----------------------------------------------------
const renderRelatorios = () => {
    const listDiv = document.getElementById('lista-historico');
    if(pedidosGerais.length === 0) { listDiv.innerHTML = "<p style='color:var(--text-light)'>Nenhum pedido registrado.</p>"; return; }

    let totalReceita = 0; let countProdutos = {}; let countClientes = {}; let countDias = { 'Domingo':0, 'Segunda':0, 'Terça':0, 'Quarta':0, 'Quinta':0, 'Sexta':0, 'Sábado':0 };
    const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    const htmlLista = pedidosGerais.map(p => {
        totalReceita += p.total || 0;
        const dateObj = new Date(p.data);
        if(!isNaN(dateObj.getTime())) countDias[diasSemana[dateObj.getDay()]] += (p.total || 0);
        const nomeCli = escapeHTML(p.nome).trim().toUpperCase(); countClientes[nomeCli] = (countClientes[nomeCli] || 0) + (p.total || 0);
        
        const itensStr = p.itens ? p.itens.map(i => { 
            countProdutos[i.nome] = (countProdutos[i.nome] || 0) + i.qtd; 
            return `${formatarQtdRelatorio(i.qtd, i.unidade)} ${escapeHTML(i.nome)}`; 
        }).join(', ') : '';
        
        return `
        <article class="card" style="flex-direction: column; align-items: flex-start; gap: 8px;">
            <div style="display: flex; justify-content: space-between; width: 100%;">
                <strong style="font-size: 1.1rem;">👤 ${escapeHTML(p.nome)} (Q${escapeHTML(p.quadra)} L${escapeHTML(p.lote)})</strong>
                <span style="color: var(--forest); font-weight: bold; font-size: 1.2rem;">${fmt(p.total||0)}</span>
            </div>
            <div style="font-size: 0.9rem; color: var(--text-light);">📅 ${isNaN(dateObj.getTime()) ? "Desconhecida" : dateObj.toLocaleString('pt-BR')} | 💳 ${escapeHTML(p.pag)}</div>
            <div style="font-size: 0.95rem; margin-top: 5px; background: var(--parchment); padding: 10px; border-radius: 8px;">📦 ${itensStr}</div>
            <button class="btn btn-outline" style="border-color: var(--danger); color: var(--danger); padding: 8px 16px; margin-top: 10px; width: auto; font-size: 0.9rem;" onclick="window.excluirPedido('${escapeHTML(p.id)}')">Excluir Pedido</button>
        </article>`;
    }).join('');

    document.getElementById('stat-pedidos').textContent = pedidosGerais.length;
    document.getElementById('stat-receita').textContent = fmt(totalReceita);
    listDiv.innerHTML = htmlLista;

    const renderRanking = (dados, divId, formatador) => { 
        const arr = Object.entries(dados).sort((a,b) => b[1] - a[1]).slice(0,5); 
        document.getElementById(divId).innerHTML = arr.length ? arr.map(i => `<div class="ranking-item"><span>${escapeHTML(i[0])}</span> <strong>${formatador(i[1])}</strong></div>`).join('') : '<p style="color: var(--text-light)">Sem dados.</p>'; 
    };
    
    renderRanking(countProdutos, 'ranking-produtos', val => val % 1 !== 0 ? `${val.toFixed(2).replace('.',',')} med.` : `${val} un.`);
    renderRanking(countClientes, 'ranking-clientes', val => fmt(val));
    renderRanking(countDias, 'ranking-dias', val => fmt(val));
};

document.getElementById('btn-exportar').addEventListener('click', () => {
    if(pedidosGerais.length === 0) return showToast("Não há pedidos.");
    let csv = "Data,Cliente,Quadra,Lote,Pagamento,Total,Itens\n";
    pedidosGerais.forEach(p => { 
        const itensTxt = p.itens ? p.itens.map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${i.nome}`).join(' | ') : '';
        csv += `"${p.data}","${p.nome}","${p.quadra}","${p.lote}","${p.pag}","${p.total.toFixed(2).replace('.',',')}","${itensTxt}"\n`; 
    });
    const link = document.createElement("a"); 
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' })); 
    link.download = `Vendas_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`; 
    link.click();
});

document.getElementById('btn-limpar-hist').addEventListener('click', async () => {
    if(await customConfirm("Atenção Extrema", "Apagar TODOS os pedidos do sistema de forma irreversível?")) { 
        await Promise.all(pedidosGerais.map(p => deleteDoc(doc(db, "pedidos", p.id)))); 
        showToast("Histórico apagado.");
    }
});

// Acesso global para inline onclick (botão de excluir no HTML string)
window.excluirPedido = async (id) => { 
    if(await customConfirm("Excluir", "Deseja excluir este pedido permanentemente?")) { 
        await deleteDoc(doc(db, "pedidos", id)); showToast("Pedido excluído.");
    } 
};

// ----------------------------------------------------
// CONFIGURAÇÕES GERAIS
// ----------------------------------------------------
document.getElementById('btn-salvar-config').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-config'); btn.textContent = "Salvando...";
    let wpp = document.getElementById('config-wpp').value.replace(/\D/g, ''); 
    const minimo = parseFloat(document.getElementById('config-minimo').value) || 0;
    const lojaAberta = document.getElementById('config-status-loja').value === "aberta";
    const diasAbertos = Array.from(document.querySelectorAll('.chk-dia:checked')).map(chk => parseInt(chk.value));

    await setDoc(doc(db, "loja", "config"), { wpp, minimo, lojaAberta, diasAbertos }, { merge: true });
    btn.textContent = "💾 Salvar Configurações"; showToast("Configurações atualizadas!");
});
