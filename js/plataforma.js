// =====================================================================
//  js/plataforma.js — tela do DONO DA PLATAFORMA (plataforma.html).
//
//  Abas: Feiras · Lojas · Condomínios · Mensalidades · Chaves.
//  A lista de cada aba é curta; tocar num item abre uma FOLHA de edição com o
//  botão de salvar sempre à vista. Assim, salvar uma coisa nunca apaga o que
//  estava sendo digitado em outra (antes a página inteira era redesenhada).
//
//  Tudo passa por /api/plataforma, que só aceita quem tem  plataforma: true
//  no login. Esta tela não protege nada sozinha: sem esse login, o servidor recusa.
// =====================================================================
import './erros-site.js';   // primeiro: avisa o servidor se algo quebrar (aba Erros da Plataforma)
import { auth, onAuthStateChanged, getDoc, doc, db } from './firebase.js';
import { urlDaLoja } from './tenant.js';
import { contatoDaLoja } from './contato-lib.js';
import { escapeHTML, fmt, showToast, customConfirm } from './utils.js';
import { sugerirId, idValido, totais, diasDaFeira, textoDoDia, proximaEntrega, normCond } from './plataforma-lib.js';
import { CAMPOS_PRODUTO, camposDaLoja } from './cadastro-lib.js';
import { listaGuardada, guardarDaPlataforma } from './lojas-rapido.js';
const diasEmTexto = (dias) => diasDaFeira(dias);
import './icones-admin.js';

const ABAS = ['feiras', 'lojas', 'condominios', 'mensalidades', 'chaves', 'erros'];
const lerAba = () => { try { const a = localStorage.getItem('pf_aba'); return ABAS.includes(a) ? a : 'feiras'; } catch (_) { return 'feiras'; } };
const S = { dados: null, aba: lerAba(), busca: { lojas: '', condominios: '' }, folha: null, rascunho: null, ocupado: false, editandoCond: '', mensal: {}, confirmando: 0 };
const el = () => document.getElementById('pf-conteudo');
const $ = (id) => document.getElementById(id);
const NOMES_MODELO = { hortifruti: 'Hortifruti', espetinhos: 'Espetinhos', jantinha: 'Jantinha', padaria: 'Padaria', acai: 'Açaí', pastelacai: 'Pastel e açaí', mercadinho: 'Mercadinho', doceria: 'Doceria' };
const FORMATOS = { ql: 'Quadra e lote', rua: 'Rua e número', livre: 'Endereço escrito' };
const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'], NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const corOk = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#1a3a2a');
const linkDaFeira = (fid) => `${location.origin}/feira/${fid}`;
const reais = (v) => String(Number(v).toFixed(2)).replace('.', ',');

async function api(corpo) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/plataforma', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não foi possível concluir.');
    return j;
}
const confirmar = async (...args) => { S.confirmando++; try { return await customConfirm(...args); } finally { setTimeout(() => { S.confirmando--; }, 0); } };
/** "1.500,00" / "1500,5" / "59.9" → número; '' → ''; texto que não é valor → NaN. */
function lerReais(v) {
    let t = String(v == null ? '' : v).trim().replace(/^R\$\s*/i, ''); if (!t) return '';
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}
const aviso = (titulo, texto, link) => { el().innerHTML = `<div class="pf-vazio"><b>${titulo}</b><p>${texto}</p>${link ? `<p><a class="pf-bt" href="./admin.html">${link}</a></p>` : ''}</div>`; };

// ---------------------------------------------------------------- partes reutilizadas
/** A semana da feira: as 7 letras, com os dias da feira marcados. Editável no editor de feira. */
function semanaHtml(dias, editavel) {
    const marcados = new Set(dias || []), todos = !marcados.size;
    return `<div class="pf-semana${editavel ? ' editavel' : ''}${todos && !editavel ? ' todos' : ''}" ${editavel ? 'role="group" aria-label="Dias da feira"' : `aria-label="${escapeHTML(diasEmTexto(dias))}"`}>${LETRAS.map((l, i) => editavel
        ? `<button type="button" class="pf-dia${marcados.has(i) ? ' on' : ''}" data-pf-dia="${i}" aria-pressed="${marcados.has(i)}" aria-label="${NOMES_DIA[i]}">${l}</button>`
        : `<span class="pf-dia${marcados.has(i) || todos ? ' on' : ''}" aria-hidden="true">${l}</span>`).join('')}</div>`;
}
const lojaPorId = (id) => (S.dados.lojas || []).find((l) => l.id === id);
const feirasDaLoja = (id) => (S.dados.feiras || []).filter((f) => f.lojas.includes(id));
const feirasDoCond = (cid) => (S.dados.feiras || []).filter((f) => (f.condominiosIds || []).includes(cid));
const ponto = (cor) => `<i class="pf-ponto" style="background:${corOk(cor)}" aria-hidden="true"></i>`;

