// =====================================================================
//  /api/equipe.js — o PROPRIETÁRIO cuida da equipe da própria loja.
//
//  POST { acao: 'listar' }
//  POST { acao: 'definir', email, papel }   papel: administrador | funcionario | caixa | producao | estoque
//  POST { acao: 'remover', uid }
//  POST { acao: 'maquininha-estado' } / { acao: 'maquininha-salvar', estabelecimento, token } / { acao: 'maquininha-buscar', dia? }
//                                                              vendas da maquininha PagBank (ver lib/maquininha.js)
//  POST { acao: 'zerar-movimento', confirmacao: 'ZERAR' }      apaga pedidos, caixa, histórico e o que o motor de demanda aprendeu
//  POST { acao: 'copia-restaurar', dia }                      volta o cadastro (produtos, categorias, configurações, cupons) para a cópia do dia
//  POST { acao: 'copia-estado' } / { acao: 'copia-baixar' }   cópia de segurança dos dados da loja
//
//  O papel fica gravado DENTRO do login da pessoa (custom claims), que só o
//  servidor consegue escrever. A lista em {loja}/equipe é só um espelho para
//  a tela; quem decide o acesso é o login.
//
//  Travas:
//   • só proprietário desta loja (ou a plataforma) chama;
//   • ninguém muda o próprio papel;
//   • "proprietário" não se dá nem se tira por aqui (só pela plataforma);
//   • a loja vem do cabeçalho, mas a permissão vem do login: um proprietário
//     nunca mexe na equipe de outra loja.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const A = require('../lib/avisos');
const P = require('../lib/prudencia');
const Maq = require('../lib/maquininha');
const hojeBrasilia = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const ontemBrasilia = () => new Date(Date.now() - 27 * 3600000).toISOString().slice(0, 10);

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const ORIGENS = ['https://www.bancaadairepedrina.com.br', 'https://bancaadairepedrina.com.br', 'https://site-banca1.vercel.app'];
const cors = (req, res) => {
  const extras = String(process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = ORIGENS.concat(extras), origem = req.headers && req.headers.origin;
  if (origem && ok.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  else if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') res.setHeader('Access-Control-Allow-Origin', '*');
  else res.setHeader('Access-Control-Allow-Origin', ok[0]);
  res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Loja');
};
const ATRIBUIVEIS = ['administrador', 'funcionario', 'caixa', 'producao', 'estoque'];
const MAX_EQUIPE = 30;
const emailValido = (e) => /^[^\s@]{1,64}@[^\s@]{1,180}\.[a-z]{2,}$/i.test(e);
const ehDono = (claims, tid) => { const c = claims || {}; return (c.tenants && c.tenants[tid] === 'proprietario') || (tid === T.TENANT_PADRAO && c.admin === true); };

async function listar(res, { tid }) {
  const s = await T.tcol(db, tid, 'equipe').get();
  const equipe = s.docs.map((d) => ({ uid: d.id, email: d.data().email || '', papel: d.data().papel || '', em: d.data().em || '' })).sort((a, b) => a.email.localeCompare(b.email));
  return res.status(200).json({ sucesso: true, equipe });
}

async function definir(req, res, { tid, dec }) {
  const email = String((req.body || {}).email || '').trim().toLowerCase(), papel = String((req.body || {}).papel || '');
  if (!emailValido(email)) return res.status(400).json({ error: 'Confira o e-mail.' });
  if (!ATRIBUIVEIS.includes(papel)) return res.status(400).json({ error: 'Escolha um papel da lista.' });
  let u;
  try { u = await admin.auth().getUserByEmail(email); }
  catch (e) {
    if (e && e.code !== 'auth/user-not-found') throw e;
    u = await admin.auth().createUser({ email });        // a pessoa entra depois pelo link enviado ao e-mail dela
  }
  if (u.uid === dec.uid) return res.status(400).json({ error: 'Você não pode mudar o seu próprio papel.' });
  const claims = u.customClaims || {};
  if (claims.plataforma === true || ehDono(claims, tid)) return res.status(400).json({ error: 'Esta conta é de proprietário. Esse papel só muda pela plataforma.' });
  const ref = T.tdoc(db, tid, 'equipe', u.uid);
  if (!(await ref.get()).exists && (await T.tcol(db, tid, 'equipe').get()).size >= MAX_EQUIPE) return res.status(400).json({ error: `A equipe chegou ao limite de ${MAX_EQUIPE} pessoas.` });
  const novos = { ...claims, tenants: { ...(claims.tenants || {}), [tid]: papel } };
  if (JSON.stringify(novos).length > 900) return res.status(400).json({ error: 'Esta conta já participa de lojas demais.' });
  await admin.auth().setCustomUserClaims(u.uid, novos);
  await ref.set({ email, papel, em: new Date().toISOString(), por: dec.uid });
  return res.status(200).json({ sucesso: true, uid: u.uid, email, papel });
}

async function remover(req, res, { tid, dec }) {
  const uid = String((req.body || {}).uid || '');
  if (!/^[\w-]{6,128}$/.test(uid)) return res.status(400).json({ error: 'Pessoa inválida.' });
  if (uid === dec.uid) return res.status(400).json({ error: 'Você não pode tirar o seu próprio acesso.' });
  const ref = T.tdoc(db, tid, 'equipe', uid);
  let u = null;
  try { u = await admin.auth().getUser(uid); } catch (e) { if (e && e.code !== 'auth/user-not-found') throw e; }
  if (u) {
    const claims = u.customClaims || {};
    if (ehDono(claims, tid)) return res.status(400).json({ error: 'Esta conta é de proprietário. Esse papel só muda pela plataforma.' });
    const tenants = { ...(claims.tenants || {}) }; delete tenants[tid];
    await admin.auth().setCustomUserClaims(uid, { ...claims, tenants });
    // obriga a entrar de novo: o acesso antigo deixa de ser renovado (o que já está aberto vale por até 1 hora)
    try { await admin.auth().revokeRefreshTokens(uid); } catch (_) { /* segue: o papel já saiu do login */ }
  }
  await ref.delete();
  return res.status(200).json({ sucesso: true });
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  let dec, tid;
  try {
    const cab = String((req.headers && req.headers.authorization) || '');
    dec = await admin.auth().verifyIdToken(cab.startsWith('Bearer ') ? cab.slice(7).trim() : '');
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  try { ({ tid } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  // Avisos de pedido novo neste aparelho: qualquer pessoa da equipe que vê os pedidos pode ligar o seu.
  const acaoAviso = (req.body || {}).acao;
  if (acaoAviso === 'aviso-ligar' || acaoAviso === 'aviso-desligar' || acaoAviso === 'aviso-teste') {
    if (!T.temPapel(dec, tid, ['proprietario', 'administrador', 'funcionario', 'caixa'])) return res.status(403).json({ error: 'Sua conta não recebe avisos de pedido nesta loja.' });
    try {
      if (!A.ligado()) return res.status(503).json({ error: 'Os avisos ainda não estão ligados no servidor.' });
      if (acaoAviso === 'aviso-ligar') await A.ligar(db, tid, dec, (req.body || {}).assinatura);
      else if (acaoAviso === 'aviso-desligar') await A.desligar(db, tid, (req.body || {}).endpoint);
      else return res.status(200).json({ sucesso: true, ...(await A.avisarLoja(db, tid, { titulo: 'Aviso de teste', corpo: 'É assim que o pedido novo vai aparecer.', url: '/admin.html', tag: 'teste' })) });
      return res.status(200).json({ sucesso: true });
    } catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); console.error('[avisos]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  if (!T.temPapel(dec, tid, ['proprietario'])) return res.status(403).json({ error: 'Só o proprietário cuida da equipe desta loja.' });
  const acao = (req.body || {}).acao;
  try {
    if (acao === 'listar') return await listar(res, { tid });
    if (acao === 'definir') return await definir(req, res, { tid, dec });
    if (acao === 'remover') return await remover(req, res, { tid, dec });
    // CÓPIA DE SEGURANÇA: o proprietário vê quando foi a última e baixa uma cópia feita na hora.
    // MAQUININHA (PagBank): o proprietário guarda as credenciais, vê os últimos dias e pede a busca de um dia.
    // As credenciais nunca voltam para a tela: ela só fica sabendo SE estão guardadas.
    if (acao === 'maquininha-estado' || acao === 'maquininha-salvar' || acao === 'maquininha-buscar') {
      try {
        if (acao === 'maquininha-salvar') await Maq.salvarCredenciais(db, tid, (req.body || {}).estabelecimento, (req.body || {}).token);
        let buscado = null;
        if (acao === 'maquininha-buscar') {
          const dia = String((req.body || {}).dia || ontemBrasilia());
          if (!Maq.diaValido(dia) || dia >= hojeBrasilia()) return res.status(400).json({ error: 'O PagBank só entrega as vendas no dia seguinte. Escolha um dia que já passou.' });
          buscado = await Maq.buscarDia(db, tid, dia);
          if (!buscado) return res.status(400).json({ error: 'Guarde primeiro o número do estabelecimento e o token.' });
        }
        return res.status(200).json({ sucesso: true, ligada: !!(await Maq.lerCredenciais(db, tid)), dias: await Maq.ultimosDias(db, tid, hojeBrasilia()), buscado });
      } catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); throw e; }
    }
    if (acao === 'copia-estado') return res.status(200).json({ sucesso: true, ultima: await P.ultimaCopia(db, tid), copias: await P.listarCopias(db, tid) });
    if (acao === 'zerar-movimento') {
      // apaga pedidos, caixa, histórico e o que o motor aprendeu. Só com a palavra digitada, para não acontecer por engano.
      if (String((req.body || {}).confirmacao || '').trim().toUpperCase() !== 'ZERAR') return res.status(400).json({ error: 'Para confirmar, escreva ZERAR.' });
      const r = await P.zerarMovimento(db, tid); T._cacheFichas.delete(tid);
      console.warn(`[zerar] ${dec.email || dec.uid} zerou o movimento de ${tid}: ${r.total} registros`);
      return res.status(200).json({ sucesso: true, ...r });
    }
    if (acao === 'copia-restaurar') {
      try { const r = await P.restaurar(db, tid, String((req.body || {}).dia || '')); T._cacheFichas.delete(tid); console.warn(`[copia] ${dec.email || dec.uid} restaurou ${tid} para ${r.dia}`); return res.status(200).json({ sucesso: true, ...r }); }
      catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); throw e; }
    }
    if (acao === 'copia-baixar') return res.status(200).json({ sucesso: true, copia: await P.exportar(db, tid) });
  } catch (e) { console.error('[equipe]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  return res.status(400).json({ error: 'Ação desconhecida.' });
};
