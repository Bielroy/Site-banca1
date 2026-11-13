// =====================================================================
//  js/impressao-lib.js — O QUE vai no papel (sem falar com impressora nenhuma).
//
//  Tudo o que se imprime vira primeiro uma lista de "linhas" simples:
//     { t:'txt', v:'texto', al:'e'|'c'|'d', b:true (negrito), g:true (grande), a:true (alta: mesma largura, o dobro da altura) }
//     { t:'logo', src:'https://…' }   logo da loja (só na página comum; a térmica pula e segue com o nome em letra grande)
//     { t:'par', e:'esquerda', d:'direita', b }     ex.: "Tomate ........ R$ 8,00"
//     { t:'item', nome, e:'detalhe (peso x preço)', d:'valor', foto:'https://…' }   linha de recibo: na página comum leva foto; na térmica vira nome + detalhe e valor
//     { t:'marca' }   o desenho do UseBanca (página comum: SVG; térmica: pontos, GS v 0)       par com tot:true = caixa do total (página comum)
//     { t:'sep' }   linha tracejada      { t:'esp', n }   linhas em branco      { t:'corte' }
//  Depois a mesma lista é transformada em:
//     • comandos ESC/POS  (impressora térmica por Bluetooth, cabo ou app)  → paraEscPos
//     • página comum       (qualquer impressora instalada no aparelho)     → paraHtml
//     • texto puro         (prévia na tela e testes)                        → paraTexto
//  Assim o cupom é igual em qualquer caminho, e um caminho novo não muda o cupom.
// =====================================================================
// <marca-gerada> — o desenho do UseBanca. GERADO por scripts/gerar-marca-termica.js (não edite à mão).
//   MARCA_SVG = preto e branco, para a página comum · MARCA_BITS = 128 x 128 pontos, 1 bit cada (1 = preto), linha por linha, para a térmica (GS v 0)
//   Fica neste arquivo de propósito: o servidor (Dockerfile) leva só js/impressao-lib.js, que não pode importar outros arquivos.
const MARCA_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"96 76 320 320\" fill=\"none\"><defs><pattern id=\"r\" width=\"9\" height=\"9\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\"><rect width=\"9\" height=\"9\" fill=\"#fff\"/><rect width=\"4.5\" height=\"9\" fill=\"#000\"/></pattern></defs><circle cx=\"322\" cy=\"204\" r=\"56\" fill=\"url(#r)\" stroke=\"#000\" stroke-width=\"6\"/><circle cx=\"216\" cy=\"188\" r=\"76\" fill=\"#000\"/><path d=\"M216 118C218 92 238 80 260 82C260 104 242 118 216 118Z\" fill=\"#000\"/><g fill=\"#fff\" stroke=\"#000\" stroke-width=\"7\"><rect x=\"115\" y=\"235\" width=\"282\" height=\"36\" rx=\"8\"/><rect x=\"115\" y=\"292\" width=\"282\" height=\"36\" rx=\"8\"/><rect x=\"115\" y=\"349\" width=\"282\" height=\"36\" rx=\"8\"/></g><rect x=\"104\" y=\"224\" width=\"40\" height=\"168\" rx=\"10\" fill=\"#000\"/><rect x=\"368\" y=\"224\" width=\"40\" height=\"168\" rx=\"10\" fill=\"#000\"/></svg>";
const MARCA_BITS = { w: 128, h: 128, b64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAAAAAAAD/4AAAAAAAAAAAAAAAAAAD/+AAAAAAAAAAAAAAAAAAA//gAAAAAAAAAAAAAAAAAAf/wAAAAAAAAAAAAAAAAAAP/8AAAAAAAAAAAAAAAAAAD/+AAAAAAAAAAAAAAAAAAB//AAAAAAAAAAAAAAAAAAAf/gAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAAAAAAD//4AAAAAAAAAAAAAAAAAH///gAAAAAAAAAAAAAAAAH///+AAAAAAAAAAAAAAAAH////4AAAAAAAAAAAAAAAH/////gAAAAAAAAAAAAAAD/////8AAAAAAAAAAAAAAB//////gAAAAAAAAAAAAAB//////+AAAAAAAAAAAAAA///////wAAAAAAAAAAAAAf//////+AAAAAAAAAAAAAH///////gAAAAAAAAAAAAD///////8AAAAAAAAAAAAB////////gAAAAAAAAAAAA////////8AP/4AAAAAAAAP////////Af//wAAAAAAAH////////4f5z/AAAAAAAB////////+f85z4AAAAAAA//////////Oc5/gAAAAAAP/////////nOc58AAAAAAD/////////znOc/gAAAAAB/////////5znOc8AAAAAAf////////+5znOfgAAAAAH/////////85znO8AAAAAD/////////+c5znHAAAAAA//////////Oc5zj4AAAAAP/////////3Oc5xmAAAAAD//////////nOc4xwAAAAA//////////znOcY8AAAAAP/////////5znOMbgAAAAD/////////85znGM4AAAAA//////////c5zjGOAAAAAP/////////+c5xjHgAAAAD//////////Oc4xjcAAAAA//////////nOcYxnAAAAAP/////////znOMYxwAAAAD/////////9znGMY8AAAAA//////////5zjGMfAAAAAH/////////85xjGNwAAAAB/////////+c4xjGcAAAAAf/////////OcYxjHAAAAAD/////////nOMYxjwAAAAA/////////znGMYx4AAAAAP////////9zjGMY+AAAAAB////////+5xjGMbgAAD/4f////////c4xjGM//AD//D////////+cYxjGf/8B//4f////////OMYxjH//gf///////////////////4H///////////////////+B////////////////////gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B////////////////////gf///////////////////4H///////////////////+B////////////////////gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B////////////////////gf///////////////////4H///////////////////+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H///////////////////+B////////////////////gf///////////////////4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H///////////////////+B////////////////////gf///////////////////4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf/+AAAAAAAAAAAAAAB//4H//gAAAAAAAAAAAAAAf/+B//4AAAAAAAAAAAAAAH//gf///////////////////4H///////////////////+A////////////////////AP/8AAAAAAAAAAAAAAA//wAf4AAAAAAAAAAAAAAAB/gAAAAAAAAAAAAAAAAAAAAAA=' };
// </marca-gerada>
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
    if (p && p.modo === 'retirada') return [p.feiraId ? 'RETIRADA NA FEIRA' : 'RETIRADA NA BANCA', limpo(p.retiradaLocal, 60)].filter(Boolean).join(' - ');   // e onde (cada feira num lugar)
    const a = limpo(p.quadra, 60), b = limpo(p.lote, 30), f = p.formatoEndereco || 'ql';
    const resto = f === 'rua' ? [a, b && `nº ${b}`] : f === 'livre' ? [a, b] : [a && `Quadra ${a}`, b && `Lote ${b}`];
    return [limpo(p.condominio, 60), resto.filter(Boolean).join(f === 'ql' ? ' · ' : ', ')].filter(Boolean).join(' - ');
}