// ---------------------------------------------------------------- abas
function render() {
    // a aba pode ser tocada antes de a lista da plataforma chegar (ou se ela falhar): mostra "carregando", não quebra
    if (!S.dados) {
        // a lista completa leva alguns segundos (lê o movimento de cada loja): enquanto isso, as lojas da última vez, já com link para o painel
        const guardadas = S.aba === 'lojas' ? listaGuardada() : [];
        el().innerHTML = guardadas.length
            ? `<p class="config-sub" role="status">Atualizando os números...</p><ul class="pf-lista">${guardadas.map((l) => `<li class="pf-linha-wrap"><span class="pf-linha${l.ativo ? '' : ' bloq'}">${ponto(l.cor)}<span class="pf-linha-txt"><b>${escapeHTML(l.nome)}</b><small>${escapeHTML(l.original ? 'Loja original' : NOMES_MODELO[l.tipo] || l.tipo || 'Loja')}${l.ativo ? '' : ', bloqueada'}</small></span></span><a class="pf-bt mini pf-painel" href="${escapeHTML(urlDaLoja(l.id, '/admin'))}">Painel</a></li>`).join('')}</ul>`
            : '<p class="pf-vazio">Carregando a plataforma...</p>';
        return;
    }
    const d = S.dados, t = totais(d.lojas), mensal = d.lojas.reduce((s, l) => s + (l.assinatura ? l.assinatura.valor : 0), 0);
    $('pf-resumo').textContent = `${t.ativas} de ${t.lojas} lojas ativas, ${fmt(t.receita)} vendidos e ${t.pedidos} pedidos neste mês${mensal ? `, ${fmt(mensal)} em mensalidades` : ''}.`;
    const abas = $('pf-abas'); abas.hidden = false;
    abas.querySelectorAll('[data-aba]').forEach((b) => { const on = b.dataset.aba === S.aba; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    el().innerHTML = { feiras: abaFeiras, lojas: abaLojas, condominios: abaCondominios, mensalidades: abaMensalidades, chaves: abaChaves, erros: abaErros }[S.aba]();
    if (S.aba === 'erros' && S.erros === undefined) carregarErros();
}

function abaFeiras() {
    const d = S.dados;
    const lista = d.feiras.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((f) => {
        const prox = proximaEntrega(f), bancas = f.lojas.map(lojaPorId).filter(Boolean), conds = (f.condominiosIds || []).length;
        const alertas = [];
        if (!conds) alertas.push('Sem condomínio marcado: quem chega sem o link não cai nesta feira.');
        bancas.filter((l) => !l.ativo).forEach((l) => alertas.push(`${l.nome} está bloqueada e não aparece para os clientes.`));
        if (bancas.filter((l) => l.ativo).length === 1) alertas.push('Só uma banca ativa: o link abre direto nela.');
        return `<article class="pf-feira-item">
            <div class="pf-feira-topo"><h3>${escapeHTML(f.nome)}</h3>${semanaHtml(f.dias, false)}</div>
            <p class="pf-feira-prox">${prox ? (prox.hoje ? 'Acontece hoje.' : `Próxima: ${escapeHTML(textoDoDia(prox.dia))}.`) : 'Sem data nas próximas semanas.'}${f.horaLimite ? ` Pedido para o mesmo dia até ${escapeHTML(f.horaLimite)}.` : ''}</p>
            <p class="pf-feira-bancas">${bancas.map((l) => `<span>${ponto(l.cor)}${escapeHTML(l.nome)}</span>`).join('')}</p>
            <p class="pf-feira-conds">${conds ? `${conds} condomínio${conds > 1 ? 's' : ''}: ${escapeHTML(d.condominios.filter((c) => f.condominiosIds.includes(c.id)).map((c) => c.nome).join(', '))}` : 'Nenhum condomínio.'}</p>
            ${alertas.length ? `<ul class="pf-alertas">${alertas.map((a) => `<li>${escapeHTML(a)}</li>`).join('')}</ul>` : ''}
            <div class="pf-linha-bts"><button type="button" class="pf-bt" data-pf="copiar-link" data-feira="${escapeHTML(f.id)}">Copiar link</button><button type="button" class="pf-bt" data-pf="cartaz-feira" data-feira="${escapeHTML(f.id)}">Cartaz com QR</button><button type="button" class="pf-bt pri" data-pf="editar-feira" data-feira="${escapeHTML(f.id)}">Editar</button></div>
        </article>`;
    }).join('');
    return `<div class="pf-topo-aba"><p>Cada feira tem os seus dias, as suas bancas e os condomínios que atende. Quem abre o link da feira vê só as bancas dela.</p><button type="button" class="pf-bt pri" data-pf="nova-feira">Nova feira</button></div>
        ${lista || `<div class="pf-vazio"><b>Nenhuma feira ainda.</b><p>Comece cadastrando os condomínios (aba Condomínios) e depois crie a feira.</p></div>`}`;
}

function abaLojas() {
    const d = S.dados, termo = normCond(S.busca.lojas);
    const lojas = d.lojas.filter((l) => !termo || normCond(`${l.nome} ${l.id}`).includes(termo));
    return `<div class="pf-topo-aba"><input type="search" class="pf-busca" data-busca="lojas" placeholder="Buscar loja" value="${escapeHTML(S.busca.lojas)}" aria-label="Buscar loja"><button type="button" class="pf-bt pri" data-pf="nova-loja">Nova loja</button></div>
    <ul class="pf-lista">${lojas.map((l) => `<li class="pf-linha-wrap"><button type="button" class="pf-linha${l.ativo ? '' : ' bloq'}" data-pf="abrir-loja" data-loja="${escapeHTML(l.id)}">
        ${ponto(l.cor)}<span class="pf-linha-txt"><b>${escapeHTML(l.nome)}</b><small>${escapeHTML(l.original ? 'Loja original' : NOMES_MODELO[l.tipo] || l.tipo || 'Loja')}${feirasDaLoja(l.id).length ? `, em ${feirasDaLoja(l.id).length} feira${feirasDaLoja(l.id).length > 1 ? 's' : ''}` : ''}${l.donos.length ? '' : ', sem proprietário'}</small></span>
        <span class="pf-linha-num"><b>${l.mes ? fmt(l.mes.receita) : '–'}</b><small>${l.ativo ? `${l.mes ? l.mes.pedidos : 0} pedidos no mês` : 'Bloqueada'}</small></span>
    </button><a class="pf-bt mini pf-painel" href="${escapeHTML(urlDaLoja(l.id, '/admin'))}" aria-label="Abrir o painel de ${escapeHTML(l.nome)}">Painel</a></li>`).join('') || '<li class="pf-nada">Nenhuma loja com esse nome.</li>'}</ul>`;
}

function abaCondominios() {
    const d = S.dados, termo = normCond(S.busca.condominios);
    const conds = d.condominios.filter((c) => !termo || normCond(c.nome).includes(termo));
    return `<div class="pf-novo-cond">
        <p>Cadastre aqui os condomínios atendidos. Depois, em cada feira, é só marcar quais ela atende. O formato muda os campos de endereço que o cliente preenche.</p>
        <div class="pf-form-linha"><input type="text" id="pf-cond-nome" maxlength="80" placeholder="Nome do condomínio" aria-label="Nome do novo condomínio" autocomplete="off">${formatoSelect('pf-cond-formato', 'ql')}<button type="button" class="pf-bt pri" data-pf="cadastrar-cond">Cadastrar</button></div>
    </div>
    ${d.condominios.length > 8 ? `<input type="search" class="pf-busca largo" data-busca="condominios" placeholder="Buscar condomínio" value="${escapeHTML(S.busca.condominios)}" aria-label="Buscar condomínio">` : ''}
    <ul class="pf-lista">${conds.map((c) => {
        const em = feirasDoCond(c.id);
        if (S.editandoCond === c.id) return `<li class="pf-cond editando" data-cond="${escapeHTML(c.id)}"><div class="pf-form-linha"><input type="text" data-cond-nome maxlength="80" value="${escapeHTML(c.nome)}" aria-label="Nome do condomínio">${formatoSelect('', c.formato, 'data-cond-formato')}</div>
            <div class="pf-linha-bts"><button type="button" class="pf-bt" data-pf="cancelar-cond">Cancelar</button><button type="button" class="pf-bt pri" data-pf="salvar-cond">Salvar</button></div></li>`;
        return `<li class="pf-cond" data-cond="${escapeHTML(c.id)}"><span class="pf-linha-txt"><b>${escapeHTML(c.nome)}</b><small>${FORMATOS[c.formato] || FORMATOS.ql}. ${em.length ? `Usado em: ${escapeHTML(em.map((f) => f.nome).join(', '))}.` : 'Ainda não está em nenhuma feira.'}</small></span>
            <span class="pf-cond-bts"><button type="button" class="pf-bt mini" data-pf="editar-cond">Mudar</button><button type="button" class="pf-bt mini perigo" data-pf="tirar-cond"${em.length ? ' disabled title="Tire das feiras antes"' : ''}>Tirar</button></span></li>`;
    }).join('') || `<li class="pf-nada">${d.condominios.length ? 'Nenhum condomínio com esse nome.' : 'Nenhum condomínio cadastrado.'}</li>`}</ul>`;
}
const formatoSelect = (id, atual, attr = '') => `<select ${id ? `id="${id}"` : ''} ${attr} aria-label="Formato do endereço">${Object.entries(FORMATOS).map(([k, r]) => `<option value="${k}"${k === atual ? ' selected' : ''}>${r}</option>`).join('')}</select>`;

function abaMensalidades() {
    const d = S.dados, comValor = d.lojas.filter((l) => l.assinatura), total = comValor.reduce((s, l) => s + l.assinatura.valor, 0);
    return `<div class="pf-topo-aba"><p>Só você vê esta lista. Cada proprietário vê apenas a mensalidade da própria banca, na aba Equipe do painel dele.</p></div>
    <p class="pf-total">Previsto por mês: <b>${fmt(total)}</b>, de ${comValor.length} banca${comValor.length === 1 ? '' : 's'}.</p>
    <ul class="pf-lista">${d.lojas.map((l) => { const r = S.mensal[l.id]; const val = (k, salvo) => escapeHTML(r && r[k] !== undefined ? r[k] : salvo); return `<li class="pf-mensal${l.ativo ? '' : ' bloq'}${r ? ' mudou' : ''}" data-loja="${escapeHTML(l.id)}">
        <span class="pf-linha-txt">${ponto(l.cor)}<b>${escapeHTML(l.nome)}</b>${l.ativo ? '' : '<small>Bloqueada</small>'}</span>
        <div class="pf-mensal-campos">
            <label>R$ <input type="text" inputmode="decimal" data-m="valor" value="${val('valor', l.assinatura ? reais(l.assinatura.valor) : '')}" placeholder="0,00" aria-label="Mensalidade de ${escapeHTML(l.nome)}"></label>
            <label>dia <input type="number" inputmode="numeric" min="1" max="28" data-m="dia" value="${val('dia', l.assinatura && l.assinatura.dia ? String(l.assinatura.dia) : '')}" placeholder="10" aria-label="Dia do vencimento"></label>
            <input type="text" maxlength="140" data-m="obs" value="${val('obs', l.assinatura ? l.assinatura.obs || '' : '')}" placeholder="Observação" aria-label="Observação">
            <button type="button" class="pf-bt mini pri" data-pf="salvar-mensal"${r ? '' : ' disabled'}>Salvar</button>
        </div></li>`; }).join('')}</ul>`;
}

// PIX pelo Asaas: chave da conta da plataforma, o aviso (webhook) para cadastrar lá e a carteira de cada banca.
function secaoAsaas(d) {
    const a = d.asaas || {}, amb = a.ambiente === 'producao' ? 'produção' : 'teste (sandbox)';
    const copiar = (rotulo, valor) => `<div class="pf-copiar"><span>${rotulo}</span><input type="text" readonly value="${escapeHTML(valor)}" aria-label="${rotulo}"><button type="button" class="pf-bt mini" data-pf="copiar-texto" data-copiar="${escapeHTML(valor)}">Copiar</button></div>`;
    const outras = (d.lojas || []).filter((l) => !l.original);
    return `<section class="pf-chave"><div class="pf-chave-topo"><h3>PIX automático (Asaas)</h3><span class="pf-selo${a.ligado ? ' ok' : ''}">${a.ligado ? `Ligado · ${amb}` : 'Sem chave'}</span></div>
        <p>${a.ligado ? 'Com o Asaas ligado, o PIX de todas as lojas sai por ele (o PagBank fica de lado). A loja original recebe na conta da plataforma; cada outra banca recebe na carteira dela, cadastrada abaixo.' : 'Cole a chave da API da conta Asaas da plataforma (no Asaas: Integrações, Chaves de API). Comece com a chave do sandbox para testar sem dinheiro de verdade.'}</p>
        ${a.viaAmbiente ? '<p>A chave está no servidor (variável ASAAS_API_KEY): para trocar, mude lá.</p>' : `<div class="pf-form-linha"><input type="password" id="pf-asaas" autocomplete="off" spellcheck="false" maxlength="420" placeholder="Chave da API ($aact_...)" aria-label="Chave da API do Asaas"><button type="button" class="pf-bt pri" data-pf="salvar-asaas">Salvar</button></div>`}
        ${a.ligado && !a.viaAmbiente ? '<div class="pf-asaas-desligar"><button type="button" class="pf-bt" data-pf="desligar-asaas">Desligar o Asaas</button><small>Apaga a chave e desliga o PIX automático das lojas. O cliente passa a pagar só pelo copia e cola da loja (com o valor do pedido).</small></div>' : ''}
        ${a.ligado ? `<div class="pf-asaas-aviso"><b>Cadastre o aviso de pagamento no Asaas</b><small>Integrações → Webhooks → Adicionar Webhook. Cole a URL e o token abaixo e marque os eventos de cobrança <b>PAYMENT_RECEIVED</b> e <b>PAYMENT_CONFIRMED</b>.</small>
            ${a.urlAviso ? copiar('URL', a.urlAviso) : '<small>Falta PUBLIC_BASE_URL no servidor para montar a URL.</small>'}
            ${a.avisoViaAmbiente ? '<small>Token: o que está na variável ASAAS_WEBHOOK_TOKEN do servidor.</small>' : a.aviso ? copiar('Token', a.aviso) : ''}</div>
        <div class="pf-asaas-carteiras"><b>Carteira de cada banca</b><small>O walletId da conta Asaas da banca (formato 0b763922-aa88-4cbe-a567-e3fe8511fa06). Sem carteira, a loja não mostra PIX automático.${a.comissao ? ` Comissão da plataforma: ${a.comissao}%.` : ''}</small>
            ${outras.length ? outras.map((l) => `<div class="pf-copiar" data-loja="${escapeHTML(l.id)}"><span>${escapeHTML(l.nome)}</span><input type="text" data-carteira autocomplete="off" spellcheck="false" maxlength="40" value="${escapeHTML((a.carteiras || {})[l.id] || '')}" placeholder="walletId" aria-label="Carteira Asaas de ${escapeHTML(l.nome)}"><button type="button" class="pf-bt mini pri" data-pf="salvar-carteira">Salvar</button></div>`).join('') : '<small>Nenhuma outra loja ainda.</small>'}</div>` : ''}
    </section>`;
}

function abaChaves() {
    const d = S.dados;
    return `${secaoAsaas(d)}<section class="pf-chave"><div class="pf-chave-topo"><h3>PIX automático (PagBank)</h3><span class="pf-selo${d.pix ? ' ok' : ''}">${d.pix ? 'Chave guardada' : 'Sem chave'}</span></div>
        <p>${d.pix ? 'Para trocar, cole o novo token. Para o PIX aparecer ao cliente, ligue também "PIX automático" nas Configurações do painel da loja.' : 'Cole o token da conta PagBank (no site do PagBank: Integrações, Token). Depois ligue "PIX automático" nas Configurações do painel da loja. Vale para a loja original.'}</p>
        <div class="pf-form-linha"><input type="password" id="pf-pagbank" autocomplete="off" spellcheck="false" maxlength="300" placeholder="Token do PagBank" aria-label="Token do PagBank"><button type="button" class="pf-bt pri" data-pf="salvar-pagbank">Salvar</button></div></section>
    <section class="pf-chave"><div class="pf-chave-topo"><h3>Fotos dos produtos (ImgBB)</h3><span class="pf-selo${d.fotos ? ' ok' : ''}">${d.fotos ? 'Envio automático ligado' : 'Desligado'}</span></div>
        <p>${d.fotos ? 'As lojas enviam as fotos pelo painel e elas vão sozinhas para o ImgBB. Para trocar a chave, cole a nova.' : 'Com a chave do ImgBB, as lojas enviam várias fotos de uma vez pelo painel. Para pegar a chave (grátis): crie a conta em imgbb.com, abra api.imgbb.com e toque em "Get API key".'}</p>
        <div class="pf-form-linha"><input type="password" id="pf-imgbb" autocomplete="off" spellcheck="false" maxlength="40" placeholder="Chave do ImgBB (32 letras e números)" aria-label="Chave do ImgBB"><button type="button" class="pf-bt pri" data-pf="salvar-imgbb">Salvar</button></div></section>`;
}

// ---------------------------------------------------------------- erros do site (lib/erros.js)
async function carregarErros() {
    S.erros = null;                                   // null = carregando
    try { S.erros = (await api({ acao: 'erros' })).erros || []; } catch (e) { S.erros = { falha: e.message }; }
    if (S.aba === 'erros') render();
}
const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); } catch (_) { return ''; } };
// tipos: o que quebrou no código, defeito de desenho da tela (js/vigia-tela.js) e aviso do cliente ("Algo estranho na tela?")
const TIPO_ERRO = { visual: ['Tela', 'tela'], relato: ['Cliente avisou', 'relato'], erro: ['Código', 'codigo'], promessa: ['Código', 'codigo'], recurso: ['Arquivo', 'codigo'] };
const FILTROS_ERROS = [['abertos', 'Para olhar'], ['tela', 'Tela'], ['codigo', 'Código'], ['relato', 'Clientes'], ['corrigidos', 'Corrigidos']];
const aberto = (e) => !e.corrigidoEm || e.voltou;
const grupoDoErro = (e) => (TIPO_ERRO[e.tipo] || TIPO_ERRO.erro)[1];
function errosDoFiltro(lista, f) {
    if (f === 'corrigidos') return lista.filter((e) => !aberto(e));
    const abertos = lista.filter(aberto);
    return f === 'abertos' ? abertos : abertos.filter((e) => grupoDoErro(e) === f);
}
function abaErros() {
    const lista = S.erros;
    const topo = `<div class="pf-topo-aba"><p>O que deu erro no celular dos clientes e da equipe nos últimos 7 dias: no código, no <b>desenho da tela</b> (preço cortado, botão coberto, foto quebrada, com o tamanho da tela e da letra) e o que os <b>clientes avisaram</b>. O mesmo erro aparece uma vez, com o número de vezes. Consertou? Toque em <b>Corrigi</b>: se acontecer de novo, ele volta para a lista.</p><button type="button" class="pf-bt" data-pf="atualizar-erros">Atualizar</button></div>`;
    if (lista === null || lista === undefined) return `${topo}<p class="config-sub">Carregando...</p>`;
    if (lista.falha) return `${topo}<div class="pf-vazio"><b>Não consegui abrir a lista.</b><p>${escapeHTML(lista.falha)}</p></div>`;
    if (!lista.length) return `${topo}<div class="pf-vazio"><b>Nenhum erro nos últimos 7 dias.</b><p>Quando algo quebrar no aparelho de alguém, aparece aqui.</p></div>`;
    const f = S.filtroErros || 'abertos';
    const chips = `<div class="pf-filtros-erros" role="group" aria-label="Mostrar">${FILTROS_ERROS.map(([k, t]) => {
        const n = errosDoFiltro(lista, k).length;
        return `<button type="button" class="pf-filtro${k === f ? ' ativo' : ''}" data-pf="filtro-erros" data-filtro="${k}" aria-pressed="${k === f}">${t} <span>${n}</span></button>`;
    }).join('')}</div>`;
    const mostrar = errosDoFiltro(lista, f);
    const total = mostrar.reduce((t, e) => t + (Number(e.vezes) || 0), 0);
    const resumo = mostrar.length ? `<p class="pf-total"><b>${mostrar.length}</b> erro${mostrar.length > 1 ? 's' : ''} diferente${mostrar.length > 1 ? 's' : ''}, ${total} vez${total > 1 ? 'es' : ''} no total.</p>`
        : `<div class="pf-vazio"><b>${f === 'corrigidos' ? 'Nada marcado como corrigido.' : 'Nada para olhar aqui.'}</b><p>${f === 'corrigidos' ? 'Quando você tocar em "Corrigi" num erro, ele vem para cá.' : 'Bom sinal.'}</p></div>`;
    return `${topo}${chips}${resumo}
    <ul class="pf-lista pf-erros">${mostrar.map((e) => {
        const [rot, grupo] = TIPO_ERRO[e.tipo] || TIPO_ERRO.erro;
        const dias = (e.dias || []).length;
        return `<li class="pf-erro pf-erro--${grupo}${e.voltou ? ' voltou' : ''}">
        <div class="pf-erro-topo"><span class="pf-tipo-erro pf-tipo-erro--${grupo}">${rot}</span><b>${escapeHTML(e.msg)}</b><span class="pf-selo">${Number(e.vezes) || 1}×</span></div>
        ${e.voltou ? `<p class="pf-voltou">Voltou depois de corrigido (marcado em ${escapeHTML(quando(e.corrigidoEm))})</p>` : ''}
        ${(e.telas || []).length ? `<small>Telas: ${escapeHTML(e.telas.join(' · '))}</small>` : ''}
        <small>${escapeHTML(quando(e.ultimo))}${dias > 1 ? ` · em ${dias} dias` : ''}${e.onde ? ` · ${escapeHTML(e.onde)}` : ''} · ${escapeHTML((e.paginas || [e.pagina]).join(', '))}</small>
        <small>${escapeHTML((e.navegadores || []).join(', '))}${(e.lojas || []).length ? ` · lojas: ${escapeHTML(e.lojas.map((id) => (lojaPorId(id) || {}).nome || id).join(', '))}` : ''}</small>
        ${e.pilha ? `<details><summary>${grupo === 'codigo' ? 'Detalhe técnico' : 'Onde e como'}</summary><pre>${escapeHTML(e.pilha)}</pre></details>` : ''}
        <div class="pf-erro-acoes">${aberto(e)
            ? `<button type="button" class="pf-bt mini" data-pf="erro-corrigi" data-ass="${escapeHTML(e.assinatura || '')}">Corrigi</button>`
            : `<span class="pf-selo ok">Corrigido em ${escapeHTML(quando(e.corrigidoEm))}</span><button type="button" class="pf-bt mini" data-pf="erro-reabrir" data-ass="${escapeHTML(e.assinatura || '')}">Reabrir</button>`}</div>
    </li>`;
    }).join('')}</ul>`;
}
async function marcarErro(ass, estado) {
    const e = (Array.isArray(S.erros) ? S.erros : []).find((x) => x.assinatura === ass); if (!e) return;
    try {
        const r = await api({ acao: 'erro-estado', assinatura: ass, estado });
        if (estado === 'corrigido') { e.corrigidoEm = r.em || new Date().toISOString(); e.voltou = false; showToast('Marcado como corrigido. Se acontecer de novo, volta para a lista.'); }
        else { delete e.corrigidoEm; delete e.voltou; showToast('Reaberto.'); }
        render();
    } catch (err) { showToast(err.message, true); }
}

