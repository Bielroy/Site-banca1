// =====================================================================
//  js/endereco.js — endereço de entrega: condomínio + quadra/lote
//  (ou rua/número, conforme o condomínio).
//
//  A LISTA de condomínios é cadastrada no painel (aba Operacional) e fica
//  em loja/config.condominios = [{ id, nome, formato }].
//    formato 'ql'  → campos "Quadra" e "Casa/Lote"
//    formato 'rua' → campos "Rua ou alameda" e "Número da casa"
//  Quem escolhe "Meu condomínio não está na lista" digita o nome
//  (formato 'livre').
//
//  No pedido, os dois campos continuam indo como `quadra` e `lote`
//  (o painel, o CSV e o motor de previsão já leem esses nomes); o que
//  muda é o rótulo mostrado, guiado por `formatoEndereco`.
// =====================================================================
import { escapeHTML } from './utils.js';
import { chave } from './tenant.js';

export const ROTULOS = {
    ql:    { a: 'Quadra', b: 'Casa/Lote', modoA: 'numeric', modoB: 'numeric' },
    rua:   { a: 'Rua ou alameda', b: 'Número da casa', modoA: 'text', modoB: 'numeric' },
    livre: { a: 'Quadra ou rua', b: 'Lote ou número', modoA: 'text', modoB: 'text' },
};
const OUTRO = '__outro';
const CHAVE = chave('banca_endereco');

/** Endereço em uma linha. curto = versão para a pílula do topo e cartões. */
export const linhaEndereco = (p, { curto = false } = {}) => {
    if (!p) return '';
    const a = String(p.quadra || '').trim(), b = String(p.lote || '').trim();
    const f = p.formatoEndereco || p.formato || 'ql';
    let resto;
    if (f === 'rua') resto = [a, b && `nº ${b}`].filter(Boolean).join(', ');
    else if (f === 'livre') resto = [a, b].filter(Boolean).join(', ');
    else resto = curto ? [a && `Qd ${a}`, b && `Lt ${b}`].filter(Boolean).join(' · ')
                       : [a && `Quadra ${a}`, b && `Lote ${b}`].filter(Boolean).join(' • ');
    return [String(p.condominio || '').trim(), resto].filter(Boolean).join(curto ? ', ' : ' — ');
};

export const lerEnderecoSalvo = () => {
    try {
        const e = JSON.parse(localStorage.getItem(CHAVE) || 'null');
        if (e && (e.quadra || e.lote || e.condominio)) return e;
        // quem já comprava antes do campo de condomínio: aproveita quadra e lote
        const antigo = JSON.parse(localStorage.getItem(chave('banca_clientes')) || '[]')[0];
        if (antigo && (antigo.quadra || antigo.lote)) return { quadra: antigo.quadra || '', lote: antigo.lote || '' };
    } catch (_) { /* armazenamento bloqueado: segue sem endereço salvo */ }
    return null;
};
export const salvarEndereco = (e) => { try { localStorage.setItem(CHAVE, JSON.stringify(e)); } catch (_) { /* idem */ } };

/**
 * Monta os campos dentro de `raiz`. `p` é o prefixo dos ids (ex.: "cli").
 * Devolve { definirLista, preencher, ler, validar }.
 */
export function criarCamposEndereco(raiz, p) {
    raiz.innerHTML = `
        <div class="form-group">
            <label for="${p}-cond">Condomínio</label>
            <select id="${p}-cond"></select>
            <input type="text" id="${p}-cond-outro" placeholder="Nome do condomínio" autocomplete="off" maxlength="60" hidden>
        </div>
        <div class="grid-2 end-grid">
            <div class="form-group"><label for="${p}-quadra">Quadra</label><input type="text" id="${p}-quadra" maxlength="60" autocomplete="off"></div>
            <div class="form-group"><label for="${p}-lote">Casa/Lote</label><input type="text" id="${p}-lote" maxlength="30" autocomplete="off"></div>
        </div>`;
    const sel = raiz.querySelector(`#${p}-cond`), outro = raiz.querySelector(`#${p}-cond-outro`);
    const campoA = raiz.querySelector(`#${p}-quadra`), campoB = raiz.querySelector(`#${p}-lote`);
    let lista = [];

    const formatoAtual = () => {
        if (!lista.length || sel.value === OUTRO) return 'livre';
        const c = lista.find((x) => x.id === sel.value);
        return c && c.formato === 'rua' ? 'rua' : 'ql';
    };
    const ajustar = () => {
        const semLista = !lista.length;
        sel.hidden = semLista;
        outro.hidden = !(semLista || sel.value === OUTRO);
        const r = ROTULOS[formatoAtual()];
        raiz.querySelector(`label[for="${p}-quadra"]`).textContent = r.a;
        raiz.querySelector(`label[for="${p}-lote"]`).textContent = r.b;
        campoA.inputMode = r.modoA; campoB.inputMode = r.modoB;
        raiz.querySelector('.end-grid').classList.toggle('end-grid--rua', formatoAtual() === 'rua');
    };
    sel.addEventListener('change', () => { ajustar(); (sel.value === OUTRO ? outro : campoA).focus(); });

    const definirLista = (nova) => {
        const antes = ler();
        lista = (Array.isArray(nova) ? nova : []).filter((c) => c && c.id && c.nome && c.ativo !== false);
        sel.innerHTML = '<option value="">Escolha o condomínio</option>'
            + lista.map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.nome)}</option>`).join('')
            + `<option value="${OUTRO}">Meu condomínio não está na lista</option>`;
        preencher(antes);
    };

    const preencher = (e) => {
        e = e || {};
        const daLista = lista.find((c) => c.id === e.condominioId)
            || lista.find((c) => c.nome.toLowerCase() === String(e.condominio || '').trim().toLowerCase());
        if (daLista) { sel.value = daLista.id; outro.value = ''; }
        else if (e.condominio) { sel.value = lista.length ? OUTRO : ''; outro.value = e.condominio; }
        else { sel.value = ''; outro.value = ''; }
        campoA.value = e.quadra || ''; campoB.value = e.lote || '';
        ajustar();
    };

    const ler = () => {
        const c = lista.find((x) => x.id === sel.value);
        return {
            condominioId: c ? c.id : '',
            condominio: (c ? c.nome : outro.value).trim(),
            formatoEndereco: formatoAtual(),
            quadra: campoA.value.trim(), lote: campoB.value.trim(),
        };
    };

    /** Devolve '' se está tudo certo, ou a frase do que falta. */
    const validar = () => {
        const e = ler(), r = ROTULOS[e.formatoEndereco];
        if (!e.condominio) return lista.length && sel.value !== OUTRO ? 'Escolha o seu condomínio.' : 'Escreva o nome do seu condomínio.';
        if (!e.quadra) return `Preencha o campo "${r.a}".`;
        if (!e.lote) return `Preencha o campo "${r.b}".`;
        return '';
    };

    definirLista([]);
    return { definirLista, preencher, ler, validar };
}
