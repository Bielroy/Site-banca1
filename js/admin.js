import './erros-site.js';   // primeiro: avisa o servidor se algo quebrar (aba Erros da Plataforma)
import { getDoc, auth, db, storage, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut, collection, doc, setDoc, deleteDoc, onSnapshot, ref, uploadBytes, getDownloadURL, query, orderBy, limit, writeBatch, where, updateDoc } from './firebase.js';
import { horariosDoTexto } from './entrega-lib.js';
import { tcol, tdoc, chave, TENANT, ehLojaOriginal, fichaRef, pastaFotos, urlDaLoja } from './tenant.js';
import { feirasDaFicha, textoDoDia } from './plataforma-lib.js';
import { fmt, escapeHTML, formatarQtdRelatorio, showToast, openModal, closeModal, customConfirm } from './utils.js';
import { normalizarChave, TIPOS_DE_CHAVE } from './pix-chave-lib.js';
import { precoDeValido } from './oferta-lib.js';
import './admin-instalar.js';
import { exigirAdmin, iniciarLogoutPorInatividade, papelAtual, sairELimpar, bancasDaPessoa, mostrarSuspensa } from './admin-guard.js';
import { htmlSimples, csvCampo } from './html-lib.js';
import { abasDoPapel, podeAbrir, ehGestor, cuidaDeEstoque, rotuloDoPapel } from './papeis-lib.js';
import { ico } from './icones-admin.js';          // também liga a troca das marcas <i class="ic"> pelos desenhos
import { linhaEndereco } from './endereco.js';
import { abrirPrevisao } from './admin-previsao.js';
import { abrirFechamento } from './admin-fechamento.js';

// ---------------------------------------------------------------------
// TELAS CARREGADAS SÓ QUANDO ABERTAS. O painel abre mais rápido porque o
// código de Estoque, Compras, Balcão, Clientes etc. só é baixado na hora
// em que a aba é tocada (e fica guardado para as próximas vezes).
// ---------------------------------------------------------------------
const TELAS = {
    aparencia: () => import('./admin-aparencia.js'), estoque: () => import('./admin-estoque.js'), fotos: () => import('./admin-fotos.js'),
    margens: () => import('./admin-margens.js'), compras: () => import('./admin-compras.js'), pdv: () => import('./admin-pdv.js'),
    crm: () => import('./admin-crm.js'), copiloto: () => import('./admin-copiloto.js'), calendario: () => import('./admin-calendario.js'),
    equipe: () => import('./admin-equipe.js'), impressao: () => import('./admin-impressao.js'), avisos: () => import('./admin-avisos.js'),
    precosDia: () => import('./admin-precos-dia.js'),
};
const comImpressao = async (fn) => { try { await fn(await TELAS.impressao()); } catch (e) { console.error(e); showToast('Não consegui abrir a impressão. Confira a internet e toque de novo.', true); } };
document.getElementById('btn-impressora')?.addEventListener('click', () => comImpressao((m) => m.abrirImpressora()));
document.getElementById('btn-avisos')?.addEventListener('click', async () => { try { (await TELAS.avisos()).abrirAvisos(); } catch (e) { console.error(e); showToast('Não consegui abrir os avisos. Confira a internet e toque de novo.', true); } });
let condominiosAtuais = [];
const ABRIR = {
    aparencia: (m) => m.abrirAparencia(), estoque: (m) => m.abrirEstoque(produtosAtuais), compras: (m) => m.abrirCompras(produtosAtuais),
    pdv: (m) => { m.definirCondominiosPdv(condominiosAtuais); m.abrirPdv(produtosAtuais); }, crm: (m) => m.abrirCrm(produtosAtuais), copiloto: (m) => m.abrirCopiloto(), calendario: (m) => m.abrirCalendario({ podeEditar: ehGestor(papelAtual) }), equipe: (m) => m.abrirEquipe(),
};
const abrirTela = async (nome) => {
    try { ABRIR[nome](await TELAS[nome]()); }
    catch (e) { console.error(e); showToast('Não consegui abrir esta tela. Confira a internet e toque de novo.', true); }
};
import { iniciarCategoriasAdmin, abrirCategorias, chaveDaCategoria, nomeDaCategoria, normalizarWpp } from './admin-categorias.js';

// Chart.js agora é carregado sob demanda (só ao abrir o Dashboard).
// Isso tira ~200KB do carregamento inicial do painel.
let Chart = null;
const carregarChart = async () => {
    if (!Chart) { const mod = await import('chart.js/auto'); Chart = mod.default; }
    return Chart;
};

let produtosAtuais = [];
let nomeDaLoja = ehLojaOriginal ? 'Banca Adair e Pedrina' : 'Nossa loja';   // trocado pelo nome da ficha da loja ao entrar
let pedidosGerais = [];
let unsubscribes = [];
let adminBuscaTermo = "";
let pedidoBuscaTermo = "";

const placeholderSVG = `<div class="prod-img-placeholder skeleton" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:0.8rem">Sem Foto</div>`;

const normalizar = (txt) => String(txt || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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
    document.getElementById('dashboard').style.display = 'grid';
    // 12 horas sem tocar no painel encerram o login. Era 30 minutos, mas cada entrada nova gasta um link de
    // e-mail e o plano gratuito do Firebase só envia 5 por dia para a loja inteira: com 30 minutos, a própria
    // equipe esgotava o limite e ninguém mais entrava naquele dia. No balcão, "Sair" encerra na hora.
    iniciarLogoutPorInatividade(12 * 60);
    let suspensa = false;
    try { const f = await getDoc(fichaRef()); suspensa = f.exists() && f.data().ativo === false; modulosDaLoja = f.exists() ? (f.data().modulos || null) : null; nomeDaLoja = (f.exists() && f.data().nome) || nomeDaLoja; lerDiasSemFeira(f.exists() ? f.data() : null); } catch (_) { modulosDaLoja = null; }
    // LOJA BLOQUEADA pela plataforma (falta de pagamento): o painel não abre. Só a plataforma continua entrando.
    if (suspensa && papelAtual !== 'plataforma') { mostrarSuspensa(papelAtual === 'proprietario'); return; }
    { const tl = document.getElementById('topo-loja'); if (tl) tl.textContent = nomeDaLoja; }
    aplicarPapel();
    montarTrocaDeBanca();
    if (ehGestor(papelAtual)) iniciarIAFeaturesDOM();
    iniciarRealTimeSync();
});

let isLoginProcessing = false;
document.getElementById('btn-login').addEventListener('click', async () => {
    if (isLoginProcessing) return;
    const email = document.getElementById('email').value.trim();
    const msg = document.getElementById('login-msg');

    if (!email || !email.includes('@')) {
        msg.textContent = "Digite um e-mail válido."; msg.style.color = "var(--danger)"; return;
    }

    isLoginProcessing = true; document.getElementById('btn-login').disabled = true;
    msg.textContent = "A enviar link..."; msg.style.color = "var(--text-dark)";

    const guardarEmail = () => { try { window.localStorage.setItem('emailForSignIn', email); } catch (_) {} try { window.sessionStorage.setItem('emailForSignIn', email); } catch (_) {} };
    try {
        // O pedido do link passa pelo NOSSO servidor: só e-mail que já faz parte de alguma equipe recebe, e a
        // resposta é a mesma para qualquer e-mail (não dá para descobrir por aqui quem é da equipe).
        let r = null, j = {};
        try {
            r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'pedir-link', email, loja: TENANT }) });
            j = await r.json().catch(() => ({}));
        } catch (_) { r = null; }
        if (r && r.ok) {
            guardarEmail();
            msg.textContent = j.mensagem || 'Se este e-mail estiver autorizado, o link chega em instantes.'; msg.style.color = "var(--success)";
        } else if (r && (r.status === 429 || r.status === 400)) {
            msg.textContent = j.error || 'Não consegui enviar. Tente de novo em alguns minutos.'; msg.style.color = "var(--danger)";
        } else {
            // Plano B: o servidor não conseguiu (fora do ar ou sem configuração). Pede direto ao Firebase, como era antes,
            // para ninguém ficar trancado para fora por causa de uma falha nossa.
            await sendSignInLinkToEmail(auth, email, { url: window.location.origin + window.location.pathname + (ehLojaOriginal ? '' : `?loja=${encodeURIComponent(TENANT)}`), handleCodeInApp: true });
            guardarEmail();
            msg.textContent = "Se este e-mail estiver autorizado, o link chega em instantes."; msg.style.color = "var(--success)";
        }
    } catch (error) {
        msg.textContent = "Erro ao enviar. Tente novamente."; msg.style.color = "var(--danger)";
    } finally {
        setTimeout(() => { isLoginProcessing = false; document.getElementById('btn-login').disabled = false; }, 5000);
    }
});

if (isSignInWithEmailLink(auth, window.location.href)) {
    // localStorage: o link do e-mail costuma abrir em OUTRA aba, onde o sessionStorage vem vazio
    let email = window.sessionStorage.getItem('emailForSignIn');
    try { email = email || window.localStorage.getItem('emailForSignIn'); } catch (_) {}
    const linkCompleto = window.location.href;
    const processLogin = async () => {
        if (!email) email = prompt("Por segurança, confirme o seu e-mail:");
        if (email) {
            try {
                await signInWithEmailLink(auth, email, linkCompleto);
                window.sessionStorage.removeItem('emailForSignIn');
                try { window.localStorage.removeItem('emailForSignIn'); } catch (_) {}
            } catch (e) { showToast("Link expirado ou inválido. Peça um novo.", true); }
        }
        // Tira o código de uso único da barra de endereço: sem isso, cada
        // recarga da página tentava entrar de novo com um link já gasto.
        // (o endereço fica só com a página e a loja: nada do código do link sobra na barra nem no histórico)
        history.replaceState(null, '', window.location.pathname + (ehLojaOriginal ? '' : `?loja=${encodeURIComponent(TENANT)}`));
    };
    processLogin();
}

document.getElementById('btn-logout').addEventListener('click', () => sairELimpar());

