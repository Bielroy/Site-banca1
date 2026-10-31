// =====================================================================
//  js/admin-equipe.js — aba "Equipe": o proprietário dá acesso por e-mail.
//  Quem grava o papel é o servidor (/api/equipe); a tela só pede.
// =====================================================================
import { auth, signInWithCustomToken } from './firebase.js';
import { numeroDoAparelho } from './admin-aparelho.js';
import { escapeHTML, showToast, customConfirm } from './utils.js';
import { sairELimpar } from './admin-guard.js';
import { PAPEIS, ATRIBUIVEIS } from './papeis-lib.js';

const S = { equipe: null, estado: 'carregando', ligado: false, enviando: false, registros: null, assinatura: null, aparelhos: null, aprovacao: null };
// nomes simples para o que fica na trilha de auditoria (api/equipe.js grava; ninguém edita nem apaga pelo painel)
const ACOES = { 'equipe-papel': 'Deu acesso', 'equipe-remover': 'Tirou o acesso', 'zerar-movimento': 'Zerou o movimento', 'copia-restaurar': 'Restaurou o cadastro', 'copia-baixar': 'Baixou a cópia de segurança', maquininha: 'Mexeu na maquininha', 'sair-de-tudo': 'Encerrou o próprio login em todos os aparelhos', 'aparelho-novo': 'Entrou de um aparelho novo', 'aparelho-desconectar': 'Desconectou um aparelho', 'aparelho-liberar': 'Liberou um aparelho', 'aparelho-aguardando': 'Aparelho novo aguardando aprovação', 'aparelho-aprovar': 'Aprovou um aparelho', 'aprovacao-aparelhos': 'Mudou a aprovação de aparelho novo' };
const quando = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; };
const registrosHtml = () => (S.registros === null ? '' : (S.registros.length
    ? `<ul class="eq-lista">${S.registros.map((r) => `<li class="eq-item"><span><b>${escapeHTML(ACOES[r.acao] || r.acao)}</b><small>${escapeHTML(quando(r.em))} · ${escapeHTML(r.quem || '')}${r.detalhe ? ` · ${escapeHTML(r.detalhe)}` : ''}</small></span></li>`).join('')}</ul>`
    : '<p class="config-sub">Nenhuma ação registrada ainda.</p>'));
// APARELHOS que entraram no painel desta loja (lib/aparelhos.js): o proprietário vê e desconecta o que não reconhece
const COMO = { 'link-outro-aparelho': 'entrou por um link aberto em OUTRO aparelho', passkey: 'entrou com Face ID/digital', link: 'entrou pelo link do e-mail' };
const aparelhosHtml = () => {
    if (S.aparelhos === null) return '<p class="config-sub">Carregando os aparelhos...</p>';
    if (!S.aparelhos.length) return '<p class="config-sub">Nenhum aparelho registrado ainda. Eles aparecem aqui conforme cada pessoa abre o painel.</p>';
    return `<ul class="eq-lista eq-aparelhos">${S.aparelhos.map((a) => `
        <li class="eq-item${a.bloqueado ? ' eq-bloqueado' : ''}${a.pendente && !a.bloqueado ? ' eq-pendente' : ''}${a.como === 'link-outro-aparelho' ? ' eq-suspeito' : ''}">
            <span><b>${escapeHTML(a.nome)}${a.meu ? ' <em class="eq-fixo">você</em>' : ''}</b>
            <small>${escapeHTML(a.email)} · último acesso ${escapeHTML(quando(a.ultima))}${a.conexao ? ` · conexão ${escapeHTML(a.conexao)}` : ''}${a.conexoes > 1 ? ` (${a.conexoes} conexões)` : ''}</small>
            <small>${a.bloqueado ? '<b>Desconectado</b>' : a.pendente ? '<b>Aguardando a sua aprovação</b> · ' : ''}${a.bloqueado ? '' : `primeiro acesso ${escapeHTML(quando(a.primeira))}${COMO[a.como] ? ` · ${escapeHTML(COMO[a.como])}` : ''}`}</small></span>
            ${a.bloqueado ? `<button type="button" class="btn-outline" data-eq-liberar="${escapeHTML(a.id)}">Liberar</button>`
                : a.pendente ? `<span class="eq-bts"><button type="button" class="btn-salvar-config" data-eq-aprovar="${escapeHTML(a.id)}">Aprovar</button><button type="button" class="btn-outline eq-desc" data-eq-desconectar="${escapeHTML(a.id)}">Negar</button></span>`
                : `<button type="button" class="btn-outline eq-desc" data-eq-desconectar="${escapeHTML(a.id)}">Desconectar</button>`}
        </li>`).join('')}</ul>`;
};
// APROVAÇÃO DE APARELHO NOVO (lib/aprovacao.js): opção desta loja. Ligada, aparelho que nunca entrou fica esperando o proprietário aprovar.
const aprovacaoHtml = () => (S.aprovacao === null ? '' : `
    <label class="eq-aprov"><input type="checkbox" id="eq-aprovacao"${S.aprovacao ? ' checked' : ''}>
        <span><b>Aparelho novo só entra com a minha aprovação</b>
        <small>${S.aprovacao ? 'Ligado: celular ou computador que nunca entrou no painel fica esperando você tocar em Aprovar aqui. Você recebe aviso no celular. Os aparelhos aprovados entram normalmente.' : 'Desligado: aparelho novo entra direto e você só recebe o aviso. Ao ligar, os aparelhos que já entram continuam aprovados.'}</small></span></label>`);
