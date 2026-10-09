
// =====================================================================
//  js/ranking-loja.js — ordena a vitrine pela relevância PARA ESTE CLIENTE.
//
//  Como funciona:
//   1. Pede a /api/analytics { acao:'ranking' } o ranking do próprio
//      cliente. O servidor identifica quem é pelo TOKEN do Firebase
//      (uid anônimo) — o navegador não informa nem consegue informar
//      "quem é". Nenhum dado de outro cliente chega aqui.
//   2. Reordena os cards com CSS `order` (não recria nem move nós do DOM:
//      o carrinho, badges e favoritos continuam intactos).
//   3. Se a API falhar, estiver lenta ou o cliente não tiver histórico,
//      a loja segue na ordem padrão (ou na popularidade geral = cold start).
//
//  Nada aqui faz cálculo pesado: só consome o resultado já pronto.
// =====================================================================
import { auth } from './firebase.js';
import { chave } from './tenant.js';

const TTL_MS = 10 * 60 * 1000;           // ranking com menos de 10 min: nem pede de novo
const VALE_MS = 7 * 24 * 3600 * 1000;    // ranking de até 7 dias: já ordena a vitrine na abertura (sem esperar o servidor)
const CHAVE = chave('banca_rank_v2');

let escores = new Map();                  // id → { p, motivo?, repor? }
let nivel = 'sem_dados';
let mediana = 0.3;
let iniciado = false;

export const scoreDe = (id) => (escores.has(id) ? escores.get(id).p : 0);
export const nivelCliente = () => nivel;
// Produtos que ESTE cliente costuma levar (os que o motor explicou: "Você sempre leva",
// "Hora de repor"...). Alimenta a faixa "Seus de sempre" no topo da loja.
export const destaques = (max = 8) => (nivel === 'sem_historico' || nivel === 'sem_dados' ? []
    : [...escores.values()].filter((e) => e.motivo).sort((a, b) => b.p - a.p).slice(0, max).map((e) => e.id));
const avisar = () => document.dispatchEvent(new Event('ranking-pronto'));

// Guardado no aparelho (não só na aba): na próxima abertura a vitrine já nasce na ordem certa.
const lerCache = (uid) => {
    try {
        const c = JSON.parse(localStorage.getItem(CHAVE) || 'null');
        return c && c.uid === uid && Date.now() - c.ts < VALE_MS ? c : null;
    } catch (_) { return null; }
};
// a vitrine já está na tela? (então trocar a ordem faria os cards pularem debaixo do dedo)
const vitrineNaTela = () => !!document.querySelector('#lista-produtos .produto-card');

const guardar = (dados) => {
    escores = new Map((dados.itens || []).map((i) => [i.id, i]));
    nivel = dados.nivel || 'sem_dados';
    const ps = (dados.itens || []).map((i) => i.p).sort((a, b) => a - b);
    mediana = ps.length ? ps[Math.floor(ps.length / 2)] : 0.3;
};

export async function iniciarRanking() {
    if (iniciado) return;
    iniciado = true;
    try {
        const user = auth.currentUser;
        if (!user) { iniciado = false; return; }

        const cache = lerCache(user.uid);
        if (cache) { guardar(cache.dados); aplicarOrdem(); avisar(); if (Date.now() - cache.ts < TTL_MS) return; }

        const token = await user.getIdToken();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);   // loja nunca espera mais que 4 s
        const res = await fetch('/api/analytics', {
            method: 'POST', signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ acao: 'ranking' })
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const dados = await res.json();
        if (!dados.sucesso || !Array.isArray(dados.itens) || !dados.itens.length) return;

        try { localStorage.setItem(CHAVE, JSON.stringify({ uid: user.uid, ts: Date.now(), dados })); } catch (_) { /* aparelho cheio */ }
        // Chegou depois que a vitrine apareceu? NÃO troca os cards de lugar (nem põe a faixa "Seus de sempre"
        // em cima deles): a tela pulava inteira. A ordem nova fica guardada e vale na próxima abertura.
        if (vitrineNaTela()) return;
        guardar(dados); aplicarOrdem(); avisar();
    } catch (e) {
        iniciado = false;                      // permite nova tentativa no próximo login/refresh
        console.warn('[ranking] usando ordem padrão:', e && e.message);
    }
}

// Reaplica a ordem. Chamada também sempre que o grid é reconstruído.
export function aplicarOrdem() {
    const grid = document.getElementById('lista-produtos');
    if (!grid || !escores.size) return;
    grid.querySelectorAll('.produto-card').forEach((card) => {
        const e = escores.get(card.dataset.id);
        // maior probabilidade → menor `order`. Produto sem pontuação (novo) entra na mediana,
        // em vez de ser enterrado no fim — senão nunca teria chance de ser descoberto.
        card.style.order = String(Math.round((1 - (e ? e.p : mediana)) * 1000));

        card.querySelector('.rec-tag')?.remove();
        if (e && e.motivo && nivel !== 'sem_historico') {
            const wrap = card.querySelector('.produto-img-wrap');
            if (wrap) { const tag = document.createElement('span'); tag.className = `rec-tag${e.repor ? ' rec-tag--repor' : ''}`; tag.textContent = String(e.motivo); wrap.appendChild(tag); }   // texto puro: nunca vira HTML
        }
    });
}
