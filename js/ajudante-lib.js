// =====================================================================
//  js/ajudante-lib.js — os TEXTOS do Ajudante na tela, por tipo de loja.
//
//  A página vem escrita para a Banca (hortifruti: "o que vamos cozinhar?").
//  Numa pastelaria o Ajudante se apresenta para ajudar a escolher e montar;
//  num espetinho, para calcular quanto pedir; e assim por diante.
//  O mapa GRUPOS é IGUAL ao de lib/ajudante.js (um teste confere): lá ficam
//  as instruções da IA, aqui o que o cliente lê.
//  Sem dependências além do desenho do tipo: loja e testes importam direto.
// =====================================================================
import { arteDoTipo } from './arte-lib.js';

export const GRUPOS = {
    caixote: 'horti', queijo: 'horti',
    pastel: 'montar', pastelacai: 'montar', tigela: 'montar', crepe: 'montar', burger: 'montar', hotdog: 'montar', pizza: 'montar',
    espeto: 'refeicao', prato: 'refeicao', macarrao: 'refeicao', pamonha: 'refeicao',
    pao: 'doce', bolo: 'doce', doce: 'doce',
    copo: 'bebida', cana: 'bebida',
};

// {nome} vira o nome da loja.
const TEXTOS = {
    horti: {
        sub: 'Receitas, dicas e o que levar para a mesa',
        saudacao: 'Oi, vizinho! Sou o ajudante da {nome}. Me conta o que você quer cozinhar hoje que eu separo os ingredientes fresquinhos.',
        campo: 'O que vamos cozinhar hoje?',
        dica: 'Quer uma ideia de receita com o que já está no pedido? Toque no Ajudante.',
        etiquetas: [['Vinagrete', 'O que preciso para fazer um vinagrete completo?'], ['Sobremesa', 'Ideia de sobremesa com frutas'], ['Almoço rápido', 'O que posso fazer de almoço rápido com legumes?']],
    },
    montar: {
        sub: 'Ajuda para escolher e montar o seu pedido',
        saudacao: 'Oi! Sou o ajudante da {nome}. Me conta do que você está com vontade que eu te ajudo a escolher e a montar o seu pedido.',
        campo: 'Do que você está com vontade?',
        dica: 'Quer ajuda para escolher ou montar o pedido? Toque no Ajudante.',
        etiquetas: [['Me ajuda a montar', 'Me ajuda a montar o meu pedido?'], ['Para 4 pessoas', 'Quanto devo pedir para 4 pessoas?'], ['Salgado e doce', 'Me sugere uma opção salgada e uma doce?']],
    },
    refeicao: {
        sub: 'Ajuda para escolher a refeição',
        saudacao: 'Oi! Sou o ajudante da {nome}. Me diz para quantas pessoas é que eu te ajudo a escolher e a acertar a quantidade.',
        campo: 'Para quantas pessoas é?',
        dica: 'Quer ajuda para acertar a quantidade? Toque no Ajudante.',
        etiquetas: [['Para 4 pessoas', 'Quanto devo pedir para 4 pessoas?'], ['Algo leve', 'Qual opção é mais leve?'], ['Com bebida', 'O que combina para beber com o meu pedido?']],
    },
    doce: {
        sub: 'Ajuda para escolher para o café, a festa ou um presente',
        saudacao: 'Oi! Sou o ajudante da {nome}. Me conta se é para o café, um lanche, uma festa ou um presente que eu te ajudo a escolher.',
        campo: 'É para o café, festa ou presente?',
        dica: 'Quer ajuda para escolher? Toque no Ajudante.',
        etiquetas: [['Café da manhã', 'O que você sugere para um café da manhã?'], ['Festa', 'Quanto levar para uma festa de 10 pessoas?'], ['Presente', 'O que fica bom para dar de presente?']],
    },
    bebida: {
        sub: 'Ajuda para escolher a bebida',
        saudacao: 'Oi! Sou o ajudante da {nome}. Me conta a ocasião que eu te ajudo a escolher.',
        campo: 'Qual é a ocasião?',
        dica: 'Quer ajuda para escolher? Toque no Ajudante.',
        etiquetas: [['Algo gelado', 'Qual opção é mais refrescante?'], ['Para 4 pessoas', 'Quanto devo pedir para 4 pessoas?']],
    },
    geral: {
        sub: 'Ajuda para achar e escolher os produtos',
        saudacao: 'Oi! Sou o ajudante da {nome}. Me conta o que você procura que eu te ajudo a achar.',
        campo: 'O que você procura?',
        dica: 'Quer ajuda para escolher? Toque no Ajudante.',
        etiquetas: [['Me ajuda a escolher', 'Me ajuda a escolher o que pedir?'], ['Para 4 pessoas', 'Quanto devo pedir para 4 pessoas?']],
    },
};

/** Grupo de atendimento pelo tipo da ficha. A loja original é sempre 'horti'. */
export const grupoDoTipo = (tipo, original = false) => (original ? 'horti' : (GRUPOS[arteDoTipo(tipo)] || 'geral'));

/** Os textos prontos (com o nome da loja) para a tela do Ajudante. */
export function textosDoAjudante(ficha, nome, original = false) {
    const t = TEXTOS[grupoDoTipo(ficha && ficha.tipo, original)];
    const n = String(nome || '').trim() || 'loja';
    return { ...t, saudacao: t.saudacao.replace('{nome}', n), titulo: original ? 'Ajudante da Banca' : 'Ajudante', subtitulo: original ? t.sub : `${n} · ${t.sub}` };
}

// A dica que aparece depois de um tempo parado com a sacola cheia (loja.js lê daqui).
let dicaAtual = TEXTOS.horti.dica;
export const dicaDoAjudante = () => dicaAtual;

/** Escreve os textos na tela do Ajudante (só texto: nada vira HTML). */
export function aplicarTextosDoAjudante(textos, doc = document) {
    if (!textos) return;
    dicaAtual = textos.dica;
    const por = (sel, v) => { const el = doc.querySelector(sel); if (el) el.textContent = v; };
    por('#ia-titulo', textos.titulo);
    por('#modal-ia-chat .ia-topo-sub', textos.subtitulo);
    const msg = doc.querySelector('#chat-ia-corpo .ia-msg--bot');
    if (msg) {
        const p = msg.querySelector('p'); if (p) p.textContent = textos.saudacao;
        const box = msg.querySelector('.ia-etiquetas');
        if (box) {
            box.textContent = '';
            for (const [rotulo, pergunta] of textos.etiquetas) {
                const b = doc.createElement('button');
                b.type = 'button'; b.className = 'ia-etiqueta'; b.dataset.prompt = pergunta; b.textContent = rotulo;
                box.appendChild(b);
            }
        }
    }
    const campo = doc.getElementById('input-ia-mensagem'); if (campo) campo.placeholder = textos.campo;
    const botao = doc.getElementById('btn-ia-flutuante');
    if (botao) { const fala = textos.titulo === 'Ajudante' ? `Falar com o Ajudante (${textos.subtitulo.split(' · ')[0]})` : `Falar com o ${textos.titulo}`; botao.setAttribute('aria-label', fala); botao.title = textos.titulo; }
}
