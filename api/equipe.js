// =====================================================================
//  /api/equipe.js — o PROPRIETÁRIO cuida da equipe da própria loja.
//
//  POST { acao: 'pedir-link', email }      SEM LOGIN: pede o link de entrada. Só e-mail da equipe recebe; a resposta é sempre a mesma.
//  POST { acao: 'sair-de-tudo' }             encerra o login desta conta em todos os aparelhos
//  POST { acao: 'auditoria' }                últimas ações registradas na loja (só proprietário)
//  POST { acao: 'minha-assinatura' }          a mensalidade desta banca (definida pela plataforma)
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
const Assinatura = require('../lib/assinatura');
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
const H = require('../lib/http');
const cors = H.cors;            // origem (CORS): lista única em lib/http.js
const crypto = require('crypto');
const ATRIBUIVEIS = ['administrador', 'funcionario', 'caixa', 'producao', 'estoque'];
const quemE = (dec) => dec.email || dec.uid;
const anotar = (req, tid, dec, acao, detalhe) => P.registrar(db, tid, { acao, quem: quemE(dec), uid: dec.uid, detalhe, ip: H.ipDe(req) });

// ---------------------------------------------------------------------
// CONTA CRIADA POR FORA: se o e-mail que vai ganhar um papel já tem conta mas o e-mail nunca foi confirmado,
// pode ser que outra pessoa tenha criado essa conta com uma senha, esperando o papel chegar. Antes de dar o
// papel, a senha é trocada por uma que ninguém conhece e os logins abertos são encerrados. A pessoa de verdade
// continua entrando normalmente, pelo link que chega no e-mail dela.
// ---------------------------------------------------------------------
async function blindarConta(u) {
  if (!u || u.emailVerified === true) return false;
  try {
    await admin.auth().updateUser(u.uid, { password: crypto.randomBytes(48).toString('base64') });
    await admin.auth().revokeRefreshTokens(u.uid);
    return true;
  } catch (e) { console.error('[equipe] blindar', e && e.code); return false; }
}

