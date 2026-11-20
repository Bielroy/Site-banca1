// =====================================================================
//  js/impressao-ponte.js — o painel fala com o APP PONTE (celular Android da banca, perto da impressora).
//
//  O app imprime mesmo com a tela bloqueada. O painel não fala com o celular direto: tudo passa
//  pelo servidor (/api/pdv, acao 'ponte'; regras em lib/ponte.js). Daqui o painel:
//    • liga um celular novo (código de 8 letras, vale 15 min e uma vez);
//    • vê se o celular e a impressora estão bem;
//    • escolhe papel, acentos, vias e a impressão automática do celular;
//    • manda papel (o botão "Cupom", o teste, as etiquetas) para o celular imprimir.
// =====================================================================
export const APK_URL = 'https://github.com/Bielroy/Site-banca1/releases/latest/download/banca-ponte.apk';
export const SEM_CONTATO_MS = 12 * 60 * 1000;

async function chamar(op, extra = {}) {
    const r = await fetch('/api/pdv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'ponte', op, ...extra }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'O servidor não respondeu. Confira a internet.'), { amigavel: true, status: r.status });
    return d;
}

const E = { pontes: null, erro: '', em: 0, carregando: null, codigo: null, pulados: {} };
export const estado = () => E;
const avisar = () => { try { document.dispatchEvent(new CustomEvent('ponte:estado')); } catch (_) { /* navegador antigo */ } };

/** Busca como estão os celulares. Duas chamadas juntas viram uma só. */
export function atualizar() {
    if (E.carregando) return E.carregando;
    E.carregando = chamar('listar')
        .then((d) => { E.pontes = Array.isArray(d.pontes) ? d.pontes : []; E.erro = ''; E.em = Date.now(); })
        .catch((e) => { E.erro = e.message; if (E.pontes === null && e.status === 403) E.pontes = []; })
        .finally(() => { E.carregando = null; avisar(); });
    return E.carregando;
}
/** Código para ligar um celular novo. cfg = papel e acentos deste aparelho, para o celular já começar igual. */
export async function gerarCodigo(cfg) {
    const d = await chamar('codigo', { cfg });
    E.codigo = { codigo: d.codigo, expira: Date.parse(d.expira) || Date.now() + 15 * 60000 };
    avisar();
    return E.codigo;
}
export const codigoValido = () => (E.codigo && E.codigo.expira > Date.now() ? E.codigo : null);
export async function salvar(ponteId, cfg, imprimirFila = false) {
    const d = await chamar('config', { ponteId, cfg, imprimirFila });
    // "N pedidos que já estavam na fila não vão sair sozinhos": some quando você manda imprimir esses
    if (imprimirFila) E.pulados[ponteId] = 0; else if (d.pulados > 0) E.pulados[ponteId] = (E.pulados[ponteId] || 0) + d.pulados;
    const p = (E.pontes || []).find((x) => x.id === ponteId); if (p && d.cfg) p.cfg = d.cfg;
    avisar(); atualizar();
    return d;
}
export async function remover(ponteId) { await chamar('remover', { ponteId }); delete E.pulados[ponteId]; return atualizar(); }
/** Manda papel para o celular da banca. Devolve { online, visto }. */
export const enviar = (dados) => chamar('imprimir', dados);

/**
 * Link que abre o app neste celular já com o código (quando o painel está no mesmo celular do app).
 * No Android vai como "intent:": o Chrome abre o app e, se ele ainda não estiver instalado, baixa.
 */
export function linkDoApp(codigo) {
    const q = `parear?c=${encodeURIComponent(codigo)}&s=${encodeURIComponent(location.origin)}`;
    if (/Android/i.test(navigator.userAgent || '')) return `intent://${q}#Intent;scheme=bancaponte;package=com.usebanca.ponte;S.browser_fallback_url=${encodeURIComponent(APK_URL)};end`;
    return `bancaponte://${q}`;
}
export const hora = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
export const quandoFoi = (iso) => {
    const d = new Date(iso); if (isNaN(d)) return 'nunca';
    const hoje = new Date().toDateString() === d.toDateString();
    return hoje ? `às ${hora(iso)}` : `em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora(iso)}`;
};
const online = (p) => !!p && !!p.visto && Date.now() - Date.parse(p.visto) < SEM_CONTATO_MS;

/**
 * Resumo para a faixa do topo:
 *  'carregando' | 'nenhum' (nenhum celular ligado) | 'horario' (desligados pelo horário) | 'fora' (sem contato) | 'impressora' (impressora com problema) | 'ok'
 */
export function situacao() {
    if (E.pontes === null) return { tipo: 'carregando' };
    if (!E.pontes.length) return { tipo: 'nenhum' };
    const vivos = E.pontes.filter(online);
    // nenhum com contato porque todos estão desligados pelo horário escolhido (não é problema)
    if (!vivos.length && E.pontes.every((p) => p.foraDoHorario)) return { tipo: 'horario', ligarAs: E.pontes.map((p) => p.cfg && p.cfg.ligarAs).filter(Boolean).sort()[0] || '' };
    if (!vivos.length) { const ultimo = E.pontes.map((p) => p.visto).filter(Boolean).sort().pop(); return { tipo: 'fora', visto: ultimo || '' }; }
    const comProblema = vivos.find((p) => p.impressora && p.impressora.estado === 'erro');
    if (comProblema && vivos.every((p) => p.impressora && p.impressora.estado === 'erro')) return { tipo: 'impressora', msg: comProblema.impressora.msg || 'A impressora não respondeu.' };
    const auto = vivos.map((p) => p.cfg && p.cfg.auto).find((a) => a && a !== 'manual') || 'manual';
    return { tipo: 'ok', auto };
}
export const estaOnline = online;
