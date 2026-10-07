// =====================================================================
//  js/aparencia-lib.js — o TEMA de uma loja, conferido antes de usar.
//
//  A aparência fica na ficha pública da loja e é escrita por quem administra
//  aquela loja. Quem abre a tela de Aparência pode ser OUTRA pessoa (o outro
//  administrador, o dono da plataforma). Por isso nada do que está gravado
//  vai para a tela sem conferir: cor só no formato #rrggbb, fonte e formato
//  só os da lista, número só número. O que não passar volta ao padrão.
//  Arquivo puro (sem navegador), para os testes poderem conferir.
// =====================================================================
const COR = /^#[0-9a-fA-F]{6}$/;
export const corValida = (v) => typeof v === 'string' && COR.test(v);

/**
 * Devolve um tema só com campos conhecidos e valores válidos.
 * cfg = { padrao, cores: ['primaria', ...], fontesTitulo: {...}, fontesTexto: {...}, formatos: {...} }
 */
export function temaSeguro(bruto, cfg) {
    const t = bruto && typeof bruto === 'object' ? bruto : {}, saida = { ...cfg.padrao };
    for (const k of cfg.cores) if (corValida(t[k])) saida[k] = t[k];
    if (typeof t.fonteTitulo === 'string' && Object.prototype.hasOwnProperty.call(cfg.fontesTitulo, t.fonteTitulo)) saida.fonteTitulo = t.fonteTitulo;
    if (typeof t.fonteTexto === 'string' && Object.prototype.hasOwnProperty.call(cfg.fontesTexto, t.fonteTexto)) saida.fonteTexto = t.fonteTexto;
    const raio = Number(t.raio);
    if (t.raio !== null && t.raio !== '' && Number.isFinite(raio) && raio >= 0 && raio <= 24) saida.raio = Math.round(raio);
    if (t.etiqueta === 'limpa' || t.etiqueta === 'barbante') saida.etiqueta = t.etiqueta;
    if (typeof t.fotoFormato === 'string' && Object.prototype.hasOwnProperty.call(cfg.formatos, t.fotoFormato)) saida.fotoFormato = t.fotoFormato;
    if (t.fotoEncaixe === 'inteira' || t.fotoEncaixe === 'preencher') saida.fotoEncaixe = t.fotoEncaixe;
    for (const k of Object.keys(saida)) if (saida[k] === undefined) delete saida[k];     // o banco recusa campo "indefinido"
    return saida;
}

/** Número para pôr dentro de um campo de formulário: só número mesmo; qualquer outra coisa vira vazio. */
export function numeroDeCampo(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'object' || typeof v === 'boolean') return '';
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : '';
}
