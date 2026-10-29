'use strict';
// =====================================================================
//  lib/aparelhos.js — QUAIS APARELHOS ESTÃO ENTRANDO NO PAINEL.
//
//  Cada navegador do painel tem um número próprio (guardado nele, js/admin-aparelho.js) e avisa o servidor
//  ao entrar e de tempos em tempos. Aqui fica o registro em `aparelhos/{conta}_{hash}` (só o servidor lê e
//  grava: as regras do banco negam tudo que não está listado nelas). Com isso:
//    - APARELHO NOVO numa conta → aviso no celular do dono da loja (e registro na trilha);
//    - LINK ABERTO EM OUTRO APARELHO (o link do e-mail foi aberto num aparelho diferente do que pediu:
//      encaminhado, copiado) → o aviso diz isso;
//    - CONTA COMPARTILHADA (vários aparelhos ativos ou várias conexões diferentes em pouco tempo) → aviso;
//    - DESCONECTAR um aparelho: ele é marcado como bloqueado, o login da conta é encerrado e as chaves de
//      Face ID/digital criadas nele são apagadas. O painel aberto nele sai sozinho na próxima conferência.
//  O número do aparelho é guardado só como hash (não dá para "vestir" o aparelho de outra pessoa sabendo o id).
// =====================================================================
const crypto = require('crypto');

const COL = 'aparelhos';
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ATIVO_MS = 24 * 3600000;          // "ativo" = usado nas últimas 24 h
const JANELA_IP_MS = 2 * 3600000;       // conexões diferentes nas últimas 2 h
const LIMITE_APARELHOS = 3;             // mais que isso ativos ao mesmo tempo, na mesma conta = parece compartilhada
const LIMITE_IPS = 4;
const GRAVAR_A_CADA_MS = 5 * 60000;     // a conferência de 5 em 5 min só grava se mudou algo ou passou esse tempo
const MAX_IPS = 6;

const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(id);
const docId = (uid, aparelho) => `${String(uid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)}_${hash(aparelho).slice(0, 32)}`;

/** "iPhone · Safari", "Android · Chrome", "Windows · Edge"... (só para a pessoa reconhecer o aparelho) */
function nomeDoAparelho(ua) {
  const u = String(ua || '');
  const so = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Macintosh|Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'Aparelho';
  const nav = /Edg\//.test(u) ? 'Edge' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'navegador';
  return `${so} · ${nav}`;
}
/** IP pela metade para mostrar na tela (o completo fica no registro do servidor). */
const ipCurto = (ip) => { const s = String(ip || ''); if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.split('.').slice(0, 2).join('.') + '.x.x'; if (s.includes(':')) return s.split(':').slice(0, 3).join(':') + ':…'; return s ? '…' : ''; };

/**
 * O aparelho avisou que está no painel. Devolve { bloqueado, novo, alertas: [{ assunto, titulo, corpo }] }.
 * como = 'link' | 'link-outro-aparelho' | 'passkey' | '' (como a pessoa entrou, quando acabou de entrar).
 */