// ---------------------------------------------------------------------
// PAPÉIS: cada pessoa da equipe vê só as abas do papel dela (js/papeis-lib.js).
// É organização de tela; a trava de verdade está no servidor e nas regras do banco.
// ---------------------------------------------------------------------
const TODAS_AS_ABAS = [...document.querySelectorAll('.tab')].map((t) => t.dataset.aba);
let modulosDaLoja = null;                                // ficha.modulos: o que a plataforma ligou nesta loja
const aplicarPapel = () => {
    const minhas = abasDoPapel(papelAtual, TODAS_AS_ABAS, modulosDaLoja), gestor = ehGestor(papelAtual);
    const lp = document.getElementById('link-plataforma'); if (lp) lp.hidden = !(papelAtual === 'plataforma' || (papelAtual === 'proprietario' && ehLojaOriginal));
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = !minhas.includes(t.dataset.aba); });
    const ba = document.getElementById('btn-avisos');   // quem não vê pedidos (produção, estoque) não recebe aviso de pedido
    if (ba) { ba.hidden = !['plataforma', 'proprietario', 'administrador', 'funcionario', 'caixa'].includes(papelAtual); if (!ba.hidden) TELAS.avisos().then((m) => m.marcarBotaoDeAvisos()).catch(() => {}); }
    document.body.classList.toggle('so-equipe', !gestor);
    if (['plataforma', 'proprietario'].includes(papelAtual)) import('./admin-maquininha.js').then((m) => m.iniciarMaquininha()).catch((e) => console.warn('[maquininha]', e && e.message));
    if (['plataforma', 'proprietario'].includes(papelAtual)) import('./admin-copia.js').then((m) => m.iniciarCopia()).catch((e) => console.warn('[copia]', e && e.message));
    const r = document.getElementById('papel-rotulo'); if (r) { r.textContent = rotuloDoPapel(papelAtual); r.hidden = papelAtual === 'proprietario'; }
    montarBarra(minhas);
    document.querySelectorAll('.so-dono').forEach((el) => { el.hidden = !['plataforma', 'proprietario'].includes(papelAtual); });
    // título de grupo só aparece se sobrou alguma aba dele; quem tem poucas abas não precisa de grupos nem de menu
    const nav = document.querySelector('.tabs');
    nav.classList.toggle('poucas', minhas.length <= 4);
    document.querySelectorAll('.tabs-grupo').forEach((g) => {
        let tem = false;
        for (let n = g.nextElementSibling; n && !n.classList.contains('tabs-grupo'); n = n.nextElementSibling) if (!n.hidden) tem = true;
        g.hidden = !tem;
    });
    const ativa = document.querySelector('.tab.active');
    if (!ativa || !minhas.includes(ativa.dataset.aba)) document.querySelector(`.tab[data-aba="${minhas[0]}"]`)?.click();
    else mostrarAbaAtual(ativa);
};
// No celular o menu fica recolhido numa barra com a aba aberta; "Menu" mostra todas.
const mostrarAbaAtual = (tab) => {
    const nome = tab.querySelector('.tab-txt').textContent;
    document.getElementById('tabs-atual-nome').textContent = nome;
    document.getElementById('tabs-atual-ico').innerHTML = ico(tab.querySelector('[data-i]')?.dataset.i || 'menu', 'viva');
    const sec = document.getElementById('topo-secao'); if (sec) sec.textContent = nome;                 // o topo diz em que tela a pessoa está
    document.querySelectorAll('#barra [data-ir-aba]').forEach((b) => { const on = b.dataset.irAba === tab.dataset.aba; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const bm = document.getElementById('barra-menu'); if (bm) bm.classList.toggle('on', !document.querySelector(`#barra [data-ir-aba="${tab.dataset.aba}"]`));   // tela que só existe no Menu
};
const recolherMenu = (sim) => {
    document.querySelector('.tabs').classList.toggle('recolhido', sim);
    document.getElementById('tabs-atual').setAttribute('aria-expanded', String(!sim));
    const f = document.getElementById('tabs-fundo'); if (f) f.hidden = sim;
    const bm = document.getElementById('barra-menu'); if (bm) bm.setAttribute('aria-expanded', String(!sim));
};

// ---------------------------------------------------------------------
// BARRA DE ATALHOS (celular): as telas do dia a dia a um toque, e "Menu" para o resto.
// É o desenho dos painéis de loja mais usados (Shopify, Square, iFood): o que se abre
// dez vezes por dia fica sempre ao alcance do polegar. Respeita o papel de quem entrou.
// ---------------------------------------------------------------------
const ORDEM_DA_BARRA = ['relatorios', 'pdv', 'fechamento', 'produtos', 'estoque', 'compras', 'calendario', 'previsao', 'balanco'];
const montarBarra = (minhas) => {
    const barra = document.getElementById('barra'); if (!barra) return;
    const cabeTudo = minhas.length <= 5;
    const escolhidas = (cabeTudo ? minhas : ORDEM_DA_BARRA.filter((a) => minhas.includes(a)).slice(0, 4));
    const botao = (aba) => {
        const t = document.querySelector(`.tab[data-aba="${aba}"]`); if (!t) return '';
        return `<button type="button" class="barra-btn" data-ir-aba="${aba}"><i class="ic" data-i="${t.querySelector('[data-i]')?.dataset.i || 'menu'}"></i><span>${escapeHTML(t.querySelector('.tab-txt').textContent)}</span>${aba === 'relatorios' ? '<i class="barra-conta" id="barra-conta" hidden></i>' : ''}</button>`;
    };
    barra.innerHTML = escolhidas.map(botao).join('') + (cabeTudo ? '' : '<button type="button" class="barra-btn" id="barra-menu" aria-expanded="false" aria-controls="menu-abas"><i class="ic" data-i="menu"></i><span>Menu</span></button>');
    barra.style.setProperty('--n', String(escolhidas.length + (cabeTudo ? 0 : 1)));
    document.body.classList.add('com-barra');
    pintarContaDePedidos();
};
let pedidosEsperando = 0;
const pintarContaDePedidos = () => { const c = document.getElementById('barra-conta'); if (c) { c.textContent = pedidosEsperando; c.hidden = !pedidosEsperando; c.setAttribute('aria-label', `${pedidosEsperando} pedido(s) esperando`); } };
document.getElementById('barra')?.addEventListener('click', (e) => { if (e.target.closest('#barra-menu')) recolherMenu(!document.querySelector('.tabs').classList.contains('recolhido')); else if (e.target.closest('[data-ir-aba]')) recolherMenu(true); });
document.getElementById('tabs-fundo')?.addEventListener('click', () => recolherMenu(true));

// DIAS SEM FEIRA (chuva, feriado), marcados na Plataforma: o pedido já feito para um desses dias ganha um aviso.
const SEM_FEIRA = new Map();
function lerDiasSemFeira(ficha) {
    feirasDaFicha(ficha).forEach((fid) => getDoc(doc(db, 'feiras', fid)).then((s) => {
        if (!s.exists()) return;
        SEM_FEIRA.set(fid, new Set(Array.isArray(s.data().semFeira) ? s.data().semFeira : []));
        const listDiv = document.getElementById('lista-historico');
        if (listDiv && pedidosGerais.length) listDiv.innerHTML = renderHtmlPedidos(pedidosGerais);
    }).catch(() => {}));
}

// TROCAR DE BANCA: quem cuida de mais de uma banca (dono de dois pontos) escolhe qual abrir.
// Cada banca abre no endereço dela; o servidor e as regras do banco conferem o acesso de novo lá.
async function montarTrocaDeBanca() {
    const outras = bancasDaPessoa.filter((id) => id !== TENANT);
    const caixa = document.getElementById('menu-bancas'), botao = document.getElementById('topo-trocar');
    if (!caixa || !outras.length) return;
    const nomes = await Promise.all(outras.map((id) => getDoc(doc(db, 'tenants', id)).then((f) => (f.exists() && f.data().nome) || id).catch(() => id)));
    caixa.innerHTML = `<span class="menu-bancas-tit">Trocar de banca</span>` + outras.map((id, i) => `<a href="${escapeHTML(urlDaLoja(id, location.pathname))}">${escapeHTML(nomes[i])}</a>`).join('');
    caixa.hidden = false;
    if (botao) { botao.hidden = false; botao.onclick = (e) => { e.stopPropagation(); document.getElementById('btn-mais')?.click(); }; }
}

// "Mais opções" do topo (Plataforma, instalar, impressora, sair): abre e fecha; toque fora fecha.
{
    const bm = document.getElementById('btn-mais'), mm = document.getElementById('menu-mais');
    const abrir = (sim) => { if (!bm || !mm) return; mm.hidden = !sim; bm.setAttribute('aria-expanded', String(sim)); };
    bm?.addEventListener('click', (e) => { e.stopPropagation(); abrir(mm.hidden); });
    document.addEventListener('click', (e) => { if (mm && !mm.hidden && !e.target.closest('#menu-mais')) abrir(false); });
    mm?.addEventListener('click', () => abrir(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { abrir(false); if (!document.querySelector('.tabs').classList.contains('recolhido')) recolherMenu(true); } });
}
document.getElementById('tabs-atual').addEventListener('click', () => recolherMenu(!document.querySelector('.tabs').classList.contains('recolhido')));

document.querySelector('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const aba = tab.dataset.aba;
    if (!podeAbrir(papelAtual, aba, TODAS_AS_ABAS, modulosDaLoja)) return;
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.aba-content').forEach(c => c.classList.remove('active'));

    tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
    mostrarAbaAtual(tab); recolherMenu(true);
    document.getElementById(`aba-${aba}`).classList.add('active');

    if (aba === 'relatorios') renderRelatoriosMaster();
    if (aba === 'balanco') carregarBalanco(Number(document.getElementById('balanco-periodo')?.value || 30));
    if (aba === 'previsao') abrirPrevisao();
    if (aba === 'fechamento') abrirFechamento(produtosAtuais);
    if (aba === 'categorias') abrirCategorias();
    if (ABRIR[aba]) abrirTela(aba);
    if (aba === 'comunicados') renderComunicados();
    if (aba === 'cupons') renderCupons();
});

// Atalhos "ir para a aba X" espalhados pelo painel (ex.: Operacional → Categorias)
document.getElementById('dashboard').addEventListener('click', (e) => {
    const ir = e.target.closest('[data-ir-aba]');
    if (!ir) return;
    document.querySelector(`.tab[data-aba="${ir.dataset.irAba}"]`)?.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Um ouvinte só para todos os botões de fechar, inclusive os das telas criadas depois
// (Estoque, Enviar fotos). Antes só valia para as telas que já existiam ao abrir o painel.
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fechar]');
    if (btn) { closeModal(btn.dataset.fechar); if (history.state && history.state.modal === btn.dataset.fechar) history.back(); }   // tira do histórico a entrada da janela que acabou de fechar
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


// =====================================================================
// Quando o Firestore recusa uma consulta, a mensagem de erro costuma
// trazer um LINK que cria o índice necessário automaticamente. No
// celular ninguém vai abrir o console para achar isso — então
// mostramos o link direto na tela.
// =====================================================================
const mostrarErroConsulta = (erro, alvoId) => {
    const alvo = document.getElementById(alvoId);
    if (!alvo) return;

    const texto = String(erro?.message || erro || '');
    const link = (texto.match(/https:\/\/console\.firebase\.google\.com\S+/) || [])[0];
    const semPermissao = /permission|insufficient/i.test(texto);

    if (link) {
        alvo.innerHTML = `
            <div style="background:var(--warning-light); border:1px solid var(--warning); border-radius:12px; padding:20px; text-align:center;">
                <div style="font-size:2rem; margin-bottom:8px;"><i class="ic" data-i="caixa"></i></div>
                <h3 style="color:var(--warning); margin-bottom:8px;">Falta criar um índice no banco</h3>
                <p style="color:var(--text-mid); font-size:.92rem; line-height:1.6; margin-bottom:16px;">
                    O Firestore precisa de um índice para esta consulta. É automático:
                    toque no botão, confirme no Firebase e volte aqui em ~1 minuto.
                </p>
                <a href="${escapeHTML(link)}" target="_blank" rel="noopener"
                   style="display:inline-block; background:var(--forest); color:#fff; padding:14px 24px; border-radius:12px; font-weight:800; text-decoration:none;">
                   Criar índice agora →
                </a>
            </div>`;
    } else if (semPermissao) {
        alvo.innerHTML = `
            <div style="background:var(--danger-light); border:1px solid var(--danger); border-radius:12px; padding:20px; text-align:center;">
                <div style="font-size:2rem; margin-bottom:8px;"><i class="ic" data-i="cadeado"></i></div>
                <h3 style="color:var(--danger); margin-bottom:8px;">Sem permissão para ler os pedidos</h3>
                <p style="color:var(--text-mid); font-size:.92rem; line-height:1.6;">
                    As regras do Firestore exigem a permissão de administrador.
                    Saia da conta e entre de novo para renovar o acesso — se continuar,
                    é sinal de que o passo do <b>set-admin</b> não foi concluído.
                </p>
            </div>`;
    } else {
        alvo.innerHTML = `
            <div style="background:var(--parchment); border-radius:12px; padding:20px;">
                <h3 style="color:var(--text-dark); margin-bottom:8px;">Não consegui carregar os pedidos</h3>
                <p style="color:var(--text-mid); font-size:.88rem; word-break:break-word;">${escapeHTML(texto)}</p>
            </div>`;
    }
};


// Status que contam como "pedido em andamento" (aparecem no Kanban)
const STATUS_NA_FILA = ['pendente', 'aguardando_pesagem', 'aguardando_pagamento', 'preparando', 'enviado'];

// Faixa discreta no topo avisando que o painel está no modo sem índice.
// Não bloqueia nada: o painel funciona, só está lendo mais que o preciso.
// Traz o link que cria o índice, para resolver de vez.
// Pedidos em aberto que a fila mostra de uma vez (era 100). Passou disso, os MAIS ANTIGOS ficam de fora:
// a faixa abaixo avisa, para nenhum pedido ser esquecido sem ninguém saber.
const LIMITE_FILA = 300;
const avisarFilaCheia = (cheia) => {
    const faixa = document.getElementById('faixa-fila-cheia');
    if (!cheia) { faixa?.remove(); return; }
    if (faixa) return;
    document.getElementById('aba-relatorios')?.insertAdjacentHTML('afterbegin', `<p id="faixa-fila-cheia" class="aviso-limite"><i class="ic" data-i="alerta"></i> Há mais de ${LIMITE_FILA} pedidos em aberto. A fila mostra só os ${LIMITE_FILA} mais recentes: finalize ou arquive os pedidos já entregues para os mais antigos aparecerem.</p>`);
};
const avisarModoSimples = (erro) => {
    if (document.getElementById('faixa-modo-simples')) return;
    const link = (String(erro?.message || '').match(/https:\/\/console\.firebase\.google\.com\S+/) || [])[0];
    const secao = document.getElementById('aba-relatorios');
    if (!secao) return;

    const acao = link
        ? `<a href="${escapeHTML(link)}" target="_blank" rel="noopener" style="color:#92400e; font-weight:800;">Criar o índice agora →</a>`
        : `<span style="color:#92400e;">Peça para criar o índice composto de <b>status</b> + <b>data</b>.</span>`;

    secao.insertAdjacentHTML('afterbegin', `
        <div id="faixa-modo-simples" style="background:#fef3c7; border:1px solid #d97706; border-radius:12px; padding:14px 16px; margin-bottom:18px; font-size:.9rem; line-height:1.6; color:#4a4a44;">
            <i class="ic" data-i="ajustes"></i> <b>Modo simplificado.</b> A fila está funcionando normalmente, mas o banco
            ainda não tem o índice ideal — por isso o carregamento fica um pouco mais pesado. ${acao}
        </div>`);
};

const iniciarRealTimeSync = () => {
    // Custo e ficha técnica moram em produtos_custos (privado). Aqui os dois se juntam,
    // e todas as abas continuam lendo p.custo e p.ficha como antes.
    let produtosBase = [], custosPorId = new Map();
    const juntarProdutos = () => {
        produtosAtuais = produtosBase.map(p => { const c = custosPorId.get(p.id) || {}; return { ...p, custo: c.custo ?? null, ficha: c.ficha ?? null }; });
        renderProdutos();
        const abaAberta = (n) => document.getElementById(`aba-${n}`)?.classList.contains('active');
        ['estoque', 'compras', 'pdv'].forEach((n) => { if (abaAberta(n)) abrirTela(n); });
    };
    if (cuidaDeEstoque(papelAtual)) unsubscribes.push(onSnapshot(tcol("produtos_custos"), (snap) => {
        custosPorId = new Map(snap.docs.map(d => [d.id, d.data()])); juntarProdutos();
    }, (e) => console.warn('[painel] custos:', e?.code || e)));
    const unsubProd = onSnapshot(tcol("produtos"), (snap) => {
        produtosBase = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }))
            .sort((a, b) => (b.ultimaModificacao || 0) - (a.ultimaModificacao || 0));
        juntarProdutos();
    }, (e) => mostrarErroConsulta(e, 'lista-produtos'));
    unsubscribes.push(unsubProd);

    const unsubConfig = onSnapshot(tdoc("loja", "config"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('config-wpp').value = data.wpp || '';
            document.getElementById('config-minimo').value = data.minimo || 0;
            const ent = data.entrega || {}, campoHor = document.getElementById('config-horarios');
            if (document.activeElement?.id !== 'config-taxa') document.getElementById('config-taxa').value = Number(ent.taxa) > 0 ? ent.taxa : '';
            if (document.activeElement?.id !== 'config-gratis') document.getElementById('config-gratis').value = Number(ent.gratisAcima) > 0 ? ent.gratisAcima : '';
            if (campoHor && document.activeElement !== campoHor) campoHor.value = (Array.isArray(ent.horarios) ? ent.horarios : []).join('\n');
            const chkPix = document.getElementById('config-pix'); if (chkPix) chkPix.checked = data.pixAutomatico === true;
            const px = data.pix || {}; [['config-pix-tipo', px.tipo || 'celular'], ['config-pix-chave', px.chave || ''], ['config-pix-nome', px.nome || ''], ['config-pix-cidade', px.cidade || '']].forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
            const cid = document.getElementById('config-cidade'); if (cid && document.activeElement !== cid) cid.value = data.cidade || '';
            const grupoPix = document.getElementById('grupo-pix'); if (grupoPix) grupoPix.hidden = !ehLojaOriginal;   // a conta do PagBank no servidor é a da loja original
            document.getElementById('config-status-loja').value = data.lojaAberta === false ? "fechada" : "aberta";
            const diasSalvos = data.diasAbertos || [0, 1, 2, 3, 4, 5, 6];
            document.querySelectorAll('.chk-dia').forEach(chk => chk.checked = diasSalvos.includes(parseInt(chk.value)));
            // não redesenha a lista se alguém está digitando nela
            if (!document.getElementById('lista-condominios')?.contains(document.activeElement)) pintarCondominios(data.condominios);
            condominiosAtuais = Array.isArray(data.condominios) ? data.condominios : [];
            if (document.getElementById('aba-pdv')?.classList.contains('active')) abrirTela('pdv');
        }
    });
    unsubscribes.push(unsubConfig);

    const unsubComunicados = onSnapshot(tdoc("loja", "comunicados"), (snap) => {
        if (snap.exists()) comunicadosAtuais = { dias: {}, fixo: { ativo: false, texto: '' }, ...snap.data() };
        renderComunicados();
    });
    unsubscribes.push(unsubComunicados);

    if (ehGestor(papelAtual)) iniciarCupons();
    unsubscribes.push(...iniciarCategoriasAdmin(() => produtosAtuais));
    // Produção e Estoque não têm a fila de pedidos: não gasta leitura com ela.
    if (!podeAbrir(papelAtual, 'relatorios', TODAS_AS_ABAS, modulosDaLoja)) return;

    // ATENÇÃO: esta consulta combina "where in" + "orderBy", o que exige um
    // ÍNDICE COMPOSTO no Firestore. Se aparecer erro no console com um link,
    // clique nele: o Firebase cria o índice sozinho (leva ~1 min).
    // -----------------------------------------------------------------
    // ESCUTA DOS PEDIDOS DA FILA
    //
    // A consulta ideal filtra por status E ordena por data. Como são
    // campos diferentes, o Firestore exige um ÍNDICE COMPOSTO.
    // Enquanto esse índice não existir, caímos num plano B que ordena
    // só por data e filtra no navegador — o painel funciona igual,
    // apenas lendo mais documentos do que o necessário.
    // -----------------------------------------------------------------
    let cargaInicial = true;

    const aplicarPedidos = (docs) => {
        pedidosGerais = docs;
        // quantos pedidos esperam alguém: aparece na aba e no botão do menu
        const esperando = docs.filter(p => ['pendente', 'aguardando_pesagem'].includes(p.status)).length;
        const tabPed = document.querySelector('.tab[data-aba="relatorios"]');
        if (tabPed) { let c = tabPed.querySelector('.tab-conta'); if (!c) { c = document.createElement('i'); c.className = 'tab-conta'; tabPed.appendChild(c); } c.textContent = esperando; c.hidden = !esperando; c.setAttribute('aria-label', `${esperando} pedido(s) esperando`); }
        const ponto = document.getElementById('tabs-ponto'); if (ponto) ponto.hidden = !esperando;
        pedidosEsperando = esperando; pintarContaDePedidos();
        if (document.getElementById('aba-relatorios')?.classList.contains('active')) {
            renderRelatoriosMaster();
        }
    };

    // No Android, "new Notification()" lança erro (lá só funciona via service
    // worker). Como isso rodava ANTES de desenhar a fila, o pedido novo tocava a
    // campainha e não aparecia na tela. Agora nada aqui pode interromper a fila.
    const notificarNovoPedido = () => {
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            const aviso = { body: 'Novo pedido chegou!', icon: '/icon-192.png', tag: 'novo-pedido' };
            if (navigator.serviceWorker?.ready) navigator.serviceWorker.ready.then(r => r.showNotification('Banca', aviso)).catch(() => {});
            else new Notification('Banca', aviso);
        } catch (_) { /* sem notificação: a campainha e o aviso na tela já tocaram */ }
    };

    // A campainha vale para os dois modos: é o que avisa que chegou pedido.
    const avisarSeChegouPedido = (snap) => {
        const chegou = snap.docChanges().some(c =>
            c.type === 'added' && ['pendente', 'aguardando_pesagem'].includes(c.doc.data().status)
        );
        if (!cargaInicial && chegou) {
            playAlertaPedido();
            document.querySelectorAll('.tab[data-aba="relatorios"] .ic, #tabs-atual .tabs-atual-trocar .ic').forEach((i) => { i.classList.remove('toca'); void i.getBoundingClientRect(); i.classList.add('toca'); });
            showToast("NOVO PEDIDO NA FILA!", false);
            notificarNovoPedido();
        }
        cargaInicial = false; // só a PRIMEIRA carga é silenciosa
    };

    const escutarSemIndice = (motivo) => {
        avisarModoSimples(motivo);
        const qSimples = query(tcol("pedidos"), orderBy("data", "desc"), limit(300));
        // O unsubscribe é guardado — sem isso o listener sobreviveria ao logout.
        const unsub = onSnapshot(qSimples, (snap) => {
            aplicarPedidos(
                snap.docs.map(d => ({ ...d.data(), id: d.id }))
                         .filter(p => STATUS_NA_FILA.includes(p.status))
            );
            avisarSeChegouPedido(snap);
        }, (e) => mostrarErroConsulta(e, 'lista-historico'));
        unsubscribes.push(unsub);
    };

    const qComIndice = query(
        tcol("pedidos"),
        where("status", "in", STATUS_NA_FILA),
        orderBy("data", "desc"), limit(LIMITE_FILA)
    );

    const unsubPedidos = onSnapshot(qComIndice, (snap) => {
        aplicarPedidos(snap.docs.map(d => ({ ...d.data(), id: d.id })));
        avisarFilaCheia(snap.size >= LIMITE_FILA);
        avisarSeChegouPedido(snap);
    }, (erro) => {
        console.error('Consulta de pedidos falhou:', erro);
        // failed-precondition é o código que o Firestore usa para "falta índice"
        if (erro?.code === 'failed-precondition') escutarSemIndice(erro);
        else mostrarErroConsulta(erro, 'lista-historico');
    });
    unsubscribes.push(unsubPedidos);

    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (_) { /* navegador sem suporte */ }
};

