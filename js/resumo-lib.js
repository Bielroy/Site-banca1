// =====================================================================
//  js/resumo-lib.js — contas PURAS da aba Resumo (sem tela, sem Firebase),
//  separadas para poderem ser testadas (testes/index.js).
//
//  Usa a mesma regra do Balanço: o pedido conta no dia da ENTREGA (o caixa
//  daquele dia) e cancelado fica de fora.
// =====================================================================
import { situacao } from './estoque-lib.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const diaDoISO = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t - 3 * 3600000).toISOString().slice(0, 10) : ''; };
const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Dia em que o pedido entra no caixa: o da entrega marcada, ou o dia em que foi feito (horário de Brasília). */
export const diaDoPedido = (p) => (DIA.test(String(p && p.entregaDia || '')) ? p.entregaDia : diaDoISO(p && p.data));

/** Pedido que entra na conta do dia (cancelado não entra). */
export const contaNoCaixa = (p) => !!p && p.status !== 'cancelado';

/** Pedido que ainda espera alguém da banca. */
export const ESPERANDO = ['pendente', 'aguardando_pesagem'];

/**
 * Números do resumo.
 *   pedidos  → pedidos dos últimos dias (os de dias futuros e os cancelados são ignorados)
 *   hoje     → 'AAAA-MM-DD' (horário de Brasília)
 *   dias     → quantos dias vão no gráfico (o último é hoje)
 * Devolve { vendido, pedidos, ontem, variacao, ticket, serie: [{ dia, valor, pedidos, hoje }] }.
 * `variacao` é a diferença para ontem em % (null quando ontem não vendeu nada: não dá para comparar).
 */
export function resumoDoDia(pedidos, hoje, dias = 7) {
    const serie = Array.from({ length: dias }, (_, i) => ({ dia: somaDias(hoje, i - dias + 1), valor: 0, pedidos: 0, hoje: i === dias - 1 }));
    const porDia = new Map(serie.map((s) => [s.dia, s]));
    const ontemDia = somaDias(hoje, -1);
    let ontem = 0, unicosHoje = 0, somaUnicos = 0;
    (Array.isArray(pedidos) ? pedidos : []).filter(contaNoCaixa).forEach((p) => {
        const d = diaDoPedido(p), v = Number(p.total) || 0;
        const s = porDia.get(d);
        if (s) { s.valor += v; s.pedidos += 1; }
        if (d === ontemDia) ontem += v;
        // o resumo de várias vendas do balcão é dinheiro de verdade, mas não é UM pedido (mesma regra do Balanço)
        if (d === hoje && !p.resumoDoDia) { unicosHoje += 1; somaUnicos += v; }
    });
    const doDia = porDia.get(hoje) || { valor: 0, pedidos: 0 };
    const arred = (n) => Math.round(n * 100) / 100;
    return {
        vendido: arred(doDia.valor),
        pedidos: doDia.pedidos,
        ontem: arred(ontem),
        variacao: ontem > 0 ? Math.round(((doDia.valor - ontem) / ontem) * 100) : null,
        ticket: unicosHoje ? arred(somaUnicos / unicosHoje) : 0,
        serie: serie.map((s) => ({ ...s, valor: arred(s.valor) })),
    };
}

/** Produtos à venda que acabaram ou estão abaixo do mínimo, os zerados primeiro. Só entra quem tem estoque contado. */
export function produtosAcabando(produtos) {
    const peso = { zerado: 0, baixo: 1 };
    return (Array.isArray(produtos) ? produtos : [])
        .filter((p) => p && p.ativo !== false && !p.soInsumo)
        .map((p) => ({ p, sit: situacao(p) }))
        .filter((x) => x.sit === 'zerado' || x.sit === 'baixo')
        .sort((a, b) => peso[a.sit] - peso[b.sit] || String(a.p.nome || '').localeCompare(String(b.p.nome || ''), 'pt-BR'))
        .map((x) => ({ id: x.p.id, nome: String(x.p.nome || 'Produto'), situacao: x.sit }));
}

/** Pedidos que esperam alguém, do mais antigo para o mais novo (quem chegou primeiro é atendido primeiro). */
export function pedidosEsperando(fila) {
    return (Array.isArray(fila) ? fila : [])
        .filter((p) => p && ESPERANDO.includes(p.status))
        .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pelo horário de Brasília. */
export function saudacao(agora = Date.now()) {
    const h = new Date(agora - 3 * 3600000).getUTCHours();
    return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
}
