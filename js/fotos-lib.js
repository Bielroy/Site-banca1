// =====================================================================
//  js/fotos-lib.js — regras PURAS do envio de fotos (testadas em testes/index.js).
// =====================================================================
export const LIMITE_BYTES = 25 * 1024 * 1024;        // foto original maior que isso é recusada
const EXT_OK = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavras = (s) => semAcento(s).replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w) && !['img', 'foto', 'image', 'whatsapp', 'copia', 'final', 'de', 'da', 'do'].includes(w));

/** '' se o arquivo serve; senão, a frase do problema. */
export function validarArquivo({ name, type, size }) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    if (ext === 'heic' || ext === 'heif' || /hei[cf]/.test(type || '')) return 'Formato HEIC (iPhone) não abre no navegador. No iPhone, mude a câmera para "Mais compatível" ou envie como JPG.';
    if (!(String(type || '').startsWith('image/') || EXT_OK.includes(ext))) return 'Não é uma imagem. Envie JPG, PNG ou WebP.';
    if (!size) return 'Arquivo vazio ou corrompido.';
    if (size > LIMITE_BYTES) return 'Foto grande demais (limite de 25 MB).';
    return '';
}

/** Produto cujo nome mais parece com o nome do arquivo ("tomate-italiano.jpg" → Tomate italiano). null se nenhum parece. */
export function produtoParecido(nomeArquivo, produtos) {
    const pa = new Set(palavras(nomeArquivo)); if (!pa.size) return null;
    let melhor = null, nota = 0;
    for (const p of produtos) {
        const pp = palavras(p.nome); if (!pp.length) continue;
        const iguais = pp.filter((w) => pa.has(w)).length;
        const n = iguais / pp.length + iguais / pa.size;          // cobre o nome do produto e o nome do arquivo
        if (iguais && n > nota) { nota = n; melhor = p; }
    }
    return nota >= 1 ? melhor : null;
}

export const tamanhoBonito = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Tenta de novo quando falha (internet oscilando): espera 1 s, depois 3 s. */
export async function comTentativas(fn, tentativas = 3, espera = (i) => new Promise((r) => setTimeout(r, i === 0 ? 1000 : 3000))) {
    let ultimo;
    for (let i = 0; i < tentativas; i++) {
        try { return await fn(i); } catch (e) { ultimo = e; if (i < tentativas - 1) await espera(i); }
    }
    throw ultimo;
}

/** Roda tarefas com no máximo `limite` ao mesmo tempo. */
export async function emFila(itens, limite, tarefa) {
    let i = 0;
    const trabalhador = async () => { while (i < itens.length) { const meu = itens[i++]; await tarefa(meu); } };
    await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
}
