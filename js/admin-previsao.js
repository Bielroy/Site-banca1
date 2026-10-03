// =====================================================================
//  js/admin-previsao.js — aba "🔮 Previsão" do painel admin.
//  Só RENDERIZA o que /api/analytics já calculou: nenhum cálculo pesado
//  roda no navegador. Todo número tem explicação ("Por quê?").
// =====================================================================
import { auth } from './firebase.js';
import { escapeHTML, fmt, showToast } from './utils.js';

const CONF_BAIXA = 0.4, CONF_ALTA = 0.7;      // mesmos limiares de analytics/config.js
const HORIZONTES = [
    ['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['proximoDia', 'Próx. dia'],
    ['proximaSemana', 'Semana que vem'], ['prox7', '7 dias'], ['prox30', '30 dias']
];
const ORDENS = [['valor', 'Maior faturamento'], ['falta', 'Maior risco de falta'], ['conf', 'Menor confiança'], ['nome', 'A–Z']];

const S = { dados: null, horizonte: 'amanha', ordem: 'valor', busca: '', esperadosDia: 'hoje', carregando: false, erro: '' };

const num = (v, casas = 1) => (v == null || !Number.isFinite(Number(v))) ? '–' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const rotConf = (c) => (c < CONF_BAIXA ? 'baixa' : c < CONF_ALTA ? 'média' : 'alta');
const quando = (iso) => {
    if (!iso) return '';
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return min < 1 ? 'agora' : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dia(s)`;
};

const chamar = async (corpo) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Sessão expirada.');
    const token = await user.getIdToken();
    const res = await fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.sucesso === false) throw new Error(json.error || 'Falha na consulta.');
    return json;
};

// ------------------------- visualização da faixa -------------------------
// Cortes vêm dos QUANTIS do modelo (q10, previsto, q90), não de ±% fixos.
const barraFaixa = (h, un) => {
    const rec = h.recomendacao || {};
    const est = rec.estoque ? rec.estoque.atual : null;
    const max = Math.max(h.q90 * 1.35, (rec.sugestao || 0) * 1.12, est ? est * 1.05 : 0, 1);
    const p = (v) => Math.min(100, Math.max(0, (v / max) * 100));
    const seg = (a, b, cls) => (b > a ? `<span class="pv-seg ${cls}" style="left:${p(a)}%;width:${p(b) - p(a)}%"></span>` : '');
    const f = (v) => num(v, 1);
    return `
    <div class="pv-faixa" role="img" aria-label="Abaixo de ${f(h.q10)}: risco alto. De ${f(h.q10)} a ${f(h.previsto)}: moderado. De ${f(h.previsto)} a ${f(h.q90)}: faixa recomendada. Acima: margem de segurança.">
        <div class="pv-trilho">
            ${seg(0, h.q10, 'pv-r')}${seg(h.q10, h.previsto, 'pv-a')}${seg(h.previsto, h.q90, 'pv-v')}${seg(h.q90, max, 'pv-m')}
            <i class="pv-mk pv-mk-prev" style="left:${p(h.previsto)}%" title="Previsto"></i>
            ${rec.sugestao != null ? `<i class="pv-mk pv-mk-sug" style="left:${p(rec.sugestao)}%" title="Sugestão de compra"></i>` : ''}
            ${est != null ? `<i class="pv-mk pv-mk-est" style="left:${p(est)}%" title="Seu estoque"></i>` : ''}
        </div>
        <div class="pv-legenda">
            <span>🔴 &lt; ${f(h.q10)}</span><span>🟡 ${f(h.q10)}–${f(h.previsto)}</span><span>🟢 ${f(h.previsto)}–${f(h.q90)}</span><span>🔵 &gt; ${f(h.q90)}</span>
        </div>
        <div class="pv-leg-mk"><span>▲ previsto</span><span>◆ compra sugerida</span>${est != null ? '<span>▮ seu estoque</span>' : ''}</div>
    </div>`;
};

const cartaoProduto = (p, hz) => {
    const h = p.horizontes && p.horizontes[hz];
    const cab = `<img class="pv-foto" src="${escapeHTML(p.foto || '')}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
                 <div class="pv-tit"><strong>${escapeHTML(p.nome)}</strong><small>${escapeHTML(p.cat || '')} · ${escapeHTML(p.unidade || 'un')}</small></div>`;
    if (!h || h.fechado) return `<article class="pv-card pv-card--vazio"><div class="pv-topo">${cab}</div><p class="pv-aviso">Loja fechada neste período.</p></article>`;
    if (h.semDados) return `<article class="pv-card pv-card--vazio"><div class="pv-topo">${cab}</div><p class="pv-aviso">Dados insuficientes (${h.nObs || 0} dia(s) de histórico) — ainda não dá para prever.</p></article>`;

    const rec = h.recomendacao || {};
    const avisos = (rec.avisos || []).map((a) => `<p class="pv-aviso">⚠️ ${escapeHTML(a)}</p>`).join('');
    const est = rec.estoque
        ? `<p class="pv-est pv-est--${rec.estoque.zona}">Seu estoque: <b>${num(rec.estoque.atual)}</b> → risco de falta <b>${pct(rec.estoque.riscoFalta)}</b>${rec.estoque.comprarAdicional > 0 ? ` · comprar +${num(rec.estoque.comprarAdicional)}` : ''}</p>` : '';
    const motivos = ((p.horizontes[hz] && h.explicacao) || []).map((m) => `<li>${escapeHTML(m)}</li>`).join('');
    const comp = h.componentes || {};
    return `
    <article class="pv-card" data-id="${escapeHTML(p.id)}">
        <div class="pv-topo">${cab}<span class="pv-conf pv-conf--${rotConf(h.conf)}" title="Confiança da previsão">${pct(h.conf)} · ${rotConf(h.conf)}</span></div>
        <div class="pv-nums">
            <div><span>Previsto</span><strong>${num(h.previsto)}</strong></div>
            <div><span>Faixa provável</span><strong>${num(h.q10)}–${num(h.q90)}</strong></div>
            <div class="pv-sug"><span>Sugestão de compra</span><strong>${num(rec.sugestao)}</strong></div>
        </div>
        ${barraFaixa(h, p.unidade)}
        <p class="pv-risco">Risco de faltar com a sugestão: <b>${rec.riscoRotulo || '–'}</b> (${pct(rec.riscoFalta)})</p>
        ${est}${avisos}
        <details class="pv-por-que"><summary>Por quê?</summary>
            ${motivos ? `<ul>${motivos}</ul>` : '<p>Sem detalhes para este período.</p>'}
            <p class="pv-conf-det">Confiança = volume de dados ${pct(comp.volume)} · regularidade ${pct(comp.regularidade)} · acerto recente ${pct(comp.estabilidade)} · qualidade ${pct(comp.qualidade)}${h.intervalo === 'poisson' ? '<br>Faixa estimada por modelo de contagem (histórico curto).' : `<br>Faixa calculada de ${h.nRes} erros passados do próprio modelo.`}</p>
        </details>
    </article>`;
};

const valorPrevisto = (p, hz) => { const h = p.horizontes && p.horizontes[hz]; return h && h.previsto != null ? h.previsto * (p.preco || 0) : -1; };
const riscoFalta = (p, hz) => { const h = p.horizontes && p.horizontes[hz]; return h && h.recomendacao ? (h.recomendacao.estoque ? h.recomendacao.estoque.riscoFalta : h.recomendacao.riscoFalta) : -1; };

const listaProdutos = () => {
    const d = S.dados; if (!d) return '';
    const termo = S.busca.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let L = Object.values(d.produtos || {}).filter((p) => !termo || (p.nome + ' ' + p.cat).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(termo));
    const hz = S.horizonte;
    const cmp = { valor: (a, b) => valorPrevisto(b, hz) - valorPrevisto(a, hz), falta: (a, b) => riscoFalta(b, hz) - riscoFalta(a, hz), conf: (a, b) => ((a.horizontes[hz] || {}).conf ?? 2) - ((b.horizontes[hz] || {}).conf ?? 2), nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR') }[S.ordem];
    L = L.sort(cmp);
    return L.length ? L.map((p) => cartaoProduto(p, hz)).join('') : '<p class="pv-vazio">Nenhum produto encontrado.</p>';
};

// ------------------------- blocos do dashboard -------------------------
const kpi = (rot, val, sub, cls = '') => `<article class="pv-kpi ${cls}"><span>${rot}</span><strong>${val}</strong><small>${sub || ''}</small></article>`;
const linhaMini = (p, dir) => `<li><span>${escapeHTML(p.nome)}</span><b>${dir}</b></li>`;
const bloco = (tit, itens, vazio) => `<section class="pv-bloco"><h4>${tit}</h4>${itens.length ? `<ul>${itens.join('')}</ul>` : `<p class="pv-vazio">${vazio}</p>`}</section>`;

const resumoErro = (av) => {
    if (!av || !av.length) return null;
    const ok = av.filter((a) => a.n > 0 && a.wape != null);
    if (!ok.length) return null;
    const m = (k) => ok.reduce((s, a) => s + (a[k] || 0), 0) / ok.length;
    return { n: ok.length, wape: m('wape'), mae: m('mae'), rmse: m('rmse'), cobertura: ok.filter((a) => a.cobertura != null).length ? ok.reduce((s, a) => s + (a.cobertura || 0), 0) / ok.filter((a) => a.cobertura != null).length : null };
};

const blocoEsperados = () => {
    const e = (S.dados.esperados || {})[S.esperadosDia];
    const abas = [['hoje', 'Hoje'], ['amanha', 'Amanhã']].map(([k, r]) => `<button class="pv-chip ${S.esperadosDia === k ? 'on' : ''}" data-pv-esp="${k}">${r}</button>`).join('');
    let corpo;
    if (!e || e.fechado) corpo = '<p class="pv-vazio">Loja fechada neste dia.</p>';
    else if (e.indisponivel || !e.clientes) corpo = '<p class="pv-vazio">Ainda não há clientes recorrentes suficientes para estimar.</p>';
    else corpo = `<p class="pv-sub">≈ <b>${num(e.pedidosEsperados)}</b> pedido(s) esperado(s)</p>` + (e.clientes.length ? e.clientes.map((c) => `
        <article class="pv-cli">
            <div class="pv-cli-top"><strong>${escapeHTML(c.nome || 'Cliente')}</strong><span>Q${escapeHTML(c.quadra)}·L${escapeHTML(c.lote)}</span><b>${pct(c.p)}</b></div>
            <div class="pv-barra"><i style="width:${Math.round(c.p * 100)}%"></i></div>
            <small>Última compra há ${c.diasDesdeUltima} dia(s)${c.intervaloMedio ? ` · costuma comprar a cada ${num(c.intervaloMedio, 0)} dias` : ''}${c.jaComprouHoje ? ' · <b>já comprou hoje</b>' : ''}</small>
            <div class="pv-itens">${c.itens.map((i) => `<span>${escapeHTML(i.nome)} ${pct(i.p)}</span>`).join('')}</div>
            <button class="pv-link" data-pv-cli="${escapeHTML(c.id)}">Por quê?</button><div class="pv-cli-det" id="pvcli-${escapeHTML(c.id)}"></div>
        </article>`).join('') : '<p class="pv-vazio">Nenhum cliente com probabilidade relevante.</p>');
    return `<section class="pv-bloco pv-bloco--largo"><h4>👥 Clientes esperados</h4><div class="pv-chips">${abas}</div>${corpo}</section>`;
};

const detalheCliente = (r) => {
    const p = r.perfil;
    const meta = [`${p.pedidos} pedido(s)`, p.intervaloMedioDias ? `intervalo médio ${num(p.intervaloMedioDias)} d (mediana ${num(p.intervaloMedianoDias, 0)}, desvio ${num(p.intervaloDesvio)})` : null, p.diaMaisFrequente ? `dia habitual: ${p.diaMaisFrequente}` : null].filter(Boolean).join(' · ');
    const extra = [
        p.alternados.length ? `🔁 Alternados: ${p.alternados.map((a) => `${escapeHTML(a.nome)} (a cada ${a.acada} pedidos)`).join(', ')}` : '',
        p.juntos.length ? `🧺 Compra junto: ${p.juntos.map((j) => `${escapeHTML(j.a)} + ${escapeHTML(j.b)}`).join('; ')}` : '',
        p.novos.length ? `🆕 Novos: ${p.novos.map(escapeHTML).join(', ')}` : '',
        p.abandonados.length ? `💤 Possivelmente abandonados: ${p.abandonados.map(escapeHTML).join(', ')}` : ''
    ].filter(Boolean).map((t) => `<p>${t}</p>`).join('');
    const itens = r.itens.map((i) => `<li><b>${escapeHTML(i.nome)} — ${pct(i.p)}</b> <em>(confiança ${i.confRotulo})</em>${i.qtd && i.qtd.esperada ? ` · qtd. habitual ${num(i.qtd.esperada)}` : ''}<ul>${(i.motivos || []).map((m) => `<li>${escapeHTML(m)}</li>`).join('')}</ul></li>`).join('');
    return `<div class="pv-det"><p>${meta}</p>${extra}<ol>${itens}</ol></div>`;
};

const tabelaErros = (av) => {
    if (!av || !av.length) return '<p class="pv-vazio">Ainda sem previsões para comparar. Amanhã, o sistema compara o previsto de hoje com o que foi vendido.</p>';
    return `<div class="pv-scroll"><table class="pv-tab"><thead><tr><th>Dia</th><th></th><th>Erro médio (MAE)</th><th>WAPE</th><th>Dentro da faixa</th></tr></thead><tbody>${av.slice(0, 10).map((a) => `<tr><td>${escapeHTML(a.diaAlvoIso)}</td><td>${a.horizonte === 'amanha' ? 'véspera' : 'manhã'}</td><td>${num(a.mae, 2)}</td><td>${a.wape == null ? '–' : pct(a.wape)}</td><td>${a.cobertura == null ? '–' : pct(a.cobertura)}</td></tr>`).join('')}</tbody></table></div>`;
};

// ------------------------- render principal -------------------------
const render = () => {
    const alvo = document.getElementById('previsao-conteudo'); if (!alvo) return;
    const d = S.dados;
    if (S.carregando && !d) { alvo.innerHTML = '<p class="pv-vazio">Carregando previsões… ⏳</p>'; return; }
    // Falhou ao ler: diz o que houve (antes mostrava "ainda não há previsões", que não era verdade)
    if (!d && S.erro) {
        alvo.innerHTML = `<div class="pv-vazio-box"><div style="font-size:2.4rem">⚠️</div><p><b>Não consegui abrir as previsões.</b></p><p>${escapeHTML(S.erro)}</p>
            <button class="btn-ia-action pv-btn-grande" id="pv-tentar">Tentar de novo</button></div>`;
        return;
    }
    // Nunca calculado: o botão para o PRIMEIRO cálculo fica aqui (antes ele só existia depois de já haver dados)
    if (!d || d.vazio) {
        alvo.innerHTML = `<div class="pv-vazio-box"><div style="font-size:2.4rem">🔮</div><p><b>Ainda não há previsões calculadas.</b></p>
            <p>O sistema lê os pedidos dos últimos meses e estima quanto cada produto deve vender hoje, amanhã e na semana, com sugestão de compra.</p>
            <button class="btn-ia-action pv-btn-grande" id="pv-recalc">🔮 Calcular agora</button>
            <p class="pv-dica">Leva alguns segundos. Com menos de 4 dias de vendas de um produto, ele aparece como "dados insuficientes".</p></div>`;
        return;
    }

    const m = d.meta || {}, db = d.dashboard || {}, av = resumoErro(d.avaliacoes);
    const conf = db.confiancaMedia;
    const avisos = (m.avisos || []).map((a) => `<p class="pv-aviso">⚠️ ${escapeHTML(a)}</p>`).join('');
    const rs = (x) => (x ? `${fmt(x.faturamentoPrevisto)}` : '–');
    alvo.innerHTML = `
    <div class="pv-head">
        <div><h3>🔮 Previsão de Demanda</h3><small>Atualizado ${quando(m.geradoEm)} · ${m.diasHistorico} dia(s) de histórico · ${m.nPedidos} pedido(s) · ${m.nClientes} cliente(s)</small></div>
        <button class="btn-ia-action" id="pv-recalc">↻ Recalcular</button>
    </div>
    ${avisos}
    <div class="pv-kpis">
        ${kpi('Hoje', rs(db.resumo && db.resumo.hoje), `faturamento previsto · ≈ ${num(db.resumo && db.resumo.hoje && db.resumo.hoje.pedidosEsperados)} pedidos`)}
        ${kpi('Amanhã', rs(db.resumo && db.resumo.amanha), `faturamento previsto · ≈ ${num(db.resumo && db.resumo.amanha && db.resumo.amanha.pedidosEsperados)} pedidos`)}
        ${kpi('Confiança média', conf == null ? '–' : pct(conf), conf == null ? '' : `${rotConf(conf)} · ${db.nProdutosPrevistos} produtos`, conf != null ? 'pv-conf--' + rotConf(conf) : '')}
        ${kpi('Erro recente (WAPE)', av ? pct(av.wape) : '–', av ? `${av.n} dia(s) avaliados · ${av.cobertura != null ? pct(av.cobertura) + ' dentro da faixa' : ''}` : 'sem dias avaliados ainda')}
    </div>

    <div class="pv-ctrl">
        <div class="pv-chips">${HORIZONTES.map(([k, r]) => `<button class="pv-chip ${S.horizonte === k ? 'on' : ''}" data-pv-hz="${k}">${r}</button>`).join('')}</div>
        <div class="pv-ctrl2">
            <input type="search" id="pv-busca" placeholder="🔎 Buscar produto..." value="${escapeHTML(S.busca)}">
            <select id="pv-ordem" aria-label="Ordenar">${ORDENS.map(([k, r]) => `<option value="${k}" ${S.ordem === k ? 'selected' : ''}>${r}</option>`).join('')}</select>
        </div>
        <p class="pv-dica">Período: ${(m.hz && m.hz[S.horizonte] ? (m.hz[S.horizonte].length > 1 ? m.hz[S.horizonte][0] + ' a ' + m.hz[S.horizonte][m.hz[S.horizonte].length - 1] : m.hz[S.horizonte][0]) : '–') || '–'}. “Sugestão de compra” cobre a demanda com ${Math.round((m.nivelServico ?? 0.8) * 100)}% de chance (nível de serviço ajustável em analytics/config.js).</p>
    </div>
    <div class="pv-grid" id="pv-lista">${listaProdutos()}</div>

    <h4 class="pv-sec">📊 Visão geral</h4>
    <div class="pv-blocos">
        ${bloco('🚨 Maior risco de falta (7 dias)', (db.riscoFalta || []).map((x) => `<li><span>${escapeHTML(x.nome)}</span><b>${pct(x.risco)} · comprar +${num(x.comprar)}</b></li>`), 'Nenhum produto com estoque controlado em risco.')}
        ${bloco('📦 Maior excesso previsto', (db.excesso || []).map((x) => `<li><span>${escapeHTML(x.nome)}</span><b>+${num(x.excesso)} acima do provável</b></li>`), 'Nenhum excesso detectado.')}
        ${bloco('📈 Demanda crescendo', (db.crescendo || []).map((x) => linhaMini(x, '+' + Math.round(x.pct * 100) + '%')), 'Nenhum produto com alta estatisticamente relevante.')}
        ${bloco('📉 Demanda caindo', (db.caindo || []).map((x) => linhaMini(x, Math.round(x.pct * 100) + '%')), 'Nenhum produto com queda estatisticamente relevante.')}
    </div>
    <p class="pv-dica">Risco de falta e excesso só são calculados para produtos com <b>estoque físico</b> cadastrado${db.estoqueSemControle ? ` (${db.estoqueSemControle} produto(s) sem controle de estoque)` : ''}.</p>
    ${blocoEsperados()}
    <section class="pv-bloco pv-bloco--largo"><h4>🎯 Erro das previsões anteriores</h4>${av ? `<p class="pv-sub">Média dos últimos ${av.n} dia(s): erro médio ${num(av.mae, 2)} · RMSE ${num(av.rmse, 2)} · WAPE ${pct(av.wape)}${av.cobertura != null ? ` · ${pct(av.cobertura)} das vendas caíram dentro da faixa (ideal ≈ 80%)` : ''}</p>` : ''}${tabelaErros(d.avaliacoes)}</section>
    <details class="pv-avancado"><summary>Opções avançadas</summary>
        <p>Para o sistema aprender feriados e sazonalidade, ele precisa de histórico longo. Este botão relê até 1 ano de pedidos <b>uma vez</b> e guarda o resumo diário.</p>
        <button class="btn-ia-action" id="pv-backfill">Importar histórico de 365 dias</button>
    </details>`;
};

// ------------------------- ações -------------------------
const carregar = async () => {
    S.carregando = true; render();
    try { S.dados = await chamar({ acao: 'painel' }); S.erro = ''; }
    catch (e) { console.error(e); S.erro = e.message || 'Não foi possível carregar as previsões.'; if (S.dados) showToast(S.erro, true); }
    finally { S.carregando = false; render(); }
};

const recalcular = async (btn, janelaDias) => {
    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Calculando… ⏳';
    try {
        const r = await chamar({ acao: 'recalcular', janelaDias });
        showToast(r.pulado ? 'Um cálculo acabou de rodar — aguarde um instante.' : `✅ Previsões atualizadas em ${num((r.duracaoMs || 0) / 1000, 1)} s.`, false);
        await carregar();
    } catch (e) { showToast(e.message || 'Falha ao recalcular.', true); btn.disabled = false; btn.textContent = t; }
};

const ligarEventos = () => {
    const raiz = document.getElementById('previsao-conteudo'); if (!raiz || raiz.dataset.ligado) return;
    raiz.dataset.ligado = '1';
    raiz.addEventListener('click', async (e) => {
        const hz = e.target.closest('[data-pv-hz]'); if (hz) { S.horizonte = hz.dataset.pvHz; render(); return; }
        const esp = e.target.closest('[data-pv-esp]'); if (esp) { S.esperadosDia = esp.dataset.pvEsp; render(); return; }
        if (e.target.id === 'pv-recalc') return recalcular(e.target);
        if (e.target.id === 'pv-tentar') return carregar();
        if (e.target.id === 'pv-backfill') return recalcular(e.target, 365);
        const cli = e.target.closest('[data-pv-cli]');
        if (cli) {
            const box = document.getElementById(`pvcli-${cli.dataset.pvCli}`);
            if (box.innerHTML) { box.innerHTML = ''; return; }
            box.innerHTML = '<small>Carregando…</small>';
            try { box.innerHTML = detalheCliente(await chamar({ acao: 'cliente', clienteId: cli.dataset.pvCli })); }
            catch (err) { box.innerHTML = `<small>${escapeHTML(err.message)}</small>`; }
        }
    });
    raiz.addEventListener('input', (e) => {
        if (e.target.id === 'pv-busca') { S.busca = e.target.value; const l = document.getElementById('pv-lista'); if (l) l.innerHTML = listaProdutos(); }
    });
    raiz.addEventListener('change', (e) => { if (e.target.id === 'pv-ordem') { S.ordem = e.target.value; const l = document.getElementById('pv-lista'); if (l) l.innerHTML = listaProdutos(); } });
};

// Sem dados (ou só o "vazio"): consulta de novo a cada abertura da aba — o cálculo diário pode ter rodado.
export const abrirPrevisao = () => { ligarEventos(); if ((!S.dados || S.dados.vazio) && !S.carregando) carregar(); else render(); };