document.getElementById('admin-busca-input')?.addEventListener('input', (e) => {
    adminBuscaTermo = normalizar(e.target.value);
    renderProdutos();
});

const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const ehFracionavel = (u) => FRACIONAVEIS.includes(String(u || '').toLowerCase());

// ---------------------------------------------------------------------
// LISTA DE PRODUTOS — linhas compactas (cabem 7 ou 8 por tela, antes eram 2).
// Tocar na linha abre o produto; a chave à direita põe e tira da loja.
// Filtros no topo respondem às perguntas do dia: o que está fora? o que está sem foto?
// ---------------------------------------------------------------------
let adminFiltro = 'todos';
const temEstoque = (p) => p.estoqueFisico !== undefined && p.estoqueFisico !== null && p.estoqueFisico !== '';
const FILTROS_PRODUTO = [
    ['todos', 'Todos', () => true],
    ['venda', 'À venda', (p) => p.ativo && !p.soInsumo],
    ['fora', 'Fora da loja', (p) => !p.ativo && !p.soInsumo],
    ['baixo', 'Estoque baixo', (p) => temEstoque(p) && Number(p.estoqueFisico) <= 5],
    ['semfoto', 'Sem foto', (p) => !p.foto && !p.soInsumo],
    ['oferta', 'Em oferta', (p) => Number(p.precoDe) > Number(p.preco)],
    ['insumo', 'Só ingrediente', (p) => p.soInsumo === true],
];
const renderProdutos = () => {
    const daBusca = produtosAtuais.filter(p => !adminBuscaTermo || normalizar(p.nome).includes(adminBuscaTermo) || normalizar(nomeDaCategoria(p.cat)).includes(adminBuscaTermo) || normalizar(p.cat).includes(adminBuscaTermo));
    const filtros = document.getElementById('pl-filtros');
    if (filtros) {
        if (!FILTROS_PRODUTO.some(([k, , f]) => k === adminFiltro && daBusca.some(f))) adminFiltro = 'todos';
        filtros.innerHTML = FILTROS_PRODUTO.map(([k, rot, f]) => { const n = daBusca.filter(f).length; return n || k === 'todos' ? `<button type="button" class="pl-filtro${adminFiltro === k ? ' on' : ''}" data-pl-filtro="${k}" aria-pressed="${adminFiltro === k}">${rot} <i>${n}</i></button>` : ''; }).join('');
    }
    const passa = (FILTROS_PRODUTO.find(([k]) => k === adminFiltro) || FILTROS_PRODUTO[0])[2];
    const lista = daBusca.filter(passa).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    const html = lista.map(p => {
        const avisos = [];
        if (p.soInsumo) avisos.push('<span class="pl-selo">só ingrediente</span>');
        if (Number(p.precoDe) > Number(p.preco)) avisos.push('<span class="pl-selo oferta">oferta</span>');
        else if (p.precosDia && Object.values(p.precosDia).some((v) => Number(v) > 0)) avisos.push('<span class="pl-selo">preço por dia</span>');
        if (temEstoque(p)) { const q = Number(p.estoqueFisico); avisos.push(q <= 0 ? '<span class="pl-selo ruim">estoque zerado</span>' : q <= 5 ? `<span class="pl-selo atencao">restam ${q}</span>` : `<span class="pl-selo">estoque ${q}</span>`); }
        if (!p.foto && !p.soInsumo) avisos.push('<span class="pl-selo atencao">sem foto</span>');
        // sem o peso médio, o cliente não vê estimativa de preço ao pedir "5 unidades" de um produto vendido a peso
        if (ehFracionavel(p.unidade) && !p.pesoMedio && !p.soInsumo) avisos.push('<span class="pl-selo atencao">sem peso médio</span>');
        const cat = nomeDaCategoria(p.cat);
        return `
        <article class="pl-item${p.ativo ? '' : ' fora'}">
            <button type="button" class="pl-abrir" data-action="editar-produto" data-id="${escapeHTML(p.id)}">
                <span class="pl-foto">${/^https:\/\//i.test(String(p.fotoMini || p.foto || '')) ? `<img src="${escapeHTML(p.fotoMini || p.foto)}" loading="lazy" decoding="async" alt="">` : placeholderSVG}</span>
                <span class="pl-txt">
                    <b>${escapeHTML(p.nome)}</b>
                    <span class="pl-sub">${Number(p.preco) > 0 ? `${fmt(p.preco)} / ${escapeHTML(p.unidade || 'un')}` : 'sem preço'}${cat ? ` · ${escapeHTML(cat)}` : ''}${p.ativo ? '' : ' · <em>fora da loja</em>'}</span>
                    ${avisos.length ? `<span class="pl-avisos">${avisos.join('')}</span>` : ''}
                </span>
            </button>
            ${p.soInsumo ? '' : `<button type="button" class="pl-chave" role="switch" aria-checked="${p.ativo ? 'true' : 'false'}" aria-label="${p.ativo ? 'À venda' : 'Fora da loja'}: ${escapeHTML(p.nome)}" data-action="toggle-estoque" data-id="${escapeHTML(p.id)}" data-status="${p.ativo ? 'false' : 'true'}"><i></i></button>`}
        </article>`;
    }).join('');

    document.getElementById('lista-produtos').innerHTML = html || `<p class="pl-vazio">${produtosAtuais.length ? 'Nenhum produto com essa busca.' : 'Nenhum produto cadastrado ainda. Toque em "Novo produto".'}</p>`;
};
document.getElementById('pl-filtros')?.addEventListener('click', (e) => { const b = e.target.closest('[data-pl-filtro]'); if (!b) return; adminFiltro = b.dataset.plFiltro; renderProdutos(); });

