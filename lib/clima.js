'use strict';
// =====================================================================
//  lib/clima.js — o tempo (chuva e temperatura) da cidade da loja.
//
//  Fonte: Open-Meteo (gratuito, sem chave). Uma chamada por loja por dia traz
//  os dias passados (até 92) e a previsão dos próximos 16. O que chega fica
//  guardado em analytics_config/clima = { cidade, lugar, lat, lon, dias: { 'AAAA-MM-DD': [mm de chuva, máxima °C] } }
//  (analytics_config não é apagado no "Começar do zero": o tempo que fez não muda).
//
//  A cidade vem de loja/config.cidade (Operacional) ou, na falta, da cidade da chave PIX.
//  Qualquer falha (sem internet, cidade não achada) devolve o que já estava guardado:
//  a previsão de vendas segue sem o clima, nunca quebra por causa dele.
// =====================================================================
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const TEMPO = 'https://api.open-meteo.com/v1/forecast';
const GUARDAR_DIAS = 900, ESPERA_MS = 6000;
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function buscarJson(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ESPERA_MS);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

/** Cidade que a loja informou (ou a da chave PIX). */
function cidadeDaLoja(cfg) {
  const c = String((cfg && cfg.cidade) || (cfg && cfg.pix && cfg.pix.cidade) || '').trim();
  return c.length >= 3 ? c.slice(0, 60) : '';
}

/** Resposta da busca de cidade → { lat, lon, lugar } (prefere o Brasil e o nome igual). */
function escolherLugar(resposta, cidade) {
  const lista = (resposta && Array.isArray(resposta.results) ? resposta.results : []).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  if (!lista.length) return null;
  const alvo = semAcento(cidade);
  const nota = (r) => (r.country_code === 'BR' ? 2 : 0) + (semAcento(r.name) === alvo ? 1 : 0);
  const m = lista.slice().sort((a, b) => nota(b) - nota(a) || (b.population || 0) - (a.population || 0))[0];
  return { lat: Math.round(m.latitude * 1000) / 1000, lon: Math.round(m.longitude * 1000) / 1000, lugar: [m.name, m.admin1].filter(Boolean).join(', ').slice(0, 80) };
}

/** Resposta do tempo → { 'AAAA-MM-DD': [chuva mm, máxima °C] } (ignora o que vier torto). */
function lerDias(resposta) {
  const d = resposta && resposta.daily, out = {};
  if (!d || !Array.isArray(d.time)) return out;
  d.time.forEach((dia, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia))) return;
    const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));          // Number(null) é 0: "sem dado" viraria "0 grau"
    const ch = num((d.precipitation_sum || [])[i]), tm = num((d.temperature_2m_max || [])[i]);
    if (!Number.isFinite(ch) && !Number.isFinite(tm)) return;
    out[dia] = [Number.isFinite(ch) ? Math.round(ch * 10) / 10 : null, Number.isFinite(tm) ? Math.round(tm * 10) / 10 : null];
  });
  return out;
}

/**
 * Atualiza e devolve o clima da loja. `db` já vem com o escopo da loja.
 * Devolve { cidade, lugar, dias, atualizado: true|false, motivo? }.
 */
async function atualizar(db, cfgLoja, agora = Date.now()) {
  const ref = db.doc('analytics_config/clima');
  let salvo = {};
  try { const s = await ref.get(); if (s.exists) salvo = s.data() || {}; } catch (_) { /* segue sem o guardado */ }
  const dias = { ...(salvo.dias || {}) };
  const cidade = cidadeDaLoja(cfgLoja);
  const base = { cidade, lugar: salvo.cidade === cidade ? salvo.lugar || '' : '', dias };
  if (!cidade) return { ...base, atualizado: false, motivo: 'sem cidade' };
  try {
    let { lat, lon, lugar } = salvo;
    if (salvo.cidade !== cidade || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      const achou = escolherLugar(await buscarJson(`${GEO}?name=${encodeURIComponent(cidade)}&count=10&language=pt&format=json`), cidade);
      if (!achou) return { ...base, dias: salvo.cidade === cidade ? dias : {}, atualizado: false, motivo: 'cidade não encontrada' };
      ({ lat, lon, lugar } = achou);
      if (salvo.cidade && salvo.cidade !== cidade) Object.keys(dias).forEach((k) => delete dias[k]);   // mudou de cidade: o tempo antigo não serve
    }
    const hoje = new Date(agora - 3 * 3600000).toISOString().slice(0, 10);
    const passado = Object.keys(dias).filter((k) => k < hoje).length >= 60 ? 7 : 92;                     // 1ª vez puxa 3 meses; depois, só a última semana
    const novos = lerDias(await buscarJson(`${TEMPO}?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,temperature_2m_max&timezone=America%2FSao_Paulo&past_days=${passado}&forecast_days=16`));
    if (!Object.keys(novos).length) return { ...base, lugar: lugar || '', atualizado: false, motivo: 'resposta vazia' };
    // previsão antiga de dias futuros é trocada pela nova; o passado fica
    Object.keys(dias).forEach((k) => { if (k >= hoje) delete dias[k]; });
    Object.assign(dias, novos);
    const corte = new Date(agora - GUARDAR_DIAS * 86400000).toISOString().slice(0, 10);
    Object.keys(dias).forEach((k) => { if (k < corte) delete dias[k]; });
    await ref.set({ cidade, lugar: lugar || '', lat, lon, dias, atualizadoEm: new Date(agora).toISOString() });
    return { cidade, lugar: lugar || '', dias, atualizado: true };
  } catch (e) {
    return { ...base, atualizado: false, motivo: String((e && e.message) || e).slice(0, 80) };
  }
}

module.exports = { atualizar, cidadeDaLoja, escolherLugar, lerDias };
