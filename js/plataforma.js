// =====================================================================
//  js/plataforma.js — tela do DONO DA PLATAFORMA (plataforma.html).
//  Lista as lojas, cria loja, bloqueia/libera, liga módulos, define o
//  proprietário e monta as feiras. Tudo passa por /api/plataforma, que só
//  aceita quem tem  plataforma: true  no login. Esta tela não protege nada
//  sozinha: sem esse login, o servidor recusa.
// =====================================================================
import { auth, onAuthStateChanged } from './firebase.js';
import { urlDaLoja } from './tenant.js';
import { escapeHTML, fmt, showToast, customConfirm } from './utils.js';
import { sugerirId, idValido, totais, DIAS_SEMANA, diasEmTexto } from './plataforma-lib.js';
import './icones-admin.js';

const S = { dados: null, nova: false, novaFeira: false, ocupado: false };
const el = () => document.getElementById('pf-conteudo');
const $ = (id) => document.getElementById(id);
const NOMES_MODELO = { hortifruti: 'Hortifruti', espetinhos: 'Espetinhos', jantinha: 'Jantinha' };

async function api(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/plataforma', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não foi possível concluir.');
    return j;
}
const aviso = (titulo, texto, link) => { el().innerHTML = `<div class="pf-vazio"><b>${titulo}</b><p>${texto}</p>${link ? `<p><a class="btn-outline" style="display:inline-block;padding:12px 18px;margin-top:10px;text-decoration:none" href="./admin.html">${link}</a></p>` : ''}</div>`; };

// tipos de negócio que você mesmo escreveu em outras lojas: voltam como opção no cadastro
const tiposProprios = (d) => [...new Set(d.lojas.map((l) => l.tipo).filter((t) => t && !d.modelos.includes(t)))].sort((a, b) => a.localeCompare(b));