const el = () => document.getElementById('equipe-conteudo');
const $ = (id) => document.getElementById(id);

async function api(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não foi possível concluir.');
    return j;
}
const opcoes = (atual) => ATRIBUIVEIS.map((p) => `<option value="${p}"${p === atual ? ' selected' : ''}>${PAPEIS[p][0]}</option>`).join('');

function render() {
    if (!el()) return;
    const lista = S.estado === 'ok'
        ? (S.equipe.length ? `<ul class="eq-lista">${S.equipe.map((m) => `
            <li class="eq-item">
                <span><b>${escapeHTML(m.email)}</b><small>${escapeHTML((PAPEIS[m.papel] || ['', ''])[1])}</small></span>
                ${m.papel === 'proprietario' ? '<em class="eq-fixo">Proprietário</em>' : `<select data-eq-papel="${escapeHTML(m.uid)}" aria-label="Papel de ${escapeHTML(m.email)}">${opcoes(m.papel)}</select>
                <button type="button" class="cal-apagar" data-eq-remover="${escapeHTML(m.uid)}" aria-label="Tirar o acesso de ${escapeHTML(m.email)}">&times;</button>`}
            </li>`).join('')}</ul>` : '<p class="config-sub">Ninguém além de você por enquanto.</p>')
        : `<div class="cp-vazio"><b>${S.estado === 'carregando' ? 'Carregando a equipe...' : 'Não consegui carregar a equipe.'}</b><span>${S.estado === 'erro' ? escapeHTML(S.erro || '') : ''}</span></div>`;
    el().innerHTML = `
    <div class="es-topo"><div><h3>Equipe</h3><p class="config-sub">Cada pessoa entra com o próprio e-mail e vê só o que o papel dela permite.</p></div></div>
    <div class="eq-novo">
        <div class="form-group"><label for="eq-email">E-mail da pessoa</label><input type="email" id="eq-email" autocomplete="off" inputmode="email" placeholder="nome@email.com"></div>
        <div class="form-group"><label for="eq-papel">Papel</label><select id="eq-papel">${opcoes('funcionario')}</select><small class="dica-campo" id="eq-papel-dica">${PAPEIS.funcionario[1]}</small></div>
        <button class="btn-salvar-config" id="eq-adicionar">Dar acesso</button>
    </div>
    <div id="eq-assin-lugar">${assinaturaHtml()}</div>
    <h4 class="cp-sub">Quem tem acesso</h4>
    ${lista}
    <p class="config-sub cal-nota">A pessoa abre o painel, digita o e-mail e entra pelo link que chega na caixa de entrada. Mudança de papel vale quando ela entrar de novo. Ao tirar o acesso, o painel que já estiver aberto pode continuar mostrando a tela por até 1 hora, mas vendas, estoque e equipe são recusados na hora.</p>
    <h4 class="cp-sub">Segurança</h4>
    <p class="config-sub">Perdeu o celular ou entrou num computador que não é seu? Encerre o seu login em todos os aparelhos (o Face ID/digital deles também é desligado). Depois é só entrar de novo pelo link do e-mail.</p>
    <button type="button" class="btn-outline" id="eq-sair-tudo" style="padding:12px 18px">Sair de todos os aparelhos</button>
    <h4 class="cp-sub">Aparelhos que entraram</h4>
    <p class="config-sub">Cada celular ou computador que abriu o painel desta loja. Aparelho novo, link aberto em outro aparelho e acesso que parece compartilhado (muitos aparelhos ou conexões ao mesmo tempo) também chegam como aviso no seu celular. Não reconhece? Toque em Desconectar.</p>
    <div id="eq-aprov-lugar">${aprovacaoHtml()}</div>
    <div id="eq-aparelhos">${aparelhosHtml()}</div>
    <h4 class="cp-sub">Registro de ações</h4>
    <p class="config-sub">Quem deu ou tirou acesso, quem baixou a cópia com dados de clientes, quem zerou ou restaurou. Fica guardado no servidor e ninguém apaga pelo painel.</p>
    ${S.registros === null ? '<button type="button" class="btn-outline" id="eq-ver-registro" style="padding:12px 18px">Ver o registro</button>' : registrosHtml()}`;
}

