// =====================================================================
//  js/pacote-lib.js — PACOTES e PROMOÇÃO POR QUANTIDADE (regras puras, testadas).
//
//  Na banca há duas coisas com o mesmo nome: a batata solta (grande, pesada
//  na hora) e o pacotinho (as pequenas, já embaladas). Para ninguém pedir
//  uma achando que era a outra:
//   - o produto marcado como "pacote fechado" no painel vai para um bloco
//     próprio no fim da vitrine, com cartão de papel pardo e "+ 1 pacote";
//   - o peso escrito no pacote é OPCIONAL (em branco: aparece só "PACOTE");
//   - o nome do produto é o que a loja escrever (não precisa ser "baby").
//  Promoção por quantidade ("4 por R$ 10"): vale para qualquer produto que
//  não vai para a balança. A MESMA conta existe no servidor (lib/pacote.js),
//  e é a do servidor que vale; um teste confere que as duas batem.
// =====================================================================
const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const fracionavel = (u) => FRACIONAVEIS.includes(String(u || '').toLowerCase());
const limpo = (v, n) => (typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const centavos = (v) => Math.round(Number(v) * 100);
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const MAX_PROMO_QTD = 50;
export const PACOTES_PADRAO = { titulo: 'Pacotes prontos', texto: 'Já vêm fechados. Você escolhe quantos pacotes e pronto: não vai para a balança.' };

// ---------------------------------------------------------------------
// CANTINHO DOS TEMPEROS: área própria no fim da vitrine (depois dos pacotes) para os potinhos.
// Vale pela CATEGORIA, sem marcar produto por produto: a loja escolhe a categoria em Aparência → Vitrine;
// sem escolha, entra a categoria com "tempero" no nome. "-" = não separar.
// ---------------------------------------------------------------------
export const TEMPEROS_PADRAO = { titulo: 'Cantinho dos temperos', texto: 'Potinhos prontos, do jeitinho que você leva da banca.' };
export const NOMES_POTE = { um: 'potinho', varios: 'potinhos' };
export const SEM_TEMPEROS = '-';
/** O produto vai para o cantinho dos temperos? `cfg` = vitrine.temperos ({ cat }). Pacote fica no bloco dele. */
export function ehTempero(p, cfg) {
    if (!p || ehPacote(p)) return false;
    const cat = semAcento(p.cat).trim(); if (!cat) return false;
    const esc = cfg && typeof cfg.cat === 'string' ? semAcento(cfg.cat).trim() : '';
    if (esc === SEM_TEMPEROS) return false;
    return esc ? cat === esc : /tempero/.test(cat);
}
/** Tempero vendido por potinho (não vai para a balança): botão "+ 1 potinho", "3 potinhos". */
export const ehPotinho = (p, cfg) => ehTempero(p, cfg) && !fracionavel(p.unidade);

// ORDEM NA VITRINE (CSS "order"): faixas que NUNCA se encostam. A nota da lista inteligente vai de 0 a 1000.
//   soltos 0–1000 · cabeçalho dos pacotes 1999 · pacotes 2000–3000 · cabeçalho dos temperos 4999 · temperos 5000–6000
// (antes os temperos começavam em 3000: o pacote menos pedido, com 3000, caía dentro do cantinho dos temperos)
//   seções coloridas (até 4): ficam ANTES dos soltos, cada uma numa faixa de 2000: -8000, -6000, -4000, -2000 (cabeçalho = faixa - 1)
export const ORDEM_PACOTES = 2000, ORDEM_TEMPEROS = 5000;
export const ordemDaSecao = (i) => -16000 + 2000 * Math.max(0, Math.min(7, Number(i) || 0));
/** `p` = chance de o cliente levar (0 a 1); `tipo` = 'pacote' | 'tempero' | 'secao' | ''; `secao` = posição da seção (0 a 3). */
export function ordemNaVitrine(p, tipo = '', secao = 0) {
    const n = Number(p), nota = Math.min(1000, Math.max(0, Math.round((1 - (Number.isFinite(n) ? n : 0.3)) * 1000)));
    return nota + (tipo === 'pacote' ? ORDEM_PACOTES : tipo === 'tempero' ? ORDEM_TEMPEROS : tipo === 'secao' ? ordemDaSecao(secao) : 0);
}

/** É pacote fechado? Só produto que NÃO vai para a balança (pacote "por quilo" não existe). */
export const ehPacote = (p) => !!p && p.pacote === true && !fracionavel(p.unidade);

/** Peso escrito no pacote ("500 g", "1 kg"), ou '' quando a loja deixou em branco. */
export const pesoDoPacote = (p) => (ehPacote(p) ? limpo(p.pesoPacote, 16) : '');

/**
 * Promoção por quantidade que vale para este produto: { qtd, preco } ou null.
 * `preco` = preço da unidade que vale HOJE (preço do dia): a promoção só vale se sair mais barata
 * que comprar as unidades soltas (senão seria "promoção" que cobra mais).
 */
export function promoDe(p, preco = p && p.preco) {
    if (!p || fracionavel(p.unidade)) return null;
    const q = Number(p.promoQtd), v = Math.round(Number(p.promoPreco) * 100) / 100, un = Number(preco);
    if (!Number.isInteger(q) || q < 2 || q > MAX_PROMO_QTD) return null;
    if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(un) || un <= 0) return null;
    if (centavos(v) >= centavos(un) * q) return null;
    return { qtd: q, preco: v };
}

