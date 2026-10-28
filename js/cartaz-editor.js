// =====================================================================
//  js/cartaz-editor.js — MONTAR O CARTAZ DE UMA LOJA (Plataforma → Lojas → loja → "Montar cartaz").
//
//  Um cartaz por feira: o QR e a fitinha levam à LOJA já dentro daquela feira
//  (?loja=id&feira=fid), então o cliente cai na banca certa e a faixa da feira aparece.
//  Tudo editável antes de imprimir: feira, texto do topo, nome, frase, legenda da foto,
//  WhatsApp, Instagram, logo e foto. Começa com o que a loja já tem (Aparência e
//  Configurações). Os textos ficam guardados NESTE aparelho (por loja e feira); as fotos
//  escolhidas do celular não saem do aparelho (vão só para a página de imprimir).
// =====================================================================
import { getDoc, doc, db } from './firebase.js';
import { urlDaLoja } from './tenant.js';
import { comFeira } from './plataforma-lib.js';
import { normalizarInstagram, normalizarWhatsapp, telefoneBonito } from './contato-lib.js';
import { escapeHTML } from './utils.js';
import { cartazLojaHtml, imagemDoCartaz, linkCurto } from './cartaz-lib.js';
import { urlImagem } from './aparencia-lib.js';

const CHAVE = (lojaId, fid) => `pf_cartaz:${lojaId}:${fid || '-'}`;
const TEXTOS = ['local', 'nome', 'frase', 'legenda', 'wpp', 'insta'];
const lerGuardado = (lojaId, fid) => { try { const v = JSON.parse(localStorage.getItem(CHAVE(lojaId, fid)) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } };
function guardar(st) {
    const o = {}; TEXTOS.forEach((k) => { if (st.mexido[k]) o[k] = st[k]; });
    try { if (Object.keys(o).length) localStorage.setItem(CHAVE(st.lojaId, st.fid), JSON.stringify(o)); else localStorage.removeItem(CHAVE(st.lojaId, st.fid)); } catch (_) { /* sem armazenamento: só não lembra */ }
}

/** Endereço que o QR e a fitinha abrem: a loja, já dentro da feira escolhida. */
export function linkDoCartaz(lojaId, fid, base = (typeof location !== 'undefined' ? location.href : 'https://usebanca.com/')) {
    const daLoja = new URL(urlDaLoja(lojaId, '/'), base).href;
    return fid ? comFeira(daLoja, fid) : daLoja;
}

/** O que vem da loja (o "padrão" de cada campo) para a feira escolhida. */
function padroes(st) {
    const f = st.feiras.find((x) => x.id === st.fid);
    return { local: f ? f.nome : '', nome: st.loja.nome, frase: st.loja.subtitulo || 'Escolha, monte o seu pedido e a gente prepara.', legenda: st.loja.nome, wpp: st.loja.wpp, insta: st.loja.insta };
}
function aplicarFeira(st) {
    const p = padroes(st), g = lerGuardado(st.lojaId, st.fid);
    st.mexido = {};
    TEXTOS.forEach((k) => { if (typeof g[k] === 'string') { st[k] = g[k]; st.mexido[k] = true; } else st[k] = p[k]; });
}

/** Lê a ficha e o contato da loja e devolve o rascunho do cartaz. feiras = [{ id, nome }] onde a loja está. */
export async function carregarCartaz(l, feiras) {
    let ficha = {}, config = {};
    await Promise.all([
        getDoc(doc(db, 'tenants', l.id)).then((sn) => { if (sn.exists()) ficha = sn.data() || {}; }).catch(() => {}),
        getDoc(doc(db, 'tenants', l.id, 'loja', 'config')).then((sn) => { if (sn.exists()) config = sn.data() || {}; }).catch(() => {}),
    ]);
    const k = (config.contato && typeof config.contato === 'object') ? config.contato : {};
    const tema = ficha.tema && typeof ficha.tema === 'object' ? ficha.tema : {};
    const wpp = normalizarWhatsapp(k.whatsapp) || normalizarWhatsapp(config.wpp);
    const st = {
        lojaId: l.id, feiras: (feiras || []).map((f) => ({ id: f.id, nome: f.nome })),
        loja: { nome: String(ficha.nome || l.nome || '').trim(), subtitulo: String(ficha.subtitulo || '').trim(), wpp: wpp ? telefoneBonito(wpp) : '', insta: normalizarInstagram(k.instagram) ? '@' + normalizarInstagram(k.instagram) : '', tema },
        logoLoja: urlImagem(tema.logo), fotoLoja: urlImagem(tema.capa), logo: urlImagem(tema.logo), foto: urlImagem(tema.capa),
        fid: '', mexido: {},
    };
    // sem logo e com uma "capa" que na verdade é a logo: tudo bem, a pessoa troca aqui
    st.fid = st.feiras.length ? st.feiras[0].id : '';
    aplicarFeira(st);
    return st;
}

/** Conferência dos campos (o que vai sair de fato no papel). */
export function conferir(st) {
    const wppD = normalizarWhatsapp(st.wpp), insta = normalizarInstagram(st.insta);
    return {
        wpp: wppD, insta,
        avisoWpp: st.wpp.trim() && !wppD ? 'Confira o número: DDD + número (ex.: 61 99999-0000).' : '',
        avisoInsta: st.insta.trim() && !insta ? 'Confira o Instagram: o @ da loja (ex.: @pastelmoecoe).' : '',
    };
}

/** HTML da página A4 (o mesmo para a prévia e para imprimir). */
export function htmlDoCartaz(st, base) {
    const c = conferir(st);
    return cartazLojaHtml({
        loja: { nome: st.nome.trim() || st.loja.nome, subtitulo: st.frase, legenda: st.legenda, whatsapp: c.wpp, instagram: c.insta, tema: { ...st.loja.tema, logo: st.logo, capa: st.foto } },
        condominios: st.local.trim() ? [st.local.trim()] : [], link: linkDoCartaz(st.lojaId, st.fid, base),
    });
}

const campo = (k, rotulo, st, extra = '') => `<label class="pf-rot" for="pf-cz-${k}">${rotulo}</label>
<div class="pf-form-linha"><input type="text" id="pf-cz-${k}" data-pf-cartaz="${k}" value="${escapeHTML(st[k])}" autocomplete="off" ${extra}></div>`;
const imagem = (k, rotulo, st) => {
    const atual = st[k], daLoja = k === 'logo' ? st.logoLoja : st.fotoLoja;
    return `<div class="pf-cz-img"><div class="pf-cz-mini${k === 'logo' ? ' redonda' : ''}">${atual ? `<img src="${escapeHTML(atual)}" alt="">` : '<span>sem</span>'}</div>
<div><span class="pf-rot">${rotulo}</span><div class="pf-linha-bts">
<label class="pf-bt mini">Escolher do celular<input type="file" accept="image/png,image/jpeg,image/webp" data-pf-cartaz-img="${k}" hidden></label>
${daLoja && atual !== daLoja ? `<button type="button" class="pf-bt mini" data-pf="cartaz-img-loja" data-img="${k}">Usar a da loja</button>` : ''}
${atual ? `<button type="button" class="pf-bt mini" data-pf="cartaz-img-tirar" data-img="${k}">Tirar</button>` : ''}</div></div></div>`;
};

/** [título, corpo, pé] da folha do editor. */
export function folhaCartaz(st, nomeLoja) {
    if (!st) return ['Cartaz', '<p class="pf-dica">Carregando os dados da loja…</p>', '<button type="button" class="pf-bt" data-pf="fechar-folha">Fechar</button>'];
    const c = conferir(st), link = linkDoCartaz(st.lojaId, st.fid);
    const opcoes = st.feiras.map((f) => `<option value="${escapeHTML(f.id)}"${f.id === st.fid ? ' selected' : ''}>${escapeHTML(f.nome)}</option>`).join('')
        + `<option value=""${st.fid ? '' : ' selected'}>Sem feira (só a loja)</option>`;
    const corpo = `
<section class="pf-sec"><label class="pf-rot" for="pf-cz-feira">Feira deste cartaz</label>
<div class="pf-form-linha"><select id="pf-cz-feira" data-pf-cartaz-feira>${opcoes}</select></div>
<small class="pf-dica" id="pf-cz-link">O QR e a fitinha abrem <b>${escapeHTML(st.loja.nome || nomeLoja)}</b>${st.fid ? ' já dentro da feira' : ''}: <code>${escapeHTML(linkCurto(link))}</code>. Grave a fitinha NFC com este mesmo endereço.</small>
<div class="pf-linha-bts"><button type="button" class="pf-bt mini" data-pf="cartaz-copiar-link">Copiar o endereço</button></div>
${st.feiras.length ? '' : '<small class="pf-dica">Esta loja ainda não está em nenhuma feira. Marque-a numa feira (aba Feiras) para ter um cartaz com o link da feira.</small>'}</section>
<section class="pf-sec">
${campo('local', 'Texto no topo (pílula)', st, 'maxlength="50" placeholder="Ex.: Feira Atenas (vazio: sem pílula)"')}
${campo('nome', 'Nome da loja', st, 'maxlength="60"')}
${campo('frase', 'Frase embaixo de "Peça pelo celular!"', st, 'maxlength="90"')}
${campo('legenda', 'Legenda da foto', st, 'maxlength="40"')}
</section>
<section class="pf-sec">
${campo('wpp', 'WhatsApp (vazio: não aparece)', st, 'inputmode="tel" maxlength="20" placeholder="61 99999-0000"')}
<small class="pf-dica pf-cz-aviso" id="pf-cz-aviso-wpp">${escapeHTML(c.avisoWpp)}</small>
${campo('insta', 'Instagram (vazio: não aparece)', st, 'maxlength="40" placeholder="@pastelmoecoe" autocapitalize="off"')}
<small class="pf-dica pf-cz-aviso" id="pf-cz-aviso-insta">${escapeHTML(c.avisoInsta)}</small>
</section>
<section class="pf-sec">${imagem('logo', 'Logo (no selo redondo)', st)}${imagem('foto', 'Foto (food truck, banca, produto)', st)}
<small class="pf-dica">A foto escolhida do celular vale só para este cartaz. Para trocar na loja, use Aparência no painel dela.</small></section>
<section class="pf-sec"><span class="pf-rot">Prévia</span><div class="pf-cz-previa" id="pf-cz-previa"><iframe title="Prévia do cartaz" sandbox="" tabindex="-1"></iframe></div>
${Object.keys(st.mexido).length ? '<div class="pf-linha-bts"><button type="button" class="pf-bt mini" data-pf="cartaz-padrao">Voltar os textos ao da loja</button></div>' : ''}</section>`;
    const pe = `<button type="button" class="pf-bt" data-pf="cartaz-voltar">Voltar</button><button type="button" class="pf-bt pri" data-pf="cartaz-imprimir">Imprimir ou salvar PDF</button>`;
    return [`Cartaz: ${st.loja.nome || nomeLoja}`, corpo, pe];
}

// ---- prévia (iframe sem script, reduzido para caber na largura da folha)
let tPrevia = 0;
export function pintarPrevia(st, imediato) {
    clearTimeout(tPrevia);
    const fazer = () => {
        const caixa = document.getElementById('pf-cz-previa'); if (!caixa || !st) return;
        const fr = caixa.querySelector('iframe'); if (!fr) return;
        const largura = caixa.clientWidth || 300;
        fr.style.transform = `scale(${largura / 794})`;
        fr.srcdoc = htmlDoCartaz(st);
    };
    if (imediato) fazer(); else tPrevia = setTimeout(fazer, 300);
}

/** Digitou num campo: guarda e atualiza só o que precisa (sem redesenhar a folha, o cursor não pula). */
export function digitou(st, k, valor) {
    if (!st || !TEXTOS.includes(k)) return;
    st[k] = String(valor || ''); st.mexido[k] = st[k] !== padroes(st)[k];
    if (!st.mexido[k]) delete st.mexido[k];
    guardar(st);
    const c = conferir(st);
    const aw = document.getElementById('pf-cz-aviso-wpp'), ai = document.getElementById('pf-cz-aviso-insta');
    if (aw) aw.textContent = c.avisoWpp; if (ai) ai.textContent = c.avisoInsta;
    pintarPrevia(st);
}
export function trocarFeira(st, fid) { if (!st) return; st.fid = st.feiras.some((f) => f.id === fid) ? fid : ''; aplicarFeira(st); }
export function voltarAoPadrao(st) { if (!st) return; try { localStorage.removeItem(CHAVE(st.lojaId, st.fid)); } catch (_) { /* tanto faz */ } aplicarFeira(st); }

/** Foto escolhida no celular → reduzida (o PDF não fica pesado) → data: que só vive nesta página. */
export async function lerImagem(arquivo, tipo) {
    if (!arquivo || !/^image\//.test(arquivo.type || 'image/')) throw new Error('Escolha uma foto (JPG, PNG ou WEBP).');
    if (arquivo.size > 25e6) throw new Error('Esta foto é grande demais. Escolha outra.');
    const max = tipo === 'logo' ? 700 : 1400;
    const url = URL.createObjectURL(arquivo);
    try {
        const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('Não consegui abrir esta foto. Tente outra (JPG ou PNG).')); i.src = url; });
        const esc = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.naturalWidth * esc)); cv.height = Math.max(1, Math.round(img.naturalHeight * esc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const dado = tipo === 'logo' && arquivo.type === 'image/png' ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.86);
        if (!imagemDoCartaz(dado)) throw new Error('Não consegui usar esta foto. Tente outra.');
        return dado;
    } finally { URL.revokeObjectURL(url); }
}