async function registrar(db, { uid, email, tid, aparelho, ua, ip, como = '', pais = '' }, agora = Date.now()) {
  if (!idValido(aparelho)) return { erro: 'Aparelho inválido.' };
  const id = docId(uid, aparelho), ref = db.collection(COL).doc(id), s = await ref.get();
  const antes = s.exists ? s.data() : null;
  if (antes && antes.bloqueado === true) return { bloqueado: true, id };
  const quando = new Date(agora).toISOString(), nome = nomeDoAparelho(ua);
  const ips = Array.isArray(antes && antes.ips) ? antes.ips.slice() : [];
  const ipNovo = !!ip && !ips.some((x) => x && x.ip === ip);
  if (ip) { const i = ips.findIndex((x) => x && x.ip === ip); if (i >= 0) ips.splice(i, 1); ips.unshift({ ip, em: quando, ...(pais ? { pais } : {}) }); }
  const lojas = [...new Set([...(Array.isArray(antes && antes.lojas) ? antes.lojas : []), tid].filter(Boolean))].slice(0, 30);
  const alertas = [];
  const precisaGravar = !antes || ipNovo || !!como || !lojas.every((l) => (antes.lojas || []).includes(l)) || agora - Date.parse(antes.ultima || 0) > GRAVAR_A_CADA_MS;
  if (precisaGravar) {
    await ref.set({ uid, email: email || '', nome, lojas, ips: ips.slice(0, MAX_IPS), ultima: quando, ...(antes ? {} : { primeira: quando }), ...(como ? { como } : {}), bloqueado: false }, { merge: true });
  }
  if (!antes) {
    alertas.push({ assunto: `aparelho-${id}`, titulo: como === 'link-outro-aparelho' ? 'Link de entrada aberto em outro aparelho' : 'Aparelho novo no painel',
      corpo: como === 'link-outro-aparelho'
        ? `${email || 'Uma conta'} entrou de um aparelho DIFERENTE do que pediu o link (${nome}, conexão ${ipCurto(ip)}). Se não foi ela, desconecte em Equipe → Aparelhos.`
        : `${email || 'Uma conta'} entrou de um aparelho novo: ${nome}, conexão ${ipCurto(ip)}. Se não reconhece, desconecte em Equipe → Aparelhos.` });
  }
  // CONTA COMPARTILHADA? Aparelhos ativos e conexões diferentes da mesma conta
  if (!antes || ipNovo) {
    const todos = (await db.collection(COL).where('uid', '==', uid).get()).docs.map((d) => d.data()).filter((d) => d.bloqueado !== true);
    const ativos = todos.filter((d) => agora - Date.parse(d.ultima || 0) < ATIVO_MS).length;
    const conexoes = new Set(todos.flatMap((d) => (d.ips || []).filter((x) => x && agora - Date.parse(x.em || 0) < JANELA_IP_MS).map((x) => x.ip))).size;
    if (ativos > LIMITE_APARELHOS) alertas.push({ assunto: `muitos-aparelhos-${uid}`, titulo: 'Acesso parece compartilhado', corpo: `${email || 'Uma conta'} está em ${ativos} aparelhos diferentes nas últimas 24 horas. Confira em Equipe → Aparelhos e desconecte o que não for de vocês.` });
    else if (conexoes > LIMITE_IPS) alertas.push({ assunto: `muitas-conexoes-${uid}`, titulo: 'Muitas conexões diferentes', corpo: `${email || 'Uma conta'} entrou de ${conexoes} conexões diferentes nas últimas 2 horas. Pode ser só o celular trocando de rede, ou alguém usando o mesmo acesso.` });
  }
  return { bloqueado: false, novo: !antes, id, alertas };
}

/** Aparelhos que entraram no painel DESTA loja (para o proprietário), do mais recente para o mais antigo. */
async function listar(db, tid) {
  const s = await db.collection(COL).where('lojas', 'array-contains', tid).get();
  return s.docs.map((d) => { const x = d.data(); return { id: d.id, uid: x.uid, email: x.email || '', nome: x.nome || 'Aparelho', primeira: x.primeira || '', ultima: x.ultima || '', como: x.como || '', bloqueado: x.bloqueado === true, conexao: ipCurto(((x.ips || [])[0] || {}).ip), conexoes: (x.ips || []).length }; })
    .sort((a, b) => (b.ultima || '').localeCompare(a.ultima || '')).slice(0, 100);
}

/** Marca o aparelho como bloqueado e apaga as chaves de Face ID/digital criadas nele. Devolve o registro (ou null). */
async function bloquear(db, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,120}$/.test(id)) return null;
  const ref = db.collection(COL).doc(id), s = await ref.get();
  if (!s.exists) return null;
  await ref.set({ bloqueado: true, bloqueadoEm: new Date().toISOString() }, { merge: true });
  const pk = await db.collection('passkeys').where('aparelhoDoc', '==', id).get();
  await Promise.all(pk.docs.map((d) => d.ref.delete().catch(() => {})));
  return { ...s.data(), id, chavesApagadas: pk.size };
}

/** Desfaz o bloqueio (desconectou por engano). A pessoa entra de novo pelo link ou Face ID. */
async function liberar(db, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,120}$/.test(id)) return null;
  const ref = db.collection(COL).doc(id), s = await ref.get();
  if (!s.exists) return null;
  await ref.set({ bloqueado: false }, { merge: true });
  return { ...s.data(), id };
}

module.exports = { registrar, listar, bloquear, liberar, docId, idValido, nomeDoAparelho, ipCurto, LIMITE_APARELHOS, LIMITE_IPS };
