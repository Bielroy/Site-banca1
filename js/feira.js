// =====================================================================
//  js/feira.js — PÁGINA DE ENTRADA DA FEIRA (feira.html, endereço /feira/id).
//
//  É o link que vai para o grupo do condomínio. Quem abre:
//    • passa a ser "da feira" (guardado no aparelho);
//    • vê a capa da feira, se TEM FEIRA HOJE (ou quando é a próxima), como funciona
//      e as bancas. As que vêm hoje aparecem com cor; as que não vêm ficam apagadas
//      e abrem só para olhar (a loja não deixa fechar pedido: js/loja.js);
//    • toca numa banca e cai na loja dela, com a faixa das outras bancas no topo.
//  O cartaz de UMA banca (/feira/id?loja=banca) continua indo direto para ela,
//  sem passar por aqui. O link da própria loja (/?loja=...) nunca passa por aqui.
//
//  "Tem feira hoje" sai sozinho dos dias da feira; a Plataforma pode marcar um dia
//  extra ("hoje tem feira") ou um dia sem feira (chuva, feriado). Regras em
//  js/plataforma-lib.js, as mesmas do servidor (lib/feira.js).
//  Lê só dados públicos (feiras/{id} e a ficha de cada banca). Sem login.
// =====================================================================
import './erros-site.js';   // primeiro: avisa o servidor se algo quebrar (aba Erros da Plataforma)
import { db, doc, getDoc } from './firebase.js';
import { urlDaLoja } from './tenant.js';
import { feiraDoEndereco, comFeira, diasDaFeira, proximaEntrega, textoDoDia, hojeDaFeira, feiraNoDia, bancaVemNoDia, visaoDaBanca, limparHora } from './plataforma-lib.js';
import { gravarFeiraCliente, lerUltimaBanca } from './feira-cliente.js';
import { urlImagem } from './aparencia-lib.js';

const $ = (id) => document.getElementById(id);
const corOk = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '');
const idOk = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));
const limpo = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const mostrar = (id, texto) => { const el = $(id); if (!el) return; el.textContent = texto || ''; el.hidden = !texto; };

function aviso(texto) { $('fe-lista').textContent = ''; mostrar('fe-aviso', texto); }

// foto que não abriu some (e a capa da banca volta a ser a cor com a inicial)
const imagem = (src, alt = '') => { const img = document.createElement('img'); img.src = src; img.alt = alt; img.loading = 'lazy'; img.decoding = 'async'; img.addEventListener('error', () => img.remove()); return img; };

/** Um cartão de banca. `chip` = { texto, classe }. */
function cartao(fid, b, chip) {
    const a = document.createElement('a');
    a.className = 'fe-banca'; a.href = comFeira(urlDaLoja(b.id), fid);
    const capa = document.createElement('span'); capa.className = 'fe-banca-capa';
    if (corOk(b.cor)) capa.style.background = b.cor;
    const letra = document.createElement('span'); letra.className = 'fe-letra'; letra.setAttribute('aria-hidden', 'true');
    letra.textContent = (String(b.nome || '?').trim()[0] || '?').toUpperCase();
    capa.appendChild(letra);
    if (b.capa) capa.appendChild(imagem(b.capa));
    a.appendChild(capa);
    const txt = document.createElement('span'); txt.className = 'fe-txt';
    if (b.logo) {
        const logo = document.createElement('span'); logo.className = 'fe-banca-logo'; logo.appendChild(imagem(b.logo)); capa.style.overflow = 'visible';
        capa.appendChild(logo); a.classList.add('com-logo');
    }
    const nome = document.createElement('b'); nome.textContent = b.nome; txt.appendChild(nome);
    if (b.subtitulo) { const sub = document.createElement('small'); sub.textContent = b.subtitulo; txt.appendChild(sub); }
    if (chip && chip.texto) { const c = document.createElement('em'); c.className = `fe-chip${chip.classe ? ` ${chip.classe}` : ''}`; c.textContent = chip.texto; txt.appendChild(c); }
    a.appendChild(txt);
    return a;
}