function lojaHtml(l, modulos) {
    return `
    <article class="pf-loja${l.ativo ? '' : ' bloq'}" data-loja="${escapeHTML(l.id)}">
        <div class="pf-loja-topo">
            <i class="pf-cor" style="background:${/^#[0-9a-fA-F]{6}$/.test(l.cor) ? l.cor : '#1a3a2a'}" aria-hidden="true"></i>
            <h4>${escapeHTML(l.nome)}<small>${escapeHTML(l.id)}${l.original ? ' · loja original' : ''}${l.tipo ? ` · ${escapeHTML(NOMES_MODELO[l.tipo] || l.tipo)}` : ''}</small></h4>
            <span class="pf-chip${l.ativo ? '' : ' bloq'}">${l.ativo ? 'Ativa' : 'Bloqueada'}</span>
        </div>
        <p class="pf-mes">${l.mes ? `Neste mês: <b>${fmt(l.mes.receita)}</b> em <b>${l.mes.pedidos}</b> pedido(s)` : 'Sem leitura do movimento deste mês.'}</p>
        <span class="pf-rotulo">Proprietário</span>
        ${l.donos.length ? `<ul class="pf-donos">${l.donos.map((e) => `<li><span>${escapeHTML(e)}</span><button type="button" data-pf="tirar-dono" data-email="${escapeHTML(e)}" aria-label="Tirar ${escapeHTML(e)}">&times;</button></li>`).join('')}</ul>` : `<p class="config-sub">${l.original ? 'A conta antiga da banca continua valendo. Novos proprietários aparecem aqui.' : 'Ninguém ainda: sem proprietário, ninguém abre o painel desta loja.'}</p>`}
        <div class="pf-add"><input type="email" inputmode="email" autocomplete="off" placeholder="e-mail do proprietário" aria-label="E-mail do novo proprietário de ${escapeHTML(l.nome)}"><button type="button" class="btn-outline" data-pf="dar-dono">Adicionar</button></div>
        ${l.original ? '' : `<span class="pf-rotulo">Tipo de negócio</span>
        <div class="pf-add pf-tipo"><input type="text" maxlength="30" autocomplete="off" value="${escapeHTML(NOMES_MODELO[l.tipo] || l.tipo || '')}" placeholder="Ex.: Padaria" aria-label="Tipo de negócio de ${escapeHTML(l.nome)}"><button type="button" class="btn-outline" data-pf="mudar-tipo">Salvar</button></div>`}
        <span class="pf-rotulo">Módulos ligados</span>
        <div class="pf-modulos">${Object.entries(modulos).map(([k, rot]) => `<label><input type="checkbox" data-pf-modulo="${k}"${l.modulos[k] ? ' checked' : ''}> ${escapeHTML(rot)}</label>`).join('')}</div>
        <div class="pf-acoes">
            <a class="btn-outline" href="${urlDaLoja(l.id, './')}" target="_blank" rel="noopener">Ver a loja</a>
            <a class="btn-outline" href="${urlDaLoja(l.id, './admin.html')}" target="_blank" rel="noopener">Abrir o painel</a>
            <button type="button" class="btn-outline${l.ativo ? ' pf-perigo' : ''}" data-pf="${l.ativo ? 'bloquear' : 'liberar'}">${l.ativo ? 'Bloquear' : 'Liberar'}</button>
        </div>
    </article>`;
}
function feiraHtml(f, lojas, nova) {
    return `
    <div class="pf-feira" data-feira="${escapeHTML(f.id)}">
        ${nova ? `<div class="form-group"><label for="pf-feira-nome">Nome da feira</label><input type="text" id="pf-feira-nome" maxlength="60" placeholder="Ex.: Atenas (quarta)" autocomplete="off"></div>` : `<div class="form-group"><label>Nome da feira</label><input type="text" data-pf-feira-nome maxlength="60" value="${escapeHTML(f.nome)}" autocomplete="off"></div>`}
        <span class="pf-rotulo">Dias da semana${nova ? '' : ` · ${escapeHTML(diasEmTexto(f.dias))}`}</span>
        <div class="pf-modulos">${DIAS_SEMANA.map((d, i) => `<label><input type="checkbox" data-pf-feira-dia="${i}"${(f.dias || []).includes(i) ? ' checked' : ''}> ${d}</label>`).join('')}</div>
        <small class="dica-campo">Sem dia marcado, a feira vale para todos os dias.</small>
        <span class="pf-rotulo">Lojas que vão nesta feira</span>
        <div class="pf-modulos">${lojas.map((l) => `<label><input type="checkbox" data-pf-feira-loja="${escapeHTML(l.id)}"${f.lojas.includes(l.id) ? ' checked' : ''}> ${escapeHTML(l.nome)}</label>`).join('')}</div>
        <div class="pf-acoes"><button type="button" class="btn-outline" data-pf="salvar-feira">${nova ? 'Criar feira' : 'Salvar'}</button>${nova ? '<button type="button" class="btn-outline" data-pf="cancelar-feira">Cancelar</button>' : '<button type="button" class="btn-outline pf-perigo" data-pf="desfazer-feira">Desfazer feira</button>'}</div>
    </div>`;
}
function render() {
    const d = S.dados, t = totais(d.lojas);
    el().innerHTML = `
    <div class="pf-resumo"><div><b>${t.ativas}<small style="font-size:.6em"> de ${t.lojas}</small></b><span>lojas ativas</span></div><div><b>${fmt(t.receita)}</b><span>vendido no mês</span></div><div><b>${t.pedidos}</b><span>pedidos no mês</span></div></div>
    <div class="pf-secao"><h3>Lojas</h3><button class="btn-outline" data-pf="nova">${S.nova ? 'Fechar' : '+ Nova loja'}</button></div>
    ${S.nova ? `
    <div class="pf-form">
        <div class="form-group"><label for="pf-nome">Nome da loja</label><input type="text" id="pf-nome" maxlength="60" autocomplete="off" placeholder="Ex.: Espetinhos do Zé"></div>
        <div class="form-group"><label for="pf-id">Endereço</label><input type="text" id="pf-id" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="espetinhos-do-ze"><small class="dica-campo" id="pf-id-dica">Não muda depois. Só letras minúsculas, números e hífen.</small></div>
        <div class="form-group"><label for="pf-modelo">Tipo de negócio</label><select id="pf-modelo">${d.modelos.map((m) => `<option value="${escapeHTML(m)}">${escapeHTML(NOMES_MODELO[m] || m)}</option>`).join('')}${tiposProprios(d).map((t) => `<option value="c:${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('')}<option value="__novo">+ Outro tipo (escrever)…</option></select><small class="dica-campo">Não achou o seu? Escolha "Outro tipo" e escreva.</small></div>
        <div class="form-group" id="pf-grupo-tipo" hidden><label for="pf-tipo-nome">Qual é o tipo de negócio?</label><input type="text" id="pf-tipo-nome" maxlength="30" autocomplete="off" placeholder="Ex.: Padaria"></div>
        <div class="form-group" id="pf-grupo-base" hidden><label for="pf-base">Começar com a aparência de</label><select id="pf-base">${d.modelos.map((m) => `<option value="${escapeHTML(m)}">${escapeHTML(NOMES_MODELO[m] || m)}</option>`).join('')}</select><small class="dica-campo">São só as cores e fontes iniciais. O proprietário muda depois na aba Aparência.</small></div>
        <div class="form-group"><label for="pf-dono">E-mail do proprietário (opcional)</label><input type="email" id="pf-dono" inputmode="email" autocomplete="off" placeholder="nome@email.com"></div>
        <div class="pf-largo"><button class="btn-salvar-config" data-pf="criar">Criar loja</button></div>
    </div>` : ''}
    <div class="pf-lojas">${d.lojas.map((l) => lojaHtml(l, d.modulos)).join('')}</div>
    <div class="pf-secao"><h3>Feiras</h3><button class="btn-outline" data-pf="nova-feira">${S.novaFeira ? 'Fechar' : '+ Nova feira'}</button></div>
    ${S.novaFeira ? feiraHtml({ id: '', nome: '', dias: [], lojas: [] }, d.lojas, true) : ''}
    ${d.feiras.length ? d.feiras.map((f) => feiraHtml(f, d.lojas, false)).join('') : (S.novaFeira ? '' : `<p class="config-sub">Nenhuma feira. Cada feira tem os seus dias da semana e as lojas que vão nela. No dia da feira, o cliente vê só essas lojas na faixa do topo e troca de uma para a outra deslizando o dedo. A faixa aparece quando a feira tem duas lojas ou mais.</p>`)}
    <div class="pf-secao"><h3>PIX automático (PagBank)</h3><span class="pf-chip${d.pix ? '' : ' bloq'}">${d.pix ? 'Chave guardada' : 'Sem chave'}</span></div>
    <p class="config-sub">${d.pix ? 'A chave do PagBank está guardada. Para o PIX aparecer para o cliente, ligue também "PIX automático" nas Configurações do painel da loja. Para trocar a chave, cole a nova abaixo.' : 'Cole aqui o token da conta PagBank (no site do PagBank: Integrações → Token). Depois, ligue "PIX automático" nas Configurações do painel da loja. Vale para a loja original.'}</p>
    <div class="pf-add pf-imgbb"><input type="password" id="pf-pagbank" autocomplete="off" spellcheck="false" maxlength="300" placeholder="token do PagBank" aria-label="Token do PagBank"><button type="button" class="btn-outline" data-pf="salvar-pagbank">Salvar</button></div>
    <div class="pf-secao"><h3>Fotos dos produtos</h3><span class="pf-chip${d.fotos ? '' : ' bloq'}">${d.fotos ? 'Envio automático ligado' : 'Desligado'}</span></div>
    <p class="config-sub">${d.fotos ? 'As lojas enviam as fotos pelo painel (Produtos → "Enviar várias fotos") e elas vão sozinhas para o ImgBB. Para trocar a chave, cole a nova abaixo.' : 'Com a chave do ImgBB, as lojas escolhem as fotos no painel e o sistema envia todas de uma vez e já grava em cada produto. Para pegar a chave (grátis): entre em imgbb.com, crie a conta, abra api.imgbb.com e toque em "Get API key".'}</p>
    <div class="pf-add pf-imgbb"><input type="password" id="pf-imgbb" autocomplete="off" spellcheck="false" maxlength="40" placeholder="chave do ImgBB (32 letras e números)" aria-label="Chave do ImgBB"><button type="button" class="btn-outline" data-pf="salvar-imgbb">Salvar</button></div>
    <p class="config-sub cal-nota">Ao bloquear uma loja, ela para de receber pedidos, vender no balcão e mexer no estoque; o cadastro de produtos continua editável pelo proprietário.</p>`;
}
async function carregar() { S.dados = await api({ acao: 'lojas' }); render(); }
async function fazer(corpo, ok) {
    if (S.ocupado) return false; S.ocupado = true;
    try { await api(corpo); if (ok) showToast(ok); await carregar(); return true; }
    catch (e) { showToast(e.message, true); return false; }
    finally { S.ocupado = false; }
}

function ligar() {
    el().addEventListener('input', (e) => {
        if (e.target.id === 'pf-nome' && !$('pf-id').dataset.mexido) $('pf-id').value = sugerirId(e.target.value);
        if (e.target.id === 'pf-id') { e.target.dataset.mexido = '1'; }
        if (e.target.id === 'pf-nome' || e.target.id === 'pf-id') $('pf-id-dica').textContent = idValido($('pf-id').value) ? `A loja abre em ${urlDaLoja($('pf-id').value, '/').replace(/^https:\/\//, '')} · não muda depois.` : 'Não muda depois. Só letras minúsculas, números e hífen.';
    });
    el().addEventListener('change', async (e) => {
        if (e.target.id === 'pf-modelo') {          // tipo fora da lista: pede o nome e a aparência de partida
            const v = e.target.value, proprio = v === '__novo' || v.startsWith('c:');
            $('pf-grupo-tipo').hidden = v !== '__novo'; $('pf-grupo-base').hidden = !proprio;
            if (v === '__novo') $('pf-tipo-nome').focus();
            return;
        }
        const m = e.target.closest('[data-pf-modulo]'); if (!m) return;
        const id = m.closest('[data-loja]').dataset.loja, nome = S.dados.modulos[m.dataset.pfModulo];
        if (!(await fazer({ acao: 'modulos', id, modulos: { [m.dataset.pfModulo]: m.checked } }, `${nome}: ${m.checked ? 'ligado' : 'desligado'}.`))) m.checked = !m.checked;
    });
    el().addEventListener('click', async (e) => {
        const b = e.target.closest('[data-pf]'); if (!b) return;
        const a = b.dataset.pf, card = b.closest('[data-loja]'), id = card && card.dataset.loja, loja = id && S.dados.lojas.find((l) => l.id === id);
        if (a === 'nova') { S.nova = !S.nova; render(); if (S.nova) $('pf-nome').focus(); return; }
        if (a === 'nova-feira') { S.novaFeira = !S.novaFeira; render(); if (S.novaFeira) { $('pf-feira-nome').focus(); $('pf-feira-nome').closest('.pf-feira').scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
        if (a === 'cancelar-feira') { S.novaFeira = false; render(); return; }
        if (a === 'criar') {
            const nome = $('pf-nome').value.trim(), nid = $('pf-id').value.trim(), emailDono = $('pf-dono').value.trim().toLowerCase();
            if (nome.length < 2) return showToast('Dê um nome para a loja.', true);
            if (!idValido(nid)) return showToast('Confira o endereço: só letras minúsculas, números e hífen.', true);
            const escolha = $('pf-modelo').value, proprio = escolha === '__novo' || escolha.startsWith('c:');
            const tipoNome = escolha === '__novo' ? $('pf-tipo-nome').value.trim() : escolha.startsWith('c:') ? escolha.slice(2) : '';
            if (escolha === '__novo' && tipoNome.length < 2) return showToast('Escreva o tipo de negócio.', true);
            if (await fazer({ acao: 'criar-loja', id: nid, nome, modelo: proprio ? $('pf-base').value : escolha, tipoNome, emailDono }, `Loja "${nome}" criada.`)) { S.nova = false; render(); }
            return;
        }
        if (a === 'bloquear') {
            if (!(await customConfirm(`Bloquear ${loja.nome}?`, `A loja para de receber pedidos, e o painel dela deixa de vender no balcão e de mexer no estoque${loja.original ? '. ATENÇÃO: esta é a loja original, que está no ar' : ''}. Você pode liberar de novo quando quiser.`))) return;
            return fazer({ acao: 'ativo', id, ativo: false }, 'Loja bloqueada.');
        }
        if (a === 'liberar') return fazer({ acao: 'ativo', id, ativo: true }, 'Loja liberada.');
        if (a === 'salvar-pagbank') {
            const chave = $('pf-pagbank').value.trim();
            if (chave.length < 20 || /\s/.test(chave)) return showToast('O token do PagBank é longo e não tem espaços. Confira se copiou inteiro.', true);
            return fazer({ acao: 'pagbank', chave }, 'Chave do PagBank guardada. Agora ligue "PIX automático" nas Configurações da loja.');
        }
        if (a === 'salvar-imgbb') {
            const chave = $('pf-imgbb').value.trim();
            if (!/^[a-f0-9]{32}$/i.test(chave)) return showToast('A chave do ImgBB tem 32 letras e números. Confira se copiou inteira.', true);
            return fazer({ acao: 'imgbb', chave }, 'Chave guardada. O envio automático de fotos está ligado.');
        }
        if (a === 'mudar-tipo') {
            const novo = card.querySelector('.pf-tipo input').value.trim();
            if (novo.length < 2) return showToast('Escreva o tipo de negócio.', true);
            return fazer({ acao: 'tipo', id, tipo: novo }, `${loja.nome} agora é "${novo}".`);
        }
        if (a === 'dar-dono') {
            const campo = card.querySelector('.pf-add:not(.pf-tipo):not(.pf-imgbb) input'), email = campo.value.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return showToast('Confira o e-mail.', true);
            return fazer({ acao: 'proprietario', id, email }, `${email} agora é proprietário de ${loja.nome}.`);
        }
        if (a === 'tirar-dono') {
            if (!(await customConfirm('Tirar o proprietário?', `${b.dataset.email} deixa de abrir o painel de ${loja.nome}.`))) return;
            return fazer({ acao: 'proprietario', id, email: b.dataset.email, remover: true }, 'Proprietário retirado.');
        }
        const fc = b.closest('[data-feira]');
        if (a === 'salvar-feira') {
            const nova = !fc.dataset.feira, nome = (nova ? $('pf-feira-nome') : fc.querySelector('[data-pf-feira-nome]')).value.trim();
            const lojas = [...fc.querySelectorAll('[data-pf-feira-loja]:checked')].map((c) => c.dataset.pfFeiraLoja), fid = nova ? sugerirId(nome) : fc.dataset.feira;
            const dias = [...fc.querySelectorAll('[data-pf-feira-dia]:checked')].map((c) => Number(c.dataset.pfFeiraDia));
            if (nome.length < 2 || !idValido(fid)) return showToast('Dê um nome para a feira.', true);
            if (lojas.length < 1) return showToast('Marque pelo menos uma loja.', true);
            if (nova && S.dados.feiras.some((f) => f.id === fid)) return showToast('Já existe uma feira com este nome.', true);
            if (await fazer({ acao: 'feira', fid, nome, dias, lojas }, lojas.length < 2 ? 'Feira salva. A faixa de lojas aparece quando ela tiver duas lojas ou mais.' : 'Feira salva.')) { S.novaFeira = false; render(); }
            return;
        }
        if (a === 'desfazer-feira') {
            if (!(await customConfirm('Desfazer a feira?', 'As lojas continuam funcionando; só deixam de aparecer juntas.'))) return;
            return fazer({ acao: 'feira', fid: fc.dataset.feira, nome: '', lojas: [] }, 'Feira desfeita.');
        }
    });
}

let ligado = false;
onAuthStateChanged(auth, async (user) => {
    if (!user) return aviso('Entre primeiro pelo painel.', 'Depois de entrar com o seu e-mail, volte para esta página.', 'Ir para o painel');
    try {
        const { claims } = await user.getIdTokenResult(true);
        if (claims.plataforma !== true) {
            const donoDaOriginal = claims.admin === true || (claims.tenants && claims.tenants.banca === 'proprietario');
            if (!donoDaOriginal) return aviso('Área do dono da plataforma.', 'Esta conta cuida de uma loja, não da plataforma.', 'Voltar ao painel');
            // a plataforma já tem dono: esta conta cuida só da loja, e o botão de assumir nem aparece
            const sit = await api({ acao: 'situacao' });
            if (sit.temDono) return aviso('Área do dono da plataforma.', 'A plataforma já tem dono. Esta conta cuida da loja, pelo painel.', 'Voltar ao painel');
            el().innerHTML = `<div class="pf-vazio"><b>Assumir a plataforma</b><p>Daqui você cria outras lojas, escolhe o dono de cada uma e liga os módulos. Só uma conta pode ser a dona da plataforma, e esta escolha vale uma vez.</p><p><button class="btn-salvar-config" id="pf-assumir" style="margin-top:10px">Assumir com ${escapeHTML(user.email || 'esta conta')}</button></p></div>`;
            $('pf-assumir').addEventListener('click', async (ev) => {
                ev.target.disabled = true;
                try { await api({ acao: 'assumir' }); await user.getIdToken(true); if (!ligado) { ligar(); ligado = true; } await carregar(); showToast('Pronto: esta conta agora cuida da plataforma.'); }
                catch (e) { showToast(e.message, true); ev.target.disabled = false; }
            });
            return;
        }
        if (!ligado) { ligar(); ligado = true; }
        await carregar();
    } catch (e) { aviso('Não consegui carregar.', escapeHTML(e.message || 'Confira a internet e recarregue a página.')); }
});
