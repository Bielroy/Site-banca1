// =====================================================================
//  js/impressao-auto.js — IMPRESSÃO AUTOMÁTICA dos pedidos neste aparelho.
//
//  Quem decide O QUE imprimir: js/impressao-fila-lib.js (regra pura).
//  Quem garante que não sai duas vezes: o servidor (/api/pdv, acao 'impressao', lib/impressao.js).
//  Como sai no papel: js/impressao.js (Bluetooth direto ou cabo).
//
//  Fluxo de cada pedido:  reservar no servidor → imprimir aqui → confirmar
//                         (se a impressora falhar: liberar, avisar na faixa e tentar de novo).
//
//  Limites (o navegador manda): o painel precisa estar ABERTO neste aparelho, com a tela acesa.
//  Por isso: a tela fica acesa sozinha (quando o aparelho deixa), uma faixa no topo diz se está
//  imprimindo ou parado, e o que chegou com o painel fechado sai quando ele abrir de novo.
//
//  Caminho "Celular da banca" (app Ponte): quem imprime é o celular, não este painel. Aqui só
//  aparece a faixa dizendo se o celular e a impressora estão bem (js/impressao-ponte.js).
// =====================================================================
import { auth } from './firebase.js';
import { chave } from './tenant.js';
import { escapeHTML, showToast } from './utils.js';
import { lerConfig, imprimir, reconectar, conectar, conectada, aparelhoId } from './impressao.js';
import { cupomDoPedido, etiquetaDeEntrega, avisoDeCancelamento } from './impressao-lib.js';
import { MODOS_AUTO, LIMITE_SEM_PERGUNTAR, RESERVA_MS, podeAutomatico, trabalhosDe, versaoDesejada } from './impressao-fila-lib.js';
import { loja, abrirImpressora } from './admin-impressao.js';
import { ico } from './icones-admin.js';
import * as Ponte from './impressao-ponte.js';

const TENTAR_DE_NOVO_MS = 20 * 1000, VIGIA_MS = 60 * 1000, GUARDAR_DIAS = 3, PONTE_OLHAR_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------- memória deste aparelho
// "feitos": o que ESTE aparelho já imprimiu (não reimprime se o servidor demorar a confirmar).
// "pular": o que você mandou não imprimir (pedidos que já estavam na fila quando ligou o automático).
function lerMarcas(nome) {
    try { const o = JSON.parse(localStorage.getItem(chave(nome)) || '{}'); const lim = Date.now() - GUARDAR_DIAS * 86400000; return new Map(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, t]) => Number(t) > lim)); }
    catch (_) { return new Map(); }
}
function gravarMarcas(nome, mapa) { try { localStorage.setItem(chave(nome), JSON.stringify(Object.fromEntries(mapa))); } catch (_) { /* armazenamento bloqueado: vale só enquanto o painel está aberto */ } }
const feitos = lerMarcas('banca_impressos'), pulados = lerMarcas('banca_impressao_pular');
const marcar = (mapa, nome, k) => { mapa.set(k, Date.now()); gravarMarcas(nome, mapa); };

// ---------------------------------------------------------------- estado
const S = {
    iniciado: false, pedidos: new Map(), cancelados: new Map(),
    rodando: false, deNovo: false, imprimindo: '', erro: '', esperando: 0,
    leva: null,                // pedidos parados na fila esperando você decidir (imprimir ou pular)
    limiteDaLeva: LIMITE_SEM_PERGUNTAR, primeira: true, ativoAntes: false,
    timer: null, vigia: null, tela: null,
};
const cfg = () => ({ ...lerConfig(), aparelho: aparelhoId() });
export const ativo = (c = lerConfig()) => c.auto !== 'manual' && podeAutomatico(c.modo);
const trabalhos = () => trabalhosDe([...S.pedidos.values(), ...S.cancelados.values()], cfg(), { ignorados: pulados, feitos });

// ---------------------------------------------------------------- servidor
async function fila(op, t) {
    const token = await auth.currentUser?.getIdToken();
    const r = await fetch('/api/pdv', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ acao: 'impressao', op, pedidoId: t.id, versao: t.versao, aparelho: aparelhoId() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'A fila de impressão não respondeu.'), { amigavel: true });
    return d;
}