function appDaFeira(fid, nome) {
    let m = document.querySelector('link[rel="manifest"]');
    if (!m) { m = document.createElement('link'); m.rel = 'manifest'; document.head.appendChild(m); }
    m.href = `/api/manifest?feira=${encodeURIComponent(fid)}`;
    const t = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (t) t.setAttribute('content', nome);
}

// A capa: a foto que a Plataforma escolheu ou, sem ela, a foto de capa da primeira banca que tiver uma.
function pintarCapa(hud, bancas) {
    const src = urlImagem(hud.capa) || (bancas.find((b) => b.capa) || {}).capa || '';
    const img = $('fe-capa'), hero = $('fe-hero');
    if (!src) { img.hidden = true; hero.classList.remove('com-foto'); return; }
    img.addEventListener('error', () => { img.hidden = true; hero.classList.remove('com-foto'); }, { once: true });
    img.src = src; img.hidden = false; hero.classList.add('com-foto');
}

// "Hoje tem feira" / "Próxima feira: sábado, 15/11" e a observação sobre o horário limite
function pintarQuando(feira, hud, agora) {
    const hoje = hojeDaFeira(agora), temHoje = feiraNoDia(feira, hoje), prox = proximaEntrega(feira, agora);
    const st = $('fe-status'); st.hidden = false; st.classList.toggle('hoje', temHoje);
    const horario = limpo(hud.horario, 60);
    st.textContent = temHoje ? `Hoje tem feira${horario ? ` · ${horario}` : ''}` : prox ? `Próxima feira: ${textoDoDia(prox.dia)}` : 'Sem data marcada por enquanto';
    const local = limpo(hud.local, 80), dias = Array.isArray(feira.dias) && feira.dias.length ? diasDaFeira(feira.dias) : '';
    mostrar('fe-local', [local, !temHoje && horario ? horario : '', dias].filter(Boolean).join(' · '));
    const limite = limparHora(feira.horaLimite);
    let nota = '';
    if (temHoje && prox && !prox.hoje) nota = `Os pedidos para hoje fecharam${limite ? ` às ${limite}` : ''}. O que você pedir agora fica para ${textoDoDia(prox.dia)}.`;
    else if (temHoje && limite) nota = `Para receber hoje, peça até as ${limite}.`;
    else if (!temHoje && prox) nota = `Você já pode deixar o seu pedido feito para ${textoDoDia(prox.dia)}.`;
    mostrar('fe-nota', nota);
    return { hoje, temHoje, prox };
}

function pintarFotos(hud) {
    const fotos = (Array.isArray(hud.fotos) ? hud.fotos : []).map(urlImagem).filter(Boolean).slice(0, 6), alvo = $('fe-fotos');
    alvo.textContent = ''; alvo.hidden = !fotos.length;
    fotos.forEach((src) => alvo.appendChild(imagem(src, 'Foto da feira')));
}

