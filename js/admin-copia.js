// =====================================================================
//  js/admin-copia.js — CÓPIA DE SEGURANÇA (aba Configurações, só o proprietário).
//  O servidor guarda sozinho uma cópia por dia (as últimas 7). Aqui a tela
//  mostra quando foi a última e deixa baixar uma cópia feita na hora, para
//  guardar no computador, no Drive ou onde a pessoa quiser.
// =====================================================================
import { auth } from './firebase.js';
import { TENANT } from './tenant.js';
import { showToast, customConfirm } from './utils.js';

const $ = (id) => document.getElementById(id);
async function api(corpo) {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível concluir.');
    return d;
}
const dataBonita = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; } };

async function pintarEstado() {
    try {
        const dados = await api({ acao: 'copia-estado' }), ultima = dados.ultima;
        $('copia-estado').textContent = ultima
            ? `Última cópia automática: ${dataBonita(ultima.feitaEm)} · ${ultima.contagem.produtos || 0} produtos e ${ultima.contagem.pedidos || 0} pedidos. Ficam guardadas as últimas ${ultima.guardadas > 1 ? ultima.guardadas + ' cópias' : 'cópia'}.`
            : 'Ainda não há cópia automática. A primeira é feita na próxima madrugada.';
        const copias = Array.isArray(dados.copias) ? dados.copias : [], caixa = $('copia-restaurar');
        if (caixa) {
            caixa.hidden = !copias.length;
            $('copia-dia').innerHTML = copias.map((c) => `<option value="${String(c.dia).replace(/[^0-9a-z-]/g, '')}">${dataBonita(c.feitaEm)}${/-antes$/.test(c.dia) ? ' (guardada antes de restaurar)' : ''} · ${c.contagem.produtos || 0} produtos</option>`).join('');
        }
    } catch (e) { $('copia-estado').textContent = 'Não consegui ver a última cópia agora.'; }
}

async function restaurar() {
    const sel = $('copia-dia'), dia = sel.value, rotulo = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : dia;
    if (!dia) return;
    const ok = await customConfirm('Voltar o cadastro para esta cópia?', `Produtos, categorias, configurações e cupons voltam a ficar como estavam em ${rotulo}. Preços e estoques mudados depois disso serão desfeitos. Pedidos não mudam.`, { ok: 'Restaurar', nao: 'Não mexer' });
    if (!ok) return;
    const b = $('btn-restaurar-copia'); b.disabled = true; b.textContent = 'Restaurando...';
    try {
        const r = await api({ acao: 'copia-restaurar', dia });
        showToast(`Cadastro restaurado: ${r.contagem.produtos || 0} produtos. Recarregando o painel...`);
        setTimeout(() => location.reload(), 1800);
    } catch (e) { showToast(e.message, true); b.disabled = false; b.textContent = 'Restaurar'; }
}

async function baixar() {
    const b = $('btn-baixar-copia'); b.disabled = true; b.textContent = 'Gerando...';
    try {
        const { copia } = await api({ acao: 'copia-baixar' });
        const url = URL.createObjectURL(new Blob([JSON.stringify(copia, null, 1)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `copia-${TENANT}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast(`Cópia baixada: ${copia.contagem.produtos || 0} produtos e ${copia.contagem.pedidos || 0} pedidos.`);
    } catch (e) { showToast(e.message, true); }
    finally { b.disabled = false; b.textContent = 'Baixar cópia agora'; }
}

async function zerar() {
    if ($('zerar-palavra').value.trim().toUpperCase() !== 'ZERAR') return showToast('Para confirmar, escreva ZERAR no campo ao lado.', true);
    const ok = await customConfirm('Apagar todo o movimento?', 'Pedidos, vendas, caixa, histórico de estoque e tudo o que o motor de previsão aprendeu serão apagados desta loja. Os produtos e as configurações ficam. Não dá para desfazer.', { ok: 'Apagar tudo', nao: 'Não apagar' });
    if (!ok) return;
    const b = $('btn-zerar'); b.disabled = true; b.textContent = 'Apagando...';
    try {
        const r = await api({ acao: 'zerar-movimento', confirmacao: 'ZERAR' });
        showToast(`Pronto: ${r.total} registros apagados. Recarregando o painel...`);
        setTimeout(() => location.reload(), 2000);
    } catch (e) { showToast(e.message, true); b.disabled = false; b.textContent = 'Apagar o movimento'; }
}

let ligado = false;
export function iniciarCopia() {
    const caixa = $('copia-box'); if (!caixa || ligado) return;
    ligado = true; caixa.hidden = false;
    $('btn-baixar-copia').addEventListener('click', baixar);
    $('btn-restaurar-copia')?.addEventListener('click', restaurar);
    const zb = $('zerar-box'); if (zb) { zb.hidden = false; $('btn-zerar').addEventListener('click', zerar); }
    pintarEstado();
}