const kgTxt = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000).replace('.', ',');
/** "0,62 kg x R$ 8,90/kg" para o item pedido em unidades que foi à balança ('' para os outros). */
const pesoTxt = (i) => (Number(i.pesoFinal) > 0 && i.tipo === 'un' && PESO.includes(String(i.unidade || '').toLowerCase()) ? `${kgTxt(i.pesoFinal)} kg x ${reais(i.precoOriginal)}/kg` : '');

/** Como o pedido chega ao cliente, em letra grande no papel: quem separa vê de cara se é para entregar ou se o cliente busca. */
export function modoTxt(p) {
    if (!p || p.origem === 'balcao') return '';                                   // venda no balcão: o cliente já está ali
    if (p.modo === 'retirada') return p.feiraId ? 'RETIRADA NA FEIRA' : 'RETIRADA NA BANCA';
    return limpo(p.quadra) || limpo(p.condominio) ? 'ENTREGA' : '';
}
/** Linha de "onde": na retirada, o local (o tipo já saiu grande em cima); na entrega, o endereço. */
const ondeTxt = (p) => (p && p.modo === 'retirada' ? (limpo(p.retiradaLocal, 60) ? `Local: ${limpo(p.retiradaLocal, 60)}` : '') : enderecoTxt(p));

/** Cupom completo de um pedido (da loja on-line ou do balcão). */
export function cupomDoPedido(p, { loja = '', aviso = '' } = {}) {
    const L = [], itens = Array.isArray(p.itens) ? p.itens : [];
    if (loja) L.push(txt(loja, { al: 'c', b: true, g: true }));
    L.push(txt(`${p.origem === 'balcao' ? 'Venda no balcão' : 'Pedido'}${p.id ? ` ${numeroDoPedido(p)}` : ''}`, { al: 'c' }), txt(dataHora(p.data), { al: 'c' }));
    if (limpo(aviso)) L.push(txt(aviso, { al: 'c', b: true }));            // ex.: "CUPOM ATUALIZADO (depois da balança)"
    const modo = modoTxt(p); if (modo) L.push(SEP, txt(modo, { al: 'c', b: true, g: true }));
    L.push(SEP);
    if (limpo(p.nome)) L.push(txt(p.nome, { b: true, a: true }));
    const end = ondeTxt(p); if (end) L.push(txt(end));
    if (limpo(p.telefone)) L.push(txt(`Tel: ${limpo(p.telefone, 20)}`));
    if (limpo(p.nome) || end) L.push(SEP);
    let soma = 0, aPesar = 0;
    // os itens saem em letra ALTA (mesma largura, o dobro da altura): é o que se lê de longe na hora de separar
    itens.forEach((i) => {
        if (i.aPesar) { aPesar++; L.push({ t: 'par', e: `${qtdTxt(i)} ${limpo(i.nome, 60)}`, d: 'a pesar', a: true }); }
        else { soma += Number(i.subtotal) || 0; L.push({ t: 'par', e: `${qtdTxt(i)} ${limpo(i.nome, 60)}`, d: reais(i.subtotal), a: true }); }
        const peso = pesoTxt(i); if (peso) L.push(txt(`  ${peso}`));                // o que a balança marcou
        if (i.adicionais) L.push(txt(`  + ${limpo(i.adicionais, 200)}`));   // montar pedido: o que o cliente escolheu
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
    if (p.entrega && limpo(p.entrega.horario)) L.push(txt(`${p.modo === 'retirada' ? 'Retirar' : 'Entregar'}: ${limpo(p.entrega.horario, 40)}`, { b: true }));
    if (limpo(p.obs)) L.push(SEP, txt(`Obs: ${limpo(p.obs, 300)}`));
    L.push(SEP, txt('Obrigado pela preferência!', { al: 'c' }), CORTE);
    return L;
}

/** Quilos que a balança marcou neste item (0 quando o item não é vendido por peso). */
const quilosDe = (i) => {
    const u = String(i.unidade || '').toLowerCase(), kg = ['kg', 'kilo', 'quilograma'].includes(u), g = ['g', 'grama'].includes(u);
    if (i.aPesar) return 0;
    if (i.tipo === 'un') return kg && Number(i.pesoFinal) > 0 ? Number(i.pesoFinal) : 0;
    return kg ? Number(i.qtd) || 0 : g ? (Number(i.qtd) || 0) / 1000 : 0;
};

/**
 * RECIBO DO CLIENTE: o papel que vai NA SACOLA, depois da balança. Mais caprichado que o cupom de separar:
 *   • em cima: a logo da banca (página comum) e o nome dela; embaixo: a marca do UseBanca (a térmica imprime o desenho em pontos);
 *   • lista de itens: foto pequena (só na página comum), nome, peso e preço do quilo, valor da linha;
 *   • peso total, o total em destaque ("PARCIAL" enquanto falta pesar alguma coisa, com a lista do que falta) e o que ficou de fora.
 *   opções: { loja, logo (https da banca), fotos ({ idDoProduto: https }), assinatura (texto do pé; '' tira) }
 */
export function reciboDoCliente(p, { loja = '', logo = '', fotos = {}, assinatura = 'Pedido feito pelo UseBanca · usebanca.com' } = {}) {
    const L = [], itens = Array.isArray(p.itens) ? p.itens : [], mapaFotos = fotos && typeof fotos === 'object' ? fotos : {};
    if (/^https:\/\/[^\s"'<>]+$/.test(String(logo || ''))) L.push({ t: 'logo', src: String(logo) });
    if (loja) L.push(txt(loja, { al: 'c', b: true, g: true, ser: true }));
    L.push(txt(`Recibo do pedido${p.id ? ` ${numeroDoPedido(p)}` : ''}`, { al: 'c', b: true }), txt(dataHora(p.pesadoEm || p.data), { al: 'c' }), SEP);
    if (limpo(p.nome)) L.push(txt(p.nome, { b: true, a: true }));
    const end = enderecoTxt(p); if (end) L.push(txt(end));
    if (p.entrega && limpo(p.entrega.horario)) L.push(txt(`${p.modo === 'retirada' ? 'Retirada' : 'Entrega'}: ${limpo(p.entrega.horario, 40)}`));
    L.push(SEP);
    let soma = 0, quilos = 0; const faltam = [];
    itens.forEach((i) => {
        const foto = /^https:\/\/[^\s"'<>]+$/.test(String(mapaFotos[i.id] || '')) ? String(mapaFotos[i.id]) : '';
        if (i.aPesar) { faltam.push(`${qtdTxt(i)} ${limpo(i.nome, 60)}`); L.push({ t: 'item', nome: limpo(i.nome, 80), e: `  ${qtdTxt(i)}`, d: 'a pesar', foto, a: true }); }
        else {
            soma += Number(i.subtotal) || 0; quilos += quilosDe(i);
            const preco = Number(i.precoOriginal ?? i.preco) || 0, porQuilo = PESO.includes(String(i.unidade || '').toLowerCase());
            const detalhe = pesoTxt(i) || (porQuilo && i.tipo !== 'un' ? `${qtdTxt(i)} x ${reais(preco)}` : (Number(i.qtd) > 1 && preco > 0 && !i.promo ? `${Math.round(Number(i.qtd))} x ${reais(preco)}` : qtdTxt(i)));
            L.push({ t: 'item', nome: limpo(i.nome, 80), e: `  ${detalhe}`, d: reais(i.subtotal), foto, a: true });
        }
        if (i.adicionais) L.push(txt(`  + ${limpo(i.adicionais, 200)}`));
    });
    L.push(SEP);
    const desc = p.cupom && Number(p.cupom.desconto) > 0 ? Number(p.cupom.desconto) : 0;
    const taxa = p.entrega && Number(p.entrega.taxa) > 0 ? Number(p.entrega.taxa) : 0, aPesar = faltam.length;
    if (quilos > 0) L.push({ t: 'par', e: 'Peso total', d: `${kgTxt(quilos)} kg` });
    if (desc || taxa || aPesar) L.push({ t: 'par', e: 'Itens', d: reais(soma) });
    if (desc) L.push({ t: 'par', e: `Cupom ${limpo(p.cupom.codigo, 20)}`, d: `-${reais(desc)}` });
    if (taxa) L.push({ t: 'par', e: 'Entrega', d: reais(taxa) });
    L.push({ t: 'par', e: aPesar ? 'PARCIAL' : 'TOTAL', d: reais(p.total), b: true, g: true, tot: true });
    if (aPesar) L.push(txt(`Falta pesar ${aPesar} item(ns): ${faltam.join(', ')}. O total muda depois da balança.`));
    const pago = p.pagamento && p.pagamento.status === 'PAID';
    if (limpo(p.pag)) L.push(txt(`Pagamento: ${limpo(p.pag, 30)}${pago ? ' (já recebido)' : ''}`));
    if (!pago && limpo(p.troco)) L.push(txt(`Troco para: ${limpo(p.troco, 30)}`));
    // o que faltou e saiu do pedido: o cliente lê no papel o mesmo aviso que recebeu no WhatsApp
    const fora = [...new Set((Array.isArray(p.ajustes) ? p.ajustes : []).filter((a) => a && a.op === 'tirou' && limpo(a.nome)).map((a) => limpo(a.nome, 60)))];
    if (fora.length) L.push(SEP, txt(`Em falta hoje (${fora.length === 1 ? 'saiu' : 'saíram'} do pedido): ${fora.join(', ')}. Pedimos desculpas.`));
    L.push(SEP, txt('Obrigado pela preferência!', { al: 'c', b: true, ser: true }), { t: 'marca' });
    if (limpo(assinatura)) L.push(txt(assinatura, { al: 'c' }));
    L.push(CORTE);
    return L;
}

/** Número curto do pedido, o mesmo no cupom, na etiqueta e no aviso de cancelado. */
export const numeroDoPedido = (p) => String((p && p.id) || '').slice(-6).toUpperCase();

/** Aviso de pedido CANCELADO depois que o cupom já tinha saído: para ninguém separar ou entregar. */
export function avisoDeCancelamento(p, { loja = '' } = {}) {
    const L = [];
    if (loja) L.push(txt(loja, { al: 'c' }));
    L.push(txt('PEDIDO CANCELADO', { al: 'c', b: true, g: true }), txt(`Pedido ${numeroDoPedido(p)}`, { al: 'c', b: true }), txt(`Cancelado em ${dataHora(p.canceladoEm)}`, { al: 'c' }), SEP);
    if (limpo(p.nome)) L.push(txt(p.nome, { b: true }));
    const end = enderecoTxt(p); if (end) L.push(txt(end));
    L.push(SEP, txt('Não separe nem entregue este pedido. Se já separou, volte os itens para a banca.'), CORTE);
    return L;
}

/** Etiqueta para colar na sacola: quem é, onde entrega, quanto cobrar. */
export function etiquetaDeEntrega(p, { loja = '', volume = 1, volumes = 1 } = {}) {
    const L = [], itens = Array.isArray(p.itens) ? p.itens : [], pago = p.pagamento && p.pagamento.status === 'PAID';
    if (loja) L.push(txt(loja, { al: 'c' }));
    L.push(txt(p.nome || 'Cliente', { al: 'c', b: true, g: true }));
    const modo = modoTxt(p); if (modo) L.push(txt(modo, { al: 'c', b: true, g: true }));
    const end = ondeTxt(p); if (end) L.push(txt(end, { al: 'c', b: true }));
    if (p.feiraId && /^\d{4}-\d{2}-\d{2}$/.test(String(p.entregaDia || '')) && p.paraHoje === false) L.push(txt(`PARA ${String(p.entregaDia).slice(8, 10)}/${String(p.entregaDia).slice(5, 7)}`, { al: 'c', b: true }));   // pedido para a próxima feira
    if (p.entrega && limpo(p.entrega.horario)) L.push(txt(`${p.modo === 'retirada' ? 'Retirar' : 'Entregar'}: ${limpo(p.entrega.horario, 40)}`, { al: 'c' }));
    L.push(SEP, { t: 'par', e: `${itens.length} item(ns)${p.id ? ` - Pedido ${numeroDoPedido(p)}` : ''}`, d: volumes > 1 ? `Volume ${volume}/${volumes}` : '' });
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

// ---------------------------------------------------------------- pedido que chegou por mensagem (WhatsApp)
// Emoji e figurinha não existem na térmica (sairiam como "?"): saem do texto antes de imprimir.
const semEmoji = (s) => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu, '');
// *negrito*, _itálico_ e ~riscado~ do WhatsApp: os sinais saem, a palavra fica.
const FORMATO_WHATS = /(^|[\s(])[*_~]+|[*_~]+(?=[\s),.;:!?]|$)/g;
// "acrescentar: 1 repolho" → "1 repolho" (o cliente mandou mais itens numa segunda mensagem)
const PREFIXO_MAIS = /^(?:acrescentar|acrescenta|adicionar|adiciona|incluir|inclui|e mais|mais|tamb[eé]m)\s*:\s*/i;
/** Separa os itens pelo ";" (o jeito comum de listar numa linha só), menos o que está entre parênteses. */
function porPontoEVirgula(l) {
    const out = []; let atual = '', fundo = 0;
    for (const ch of l) {
        if (ch === '(') fundo++; else if (ch === ')' && fundo > 0) fundo--;
        if (ch === ';' && fundo === 0) { out.push(atual); atual = ''; } else atual += ch;
    }
    out.push(atual);
    return out;
}
/**
 * Texto colado do WhatsApp → linhas limpas de itens.
 * Tira o carimbo "[12:30, 16/10/2026] Maria: " que o WhatsApp põe ao copiar, os emojis, a formatação
 * (*negrito*, _itálico_), marcadores ("- ", "• ", "* ") e linhas vazias. Uma linha com vários itens
 * separados por ";" vira um item por linha. NADA é cortado no meio: antes cada linha parava em 120 letras
 * e o resto do pedido sumia do papel. No máximo 120 itens de 300 letras (o papel quebra a linha).
 */
export function linhasDoWhats(texto) {
    return String(texto == null ? '' : texto).split(/\r?\n/)
        .map((l) => semEmoji(l).replace(/^\s*\[[^\]]{3,40}\]\s*[^:]{1,40}:\s*/, ''))
        .flatMap(porPontoEVirgula)
        .map((l) => l.replace(FORMATO_WHATS, '$1').replace(/^\s*(?:[-•*·–]|\d{1,2}[.)](?=\s))\s*/, '').replace(/^\s+/, '').replace(PREFIXO_MAIS, '')
            .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')'))
        .map((l) => limpo(l, 300)).filter(Boolean).slice(0, 120);
}
/**
 * Papel de um pedido que chegou por mensagem e não está no sistema.
 * d = { nome, telefone, endereco, itens (texto colado), obs, pagamento, entrega }. Sai com "Pedido do WhatsApp" e a hora.
 */
export function pedidoAvulso(d = {}, { loja = '', agora = Date.now() } = {}) {
    const L = [], itens = linhasDoWhats(d.itens), c = (v, n) => limpo(semEmoji(v), n);
    if (loja) L.push(txt(loja, { al: 'c', b: true, g: true }));
    L.push(txt('Pedido do WhatsApp', { al: 'c' }), txt(dataHora(new Date(agora).toISOString()), { al: 'c' }), SEP);
    if (c(d.nome, 80)) L.push(txt(c(d.nome, 80), { b: true, g: true }));
    if (c(d.endereco, 160)) L.push(txt(c(d.endereco, 160), { b: true }));
    if (c(d.telefone, 20)) L.push(txt(`Tel: ${c(d.telefone, 20)}`));
    if (c(d.nome, 80) || c(d.endereco, 160) || c(d.telefone, 20)) L.push(SEP);
    if (itens.length) { itens.forEach((i) => L.push(txt(i))); L.push(SEP, txt(`${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`)); }
    if (c(d.entrega, 60)) L.push(txt(`Entregar: ${c(d.entrega, 60)}`, { b: true }));
    if (c(d.pagamento, 60)) L.push(txt(`Pagamento: ${c(d.pagamento, 60)}`, { b: true }));
    if (c(d.obs, 300)) L.push(SEP, txt(`Obs: ${c(d.obs, 300)}`));
    L.push(CORTE);
    return L;
}
/** Tem alguma coisa para imprimir? (nome, endereço ou pelo menos um item) */
export const avulsoTemConteudo = (d = {}) => !!(linhasDoWhats(d.itens).length || limpo(semEmoji(d.nome)) || limpo(semEmoji(d.endereco)));

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
        else if (l.t === 'marca') out.push({ img: 'marca' });
        else if (l.t === 'item') {                          // sem foto no papel térmico: o nome e, embaixo, o detalhe com o valor
            quebrar(l.nome, n).forEach((s) => out.push({ s, b: true, a: l.a && !l.g }));
            const d = String(l.d || ''), livre = Math.max(4, n - d.length - (d ? 1 : 0)), partes = quebrar(l.e, livre);
            partes.forEach((s, i) => out.push({ s: i === partes.length - 1 && d ? s.padEnd(n - d.length) + d : s }));
        }
        else if (l.t === 'txt') quebrar(l.v, n).forEach((s) => out.push({ s: alinhar(s, n, l.al), b: l.b, g: l.g, a: l.a && !l.g }));
        else if (l.t === 'par') {
            const d = String(l.d || ''), livre = Math.max(4, n - d.length - (d ? 1 : 0)), partes = quebrar(l.e, livre);
            partes.forEach((s, i) => out.push({ s: i === partes.length - 1 && d ? s.padEnd(n - d.length) + d : s, b: l.b, g: l.g, a: l.a && !l.g }));
        }
    });
    return out;
}
export const paraTexto = (linhas, colunas = 32) => compor(linhas, colunas).filter((l) => !l.corte && !l.img).map((l) => l.s.replace(/\s+$/, '')).join('\n');

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
/** base64 → lista de bytes (funciona no navegador e no Node). */
const Buffer_ = (b64) => { const bin = atob(b64), out = new Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
export function paraEscPos(linhas, { largura = 58, acentos = false, cortar = true } = {}) {
    const b = [0x1b, 0x40];                                   // ESC @  → zera a impressora
    if (acentos) b.push(0x1b, 0x74, 0x03);                    // ESC t 3 → tabela 860
    let negrito = false, tamanho = 0;                         // GS ! → 0x11 = dobro de largura e altura; 0x01 = só o dobro da altura
    compor(linhas, colunasDe(largura)).forEach((l) => {
        if (l.img) {                                                                                     // desenho do UseBanca: GS v 0 (imagem em pontos), centralizado
            const w = MARCA_BITS.w / 8, bytes = Buffer_(MARCA_BITS.b64);
            b.push(0x1b, 0x61, 1, 0x1d, 0x76, 0x30, 0, w & 255, w >> 8, MARCA_BITS.h & 255, MARCA_BITS.h >> 8, ...bytes, 0x0a, 0x1b, 0x61, 0);
            return;
        }
        if (l.corte) { b.push(0x0a, 0x0a, 0x0a); if (cortar) b.push(0x1d, 0x56, 0x42, 0x00); return; }   // GS V 66 0 → corte (quem não tem guilhotina ignora)
        if (!!l.b !== negrito) { negrito = !!l.b; b.push(0x1b, 0x45, negrito ? 1 : 0); }                 // ESC E
        const tam = l.g ? 0x11 : l.a ? 0x01 : 0x00;
        if (tam !== tamanho) { tamanho = tam; b.push(0x1d, 0x21, tam); }
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
        const c = `${l.b ? ' b' : ''}${l.g ? ' g' : l.a ? ' a' : ''}${l.ser ? ' ser' : ''}${l.tot ? ' tot' : ''}`;
        if (l.t === 'sep') return '<hr>';
        if (l.t === 'logo') return /^https:\/\/[^\s"'<>]+$/.test(String(l.src || '')) ? `<p class="c"><img class="logo" src="${esc(l.src)}" alt=""></p>` : '';
        if (l.t === 'marca') return `<p class="c marca">${MARCA_SVG}</p>`;
        if (l.t === 'item') {
            const foto = /^https:\/\/[^\s"'<>]+$/.test(String(l.foto || '')) ? `<img src="${esc(l.foto)}" alt="">` : '';
            return `<div class="it">${foto}<div class="nm"><b>${esc(l.nome)}</b><small>${esc(String(l.e || '').trim())}</small></div><span class="vl">${esc(l.d || '')}</span></div>`;
        }
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
p { overflow-wrap: anywhere; } .c { text-align: center; } .d { text-align: right; } .b { font-weight: 700; } .g { font-size: 1.5em; line-height: 1.2; } .a { font-size: 1.22em; line-height: 1.25; }
.ser { font-family: Georgia, 'Times New Roman', serif; letter-spacing: .02em; }
.marca { margin: 2.5mm 0 1mm; } .marca svg { width: 16mm; height: 16mm; }
.it { display: flex; align-items: center; gap: 2.4mm; padding: 1.6mm 0; border-bottom: .25mm dotted #000; break-inside: avoid; } .it:last-of-type { border-bottom: 0; }
.it img { flex: none; width: 11mm; height: 11mm; object-fit: cover; border-radius: 1.6mm; border: .25mm solid #000; filter: grayscale(1) contrast(1.15); }
.it .nm { flex: 1; min-width: 0; line-height: 1.25; overflow-wrap: anywhere; } .it .nm b { display: block; } .it .nm small { display: block; font-size: .86em; }
.it .vl { flex: none; font-weight: 700; white-space: nowrap; }
.tot { border-top: .6mm double #000; border-bottom: .6mm double #000; padding: 1.4mm 0; margin: 1.5mm 0; }
.logo { display: inline-block; max-width: 26mm; max-height: 26mm; margin: 0 auto 1.5mm; object-fit: contain; }
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