// ---------------------------------------------------------------- folha (edição)
function abrirFolha(tipo, id) {
    S.folha = { tipo, id: id || '' };
    if (tipo === 'feira') {
        const f = id ? S.dados.feiras.find((x) => x.id === id) : null;
        S.rascunho = { id: f ? f.id : '', nome: f ? f.nome : '', dias: new Set(f ? f.dias : []), lojas: new Set((f ? f.lojas : []).filter((id) => lojaPorId(id))), conds: new Set(f ? f.condominiosIds || [] : []), horaLimite: f ? f.horaLimite || '' : '', semFeira: f ? (f.semFeira || []).slice() : [], buscaCond: '', mudou: false };
    }
    pintarFolha();
    const fundo = $('pf-folha'); fundo.classList.add('aberto'); fundo.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    setTimeout(() => { const alvo = fundo.querySelector('[data-foco]') || fundo.querySelector('.pf-fechar'); alvo && alvo.focus({ preventScroll: true }); }, 60);
}
async function fecharFolha(forcar) {
    if (!forcar && S.ocupado) return showToast('Espere terminar de salvar.');
    if (!forcar && S.rascunho && S.rascunho.mudou && !(await confirmar('Sair sem salvar?', 'O que você mudou nesta feira vai se perder.', { ok: 'Sair sem salvar', nao: 'Continuar editando' }))) return;
    S.folha = null; S.rascunho = null;
    const fundo = $('pf-folha'); fundo.classList.remove('aberto'); fundo.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal-overlay.aberto')) document.body.style.overflow = '';
}
function pintarFolha() {
    if (!S.folha) return;
    const { tipo, id } = S.folha;
    const [titulo, corpo, pe] = tipo === 'feira' ? folhaFeira() : tipo === 'nova-loja' ? folhaNovaLoja() : folhaLoja(lojaPorId(id));
    $('pf-folha-titulo').textContent = titulo; $('pf-folha-corpo').innerHTML = corpo; $('pf-folha-pe').innerHTML = pe;
}

