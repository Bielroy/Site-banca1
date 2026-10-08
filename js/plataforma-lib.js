// Regras puras da tela da plataforma (testadas sem navegador).
/** "Espetinhos do Zé" → "espetinhos-do-ze" (mesma regra de id do servidor: a-z, 0-9 e hífen, 2 a 40). */
export const sugerirId = (nome) => String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
export const idValido = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));
/** Soma do mês de todas as lojas. */
export function totais(lojas) {
    const l = Array.isArray(lojas) ? lojas : [];
    return { lojas: l.length, ativas: l.filter((x) => x.ativo).length, receita: Math.round(l.reduce((t, x) => t + ((x.mes && x.mes.receita) || 0), 0) * 100) / 100, pedidos: l.reduce((t, x) => t + ((x.mes && x.mes.pedidos) || 0), 0) };
}

// ---------------------------------------------------------------------
// FEIRAS POR DIA DA SEMANA
// Cada feira acontece em certos dias (0 = domingo ... 6 = sábado) e tem as
// lojas que vão NAQUELE dia. A mesma loja pode estar em várias feiras.
// Feira sem dia marcado vale para todos os dias (era assim antes).
// ---------------------------------------------------------------------
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Só números inteiros de 0 a 6, sem repetir, em ordem. */
export const limparDias = (dias) => [...new Set((Array.isArray(dias) ? dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
/** "Qua" · "Qua e Sex" · "Todos os dias". */
export const diasEmTexto = (dias) => { const d = limparDias(dias); return !d.length || d.length === 7 ? 'Todos os dias' : d.map((n) => DIAS_SEMANA[n]).join(d.length === 2 ? ' e ' : ', '); };
/**
 * Qual feira vale HOJE para esta loja. Primeiro a que tem o dia marcado; depois a que vale
 * para todos os dias. Se nenhuma acontece hoje, devolve null (a faixa de lojas some).
 */
export function feiraDoDia(feiras, dia) {
    const lista = (Array.isArray(feiras) ? feiras : []).filter((f) => f && Array.isArray(f.lojas));
    const doDia = lista.filter((f) => limparDias(f.dias).includes(dia));
    if (doDia.length) return doDia[0];
    return lista.find((f) => !limparDias(f.dias).length) || null;
}
/** Ids das feiras de uma loja: a lista nova (feiras) mais o campo antigo (feiraId). No máximo 8. */
export const feirasDaFicha = (ficha) => [...new Set([...(ficha && Array.isArray(ficha.feiras) ? ficha.feiras : []), ficha && ficha.feiraId].filter((id) => typeof id === 'string' && idValido(id)))].slice(0, 8);

// ---------------------------------------------------------------------
// FEIRA DO CLIENTE (vitrine). Cada feira tem um link próprio (/feira/id).
// Quem entra por ele fica "da feira" (gravado no aparelho e na conta) e só
// vê as bancas dela, mesmo que outra feira aconteça no mesmo dia.
// ---------------------------------------------------------------------
/** "Jardins Munique" / "JARDINS  munique" → "jardins munique" (mesma regra do motor: analytics/normalize.js). */
export const normCond = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Condomínios de uma feira: texto limpo, sem repetir, no máximo 40. */
export function limparCondominios(lista) {
    const vistos = new Set(), out = [];
    for (const c of Array.isArray(lista) ? lista : []) {
        const nome = String(c == null ? '' : c).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80), k = normCond(nome);
        if (k.length < 2 || vistos.has(k)) continue;
        vistos.add(k); out.push(nome);
        if (out.length >= 40) break;
    }
    return out;
}
/**
 * Qual feira mostrar nesta loja. A do cliente (link ou condomínio) vence, se a loja estiver nela.
 * Sem feira do cliente: o jeito antigo (a feira de hoje), para quem já usava não perceber diferença.
 * `feiras` = [{ id, nome, dias, lojas }].
 */
export function feiraDoCliente(feiras, escolhida, dia) {
    const lista = (Array.isArray(feiras) ? feiras : []).filter((f) => f && Array.isArray(f.lojas));
    const dela = escolhida ? lista.find((f) => f.id === escolhida) : null;
    return dela ? { feira: dela, doCliente: true } : { feira: feiraDoDia(lista, dia), doCliente: false };
}
/** Feiras (desta loja) que atendem o condomínio escolhido. */
export const feirasDoCondominio = (feiras, condominio) => {
    const k = normCond(condominio); if (!k) return [];
    return (Array.isArray(feiras) ? feiras : []).filter((f) => f && Array.isArray(f.condominios) && f.condominios.some((c) => normCond(c) === k));
};
/** Id da feira no endereço: /feira/id, ?f=id ou ?feira=id. '' se não tem ou é estranho. */
export function feiraDoEndereco(loc) {
    const l = loc || {}, m = /^\/feira\/([a-z0-9][a-z0-9-]{1,39})\/?$/.exec(String(l.pathname || ''));
    if (m) return m[1];
    try { const q = new URLSearchParams(String(l.search || '')); const id = q.get('f') || q.get('feira') || ''; return idValido(id) ? id : ''; } catch (_) { return ''; }
}
/** Endereço da loja com a feira junto (?feira=id), para a feira não se perder ao trocar de banca. */
export function comFeira(url, fid) {
    if (!idValido(fid)) return url;
    try { const u = new URL(url, 'https://x.invalid'); u.searchParams.set('feira', fid); return u.origin === 'https://x.invalid' ? u.pathname + u.search + u.hash : u.toString(); } catch (_) { return url; }
}
/** "Toda quarta" · "Terça e sexta" · "Todos os dias" (para a tela da feira). */
export function diasDaFeira(dias) {
    const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'], d = limparDias(dias);
    if (!d.length || d.length === 7) return 'Todos os dias';
    if (d.length === 1) return `${d[0] === 0 || d[0] === 6 ? 'Todo' : 'Toda'} ${nomes[d[0]]}`;
    const t = d.map((n) => nomes[n]); return (t.slice(0, -1).join(', ') + ' e ' + t[t.length - 1]).replace(/^./, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------
// PARA QUANDO É O PEDIDO (mesma conta de lib/feira.js, no servidor; um teste confere que batem).
// Dia de feira antes do horário limite → hoje. Senão → o próximo dia de feira que não esteja
// marcado "sem feira". Horário de Brasília. null = nenhuma data nas próximas 8 semanas.
// ---------------------------------------------------------------------
const limparHora = (h) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(h || '').trim()); return m ? `${m[1]}:${m[2]}` : ''; };
export function proximaEntrega(feira, agora = Date.now()) {
    const f = feira || {}, dias = limparDias(f.dias), sem = new Set(Array.isArray(f.semFeira) ? f.semFeira : []), limite = limparHora(f.horaLimite);
    const br = new Date(agora - 3 * 3600000), hora = br.toISOString().slice(11, 16);
    for (let k = 0; k < 56; k++) {
        const d = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + k)), dia = d.toISOString().slice(0, 10), dow = d.getUTCDay();
        if (dias.length && !dias.includes(dow)) continue;
        if (sem.has(dia)) continue;
        if (k === 0 && limite && hora >= limite) continue;
        return { dia, hoje: k === 0, dow };
    }
    return null;
}
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "terça, 14/10" */
export const textoDoDia = (dia) => { const d = new Date(`${dia}T12:00:00Z`); return Number.isNaN(d.getTime()) ? '' : `${NOMES_DIA[d.getUTCDay()]}, ${String(dia).slice(8, 10)}/${String(dia).slice(5, 7)}`; };
export { limparHora };

/**
 * De qual feira é um cliente da aba Clientes: a do último pedido (fe) ou, para quem comprou antes das feiras
 * terem link, a feira que atende o condomínio dele. '' = sem feira.
 */
export function feiraDeUmCliente(cli, feiras) {
    const lista = Array.isArray(feiras) ? feiras : [];
    if (cli && cli.fe && lista.some((f) => f.id === cli.fe)) return cli.fe;
    const achada = feirasDoCondominio(lista, cli && cli.condominio)[0];
    return achada ? achada.id : '';
}