// Banco de fotos: escolhe uma foto já enviada, sem galeria nem link.
document.getElementById('btn-banco-fotos')?.addEventListener('click', async () => {
    try {
        (await TELAS.fotos()).abrirBanco((f) => {
            const campo = document.getElementById('edit-foto-url'), previa = document.getElementById('preview-foto-wrapper');
            campo.value = f.url; campo.dataset.bancoUrl = f.url; campo.dataset.bancoMini = f.mini || '';
            document.getElementById('edit-foto').value = '';
            if (previa) { const img = document.createElement('img'); img.src = f.mini || f.url; img.alt = 'Foto escolhida'; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px;'; previa.replaceChildren(img); }
            showToast('Foto escolhida. Toque em "Salvar produto" para ficar valendo.');
        });
    } catch (e) { showToast('Não consegui abrir o banco de fotos. Confira a internet.', true); }
});

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

// Rótulo do preço acompanha a métrica de venda escolhida
const ROTULOS_PRECO = {
    kg: 'Preço por Quilo (R$/kg)',
    un: 'Preço por Unidade (R$/un)',
    'maço': 'Preço por Maço (R$/maço)',
    bdj: 'Preço por Bandeja (R$/bandeja)',
    kit: 'Preço do Kit (R$)'
};

// Mostra/esconde o campo de peso médio conforme a métrica de venda
// Põe a métrica no seletor. Se o produto tem uma métrica que não está na lista
// ("kit", "L", "Kg"...), ela é ACRESCENTADA — antes o seletor ficava vazio e
// salvar gravava unidade "" (produto de quilo virava produto de unidade).
const definirUnidade = (valor) => {
    const sel = document.getElementById('edit-unidade');
    if (!sel) return;
    let v = String(valor || 'un').trim();
    const igual = [...sel.options].find(o => o.value.toLowerCase() === v.toLowerCase());
    if (igual) v = igual.value;
    else sel.add(new Option(v, v));
    sel.value = v;
};

const alternarCampoPesoMedio = () => {
    const grupo = document.getElementById('form-group-peso-medio');
    const unidade = document.getElementById('edit-unidade')?.value;
    if (grupo) grupo.style.display = ehFracionavel(unidade) ? 'block' : 'none';
    // os dois botões do card (unidade e quilo) só existem em produto vendido por quilo
    const gm = document.getElementById('grupo-mostrar-primeiro'); if (gm) gm.hidden = !['kg', 'kilo', 'quilograma'].includes(String(unidade || '').toLowerCase());
    const lbl = document.querySelector('label[for="edit-preco"]');
    if (lbl) lbl.textContent = ROTULOS_PRECO[unidade] || 'Preço (R$)';
};
document.getElementById('edit-unidade')?.addEventListener('change', alternarCampoPesoMedio);

// Formulário de produto EM BRANCO. Usado pelo "novo produto" e pelo kit criado com IA:
// sem isto o kit herdava estoque, preço de oferta e "só ingrediente" do último produto aberto.
const limparFormularioProduto = () => {
    ['edit-id', 'edit-nome', 'edit-preco', 'edit-preco-de', 'edit-cat', 'edit-foto', 'edit-foto-url'].forEach(i => document.getElementById(i).value = '');
    if (document.getElementById('edit-descricao')) document.getElementById('edit-descricao').value = '';
    const est = document.getElementById('edit-estoque-fisico'); if (est) { est.value = ''; est.dataset.aoAbrir = ''; }
    if (document.getElementById('edit-duracao')) document.getElementById('edit-duracao').value = 'normal';
    if (document.getElementById('edit-so-insumo')) document.getElementById('edit-so-insumo').checked = false;
    if (document.getElementById('edit-peso-medio')) document.getElementById('edit-peso-medio').value = '';
    if (document.getElementById('edit-mostrar-primeiro')) document.getElementById('edit-mostrar-primeiro').value = 'un';
    const url = document.getElementById('edit-foto-url'); if (url) { delete url.dataset.bancoUrl; delete url.dataset.bancoMini; }
    definirUnidade('kg');          // produto novo começa sempre em "Quilo" (antes herdava o do último aberto)
    alternarCampoPesoMedio();
    const previa = document.getElementById('preview-foto-wrapper'); if (previa) previa.innerHTML = placeholderSVG;
    document.getElementById('btn-excluir-produto').style.display = 'none';
    { const bp = document.getElementById('btn-post-ia'); if (bp) bp.hidden = true; }
};

const injetarEstoqueUI = () => {
    if (!document.getElementById('edit-estoque-fisico')) {
        const precoRow = document.getElementById('edit-preco')?.closest('.grid-2');
        if (precoRow) {
            precoRow.insertAdjacentHTML('afterend', `
                <div class="form-group-estoque">
                    <label for="edit-estoque-fisico"><i class="ic" data-i="caixa"></i> Quantidade em estoque (opcional)</label>
                    <input type="number" id="edit-estoque-fisico" min="0" placeholder="Em branco = sem controle de estoque">
                    <small style="color:var(--text-light); font-size:0.75rem; display:block; margin-top:4px;">Com um número aqui, o produto sai da loja sozinho quando chegar a zero.</small>
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

// item pedido em unidades de um produto vendido por quilo (continua sendo "de balança" depois de pesado)
const ehItemDeBalanca = (item) => item.aPesar === true || (item.tipo === 'un' && ehFracionavel(item.unidade) && item.pesoFinal > 0);

const valorDoItem = (item) => {
    if (ehItemDeBalanca(item)) {
        return item.pesoFinal > 0 ? item.pesoFinal * (item.precoOriginal || 0) : 0;
    }
    return (item.precoOriginal || 0) * (item.qtd || 0);
};

const totalDaEsteira = () => ESTEIRA.itens.reduce((soma, i) => soma + valorDoItem(i), 0);
// A CONTA que o servidor vai fechar (api/pdv.js, pesagem): itens − cupom + entrega.
// A tela mostrava só a soma dos itens como "Valor exato", e quem salvava sem avisar ficava com o número errado.
const contaDaEsteira = () => {
    const c = (v) => Math.round((Number(v) || 0) * 100);
    const ped = ESTEIRA.pedido || {}, itensC = ESTEIRA.itens.reduce((s, i) => s + c(valorDoItem(i)), 0);
    const pct = ped.cupom ? Math.min(100, Number(ped.cupom.percentual) || 0) : 0;
    const descC = Math.min(itensC, pct > 0 ? Math.round(itensC * pct / 100) : c(ped.cupom && ped.cupom.desconto));
    const ent = ped.entrega || null, liquidoC = itensC - descC;
    const cheiaC = ent ? c(ent.taxaCheia) : 0, gratisC = ent ? c(ent.gratisAcima) : 0;
    const taxaC = pct >= 100 ? 0 : (cheiaC > 0 && !(gratisC > 0 && liquidoC >= gratisC) ? cheiaC : 0);
    return { itens: itensC / 100, desconto: descC / 100, entrega: taxaC / 100, total: (liquidoC + taxaC) / 100, cupom: ped.cupom ? ped.cupom.codigo : '' };
};

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
    if (history.state && history.state.esteira) history.back();
};

// BOTÃO VOLTAR DO CELULAR no painel: fecha o que estiver aberto por cima (confirmação, janela,
// separação de pedido). Antes não acontecia nada e, no toque seguinte, a pessoa saía do painel
// e perdia o que estava digitando.
window.addEventListener('popstate', () => {
    if (document.querySelector('#overlay-confirm.aberto')) { document.getElementById('btn-confirm-cancel')?.click(); return; }
    const abertos = [...document.querySelectorAll('.modal-overlay.aberto')];
    if (abertos.length) { closeModal(abertos[abertos.length - 1].id); return; }
    const palco = document.getElementById('picking-palco');
    if (palco && palco.classList.contains('aberto')) {
        history.pushState({ esteira: true }, '');                       // segura a pessoa na separação até ela confirmar a saída
        document.getElementById('pk-sair')?.click();
    }
});

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
        : `<div class="pk-foto pk-foto-vazia"><i class="ic" data-i="folha"></i></div>`;

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
    const conta = contaDaEsteira(), total = conta.total;
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
                ${conta.desconto > 0 || conta.entrega > 0 ? `<div class="pk-total-linha"><span>Soma dos itens</span><span>${fmt(conta.itens)}</span></div>` : ''}
                ${conta.desconto > 0 ? `<div class="pk-total-linha"><span>Cupom ${escapeHTML(conta.cupom || '')}</span><span>− ${fmt(conta.desconto)}</span></div>` : ''}
                ${conta.entrega > 0 ? `<div class="pk-total-linha"><span>Entrega</span><span>+ ${fmt(conta.entrega)}</span></div>` : ''}
                <div class="pk-total-final"><span>Valor a cobrar</span><strong>${fmt(total)}</strong></div>
            </div>
            <div class="pk-acoes-finais">
                <button class="pk-btn-enviar" id="pk-enviar"><i class="ic" data-i="enviar"></i> Enviar para a cliente</button>
                <button class="pk-btn-secundario" id="pk-reconferir"><i class="ic" data-i="repetir"></i> Reconferir desde o início</button>
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
        return showToast('Digite o peso marcado na balança.', true);
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
    ESTEIRA.pedido = pedido; ESTEIRA.totalFechado = null; ESTEIRA.desconto = 0;
    ESTEIRA.itens = JSON.parse(JSON.stringify(pedido.itens || []));
    ESTEIRA.itens.forEach(i => { if (!i.pesoFinal) i.pesoFinal = 0; });
    ESTEIRA.indice = 0;
    ESTEIRA.conferindo = false;

    document.getElementById('pk-cliente-nome').textContent = pedido.nome || 'Cliente';
    document.getElementById('pk-cliente-end').textContent =
        linhaEndereco(pedido) || 'Endereço não informado';

    if (ESTEIRA.itens.length === 0) return showToast('Este pedido não tem itens.', true);

    document.getElementById('picking-palco').classList.add('aberto');
    if (!(history.state && history.state.esteira)) history.pushState({ esteira: true }, '');   // para o botão voltar do celular não sair do painel no meio da pesagem
    document.body.style.overflow = 'hidden';
    renderEsteira();
};

// =====================================================================
// MENSAGEM PARA A CLIENTE
// Formatada para o WhatsApp: negrito com *asteriscos*, blocos separados
// e um emoji por produto para facilitar a leitura no celular.
// =====================================================================

// Emoji por tipo de produto. A busca é por pedaço do nome já sem acento,
// então "Tomate Saladete" e "tomatinho cereja" caem os dois em 🍅.
const EMOJI_PRODUTO = [
    ['batata doce', '🍠'], ['batata', '🥔'], ['alho', '🧄'], ['cebola', '🧅'],
    ['tomatinho', '🍅'], ['tomate', '🍅'], ['cenoura', '🥕'], ['alface', '🥬'], ['couve', '🥬'],
    ['repolho', '🥬'], ['rucula', '🥬'], ['espinafre', '🥬'], ['agriao', '🥬'],
    ['banana', '🍌'], ['maca', '🍎'], ['laranja', '🍊'], ['tangerina', '🍊'],
    ['mexerica', '🍊'], ['limao', '🍋'], ['uva', '🍇'], ['morango', '🍓'],
    ['melancia', '🍉'], ['melao', '🍈'], ['abacaxi', '🍍'], ['manga', '🥭'],
    ['abacate', '🥑'], ['pepino', '🥒'], ['pimentao', '🫑'], ['pimenta', '🌶️'],
    ['milho', '🌽'], ['brocolis', '🥦'], ['couve-flor', '🥦'], ['berinjela', '🍆'],
    ['cogumelo', '🍄'], ['champignon', '🍄'], ['ovo', '🥚'], ['coco', '🥥'],
    ['pera', '🍐'], ['pessego', '🍑'], ['ameixa', '🍑'], ['cereja', '🍒'],
    ['kiwi', '🥝'], ['abobora', '🎃'], ['moranga', '🎃'], ['gengibre', '🫚'],
    ['salsa', '🌿'], ['cheiro verde', '🌿'], ['coentro', '🌿'], ['manjericao', '🌿'],
    ['hortela', '🌿'], ['cebolinha', '🌿'], ['feijao', '🫘'], ['ervilha', '🫛'],
    ['vagem', '🫛'], ['mandioca', '🥔'], ['inhame', '🥔'], ['beterraba', '🥬'],
    ['chuchu', '🥒'], ['quiabo', '🥒'], ['maracuja', '🍈'], ['goiaba', '🍈'],
    ['mamao', '🧡'], ['acerola', '🍒'], ['kit', '🧺'], ['cesta', '🧺']
];

const emojiDoProduto = (nome) => {
    const limpo = String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const achou = EMOJI_PRODUTO.find(([chave]) => limpo.includes(chave));
    return achou ? achou[1] : '🥬';
};

// "said" -> "Said" | "maria clara" -> "Maria"
const primeiroNomeBonito = (nomeCompleto) => {
    const primeiro = String(nomeCompleto || '').trim().split(/\s+/)[0] || '';
    return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
};

const kgBonito = (valor) => String(valor).replace('.', ',');

const montarMensagemCliente = () => {
    const p = ESTEIRA.pedido;
    const risco = '━━━━━━━━━━━━━━';
    const L = [];

    L.push(`${ehLojaOriginal ? '🥬 ' : ''}*${nomeDaLoja}*`);          // cada loja assina com o próprio nome
    L.push('');
    L.push(`Olá, ${primeiroNomeBonito(p.nome)}! 👋`);
    L.push('');
    L.push('Seu pedido já foi separado e pesado com sucesso.');
    L.push('');
    L.push(risco);
    L.push('📦 *ITENS DO PEDIDO*');
    L.push('');

    ESTEIRA.itens.forEach(item => {
        const unid = String(item.unidade || '').toLowerCase();
        const porPeso = ['kg', 'g', 'grama', 'quilo', 'l', 'litro'].includes(unid);

        L.push(`${emojiDoProduto(item.nome)} *${item.nome}*`);

        if (ehItemDeBalanca(item)) {
            // Pediu por unidade, mas foi para a balança: mostra os dois dados
            L.push(`• Quantidade: ${item.qtd} un`);
            L.push(`• Peso: ${kgBonito(item.pesoFinal)} kg`);
        } else if (porPeso) {
            L.push(`• Peso: ${kgBonito(item.qtd)} ${unid}`);
        } else {
            L.push(`• Quantidade: ${item.qtd}`);
        }

        L.push(`• Valor: ${fmt(valorDoItem(item))}`);
        L.push('');
    });

    L.push(risco);
    if (ESTEIRA.desconto > 0) L.push(`🎁 Desconto do cupom: -${fmt(ESTEIRA.desconto)}`);
    if (ESTEIRA.entrega > 0) L.push(`🛵 Entrega: ${fmt(ESTEIRA.entrega)}`);
    if (p.entrega?.horario) L.push(`🕒 Entrega: ${p.entrega.horario}`);
    else if (p.entrega?.horarioACombinar) L.push('🕒 Entrega: horário a combinar');
    L.push(`💰 *Total: ${fmt(ESTEIRA.totalFechado ?? contaDaEsteira().total)}*`);
    L.push('');
    L.push(`💳 Pagamento: ${p.pag || 'a combinar'}`);

    if (p.troco) {
        L.push(`💵 Troco para: ${p.troco}`);
    }

    L.push('');
    L.push('📍 *Endereço de entrega:*');
    L.push(linhaEndereco(p));

    if (p.obs) {
        L.push('');
        L.push(`📝 *Observação:* ${p.obs}`);
    }

    L.push('');
    L.push('🌱 Obrigado pela preferência!');
    L.push('Qualquer dúvida ou alteração, é só chamar.');

    return L.join('\n');
};

const finalizarEsteira = async (btn, enviarWhats) => {
    const textoOriginal = btn.textContent;
    btn.disabled = true; btn.textContent = 'Salvando...';

    try {
        // Quem fecha a conta é o servidor (/api/pdv): ele calcula o valor pelo peso,
        // mantém o desconto do cupom e baixa do estoque o que foi pesado.
        const token = await auth.currentUser?.getIdToken();
        const resp = await fetch('/api/pdv', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ acao: 'pesagem', pedidoId: ESTEIRA.pedido.id, pesos: ESTEIRA.itens.map((i, idx) => ({ i: idx, peso: i.pesoFinal })).filter(x => x.peso > 0) })
        });
        const fechado = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(fechado.error || 'Erro ao salvar o pedido.');
        ESTEIRA.totalFechado = fechado.total; ESTEIRA.desconto = fechado.desconto || 0; ESTEIRA.entrega = fechado.entrega || 0;

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
            window.open(url, '_blank', 'noopener');
            if (!fone) showToast('Texto copiado — escolha a conversa da cliente.', false);
        } else {
            showToast('Pedido salvo com os valores exatos.');
        }

        fecharEsteira();
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Erro ao salvar o pedido.', true);
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
            document.getElementById('modal-titulo').textContent = 'Novo produto';
            limparFormularioProduto();
            document.getElementById('btn-excluir-produto').style.display = 'none';
            openModal('modal-produto');
        }

        else if (action === 'editar-produto') {
            injetarEstoqueUI();
            const p = produtosAtuais.find(x => x.id === target.dataset.id);
            if (!p) return;
            document.getElementById('modal-titulo').textContent = 'Editar produto';
            document.getElementById('edit-id').value = p.id;
            document.getElementById('edit-nome').value = p.nome;
            document.getElementById('edit-preco').value = p.preco;
            document.getElementById('edit-preco-de').value = Number(p.precoDe) > Number(p.preco) ? p.precoDe : '';
            definirUnidade(p.unidade || 'un');
            document.getElementById('edit-cat').value = nomeDaCategoria(p.cat);   // mostra o NOME da categoria; a chave é resolvida ao salvar
            document.getElementById('edit-foto').value = '';
            document.getElementById('edit-foto-url').value = '';

            if (document.getElementById('edit-descricao')) document.getElementById('edit-descricao').value = p.descricao || '';
            // guarda o estoque MOSTRADO ao abrir: se alguém vender enquanto a janela está aberta, gravar o produto não pode devolver o número velho
            { const est = document.getElementById('edit-estoque-fisico'); if (est) { est.value = p.estoqueFisico !== undefined && p.estoqueFisico !== null ? p.estoqueFisico : ''; est.dataset.aoAbrir = String(est.value); } }
            if (document.getElementById('edit-peso-medio')) document.getElementById('edit-peso-medio').value = p.pesoMedio || '';
            if (document.getElementById('edit-mostrar-primeiro')) document.getElementById('edit-mostrar-primeiro').value = p.mostrarPrimeiro === 'kg' ? 'kg' : 'un';
            if (document.getElementById('edit-duracao')) document.getElementById('edit-duracao').value = ['curta', 'longa'].includes(p.duracao) ? p.duracao : 'normal';
            if (document.getElementById('edit-so-insumo')) document.getElementById('edit-so-insumo').checked = p.soInsumo === true;
            alternarCampoPesoMedio();

            const previewContainer = document.getElementById('preview-foto-wrapper');
            if (previewContainer) previewContainer.innerHTML = p.foto ? `<img src="${escapeHTML(p.foto)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" alt="${escapeHTML(p.nome)}">` : placeholderSVG;

            document.getElementById('btn-excluir-produto').style.display = 'block';
            { const bp = document.getElementById('btn-post-ia'); if (bp) { bp.hidden = !ehGestor(papelAtual); bp.dataset.id = p.id; } }
            openModal('modal-produto');
        }

        else if (action === 'gerar-post') {
            const p = produtosAtuais.find(x => x.id === target.dataset.id);
            if (!p) return;
            const originHtml = target.innerHTML;
            target.innerHTML = "<i class='ic' data-i='espera'></i>"; target.disabled = true;
            try {
                const res = await fetch('/api/assistente', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'social_post', produtoInfo: { nome: p.nome, cat: p.cat, preco: p.preco } })
                });
                const data = await res.json();
                if (!data.sucesso) throw new Error("Falha na IA");

                // Substitui o alert() por um modal legível e copiável
                mostrarTextoGerado('Post gerado pela IA', data.post);
                try { await navigator.clipboard.writeText(data.post); showToast("Texto copiado!"); } catch (_) {}
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
                const confirmado = await customConfirm("Tirar da loja?", "Os clientes não vão ver este produto até você tocar em Voltar a vender.");
                if (!confirmado) return;
            }
            await setDoc(tdoc("produtos", id), { ativo: novoStatus, ultimaModificacao: Date.now() }, { merge: true });
            showToast(novoStatus ? "Produto de volta na loja." : "Produto fora da loja.");
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
            await setDoc(tdoc("pedidos", id), { status: nextStatus }, { merge: true });
            showToast(`Pedido movido para: ${nextStatus.toUpperCase()}`);
        }

        else if (action === 'toggle-cupom') {
            const codigo = target.dataset.id;
            const atual = cuponsAtuais.find(c => c.codigo === codigo);
            const ligar = atual?.ativo === false;
            target.disabled = true;
            await setDoc(tdoc('cupons', codigo), { ativo: ligar }, { merge: true });
            showToast(ligar ? `Cupom ${codigo} ligado` : `Cupom ${codigo} desligado`);
        }

        else if (action === 'excluir-cupom') {
            const codigo = target.dataset.id;
            if (await customConfirm(
                `Excluir o cupom ${codigo}?`,
                'Quem já usou continua com o desconto no pedido. Novos pedidos não vão mais aceitar este código.'
            )) {
                await deleteDoc(tdoc('cupons', codigo));
                showToast(`Cupom ${codigo} excluído`);
            }
        }

        else if (action === 'imprimir-pedido') {
            const pedido = pedidosGerais.find(p => p.id === target.dataset.id);
            if (!pedido) return showToast("Pedido não encontrado", true);
            target.disabled = true;
            await comImpressao((m) => m.imprimirPedido(pedido, target.dataset.tipo));
            target.disabled = false;
        }

        else if (action === 'cancelar-pedido-painel') {
            const pedido = pedidosGerais.find(p => p.id === target.dataset.id);
            if (!pedido) return showToast("Pedido não encontrado", true);
            const pago = pedido.pagamento?.status === 'PAID';
            if (!(await customConfirm(`Cancelar o pedido de ${pedido.nome || 'cliente'}?`,
                'O estoque baixado por este pedido volta para a prateleira e a venda sai do caixa do dia.'
                + (pago ? ' ATENÇÃO: este pedido já foi pago. O dinheiro NÃO é devolvido sozinho: devolva o PIX ao cliente.' : ''), { ok: 'Cancelar o pedido', nao: 'Voltar' }))) return;
            target.disabled = true;
            try {
                const token = await auth.currentUser?.getIdToken();
                const r = await fetch('/api/cancelar-pedido', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ pedidoId: pedido.id }) });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(d.error || 'Não foi possível cancelar.');
                showToast(d.jaEstava ? 'Este pedido já estava cancelado.' : (d.estavaPago ? 'Pedido cancelado. Lembre de devolver o PIX ao cliente.' : 'Pedido cancelado e estoque devolvido.'));
            } catch (e) { showToast(e.message, true); target.disabled = false; }
        }

        else if (action === 'excluir-pedido') {
            const id = target.dataset.id;
            if (await customConfirm("Concluir e Arquivar", "Deseja finalizar este pedido e retirá-lo da logística visual? (Os dados financeiros serão mantidos).")) {
                await setDoc(tdoc("pedidos", id), { status: 'arquivado' }, { merge: true });
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
                        <button class="btn btn-primary w-100" id="btn-copiar-texto-ia"><i class="ic" data-i="prancheta"></i> Copiar texto</button>
                    </footer>
                </div>
            </div>`);
        document.getElementById('modal-texto-ia').querySelector('[data-fechar]')
            .addEventListener('click', () => closeModal('modal-texto-ia'));
        document.getElementById('btn-copiar-texto-ia').addEventListener('click', async () => {
            const campo = document.getElementById('texto-ia-conteudo');
            try { await navigator.clipboard.writeText(campo.value); showToast("Copiado!"); }
            catch (_) { campo.select(); document.execCommand('copy'); showToast("Copiado!"); }
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
                    Descrição
                    <button type="button" id="btn-ia-descricao" class="btn-ia-action"><i class="ic" data-i="faisca"></i> Escrever com IA</button>
                </label>
                <textarea id="edit-descricao" rows="3" placeholder="O que o cliente lê ao abrir o produto. Pode deixar em branco." style="resize: vertical;"></textarea>
            </div>
        `);

        document.getElementById('btn-ia-descricao').addEventListener('click', async (e) => {
            const nome = document.getElementById('edit-nome').value;
            const cat = document.getElementById('edit-cat').value;
            if (!nome || !cat) return showToast("Preencha Nome e Categoria primeiro.", true);
            const btn = e.currentTarget; const originText = btn.innerHTML;
            btn.innerHTML = "Escrevendo... <i class='ic' data-i='espera'></i>"; btn.disabled = true;
            try {
                const res = await fetch('/api/assistente', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'gerar_descricao', produtoInfo: { nome, cat } })
                });
                const data = await res.json();
                if (!data.sucesso) throw new Error(data.error);
                document.getElementById('edit-descricao').value = data.descricao;
                showToast("Descrição de Alta Conversão gerada!");
            } catch (err) { showToast("Falha na geração via IA.", true); }
            finally { btn.innerHTML = originText; btn.disabled = false; }
        });
    }

    const dashboardControls = document.getElementById('kit-ia-lugar');
    if (dashboardControls && !document.getElementById('btn-ia-kit')) {
        dashboardControls.insertAdjacentHTML('beforeend', `
<button id="btn-ia-kit" class="bt bt-sec"><i class="ic" data-i="faisca"></i> Sugerir kit com IA</button>
        `);

        document.getElementById('btn-ia-kit').addEventListener('click', async (e) => {
            if (produtosAtuais.length < 5) return showToast("Precisa de mais produtos no catálogo.", true);
            const btn = e.currentTarget; const originText = btn.innerHTML;
            btn.innerHTML = "<i class='ic' data-i='espera'></i> Criando..."; btn.disabled = true;
            try {
                const res = await fetch('/api/assistente', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'gerar_kit' })
                });
                const data = await res.json();
                if (!data.sucesso) throw new Error(data.error);

                injetarEstoqueUI();
                limparFormularioProduto();
                document.getElementById('modal-titulo').textContent = '' + data.kit.nome;
                document.getElementById('edit-id').value = ''; document.getElementById('edit-nome').value = data.kit.nome;
                document.getElementById('edit-preco').value = data.kit.preco;
                document.getElementById('edit-cat').value = 'Kits Inteligentes';
                definirUnidade('kit');
                alternarCampoPesoMedio();
                if (document.getElementById('edit-descricao')) document.getElementById('edit-descricao').value = `${data.kit.descricao}\n\nO que inclui:\n${data.kit.itensInclusos}`;
                openModal('modal-produto');
                showToast("Kit formulado! Ajuste o preço e guarde.");
            } catch (err) { showToast("Falha ao montar kit.", true); }
            finally { btn.innerHTML = originText; btn.disabled = false; }
        });
    }
};

document.getElementById('btn-salvar-produto').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-produto');
    btn.textContent = "A guardar..."; btn.disabled = true;

    try {
        const idExistente = document.getElementById('edit-id').value;
        const id = idExistente || (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
        const antigo = idExistente ? produtosAtuais.find(x => x.id === idExistente) : null;
        const rawEstoque = document.getElementById('edit-estoque-fisico') ? document.getElementById('edit-estoque-fisico').value : '';
        const estoqueFinal = rawEstoque === '' ? null : parseFloat(rawEstoque);

        const rawPeso = document.getElementById('edit-peso-medio') ? document.getElementById('edit-peso-medio').value : '';
        const pesoMedioFinal = rawPeso === '' ? null : parseFloat(rawPeso);

        const pData = {
            nome: document.getElementById('edit-nome').value.trim(),
            preco: parseFloat(document.getElementById('edit-preco').value),
            precoDe: precoDeValido(document.getElementById('edit-preco-de').value, parseFloat(document.getElementById('edit-preco').value)),   // preço antigo (oferta) ou null
            unidade: document.getElementById('edit-unidade').value,
            // aceita o nome que aparece na loja OU a chave; grava sempre a chave da categoria cadastrada
            cat: chaveDaCategoria(document.getElementById('edit-cat').value).toLowerCase(),
            descricao: document.getElementById('edit-descricao') ? document.getElementById('edit-descricao').value.trim() : '',
            pesoMedio: pesoMedioFinal, // gramas por unidade — alimenta a estimativa na loja
            mostrarPrimeiro: document.getElementById('edit-mostrar-primeiro')?.value === 'kg' ? 'kg' : 'un',   // qual botão vem em cima no card (unidade ou quilo)
            duracao: document.getElementById('edit-duracao')?.value || 'normal',   // folga da sugestão de compra (motor)
            soInsumo: !!document.getElementById('edit-so-insumo')?.checked,        // ingrediente de receita: fora da loja
            // Sem controle de estoque: mantém o que estava. Antes, editar um produto
            // marcado como "Esgotado" o colocava de volta à venda sem ninguém pedir.
            ativo: antigo ? antigo.ativo !== false : true,
            ultimaModificacao: Date.now()
        };

        if (!pData.nome) throw new Error("Preencha o nome do produto.");
        if (!pData.unidade) throw new Error("Escolha a métrica de venda (quilo, unidade...).");
        if (!pData.cat) throw new Error("Escolha a categoria do produto.");
        if (pData.soInsumo && !(pData.preco > 0)) pData.preco = 0;
        else if (isNaN(pData.preco) || pData.preco <= 0) throw new Error("Informe um preço válido.");

        const fileInput = document.getElementById('edit-foto');
        const urlInput = document.getElementById('edit-foto-url').value.trim();

        if (fileInput.files.length > 0) {
            showToast("A otimizar imagem...", false);
            // mesmo caminho do envio de várias fotos: reduz, converte para WebP e envia
            Object.assign(pData, await (await TELAS.fotos()).enviarFotos(id, fileInput.files[0]));   // foto grande + miniatura
        }
        else if (urlInput) {
            if (!urlInput.startsWith('https://')) throw new Error("A URL da foto precisa começar com https://");
            const campoUrl = document.getElementById('edit-foto-url');      // foto vinda do banco de fotos traz a miniatura junto
            pData.foto = urlInput; pData.fotoMini = campoUrl.dataset.bancoUrl === urlInput && campoUrl.dataset.bancoMini ? campoUrl.dataset.bancoMini : null;
        }
        else if (document.getElementById('edit-id').value) {
            const pAntigo = produtosAtuais.find(x => x.id === id);
            if (pAntigo && pAntigo.foto) pData.foto = pAntigo.foto;
        }

        // ESTOQUE: a quantidade não é mais gravada direto aqui. Campo vazio = sem controle.
        // Número diferente do atual = contagem, que passa pelo servidor e entra no histórico.
        const estoqueAntes = antigo && antigo.estoqueFisico !== undefined && antigo.estoqueFisico !== '' ? antigo.estoqueFisico : null;
        if (estoqueFinal !== null && (!Number.isFinite(estoqueFinal) || estoqueFinal < 0)) throw new Error("A quantidade em estoque precisa ser zero ou maior.");
        const campoEst = document.getElementById('edit-estoque-fisico');
        const mexeuNoEstoque = !campoEst || campoEst.dataset.aoAbrir === undefined || String(campoEst.value).trim() !== String(campoEst.dataset.aoAbrir).trim();   // só conta se a pessoa mudou o número
        if (estoqueFinal === null && estoqueAntes !== null && mexeuNoEstoque) pData.estoqueFisico = null;

        await setDoc(tdoc("produtos", id), pData, { merge: true });
        if (estoqueFinal !== null && mexeuNoEstoque && estoqueFinal !== estoqueAntes) {
            try { await (await TELAS.estoque()).contarEstoque(id, estoqueFinal, 'Alterado no cadastro do produto'); }
            catch (e) { throw new Error(`Produto guardado, mas o estoque não mudou: ${e.message}`); }
        }
        closeModal('modal-produto'); showToast("Produto guardado com sucesso!");
    } catch (erro) {
        showToast(erro.message || "Erro ao guardar o produto.", true);
    } finally {
        btn.textContent = "Salvar produto"; btn.disabled = false;
    }
});

document.getElementById('btn-precos-dia')?.addEventListener('click', async () => {
    try { (await TELAS.precosDia()).abrirPrecosDia(produtosAtuais); } catch (e) { console.error(e); showToast('Não consegui abrir os preços por dia. Confira a internet e toque de novo.', true); }
});
document.getElementById('btn-varias-fotos')?.addEventListener('click', async () => {
    try { (await TELAS.fotos()).abrirFotos(produtosAtuais); } catch (e) { showToast('Não consegui abrir. Confira a internet.', true); }
});

document.getElementById('btn-excluir-produto').addEventListener('click', async () => {
    if (await customConfirm("Apagar este produto?", "Ele some da loja e do painel. Não dá para desfazer.", { ok: "Apagar", nao: "Não apagar" })) {
        await deleteDoc(tdoc("produtos", document.getElementById('edit-id').value));
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
        'pendente':             { tag: '<i class="ic" data-i="sino"></i> NOVO',        cor: 'var(--forest)',  btn: 'Aceitar e separar',      proximo: 'preparando' },
        'aguardando_pagamento': { tag: '<i class="ic" data-i="pix"></i> AGUARDA PIX', cor: 'var(--info)',    btn: 'Recebi o PIX',   proximo: 'preparando' },
        'aguardando_pesagem':   { tag: '<i class="ic" data-i="balanca"></i> A PESAR',     cor: 'var(--earth)',   btn: 'Pesar os itens', proximo: null },
        'preparando':           { tag: '<i class="ic" data-i="caixa"></i> SEPARANDO',  cor: 'var(--earth)', btn: 'Saiu para entrega',     proximo: 'enviado' },
        'enviado':              { tag: '<i class="ic" data-i="entrega"></i> A CAMINHO',   cor: 'var(--leaf)',    btn: 'Entregue',    proximo: 'arquivado' }
    };

    let colNovos = '', colPrep = '', colEnv = '';
    let nNovos = 0, nPrep = 0, nEnv = 0;

    const termo = pedidoBuscaTermo;
    const filtrados = termo
        ? pedidos.filter(p => normalizar(p.nome).includes(termo) || normalizar(p.quadra).includes(termo) || String(p.lote || '').includes(termo) || normalizar(p.condominio).includes(termo))
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
        const infoEntrega = p.entrega && (p.entrega.horario || p.entrega.horarioACombinar || Number(p.entrega.taxa) > 0)
            ? `<div style="font-size:0.82rem;color:var(--forest);margin-top:4px;font-weight:600;"><i class="ic" data-i="entrega"></i> ${escapeHTML([p.entrega.horario || (p.entrega.horarioACombinar ? 'horário a combinar' : ''), Number(p.entrega.taxa) > 0 ? `entrega ${fmt(p.entrega.taxa)}` : ''].filter(Boolean).join(' · '))}</div>` : '';
        const infoTroco = p.troco ? `<div style="font-size:0.82rem;color:var(--earth);margin-top:4px;"><i class="ic" data-i="dinheiro"></i> Troco para: ${escapeHTML(p.troco)}</div>` : '';
        // pedido para outro dia (cliente da feira pediu fora do dia da feira) e feira cancelada nesse dia
        const ehFuturo = p.entregaDia && p.entregaDia !== diaBR(p.data);
        const cancelada = p.feiraId && p.entregaDia && (SEM_FEIRA.get(p.feiraId) || new Set()).has(p.entregaDia);
        const infoDia = ehFuturo || cancelada ? `<div class="ped-para-dia${cancelada ? ' cancelada' : ''}"><i class="ic" data-i="calendario"></i> Para ${escapeHTML(textoDoDia(p.entregaDia))}${cancelada ? ' · <b>feira cancelada neste dia: avise o cliente</b>' : ''}</div>` : '';
        const infoObs = p.obs ? `<div style="font-size:0.82rem;color:var(--text-mid);margin-top:4px;font-style:italic;"><i class="ic" data-i="nota"></i> ${escapeHTML(p.obs)}</div>` : '';

        const cardHtml = `
        <article class="card-pedido" style="border-left: 5px solid ${st.cor}; background: var(--warm-white); border-radius: 8px; padding: 15px; margin-bottom: 15px; border-right: 1px solid var(--parchment); border-top: 1px solid var(--parchment); border-bottom: 1px solid var(--parchment);">
            <div style="display:flex; justify-content: space-between; gap:8px; margin-bottom: 5px;">
                <h3 style="font-size: 1.1rem; color: var(--forest); margin: 0;">${escapeHTML(p.nome)}</h3>
                <strong style="font-size: 1.1rem; white-space:nowrap;">${fmt(p.total || 0)}</strong>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-mid); margin-bottom: 8px;"><i class="ic" data-i="pino"></i> ${escapeHTML(linhaEndereco(p, { curto: true }))} • ${escapeHTML(p.pag || '')}</p>
            <div style="margin-bottom: 10px; font-size: 0.8rem; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="background: ${st.cor}; color: white; padding: 3px 8px; border-radius: 12px; font-weight: bold;">${st.tag}</span>
                ${infoPag}
                <span><i class="ic" data-i="calendario"></i> ${dataFmt}</span>
            </div>
            ${infoDia}
            <div style="font-size: 0.9rem; color: var(--text-dark); margin-bottom: 12px; background: white; padding: 10px; border-radius: 6px; border: 1px solid #eee;">
                • ${itensStr}
                ${infoEntrega}
                ${p.avaliacao && p.avaliacao.nota ? `<p class="pedido-avaliacao${p.avaliacao.nota <= 3 ? ' baixa' : ''}"><b>Nota ${Number(p.avaliacao.nota)} de 5</b> ${p.avaliacao.texto ? escapeHTML(p.avaliacao.texto) : 'sem comentário'}</p>` : ''}
                ${infoTroco}
                ${infoObs}
            </div>
            <div style="display: flex; gap: 8px;">${botao}</div>
            <div class="ped-imprimir">
                <button type="button" data-action="imprimir-pedido" data-tipo="cupom" data-id="${escapeHTML(p.id)}"><i class="ic" data-i="impressora"></i> Cupom</button>
                <button type="button" data-action="imprimir-pedido" data-tipo="etiqueta" data-id="${escapeHTML(p.id)}"><i class="ic" data-i="etiqueta"></i> Etiqueta da sacola</button>
                <button type="button" class="ped-cancelar" data-action="cancelar-pedido-painel" data-id="${escapeHTML(p.id)}"><i class="ic" data-i="lixeira"></i> Cancelar pedido</button>
            </div>
        </article>`;

        if (['pendente', 'aguardando_pesagem', 'aguardando_pagamento'].includes(stKey)) { colNovos += cardHtml; nNovos++; }
        else if (stKey === 'preparando') { colPrep += cardHtml; nPrep++; }
        else if (stKey === 'enviado') { colEnv += cardHtml; nEnv++; }
    });

    // No celular aparece UMA etapa por vez, escolhida nas abas (antes as três ficavam empilhadas e o
    // pedido novo se perdia lá embaixo). No computador as três colunas ficam lado a lado.
    const etapas = [['novos', 'Novos', colNovos, nNovos, 'Nenhum pedido novo.'], ['prep', 'Separando', colPrep, nPrep, 'Nada sendo separado.'], ['env', 'Enviados', colEnv, nEnv, 'Nenhum pedido a caminho.']];
    if (!etapas.some(([k, , , n]) => k === kbEtapa && n > 0)) kbEtapa = (etapas.find(([, , , n]) => n > 0) || etapas[0])[0];
    return `
    <div class="kb-abas" role="tablist" aria-label="Etapa do pedido">
        ${etapas.map(([k, rot, , n]) => `<button type="button" class="kb-aba${kbEtapa === k ? ' on' : ''}${n ? ' tem' : ''}" role="tab" aria-selected="${kbEtapa === k}" data-kb="${k}">${rot} <i>${n}</i></button>`).join('')}
    </div>
    <div class="kb">
        ${etapas.map(([k, rot, html, n, vazio]) => `<div class="kb-col" data-kb-col="${k}"${kbEtapa === k ? '' : ' hidden'}><h3>${rot} <i>${n}</i></h3>${html || `<p class="kb-vazio">${vazio}</p>`}</div>`).join('')}
    </div>`;
};
let kbEtapa = 'novos';
document.getElementById('lista-historico')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kb]'); if (!b) return;
    kbEtapa = b.dataset.kb;
    document.querySelectorAll('#lista-historico .kb-aba').forEach((x) => { const on = x.dataset.kb === kbEtapa; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('#lista-historico .kb-col').forEach((c) => { c.hidden = c.dataset.kbCol !== kbEtapa; });
});

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
                <button id="btn-gerar-relatorio-ia" class="btn-ia-action"><i class="ic" data-i="faisca"></i> Pedir Relatório de Previsão de Demanda à IA</button>
            </div>
            <div id="container-relatorio-ia"></div>
        `);

        document.getElementById('btn-gerar-relatorio-ia').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.innerHTML = "A analisar cruzamento de dados... <i class='ic' data-i='espera'></i>"; btn.disabled = true;

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
                            <span style="font-size:1.5rem"><i class="ic" data-i="barras"></i></span>
                            <h3 style="margin:0;">Insight Logístico da Inteligência Artificial</h3>
                        </div>
                        <p style="color:var(--text-light); font-size:0.8rem; margin-bottom:16px;">Análise em Tempo Real • Baseado nas vendas faturadas</p>
                        ${htmlSimples(data.relatorio)}
                    </div>
                `;
            } catch (e) {
                showToast("A IA não conseguiu gerar o relatório de momento.", true);
            } finally {
                btn.innerHTML = "<i class='ic' data-i='faisca'></i> Atualizar Previsão de Demanda"; btn.disabled = false;
            }
        });
    }
};

const renderRelatoriosMaster = async () => {
    const listDiv = document.getElementById('lista-historico');
    if (pedidosGerais.length === 0) {
        listDiv.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-light);">
                <div style="font-size:2.5rem; margin-bottom:10px;"><i class="ic" data-i="vazio"></i></div>
                <p style="font-weight:700; color:var(--text-mid); font-size:1.05rem;">Nenhum pedido na fila</p>
                <p style="font-size:.88rem; margin-top:6px; line-height:1.6;">
                    Só aparecem aqui pedidos em andamento.<br>
                    Os já concluídos ficam em <b>Balanço</b>.
                </p>
            </div>`;
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
                    <h3><i class="ic" data-i="barras"></i> Valor dos pedidos em andamento, por dia</h3>
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
// O Excel em português separa colunas por ";". Com vírgula, tudo caía numa coluna só.
const CSV_SEP = ';';
const baixarCsv = (csv, nome) => {
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = nome; link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    // Soltar a URL na hora cancelava o download em alguns Androids
    setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 4000);
};
// Dia do pedido no horário de Brasília (pedido das 22h não pula para o dia seguinte)
const diaBR = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t - 3 * 3600000).toISOString().slice(0, 10) : ''; };
const dataHoraBR = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : String(iso || ''); };

