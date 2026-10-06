// =====================================================================
//  js/admin-maquininha.js — VENDAS DA MAQUININHA (aba Configurações, só o proprietário).
//  Mostra, dia a dia, o que passou na maquininha PagBank ao lado do que o
//  painel registrou. A diferença é o que foi vendido sem passar pelo sistema.
//  As credenciais são guardadas pelo servidor e nunca voltam para a tela.
// =====================================================================
import { auth } from './firebase.js';
import { showToast, fmt, escapeHTML } from './utils.js';

const $ = (id) => document.getElementById(id);
async function api(corpo) {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível concluir.');
    return d;
}
const diaBonito = (iso) => { const [a, m, d] = String(iso).split('-'); return `${d}/${m}`; };

function pintar(d) {
    $('maq-estado').textContent = d.ligada ? 'Maquininha ligada. Toda madrugada o painel busca as vendas do dia anterior.' : 'Ainda não está ligada. Abra "Ligar ou trocar a maquininha" abaixo.';
    $('btn-maq-buscar').hidden = !d.ligada;
    const comDado = (d.dias || []).filter((x) => x.maquininha);
    if (!d.ligada || !comDado.length) { $('maq-dias').innerHTML = d.ligada ? '<p class="config-sub">Ainda não há vendas buscadas. Toque em "Buscar as vendas de ontem agora".</p>' : ''; return; }
    $('maq-dias').innerHTML = d.dias.map((x) => {
        const m = x.maquininha; if (!m) return `<div class="maq-dia"><b class="maq-data">${diaBonito(x.dia)}</b><span class="maq-vazio">não buscado</span></div>`;
        const dif = Math.round((m.total - x.painel) * 100) / 100, pm = m.porMeio || {};
        const partes = [['crédito', pm.credito], ['débito', pm.debito], ['PIX', pm.pix], ['outros', pm.outros]].filter(([, v]) => v > 0).map(([n, v]) => `${n} ${fmt(v)}`).join(' · ');
        return `<div class="maq-dia">
            <b class="maq-data">${diaBonito(x.dia)}</b>
            <div class="maq-numeros"><span><small>Maquininha</small><b>${fmt(m.total)}</b></span><span><small>No painel</small>${fmt(x.painel)}</span><span class="${dif > 0.009 ? 'maq-mais' : ''}"><small>Diferença</small>${dif > 0.009 ? '+' : ''}${fmt(dif)}</span></div>
            <small class="maq-detalhe">${m.vendas} venda${m.vendas === 1 ? '' : 's'}${partes ? ' · ' + escapeHTML(partes) : ''}${m.estornos > 0 ? ' · estornos ' + fmt(m.estornos) : ''}${m.validado === false ? ' · ainda fechando' : ''}${m.formatoDesconhecido ? ' · formato não reconhecido, avise o suporte' : ''}</small>
        </div>`;
    }).join('') + '<p class="config-sub">"No painel" é o que entrou como pedido ou venda do balcão, em qualquer forma de pagamento. Diferença positiva: passou na maquininha mais do que o painel registrou.</p>';
}

async function carregar() { try { pintar(await api({ acao: 'maquininha-estado' })); } catch (e) { $('maq-estado').textContent = 'Não consegui conferir a maquininha agora.'; } }

async function ocupar(botao, texto, fn) {
    const antes = botao.textContent; botao.disabled = true; botao.textContent = texto;
    try { await fn(); } catch (e) { showToast(e.message, true); } finally { botao.disabled = false; botao.textContent = antes; }
}

let ligado = false;
export function iniciarMaquininha() {
    const caixa = $('maq-box'); if (!caixa || ligado) return;
    ligado = true; caixa.hidden = false;
    $('btn-maq-salvar').addEventListener('click', (e) => ocupar(e.currentTarget, 'Guardando...', async () => {
        const d = await api({ acao: 'maquininha-salvar', estabelecimento: $('maq-estab').value.trim(), token: $('maq-token').value.trim() });
        $('maq-token').value = ''; pintar(d); showToast(d.ligada ? 'Maquininha ligada. Toque em "Buscar as vendas de ontem agora" para testar.' : 'Maquininha desligada.');
    }));
    $('btn-maq-buscar').addEventListener('click', (e) => ocupar(e.currentTarget, 'Buscando no PagBank...', async () => {
        const d = await api({ acao: 'maquininha-buscar' }); pintar(d);
        showToast(d.buscado && d.buscado.formatoDesconhecido ? 'O PagBank respondeu, mas num formato que o painel ainda não lê. Avise o suporte.' : `Ontem: ${fmt(d.buscado.total)} em ${d.buscado.vendas} venda(s) na maquininha.`, !!(d.buscado && d.buscado.formatoDesconhecido));
    }));
    carregar();
}
