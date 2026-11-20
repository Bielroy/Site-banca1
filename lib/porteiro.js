'use strict';
// =====================================================================
//  lib/porteiro.js — O PORTEIRO DA ENTRADA NO PAINEL (captcha próprio, sem Google nem Cloudflare).
//
//  Junta várias barreiras pequenas, que se somam:
//   1. PONTUAÇÃO DE RISCO: cada pedido ganha pontos pelos sinais (muitas tentativas da mesma conexão, o mesmo
//      e-mail pedido de vários lugares, enxurrada geral, conexão de fora do Brasil, aparelho desconhecido).
//      Poucos pontos: passa quase sem esforço. Médio: desafio mais pesado. Muitos: barrado, e o dono é avisado.
//   2. APARELHO CONHECIDO: quem já entrou no painel neste aparelho (lib/aparelhos.js) ganha desconto;
//      aparelho que o proprietário desconectou é barrado.
//   3. ISCA E TEMPO MÍNIMO: campo escondido que gente não vê (robô preenche) e pedido que chega rápido demais
//      depois de a página abrir (ninguém digita o e-mail e envia em 1 segundo).
//   4. DESAFIO PRESO AO PEDIDO: "prova de trabalho". O navegador procura um número que, junto com o desafio e
//      o e-mail, dá um resumo SHA-256 começando com N bits zero. Leva ~1 s num celular; para um robô que tenta
//      milhares de vezes, o custo soma. O desafio é assinado aqui (HMAC), vale 10 min, só para a conexão que
//      pediu, só para aquele e-mail e uma vez só (api grava o usado).
//   5. FREIO GLOBAL: o mesmo e-mail atacado de muitas conexões, ou enxurrada de pedidos no geral, esquenta a
//      pontuação de todo mundo que não tem aparelho conhecido, e acima do teto barra e avisa.
//
//  O que ele NÃO faz (de propósito, para não prometer o impossível): não barra uma pessoa de verdade resolvendo
//  o desafio, nem um robô paciente com muitas conexões. Isso fica com: só e-mail da equipe recebe link, aviso de
//  aparelho novo, aprovação do dono (lib/aprovacao.js) e o Face ID.
//  Os contadores ficam na memória do servidor (um contêiner só): reiniciar zera, e os limites do banco
//  (lib/prudencia.limitar) continuam valendo por baixo.
// =====================================================================
const crypto = require('crypto');

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest();
const hex = (s) => sha(s).toString('hex');
const curto = (s) => hex(`porteiro|${String(s || '')}`).slice(0, 20);

const VALIDADE_MS = 10 * 60000;
const TEMPO_MIN_MS = 1500;               // desafio pedido e resposta mandada em menos que isso = robô
const DIFICULDADES = [12, 15, 17, 19];   // bits zero exigidos (12 ≈ instante; 19 ≈ 2 a 4 s num celular)
const BLOQUEAR_EM = 8;                   // pontos a partir dos quais o pedido é recusado

const segredoPadrao = () => String(process.env.PORTEIRO_SEGREDO || process.env.PASSKEY_SEGREDO || process.env.FIREBASE_PRIVATE_KEY || '');
const chaveHmac = (segredo) => sha(`porteiro-hmac|${segredo || ''}`);

// ---------------------------------------------------------------- contadores na memória
const marcas = new Map();     // chave → [instantes]
function marcar(chave, agora = Date.now()) {
  if (marcas.size > 20000) for (const [k, v] of marcas) if (!v.length || agora - v[v.length - 1] > 3600000) marcas.delete(k);
  const v = marcas.get(chave) || [];
  v.push(agora); if (v.length > 400) v.splice(0, v.length - 400);
  marcas.set(chave, v);
}
const contar = (chave, janelaMs, agora = Date.now()) => (marcas.get(chave) || []).filter((t) => agora - t < janelaMs).length;

/** Anota uma tentativa (de uma ação) para a pontuação: por conexão, por alvo (e-mail) e no geral. */
function anotar(acao, { ip, alvo } = {}, agora = Date.now()) {
  marcar(`${acao}|geral`, agora);
  if (ip) marcar(`${acao}|ip|${ip}`, agora);
  if (alvo) marcar(`${acao}|alvo|${curto(alvo)}`, agora);
}

/**
 * Pontuação de risco. aparelho = { conhecido, bloqueado } (lib/aparelhos), pais = 'BR' etc. (do Cloudflare).
 * Devolve { pontos, dificuldade, bloquear, motivo, enxurrada }.
 */
function pontuar(acao, { ip, alvo, aparelho = {}, pais = '', isca = false } = {}, agora = Date.now()) {
  if (isca) return { pontos: 99, dificuldade: DIFICULDADES[3], bloquear: true, motivo: 'isca' };
  if (aparelho.bloqueado) return { pontos: 99, dificuldade: DIFICULDADES[3], bloquear: true, motivo: 'aparelho desconectado' };
  let pontos = 0; const motivos = [];
  const porIp = ip ? contar(`${acao}|ip|${ip}`, 15 * 60000, agora) : 0;
  if (porIp > 2) { pontos += Math.min(4, porIp - 2); motivos.push(`${porIp} tentativas da conexão`); }
  const porAlvo = alvo ? contar(`${acao}|alvo|${curto(alvo)}`, 3600000, agora) : 0;
  if (porAlvo > 20) { pontos += 8; motivos.push('o mesmo e-mail pedido de muitos lugares'); }
  else if (porAlvo > 8) { pontos += 4; motivos.push(`${porAlvo} pedidos para o mesmo e-mail`); }
  else if (porAlvo > 3) { pontos += 2; motivos.push(`${porAlvo} pedidos para o mesmo e-mail`); }
  const geral = contar(`${acao}|geral`, 10 * 60000, agora);
  const enxurrada = geral > 40;
  if (geral > 120) { pontos += 6; motivos.push('enxurrada de pedidos'); }
  else if (enxurrada) { pontos += 3; motivos.push('muitos pedidos no geral'); }
  if (pais && pais !== 'BR' && pais !== 'XX') { pontos += 2; motivos.push(`conexão de fora do Brasil (${pais})`); }
  if (aparelho.conhecido) pontos -= 3;
  const nivel = pontos <= 0 ? 0 : pontos <= 2 ? 1 : pontos <= 4 ? 2 : 3;
  return { pontos, dificuldade: DIFICULDADES[nivel], bloquear: pontos >= BLOQUEAR_EM, motivo: motivos.join(', '), enxurrada };
}