// csvCampo vem de js/html-lib.js (aspas + trava contra texto que vira fórmula na planilha)

document.getElementById('btn-exportar').addEventListener('click', () => {
    if (pedidosGerais.length === 0) return showToast("Não há pedidos para exportar.", true);
    let csv = ['Data', 'Entrega', 'Cliente', 'Condomínio', 'Quadra/Rua', 'Lote/Número', 'Status', 'Pagamento', 'Total', 'Itens'].join(CSV_SEP) + "\n";
    pedidosGerais.forEach(p => {
        const itensTxt = p.itens ? p.itens.map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${i.nome}`).join(' | ') : '';
        const total = (Number(p.total) || 0).toFixed(2).replace('.', ',');
        csv += [dataHoraBR(p.data), p.entregaDia || '', p.nome, p.condominio || '', p.quadra, p.lote, p.status, p.pag, total, itensTxt].map(csvCampo).join(CSV_SEP) + "\n";
    });
    baixarCsv(csv, `Vendas_Logistica_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`);
    showToast('Planilha gerada. Veja em Downloads.');
});

document.getElementById('btn-limpar-hist').addEventListener('click', async () => {
    if (pedidosGerais.length === 0) return;
    // só o que está NA TELA: com uma busca digitada, os pedidos escondidos por ela não são arquivados
    const termo = pedidoBuscaTermo;
    const alvo = termo ? pedidosGerais.filter(p => normalizar(p.nome).includes(termo) || normalizar(p.quadra).includes(termo) || String(p.lote || '').includes(termo) || normalizar(p.condominio).includes(termo)) : pedidosGerais;
    if (!alvo.length) return showToast('Nenhum pedido na tela para arquivar.', true);
    const abertos = alvo.filter(p => ['pendente', 'aguardando_pesagem', 'aguardando_pagamento'].includes(p.status)).length;
    if (await customConfirm("Limpeza de Final de Expediente", `Arquivar ${alvo.length} pedido(s)${termo ? ' que aparecem na busca' : ''}?${abertos ? ` Atenção: ${abertos} ainda não foi(ram) separado(s).` : ''}`)) {
        try {
            for (let i = 0; i < alvo.length; i += 400) {                 // o banco aceita até 500 gravações por lote
                const batch = writeBatch(db);
                alvo.slice(i, i + 400).forEach(p => batch.update(tdoc("pedidos", p.id), { status: 'arquivado' }));
                await batch.commit();
            }
            showToast("Expediente finalizado. Pedidos arquivados.");
        } catch (error) {
            console.error(error); showToast("Erro ao processar lote.", true);
        }
    }
});



// =====================================================================
// CUPONS DE DESCONTO
//
// Substituem o cupom que antes estava fixo no código do servidor
// ('IA-DESCONTO-10'), que dava 10% para sempre, sem validade e sem limite —
// e que não aparecia em tela nenhuma, então só era alcançável por quem
// chamasse a API por fora do site.
//
// Agora cada cupom é um documento em "cupons", com o código como ID.
// Quem valida é o /api/checkout: o navegador não tem permissão de ler esta
// coleção, justamente para ninguém conseguir listar todos os códigos.
// =====================================================================
let cuponsAtuais = [];

const iniciarCupons = () => {
    const unsub = onSnapshot(tcol('cupons'), (snap) => {
        cuponsAtuais = snap.docs.map(d => ({ ...d.data(), codigo: d.id }));
        renderCupons();
    }, (e) => {
        console.error('cupons:', e);
        const alvo = document.getElementById('lista-cupons');
        if (alvo) alvo.innerHTML = '<p style="color:var(--text-light)">Não consegui carregar os cupons.</p>';
    });
    unsubscribes.push(unsub);
};

const cupomVencido = (c) => {
    if (!c.validoAte) return false;
    // Mesma regra de fuso usada no servidor (checkout.js), para o painel não
    // dizer "VENCIDO" enquanto o cupom ainda funciona de verdade.
    const limite = new Date(`${c.validoAte}T23:59:59-03:00`);
    if (isNaN(limite)) return false;
    return new Date() > limite;
};

const renderCupons = () => {
    const alvo = document.getElementById('lista-cupons');
    if (!alvo) return;

    if (cuponsAtuais.length === 0) {
        alvo.innerHTML = `
            <div style="text-align:center; padding:30px 20px; color:var(--text-light);">
                <div style="font-size:2rem; margin-bottom:8px;"><i class="ic" data-i="cupom"></i></div>
                <p style="font-weight:700; color:var(--text-mid);">Nenhum cupom criado</p>
                <p style="font-size:.86rem; margin-top:6px;">Crie um acima para começar a oferecer desconto.</p>
            </div>`;
        return;
    }

    alvo.innerHTML = cuponsAtuais
        .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
        .map(c => {
            const usos = Number(c.usos || 0);
            const limite = (c.limiteUsos === null || c.limiteUsos === undefined || c.limiteUsos === '')
                ? null : Number(c.limiteUsos);
            const esgotado = limite !== null && usos >= limite;
            const vencido = cupomVencido(c);
            const desligado = c.ativo === false;
            const inativo = esgotado || vencido || desligado;

            const desconto = Number(c.percentual) > 0
                ? `${c.percentual}% de desconto`
                : Number(c.valorFixo) > 0
                    ? `${fmt(c.valorFixo)} de desconto`
                    : 'sem desconto definido';

            let motivo = '';
            if (desligado) motivo = 'DESLIGADO';
            else if (vencido) motivo = 'VENCIDO';
            else if (esgotado) motivo = 'ESGOTADO';

            return `
            <div class="cupom-card ${inativo ? 'inativo' : ''}">
                <div class="cupom-card-topo">
                    <strong class="cupom-codigo">${escapeHTML(c.codigo)}</strong>
                    ${motivo ? `<span class="cupom-tag">${motivo}</span>` : '<span class="cupom-tag ativo">ATIVO</span>'}
                </div>
                <p class="cupom-desconto">${escapeHTML(desconto)}</p>
                <p class="cupom-meta">
                    Usado ${usos}${limite !== null ? ` de ${limite}` : ' vez(es)'}
                    ${Number(c.minimoCompra) > 0 ? ` • mínimo ${fmt(c.minimoCompra)}` : ''}
                    ${c.validoAte ? ` • até ${new Date(c.validoAte + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}
                    ${c.foraDaPrevisao === true ? ' • especial, fora da previsão' : ''}
                </p>
                <div class="cupom-acoes">
                    <button class="btn btn-outline" data-action="toggle-cupom" data-id="${escapeHTML(c.codigo)}">
                        ${desligado ? 'Ligar' : 'Desligar'}
                    </button>
                    <button class="btn btn-danger" data-action="excluir-cupom" data-id="${escapeHTML(c.codigo)}">Excluir</button>
                </div>
            </div>`;
        }).join('');
};

// cupom de 100% já nasce marcado como especial (a pessoa pode desmarcar)
document.getElementById('cup-percentual')?.addEventListener('input', (e) => {
    const esp = document.getElementById('cup-especial'); if (!esp || esp.dataset.mexido) return;
    esp.checked = Number(e.target.value) >= 100;
});
document.getElementById('cup-especial')?.addEventListener('change', (e) => { e.target.dataset.mexido = '1'; });

const salvarCupom = async () => {
    const btn = document.getElementById('btn-salvar-cupom');
    const codigo = (document.getElementById('cup-codigo').value || '').trim().toUpperCase();

    if (!/^[A-Z0-9-]{3,40}$/.test(codigo)) {
        return showToast('O código deve ter de 3 a 40 caracteres: letras, números ou hífen.', true);
    }

    const percentual = Number(document.getElementById('cup-percentual').value) || 0;
    const valorFixo = Number(document.getElementById('cup-valorfixo').value) || 0;

    if (percentual <= 0 && valorFixo <= 0) {
        return showToast('Defina o desconto: em % ou em reais.', true);
    }
    if (percentual > 100) return showToast('O desconto vai até 100%.', true);
    const limiteDigitado = document.getElementById('cup-limite').value;
    if (percentual > 90) {
        const tudo = percentual >= 100;
        const ok = await customConfirm(tudo ? 'Cupom de 100%?' : `Cupom de ${percentual}%?`,
            `${tudo ? 'Quem usar este código leva o pedido de graça, com a entrega.' : 'É um desconto bem alto.'} Vale para qualquer pessoa que souber o código${limiteDigitado === '' ? ', sem limite de usos' : ''}. Confirma?`);
        if (!ok) return;
    }

    const limiteRaw = document.getElementById('cup-limite').value;

    btn.disabled = true; btn.textContent = 'Gravando...';
    try {
        await setDoc(tdoc('cupons', codigo), {
            percentual,
            valorFixo,
            minimoCompra: Number(document.getElementById('cup-minimo').value) || 0,
            limiteUsos: limiteRaw === '' ? null : Number(limiteRaw),
            validoAte: document.getElementById('cup-validade').value || '',
            foraDaPrevisao: document.getElementById('cup-especial')?.checked === true,
            ativo: true,
            criadoEm: new Date().toISOString(),
        }, { merge: true });   // merge preserva a contagem de usos se já existir

        showToast(`Cupom ${codigo} gravado!`);
        ['cup-codigo', 'cup-percentual', 'cup-valorfixo', 'cup-minimo', 'cup-limite', 'cup-validade']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const esp = document.getElementById('cup-especial'); if (esp) { esp.checked = false; delete esp.dataset.mexido; }
    } catch (e) {
        console.error(e);
        showToast('Erro ao gravar o cupom.', true);
    } finally {
        btn.disabled = false; btn.textContent = 'Salvar cupom';
    }
};


// =====================================================================
// COMUNICADOS — mensagem automática por dia da semana + aviso fixo
// Guardado em loja/comunicados. A loja lê e mostra no topo.
// =====================================================================
const DIAS_NOMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
let comunicadosAtuais = { dias: {}, fixo: { ativo: false, texto: '' } };

// Um comunicado com data passada não aparece mais na loja. O painel avisa
// disso, senão parece que está no ar e não está.
const jaVenceu = (bloco) => {
    if (!bloco?.validoAte) return false;
    // Fim do dia no horário de Brasília — ver comentário igual no loja.js.
    const limite = new Date(`${bloco.validoAte}T23:59:59-03:00`);
    if (isNaN(limite)) return false;
    return new Date() > limite;
};
const SELO_VENCIDO = '<span class="com-vencido-tag">VENCIDO</span>';

const renderComunicados = () => {
    const cont = document.getElementById('lista-comunicados');
    if (!cont) return;
    const hoje = new Date().getDay();

    const blocoFixo = `
        <div class="com-dia" style="border-color: var(--earth);">
            <div class="com-dia-topo">
                <span class="com-dia-nome"><i class="ic" data-i="megafone"></i> Aviso fixo / Oferta do momento ${jaVenceu(comunicadosAtuais.fixo) ? SELO_VENCIDO : ''}</span>
                <label class="com-switch">
                    <input type="checkbox" id="com-fixo-ativo" ${comunicadosAtuais.fixo?.ativo ? 'checked' : ''}> mostrar
                </label>
            </div>
            <textarea id="com-fixo-texto" placeholder="Ex: Morango na promoção hoje: R$ 8,90 a bandeja!">${escapeHTML(comunicadosAtuais.fixo?.texto || '')}</textarea>
            <label class="com-validade">
                Some sozinho depois de
                <input type="date" id="com-fixo-validade" value="${escapeHTML(comunicadosAtuais.fixo?.validoAte || '')}">
            </label>
            <small style="color:var(--text-light); font-size:.78rem;">Aparece sempre que estiver ligado, em qualquer dia. Tem prioridade sobre a mensagem do dia. Deixe a data em branco para não expirar.</small>
        </div>`;

    const blocosDias = DIAS_NOMES.map((nome, i) => {
        const d = comunicadosAtuais.dias?.[i] || { ativo: false, texto: '' };
        return `
        <div class="com-dia">
            <div class="com-dia-topo">
                <span class="com-dia-nome">${nome} ${i === hoje ? '<span class="com-hoje-tag">HOJE</span>' : ''} ${jaVenceu(d) ? SELO_VENCIDO : ''}</span>
                <label class="com-switch">
                    <input type="checkbox" class="com-dia-ativo" data-dia="${i}" ${d.ativo ? 'checked' : ''}> mostrar
                </label>
            </div>
            <textarea class="com-dia-texto" data-dia="${i}" placeholder="Ex: Chegou verdura fresquinha hoje!">${escapeHTML(d.texto || '')}</textarea>
            <label class="com-validade">
                Some sozinho depois de
                <input type="date" class="com-dia-validade" data-dia="${i}" value="${escapeHTML(d.validoAte || '')}">
            </label>
        </div>`;
    }).join('');

    cont.innerHTML = blocoFixo + blocosDias;
};

document.getElementById('btn-salvar-cupom')?.addEventListener('click', salvarCupom);

// ---------------------------------------------------------------------
// EXPORTAR O BALANÇO
//
// Gera um CSV que o Excel e o Google Planilhas abrem direto — é o formato
// que um contador consegue usar sem instalar nada. Vão duas partes no mesmo
// arquivo: o resumo por dia e a lista de pedidos do período.
// ---------------------------------------------------------------------
document.getElementById('btn-exportar-balanco')?.addEventListener('click', () => {
    if (!balancoCache || balancoCache.length === 0) {
        return showToast('Carregue um período antes de exportar.', true);
    }

    const validos = balancoCache.filter(p => p.status !== 'cancelado');

    // --- Parte 1: total por dia ---
    const porDia = {};
    validos.forEach(p => {
        const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(p.entregaDia || '')) ? p.entregaDia : diaBR(p.data);   // dia da entrega (= caixa do dia)
        if (!dia) return;
        if (!porDia[dia]) porDia[dia] = { receita: 0, pedidos: 0 };
        porDia[dia].receita += Number(p.total) || 0;
        porDia[dia].pedidos += 1;
    });

    let csv = 'RESUMO POR DIA\n';
    csv += ['Dia', 'Pedidos', 'Receita'].join(CSV_SEP) + '\n';
    Object.keys(porDia).sort().forEach(dia => {
        const d = porDia[dia];
        csv += [dia.split('-').reverse().join('/'), d.pedidos, d.receita.toFixed(2).replace('.', ',')].map(csvCampo).join(CSV_SEP) + '\n';
    });

    const receitaTotal = validos.reduce((soma, p) => soma + (Number(p.total) || 0), 0);
    csv += '\n';
    csv += ['TOTAL', validos.length, receitaTotal.toFixed(2).replace('.', ',')].map(csvCampo).join(CSV_SEP) + '\n';

    // --- Parte 2: pedido por pedido ---
    csv += '\nPEDIDOS DO PERÍODO\n';
    csv += ['Data', 'Entrega', 'Cliente', 'Condomínio', 'Quadra/Rua', 'Lote/Número', 'Status', 'Pagamento', 'Pago via PIX', 'Cupom', 'Total', 'Itens'].join(CSV_SEP) + '\n';
    validos
        .slice()
        .sort((a, b) => String(a.data).localeCompare(String(b.data)))
        .forEach(p => {
            const itensTxt = (p.itens || [])
                .map(i => `${formatarQtdRelatorio(i.qtd, i.unidade)} ${i.nome}`).join(' | ');
            const pago = p.pagamento && p.pagamento.status === 'PAID' ? 'sim' : 'nao';
            const cupom = p.cupom && p.cupom.codigo
                ? `${p.cupom.codigo} (-${Number(p.cupom.desconto || 0).toFixed(2).replace('.', ',')})`
                : '';
            csv += [
                dataHoraBR(p.data), p.entregaDia || '', p.nome, p.condominio || '', p.quadra, p.lote, p.status, p.pag, pago, cupom,
                (Number(p.total) || 0).toFixed(2).replace('.', ','), itensTxt
            ].map(csvCampo).join(CSV_SEP) + '\n';
        });

    const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    baixarCsv(csv, `Balanco_Banca_${hoje}.csv`);
    showToast(`Balanço exportado (${validos.length} pedidos). Veja em Downloads.`);
});

const salvarComunicados = async () => {
    const btn = document.getElementById('btn-salvar-comunicados');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
        const dias = {};
        document.querySelectorAll('.com-dia-texto').forEach(t => {
            const i = t.dataset.dia;
            const chk = document.querySelector(`.com-dia-ativo[data-dia="${i}"]`);
            const val = document.querySelector(`.com-dia-validade[data-dia="${i}"]`);
            dias[i] = {
                ativo: !!chk?.checked,
                texto: t.value.trim().slice(0, 220),
                validoAte: val?.value || ''   // vazio = não expira
            };
        });
        const fixo = {
            ativo: !!document.getElementById('com-fixo-ativo')?.checked,
            texto: (document.getElementById('com-fixo-texto')?.value || '').trim().slice(0, 220),
            validoAte: document.getElementById('com-fixo-validade')?.value || ''
        };
        await setDoc(tdoc('loja', 'comunicados'), { dias, fixo, atualizadoEm: Date.now() }, { merge: true });
        showToast('Comunicados atualizados!');
    } catch (e) {
        showToast('Erro ao salvar comunicados.', true);
    } finally {
        btn.disabled = false; btn.textContent = 'Salvar avisos';
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
    alvo.innerHTML = '<p style="color:var(--text-light)">Somando os números... <i class="ic" data-i="espera"></i></p>';

    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    try {
        const LIMITE_BALANCO = 2000;
        const q = query(tcol('pedidos'), where('data', '>=', desde), orderBy('data', 'desc'), limit(LIMITE_BALANCO));

        // Busca única. Se o seu firebase.js ainda não exporta getDocs,
        // cai automaticamente num onSnapshot que se desinscreve na 1ª resposta —
        // assim funciona sem você precisar editar o firebase.js.
        const mod = await import('./firebase.js');
        const snap = mod.getDocs
            ? await mod.getDocs(q)
            : await new Promise((resolve, reject) => {
                const parar = onSnapshot(q, (s) => { parar(); resolve(s); }, reject);
              });

        balancoCache = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        renderBalanco(dias);
        TELAS.margens().then((m) => m.renderMargens(balancoCache, produtosAtuais, dias)).catch(() => {});   // custos e margens, com os mesmos pedidos
        // Antes cortava em 800 sem avisar: o total do período saía menor que o real.
        if (snap.size >= LIMITE_BALANCO) {
            alvo.insertAdjacentHTML('afterbegin', `<p class="aviso-limite"><i class="ic" data-i="alerta"></i> Este período tem mais de ${LIMITE_BALANCO} pedidos. Os totais abaixo consideram só os ${LIMITE_BALANCO} mais recentes — escolha um período menor para o número exato.</p>`);
        }
    } catch (e) {
        console.error(e);
        mostrarErroConsulta(e, 'balanco-conteudo');
    }
};

const renderBalanco = async (dias) => {
    const alvo = document.getElementById('balanco-conteudo');
    const validos = balancoCache.filter(p => p.status !== 'cancelado');

    const hojeStr = new Date().toDateString();
    const inicioSemana = Date.now() - 7 * 86400000;

    let totalPeriodo = 0, totalHoje = 0, totalSemana = 0;
    let nHoje = 0, nSemana = 0;
    let aReceber = 0, jaPago = 0, naEntrega = 0;
    const porDia = {};
    const porProduto = {};

    validos.forEach(p => {
        const v = Number(p.total) || 0;
        const d = /^\d{4}-\d{2}-\d{2}$/.test(String(p.entregaDia || '')) ? new Date(`${p.entregaDia}T12:00:00-03:00`) : new Date(p.data);   // dia da entrega (= caixa do dia)
        totalPeriodo += v;
        if (!isNaN(d.getTime())) {
            if (d.toDateString() === hojeStr) { totalHoje += v; nHoje++; }
            if (d.getTime() >= inicioSemana) { totalSemana += v; nSemana++; }
            const rot = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            porDia[rot] = (porDia[rot] || 0) + v;
        }
        // venda de balcão e pedido já concluído (arquivado) foram pagos na hora: não são "a receber"
        if (p.pagamento?.status === 'PAID') jaPago += v; else if (p.origem === 'balcao' || p.status === 'arquivado') naEntrega += v; else aReceber += v;
        (p.itens || []).forEach(i => {
            const q = Number(i.qtd) || 0;
            porProduto[i.nome] = (porProduto[i.nome] || 0) + q;
        });
    });

    // o resumo de várias vendas do balcão é dinheiro de verdade, mas não é UM pedido: fica fora do ticket médio
    const unicos = validos.filter((p) => !p.resumoDoDia);
    const ticket = unicos.length ? unicos.reduce((s, p) => s + (Number(p.total) || 0), 0) / unicos.length : 0;

    // ---- números para o desenho do caixa ----
    const rotDia = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const ult14 = Array.from({ length: 14 }, (_, k) => { const d = new Date(Date.now() - (13 - k) * 86400000), rot = rotDia(d); return { rot, v: porDia[rot] || 0, hoje: k === 13 }; });
    const pico = Math.max(...ult14.map((x) => x.v), 1);
    const diasComVenda = Object.keys(porDia).length;
    const melhor = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];
    const totalDinheiro = jaPago + naEntrega + aReceber;
    const partes = [
        ['Recebido na entrega e no balcão', 'pedidos concluídos e vendas de balcão', naEntrega, 'var(--forest)'],
        ['Pago pelo PIX automático', 'confirmado pelo banco', jaPago, 'var(--leaf)'],
        ['A receber', 'pedidos ainda em andamento', aReceber, 'var(--earth)'],
    ];
    const etiqueta = (rotulo, valor, sub) => `<li class="cx-etq"><span>${rotulo}</span><b>${valor}</b><small>${sub}</small></li>`;

    alvo.innerHTML = `
        <section class="cx-caixa" aria-label="Resumo do caixa">
            <p class="cx-rot">Entrou no caixa em ${dias} dias</p>
            <strong class="cx-total">${fmt(totalPeriodo)}</strong>
            <p class="cx-sub">${validos.length} pedido(s)${diasComVenda ? ` · ${fmt(totalPeriodo / diasComVenda)} por dia com venda` : ''}</p>
            <div class="cx-barras" role="img" aria-label="Faturamento de cada um dos últimos 14 dias; o maior foi ${fmt(pico)}">
                ${ult14.map((x) => `<i class="${x.hoje ? 'hoje' : ''}${x.v ? '' : ' zero'}" style="--h:${Math.max(4, Math.round(x.v / pico * 100))}%" title="${x.rot}: ${fmt(x.v)}"></i>`).join('')}
            </div>
            <div class="cx-eixo"><span>${ult14[0].rot}</span><span>últimos 14 dias</span><span>hoje</span></div>
        </section>

        <ul class="cx-trilho" aria-label="Outros números do período">
            ${etiqueta('Hoje', fmt(totalHoje), `${nHoje} pedido(s)`)}
            ${etiqueta('Últimos 7 dias', fmt(totalSemana), `${nSemana} pedido(s)`)}
            ${etiqueta('Ticket médio', unicos.length ? fmt(ticket) : '—', unicos.length ? `em ${unicos.length} pedido(s)` : 'só resumos de balcão no período')}
            ${melhor ? etiqueta('Melhor dia', fmt(melhor[1]), melhor[0]) : ''}
        </ul>

        <section class="cx-livro">
            <h3>Onde está o dinheiro</h3>
            <div class="cx-faixa" role="img" aria-label="Divisão do dinheiro do período">
                ${totalDinheiro > 0 ? partes.filter((x) => x[2] > 0).map((x) => `<i style="flex:${x[2]};background:${x[3]}"></i>`).join('') : ''}
            </div>
            <ul class="cx-linhas">
                ${partes.map(([rot, sub, v, cor]) => `<li class="${v > 0 ? '' : 'vazio'}"><i class="cx-cor" style="background:${cor}"></i><span>${rot}<small>${sub}</small></span><u></u><b>${fmt(v)}</b></li>`).join('')}
            </ul>
        </section>
        <div class="chart-wrapper" style="margin-bottom:20px;">
            <h3><i class="ic" data-i="sobe"></i> Faturamento por dia</h3>
            <canvas id="balanco-chart" height="90"></canvas>
        </div>
        <div class="ranking-box">
            <h3>Mais vendidos no período</h3>
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

// ---------------------------------------------------------------------
// CONDOMÍNIOS ATENDIDOS (aba Operacional)
// Ficam em loja/config.condominios = [{ id, nome, formato }] e aparecem na
// loja para o cliente escolher. formato: 'ql' = quadra e lote · 'rua' = rua e número.
// O id nasce do nome e NÃO muda ao renomear (é ele que liga o cliente ao condomínio).
// ---------------------------------------------------------------------
const idDeCondominio = (nome) => normalizar(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `c${Date.now()}`;
const linhaCondominioHtml = (c = {}) => `
    <div class="cond-linha" data-id="${escapeHTML(c.id || '')}">
        <input type="text" class="cond-nome" placeholder="Nome do condomínio" maxlength="60" value="${escapeHTML(c.nome || '')}" aria-label="Nome do condomínio">
        <select class="cond-formato" aria-label="Como é o endereço">
            <option value="ql"${c.formato === 'rua' ? '' : ' selected'}>Quadra e lote</option>
            <option value="rua"${c.formato === 'rua' ? ' selected' : ''}>Rua e número</option>
        </select>
        <button type="button" class="cond-remover" aria-label="Remover condomínio">&times;</button>
    </div>`;
const pintarCondominios = (lista) => {
    const alvo = document.getElementById('lista-condominios'); if (!alvo) return;
    alvo.innerHTML = (Array.isArray(lista) ? lista : []).map(linhaCondominioHtml).join('');
};
const lerCondominios = () => {
    const usados = new Set();
    return Array.from(document.querySelectorAll('#lista-condominios .cond-linha')).map((l) => {
        const nome = l.querySelector('.cond-nome').value.trim().replace(/\s+/g, ' ');
        if (!nome) return null;
        let id = l.dataset.id || idDeCondominio(nome);
        while (usados.has(id)) id += '-2';
        usados.add(id);
        return { id, nome, formato: l.querySelector('.cond-formato').value === 'rua' ? 'rua' : 'ql' };
    }).filter(Boolean);
};
document.getElementById('btn-add-condominio')?.addEventListener('click', () => {
    const alvo = document.getElementById('lista-condominios');
    alvo.insertAdjacentHTML('beforeend', linhaCondominioHtml());
    alvo.lastElementChild.querySelector('.cond-nome').focus();
});
document.getElementById('lista-condominios')?.addEventListener('click', (e) => {
    e.target.closest('.cond-remover')?.closest('.cond-linha').remove();
});

document.getElementById('btn-salvar-config').addEventListener('click', async () => {
    const btn = document.getElementById('btn-salvar-config');
    btn.textContent = "A guardar..."; btn.disabled = true;

    try {
        const wpp = normalizarWpp(document.getElementById('config-wpp').value);   // "62 99999-8888" vira 5562999998888
        const minimo = parseFloat(document.getElementById('config-minimo').value) || 0;
        const lojaAberta = document.getElementById('config-status-loja').value === "aberta";
        const diasAbertos = Array.from(document.querySelectorAll('.chk-dia:checked')).map(chk => parseInt(chk.value));

        if (!wpp) throw new Error("Número de WhatsApp inválido. Digite com DDD, ex.: 62 99999-8888.");
        if (diasAbertos.length === 0) throw new Error("Marque pelo menos um dia de abertura (ou feche a loja no disjuntor).");

        const condominios = lerCondominios();
        const pixAutomatico = ehLojaOriginal && document.getElementById('config-pix')?.checked === true;
        const taxa = Math.max(0, parseFloat(document.getElementById('config-taxa').value) || 0), gratisAcima = Math.max(0, parseFloat(document.getElementById('config-gratis').value) || 0);
        if (taxa > 500) throw new Error("Confira a taxa de entrega: o máximo é R$ 500.");
        const entrega = { taxa, gratisAcima, horarios: horariosDoTexto(document.getElementById('config-horarios').value) };
        // Chave PIX da loja (copia e cola). Vazia = desligado. Preenchida, tem de ser válida para o tipo escolhido.
        const pixTipo = document.getElementById('config-pix-tipo').value, pixBruta = document.getElementById('config-pix-chave').value.trim();
        const pixNome = document.getElementById('config-pix-nome').value.trim(), pixCidade = document.getElementById('config-pix-cidade').value.trim();
        let pix = null;
        if (pixBruta) {
            const chave = normalizarChave(pixTipo, pixBruta);
            if (!chave) throw new Error(`A chave PIX não confere com o tipo "${TIPOS_DE_CHAVE[pixTipo]}". Confira os números ou troque o tipo.`);
            if (pixNome.length < 2) throw new Error("Escreva o nome de quem recebe o PIX, como aparece no banco.");
            pix = { tipo: pixTipo, chave, nome: pixNome.slice(0, 25), cidade: pixCidade.slice(0, 15) };
        }
        const cidade = (document.getElementById('config-cidade')?.value || '').trim().slice(0, 60);   // usada pelo motor de previsão para o clima
        await setDoc(tdoc("loja", "config"), { wpp, minimo, lojaAberta, diasAbertos, condominios, pixAutomatico, entrega, pix, cidade }, { merge: true });
        showToast("Configurações atualizadas!");
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.textContent = "Salvar configurações"; btn.disabled = false;
    }
});