/** Total em CENTAVOS de `qtd` unidades, com a promoção (a cada `promo.qtd`, paga `promo.preco`; o resto, preço cheio). */
export function totalComPromo(precoUnit, qtd, promo) {
    const n = Math.max(0, Math.round(Number(qtd) || 0)), un = centavos(precoUnit);
    if (!promo || n < promo.qtd) return un * n;
    const grupos = Math.floor(n / promo.qtd), resto = n % promo.qtd;
    return grupos * centavos(promo.preco) + resto * un;
}

const reais = (v) => `R$ ${(Math.round(Number(v) * 100) / 100).toFixed(2).replace('.', ',')}`;
/** "4 por R$ 10" (centavos só quando há: "3 por R$ 7,50"). */
export const textoPromo = (promo) => (promo ? `${promo.qtd} por ${Number.isInteger(promo.preco) ? `R$ ${promo.preco}` : reais(promo.preco)}` : '');

/** Quantas faltam para completar o próximo grupo da promoção (0 = nada a mostrar). */
export function faltaParaPromo(qtd, promo) {
    const n = Math.round(Number(qtd) || 0);
    if (!promo || n <= 0) return 0;
    const resto = n % promo.qtd;
    return resto === 0 ? 0 : promo.qtd - resto;
}

// ---------------------------------------------------------------------
// PROMOÇÃO MISTURADA: "4 por R$ 10" vale para QUALQUER pacote com a mesma
// promoção (2 de batata + 2 de cenoura = 4). Produto que não é pacote conta
// sozinho (4 alfaces). Quando os preços são diferentes, os mais caros entram
// na promoção (melhor para o cliente) e o valor da promoção é repartido
// entre os itens, proporcional ao preço, sem perder centavo.
// ---------------------------------------------------------------------
/** Grupo de promoção do produto: pacotes com a mesma promoção se juntam; o resto, por produto. */
export const chavePromo = (p, promo) => (!promo || !p ? '' : ehPacote(p) ? `pac|${promo.qtd}|${centavos(promo.preco)}` : `id|${p.id}`);

/**
 * linhas = [{ preco, qtd, promo, chave }] (na ordem da sacola)
 * → { itens: [{ sub (centavos), naPromo (quantas unidades entraram na promoção) }],
 *     grupos: Map chave → { promo, total, completos, falta } }
 * Linha sem promoção: sub = preço × quantidade (arredondado em centavos).
 */
export function contaDaPromo(linhas) {
    const ls = (Array.isArray(linhas) ? linhas : []).map((l, i) => {
        const promo = l && l.promo && Number(l.promo.qtd) >= 2 ? l.promo : null;
        const n = promo ? Math.max(0, Math.round(Number(l.qtd) || 0)) : Number(l && l.qtd) || 0;
        return { i, n, un: centavos(l && l.preco), promo, chave: promo ? String(l.chave || `linha|${i}`) : '' };
    });
    const itens = ls.map((l) => ({ sub: Math.round(l.un * l.n), naPromo: 0 }));
    const porChave = new Map(), grupos = new Map();
    for (const l of ls) if (l.chave) { if (!porChave.has(l.chave)) porChave.set(l.chave, []); porChave.get(l.chave).push(l); }
    for (const [chave, g] of porChave) {
        const promo = g[0].promo, q = promo.qtd, total = g.reduce((s, l) => s + l.n, 0), completos = Math.floor(total / q);
        grupos.set(chave, { promo, total, completos, falta: total % q ? q - (total % q) : 0 });
        if (!completos) continue;
        let resta = completos * q;
        const dentro = new Map();
        for (const l of [...g].sort((a, b) => b.un - a.un || a.i - b.i)) { const t = Math.min(l.n, resta); dentro.set(l, t); resta -= t; }
        const P = completos * centavos(promo.preco), base = g.reduce((s, l) => s + dentro.get(l) * l.un, 0);
        const partes = g.map((l) => { const ex = base ? (P * dentro.get(l) * l.un) / base : 0; return { l, c: Math.floor(ex), r: ex - Math.floor(ex) }; });
        let sobra = P - partes.reduce((s, x) => s + x.c, 0);
        for (const x of [...partes].sort((a, b) => b.r - a.r || a.l.i - b.l.i)) { if (sobra <= 0) break; x.c++; sobra--; }
        for (const x of partes) itens[x.l.i] = { sub: x.c + (x.l.n - dentro.get(x.l)) * x.l.un, naPromo: dentro.get(x.l) };
    }
    return { itens, grupos };
}

