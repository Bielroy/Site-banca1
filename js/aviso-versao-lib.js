// =====================================================================
//  js/aviso-versao-lib.js — O QUE O AVISO DE VERSÃO DO PAINEL DIZ (sem tela: os testes usam direto).
//
//  site    = /versao.json  { commit, em }      (o Cloudflare Pages grava no build: scripts/cloudflare-arquivos.js)
//  saude   = /api/saude    { versao, rotina }  (o servidor da AWS: lib/versao.js)
//  Devolve a lista de avisos (texto curto) ou [] quando está tudo certo ou não dá para saber.
// =====================================================================
export const FOLGA_MS = 20 * 60 * 1000;          // site recém-publicado: o servidor tem 20 min para acompanhar
export const ROTINA_VELHA_MS = 30 * 3600 * 1000;  // a rotina roda 1 vez por dia; mais de 30 h = parou

const hex = (v) => (typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v) ? v.toLowerCase() : '');
const dataBr = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '?'; };

export function avisosDeVersao(site, saude, agora = Date.now()) {
  const out = [];
  if (!saude || typeof saude !== 'object') return out;              // servidor fora do ar: o próprio painel já mostra erro
  const doSite = hex(site && site.commit), doServidor = hex(saude.versao);
  const publicadoHa = agora - Date.parse((site && site.em) || '');
  if (doSite && !(publicadoHa < FOLGA_MS)) {
    if (!doServidor) out.push('O servidor não informa a versão: ele está mais velho que o site. Atualize o servidor (RUNBOOK.md, "Atualizar o servidor").');
    else if (!doSite.startsWith(doServidor)) out.push(`Site e servidor em versões diferentes (site ${doSite.slice(0, 7)}, servidor ${doServidor.slice(0, 7)}). Atualize o servidor (RUNBOOK.md, "Atualizar o servidor").`);
  }
  if (doServidor) {                                                 // só servidor novo sabe da rotina
    const r = saude.rotina;
    if (!r || !r.em) out.push('A rotina da noite (cópia do dia, previsão) ainda não rodou por este servidor. Veja PUBLICAR.md, "Rotina da noite".');
    else if (r.ok === false) out.push(`A rotina da noite falhou na última vez (${dataBr(r.em)}, código ${Number(r.status) || '?'}).`);
    else if (agora - Date.parse(r.em) > ROTINA_VELHA_MS) out.push(`A rotina da noite não roda desde ${dataBr(r.em)}.`);
  }
  return out;
}
