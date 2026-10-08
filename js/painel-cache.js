// Uma chamada só ao resultado do motor (/api/analytics → painel), guardada por 10 minutos e
// dividida entre as abas Estoque, Compras e Clientes. Antes cada aba faria a própria leitura.
import { auth } from './firebase.js';
// `atualizar` (aba Clientes): o servidor confere se chegou pedido depois do último cálculo e, se
// chegou, recalcula antes de responder. Essa conferência é barata, então só espera 1 minuto entre uma e outra.
let guardado = null, em = 0, emCurso = null, conferidoEm = 0;
export async function lerPainel({ forcar = false, atualizar = false } = {}) {
    if (!forcar && guardado && (atualizar ? Date.now() - conferidoEm < 60000 : Date.now() - em < 600000)) return guardado;
    if (emCurso) return emCurso;
    emCurso = (async () => {
        const token = await auth.currentUser?.getIdToken();
        const r = await fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'painel', ...(atualizar ? { atualizar: true } : {}) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Falha ao consultar a previsão.');
        guardado = j; em = Date.now(); if (atualizar) conferidoEm = em; return j;
    })();
    try { return await emCurso; } finally { emCurso = null; }
}