// ---------------------------------------------------------------------
// "COMO CHAMAR 1 UNIDADE" (produto pesado): "batata" → "2 batatas" em vez de "2 un".
// A loja pode escrever o plural: "pão/pães". Sem nada: "unidade/unidades".
// ---------------------------------------------------------------------
export function plural(s) {
    const t = String(s || '').trim(); if (!t) return '';
    if (/[sx]$/i.test(t)) return t;
    if (/ão$/i.test(t)) return t.replace(/ão$/i, 'ões');
    if (/[rz]$/i.test(t)) return `${t}es`;
    if (/al$/i.test(t)) return t.replace(/al$/i, 'ais');
    if (/m$/i.test(t)) return t.replace(/m$/i, 'ns');
    return `${t}s`;
}
/** { um, varios } a partir do que a loja escreveu ('' = "unidade/unidades"). */
export function nomesDaUnidade(nomeUn) {
    const t = limpo(nomeUn, 30).toLowerCase();
    if (!t) return { um: 'unidade', varios: 'unidades' };
    const [um, varios] = t.split('/').map((x) => x.trim());
    return { um: um || 'unidade', varios: varios || plural(um || 'unidade') };
}
/** "1 batata", "3 batatas", "1 pacote", "4 pacotes". */
export const emPalavras = (n, nomes) => `${n} ${Number(n) === 1 ? nomes.um : nomes.varios}`;
export const NOMES_PACOTE = { um: 'pacote', varios: 'pacotes' };

/** Pacote "parecido" com um produto pesado (mesma primeira palavra: "Batata inglesa" ↔ "Batata baby"). */
export function pacoteParecido(p, produtos) {
    if (!p || ehPacote(p) || !fracionavel(p.unidade)) return null;
    const primeira = (s) => semAcento(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3)[0] || '';
    const alvo = primeira(p.nome); if (!alvo) return null;
    return (Array.isArray(produtos) ? produtos : []).find((x) => x && x.id !== p.id && x.ativo !== false && ehPacote(x) && primeira(x.nome) === alvo) || null;
}

// ---------------------------------------------------------------------
// CADASTRO (painel): confere o que a loja digitou antes de gravar.
// ---------------------------------------------------------------------
/**
 * entrada = { pacote, pesoPacote, promoQtd, promoPreco, nomeUn, unidade, preco }
 * → { dados: { pacote, pesoPacote, promoQtd, promoPreco, nomeUn }, erro }
 * Promoção pela metade (só a quantidade ou só o preço) é erro; tudo vazio = sem promoção.
 */
export function cadastroPacote(e = {}) {
    const frac = fracionavel(e.unidade);
    const dados = { pacote: e.pacote === true && !frac, pesoPacote: '', promoQtd: null, promoPreco: null, nomeUn: frac ? limpo(e.nomeUn, 30) : '' };
    if (dados.pacote) dados.pesoPacote = limpo(e.pesoPacote, 16);
    const qTxt = String(e.promoQtd ?? '').trim(), vTxt = String(e.promoPreco ?? '').trim();
    if (frac || (!qTxt && !vTxt)) return { dados, erro: '' };
    let t = vTxt.replace(/^R\$\s*/i, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const q = Number(qTxt), v = /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
    if (!qTxt || !vTxt) return { dados, erro: 'Promoção: preencha a quantidade E o preço (ou deixe os dois em branco).' };
    if (!Number.isInteger(q) || q < 2 || q > MAX_PROMO_QTD) return { dados, erro: `Promoção: a quantidade vai de 2 a ${MAX_PROMO_QTD}.` };
    if (!Number.isFinite(v) || v <= 0) return { dados, erro: 'Promoção: o preço não parece um valor.' };
    const un = Number(e.preco);
    if (Number.isFinite(un) && un > 0 && centavos(v) >= centavos(un) * q) return { dados, erro: `Promoção: ${q} por ${reais(v)} não sai mais barato que ${q} × ${reais(un)}.` };
    dados.promoQtd = q; dados.promoPreco = v;
    return { dados, erro: '' };
}