// ---------------------------------------------------------------- desafio (prova de trabalho)
/** Novo desafio: texto "dados.assinatura". alvo (e-mail) é opcional: sem ele, a resposta ainda fica presa ao e-mail. */
function novoDesafio(segredo, { acao, ip, alvo = '', dificuldade = DIFICULDADES[0] }, agora = Date.now()) {
  const d = Math.max(DIFICULDADES[0], Math.min(22, Math.floor(Number(dificuldade) || DIFICULDADES[0])));
  const dados = b64u(JSON.stringify({ a: acao, i: curto(ip), v: alvo ? curto(alvo) : '', d, t: agora, e: agora + VALIDADE_MS, n: b64u(crypto.randomBytes(9)) }));
  return { desafio: `${dados}.${b64u(crypto.createHmac('sha256', chaveHmac(segredo)).update(dados).digest())}`, dificuldade: d, validade: VALIDADE_MS };
}

/** Quantos bits zero tem o começo do resumo. */
function bitsZero(buf) {
  let n = 0;
  for (const byte of buf) { if (byte === 0) { n += 8; continue; } n += Math.clz32(byte) - 24; break; }
  return n;
}
/** Resumo que o navegador também calcula (js/porteiro-cliente.js): SHA-256 de (SHA-256-hex(desafio|e-mail) + número). */
const prefixo = (desafio, alvo) => hex(`${desafio}|${String(alvo || '').trim().toLowerCase()}`);
const resumo = (desafio, alvo, solucao) => sha(`${prefixo(desafio, alvo)}${solucao}`);

/**
 * Confere a resposta. Devolve { ok: true, uso } (uso = id para gravar como usado) ou { ok: false, motivo }.
 * minimo = dificuldade que a pontuação de AGORA exige (se esquentou depois do desafio, pede outro mais pesado).
 */
function conferir(segredo, { desafio, solucao, acao, ip, alvo = '', minimo = DIFICULDADES[0] }, agora = Date.now()) {
  const [dados, ass] = String(desafio || '').split('.');
  if (!dados || !ass || dados.length > 600) return { ok: false, motivo: 'sem desafio' };
  const certa = crypto.createHmac('sha256', chaveHmac(segredo)).update(dados).digest(), veio = Buffer.from(ass, 'base64url');
  if (veio.length !== certa.length || !crypto.timingSafeEqual(veio, certa)) return { ok: false, motivo: 'desafio falso' };
  let d; try { d = JSON.parse(Buffer.from(dados, 'base64url').toString('utf8')); } catch (_) { return { ok: false, motivo: 'desafio falso' }; }
  if (d.a !== acao) return { ok: false, motivo: 'desafio de outra ação' };
  if (d.i !== curto(ip)) return { ok: false, motivo: 'desafio de outra conexão' };
  if (d.v && d.v !== curto(alvo)) return { ok: false, motivo: 'desafio de outro e-mail' };
  if (!(Number(d.e) > agora)) return { ok: false, motivo: 'desafio vencido' };
  if (agora - Number(d.t) < TEMPO_MIN_MS) return { ok: false, motivo: 'rápido demais' };
  if (Number(d.d) < minimo) return { ok: false, motivo: 'precisa de desafio mais pesado' };
  if (typeof solucao !== 'string' || !/^\d{1,12}$/.test(solucao)) return { ok: false, motivo: 'sem resposta' };
  if (bitsZero(resumo(desafio, alvo, solucao)) < Number(d.d)) return { ok: false, motivo: 'resposta errada' };
  return { ok: true, uso: hex(desafio), dificuldade: Number(d.d) };
}

/** Resolve um desafio (os testes e o servidor de teste usam; o navegador tem a sua cópia em js/porteiro-cliente.js). */
function resolver(desafio, alvo, dificuldade) {
  const p = prefixo(desafio, alvo);
  for (let n = 0; n < 2 ** 30; n++) if (bitsZero(sha(`${p}${n}`)) >= dificuldade) return String(n);
  return '';
}

/** Faxina da noite: desafios usados há mais de 1 dia (até 400 por rodada). */
async function limparUsados(db, agora = Date.now()) {
  try {
    const s = await db.collection('porteiro_usados').where('em', '<', new Date(agora - 86400000).toISOString()).get();
    const velhos = s.docs.slice(0, 400);
    await Promise.all(velhos.map((x) => x.ref.delete().catch(() => {})));
    return velhos.length;
  } catch (e) { console.error('[porteiro] faxina', e && e.message); return 0; }
}

module.exports = { pontuar, anotar, novoDesafio, conferir, resolver, bitsZero, prefixo, limparUsados, segredoPadrao, curto, DIFICULDADES, BLOQUEAR_EM, TEMPO_MIN_MS, VALIDADE_MS, _marcas: marcas };