function folhaFeira() {
    const r = S.rascunho, d = S.dados, nova = !r.id;
    const termo = normCond(r.buscaCond);
    const conds = d.condominios.slice().sort((a, b) => (r.conds.has(b.id) - r.conds.has(a.id)) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const outrasFeiras = (cid) => feirasDoCond(cid).filter((f) => f.id !== r.id).map((f) => f.nome);
    const corpo = `
    <section class="pf-sec"><label class="pf-rot" for="pf-f-nome">Nome da feira</label><input type="text" id="pf-f-nome" data-foco maxlength="60" value="${escapeHTML(r.nome)}" placeholder="Ex.: Feira de quarta do Jardins" autocomplete="off">
        ${nova ? '<small class="pf-dica">O link da feira é criado a partir do nome e não muda depois.</small>' : `<div class="pf-link"><code>${escapeHTML(linkDaFeira(r.id))}</code><button type="button" class="pf-bt mini" data-pf="copiar-link" data-feira="${escapeHTML(r.id)}">Copiar</button></div>`}</section>
    <section class="pf-sec"><span class="pf-rot">Dias da feira</span>${semanaHtml([...r.dias], true)}<small class="pf-dica" id="pf-f-dias-txt">${escapeHTML(r.dias.size ? diasEmTexto([...r.dias]) : 'Nenhum dia marcado: a feira vale todos os dias (bom para loja que abre sempre).')}</small></section>
    <section class="pf-sec"><span class="pf-rot">Bancas desta feira <b id="pf-f-n-lojas">${r.lojas.size}</b></span>
        <ul class="pf-marcar">${d.lojas.map((l) => `<li><label><input type="checkbox" data-pf-f-loja="${escapeHTML(l.id)}"${r.lojas.has(l.id) ? ' checked' : ''}>${ponto(l.cor)}<span>${escapeHTML(l.nome)}${l.ativo ? '' : ' <small>(bloqueada)</small>'}${feirasDaLoja(l.id).filter((f) => f.id !== r.id).length ? `<small>também em ${escapeHTML(feirasDaLoja(l.id).filter((f) => f.id !== r.id).map((f) => f.nome).join(', '))}</small>` : ''}</span></label></li>`).join('')}</ul></section>
    <section class="pf-sec"><span class="pf-rot">Condomínios que esta feira atende <b id="pf-f-n-conds">${r.conds.size}</b></span>
        <small class="pf-dica">Eles aparecem na lista de endereço das bancas da feira, e quem escolhe um deles cai nesta feira.</small>
        ${d.condominios.length > 6 ? `<input type="search" class="pf-busca largo" data-busca-cond placeholder="Buscar condomínio" value="${escapeHTML(r.buscaCond)}" aria-label="Buscar condomínio">` : ''}
        <ul class="pf-marcar">${conds.map((c) => `<li${termo && !normCond(c.nome).includes(termo) ? ' hidden' : ''} data-nome="${escapeHTML(normCond(c.nome))}"><label><input type="checkbox" data-pf-f-cond="${escapeHTML(c.id)}"${r.conds.has(c.id) ? ' checked' : ''}><span>${escapeHTML(c.nome)}<small>${FORMATOS[c.formato]}${outrasFeiras(c.id).length ? `. Também em: ${escapeHTML(outrasFeiras(c.id).join(', '))}` : ''}</small></span></label></li>`).join('') || '<li class="pf-nada">Nenhum condomínio cadastrado ainda.</li>'}</ul>
        <div class="pf-form-linha pf-cond-rapido"><input type="text" id="pf-f-cond-novo" maxlength="80" placeholder="Não achou? Cadastre aqui" aria-label="Novo condomínio" autocomplete="off">${formatoSelect('pf-f-cond-formato', 'ql')}<button type="button" class="pf-bt" data-pf="cond-rapido">Cadastrar e marcar</button></div></section>
    <section class="pf-sec"><span class="pf-rot">Pedidos</span>
        <div class="pf-form-linha"><label class="pf-campo-curto" for="pf-f-limite">Pedido para o mesmo dia até</label><input type="time" id="pf-f-limite" value="${escapeHTML(r.horaLimite)}"></div>
        <small class="pf-dica">Depois deste horário, no dia da feira, o pedido vai para a próxima feira. Em branco, aceita o dia todo.</small>
        <span class="pf-rot sub">Dias sem feira (chuva, feriado)</span>
        <div class="pf-chips" id="pf-f-sem">${r.semFeira.map((dia) => `<span class="pf-chip-data">${escapeHTML(textoDoDia(dia))}<button type="button" data-pf="tirar-sem" data-dia="${escapeHTML(dia)}" aria-label="Tirar ${escapeHTML(textoDoDia(dia))}">&times;</button></span>`).join('') || '<small class="pf-dica">Nenhum.</small>'}</div>
        <div class="pf-form-linha"><input type="date" id="pf-f-sem-dia" aria-label="Data sem feira"><button type="button" class="pf-bt" data-pf="por-sem">Marcar sem feira</button></div>
        <small class="pf-dica">Nesse dia a loja pula para a próxima feira. Pedidos já feitos para ele aparecem no painel da banca com o aviso "feira cancelada".</small></section>
    ${nova ? '' : '<section class="pf-sec pf-sec-perigo"><button type="button" class="pf-bt perigo" data-pf="desfazer-feira">Desfazer esta feira</button><small class="pf-dica">As bancas continuam funcionando; o link da feira deixa de abrir.</small></section>'}`;
    const pe = `<button type="button" class="pf-bt" data-pf="fechar-folha">Cancelar</button><button type="button" class="pf-bt pri" data-pf="salvar-feira">${nova ? 'Criar feira' : 'Salvar feira'}</button>`;
    return [nova ? 'Nova feira' : 'Editar feira', corpo, pe];
}

function folhaLoja(l) {
    if (!l) return ['Loja', '<p class="pf-dica">Esta loja não existe mais.</p>', ''];
    const fs = feirasDaLoja(l.id);
    const corpo = `
    <section class="pf-sec pf-loja-cab">${ponto(l.cor)}<div><b>${escapeHTML(l.nome)}</b><small>${escapeHTML(l.id)}${l.original ? ', loja original' : ''}</small></div><span class="pf-selo${l.ativo ? ' ok' : ' bloq'}">${l.ativo ? 'Ativa' : 'Bloqueada'}</span></section>
    <section class="pf-sec"><p class="pf-mes">${l.mes ? `Neste mês: <b>${fmt(l.mes.receita)}</b> em <b>${l.mes.pedidos}</b> pedidos.` : 'Sem leitura do movimento deste mês.'}${l.assinatura ? ` Mensalidade: <b>${fmt(l.assinatura.valor)}</b>${l.assinatura.dia ? `, dia ${l.assinatura.dia}` : ''}.` : ' Sem mensalidade (defina na aba Mensalidades).'}</p>
        <div class="pf-linha-bts"><a class="pf-bt" href="${urlDaLoja(l.id, './')}" target="_blank" rel="noopener">Ver a loja</a><a class="pf-bt" href="${urlDaLoja(l.id, '/admin')}">Abrir o painel</a></div>
        <span class="pf-rot">Cartaz da loja (um para cada feira)</span>
        <div class="pf-linha-bts" style="flex-direction:column;align-items:stretch">${fs.map((f) => `<button type="button" class="pf-bt" data-pf="cartaz-loja" data-loja="${escapeHTML(l.id)}" data-feira="${escapeHTML(f.id)}">Cartaz da ${escapeHTML(f.nome)}</button>`).join('')}<button type="button" class="pf-bt" data-pf="cartaz-loja" data-loja="${escapeHTML(l.id)}" data-feira="">Cartaz só da loja (sem feira)</button></div>
        <label class="pf-rot" for="pf-cartaz-local">Texto no topo do cartaz (opcional)</label>
        <div class="pf-form-linha"><input type="text" id="pf-cartaz-local" maxlength="50" autocomplete="off" placeholder="Em branco: o nome da feira. Ex.: Feira Atenas"></div>
        <small class="pf-dica">Cartaz A4 nas cores, na logo e com a foto de capa da loja (Aparência), com o QR que abre esta loja, o passo a passo da fitinha e o WhatsApp e Instagram da loja (Configurações).</small></section>
    <section class="pf-sec"><span class="pf-rot">Proprietários</span>
        ${l.donos.length ? `<ul class="pf-donos">${l.donos.map((e) => `<li><span>${escapeHTML(e)}</span><button type="button" class="pf-bt mini" data-pf="tirar-dono" data-email="${escapeHTML(e)}" aria-label="Tirar ${escapeHTML(e)}">Tirar</button></li>`).join('')}</ul>` : `<p class="pf-dica">${l.original ? 'A conta antiga da banca continua valendo. Novos proprietários aparecem aqui.' : 'Ninguém ainda. Sem proprietário, ninguém abre o painel desta loja.'}</p>`}
        <div class="pf-form-linha"><input type="email" id="pf-l-dono" inputmode="email" autocomplete="off" placeholder="E-mail do proprietário" aria-label="E-mail do novo proprietário"><button type="button" class="pf-bt" data-pf="dar-dono">Adicionar</button></div></section>
    ${l.original ? '' : `<section class="pf-sec"><label class="pf-rot" for="pf-l-tipo">Tipo de negócio</label><div class="pf-form-linha"><input type="text" id="pf-l-tipo" maxlength="30" autocomplete="off" value="${escapeHTML(NOMES_MODELO[l.tipo] || l.tipo || '')}" placeholder="Ex.: Padaria"><button type="button" class="pf-bt" data-pf="mudar-tipo">Salvar</button></div></section>`}
    <section class="pf-sec"><span class="pf-rot">Módulos ligados</span><small class="pf-dica">Muda na hora, ao tocar.</small>
        <div class="pf-toggles">${Object.entries(S.dados.modulos).map(([k, rot]) => `<label><input type="checkbox" data-pf-modulo="${k}"${l.modulos[k] ? ' checked' : ''}> ${escapeHTML(rot)}</label>`).join('')}</div></section>
    <section class="pf-sec"><span class="pf-rot">Campos no cadastro de produto</span><small class="pf-dica">O que esta loja vê ao criar ou editar um produto. Nome, preço, unidade, categoria e foto sempre aparecem. Muda na hora, ao tocar.</small>
        <div class="pf-toggles">${(() => { const lig = camposDaLoja({ tipo: l.tipo, campos: l.campos || {} }, l.original); return Object.entries(S.dados.campos || CAMPOS_PRODUTO).map(([k, rot]) => `<label><input type="checkbox" data-pf-campo="${k}"${lig[k] ? ' checked' : ''}> ${escapeHTML(rot)}</label>`).join(''); })()}</div></section>
    <section class="pf-sec"><span class="pf-rot">Feiras</span>${fs.length ? `<ul class="pf-mini-lista">${fs.map((f) => `<li>${escapeHTML(f.nome)}<small>${escapeHTML(diasEmTexto(f.dias))}</small></li>`).join('')}</ul>` : '<p class="pf-dica">Não está em nenhuma feira.</p>'}<small class="pf-dica">Para colocar ou tirar de uma feira, use a aba Feiras.</small></section>
    <section class="pf-sec pf-sec-perigo"><button type="button" class="pf-bt${l.ativo ? ' perigo' : ' pri'}" data-pf="${l.ativo ? 'bloquear' : 'liberar'}">${l.ativo ? 'Bloquear a loja' : 'Liberar a loja'}</button><small class="pf-dica">Bloqueada, a loja para de receber pedidos e some das feiras, e o painel dela fecha com o aviso "Sua assinatura foi interrompida por falta de pagamento. Pague e volte a usar", mostrando a mensalidade. Nada se perde: ao liberar, tudo volta.</small></section>`;
    return [l.nome, corpo, '<button type="button" class="pf-bt" data-pf="fechar-folha">Fechar</button>'];
}

function folhaNovaLoja() {
    const d = S.dados;
    const tiposProprios = [...new Set(d.lojas.map((l) => l.tipo).filter((t) => t && !d.modelos.includes(t)))].sort((a, b) => a.localeCompare(b));
    const corpo = `
    <section class="pf-sec"><label class="pf-rot" for="pf-nome">Nome da loja</label><input type="text" id="pf-nome" data-foco maxlength="60" autocomplete="off" placeholder="Ex.: Pastel do João"></section>
    <section class="pf-sec"><label class="pf-rot" for="pf-id">Endereço</label><input type="text" id="pf-id" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="pastel-do-joao"><small class="pf-dica" id="pf-id-dica">Não muda depois. Só letras minúsculas, números e hífen.</small></section>
    <section class="pf-sec"><label class="pf-rot" for="pf-modelo">Tipo de negócio</label><select id="pf-modelo">${d.modelos.map((m) => `<option value="${escapeHTML(m)}">${escapeHTML(NOMES_MODELO[m] || m)}</option>`).join('')}${tiposProprios.map((t) => `<option value="c:${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('')}<option value="__novo">Outro tipo (escrever)</option></select>
        <div id="pf-grupo-tipo" hidden><label class="pf-rot sub" for="pf-tipo-nome">Qual é o tipo de negócio?</label><input type="text" id="pf-tipo-nome" maxlength="30" autocomplete="off" placeholder="Ex.: Padaria"></div>
        <div id="pf-grupo-base" hidden><label class="pf-rot sub" for="pf-base">Começar com a aparência de</label><select id="pf-base">${d.modelos.map((m) => `<option value="${escapeHTML(m)}">${escapeHTML(NOMES_MODELO[m] || m)}</option>`).join('')}</select><small class="pf-dica">Só as cores e fontes iniciais. O proprietário muda depois na aba Aparência.</small></div></section>
    <section class="pf-sec"><label class="pf-rot" for="pf-dono">E-mail do proprietário (opcional)</label><input type="email" id="pf-dono" inputmode="email" autocomplete="off" placeholder="nome@email.com"></section>`;
    return ['Nova loja', corpo, '<button type="button" class="pf-bt" data-pf="fechar-folha">Cancelar</button><button type="button" class="pf-bt pri" data-pf="criar">Criar loja</button>'];
}

// ---------------------------------------------------------------- dados
async function carregar() { S.dados = await api({ acao: 'lojas' }); guardarDaPlataforma(S.dados.lojas); render(); }
async function fazer(corpo, ok, { manterFolha = false, aplicar = null } = {}) {
    if (S.ocupado) return false; S.ocupado = true;
    document.body.classList.add('pf-ocupado');
    try {
        await api(corpo); if (ok) showToast(ok);
        // interruptor de módulo/campo: o servidor já gravou; muda só esta loja na tela, sem reler a plataforma inteira (era o que demorava)
        if (aplicar && S.dados) { aplicar(S.dados); render(); if (S.folha) pintarFolha(); return true; }
        await carregar();
        if (S.folha && manterFolha) pintarFolha(); else if (S.folha && S.folha.tipo === 'loja') pintarFolha();
        return true;
    } catch (e) { showToast(e.message, true); return false; }
    finally { S.ocupado = false; document.body.classList.remove('pf-ocupado'); }
}
const marcarMudanca = () => { if (S.rascunho) S.rascunho.mudou = true; };

// ---------------------------------------------------------------- ações
async function agir(b) {
    const a = b.dataset.pf;
    const lojaId = b.dataset.loja || (S.folha && S.folha.tipo === 'loja' ? S.folha.id : ''), loja = lojaId && lojaPorId(lojaId);
    switch (a) {
        case 'fechar-folha': return fecharFolha(false);
        case 'atualizar-erros': return carregarErros();
        case 'filtro-erros': S.filtroErros = b.dataset.filtro; return render();
        case 'erro-corrigi': return marcarErro(b.dataset.ass, 'corrigido');
        case 'erro-reabrir': return marcarErro(b.dataset.ass, 'aberto');
        case 'nova-feira': return abrirFolha('feira', '');
        case 'editar-feira': return abrirFolha('feira', b.dataset.feira);
        case 'nova-loja': return abrirFolha('nova-loja');
        case 'abrir-loja': return abrirFolha('loja', b.dataset.loja);
        case 'cartaz-feira': {       // cartaz A4 "Agora temos aplicativo" com o QR DESTA feira (js/cartaz-lib.js)
            const f = S.dados.feiras.find((x) => x.id === b.dataset.feira); if (!f) return;
            try {
                const [{ cartazHtml }, { imprimirPagina }] = await Promise.all([import('./cartaz-lib.js'), import('./impressao.js')]);
                await imprimirPagina(cartazHtml({ feira: f, link: linkDaFeira(f.id) }));
                showToast('Cartaz pronto. Para guardar, escolha "Salvar como PDF".');
            } catch (e) { showToast((e && e.message) || 'Não consegui montar o cartaz.', true); }
            return;
        }
        case 'cartaz-loja': {        // cartaz A4 desta LOJA: cores, logo e foto dela, QR que abre a loja, fitinha NFC explicada (js/cartaz-lib.js)
            const l = lojaPorId(b.dataset.loja); if (!l) return;
            try {
                let ficha = {}; try { const sn = await getDoc(doc(db, 'tenants', l.id)); if (sn.exists()) ficha = sn.data() || {}; } catch (_) { /* sem a ficha: sai com as cores padrão */ }
                const campoLocal = document.getElementById('pf-cartaz-local'), fid = b.dataset.feira || '', fe = feirasDaLoja(l.id).find((f) => f.id === fid), local = ((campoLocal && campoLocal.value.trim()) || (fe ? fe.nome : '')).trim();
                let config = {}; try { const sn = await getDoc(doc(db, 'tenants', l.id, 'loja', 'config')); if (sn.exists()) config = sn.data() || {}; } catch (_) { /* sem contato: o cartaz sai sem a faixa */ }
                const ct = contatoDaLoja(config, l.nome);
                                const link = fid ? linkDaFeira(fid) : new URL(urlDaLoja(l.id, '/'), location.href).href;
                const [{ cartazLojaHtml }, { imprimirPagina }] = await Promise.all([import('./cartaz-lib.js'), import('./impressao.js')]);
                await imprimirPagina(cartazLojaHtml({ loja: { nome: ficha.nome || l.nome, subtitulo: ficha.subtitulo || '', tema: ficha.tema || {}, whatsapp: ct.whatsapp, instagram: ct.instagram }, condominios: local ? [local] : [], link }));
                showToast('Cartaz pronto. Para guardar, escolha "Salvar como PDF".');
            } catch (e) { showToast((e && e.message) || 'Não consegui montar o cartaz.', true); }
            return;
        }
        case 'copiar-link': {
            try { await navigator.clipboard.writeText(linkDaFeira(b.dataset.feira)); showToast('Link da feira copiado.'); }
            catch (_) { showToast('Não consegui copiar. Segure o dedo no link para copiar.', true); }
            return;
        }
        case 'por-sem': {
            const dia = String($('pf-f-sem-dia').value || ''), hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return showToast('Escolha a data.', true);
            if (dia < hoje) return showToast('Escolha uma data de hoje em diante.', true);
            if (!S.rascunho.semFeira.includes(dia)) { S.rascunho.semFeira.push(dia); S.rascunho.semFeira.sort(); marcarMudanca(); }
            return pintarFolha();
        }
        case 'tirar-sem': S.rascunho.semFeira = S.rascunho.semFeira.filter((d) => d !== b.dataset.dia); marcarMudanca(); return pintarFolha();
        case 'cond-rapido': {
            const nome = $('pf-f-cond-novo').value.trim(), formato = $('pf-f-cond-formato').value;
            if (normCond(nome).length < 2) return showToast('Escreva o nome do condomínio.', true);
            if (!(await fazer({ acao: 'condominio', nome, formato }, `${nome} cadastrado e marcado.`))) return;
            const novo = S.dados.condominios.find((c) => normCond(c.nome) === normCond(nome));
            if (novo) { S.rascunho.conds.add(novo.id); marcarMudanca(); }
            return pintarFolha();
        }
        case 'salvar-feira': return salvarFeira();
        case 'desfazer-feira': {
            if (!(await confirmar('Desfazer a feira?', 'As bancas continuam funcionando. O link desta feira deixa de abrir e os clientes dela passam a ver cada banca sozinha.', { ok: 'Desfazer', nao: 'Voltar' }))) return;
            if (await fazer({ acao: 'feira', fid: S.rascunho.id, nome: '', lojas: [] }, 'Feira desfeita.')) fecharFolha(true);
            return;
        }
        case 'criar': {
            const nome = $('pf-nome').value.trim(), nid = $('pf-id').value.trim(), emailDono = $('pf-dono').value.trim().toLowerCase();
            if (nome.length < 2) return showToast('Dê um nome para a loja.', true);
            if (!idValido(nid)) return showToast('Confira o endereço: só letras minúsculas, números e hífen.', true);
            if (S.dados.lojas.some((l) => l.id === nid)) return showToast('Já existe uma loja com este endereço.', true);
            const escolha = $('pf-modelo').value, proprio = escolha === '__novo' || escolha.startsWith('c:');
            const tipoNome = escolha === '__novo' ? $('pf-tipo-nome').value.trim() : escolha.startsWith('c:') ? escolha.slice(2) : '';
            if (escolha === '__novo' && tipoNome.length < 2) return showToast('Escreva o tipo de negócio.', true);
            if (await fazer({ acao: 'criar-loja', id: nid, nome, modelo: proprio ? $('pf-base').value : escolha, tipoNome, emailDono }, `Loja "${nome}" criada.`)) { fecharFolha(true); S.aba = 'lojas'; render(); }
            return;
        }
        case 'bloquear': {
            if (!(await confirmar(`Bloquear ${loja.nome}?`, `A loja para de receber pedidos e some das feiras. O painel dela fecha e mostra ao proprietário que a assinatura foi interrompida por falta de pagamento, com o valor da mensalidade${loja.original ? '. Atenção: esta é a loja original, que está no ar' : ''}. Você pode liberar de novo quando quiser.`, { ok: 'Bloquear', nao: 'Voltar' }))) return;
            return fazer({ acao: 'ativo', id: lojaId, ativo: false }, 'Loja bloqueada.');
        }
        case 'liberar': return fazer({ acao: 'ativo', id: lojaId, ativo: true }, 'Loja liberada.');
        case 'mudar-tipo': {
            const novo = $('pf-l-tipo').value.trim();
            if (novo.length < 2) return showToast('Escreva o tipo de negócio.', true);
            return fazer({ acao: 'tipo', id: lojaId, tipo: novo }, `${loja.nome} agora é "${novo}".`);
        }
        case 'dar-dono': {
            const email = $('pf-l-dono').value.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return showToast('Confira o e-mail.', true);
            return fazer({ acao: 'proprietario', id: lojaId, email }, `${email} agora é proprietário de ${loja.nome}.`);
        }
        case 'tirar-dono': {
            if (!(await confirmar('Tirar o proprietário?', `${b.dataset.email} deixa de abrir o painel de ${loja.nome}.`, { ok: 'Tirar', nao: 'Voltar' }))) return;
            return fazer({ acao: 'proprietario', id: lojaId, email: b.dataset.email, remover: true }, 'Proprietário retirado.');
        }
        case 'cadastrar-cond': {
            const nome = $('pf-cond-nome').value.trim();
            if (normCond(nome).length < 2) return showToast('Escreva o nome do condomínio.', true);
            return fazer({ acao: 'condominio', nome, formato: $('pf-cond-formato').value }, `${nome} cadastrado.`);
        }
        case 'editar-cond': S.editandoCond = b.closest('[data-cond]').dataset.cond; render(); el().querySelector('[data-cond-nome]')?.focus(); return;
        case 'cancelar-cond': S.editandoCond = ''; return render();
        case 'salvar-cond': {
            const li = b.closest('[data-cond]'), nome = li.querySelector('[data-cond-nome]').value.trim();
            if (normCond(nome).length < 2) return showToast('Escreva o nome do condomínio.', true);
            const id = li.dataset.cond, em = feirasDoCond(id);
            if (await fazer({ acao: 'condominio', id, nome, formato: li.querySelector('[data-cond-formato]').value }, em.length ? `Salvo. ${em.length === 1 ? 'A feira que usa este condomínio já mostra' : 'As feiras que usam este condomínio já mostram'} o nome novo.` : 'Salvo.')) { S.editandoCond = ''; render(); }
            return;
        }
        case 'tirar-cond': {
            const li = b.closest('[data-cond]'), c = S.dados.condominios.find((x) => x.id === li.dataset.cond);
            if (!c || !(await confirmar(`Tirar ${c.nome}?`, 'Ele sai do cadastro da plataforma. As listas de condomínios que cada banca tem no painel dela não mudam.', { ok: 'Tirar', nao: 'Voltar' }))) return;
            return fazer({ acao: 'condominio', id: c.id, remover: true }, `${c.nome} saiu do cadastro.`);
        }
        case 'salvar-mensal': {
            const li = b.closest('[data-loja]'), v = (k) => li.querySelector(`[data-m="${k}"]`).value.trim();
            const valor = lerReais(v('valor'));
            if (Number.isNaN(valor)) return showToast('Confira o valor. Exemplos: 59,90 ou 1.500,00.', true);
            const diaN = Number(v('dia'));
            if (v('dia') && !(Number.isInteger(diaN) && diaN >= 1 && diaN <= 28)) return showToast('O vencimento vai do dia 1 ao dia 28.', true);
            const id = li.dataset.loja, guardado = S.mensal[id]; delete S.mensal[id];          // salva só esta linha; as outras continuam como estão na tela
            const foi = await fazer({ acao: 'assinatura', id, valor: valor === '' ? '' : String(valor), dia: diaN || null, obs: v('obs') }, valor === '' ? 'Mensalidade retirada.' : `Mensalidade de ${fmt(valor)} salva.`);
            if (!foi) { S.mensal[id] = guardado; render(); }
            return;
        }
        case 'copiar-texto': {
            try { await navigator.clipboard.writeText(b.dataset.copiar || ''); showToast('Copiado.'); }
            catch (_) { const campo = b.parentElement && b.parentElement.querySelector('input'); if (campo) { campo.focus(); campo.select(); } showToast('Não consegui copiar sozinho: o texto ficou selecionado, use Copiar do celular.', true); }
            return;
        }
        case 'salvar-asaas': {
            const chave = $('pf-asaas').value.trim();
            if (!/^\$aact_\S{20,}$/.test(chave)) return showToast('A chave do Asaas começa com $aact_ e não tem espaços. Confira se copiou inteira.', true);
            return fazer({ acao: 'asaas', chave }, 'Chave do Asaas guardada. Agora cadastre o aviso de pagamento no Asaas (URL e token abaixo).');
        }
        case 'desligar-asaas': {
            if (!await confirmar('Desligar o PIX automático?', 'A chave do Asaas será apagada e o PIX automático some de todas as lojas. O cliente continua pagando pelo copia e cola da loja. Para voltar, é só cadastrar a chave de novo.', { ok: 'Desligar', nao: 'Voltar' })) return;
            return fazer({ acao: 'asaas', desligar: true }, 'Asaas desligado. As lojas voltaram ao PIX copia e cola.');
        }
        case 'salvar-carteira': {
            const linha = b.closest('[data-loja]'), carteira = linha.querySelector('[data-carteira]').value.trim();
            if (carteira && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(carteira)) return showToast('A carteira tem o formato 0b763922-aa88-4cbe-a567-e3fe8511fa06. Confira se copiou inteira.', true);
            return fazer({ acao: 'asaas-carteira', id: linha.dataset.loja, carteira }, carteira ? 'Carteira guardada. O PIX desta banca vai direto para ela.' : 'Carteira apagada. Esta loja volta a não ter PIX automático.');
        }
        case 'salvar-pagbank': {
            const chave = $('pf-pagbank').value.trim();
            if (chave.length < 20 || /\s/.test(chave)) return showToast('O token do PagBank é longo e não tem espaços. Confira se copiou inteiro.', true);
            return fazer({ acao: 'pagbank', chave }, 'Chave do PagBank guardada. Agora ligue "PIX automático" nas Configurações da loja.');
        }
        case 'salvar-imgbb': {
            const chave = $('pf-imgbb').value.trim();
            if (!/^[a-f0-9]{32}$/i.test(chave)) return showToast('A chave do ImgBB tem 32 letras e números. Confira se copiou inteira.', true);
            return fazer({ acao: 'imgbb', chave }, 'Chave guardada. O envio automático de fotos está ligado.');
        }
        default: return undefined;
    }
}

async function salvarFeira() {
    const r = S.rascunho, nova = !r.id, nome = r.nome.trim(), fid = nova ? sugerirId(nome) : r.id;
    if (nome.length < 2 || !idValido(fid)) return showToast('Dê um nome para a feira (pelo menos 2 letras).', true);
    if (!r.lojas.size) return showToast('Marque pelo menos uma banca.', true);
    if (r.lojas.size > 12) return showToast('Uma feira tem no máximo 12 bancas.', true);
    if (r.conds.size > 40) return showToast(`Uma feira atende no máximo 40 condomínios (marcados: ${r.conds.size}).`, true);
    if (nova && S.dados.feiras.some((f) => f.id === fid)) return showToast('Já existe uma feira com um nome parecido. Escolha outro nome.', true);
    if (!r.conds.size && !(await confirmar('Salvar sem condomínio?', 'Sem condomínio marcado, só quem abrir o link da feira cai nela. Quem chega sem o link e escolhe o condomínio não é levado a esta feira.', { ok: 'Salvar assim', nao: 'Voltar e marcar' }))) return;
    const corpo = { acao: 'feira', ...(nova ? { nova: true } : {}), fid, nome, dias: [...r.dias].sort((a, b) => a - b), lojas: [...r.lojas], condominiosIds: [...r.conds], horaLimite: r.horaLimite, semFeira: r.semFeira };
    if (await fazer(corpo, nova ? 'Feira criada. Copie o link e mande aos clientes.' : 'Feira salva.')) fecharFolha(true);
}

// ---------------------------------------------------------------- eventos
function ligar() {
    $('pf-abas').addEventListener('click', (e) => {
        const b = e.target.closest('[data-aba]'); if (!b) return;
        S.aba = b.dataset.aba; S.editandoCond = ''; try { localStorage.setItem('pf_aba', S.aba); } catch (_) { /* segue */ }
        render(); window.scrollTo({ top: 0 });
    });
    const clique = async (e) => { const b = e.target.closest('[data-pf]'); if (!b || b.disabled) return; await agir(b); };
    el().addEventListener('click', clique);
    $('pf-folha').addEventListener('click', async (e) => {
        if (e.target.id === 'pf-folha') { if (!S.confirmando) fecharFolha(false); return; }          // toque fora da folha
        const dia = e.target.closest('[data-pf-dia]');
        if (dia && S.rascunho) {
            const n = Number(dia.dataset.pfDia); if (S.rascunho.dias.has(n)) S.rascunho.dias.delete(n); else S.rascunho.dias.add(n);
            dia.classList.toggle('on'); dia.setAttribute('aria-pressed', String(S.rascunho.dias.has(n))); marcarMudanca();
            $('pf-f-dias-txt').textContent = S.rascunho.dias.size ? diasEmTexto([...S.rascunho.dias]) : 'Nenhum dia marcado: a feira vale todos os dias (bom para loja que abre sempre).';
            return;
        }
        return clique(e);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.folha && !S.confirmando && !document.querySelector('#overlay-confirm.aberto')) fecharFolha(false); });
    // digitação: atualiza o que precisa sem redesenhar (o cursor não pula)
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.busca) { S.busca[t.dataset.busca] = t.value; const pos = t.selectionStart; render(); const n = el().querySelector(`[data-busca="${t.dataset.busca}"]`); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
        if (t.hasAttribute('data-busca-cond') && S.rascunho) {
            S.rascunho.buscaCond = t.value; const termo = normCond(t.value);
            $('pf-folha-corpo').querySelectorAll('[data-nome]').forEach((li) => { li.hidden = !!termo && !li.dataset.nome.includes(termo); });
            return;
        }
        if (t.id === 'pf-f-nome' && S.rascunho) { S.rascunho.nome = t.value; marcarMudanca(); return; }
        if (t.id === 'pf-f-limite' && S.rascunho) { S.rascunho.horaLimite = t.value; marcarMudanca(); return; }
        if (t.id === 'pf-nome' && !$('pf-id').dataset.mexido) $('pf-id').value = sugerirId(t.value);
        if (t.id === 'pf-id') t.dataset.mexido = '1';
        if (t.id === 'pf-nome' || t.id === 'pf-id') $('pf-id-dica').textContent = idValido($('pf-id').value) ? `A loja abre em ${urlDaLoja($('pf-id').value, '/').replace(/^https:\/\//, '')}. Não muda depois.` : 'Não muda depois. Só letras minúsculas, números e hífen.';
        if (t.dataset.m) { const li = t.closest('[data-loja]'), id = li.dataset.loja; S.mensal[id] = { ...(S.mensal[id] || {}), [t.dataset.m]: t.value }; li.querySelector('[data-pf="salvar-mensal"]').disabled = false; li.classList.add('mudou'); }
    });
    document.addEventListener('change', async (e) => {
        const t = e.target;
        if (t.id === 'pf-modelo') {
            const v = t.value, proprio = v === '__novo' || v.startsWith('c:');
            $('pf-grupo-tipo').hidden = v !== '__novo'; $('pf-grupo-base').hidden = !proprio;
            if (v === '__novo') $('pf-tipo-nome').focus();
            return;
        }
        if (t.id === 'pf-f-limite' && S.rascunho) { S.rascunho.horaLimite = t.value; marcarMudanca(); return; }
        if (t.dataset.pfFLoja && S.rascunho) { if (t.checked) S.rascunho.lojas.add(t.dataset.pfFLoja); else S.rascunho.lojas.delete(t.dataset.pfFLoja); $('pf-f-n-lojas').textContent = S.rascunho.lojas.size; marcarMudanca(); return; }
        if (t.dataset.pfFCond && S.rascunho) { if (t.checked) S.rascunho.conds.add(t.dataset.pfFCond); else S.rascunho.conds.delete(t.dataset.pfFCond); $('pf-f-n-conds').textContent = S.rascunho.conds.size; marcarMudanca(); return; }
        if (t.dataset.pfCampo && S.folha && S.folha.tipo === 'loja') {
            const k = t.dataset.pfCampo, nome = (S.dados.campos || CAMPOS_PRODUTO)[k];
            const loja = lojaPorId(S.folha.id), ligado = t.checked;
            if (!(await fazer({ acao: 'campos', id: S.folha.id, campos: { [k]: ligado } }, `${nome}: ${ligado ? 'aparece' : 'escondido'} no cadastro.`, { aplicar: () => { if (loja) loja.campos = { ...(loja.campos || {}), [k]: ligado }; } }))) t.checked = !t.checked;
            return;
        }
        if (t.dataset.pfModulo && S.folha && S.folha.tipo === 'loja') {
            const nome = S.dados.modulos[t.dataset.pfModulo];
            const loja = lojaPorId(S.folha.id), k = t.dataset.pfModulo, ligado = t.checked;
            if (!(await fazer({ acao: 'modulos', id: S.folha.id, modulos: { [k]: ligado } }, `${nome}: ${ligado ? 'ligado' : 'desligado'}.`, { aplicar: () => { if (loja) loja.modulos = { ...(loja.modulos || {}), [k]: ligado }; } }))) t.checked = !t.checked;
        }
    });
}

let ligado = false;
onAuthStateChanged(auth, async (user) => {
    if (!user) return aviso('Entre primeiro pelo painel.', 'Depois de entrar com o seu e-mail, volte para esta página.', 'Ir para o painel');
    try {
        // Usa a conta que já está no aparelho (instantâneo). Só vai à rede se ela ainda não diz "plataforma"
        // (acabou de assumir, ou o acesso foi dado há pouco).
        let { claims } = await user.getIdTokenResult();
        if (claims.plataforma !== true) ({ claims } = await user.getIdTokenResult(true));
        if (claims.plataforma === true && !S.dados) render();           // as lojas da última vez já aparecem, enquanto a lista nova chega
        if (claims.plataforma !== true) {
            const donoDaOriginal = claims.admin === true || (claims.tenants && claims.tenants.banca === 'proprietario');
            if (!donoDaOriginal) return aviso('Área do dono da plataforma.', 'Esta conta cuida de uma loja, não da plataforma.', 'Voltar ao painel');
            // a plataforma já tem dono: esta conta cuida só da loja, e o botão de assumir nem aparece
            const sit = await api({ acao: 'situacao' });
            if (sit.temDono) return aviso('Área do dono da plataforma.', 'A plataforma já tem dono. Esta conta cuida da loja, pelo painel.', 'Voltar ao painel');
            el().innerHTML = `<div class="pf-vazio"><b>Assumir a plataforma</b><p>Daqui você cria outras lojas, escolhe o dono de cada uma e monta as feiras. Só uma conta pode ser a dona da plataforma, e esta escolha vale uma vez.</p><p><button class="pf-bt pri" id="pf-assumir">Assumir com ${escapeHTML(user.email || 'esta conta')}</button></p></div>`;
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