// ---------------------------------------------------------------- o papel
async function folhasDe(t) {
    const c = lerConfig(), l = await loja(), p = t.pedido;
    if (t.versao === 'cancelado') return [avisoDeCancelamento(p, { loja: l })];
    const cupom = cupomDoPedido(p, { loja: l, aviso: t.versao === 'pesado' ? 'CUPOM ATUALIZADO (depois da balança)' : '' });
    const folhas = Array.from({ length: c.copias || 1 }, () => cupom);
    // a etiqueta da sacola sai uma vez: no primeiro papel deste pedido (o cupom atualizado não repete a etiqueta)
    if (c.autoEtiqueta && !(p.impressao && p.impressao.saiu)) folhas.push(etiquetaDeEntrega(p, { loja: l }));
    return folhas;
}

// ---------------------------------------------------------------- a fila deste aparelho
async function imprimirUm(t) {
    let reserva;
    try { reserva = await fila('reservar', t); }
    catch (e) { S.erro = 'Sem conexão com a fila de impressão. Tento de novo em instantes.'; return false; }
    if (!reserva.ok) {
        if (reserva.motivo === 'ja' || reserva.motivo === 'sumiu') marcar(feitos, 'banca_impressos', t.chave);
        else agendar(RESERVA_MS + 2000);                                   // outro aparelho imprimindo: confere depois
        return true;
    }
    S.imprimindo = t.pedido.nome || 'cliente'; pintar();
    try {
        await imprimir(await folhasDe(t), { copias: 1 });
    } catch (e) {
        console.error('[impressao-auto]', e);
        fila('liberar', t).catch(() => {});                                // solta para tentar de novo
        S.erro = e && e.amigavel ? e.message : 'A impressora não respondeu.';
        return false;
    }
    marcar(feitos, 'banca_impressos', t.chave);                           // já saiu: mesmo se a confirmação atrasar, não sai de novo daqui
    fila('confirmar', t).catch(() => fila('confirmar', t).catch(() => {}));
    return true;
}

async function processar() {
    if (!S.iniciado) return;
    const c = lerConfig(), ligado = ativo(c);
    if (ligado && !S.ativoAntes) { S.primeira = true; S.limiteDaLeva = S.iniciadoAgora ? LIMITE_SEM_PERGUNTAR : 0; }    // acabou de ligar: pergunta sobre o que já estava na fila
    S.ativoAntes = ligado; S.iniciadoAgora = false;
    telaAcesa(ligado);
    if (!ligado) { S.leva = null; S.erro = ''; pintar(); return; }
    if (!S.recebeu) { pintar(); return; }                                // a fila ainda não chegou do banco: não decide nada no escuro
    if (S.rodando) { S.deNovo = true; return; }
    const lista = trabalhos();
    S.esperando = lista.length;
    if (S.primeira && lista.length > S.limiteDaLeva) { S.leva = lista; pintar(); return; }   // você decide na faixa
    S.primeira = false; S.leva = null;
    if (!lista.length) { pintar(); return; }
    S.rodando = true; S.erro = '';
    try {
        for (const t of lista) {
            const agora = trabalhos().find((x) => x.chave === t.chave);     // ainda precisa? (pode ter mudado enquanto imprimia o anterior)
            if (!agora) continue;
            if (!(await imprimirUm(agora))) { agendar(TENTAR_DE_NOVO_MS); break; }
        }
    } finally {
        S.rodando = false; S.imprimindo = ''; S.esperando = trabalhos().length; pintar();
        if (S.deNovo && !S.erro) { S.deNovo = false; processar(); }
    }
}

function agendar(ms) {
    clearTimeout(S.timer);
    S.timer = setTimeout(async () => { if (ativo()) { await reconectar(); S.erro = ''; processar(); } }, ms);
}

