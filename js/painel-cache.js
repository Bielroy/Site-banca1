// Uma chamada só ao resultado do motor (/api/analytics → painel), guardada por 10 minutos e
// dividida entre as abas Estoque, Compras e Clientes. Antes cada aba faria a própria leitura.
import { auth } from './firebase.js';
let guardado = null, em = 0, emCurso = null;
export async function lerPainel({ forcar = false } = {}) {
    if (!forcar && guardado && Date.now() - em < 600000) return guardado;
    if (emCurso) return emCurso;
    emCurso = (async () => {
        const token = await auth.currentUser?.getIdToken();
        const r = await fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'painel' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Falha ao consultar a previsão.');
        guardado = j; em = Date.now(); return j;
    })();
    try { return await emCurso; } finally { emCurso = null; }
}
