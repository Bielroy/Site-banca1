// =====================================================================
//  js/painel-ui.js — PEDAÇOS DE TELA DO PAINEL, iguais em todas as abas.
//
//  estadoVazio({ icone, titulo, texto, acao, compacto, erro })
//      Tela vazia: diz o que vai aparecer ali e qual é o próximo passo.
//      acao = { texto, atributos }  ->  <button class="btn btn-primary" atributos>texto</button>
//  esqueleto(rotulo, linhas)
//      Carregando: o desenho da lista aparece antes dos dados. O rótulo fica para
//      leitor de tela (e para quem procurar o texto), mas não aparece.
//  pilula(texto, tipo)   tipo: 'ok' | 'atencao' | 'erro' | 'aviso' | '' (neutro)
//
//  Estilos: css/painel-base.css. Ícones: os do painel (js/icones-admin.js), pelo nome.
// =====================================================================
import { escapeHTML } from './utils.js';

export function estadoVazio({ icone = 'vazio', titulo = '', texto = '', acao = null, compacto = false, erro = false } = {}) {
    const classes = ['pn-vazio', compacto && 'compacto', erro && 'erro'].filter(Boolean).join(' ');
    const botao = acao && acao.texto ? `<button type="button" class="btn btn-primary" ${acao.atributos || ''}>${escapeHTML(acao.texto)}</button>` : '';
    return `<div class="${classes}" role="status">`
        + `<span class="pn-vazio-ico" aria-hidden="true"><i class="ic" data-i="${escapeHTML(erro ? 'alerta' : icone)}"></i></span>`
        + (titulo ? `<b>${escapeHTML(titulo)}</b>` : '')
        + (texto ? `<p>${texto}</p>` : '')          // texto pode ter <b> (vem do próprio código, nunca do cliente)
        + botao + '</div>';
}

// larguras diferentes em cada linha, para parecer lista de verdade
const LARGURAS = [[62, 40], [48, 55], [70, 35], [54, 46], [66, 30], [44, 50]];
export function esqueleto(rotulo = 'Carregando...', linhas = 4) {
    const corpo = Array.from({ length: linhas }, (_, k) => {
        const [a, b] = LARGURAS[k % LARGURAS.length];
        return `<div class="pn-esq-linha" style="--l1:${a}%;--l2:${b}%"><i></i><span></span><em></em></div>`;
    }).join('');
    return `<div class="pn-esqueleto" role="status" aria-busy="true"><span class="pn-oculto">${escapeHTML(rotulo)}</span>${corpo}</div>`;
}

export const pilula = (texto, tipo = '') => `<span class="pn-pil${tipo ? ' ' + tipo : ''}">${escapeHTML(texto)}</span>`;

// Botão de tela vazia que leva a um campo (ex.: "Criar o primeiro cupom" -> campo do código).
if (typeof document !== 'undefined' && !window.__painelUiLigado) {
    window.__painelUiLigado = true;
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-pn-focar]'); if (!b) return;
        const alvo = document.getElementById(b.dataset.pnFocar); if (!alvo) return;
        alvo.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        alvo.focus({ preventScroll: true });
    });
}