// ---------------------------------------------------------------- tela acesa
async function telaAcesa(sim) {
    try {
        if (sim && !S.tela && !S.pedindoTela && document.visibilityState === 'visible' && navigator.wakeLock) {
            S.pedindoTela = true;
            try { S.tela = await navigator.wakeLock.request('screen'); } finally { S.pedindoTela = false; }
            S.tela.addEventListener('release', () => { S.tela = null; });
        } else if (!sim && S.tela) { await S.tela.release(); S.tela = null; }
    } catch (_) { S.tela = null; /* aparelho não deixou (bateria fraca, economia de energia) */ }
}

// ---------------------------------------------------------------- faixa no topo do painel
function faixa() {
    let f = document.getElementById('imp-auto');
    if (!f) {
        const casa = document.getElementById('dashboard'); if (!casa) return null;
        f = document.createElement('div'); f.id = 'imp-auto'; f.setAttribute('role', 'status'); f.setAttribute('aria-live', 'polite');
        const topo = document.getElementById('topo');                       // logo abaixo do topo, visível em qualquer tela do painel
        if (topo && topo.parentNode === casa) topo.insertAdjacentElement('afterend', f); else casa.insertBefore(f, casa.firstChild);
        f.addEventListener('click', aoTocarNaFaixa);
    }
    return f;
}
function desenhar(f, tipo, html) {
    const novo = `${ico('impressora')}${html}`;
    f.hidden = false; f.className = `imp-auto ${tipo}`;
    if (f.dataset.html !== novo) { f.innerHTML = novo; f.dataset.html = novo; }   // só redesenha se mudou (não pisca, não perde o toque)
}
const esconder = (f) => { f.hidden = true; f.innerHTML = ''; f.dataset.html = ''; };
/** Faixa do caminho "Celular da banca": só aparece se algo precisa de você (ou se a automática está ligada). */
function pintarPonte(f) {
    const s = Ponte.situacao();
    if (s.tipo === 'carregando' || (s.tipo === 'ok' && s.auto === 'manual')) return esconder(f);
    if (s.tipo === 'nenhum') return desenhar(f, 'alerta', '<span>Nenhum <b>celular da banca</b> ligado para imprimir.</span><button type="button" data-imp="abrir">Impressora</button>');
    if (s.tipo === 'fora') return desenhar(f, 'erro', `<span><b>Celular da banca sem contato</b> ${escapeHTML(Ponte.quandoFoi(s.visto))}. Confira se ele está ligado e com internet. Os pedidos ficam guardados e saem quando ele voltar.</span><button type="button" data-imp="abrir">Ver</button>`);
    if (s.tipo === 'impressora') return desenhar(f, 'erro', `<span><b>Impressora parada no celular da banca.</b> ${escapeHTML(s.msg)}</span><button type="button" data-imp="abrir">Ver</button>`);
    return desenhar(f, 'ok', `<span><b>Impressão automática ligada</b> · pelo celular da banca · ${escapeHTML((MODOS_AUTO[s.auto] || MODOS_AUTO.manual)[0].toLowerCase())}</span>`);
}
function pintar() {
    const f = faixa(); if (!f) return;
    const c = lerConfig();
    if (c.modo === 'ponte') return pintarPonte(f);
    if (c.auto === 'manual') { esconder(f); return; }
    f.hidden = false;
    const rot = (MODOS_AUTO[c.auto] || MODOS_AUTO.manual)[0].toLowerCase(), n = S.esperando;
    let tipo = 'ok', html;
    if (!podeAutomatico(c.modo)) {
        tipo = 'alerta'; html = `<span>A impressão automática precisa do <b>Bluetooth direto</b> ou do <b>cabo</b>.</span><button type="button" data-imp="abrir">Impressora</button>`;
    } else if (S.leva) {
        tipo = 'alerta'; html = `<span>Tem <b>${S.leva.length}</b> pedido(s) na fila que ainda não saíram no papel.</span><button type="button" data-imp="leva-sim">Imprimir ${S.leva.length}</button><button type="button" class="sec" data-imp="leva-nao">Só os próximos</button>`;
    } else if (S.erro) {
        tipo = 'erro'; html = `<span><b>Impressão parada.</b> ${escapeHTML(S.erro)}${n ? ` ${n} pedido(s) esperando.` : ''}</span><button type="button" data-imp="conectar">${conectada() ? 'Tentar de novo' : 'Conectar'}</button>`;
    } else if (S.imprimindo) {
        html = `<span>Imprimindo o pedido de <b>${escapeHTML(S.imprimindo)}</b>…</span>`;
    } else {
        html = `<span><b>Impressão automática ligada</b> · ${escapeHTML(rot)}${conectada() ? '' : ' · <em>impressora ainda não conectada</em>'}${navigator.wakeLock ? '' : ' · deixe a tela do aparelho sempre acesa'}</span>${conectada() ? '' : '<button type="button" data-imp="conectar">Conectar</button>'}`;
    }
    desenhar(f, tipo, html);
}
async function aoTocarNaFaixa(e) {
    const b = e.target.closest('[data-imp]'); if (!b) return;
    const a = b.dataset.imp;
    if (a === 'abrir') return abrirImpressora();
    if (a === 'leva-sim') { S.primeira = false; S.leva = null; return processar(); }
    if (a === 'leva-nao') { (S.leva || []).forEach((t) => marcar(pulados, 'banca_impressao_pular', t.chave)); S.primeira = false; S.leva = null; showToast('Certo: só os próximos pedidos saem sozinhos.'); return processar(); }
    if (a === 'conectar') {
        b.disabled = true;
        try { if (!(await reconectar())) await conectar(); S.erro = ''; showToast('Impressora conectada.'); }
        catch (err) { S.erro = err && err.amigavel ? err.message : 'Não consegui conectar. Confira se a impressora está ligada e perto.'; }
        pintar(); processar();
    }
}

