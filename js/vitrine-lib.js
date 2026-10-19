// =====================================================================
//  js/vitrine-lib.js — regras PURAS da vitrine (testadas em testes/index.js).
//
//  Tudo aqui segue o estudo da vitrine (outubro/2026):
//   - selos SÓ verdadeiros: "Chegou hoje" vale só no dia em que o dono marcou;
//     nada de "últimas unidades" fixo (o CDC proíbe oferta enganosa);
//   - poucas faixas no topo (no máximo 4 contando Ofertas e "Seus de sempre"):
//     faixa demais vira rolagem demais no celular;
//   - quadros ilustrados no meio da vitrine, com imagem que o dono escolhe;
//   - contagem simples de visitas → sacola → pedido para ver o antes e depois.
//  Sem navegador e sem banco: só entra dado e sai dado.
// =====================================================================
import { ARTES } from './arte-lib.js';

/** Dia de hoje na loja (Brasil, UTC−3, sem horário de verão desde 2019), no formato 2026-10-14. */
export const hojeDaLoja = (agora = Date.now()) => new Date(agora - 3 * 3600000).toISOString().slice(0, 10);

const texto = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const ehUrlImagem = (v) => typeof v === 'string' && v.length >= 12 && v.length <= 500 && /^https:\/\/[A-Za-z0-9._~:/?#@!$&*+,;=%-]+$/.test(v);

// ---------------------------------------------------------------------
// SELOS DO PRODUTO
// ---------------------------------------------------------------------
export const ESCOLHA_PADRAO = 'Escolha da casa';
/**
 * Selos que valem HOJE para um produto, do mais forte para o mais fraco.
 *   chegou  — p.chegouEm é o dia de hoje (o dono marca de manhã; amanhã some sozinho)
 *   escolha — p.escolha === true (o dono recomenda; o texto é da loja: "Escolha da Pedrina")
 *   estacao — p.estacao === true (está na safra)
 */
export function selosDe(p, { hoje = hojeDaLoja(), escolha = ESCOLHA_PADRAO } = {}) {
    if (!p || typeof p !== 'object') return [];
    const s = [];
    if (typeof p.chegouEm === 'string' && p.chegouEm === hoje) s.push({ tipo: 'chegou', texto: 'Chegou hoje' });
    if (p.escolha === true) s.push({ tipo: 'escolha', texto: texto(escolha, 24) || ESCOLHA_PADRAO });
    if (p.estacao === true) s.push({ tipo: 'estacao', texto: 'Da estação' });
    return s;
}

// ---------------------------------------------------------------------
// FAIXAS DA VITRINE
// ---------------------------------------------------------------------
export const MAX_FAIXAS = 4;          // contando "Ofertas de hoje" e "Seus de sempre", que já existiam
export const MAX_FAIXAS_LOJA = 3;     // faixas criadas pela loja (por categoria); entram no limite acima
const MAX_NA_FAIXA = 10;
const ehKit = (p) => /^(kit|cesta|combo)$/i.test(String(p.unidade || '')) || /^(kit|cesta|combo)s?\b/i.test(String(p.nome || ''));

/**
 * Faixas novas que entram hoje, já na ordem e com o lugar de cada uma:
 *   lugar 'topo' = antes das Ofertas (o que chegou hoje é o mais forte)
 *   lugar 'meio' = depois de "Seus de sempre"
 * As faixas que já existem (Ofertas, Seus de sempre) contam no limite total.
 */
export function faixasDaVitrine(produtos, { hoje = hojeDaLoja(), maisPedidos = [], temOfertas = false, temSempre = false, proprias = [] } = {}) {
    const lista = Array.isArray(produtos) ? produtos.filter((p) => p && p.id) : [];
    const porId = new Map(lista.map((p) => [p.id, p]));
    // faixas que a LOJA criou (Aparência → Vitrine): título e frase dela, produtos de uma categoria
    const daLoja = (Array.isArray(proprias) ? proprias : []).slice(0, MAX_FAIXAS_LOJA).map((f, i) => ({
        id: `loja${i}`, lugar: 'meio', titulo: f.titulo, sub: f.texto || '', minimo: 2,
        ids: lista.filter((p) => f.cat && String(p.cat || '').toLowerCase() === String(f.cat).toLowerCase()).map((p) => p.id),
    }));
    const candidatas = [
        { id: 'chegou', lugar: 'topo', titulo: 'Chegou hoje', sub: 'Acabou de chegar na banca. Fresquinho.', ids: lista.filter((p) => p.chegouEm === hoje).map((p) => p.id), minimo: 2 },
        ...daLoja,
        { id: 'estacao', lugar: 'meio', titulo: 'Da estação', sub: 'Na safra: mais sabor e preço melhor.', ids: lista.filter((p) => p.estacao === true).map((p) => p.id), minimo: 2 },
        { id: 'mais', lugar: 'meio', titulo: 'Os mais pedidos', sub: 'O que a vizinhança mais leva.', ids: (Array.isArray(maisPedidos) ? maisPedidos : []).filter((id) => porId.has(id)), minimo: 4 },
        { id: 'kits', lugar: 'meio', titulo: 'Kits prontos', sub: 'Tudo junto, num toque só.', ids: lista.filter(ehKit).map((p) => p.id), minimo: 2 },
    ];
    let vagas = Math.max(0, MAX_FAIXAS - (temOfertas ? 1 : 0) - (temSempre ? 1 : 0));
    const saida = [];
    for (const f of candidatas) {
        if (!vagas) break;
        if (f.id === 'chegou' && temOfertas) continue;     // no alto da loja cabe UMA faixa só: com Ofertas de hoje, o "Chegou hoje" fica no selo do produto
        const ids = [...new Set(f.ids)].slice(0, MAX_NA_FAIXA);
        if (ids.length < f.minimo) continue;
        saida.push({ id: f.id, lugar: f.lugar, titulo: f.titulo, sub: f.sub, ids });
        vagas--;
    }
    return saida;
}

// ---------------------------------------------------------------------
// PREÇO: peso aproximado de 1 unidade ("≈ 200 g")
// ---------------------------------------------------------------------
export function pesoAproximado(gramas) {
    const g = Number(gramas);
    if (!Number.isFinite(g) || g <= 0) return '';
    if (g >= 1000) return `≈ ${(Math.round(g / 100) / 10).toString().replace('.', ',')} kg`;
    const arred = g >= 100 ? Math.round(g / 10) * 10 : Math.round(g);
    return `≈ ${arred} g`;
}

// ---------------------------------------------------------------------
// ÍCONE DA CATEGORIA (desenhos próprios, em js/vitrine-arte.js)
// ---------------------------------------------------------------------
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const REGRAS_ICONE = [
    // comida pronta primeiro: "Pastel de queijo" é pastel (não queijo), "Batata frita" é fritas (não raiz)
    ['cesta', /\bkit|cesta|combo/],
    ['copo', /suco|vitamina|smoothie/],
    ['pastel', /pastel|pasteis/],
    ['tigela', /acai|tigela|bowl/],
    ['salgado', /salgad|coxinha|empada|esfiha|esfirra|kibe|risole|enrolad|folhado|croquete|petisco/],
    ['hamburguer', /hamburg|burger|lanche|sanduiche|x-/],
    ['cachorro', /cachorro|hot ?dog/],
    ['pizza', /pizza/],
    ['fritas', /batata frita|fritas|porcao|porcoes/],
    ['sorvete', /sorvete|gelad|picole|sacole|gelato/],
    ['bolo', /\bbolo|torta|sobremesa/],
    ['docinho', /brigadeiro|docinho|bombom|trufa|brownie|cupcake/],
    ['cafe', /cafe|cappuccino|capuccino|expresso|chocolate quente|\bcha\b/],
    ['pao', /\bpao|\bpaes|padaria|biscoito|rosca/],
    ['lata', /refri|\blatas?\b|soda|energetic|guarana/],
    ['cerveja', /cerveja|chopp|drink|vinho|alcool|caipirinha/],
    ['agua', /\bagua|isotonic|\bcoco\b/],
    ['carne', /churrasc|espet|carne|\bboi|bovin|suin|linguica|bacon/],
    ['frango', /frango|galinha|\baves?\b/],
    ['peixe', /peixe|pescad|camarao|frutos do mar|tilapia/],
    ['massa', /massa|macarr|lasanha|espaguete|nhoque|yakisoba/],
    ['marmita', /marmit|almoco|janta|refeicao|prato feito|\bpf\b|quentinha/],
    ['tapioca', /tapioca|crepe|beiju|cuscuz/],
    ['molho', /molho|ketchup|maionese|mostarda|pimenta|azeite/],
    ['promo', /promo|oferta|desconto|\bsale\b/],
    ['folha', /verdura|folha|hortali|salada|alface|couve/],
    ['fruta', /fruta|pomar/],
    ['raiz', /raiz|raizes|tuberc|batata|mandioca/],
    ['legume', /legume/],
    ['tempero', /tempero|erva|cheiro|condiment/],
    ['ovo', /ovo/],
    ['queijo', /queijo|latic|leite|derivad/],
    ['copo', /suco|polpa|bebida/],
    ['pote', /doce|mel|geleia|conserva|mercearia|grao|graos|cereal|artesan/],
];
/** Nome do desenho para o nome de uma categoria ('' = sem desenho). */
export function iconeDaCategoria(nome) {
    const n = semAcento(nome);
    if (!n) return '';
    for (const [icone, re] of REGRAS_ICONE) if (re.test(n)) return icone;
    return '';
}

// ---------------------------------------------------------------------
// QUADROS ILUSTRADOS E "QUEM ESCOLHE SEU PEDIDO" (ficam em loja/config.vitrine)
// ---------------------------------------------------------------------
export const MAX_QUADROS = 4;
/** SEÇÕES COLORIDAS: cada categoria ganha uma faixa de cor com desenho (ex.: Pastéis dourado, Açaí roxo). */
export const MAX_SECOES = 8;
/** Jeito da seção: 'fundo' = a cor toma o fundo inteiro da seção e os produtos ficam soltos sobre ela (imersivo); 'faixa' = só a faixa do título. */
export const ESTILOS_SECAO = ['fundo', 'faixa'];
export const ICONES_SECAO = Object.keys(ARTES);
const COR_HEX = /^#[0-9a-fA-F]{6}$/;
/** Tinta (texto) que se lê bem sobre a cor da seção: branco em cor escura, marrom bem escuro em cor clara. */
export function tintaSobre(cor) {
    if (!COR_HEX.test(String(cor))) return '#2a1a0c';
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#2a1a0c' : '#ffffff';
}
const luz = (cor) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Contraste entre duas cores #rrggbb (1 a 21). Cor inválida → 1. */
export function contraste(a, b) {
    if (!COR_HEX.test(String(a)) || !COR_HEX.test(String(b))) return 1;
    const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
}
/**
 * Cor do botão "Adicionar" sobre uma seção colorida: a cor de botão da loja quando se destaca do fundo da seção
 * (roxo da marca sobre dourado), senão a tinta da seção (branco sobre roxo). Devolve { fundo, texto }.
 */
export function botaoSobre(corSecao, corMarca) {
    if (COR_HEX.test(String(corMarca)) && contraste(corSecao, corMarca) >= 3.2) return { fundo: corMarca, texto: tintaSobre(corMarca) };
    return { fundo: tintaSobre(corSecao), texto: corSecao };
}
/**
 * Sugere seções para as categorias que a loja já tem: "pastel" vira dourado, "açaí" vira roxo.
 * cats = [{ chave, nome }]. Devolve [] quando nenhuma categoria combina.
 */
export function secoesSugeridas(cats) {
    const lista = Array.isArray(cats) ? cats : [];
    const acha = (re) => lista.find((c) => re.test(semAcento(c.nome || c.chave)));
    const saida = [], past = acha(/pastel|pasteis/), aca = acha(/acai/);
    if (past) saida.push({ cat: past.chave, titulo: texto(past.nome || past.chave, 40), texto: 'Crocantes, na hora, direto da fritadeira.', cor: '#f4d27c', icone: 'pastel', estilo: 'fundo' });
    if (aca && aca !== past) saida.push({ cat: aca.chave, titulo: texto(aca.nome || aca.chave, 40), texto: 'Cremoso, gelado, do jeitinho que você monta.', cor: '#5a1f6b', icone: 'tigela', estilo: 'fundo' });
    return saida;
}
/**
 * Confere o que o painel gravou antes de ir para a tela. O que não passa some.
 * { quadros: [{ img, titulo, texto, cat }], donos: { img, titulo, texto }, escolha }
 */
export function vitrineSegura(bruto) {
    const v = bruto && typeof bruto === 'object' ? bruto : {};
    const quadros = (Array.isArray(v.quadros) ? v.quadros : []).slice(0, MAX_QUADROS).map((q) => {
        const x = q && typeof q === 'object' ? q : {};
        const r = { titulo: texto(x.titulo, 50), texto: texto(x.texto, 160) };
        if (ehUrlImagem(x.img)) r.img = x.img;
        const cat = texto(x.cat, 60); if (cat) r.cat = cat;
        return r;
    }).filter((q) => q.titulo && (q.img || q.texto));
    const d = v.donos && typeof v.donos === 'object' ? v.donos : {};
    const donos = { titulo: texto(d.titulo, 50), texto: texto(d.texto, 200) };
    if (ehUrlImagem(d.img)) donos.img = d.img;
    const saida = { quadros };
    if (donos.titulo && (donos.img || donos.texto)) saida.donos = donos;
    const escolha = texto(v.escolha, 24); if (escolha) saida.escolha = escolha;
    // bloco dos pacotes (fim da vitrine): título e frase da loja; vazio = o texto padrão
    const pc = v.pacotes && typeof v.pacotes === 'object' ? v.pacotes : {};
    const pacotes = { titulo: texto(pc.titulo, 40), texto: texto(pc.texto, 160) };
    if (pacotes.titulo) saida.pacotes = pacotes;
    // cantinho dos temperos: título, frase e a categoria que entra nele ('' = a que tem "tempero" no nome; '-' = não separar)
    const tp = v.temperos && typeof v.temperos === 'object' ? v.temperos : {};
    const temperos = { titulo: texto(tp.titulo, 40), texto: texto(tp.texto, 160), cat: texto(tp.cat, 60) };
    if (temperos.titulo || temperos.texto || temperos.cat) saida.temperos = temperos;
    // seções coloridas por categoria
    const secoes = (Array.isArray(v.secoes) ? v.secoes : []).slice(0, 20).map((f) => {
        const x = f && typeof f === 'object' ? f : {};
        return { cat: texto(x.cat, 60), titulo: texto(x.titulo, 40), texto: texto(x.texto, 160), cor: COR_HEX.test(String(x.cor)) ? String(x.cor).toLowerCase() : '#efb94a', icone: ICONES_SECAO.includes(x.icone) ? x.icone : '', estilo: ESTILOS_SECAO.includes(x.estilo) ? x.estilo : 'fundo' };
    }).filter((x) => x.cat && x.titulo).slice(0, MAX_SECOES);
    if (secoes.length) saida.secoes = secoes;
    // faixas da loja por categoria
    const faixas = (Array.isArray(v.faixas) ? v.faixas : []).slice(0, 20).map((f) => {
        const x = f && typeof f === 'object' ? f : {};
        return { titulo: texto(x.titulo, 40), texto: texto(x.texto, 120), cat: texto(x.cat, 60) };
    }).filter((f) => f.titulo && f.cat).slice(0, MAX_FAIXAS_LOJA);
    if (faixas.length) saida.faixas = faixas;
    return saida;
}

/**
 * Onde cada bloco entra na vitrine: depois do 6º produto, do 14º, do 22º...
 * O bloco dos donos entra no 2º lugar (perto do topo, mas não em cima da vitrine).
 * Só entra bloco que cabe (lista curta não ganha quadro no fim, sozinho).
 */
export function blocosDaVitrine(vitrine, nProdutos) {
    const v = vitrineSegura(vitrine);
    const blocos = v.quadros.map((q, i) => ({ tipo: 'quadro', i, ...q }));
    if (v.donos) blocos.splice(Math.min(1, blocos.length), 0, { tipo: 'donos', ...v.donos });
    return blocos.map((b, k) => ({ ...b, depoisDe: 6 + 8 * k })).filter((b) => b.depoisDe < Number(nProdutos || 0));
}

// ---------------------------------------------------------------------
// TEXTOS COM CARA DE FEIRA (sem confundir os botões: eles continuam literais)
// ---------------------------------------------------------------------
export const SACOLA_VAZIA = { titulo: 'Sua sacola está vazia', dica: 'Bora pra feira? Toque em Adicionar nos produtos.' };
export const TROCA = { trocar: 'Se faltar algum item: pode trocar por um parecido', nao: 'Se faltar algum item: não trocar, só tirar' };
/** A observação do pedido com a escolha de troca no fim (o servidor guarda até 300 letras). */
export function obsComTroca(obs, escolha) {
    const base = texto(obs, 300);
    const frase = TROCA[escolha] || '';
    if (!frase) return base;
    const junta = base ? `${base} | ${frase}` : frase;
    return junta.length <= 300 ? junta : `${base.slice(0, 300 - frase.length - 3)} | ${frase}`;
}

// ---------------------------------------------------------------------
// FUNIL: visitas → colocou na sacola → abriu o fechamento → mandou o pedido
// ---------------------------------------------------------------------
export const ETAPAS = ['visita', 'adicionou', 'sacola', 'pedido'];
export const NOMES_ETAPAS = { visita: 'Visitas', adicionou: 'Puseram na sacola', sacola: 'Abriram o fechamento', pedido: 'Mandaram o pedido' };
const somaDias = (dias, de, ate) => {
    const t = Object.fromEntries(ETAPAS.map((e) => [e, 0]));
    for (const [dia, v] of Object.entries(dias || {})) {
        if (dia < de || dia > ate || !v || typeof v !== 'object') continue;
        for (const e of ETAPAS) t[e] += Math.max(0, Math.round(Number(v[e]) || 0));
    }
    return t;
};
const menosDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const taxa = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
/**
 * Resumo para o painel: últimos 7 dias contra os 7 anteriores.
 * dias = { '2026-10-14': { visita, adicionou, sacola, pedido }, ... }
 */
export function resumoFunil(dias, hoje = hojeDaLoja()) {
    const agora = somaDias(dias, menosDias(hoje, 6), hoje), antes = somaDias(dias, menosDias(hoje, 13), menosDias(hoje, 7));
    const comTaxas = (t) => ({ ...t, txSacola: taxa(t.adicionou, t.visita), txPedido: taxa(t.pedido, t.visita) });
    return { semana: comTaxas(agora), anterior: comTaxas(antes), poucos: agora.visita < 30 };
}
