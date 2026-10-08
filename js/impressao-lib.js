// =====================================================================
//  js/impressao-lib.js — O QUE vai no papel (sem falar com impressora nenhuma).
//
//  Tudo o que se imprime vira primeiro uma lista de "linhas" simples:
//     { t:'txt', v:'texto', al:'e'|'c'|'d', b:true (negrito), g:true (grande) }
//     { t:'par', e:'esquerda', d:'direita', b }     ex.: "Tomate ........ R$ 8,00"
//     { t:'sep' }   linha tracejada      { t:'esp', n }   linhas em branco      { t:'corte' }
//  Depois a mesma lista é transformada em:
//     • comandos ESC/POS  (impressora térmica por Bluetooth, cabo ou app)  → paraEscPos
//     • página comum       (qualquer impressora instalada no aparelho)     → paraHtml
//     • texto puro         (prévia na tela e testes)                        → paraTexto
//  Assim o cupom é igual em qualquer caminho, e um caminho novo não muda o cupom.
// =====================================================================
export const LARGURAS = { 58: { colunas: 32, mm: 58, util: 48 }, 80: { colunas: 48, mm: 80, util: 72 } };
export const colunasDe = (largura) => (LARGURAS[largura] || LARGURAS[58]).colunas;

const reais = (v) => `R$ ${(Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const limpo = (s, max = 200) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const PESO = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const qtdTxt = (i) => (PESO.includes(String(i.unidade || '').toLowerCase()) && i.tipo !== 'un'
    ? `${String(Math.round((Number(i.qtd) || 0) * 1000) / 1000).replace('.', ',')} ${limpo(i.unidade, 6)}` : `${Math.round(Number(i.qtd) || 0)}x`);
const dataHora = (iso) => { const d = new Date(new Date(iso || Date.now()).getTime() - 3 * 3600000); return isNaN(d) ? '' : `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}/${d.toISOString().slice(0, 4)} ${d.toISOString().slice(11, 16)}`; };
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const txt = (v, o = {}) => ({ t: 'txt', v: limpo(v), ...o });
const SEP = { t: 'sep' }, CORTE = { t: 'corte' };

export function enderecoTxt(p) {
    const a = limpo(p.quadra, 60), b = limpo(p.lote, 30), f = p.formatoEndereco || 'ql';
    const resto = f === 'rua' ? [a, b && `nº ${b}`] : f === 'livre' ? [a, b] : [a && `Quadra ${a}`, b && `Lote ${b}`];
    return [limpo(p.condominio, 60), resto.filter(Boolean).join(f === 'ql' ? ' · ' : ', ')].filter(Boolean).join(' - ');
}

/** Cupom completo de um pedido (da loja on-line ou do balcão). */
export function cupomDoPedido(p, { loja = '' } = {}) {
    const L = [], itens = Array.isArray(p.itens) ? p.itens : [];
    if (loja) L.push(txt(loja, { al: 'c', b: true, g: true }));
    L.push(txt(`${p.origem === 'balcao' ? 'Venda no balcão' : 'Pedido'}${p.id ? ` ${String(p.id).slice(-6).toUpperCase()}` : ''}`, { al: 'c' }), txt(dataHora(p.data), { al: 'c' }), SEP);
    if (limpo(p.nome)) L.push(txt(p.nome, { b: true }));
    const end = enderecoTxt(p); if (end) L.push(txt(end));
    if (limpo(p.telefone)) L.push(txt(`Tel: ${limpo(p.telefone, 20)}`));
    if (limpo(p.nome) || end) L.push(SEP);
    let soma = 0, aPesar = 0;
    itens.forEach((i) => {
        if (i.aPesar) { aPesar++; L.push({ t: 'par', e: `${qtdTxt(i)} ${limpo(i.nome, 60)}`, d: 'a pesar' }); }
        else { soma += Number(i.subtotal) || 0; L.push({ t: 'par', e: `${qtdTxt(i)} ${limpo(i.nome, 60)}`, d: reais(i.subtotal) }); }
    });
    L.push(SEP);
    const desc = p.cupom && Number(p.cupom.desconto) > 0 ? Number(p.cupom.desconto) : 0;
    const taxa = p.entrega && Number(p.entrega.taxa) > 0 ? Number(p.entrega.taxa) : 0;
    if (desc || taxa) L.push({ t: 'par', e: 'Subtotal', d: reais(soma) });
    if (desc) L.push({ t: 'par', e: `Cupom ${limpo(p.cupom.codigo, 20)}`, d: `-${reais(desc)}` });
    if (taxa) L.push({ t: 'par', e: 'Entrega', d: reais(taxa) });
    L.push({ t: 'par', e: aPesar ? 'PARCIAL' : 'TOTAL', d: reais(p.total), b: true, g: true });
    if (aPesar) L.push(txt(`Falta pesar ${aPesar} item(ns): o total muda depois da balança.`));
    const pago = p.pagamento && p.pagamento.status === 'PAID';
    if (limpo(p.pag)) L.push(txt(`Pagamento: ${limpo(p.pag, 30)}${pago ? ' (PAGO)' : ''}`));
    if (limpo(p.troco)) L.push(txt(`Troco para: ${limpo(p.troco, 30)}`, { b: true }));
    if (p.entrega && limpo(p.entrega.horario)) L.push(txt(`Entregar: ${limpo(p.entrega.horario, 40)}`, { b: true }));
    if (limpo(p.obs)) L.push(SEP, txt(`Obs: ${limpo(p.obs, 300)}`));
    L.push(SEP, txt('Obrigado pela preferência!', { al: 'c' }), CORTE);
    return L;
}

/** Etiqueta para colar na sacola: quem é, onde entrega, quanto cobrar. */
export function etiquetaDeEntrega(p, { loja = '', volume = 1, volumes = 1 } = {}) {
    const L = [], itens = Array.isArray(p.itens) ? p.itens : [], pago = p.pagamento && p.pagamento.status === 'PAID';
    if (loja) L.push(txt(loja, { al: 'c' }));
    L.push(txt(p.nome || 'Cliente', { al: 'c', b: true, g: true }));
    const end = enderecoTxt(p); if (end) L.push(txt(end, { al: 'c', b: true }));
    if (p.feiraId && /^\d{4}-\d{2}-\d{2}$/.test(String(p.entregaDia || '')) && p.paraHoje === false) L.push(txt(`PARA ${String(p.entregaDia).slice(8, 10)}/${String(p.entregaDia).slice(5, 7)}`, { al: 'c', b: true }));   // pedido para a próxima feira
    if (p.entrega && limpo(p.entrega.horario)) L.push(txt(`Entregar: ${limpo(p.entrega.horario, 40)}`, { al: 'c' }));
    L.push(SEP, { t: 'par', e: `${itens.length} item(ns)`, d: volumes > 1 ? `Volume ${volume}/${volumes}` : '' });
    L.push(txt(pago ? 'JÁ PAGO' : `Cobrar ${reais(p.total)} - ${limpo(p.pag, 20) || 'a combinar'}`, { b: true }));
    if (!pago && limpo(p.troco)) L.push(txt(`Troco para: ${limpo(p.troco, 30)}`));
    if (limpo(p.obs)) L.push(txt(`Obs: ${limpo(p.obs, 120)}`));
    L.push(CORTE);
    return L;
}

/** Etiqueta de produto fabricado: nome, lote, fabricação e validade. */
export function etiquetaDeLote(r, { loja = '' } = {}) {
    const L = [txt(r.nome, { al: 'c', b: true, g: true })];
    if (r.lote) L.push({ t: 'par', e: 'Lote', d: limpo(r.lote, 20) });
    if (r.fabricadoEm) L.push({ t: 'par', e: 'Fabricação', d: dataBR(r.fabricadoEm) });
    if (r.validade) L.push({ t: 'par', e: 'Validade', d: dataBR(r.validade), b: true });
    if (r.preco) L.push({ t: 'par', e: 'Preço', d: reais(r.preco), b: true });
    if (loja) L.push(txt(loja, { al: 'c' }));
    L.push(CORTE);
    return L;
}

export function paginaDeTeste({ loja = '', largura = 58, modo = '' } = {}) {
    return [txt(loja || 'Teste de impressão', { al: 'c', b: true, g: true }), txt('Teste de impressão', { al: 'c' }), SEP,
        txt(`Papel de ${largura} mm - ${colunasDe(largura)} letras por linha`), txt(modo ? `Caminho: ${modo}` : ''), txt('Acentos: ação, pão, maçã, feijão, você'),
        { t: 'par', e: '2x Pão de queijo', d: 'R$ 12,00' }, { t: 'par', e: 'TOTAL', d: 'R$ 12,00', b: true, g: true }, SEP,
        txt('Se esta folha saiu inteira e alinhada, está tudo certo.', { al: 'c' }), CORTE].filter((l) => l.t !== 'txt' || l.v);
}

// ---------------------------------------------------------------- texto
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[·•]/g, '-').replace(/[^\x20-\x7e]/g, '?');
function quebrar(s, n) {
    const out = []; let atual = '';
    String(s).split(' ').forEach((pal) => {
        while (pal.length > n) { if (atual) { out.push(atual); atual = ''; } out.push(pal.slice(0, n)); pal = pal.slice(n); }
        if (!atual) atual = pal; else if (atual.length + 1 + pal.length <= n) atual += ` ${pal}`; else { out.push(atual); atual = pal; }
    });
    if (atual || !out.length) out.push(atual);
    return out;
}
const alinhar = (s, n, al) => (al === 'c' ? ' '.repeat(Math.max(0, Math.floor((n - s.length) / 2))) + s : al === 'd' ? s.padStart(n) : s);
/** Linhas de texto já quebradas na largura. Cada uma: { s, b, g }. */
export function compor(linhas, colunas) {
    const out = [];
    linhas.forEach((l) => {
        // letra grande ocupa o dobro: se "TOTAL R$ 1.234,00" não couber em meia linha, sai em letra normal
        const cabeGrande = l.t !== 'par' || String(l.e).length + 1 + String(l.d || '').length <= Math.floor(colunas / 2);
        if (l.g && !cabeGrande) l = { ...l, g: false };
        const n = l.g ? Math.floor(colunas / 2) : colunas;
        if (l.t === 'sep') out.push({ s: '-'.repeat(colunas) });
        else if (l.t === 'esp') for (let i = 0; i < (l.n || 1); i++) out.push({ s: '' });
        else if (l.t === 'corte') out.push({ corte: true });
        else if (l.t === 'txt') quebrar(l.v, n).forEach((s) => out.push({ s: alinhar(s, n, l.al), b: l.b, g: l.g }));
        else if (l.t === 'par') {
            const d = String(l.d || ''), livre = Math.max(4, n - d.length - (d ? 1 : 0)), partes = quebrar(l.e, livre);
            partes.forEach((s, i) => out.push({ s: i === partes.length - 1 && d ? s.padEnd(n - d.length) + d : s, b: l.b, g: l.g }));
        }
    });
    return out;
}
export const paraTexto = (linhas, colunas = 32) => compor(linhas, colunas).filter((l) => !l.corte).map((l) => l.s.replace(/\s+$/, '')).join('\n');

// ---------------------------------------------------------------- ESC/POS
// Tabela 860 (português), a mais comum nas térmicas. Só é usada se "acentos" estiver ligado.
const CP860 = { 'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87, 'ê': 0x88, 'Ê': 0x89, 'è': 0x8a, 'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f,
    'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97, 'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, 'Ù': 0x9d, 'Ó': 0x9f, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7 };
function codificar(s, acentos) {
    if (!acentos) return [...semAcento(s)].map((c) => c.charCodeAt(0));
    return [...String(s).normalize('NFC')].map((c) => { const k = c.charCodeAt(0); if (k >= 0x20 && k <= 0x7e) return k; if (CP860[c]) return CP860[c]; const a = semAcento(c); return a.length === 1 ? a.charCodeAt(0) : 0x3f; });
}
/**
 * Comandos ESC/POS (o "idioma" de quase toda impressora térmica de cupom).
 * acentos=false troca "ã" por "a": sai certo em QUALQUER impressora. acentos=true usa a tabela 860.
 */
export function paraEscPos(linhas, { largura = 58, acentos = false, cortar = true } = {}) {
    const b = [0x1b, 0x40];                                   // ESC @  → zera a impressora
    if (acentos) b.push(0x1b, 0x74, 0x03);                    // ESC t 3 → tabela 860
    let negrito = false, grande = false;
    compor(linhas, colunasDe(largura)).forEach((l) => {
        if (l.corte) { b.push(0x0a, 0x0a, 0x0a); if (cortar) b.push(0x1d, 0x56, 0x42, 0x00); return; }   // GS V 66 0 → corte (quem não tem guilhotina ignora)
        if (!!l.b !== negrito) { negrito = !!l.b; b.push(0x1b, 0x45, negrito ? 1 : 0); }                 // ESC E
        if (!!l.g !== grande) { grande = !!l.g; b.push(0x1d, 0x21, grande ? 0x11 : 0x00); }              // GS !  → dobro de largura e altura
        b.push(...codificar(l.s.replace(/\s+$/, ''), acentos), 0x0a);
    });
    b.push(0x1b, 0x45, 0, 0x1d, 0x21, 0);
    return Uint8Array.from(b);
}
export function fatiar(bytes, tamanho) { const out = []; for (let i = 0; i < bytes.length; i += tamanho) out.push(bytes.slice(i, i + tamanho)); return out; }
export function paraBase64(bytes) { let s = ''; bytes.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); }

// ---------------------------------------------------------------- página comum
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Página pronta para a impressão do aparelho. largura: 58 | 80 | 'a4'. Várias folhas = várias listas. */
export function paraHtml(folhas, { largura = 58 } = {}) {
    const a4 = largura === 'a4', L = LARGURAS[largura] || LARGURAS[58];
    const folha = (linhas) => `<section>${linhas.map((l) => {
        const c = `${l.b ? ' b' : ''}${l.g ? ' g' : ''}`;
        if (l.t === 'sep') return '<hr>';
        if (l.t === 'esp') return '<br>'.repeat(l.n || 1);
        if (l.t === 'txt') return `<p class="${l.al || 'e'}${c}">${esc(l.v)}</p>`;
        if (l.t === 'par') return `<p class="par${c}"><span>${esc(l.e)}</span><span>${esc(l.d || '')}</span></p>`;
        return '';
    }).join('')}</section>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Impressão</title><style>
