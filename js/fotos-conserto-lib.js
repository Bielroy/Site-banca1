// =====================================================================
//  js/fotos-conserto-lib.js — conferência das fotos (puro: os testes importam direto).
//  Usado por js/admin-fotos-conserto.js. Ver lá a história da figura "imgbb.com service unavailable".
// =====================================================================
import { miniatura } from './foto-lib.js';
import { emFila } from './fotos-lib.js';

const https = (u) => /^https:\/\//i.test(String(u || ''));
// sempre pelo redutor do site (mesmo no computador de teste, onde a miniatura normal vai direto)
export const peloRedutor = (u, w) => miniatura(u, w, 'redutor');

/** Estado de uma foto: 'ok' | 'resgatada' (o ImgBB perdeu, mas há cópia guardada) | 'fora' (sumiu) | '?' (não deu para saber). */
export async function estadoDaFoto(url, buscar = fetch) {
    if (!https(url)) return '?';
    try {
        const r = await buscar(peloRedutor(url, 128), { cache: 'no-store' });
        try { await r.arrayBuffer(); } catch (_) { /* só o status interessa */ }
        if (r.status === 502) return 'fora';
        if (!r.ok) return '?';                                  // sem redutor (ou outro problema): não acusa à toa
        return /resgatada/i.test(r.headers.get('x-foto') || '') ? 'resgatada' : 'ok';
    } catch (_) { return '?'; }
}

/** Confere todos os produtos com foto. Devolve só os que têm alguma versão fora do ar (ou só resgatada). */
export async function conferir(produtos, aoAndar = () => {}, buscar = fetch) {
    const comFoto = produtos.filter((p) => https(p.foto) || https(p.fotoMini));
    const ruins = []; let feitos = 0;
    await emFila(comFoto, 4, async (p) => {
        const [foto, mini] = await Promise.all([https(p.foto) ? estadoDaFoto(p.foto, buscar) : '-', https(p.fotoMini) ? estadoDaFoto(p.fotoMini, buscar) : '-']);
        if ([foto, mini].some((e) => e === 'fora' || e === 'resgatada')) ruins.push({ p, foto, mini });
        aoAndar(++feitos, comFoto.length);
    });
    return ruins.sort((a, b) => String(a.p.nome).localeCompare(String(b.p.nome), 'pt-BR'));
}

/** De onde tirar a cópia boa: a versão que está ok (de preferência a grande); senão uma resgatada. '' = não há. */
export function melhorCopia({ p, foto, mini }) {
    if (foto === 'ok') return p.foto;
    if (mini === 'ok') return p.fotoMini;
    if (foto === 'resgatada') return p.foto;
    if (mini === 'resgatada') return p.fotoMini;
    return '';
}

