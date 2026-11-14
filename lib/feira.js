'use strict';
// =====================================================================
//  lib/feira.js — PARA QUANDO É O PEDIDO de um cliente da feira.
//
//  feiras/{id} = { nome, dias: [0..6], lojas: [{ id, dias? }], condominios, horaLimite: 'HH:MM', semFeira: ['AAAA-MM-DD'],
//                  datasExtras: ['AAAA-MM-DD'], hud: { texto, local, horario, capa, fotos } }
//   - datasExtras = "hoje tem feira" marcado à mão num dia que não é o da semana (feira especial);
//   - lojas[i].dias = dias da semana em que ESSA banca vem (vazio = todos os dias da feira);
//   - hud = o que a página de entrada da feira (feira.html) mostra.
//   - dia de feira e antes do horário limite → o pedido é para HOJE;
//   - depois do limite, em dia sem feira ou em data marcada "sem feira"
//     (chuva, feriado) → o pedido é para o PRÓXIMO dia de feira.
//  Tudo no horário de Brasília. A MESMA conta existe para a loja em
//  js/plataforma-lib.js (proximaEntrega); um teste confere que as duas batem.
// =====================================================================
const idValido = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));
const limparDias = (dias) => [...new Set((Array.isArray(dias) ? dias : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
const limparHora = (h) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(h || '').trim()); return m ? `${m[1]}:${m[2]}` : ''; };
const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const hojeBR = (agora = Date.now()) => new Date(agora - 3 * 3600000).toISOString().slice(0, 10);
/** Datas "sem feira": só datas válidas, de hoje em diante, sem repetir, no máximo 30. */
function limparDatas(lista, agora = Date.now()) {
  const hoje = hojeBR(agora);
  return [...new Set((Array.isArray(lista) ? lista : []).map((d) => String(d || '').trim()).filter((d) => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && d >= hoje))].sort().slice(0, 30);
}
/** { dia: 'AAAA-MM-DD', hoje: bool, dow } ou null (nenhuma data nas próximas 8 semanas). */
function proximaEntrega(feira, agora = Date.now()) {
  const f = feira || {}, dias = limparDias(f.dias), sem = new Set(Array.isArray(f.semFeira) ? f.semFeira : []), limite = limparHora(f.horaLimite), extras = new Set(Array.isArray(f.datasExtras) ? f.datasExtras : []);
  const br = new Date(agora - 3 * 3600000), hora = br.toISOString().slice(11, 16);
  for (let k = 0; k < 56; k++) {
    const d = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + k)), dia = d.toISOString().slice(0, 10), dow = d.getUTCDay();
    if (dias.length && !dias.includes(dow) && !extras.has(dia)) continue;
    if (sem.has(dia)) continue;
    if (k === 0 && limite && hora >= limite) continue;
    return { dia, hoje: k === 0, dow };
  }
  return null;
}
/** A feira acontece neste dia ('AAAA-MM-DD')? Dia da semana dela ou data extra, e não marcado "sem feira". */
function feiraNoDia(feira, dia) {
  const f = feira || {}, dias = limparDias(f.dias);
  if (!DATA.test(String(dia || '')) || (Array.isArray(f.semFeira) && f.semFeira.includes(dia))) return false;
  if (Array.isArray(f.datasExtras) && f.datasExtras.includes(dia)) return true;
  return !dias.length || dias.includes(new Date(`${dia}T12:00:00Z`).getUTCDay());
}
/** Dias da semana em que a banca vem a esta feira ([] = todos os dias da feira). */
function diasDaBanca(feira, lojaId) {
  const l = (Array.isArray(feira && feira.lojas) ? feira.lojas : []).find((x) => x && x.id === lojaId);
  const d = limparDias(l && l.dias), daFeira = limparDias(feira && feira.dias);
  return d.length ? (daFeira.length ? d.filter((n) => daFeira.includes(n)) : d) : [];
}
/** A banca vem à feira neste dia? Em data extra (feira especial) todas as bancas vêm. */
function bancaVemNoDia(feira, lojaId, dia) {
  if (!feiraNoDia(feira, dia)) return false;
  if (Array.isArray(feira.datasExtras) && feira.datasExtras.includes(dia)) return true;
  const d = diasDaBanca(feira, lojaId);
  return !d.length || d.includes(new Date(`${dia}T12:00:00Z`).getUTCDay());
}
/** A feira como ESTA banca a vê: os dias viram os dias em que a banca vem (o resto fica igual). */
function visaoDaBanca(feira, lojaId) {
  const d = diasDaBanca(feira, lojaId);
  return d.length ? { ...feira, dias: d } : feira;
}
// PÁGINA DE ENTRADA DA FEIRA (HUD). Só texto limpo e endereços https de imagem.
const textoLimpo = (v, max) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const urlFoto = (u) => { const t = String(u || '').trim(); return /^https:\/\/[^\s"'<>\\]{4,400}$/.test(t) ? t : ''; };
function limparHud(h) {
  const x = h && typeof h === 'object' ? h : {};
  const fotos = [...new Set((Array.isArray(x.fotos) ? x.fotos : []).map(urlFoto).filter(Boolean))].slice(0, 6);
  return { texto: textoLimpo(x.texto, 400), local: textoLimpo(x.local, 80), horario: textoLimpo(x.horario, 60), capa: urlFoto(x.capa), fotos };
}
const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "terça, 14/10" */
const textoDoDia = (dia) => { const d = new Date(`${dia}T12:00:00Z`); return Number.isNaN(d.getTime()) ? '' : `${NOMES[d.getUTCDay()]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`; };

/** A feira que o cliente mandou, SE esta loja estiver nela. Senão null (o pedido segue como sempre foi). */
async function daLoja(db, tid, fid) {
  if (!idValido(fid)) return null;
  try {
    const s = await db.collection('feiras').doc(fid).get();
    if (!s.exists) return null;
    const f = s.data() || {};
    // a banca enxerga a feira com os dias DELA (banca que só vem aos sábados não recebe pedido para quarta)
    if (!(Array.isArray(f.lojas) ? f.lojas : []).some((l) => l && l.id === tid)) return null;
    // foraHoje: a feira acontece hoje, mas ESTA banca não veio. A loja abre só para olhar e o servidor não fecha pedido.
    const hoje = hojeBR(), inteira = { id: fid, ...f };
    return { ...visaoDaBanca(inteira, tid), foraHoje: feiraNoDia(inteira, hoje) && !bancaVemNoDia(inteira, tid, hoje) };
  } catch (_) { return null; }
}

// PREÇO POR DIA DA SEMANA (mesma conta de js/oferta-lib.js → precoDoDia). produto.precosDia = { "3": 8.5 }.
// O dia é o da ENTREGA. Oferta ligada (precoDe maior que preco) vence em todos os dias.
function precoDoDia(p, dia) {
  const base = Number(p && p.preco);
  const emOferta = !!p && base > 0 && Number(p.precoDe) > base;
  if (!p || emOferta || !Number.isInteger(dia) || dia < 0 || dia > 6 || !p.precosDia || typeof p.precosDia !== 'object') return base;
  const v = Math.round(Number(p.precosDia[dia]) * 100) / 100;
  return Number.isFinite(v) && v > 0 && v < 100000 ? v : base;
}

module.exports = { precoDoDia, idValido, limparDias, limparHora, limparDatas, hojeBR, proximaEntrega, textoDoDia, daLoja, feiraNoDia, diasDaBanca, bancaVemNoDia, visaoDaBanca, limparHud };
