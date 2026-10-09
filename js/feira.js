// =====================================================================
//  js/feira.js — TELA DE ENTRADA DA FEIRA (feira.html, endereço /feira/id).
//
//  Quem abre este link passa a ser "da feira" (guardado no aparelho) e vai DIRETO
//  para uma banca da feira (a última que abriu nela, ou a primeira da lista). Lá dentro,
//  a faixa do topo mostra as bancas desta feira (e nunca as de outra feira).
//  Banca desligada na Plataforma não conta. Esta tela só aparece se der erro.
//  Lê só dados públicos (feiras/{id} e a ficha de cada banca). Sem login.
// =====================================================================
import './erros-site.js';   // primeiro: avisa o servidor se algo quebrar (aba Erros da Plataforma)
import { db, doc, getDoc } from './firebase.js';
import { urlDaLoja } from './tenant.js';
import { feiraDoEndereco, comFeira, diasDaFeira } from './plataforma-lib.js';
import { gravarFeiraCliente, lerUltimaBanca } from './feira-cliente.js';

const $ = (id) => document.getElementById(id);
const corOk = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '');
const idOk = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));

function aviso(texto) { $('fe-lista').textContent = ''; const a = $('fe-aviso'); a.textContent = texto; a.hidden = false; }

function cartao(fid, b) {
    const a = document.createElement('a');
    a.className = 'fe-banca'; a.href = comFeira(urlDaLoja(b.id), fid);
    const cor = document.createElement('span'); cor.className = 'fe-cor'; cor.setAttribute('aria-hidden', 'true');
    if (corOk(b.cor)) cor.style.background = b.cor;
    cor.textContent = (String(b.nome || '?').trim()[0] || '?').toUpperCase();
    const txt = document.createElement('span'); txt.className = 'fe-txt';
    const nome = document.createElement('b'); nome.textContent = b.nome;
    txt.appendChild(nome);
    if (b.subtitulo) { const sub = document.createElement('small'); sub.textContent = b.subtitulo; txt.appendChild(sub); }
    const seta = document.createElement('span'); seta.className = 'fe-seta'; seta.setAttribute('aria-hidden', 'true'); seta.textContent = '›';
    a.append(cor, txt, seta);
    return a;
}

function appDaFeira(fid, nome) {
    let m = document.querySelector('link[rel="manifest"]');
    if (!m) { m = document.createElement('link'); m.rel = 'manifest'; document.head.appendChild(m); }
    m.href = `/api/manifest?feira=${encodeURIComponent(fid)}`;
    const t = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (t) t.setAttribute('content', nome);
}

async function abrir() {
    const fid = feiraDoEndereco(location);
    if (!fid) return aviso('Este link de feira está incompleto. Peça o link de novo para quem te enviou.');
    $('fe-lista').innerHTML = '<div class="fe-esqueleto"></div><div class="fe-esqueleto"></div><div class="fe-esqueleto"></div>';
    let feira;
    try { const s = await getDoc(doc(db, 'feiras', fid)); feira = s.exists() ? s.data() : null; }
    catch (_) { return aviso('Não consegui abrir a feira agora. Confira a internet e tente de novo.'); }
    if (!feira) { $('fe-nome').textContent = 'Feira não encontrada'; return aviso('Esta feira não existe mais ou o link mudou. Peça o link novo para a sua banca.'); }

    gravarFeiraCliente(fid);
    const nome = String(feira.nome || 'Feira').slice(0, 60);
    $('fe-nome').textContent = nome; document.title = `${nome} | Escolha a sua banca`;
    $('fe-dias').textContent = diasDaFeira(feira.dias);
    appDaFeira(fid, nome);

    // cada banca: a ficha pública diz se está ligada, o nome e a cor atuais (sem a ficha, vale o que a feira guardou)
    const lojas = (Array.isArray(feira.lojas) ? feira.lojas : []).filter((l) => l && idOk(l.id)).slice(0, 12);
    const bancas = (await Promise.all(lojas.map(async (l) => {
        try {
            const f = await getDoc(doc(db, 'tenants', l.id)); const d = f.exists() ? f.data() : null;
            if (d && d.ativo === false) return null;
            return { id: l.id, nome: (d && d.nome) || l.nome || l.id, cor: (d && d.tema && d.tema.primaria) || l.cor, subtitulo: (d && d.subtitulo) || '' };
        } catch (_) { return { id: l.id, nome: l.nome || l.id, cor: l.cor, subtitulo: '' }; }
    }))).filter(Boolean);

    if (!bancas.length) return aviso('Nenhuma banca desta feira está atendendo pelo aplicativo agora.');
    // vai direto para a banca (a faixa do topo dela mostra as outras bancas da feira)
    const ultima = lerUltimaBanca(fid), destino = bancas.find((b) => b.id === ultima) || bancas[0];
    location.replace(comFeira(urlDaLoja(destino.id), fid));
    // se o navegador não sair daqui (raro), a lista fica de reserva
    setTimeout(() => { const lista = $('fe-lista'); lista.textContent = ''; bancas.forEach((b) => lista.appendChild(cartao(fid, b))); }, 3000);
}

abrir();
