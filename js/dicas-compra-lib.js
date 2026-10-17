// =====================================================================
//  js/dicas-compra-lib.js — AVISOS da aba Compras (regras puras, testadas).
//
//  1. CLIMA: os próximos dias de loja aberta com chuva, calor ou frio previstos
//     e o que o motor já aprendeu que isso faz com as vendas da loja.
//     A sugestão de compra JÁ conta com o clima (o motor multiplica a previsão
//     pelo fator do dia); o aviso só explica por que a lista mudou.
//  2. ETILENO: frutas que soltam gás etileno (amadurece tudo em volta) e as folhas
//     e verduras que amarelam e murcham perto delas. Só aparece quando a loja
//     vende produtos dos DOIS grupos.
// =====================================================================

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaCurto = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${DIAS[d.getUTCDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };
const NOME = { chuva: 'chuva', calor: 'calor acima do normal', frio: 'frio fora do normal' };
const PLURAL = { chuva: 'Nos dias de chuva', calor: 'Nos dias de calor assim', frio: 'Nos dias mais frios' };

/** climaProximo = meta.climaProximo do motor: [{ dia, chuva, tmax, efeitos: [{ tipo, fator|null, n }] }]. Devolve frases. */
export function avisosDoClima(climaProximo) {
    const out = [];
    for (const d of Array.isArray(climaProximo) ? climaProximo : []) {
        const ef = (d && Array.isArray(d.efeitos) ? d.efeitos : []).filter((e) => NOME[e.tipo]);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.dia)) || !ef.length) continue;
        const oque = ef.map((e) => NOME[e.tipo] + (e.tipo === 'chuva' && Number(d.chuva) > 0 ? ` (${Math.round(d.chuva)} mm)` : '')).join(' e ');
        const efeito = ef.map((e) => {
            if (!(Number(e.fator) > 0)) return `${PLURAL[e.tipo]}, o sistema ainda está aprendendo quanto as vendas mudam.`;
            const pc = Math.round(Math.abs(e.fator - 1) * 100);
            return pc < 3 ? `${PLURAL[e.tipo]}, as vendas da loja quase não mudam.` : `${PLURAL[e.tipo]}, a loja vende uns ${pc}% a ${e.fator > 1 ? 'mais' : 'menos'}.`;
        }).join(' ');
        out.push({ dia: d.dia, texto: `${diaCurto(d.dia)}: previsão de ${oque}. ${efeito}`, aprendido: ef.some((e) => Number(e.fator) > 0) });
    }
    return out;
}

// ---------- etileno ----------
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// soltam MUITO etileno (amadurecem o que está perto)
const EMISSORES = ['banana', 'maca', 'tomate', 'abacate', 'mamao', 'manga', 'maracuja', 'pera', 'pessego', 'ameixa', 'kiwi', 'melao', 'goiaba', 'caqui', 'figo', 'nectarina'];
// estragam rápido perto do etileno (amarelam, murcham, brotam ou amargam)
const SENSIVEIS = ['alface', 'rucula', 'agriao', 'espinafre', 'couve', 'repolho', 'brocolis', 'acelga', 'almeirao', 'chicoria', 'salsa', 'salsinha', 'cebolinha', 'coentro', 'hortela', 'manjericao', 'cheiro verde', 'pepino', 'cenoura', 'abobrinha', 'berinjela', 'vagem', 'quiabo', 'batata', 'melancia'];
const casa = (nome, lista) => { const n = ` ${semAcento(nome).replace(/[^a-z0-9]+/g, ' ')} `; return lista.some((k) => new RegExp(` ${k}s? `).test(n)); };
const ehDoce = (nome) => / doce | geleia | suco | polpa | conserva | compota | desidratad| seca | molho /.test(` ${semAcento(nome).replace(/[^a-z0-9]+/g, ' ')} `);

/** produtos do catálogo → { emissores: [nomes], sensiveis: [nomes] } ou null quando não há os dois grupos. */
export function dicasEtileno(produtos) {
    const ativos = (Array.isArray(produtos) ? produtos : []).filter((p) => p && p.nome && p.ativo !== false && !ehDoce(p.nome));
    const emissores = [...new Set(ativos.filter((p) => casa(p.nome, EMISSORES)).map((p) => p.nome))];
    const sensiveis = [...new Set(ativos.filter((p) => casa(p.nome, SENSIVEIS) && !casa(p.nome, EMISSORES)).map((p) => p.nome))];
    return emissores.length && sensiveis.length ? { emissores, sensiveis } : null;
}
