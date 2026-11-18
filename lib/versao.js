'use strict';
// =====================================================================
//  lib/versao.js — QUAL VERSÃO O SERVIDOR RODA E QUANDO A ROTINA DA NOITE RODOU.
//
//  VERSÃO (commit do GitHub)
//    O site (Cloudflare Pages) se atualiza sozinho a cada mudança; o servidor (AWS) só quando
//    scripts/atualizar-servidor.sh roda. Para a equipe saber se os dois estão iguais:
//     - o script grava o commit em ~/.loja-versao, que entra no contêiner como /app/VERSAO
//       (só leitura). Quando nada do servidor mudou, ele só troca o arquivo, sem reiniciar;
//     - a imagem também leva o commit em que foi montada (VERSAO_COMMIT), para quando o arquivo faltar;
//     - o site grava o commit dele em /versao.json (scripts/cloudflare-arquivos.js);
//     - /api/saude mostra "versao" (7 letras) e o painel compara (js/aviso-versao.js).
//
//  ROTINA DA NOITE
//    Quem chama a rotina (GET /api/analytics com o CRON_SECRET) é o GitHub (.github/workflows/rotina-noite.yml).
//    O servidor anota em plataforma/rotina_noite quando ela rodou, se deu certo, com qual versão do servidor
//    e de qual commit veio o disparo (cabeçalho X-Rotina-Commit). /api/saude mostra; o painel avisa
//    quando ela não roda há mais de 30 horas. A rotina da Vercel (crons do vercel.json) NÃO passa por aqui:
//    se só ela estiver rodando, o painel mostra "a rotina não rodou por este servidor".
// =====================================================================
const fs = require('fs');
const path = require('path');

const RE_COMMIT = /^[0-9a-f]{7,40}$/;
const ARQUIVO = () => process.env.VERSAO_ARQUIVO || path.join(__dirname, '..', 'VERSAO');
const limpar = (v) => { const c = String(v || '').trim().toLowerCase(); return RE_COMMIT.test(c) ? c : ''; };
const curto = (c) => (c ? String(c).slice(0, 7) : '');

let _lido = { ate: 0, valor: '' };
/** Commit completo que o servidor roda ('' quando não sabe). Lê o arquivo no máximo a cada 30 s. */
function commit(agora = Date.now()) {
  if (agora < _lido.ate) return _lido.valor;
  let v = '';
  try { v = limpar(fs.readFileSync(ARQUIVO(), 'utf8')); } catch (_) { /* sem arquivo: vale o da imagem */ }
  if (!v) v = limpar(process.env.VERSAO_COMMIT);
  _lido = { ate: agora + 30000, valor: v };
  return v;
}

const DOC = 'plataforma/rotina_noite';

/** Anota uma volta da rotina da noite. Nunca derruba nada: falha só vai para o registro. */
async function registrarRotina(db, { status, disparo, inicio, agora = Date.now() } = {}) {
  try {
    const dados = {
      em: new Date(agora).toISOString(),
      ok: Number(status) === 200,
      status: Number(status) || 0,
      duracaoSeg: inicio ? Math.round((agora - inicio) / 1000) : null,
      servidor: curto(commit(agora)),
      disparo: curto(limpar(disparo)),
    };
    await db.doc(DOC).set(dados);
    _rotina = { ate: agora + 10 * 60000, valor: dados };
    return dados;
  } catch (e) { console.error('[rotina] não consegui anotar:', e && e.message); return null; }
}

let _rotina = { ate: 0, valor: null };
/** Última volta da rotina (guardada 10 min na memória: /api/saude é chamado o tempo todo). null quando não sabe. */
async function ultimaRotina(obterDb, agora = Date.now()) {
  if (agora < _rotina.ate) return _rotina.valor;
  let valor = null;
  try {
    const db = typeof obterDb === 'function' ? obterDb() : null;
    if (db) {
      // no máximo 3 s: a saúde do servidor não pode ficar presa esperando o banco
      const s = await Promise.race([db.doc(DOC).get(), new Promise((_, nao) => setTimeout(() => nao(new Error('banco demorou')), 3000).unref())]);
      if (s.exists) { const d = s.data() || {}; valor = { em: String(d.em || ''), ok: d.ok === true, status: Number(d.status) || 0, servidor: curto(limpar(d.servidor)), disparo: curto(limpar(d.disparo)) }; }
    }
  } catch (e) { console.error('[rotina] não consegui ler:', e && e.message); }
  _rotina = { ate: agora + 10 * 60000, valor };
  return valor;
}

const _zerar = () => { _lido = { ate: 0, valor: '' }; _rotina = { ate: 0, valor: null }; };

module.exports = { commit, curto, limpar, registrarRotina, ultimaRotina, DOC, _zerar };
