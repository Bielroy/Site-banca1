'use strict';
// =====================================================================
//  lib/frete.js — FRETE FORA DO DIA DA FEIRA ("Hoje não tem feira no seu condomínio: receber hoje pagando o frete").
//
//  Quem calcula é SEMPRE o servidor. A configuração fica em {loja}/loja/frete (só a equipe lê: o ponto de saída
//  pode ser a casa do dono, então NÃO vai para a configuração pública da loja):
//    { ligado, origem: { lat, lng }, base, porKm, porKg, kgLivre, margem, minimo, raioKm, juntarKm }
//  O destino é o ponto do condomínio do cliente (cadastro da plataforma, lib/condominios.js; a feira guarda a cópia).
//
//  CONTA (tudo em reais):
//    km        = distância em linha reta × 1,3 (as ruas não são retas)
//    viagem    = base + porKm × km da rota (a rota vai até o mais longe do grupo)
//    ROTA JUNTA: pedidos de hoje com frete a até `juntarKm` deste condomínio vão na mesma viagem.
//                Cada um paga a parte da viagem proporcional à própria distância (quem mora mais longe paga mais).
//                Quem pediu primeiro pagou cheio: o preço fica fechado no pedido (não muda depois).
//    peso      = porKg × (quilos − kgLivre), se passar
//    margem    = + margem% (padrão 5%: o tempo de quem entrega)
//    final     = no mínimo `minimo`, arredondado para cima de 50 em 50 centavos
//  Os pedidos de frete do dia ficam em {loja}/fretes/{AAAA-MM-DD} (só o servidor lê e grava): { pedidos: { id: { lat, lng, km } } }.
// =====================================================================
const FATOR_RUAS = 1.3;
const num = (v, min, max, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const ponto = (p) => { const lat = Number(p && p.lat), lng = Number(p && p.lng); return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null; };

function lerConfig(d) {
  const c = d || {};
  return {
    ligado: c.ligado === true, origem: ponto(c.origem),
    base: num(c.base, 0, 500), porKm: num(c.porKm, 0, 50), porKg: num(c.porKg, 0, 50), kgLivre: num(c.kgLivre, 0, 200, 5),
    margem: num(c.margem, 0, 100, 5), minimo: num(c.minimo, 0, 500), raioKm: num(c.raioKm, 0, 200, 15), juntarKm: num(c.juntarKm, 0, 20, 2),
    diasSemFrete: (Array.isArray(c.diasSemFrete) ? c.diasSemFrete : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  };
}
/** A configuração para UM dia da semana (0 = domingo … 6 = sábado, horário de Brasília): nos dias marcados
 *  como "não entrego com frete", o frete fica desligado naquele dia, mesmo com o frete ligado. */
function paraDia(cfg, dow) {
  if (!cfg) return cfg;
  return { ...cfg, ligado: cfg.ligado === true && !(cfg.diasSemFrete || []).includes(dow) };
}
/** Distância de rua estimada, em km (haversine × 1,3). */
function kmEntre(a, b) {
  const R = 6371, rad = (g) => (g * Math.PI) / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * FATOR_RUAS;
}
/** Quilos do pedido (estimativa para o frete): item pedido em kg conta o peso; produto de quilo pedido por UNIDADE
 *  ("3 tomates", a pesar) conta 250 g cada; item de unidade (ovo, pastel) não pesa na conta. */
const KG_POR_UNIDADE = 0.25;
function quilos(itens) {
  return (Array.isArray(itens) ? itens : []).reduce((s, i) => {
    const u = String(i && i.unidade || '').toLowerCase(), q = Number(i && i.qtd) || 0;
    if (u !== 'kg' && u !== 'g') return s;
    if (i.tipo === 'un' || i.aPesar) return s + q * KG_POR_UNIDADE;
    return s + (u === 'kg' ? q : q / 1000);
  }, 0);
}
const meioReal = (v) => Math.ceil(v * 2 - 1e-9) / 2;

/**
 * Preço do frete. destino = ponto do condomínio · vizinhos = pedidos de frete de hoje ({ lat, lng, km }).
 * → { ok: true, valor, km, rota (quantos na viagem), parte (0..1) } ou { ok: false, motivo: 'desligado'|'sem-origem'|'sem-destino'|'longe' }
 */
function cotar(cfg, destino, kg = 0, vizinhos = []) {
  if (!cfg || !cfg.ligado) return { ok: false, motivo: 'desligado' };
  if (!cfg.origem) return { ok: false, motivo: 'sem-origem' };
  const d = ponto(destino); if (!d) return { ok: false, motivo: 'sem-destino' };
  const km = kmEntre(cfg.origem, d);
  if (cfg.raioKm > 0 && km > cfg.raioKm) return { ok: false, motivo: 'longe', km: Math.round(km * 10) / 10 };
  const grupo = (Array.isArray(vizinhos) ? vizinhos : []).map((v) => ({ ...ponto(v), km: Number(v && v.km) })).filter((v) => v.lat !== undefined && Number.isFinite(v.km) && kmEntre(v, d) <= cfg.juntarKm);
  const kmRota = Math.max(km, ...grupo.map((v) => v.km));
  const viagem = cfg.base + cfg.porKm * kmRota;
  const parte = grupo.length ? km / (km + grupo.reduce((s, v) => s + v.km, 0)) : 1;
  const peso = cfg.porKg * Math.max(0, (Number(kg) || 0) - cfg.kgLivre);
  const valor = meioReal(Math.max(cfg.minimo, (viagem * parte + peso) * (1 + cfg.margem / 100)));
  return { ok: true, valor, km: Math.round(km * 10) / 10, rota: grupo.length + 1, parte: Math.round(parte * 100) / 100 };
}
/** O condomínio do pedido na feira (cópia que a feira guarda, com o ponto). */
const normCond = (c) => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function condominioNaFeira(feira, nome) {
  const k = normCond(nome); if (!k) return null;
  return (Array.isArray(feira && feira.conds) ? feira.conds : []).find((c) => c && [c.nome, ...(c.apelidos || [])].some((n) => normCond(n) === k)) || null;
}
const MOTIVOS = {
  desligado: 'Hoje não tem feira no seu condomínio e a banca não está fazendo entrega fora do dia da feira.',
  'sem-origem': 'Hoje não tem feira no seu condomínio e a banca ainda não configurou o frete.',
  'sem-destino': 'Ainda não dá para calcular o frete até o seu condomínio. Seu pedido pode ir para o dia da feira.',
  longe: 'Seu condomínio fica longe demais para a entrega de hoje. Seu pedido pode ir para o dia da feira.',
};
module.exports = { FATOR_RUAS, lerConfig, paraDia, kmEntre, quilos, cotar, condominioNaFeira, MOTIVOS, ponto };