// A MENSALIDADE desta banca, definida pela plataforma. Só o proprietário vê (o servidor confere).
function assinaturaHtml() {
    const a = S.assinatura;
    if (!a) return '';
    return `<div class="eq-assin"><span class="eq-assin-tit">Sua mensalidade</span><b>${fmtReais(a.valor)} por mês</b>${a.dia ? `<small>Vence todo dia ${a.dia}.</small>` : ''}${a.obs ? `<small>${escapeHTML(a.obs)}</small>` : ''}</div>`;
}
const fmtReais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function carregarAparelhos() {
    try { S.aparelhos = (await api({ acao: 'aparelhos' })).aparelhos || []; } catch (_) { S.aparelhos = []; }
    const lugar = document.getElementById('eq-aparelhos'); if (lugar) lugar.innerHTML = aparelhosHtml();
}
async function carregar() {
    carregarAparelhos();
    api({ acao: 'aprovacao-estado' }).then((j) => { S.aprovacao = !!j.ligado; const lugar = document.getElementById('eq-aprov-lugar'); if (lugar) lugar.innerHTML = aprovacaoHtml(); }).catch(() => {});
    api({ acao: 'minha-assinatura' }).then((j) => { S.assinatura = j.assinatura || null; const lugar = document.getElementById('eq-assin-lugar'); if (lugar) lugar.innerHTML = assinaturaHtml(); }).catch(() => {});
    try { S.equipe = (await api({ acao: 'listar' })).equipe || []; S.estado = 'ok'; }
    catch (e) { S.estado = 'erro'; S.erro = e.message; }
    render();
}
async function definir(email, papel, botao) {
    if (S.enviando) return; S.enviando = true; if (botao) botao.disabled = true;
    try { await api({ acao: 'definir', email, papel }); showToast(`${email} agora é ${PAPEIS[papel][0]}.`); await carregar(); }
    catch (e) { showToast(e.message, true); render(); }
    finally { S.enviando = false; if (botao) botao.disabled = false; }
}
function ligar() {
    if (S.ligado) return; S.ligado = true;
    el().addEventListener('change', async (e) => {
        const caixa = e.target.closest('#eq-aprovacao'); if (!caixa) return;
        const ligar = caixa.checked;
        const ok = await customConfirm(ligar ? 'Exigir aprovação para aparelho novo?' : 'Desligar a aprovação de aparelho novo?', ligar
            ? 'Os aparelhos que já entram no painel continuam funcionando. Daqui para frente, celular ou computador novo da equipe só entra depois que você aprovar aqui (você recebe aviso no celular). Este aparelho fica aprovado agora.'
            : 'Aparelho novo da equipe volta a entrar direto. O aviso de aparelho novo continua chegando.');
        if (!ok) { caixa.checked = !ligar; return; }
        caixa.disabled = true;
        try {
            const j = await api({ acao: 'aprovacao-definir', ligar, aparelho: numeroDoAparelho() });
            S.aprovacao = ligar;
            if (j.token) {               // este aparelho ganhou o login preso a ele: troca e recarrega
                showToast('Aprovação ligada. Este aparelho continua aprovado.');
                await signInWithCustomToken(auth, j.token);
                setTimeout(() => location.reload(), 900);
                return;
            }
            showToast(ligar ? 'Aprovação ligada.' : 'Aprovação desligada.');
            const lugar = document.getElementById('eq-aprov-lugar'); if (lugar) lugar.innerHTML = aprovacaoHtml();
            carregarAparelhos();
        } catch (err) { caixa.checked = !ligar; showToast(err.message, true); }
        finally { caixa.disabled = false; }
    });
    el().addEventListener('click', async (e) => {
        if (e.target.closest('#eq-adicionar')) {
            const email = $('eq-email').value.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return showToast('Confira o e-mail.', true);
            return definir(email, $('eq-papel').value, $('eq-adicionar'));
        }
        if (e.target.closest('#eq-sair-tudo')) {
            if (!(await customConfirm('Sair de todos os aparelhos?', 'O seu login é encerrado neste e em qualquer outro aparelho, e o Face ID/digital de todos eles é desligado. Você vai precisar entrar de novo pelo link do e-mail.'))) return;
            try { await api({ acao: 'sair-de-tudo' }); showToast('Login encerrado em todos os aparelhos.'); setTimeout(() => sairELimpar(), 1200); } catch (err) { showToast(err.message, true); }
            return;
        }
        const aprovar = e.target.closest('[data-eq-aprovar]');
        if (aprovar) {
            aprovar.disabled = true;
            try { await api({ acao: 'aparelho-aprovar', id: aprovar.dataset.eqAprovar }); showToast('Aparelho aprovado. A pessoa já pode entrar.'); await carregarAparelhos(); }
            catch (err) { showToast(err.message, true); aprovar.disabled = false; }
            return;
        }
        const desc = e.target.closest('[data-eq-desconectar]'), lib = e.target.closest('[data-eq-liberar]');
        if (desc || lib) {
            const a = (S.aparelhos || []).find((x) => x.id === (desc ? desc.dataset.eqDesconectar : lib.dataset.eqLiberar)); if (!a) return;
            if (desc && !(await customConfirm('Desconectar este aparelho?', `${a.nome} (${a.email}) sai do painel e não entra mais por ele. O login dessa conta é encerrado em todos os aparelhos dela: nos outros, a pessoa entra de novo pelo Face ID ou pelo link.${a.meu ? ' Atenção: esta conta é a sua.' : ''}`))) return;
            try { await api({ acao: desc ? 'aparelho-desconectar' : 'aparelho-liberar', id: a.id }); showToast(desc ? 'Aparelho desconectado.' : 'Aparelho liberado. A pessoa entra de novo pelo link ou Face ID.'); await carregarAparelhos(); }
            catch (err) { showToast(err.message, true); }
            return;
        }
        if (e.target.closest('#eq-ver-registro')) {
            try { S.registros = (await api({ acao: 'auditoria' })).registros || []; } catch (err) { showToast(err.message, true); return; }
            return render();
        }
        const r = e.target.closest('[data-eq-remover]'); if (!r) return;
        const m = S.equipe.find((x) => x.uid === r.dataset.eqRemover); if (!m) return;
        if (!(await customConfirm('Tirar o acesso?', `${m.email} deixa de entrar no painel desta loja.`))) return;
        try { await api({ acao: 'remover', uid: m.uid }); showToast('Acesso retirado.'); await carregar(); } catch (err) { showToast(err.message, true); }
    });
    el().addEventListener('change', (e) => {
        if (e.target.id === 'eq-papel') { $('eq-papel-dica').textContent = PAPEIS[e.target.value][1]; return; }
        const s = e.target.closest('[data-eq-papel]'); if (!s) return;
        const m = S.equipe.find((x) => x.uid === s.dataset.eqPapel); if (m) definir(m.email, s.value);
    });
}
export async function abrirEquipe() {
    if (!el()) return;
    ligar();
    if (!S.equipe) { S.estado = 'carregando'; render(); }
    await carregar();
}