// ---------------------------------------------------------------- o que o painel chama
/** Liga a impressão automática neste painel (só para quem atende pedidos). */
export function iniciar() {
    if (S.iniciado) return;
    S.iniciado = true; S.iniciadoAgora = true;
    document.addEventListener('impressao:config', () => { if (lerConfig().modo === 'ponte') Ponte.atualizar(); processar(); });   // mudou algo em "Impressora"
    document.addEventListener('ponte:estado', () => pintar());
    const olharPonte = () => { if (lerConfig().modo === 'ponte' && document.visibilityState === 'visible' && Date.now() - Ponte.estado().em > PONTE_OLHAR_MS - 5000) Ponte.atualizar(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { S.tela = null; olharPonte(); processar(); } });
    S.vigia = setInterval(async () => { olharPonte(); if (ativo() && !S.rodando) { if (!conectada()) await reconectar(); processar(); } }, VIGIA_MS);
    if (lerConfig().modo === 'ponte') Ponte.atualizar();
    if (ativo()) reconectar().then(() => pintar());                                     // painel reaberto: tenta voltar à impressora sem toque
    pintar();
}
/** A fila de pedidos mudou (já com os dados do cliente abertos). */
export function aoMudarPedidos(lista) { S.pedidos = new Map((lista || []).map((p) => [p.id, p])); S.recebeu = true; processar(); }
/** Pedidos cancelados recentes (para o aviso "PEDIDO CANCELADO" de quem já tinha saído no papel). */
export function aoMudarCancelados(lista) { S.cancelados = new Map((lista || []).filter((p) => p.status === 'cancelado').map((p) => [p.id, p])); processar(); }
/** Cupom impresso à mão: entra na fila como impresso, para o automático não imprimir de novo. */
export function marcarImpresso(p) {
    if (!p || !p.id || p.status === 'cancelado') return;
    if (lerConfig().modo === 'ponte') return;                                      // o servidor marca quando o celular da banca confirmar que saiu
    const t = { id: p.id, versao: versaoDesejada(p, lerConfig()) };
    marcar(feitos, 'banca_impressos', `${t.id}:${t.versao}`);
    fila('confirmar', t).catch(() => {});
}
/** Saiu do painel: esquece os pedidos e apaga a faixa. */
export function parar() {
    S.pedidos.clear(); S.cancelados.clear(); S.recebeu = false; S.primeira = true; S.limiteDaLeva = LIMITE_SEM_PERGUNTAR; S.leva = null; S.erro = ''; telaAcesa(false); clearTimeout(S.timer);
    const f = document.getElementById('imp-auto'); if (f) f.hidden = true;
}
