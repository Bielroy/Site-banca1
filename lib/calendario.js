'use strict';
// =====================================================================
//  lib/calendario.js — calendário operacional no SERVIDOR.
//  Mesmas regras de js/calendario-lib.js (os testes conferem as duas).
//
//  Usado para:
//   1) MOTOR DE DEMANDA: promoções, eventos, feriados locais e datas especiais
//      cadastrados viram "eventos" do motor (analytics/seasonality.js). O motor
//      só aplica um efeito depois de ver o MESMO nome acontecer 2 vezes.
//   2) COPILOTO: a agenda dos próximos dias entra no resumo da loja.
// =====================================================================
const TIPOS = ['compra', 'producao', 'feira', 'promocao', 'evento', 'feriado', 'especial'];
const TIPOS_DE_DEMANDA = ['promocao', 'evento', 'feriado', 'especial'];
const dt = (s) => new Date(`${s}T12:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const somar = (s, n) => { const d = dt(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const valida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(dt(s).getTime()) && iso(dt(s)) === s;

/** Entradas cadastradas entre duas datas, com as repetições abertas (sem os feriados nacionais). */
function ocorrencias(entradas, de, ate) {
  const out = [];
  for (const e of entradas || []) {
    if (!e || !valida(e.data) || !TIPOS.includes(e.tipo)) continue;
    const base = { tipo: e.tipo, titulo: String(e.titulo || '').slice(0, 60), repete: e.repete || '' };
    if (e.repete === 'semanal') {
      let d = e.data; if (d < de) d = somar(d, Math.ceil((dt(de) - dt(d)) / 86400000 / 7) * 7);
      for (; d <= ate; d = somar(d, 7)) out.push({ ...base, data: d });
    } else if (e.repete === 'anual') {
      for (let ano = Math.max(Number(e.data.slice(0, 4)), Number(de.slice(0, 4))); ano <= Number(ate.slice(0, 4)); ano++) {
        const d = `${ano}${e.data.slice(4)}`; if (valida(d) && d >= de && d <= ate) out.push({ ...base, data: d });
      }
    } else if (e.data >= de && e.data <= ate) out.push({ ...base, data: e.data });
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

/**
 * Eventos para o motor: [{ data, nome }]. Só os tipos que mexem na procura, com nome,
 * e nunca os semanais (o efeito do dia da semana o motor já aprende sozinho).
 */
function paraMotor(entradas, de, ate) {
  return ocorrencias((entradas || []).filter((e) => e && TIPOS_DE_DEMANDA.includes(e.tipo) && e.repete !== 'semanal' && String(e.titulo || '').trim()), de, ate)
    .map((o) => ({ data: o.data, nome: o.titulo.trim() }));
}

module.exports = { TIPOS, TIPOS_DE_DEMANDA, ocorrencias, paraMotor, somar };