async function abrir() {
    const fid = feiraDoEndereco(location);
    if (!fid) return aviso('Este link de feira está incompleto. Peça o link de novo para quem te enviou.');
    $('fe-lista').innerHTML = '<div class="fe-esqueleto"></div><div class="fe-esqueleto"></div>';
    let feira;
    try { const s = await getDoc(doc(db, 'feiras', fid)); feira = s.exists() ? s.data() : null; }
    catch (_) { return aviso('Não consegui abrir a feira agora. Confira a internet e tente de novo.'); }
    if (!feira) { $('fe-nome').textContent = 'Feira não encontrada'; return aviso('Esta feira não existe mais ou o link mudou. Peça o link novo para a sua banca.'); }

    gravarFeiraCliente(fid);
    const nome = String(feira.nome || 'Feira').slice(0, 60), hud = feira.hud && typeof feira.hud === 'object' ? feira.hud : {};
    $('fe-nome').textContent = nome; document.title = `${nome} | As bancas da sua feira`;
    appDaFeira(fid, nome);
    const agora = Date.now(), { hoje, temHoje } = pintarQuando(feira, hud, agora);
    $('fe-como').hidden = false; mostrar('fe-texto', limpo(hud.texto, 400));
    pintarFotos(hud);

    // cada banca: a ficha pública diz se está ligada, o nome, a cor, a logo e a foto de capa atuais (sem a ficha, vale o que a feira guardou)
    const lojas = (Array.isArray(feira.lojas) ? feira.lojas : []).filter((l) => l && idOk(l.id)).slice(0, 12);
    const bancas = (await Promise.all(lojas.map(async (l) => {
        try {
            const f = await getDoc(doc(db, 'tenants', l.id)); const d = f.exists() ? f.data() : null;
            if (d && d.ativo === false) return null;
            const tema = (d && d.tema) || {};
            return { id: l.id, nome: (d && d.nome) || l.nome || l.id, cor: tema.primaria || l.cor, subtitulo: (d && d.subtitulo) || '', logo: urlImagem(tema.logo), capa: urlImagem(tema.capa) };
        } catch (_) { return { id: l.id, nome: l.nome || l.id, cor: l.cor, subtitulo: '', logo: '', capa: '' }; }
    }))).filter(Boolean);

    if (!bancas.length) return aviso('Nenhuma banca desta feira está atendendo pelo aplicativo agora.');

    // o cartaz de UMA banca manda direto para ela (/feira/id?loja=banca), sem passar pela página da feira
    let pedida = ''; try { pedida = new URLSearchParams(location.search).get('loja') || ''; } catch (_) { /* endereço estranho */ }
    const doCartaz = bancas.find((b) => b.id === pedida);
    if (doCartaz) { location.replace(comFeira(urlDaLoja(doCartaz.id), fid)); return; }

    pintarCapa(hud, bancas);
    const ultima = lerUltimaBanca(fid);
    const vem = temHoje ? bancas.filter((b) => bancaVemNoDia(feira, b.id, hoje)) : bancas;
    const fora = temHoje ? bancas.filter((b) => !bancaVemNoDia(feira, b.id, hoje)) : [];
    const lista = $('fe-lista'); lista.textContent = '';
    // atalho da capa para as bancas; quem já comprou aqui vê as bancas ANTES do "como funciona" (já sabe como é)
    const ir = $('fe-ir'); ir.textContent = temHoje ? (vem.length === 1 ? 'Ver a banca de hoje' : `Ver as ${vem.length} bancas de hoje`) : 'Ver as bancas'; ir.hidden = !vem.length && !fora.length;
    if (ultima) { const como = $('fe-como'); como.before($('fe-bancas'), $('fe-fora')); }
    $('fe-tit-hoje').textContent = temHoje ? 'Bancas de hoje' : 'Bancas da feira';
    mostrar('fe-dica-hoje', temHoje ? (vem.length ? 'Toque numa banca para ver os produtos e pedir.' : 'Nenhuma banca confirmou presença hoje.') : 'Toque numa banca para ver os produtos.');
    vem.forEach((b) => {
        // cada banca tem os dias dela: fora do dia de feira, o cartão diz para quando fica o pedido
        const dela = proximaEntrega(visaoDaBanca(feira, b.id), agora);
        const chip = b.id === ultima ? { texto: 'Você esteve aqui', classe: 'ultima' } : temHoje ? { texto: 'Hoje na feira' } : dela ? { texto: `Pedidos para ${textoDoDia(dela.dia).split(',')[0]}`, classe: 'depois' } : null;
        lista.appendChild(cartao(fid, b, chip));
    });
    const listaFora = $('fe-lista-fora'); listaFora.textContent = ''; $('fe-fora').hidden = !fora.length;
    fora.forEach((b) => {
        const volta = proximaEntrega(visaoDaBanca(feira, b.id), agora);
        listaFora.appendChild(cartao(fid, b, { texto: volta ? `Volta ${textoDoDia(volta.dia).split(',')[0]}` : 'Não vem hoje' }));
    });
}

abrir();
