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