// ---------------------------------------------------------------------
// PEDIR O LINK DE ENTRADA (sem login).
//
// Antes o painel pedia o link direto ao Firebase para QUALQUER e-mail digitado. Problemas:
//   - no plano gratuito o Firebase só envia 5 links de entrada POR DIA para o projeto inteiro:
//     cinco e-mails quaisquer digitados na tela e ninguém da equipe entrava mais naquele dia;
//   - a tela servia para mandar e-mail a qualquer endereço.
// Agora o pedido passa por aqui: só quem JÁ faz parte de alguma loja (ou é dono da plataforma) recebe.
// A resposta é sempre a mesma frase, exista o e-mail ou não, para não revelar quem é da equipe.
// Limites (contados no banco): por conexão, por e-mail e um teto geral por hora.
// ---------------------------------------------------------------------
const FRASE_LINK = 'Se este e-mail estiver autorizado, o link chega em instantes. Confira a caixa de entrada e o spam.';
const temAlgumPapel = (claims) => {
  const c = claims || {};
  return c.plataforma === true || c.admin === true || (c.tenants && typeof c.tenants === 'object' && Object.values(c.tenants).some((p) => T.PAPEIS.includes(p)));
};
async function pedirLink(req, res) {
  const b = req.body || {}, email = String(b.email || '').trim().toLowerCase(), ip = H.ipDe(req);
  if (!emailValido(email) || email.length > 200) return res.status(400).json({ error: 'Confira o e-mail.' });
  const muitas = () => res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  if (H.passouNaMemoria(`link:${ip}`, 5, 60000)) return muitas();
  // as contas valem para QUALQUER e-mail (autorizado ou não): o limite não serve para descobrir quem é da equipe
  const porIp = await P.limitar(db, 'link-ip', ip, 6, 900), porEmail = await P.limitar(db, 'link-email', email, 3, 900);
  if (!porIp || !porEmail) {
    await P.registrar(db, null, { acao: 'login-barrado', quem: email, detalhe: porIp ? 'muitos pedidos para o mesmo e-mail' : 'muitos pedidos da mesma conexão', ip });
    await P.alertar(db, T.TENANT_PADRAO, 'login', { titulo: 'Tentativas de entrar no painel', corpo: 'Alguém pediu o link de entrada muitas vezes seguidas. Se não foi você nem a equipe, fique de olho.' });
    return muitas();
  }
  if (!(await P.limitar(db, 'link-geral', 'todos', Number(process.env.LOGIN_TETO_HORA) > 0 ? Number(process.env.LOGIN_TETO_HORA) : 30, 3600))) {
    await P.alertar(db, T.TENANT_PADRAO, 'login-geral', { titulo: 'Muitos pedidos de entrada', corpo: 'O painel recebeu pedidos demais de link de entrada na última hora e parou de enviar por um tempo.' });
    return muitas();
  }
  const generica = () => res.status(200).json({ sucesso: true, mensagem: FRASE_LINK });

  let u = null;
  try { u = await admin.auth().getUserByEmail(email); } catch (e) { if (e && e.code !== 'auth/user-not-found') { console.error('[login]', e.code || e.message); return res.status(502).json({ error: 'Não consegui enviar agora.', codigo: 'falha-envio' }); } }
  if (!u || u.disabled === true || !temAlgumPapel(u.customClaims)) {
    await P.registrar(db, null, { acao: 'login-recusado', quem: email, detalhe: 'e-mail que não faz parte de nenhuma equipe', ip });
    await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 350)));     // tempo parecido com o de um envio de verdade
    return generica();
  }

  // Para onde o link leva: SEMPRE o nosso próprio painel (o endereço não vem do navegador; só o id da loja, conferido).
  const tid = T.idValido(String(b.loja || '')) ? String(b.loja) : '';
  const base = H.origensPermitidas().includes(req.headers && req.headers.origin) ? req.headers.origin : H.origensPermitidas()[0];
  const continuar = `${base}/admin.html${tid && tid !== T.TENANT_PADRAO ? `?loja=${encodeURIComponent(tid)}` : ''}`;
  const chave = String(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY || '').trim();
  if (!chave) return res.status(503).json({ error: 'Não consegui enviar agora.', codigo: 'sem-config' });
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(chave)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Referer: `${base}/` }, signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl: continuar, canHandleCodeInApp: true }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null), motivo = String((j && j.error && j.error.message) || r.status).slice(0, 80);
      console.error('[login] o Firebase não enviou o link:', motivo);
      await P.registrar(db, null, { acao: 'login-falha-envio', quem: email, detalhe: motivo, ip });
      const cota = /QUOTA|TOO_MANY|RESOURCE_EXHAUSTED/i.test(motivo);
      if (cota) await P.alertar(db, T.TENANT_PADRAO, 'login-cota', { titulo: 'Limite de links de entrada', corpo: 'O Firebase atingiu o limite de links de entrada de hoje. Quem já está no painel continua; novos logins, só amanhã.' });
      return res.status(cota ? 429 : 502).json({ error: cota ? 'O limite de links de entrada de hoje foi atingido. Tente amanhã ou use um aparelho que já esteja no painel.' : 'Não consegui enviar agora.', codigo: cota ? 'cota' : 'falha-envio' });
    }
  } catch (e) {
    console.error('[login] envio:', e && (e.name || e.message));
    return res.status(502).json({ error: 'Não consegui enviar agora.', codigo: 'falha-envio' });
  }
  await P.registrar(db, null, { acao: 'login-link-enviado', quem: email, detalhe: tid || T.TENANT_PADRAO, ip });
  return generica();
}
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
  await blindarConta(u);
  await admin.auth().setCustomUserClaims(u.uid, novos);
  await ref.set({ email, papel, em: new Date().toISOString(), por: dec.uid });
  await anotar(req, tid, dec, 'equipe-papel', `${email} → ${papel}`);
  await P.alertar(db, tid, 'equipe', { titulo: 'Equipe alterada', corpo: `${email} agora tem acesso ao painel (${papel}).` });
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
  // Quem saiu da equipe deixa de receber aviso de pedido novo (antes o celular da pessoa continuava recebendo).
  try { const av = await T.tcol(db, tid, 'avisos').get(); await Promise.all(av.docs.filter((d) => d.data().uid === uid).map((d) => d.ref.delete().catch(() => {}))); } catch (_) { /* segue */ }
  await anotar(req, tid, dec, 'equipe-remover', (u && u.email) || uid);
  return res.status(200).json({ sucesso: true });
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try { boot(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
  // Único pedido deste arquivo que não exige login: pedir o link de entrada.
  if ((req.body || {}).acao === 'pedir-link') {
    try { return await pedirLink(req, res); }
    catch (e) { console.error('[login]', e && e.message); return res.status(502).json({ error: 'Não consegui enviar agora.', codigo: 'falha-envio' }); }
  }
  let dec, tid;
  try {
    // true = confere também se o login foi ENCERRADO (pessoa tirada da equipe, "sair de todos os aparelhos"):
    // sem isto, quem perdeu o acesso continuava mexendo na equipe por até 1 hora.
    dec = await admin.auth().verifyIdToken(H.tokenDe(req), true);
  } catch (e) { return res.status(401).json({ error: 'Entre no painel de novo.' }); }
  try { ({ tid } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (H.passouNaMemoria(`equipe:${dec.uid}`, 60, 60000)) return res.status(429).json({ error: 'Muitos pedidos seguidos. Aguarde um minuto.' });
  // ENCERRAR O PRÓPRIO LOGIN EM TODOS OS APARELHOS (celular perdido, computador emprestado). Qualquer pessoa da equipe.
  if ((req.body || {}).acao === 'sair-de-tudo') {
    if (!T.temPapel(dec, tid, T.PAPEIS)) return res.status(403).json({ error: 'Esta conta não faz parte da equipe desta loja.' });
    try { await admin.auth().revokeRefreshTokens(dec.uid); await anotar(req, tid, dec, 'sair-de-tudo', ''); return res.status(200).json({ sucesso: true }); }
    catch (e) { console.error('[equipe] sair', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
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
    // A MENSALIDADE desta banca (definida pela plataforma). Só o proprietário DESTA loja vê, e só a dela.
    if (acao === 'minha-assinatura') return res.status(200).json({ sucesso: true, assinatura: await Assinatura.ler(db, tid) });
    if (acao === 'listar') return await listar(res, { tid });
    if (acao === 'auditoria') return res.status(200).json({ sucesso: true, registros: await P.lerAuditoria(db, tid, 40) });
    if (acao === 'definir') return await definir(req, res, { tid, dec });
    if (acao === 'remover') return await remover(req, res, { tid, dec });
    // CÓPIA DE SEGURANÇA: o proprietário vê quando foi a última e baixa uma cópia feita na hora.
    // MAQUININHA (PagBank): o proprietário guarda as credenciais, vê os últimos dias e pede a busca de um dia.
    // As credenciais nunca voltam para a tela: ela só fica sabendo SE estão guardadas.
    if (acao === 'maquininha-estado' || acao === 'maquininha-salvar' || acao === 'maquininha-buscar') {
      try {
        if (acao === 'maquininha-salvar') { const r0 = await Maq.salvarCredenciais(db, tid, (req.body || {}).estabelecimento, (req.body || {}).token); await anotar(req, tid, dec, 'maquininha', r0.ligada ? 'credenciais gravadas' : 'credenciais apagadas'); }
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
      // no máximo 2 por dia por loja: é uma ação de "uma vez na vida", e cada uma grava uma cópia inteira antes
      if (!(await P.limitar(db, 'zerar', tid, 2, 86400))) return res.status(429).json({ error: 'O movimento desta loja já foi zerado hoje. Tente amanhã.' });
      const r = await P.zerarMovimento(db, tid); T._cacheFichas.delete(tid);
      console.warn(`[zerar] ${dec.uid} zerou o movimento de ${tid}: ${r.total} registros`);
      await anotar(req, tid, dec, 'zerar-movimento', `${r.total} registros apagados; cópia ${r.copiaDeAntes}`);
      await P.alertar(db, tid, 'zerar', { titulo: 'Movimento zerado', corpo: `${quemE(dec)} apagou pedidos, caixa e histórico desta loja. Uma cópia foi guardada antes.` });
      return res.status(200).json({ sucesso: true, ...r });
    }
    if (acao === 'copia-restaurar') {
      try {
        if (!(await P.limitar(db, 'restaurar', tid, 6, 86400))) return res.status(429).json({ error: 'Muitas restaurações hoje. Tente amanhã.' });
        const r = await P.restaurar(db, tid, String((req.body || {}).dia || '')); T._cacheFichas.delete(tid); console.warn(`[copia] ${dec.uid} restaurou ${tid} para ${r.dia}`);
        await anotar(req, tid, dec, 'copia-restaurar', `cadastro voltou para ${r.dia}`);
        await P.alertar(db, tid, 'restaurar', { titulo: 'Cadastro restaurado', corpo: `${quemE(dec)} voltou produtos e configurações para a cópia de ${r.dia}.` });
        return res.status(200).json({ sucesso: true, ...r });
      }
      catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); throw e; }
    }
    if (acao === 'copia-baixar') {
      // a cópia leva nome, telefone e endereço dos clientes: fica registrado quem baixou, e há um teto por dia
      if (!(await P.limitar(db, 'copia-baixar', `${tid}|${dec.uid}`, 10, 86400))) return res.status(429).json({ error: 'Muitas cópias baixadas hoje. Tente amanhã.' });
      await anotar(req, tid, dec, 'copia-baixar', 'baixou a cópia de segurança (com dados de clientes)');
      return res.status(200).json({ sucesso: true, copia: await P.exportar(db, tid) });
    }
  } catch (e) { console.error('[equipe]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  return res.status(400).json({ error: 'Ação desconhecida.' });
};