@page { ${a4 ? 'size: A4; margin: 14mm' : `size: ${L.mm}mm auto; margin: 0`}; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font: ${a4 ? '12pt' : L.mm === 58 ? '9.5pt' : '10.5pt'}/1.35 Arial, Helvetica, sans-serif; color: #000; ${a4 ? 'max-width: 90mm;' : `width: ${L.util}mm; padding: 2mm 0 6mm; margin: 0 auto;`} }
section { break-after: page; page-break-after: always; } section:last-child { break-after: auto; page-break-after: auto; }
p { overflow-wrap: anywhere; } .c { text-align: center; } .d { text-align: right; } .b { font-weight: 700; } .g { font-size: 1.5em; line-height: 1.2; }
.par { display: flex; justify-content: space-between; gap: 3mm; } .par span:last-child { white-space: nowrap; }
hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
</style></head><body>${folhas.map(folha).join('')}</body></html>`;
}

// ---------------------------------------------------------------- o que cada aparelho consegue
/** O que ESTE navegador consegue usar. Valor = '' (pode) ou a frase do porquê não. */
export function suporte(nav = typeof navigator !== 'undefined' ? navigator : {}) {
    const ua = String(nav.userAgent || ''), ios = /iPhone|iPad|iPod/i.test(ua), android = /Android/i.test(ua);
    return {
        sistema: '',
        bluetooth: nav.bluetooth ? '' : (ios ? 'O iPhone e o iPad não deixam sites usarem Bluetooth. Use "Impressão do aparelho".' : 'Este navegador não tem Bluetooth para sites. Use o Chrome ou o Edge.'),
        serial: nav.serial ? '' : (android || ios ? 'Só funciona no Chrome ou Edge de computador.' : 'Este navegador não tem esse recurso. Use o Chrome ou o Edge.'),
        app: android ? '' : 'Só funciona em celular ou tablet Android.',
    };
}
