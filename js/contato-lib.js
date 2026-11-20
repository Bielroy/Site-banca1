// =====================================================================
//  js/contato-lib.js — INSTAGRAM E WHATSAPP DA LOJA (para o cliente falar com ela).
//
//  Ficam em loja/config.contato = { instagram, whatsapp, mostrarWpp }:
//    instagram   só o nome de usuário, sem @ ("pastelacaidobie"). O painel aceita
//                "@pastel", "instagram.com/pastel" ou o link inteiro e guarda só o nome.
//    whatsapp    número só com dígitos, com 55 ("5562999998888"). Vazio = o mesmo
//                WhatsApp que recebe os pedidos.
//    mostrarWpp  mostra o botão do WhatsApp na loja.
//  Usado pelo painel (js/admin.js) e pela loja (js/loja.js). Sem dependências: os testes importam direto.
// =====================================================================

/** "@Pastel.do_Bie", "instagram.com/pastel", "https://www.instagram.com/pastel/?hl=pt" → "pastel.do_bie". Inválido → ''. */
export function normalizarInstagram(v) {
    let s = String(v == null ? '' : v).trim();
    if (!s) return '';
    s = s.replace(/^https?:\/\//i, '').replace(/^(www\.|m\.)/i, '');
    const m = s.match(/^instagram\.com\/([^/?#]+)/i) || s.match(/^instagr\.am\/([^/?#]+)/i);
    if (m) s = m[1];
    else if (/[/.]com\b|\//i.test(s.replace(/^@/, ''))) return '';      // outro site: não é Instagram
    s = s.replace(/^@+/, '').toLowerCase();
    // regra do Instagram: letras, números, ponto e sublinhado; até 30; não começa nem termina com ponto, sem ".."
    if (!/^[a-z0-9._]{1,30}$/.test(s) || s.startsWith('.') || s.endsWith('.') || s.includes('..')) return '';
    if (['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv'].includes(s)) return '';   // caminhos do site, não perfis
    return s;
}

/** Só os dígitos de um telefone brasileiro, com 55 na frente. "62 99999-8888" → "5562999998888". Inválido → ''. */
export function normalizarWhatsapp(v) {
    let d = String(v == null ? '' : v).replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 10 || d.length === 11) d = '55' + d;                  // DDD + número
    return /^55\d{10,11}$/.test(d) ? d : '';
}

export const linkInstagram = (usuario) => (usuario ? `https://www.instagram.com/${encodeURIComponent(usuario)}/` : '');
export const linkWhatsapp = (numero, texto = '') => (numero ? `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : '');

/** "5562999998888" → "(62) 99999-8888" (para mostrar). */
export function telefoneBonito(n) {
    const d = String(n || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
}

/**
 * "Falar com a loja": se o cliente já tem itens na sacola, a mensagem já vai com eles (a loja entende na hora do que se trata).
 * Só fala de peso quando o item é vendido a peso. Sem itens, é o "Oi! Vim pela loja X." de sempre.
 * itens = [{ nome, qtd, tipo, unidade }]
 */
export function saudacaoComSacola(nomeDaLoja, itens) {
    const oi = nomeDaLoja ? `Oi! Vim pela loja ${String(nomeDaLoja).slice(0, 60)}.` : 'Oi! Vim pela loja.';
    const lista = (Array.isArray(itens) ? itens : []).filter((i) => i && i.nome && Number(i.qtd) > 0).slice(0, 15);
    if (!lista.length) return oi;
    const linhas = lista.map((i) => {
        const q = Number(i.qtd), qtd = i.tipo === 'kg' ? `${String(q).replace('.', ',')} kg` : `${String(q).replace('.', ',')}x`;
        return `• ${qtd} ${String(i.nome).slice(0, 60)}`;
    });
    return `${oi} Estou montando um pedido e queria tirar uma dúvida:\n${linhas.join('\n')}`.slice(0, 900);
}

/**
 * O que a loja mostra ao cliente, já conferido (o que não passa some).
 * config = loja/config inteiro. Devolve { instagram, urlInstagram, whatsapp, urlWhatsapp } (vazios = não mostrar).
 */
export function contatoDaLoja(config, nomeDaLoja = '') {
    const c = config && typeof config === 'object' ? config : {};
    const k = c.contato && typeof c.contato === 'object' ? c.contato : {};
    const instagram = normalizarInstagram(k.instagram);
    const whatsapp = k.mostrarWpp === true ? (normalizarWhatsapp(k.whatsapp) || normalizarWhatsapp(c.wpp)) : '';
    const oi = nomeDaLoja ? `Oi! Vim pela loja ${String(nomeDaLoja).slice(0, 60)}.` : 'Oi! Vim pela loja.';
    return { instagram, urlInstagram: linkInstagram(instagram), whatsapp, urlWhatsapp: linkWhatsapp(whatsapp, oi) };
}
