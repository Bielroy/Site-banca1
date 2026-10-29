// =====================================================================
//  /api/equipe.js — o PROPRIETÁRIO cuida da equipe da própria loja.
//
//  POST { acao: 'pedir-link', email }      SEM LOGIN: pede o link de entrada. Só e-mail da equipe recebe; a resposta é sempre a mesma.
//  POST { acao: 'sair-de-tudo' }             encerra o login desta conta em todos os aparelhos
//  POST { acao: 'auditoria' }                últimas ações registradas na loja (só proprietário)
//  POST { acao: 'minha-assinatura' }          a mensalidade desta banca (definida pela plataforma)
//  POST { acao: 'listar' }
//  POST { acao: 'definir', email, papel }   papel: administrador | gerente | funcionario | caixa | producao | estoque
//  POST { acao: 'remover', uid }
//  POST { acao: 'maquininha-estado' } / { acao: 'maquininha-salvar', estabelecimento, token } / { acao: 'maquininha-buscar', dia? }
//                                                              vendas da maquininha PagBank (ver lib/maquininha.js)
//  POST { acao: 'zerar-movimento', confirmacao: 'ZERAR' }      apaga pedidos, caixa, histórico e o que o motor de demanda aprendeu
//  POST { acao: 'copia-restaurar', dia }                      volta o cadastro (produtos, categorias, configurações, cupons) para a cópia do dia
//  POST { acao: 'copia-estado' } / { acao: 'copia-baixar' }   cópia de segurança dos dados da loja
//  POST { acao: 'aparelho', aparelho, como? }                 QUALQUER pessoa da equipe: "este aparelho está no painel" (lib/aparelhos.js)
//  POST { acao: 'aparelhos' } / { acao: 'aparelho-desconectar', id } / { acao: 'aparelho-liberar', id }   (só proprietário)
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
const Aprov = require('../lib/aprovacao');
const Porteiro = require('../lib/porteiro');
const Assinatura = require('../lib/assinatura');
const A = require('../lib/avisos');
const P = require('../lib/prudencia');
const Maq = require('../lib/maquininha');
const Cofre = require('../lib/cofre');
const Ap = require('../lib/aparelhos');
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
const ATRIBUIVEIS = ['administrador', 'gerente', 'funcionario', 'caixa', 'producao', 'estoque'];
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
const paisDe = (req) => String((req && req.headers && req.headers['cf-ipcountry']) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
/** Para a pontuação: este aparelho já entrou com esta conta? E-mail que não existe dá o mesmo que aparelho desconhecido. */
async function situacaoPorEmail(email, aparelho) {
  let u = null;
  try { u = await admin.auth().getUserByEmail(email); } catch (_) { u = null; }
  try { return { u, aparelho: u ? await Ap.situacao(db, u.uid, aparelho) : {} }; } catch (_) { return { u, aparelho: {} }; }
}
/** O desafio do porteiro: o navegador pede ao abrir a tela de entrada (sem e-mail) e de novo se precisar de um mais pesado. */
async function desafioDoPorteiro(req, res) {
  const b = req.body || {}, ip = H.ipDe(req), e = String(b.email || '').trim().toLowerCase(), email = emailValido(e) && e.length <= 200 ? e : '';
  if (H.passouNaMemoria(`porteiro:${ip}`, 30, 60000)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  const { aparelho } = email ? await situacaoPorEmail(email, b.aparelho) : { aparelho: {} };
  const pont = Porteiro.pontuar('link', { ip, alvo: email, aparelho, pais: paisDe(req) });
  if (pont.bloquear) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ sucesso: true, ...Porteiro.novoDesafio(Porteiro.segredoPadrao(), { acao: 'link', ip, alvo: email, dificuldade: pont.dificuldade }) });
}

async function pedirLink(req, res) {
  const b = req.body || {}, email = String(b.email || '').trim().toLowerCase(), ip = H.ipDe(req);
  if (!emailValido(email) || email.length > 200) return res.status(400).json({ error: 'Confira o e-mail.' });
  const muitas = () => res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  if (H.passouNaMemoria(`link:${ip}`, 5, 60000)) return muitas();
  const generica = () => res.status(200).json({ sucesso: true, mensagem: FRASE_LINK });
  // PORTEIRO (lib/porteiro.js): isca, pontuação de risco, aparelho conhecido e o desafio resolvido pelo navegador
  const isca = typeof b.isca === 'string' && b.isca.trim() !== '';
  const { aparelho } = await situacaoPorEmail(email, b.aparelho);
  const pont = Porteiro.pontuar('link', { ip, alvo: email, aparelho, pais: paisDe(req), isca });
  Porteiro.anotar('link', { ip, alvo: email });
  if (isca) {
    await P.registrar(db, null, { acao: 'login-isca', quem: email, detalhe: 'campo escondido preenchido (robô)', ip });
    await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 350)));
    return generica();                         // o robô acha que deu certo e não tenta de outro jeito
  }
  if (pont.bloquear) {
    await P.registrar(db, null, { acao: 'login-barrado', quem: email, detalhe: `porteiro: ${pont.motivo}`.slice(0, 200), ip });
    await P.alertar(db, T.TENANT_PADRAO, 'login-porteiro', { titulo: 'Entrada no painel barrada', corpo: `O porteiro barrou pedidos de link de entrada (${pont.motivo}). Se não foi a equipe, alguém está tentando entrar.` });
    return muitas();
  }
  const conf = Porteiro.conferir(Porteiro.segredoPadrao(), { desafio: b.desafio, solucao: b.solucao, acao: 'link', ip, alvo: email, minimo: pont.dificuldade });
  const pedirDesafio = (motivo) => res.status(428).json({ error: 'Confirmando que não é um robô. Toque de novo.', codigo: 'desafio', motivo, dificuldade: pont.dificuldade });
  if (!conf.ok) return pedirDesafio(conf.motivo);
  try { await db.collection('porteiro_usados').doc(conf.uso).create({ em: new Date().toISOString() }); }
  catch (_) { return pedirDesafio('desafio já usado'); }
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
      method: 'POST', headers: { 'Content-Type': 'application/json', Referer: `${base}/`, 'X-Firebase-Locale': 'pt-BR' }, signal: AbortSignal.timeout(12000),
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
  const novos = Aprov.claimsCom({ ...claims, tenants: { ...(claims.tenants || {}), [tid]: papel } }, tid, await Aprov.exige(db, tid));   // loja que exige aparelho aprovado: marca no login
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
    await admin.auth().setCustomUserClaims(uid, Aprov.claimsCom({ ...claims, tenants }, tid, false));
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
  if ((req.body || {}).acao === 'porteiro') {
    try { return await desafioDoPorteiro(req, res); }
    catch (e) { console.error('[porteiro]', e && e.message); return res.status(503).json({ error: 'Não consegui agora. Tente de novo.' }); }
  }
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
  // MENSALIDADE: o proprietário vê a dele MESMO com a loja bloqueada (bloqueio por falta de pagamento:
  // é justamente aí que ele precisa saber quanto pagar). Por isso vem antes da conferência de loja ativa.
  if ((req.body || {}).acao === 'minha-assinatura') {
    const tidM = T.tenantDaRequisicao(req);
    if (!tidM) return res.status(400).json({ error: 'Loja inválida.' });
    if (!T.temPapel(dec, tidM, ['proprietario'])) return res.status(403).json({ error: 'Só o proprietário vê a mensalidade desta loja.' });
    try {
      const ficha = await T.fichaDaLoja(db, tidM);
      return res.status(200).json({ sucesso: true, assinatura: await Assinatura.ler(db, tidM), bloqueada: !!(ficha && ficha.ativo === false) });
    } catch (e) { console.error('[equipe] assinatura', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  try { ({ tid } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (H.passouNaMemoria(`equipe:${dec.uid}`, 60, 60000)) return res.status(429).json({ error: 'Muitos pedidos seguidos. Aguarde um minuto.' });
  // ENCERRAR O PRÓPRIO LOGIN EM TODOS OS APARELHOS (celular perdido, computador emprestado). Qualquer pessoa da equipe.
  if ((req.body || {}).acao === 'sair-de-tudo') {
    if (!T.temPapel(dec, tid, T.PAPEIS, { ignorarAparelho: true })) return res.status(403).json({ error: 'Esta conta não faz parte da equipe desta loja.' });
    // as chaves de Face ID/digital (api/passkey.js) também saem: celular perdido não entra de novo sozinho
    try { await admin.auth().revokeRefreshTokens(dec.uid); const pk = await require('../lib/passkey').apagarDaConta(db, dec.uid).catch(() => 0); await anotar(req, tid, dec, 'sair-de-tudo', pk ? `e ${pk} aparelho(s) com Face ID/digital` : ''); return res.status(200).json({ sucesso: true }); }
    catch (e) { console.error('[equipe] sair', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  // Avisos de pedido novo neste aparelho: qualquer pessoa da equipe que vê os pedidos pode ligar o seu.
  const acaoAviso = (req.body || {}).acao;
  if (acaoAviso === 'aviso-ligar' || acaoAviso === 'aviso-desligar' || acaoAviso === 'aviso-teste') {
    if (!T.temPapel(dec, tid, ['proprietario', 'administrador', 'gerente', 'funcionario', 'caixa'])) return res.status(403).json({ error: 'Sua conta não recebe avisos de pedido nesta loja.' });
    try {
      if (!A.ligado()) return res.status(503).json({ error: 'Os avisos ainda não estão ligados no servidor.' });
      if (acaoAviso === 'aviso-ligar') await A.ligar(db, tid, dec, (req.body || {}).assinatura);
      else if (acaoAviso === 'aviso-desligar') await A.desligar(db, tid, (req.body || {}).endpoint);
      else return res.status(200).json({ sucesso: true, ...(await A.avisarLoja(db, tid, { titulo: 'Aviso de teste', corpo: 'É assim que o pedido novo vai aparecer.', url: '/admin.html', tag: 'teste' })) });
      return res.status(200).json({ sucesso: true });
    } catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); console.error('[avisos]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  // ESTE APARELHO ESTÁ NO PAINEL (lib/aparelhos.js): ao entrar e de 5 em 5 minutos. Aparelho novo, link aberto em outro
  // aparelho e acesso que parece compartilhado viram aviso no celular do dono. Aparelho desconectado recebe "bloqueado" e sai.
  if ((req.body || {}).acao === 'aparelho') {
    if (!T.temPapel(dec, tid, T.PAPEIS, { ignorarAparelho: true })) return res.status(403).json({ error: 'Esta conta não faz parte da equipe desta loja.' });
    try {
      const b = req.body || {}, como = ['link', 'link-outro-aparelho', 'passkey'].includes(b.como) ? b.como : '';
      const r = await Ap.registrar(db, { uid: dec.uid, email: dec.email || '', tid, aparelho: b.aparelho, ua: req.headers && req.headers['user-agent'], ip: H.ipDe(req), como, pais: String((req.headers && req.headers['cf-ipcountry']) || '').slice(0, 2) });
      if (r.erro) {
        for (const a of r.alertas || []) await P.alertar(db, tid, a.assunto, { titulo: a.titulo, corpo: a.corpo });       // 1 aviso por conta a cada 30 min
        return res.status(r.lotado ? 429 : 400).json({ error: r.erro });
      }
      if (r.novo) await anotar(req, tid, dec, 'aparelho-novo', `${Ap.nomeDoAparelho(req.headers && req.headers['user-agent'])}${como === 'link-outro-aparelho' ? ' (link aberto em outro aparelho)' : ''}`);
      for (const a of r.alertas || []) await P.alertar(db, tid, a.assunto, { titulo: a.titulo, corpo: a.corpo });
      // APROVAÇÃO (lib/aprovacao.js): o painel fica sabendo se este aparelho está aprovado e se precisa trocar o login
      let aprovacao = 'livre', trocar = false;
      if (!r.bloqueado && dec.plataforma !== true && (await Aprov.exige(db, tid))) {
        const sit = await Ap.situacao(db, dec.uid, b.aparelho);
        aprovacao = sit.doc && sit.doc.aprovado && sit.doc.aprovado[tid] ? 'aprovado' : 'pendente';
        trocar = aprovacao === 'aprovado' && !(Array.isArray(dec.apl) && dec.apl.includes(tid));
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ sucesso: true, bloqueado: !!r.bloqueado, aprovacao, trocar });
    } catch (e) { console.error('[aparelho]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  // LOGIN PRESO A ESTE APARELHO (lib/aprovacao.js): loja que exige aparelho aprovado só abre com o login que o
  // servidor dá aqui. Aparelho ainda não aprovado fica "aguardando" e o dono é avisado (uma vez).
  if ((req.body || {}).acao === 'sessao-aparelho') {
    if (!T.temPapel(dec, tid, T.PAPEIS, { ignorarAparelho: true })) return res.status(403).json({ error: 'Esta conta não faz parte da equipe desta loja.' });
    try {
      const b = req.body || {};
      if (!Ap.idValido(b.aparelho)) return res.status(400).json({ error: 'Aparelho inválido.' });
      res.setHeader('Cache-Control', 'no-store');
      if (dec.plataforma === true || !(await Aprov.exige(db, tid))) return res.status(200).json({ sucesso: true, livre: true });
      let sit = await Ap.situacao(db, dec.uid, b.aparelho);
      if (!sit.doc) {
        const r = await Ap.registrar(db, { uid: dec.uid, email: dec.email || '', tid, aparelho: b.aparelho, ua: req.headers && req.headers['user-agent'], ip: H.ipDe(req), pais: paisDe(req) });
        if (r.erro) return res.status(r.lotado ? 429 : 400).json({ error: r.erro });
        for (const a of r.alertas || []) await P.alertar(db, tid, a.assunto, { titulo: a.titulo, corpo: a.corpo });
        sit = await Ap.situacao(db, dec.uid, b.aparelho);
      }
      if (sit.bloqueado) return res.status(200).json({ sucesso: true, bloqueado: true });
      const u = await admin.auth().getUser(dec.uid);
      const lojas = Aprov.lojasAprovadas(sit.doc, u.customClaims);
      if (lojas.includes(tid)) return res.status(200).json({ sucesso: true, token: await Aprov.tokenDoAparelho(admin, dec.uid, sit.id, lojas) });
      const dono = ehDono(u.customClaims, tid);
      if (await Aprov.marcarPendente(db, tid, sit.id)) {
        const nome = (sit.doc && sit.doc.nome) || Ap.nomeDoAparelho(req.headers && req.headers['user-agent']);
        await anotar(req, tid, dec, 'aparelho-aguardando', nome);
        await P.alertar(db, tid, `aprovar-${sit.id}`, { titulo: 'Aparelho aguardando aprovação', corpo: `${quemE(dec)} quer entrar no painel por um aparelho novo (${nome}). Aprove ou negue em Equipe → Aparelhos.` });
        // aparelho novo do PRÓPRIO dono: se ele não tiver outro aparelho aprovado, quem aprova é a plataforma
        if (dono && tid !== T.TENANT_PADRAO) await P.alertar(db, T.TENANT_PADRAO, `aprovar-dono-${sit.id}`, { titulo: 'Proprietário aguardando aprovação', corpo: `${quemE(dec)} (proprietário de ${tid}) entrou por um aparelho novo. Se ele não tiver outro aparelho aprovado, aprove pela plataforma: abra o painel da loja → Equipe → Aparelhos.` });
      }
      return res.status(200).json({ sucesso: true, pendente: true, dono });
    } catch (e) { console.error('[sessao-aparelho]', e && e.message); return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' }); }
  }
  // CHAVE DOS DADOS DO CLIENTE (lib/cofre.js): só quem atende (os mesmos papéis que leem pedidos nas regras do banco).
  // O login foi conferido com "encerrado?" (verifyIdToken com true): quem saiu da equipe não recebe mais a chave.
  if ((req.body || {}).acao === 'chave-dados') {
    if (!T.temPapel(dec, tid, ['proprietario', 'administrador', 'gerente', 'funcionario', 'caixa'])) return res.status(403).json({ error: 'Sua conta não vê os dados dos clientes desta loja.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ sucesso: true, ligado: Cofre.ligado(), chave: Cofre.chaveParaPainel(tid) });
  }
  if (!T.temPapel(dec, tid, ['proprietario'])) return res.status(403).json({ error: 'Só o proprietário cuida da equipe desta loja.' });
  const acao = (req.body || {}).acao;
  try {
    if (acao === 'listar') return await listar(res, { tid });
    if (acao === 'auditoria') return res.status(200).json({ sucesso: true, registros: await P.lerAuditoria(db, tid, 40) });
    if (acao === 'definir') return await definir(req, res, { tid, dec });
    if (acao === 'remover') return await remover(req, res, { tid, dec });
    if (acao === 'aparelhos') {
      // com a aprovação ligada, todo aparelho ainda não aprovado (e não desconectado) aparece como aguardando
      const exige = await Aprov.exige(db, tid);
      return res.status(200).json({ sucesso: true, aprovacao: exige, aparelhos: (await Ap.listar(db, tid)).map((a) => ({ ...a, meu: a.uid === dec.uid, pendente: exige ? !a.aprovado && !a.bloqueado : false })) });
    }
    if (acao === 'aprovacao-estado') return res.status(200).json({ sucesso: true, ligado: await Aprov.exige(db, tid) });
    if (acao === 'aprovacao-definir') {
      const ligar = (req.body || {}).ligar === true, b = req.body || {};
      const r = await Aprov.definir(db, admin, tid, ligar, { extras: dec.plataforma === true ? [] : [dec.uid] });
      let token = null;
      if (ligar && dec.plataforma !== true && Ap.idValido(b.aparelho)) {
        // o aparelho de quem ligou fica aprovado na hora, e ele recebe o login novo para não ser trancado para fora
        let sit = await Ap.situacao(db, dec.uid, b.aparelho);
        if (!sit.doc) { await Ap.registrar(db, { uid: dec.uid, email: dec.email || '', tid, aparelho: b.aparelho, ua: req.headers && req.headers['user-agent'], ip: H.ipDe(req) }); sit = await Ap.situacao(db, dec.uid, b.aparelho); }
        if (sit.doc && !sit.bloqueado) {
          await Aprov.aprovar(db, tid, sit.id);
          const u = await admin.auth().getUser(dec.uid);
          token = await Aprov.tokenDoAparelho(admin, dec.uid, sit.id, Aprov.lojasAprovadas({ aprovado: { ...((sit.doc && sit.doc.aprovado) || {}), [tid]: true } }, u.customClaims));
        }
      }
      await anotar(req, tid, dec, 'aprovacao-aparelhos', ligar ? `ligada · ${r.aprovados} aparelho(s) que já entravam ficaram aprovados` : 'desligada');
      await P.alertar(db, tid, 'aprovacao', { titulo: ligar ? 'Aprovação de aparelho ligada' : 'Aprovação de aparelho desligada', corpo: ligar ? 'Aparelho novo da equipe agora só entra no painel depois que o proprietário aprovar.' : 'Aparelho novo da equipe volta a entrar sem aprovação (o aviso de aparelho novo continua).' });
      return res.status(200).json({ sucesso: true, ...r, token });
    }
    if (acao === 'aparelho-aprovar') {
      const id = String((req.body || {}).id || '');
      const s0 = /^[A-Za-z0-9_-]{10,120}$/.test(id) ? await db.collection('aparelhos').doc(id).get() : null;
      const ap = s0 && s0.exists ? s0.data() : null;
      if (!ap || !(ap.lojas || []).includes(tid)) return res.status(404).json({ error: 'Aparelho não encontrado nesta loja.' });
      if (ap.uid !== dec.uid && dec.plataforma !== true) {
        let alvo = null; try { alvo = await admin.auth().getUser(ap.uid); } catch (_) { alvo = null; }
        const c = (alvo && alvo.customClaims) || {};
        if (c.plataforma === true || ehDono(c, tid)) return res.status(403).json({ error: 'Aparelho de outro proprietário: só ele (de um aparelho já aprovado) ou a plataforma aprova.' });
      }
      await Aprov.aprovar(db, tid, id);
      await anotar(req, tid, dec, 'aparelho-aprovar', `${ap.email || ap.uid} · ${ap.nome || ''}`);
      return res.status(200).json({ sucesso: true });
    }
    if (acao === 'aparelho-desconectar' || acao === 'aparelho-liberar') {
      const id = String((req.body || {}).id || '');
      const s0 = /^[A-Za-z0-9_-]{10,120}$/.test(id) ? await db.collection('aparelhos').doc(id).get() : null;
      const ap = s0 && s0.exists ? s0.data() : null;
      if (!ap || !(ap.lojas || []).includes(tid)) return res.status(404).json({ error: 'Aparelho não encontrado nesta loja.' });
      if (ap.uid !== dec.uid) {
        let alvo = null; try { alvo = await admin.auth().getUser(ap.uid); } catch (_) { alvo = null; }
        const c = (alvo && alvo.customClaims) || {};
        if (c.plataforma === true || ehDono(c, tid)) return res.status(403).json({ error: 'Aparelho de proprietário ou da plataforma só a própria pessoa desconecta.' });
      }
      if (acao === 'aparelho-liberar') { await Ap.liberar(db, id); await anotar(req, tid, dec, 'aparelho-liberar', `${ap.email || ap.uid} · ${ap.nome || ''}`); return res.status(200).json({ sucesso: true }); }
      const r = await Ap.bloquear(db, id);
      // o login da conta é encerrado em TODOS os aparelhos dela (o Firebase não encerra um só); os outros aparelhos
      // dela entram de novo com o Face ID ou o link. Este fica bloqueado e as chaves de Face ID criadas nele somem.
      try { await admin.auth().revokeRefreshTokens(ap.uid); } catch (_) { /* segue: o bloqueio já vale */ }
      await anotar(req, tid, dec, 'aparelho-desconectar', `${ap.email || ap.uid} · ${ap.nome || ''}${r && r.chavesApagadas ? ` · ${r.chavesApagadas} chave(s) de Face ID apagada(s)` : ''}`);
      return res.status(200).json({ sucesso: true });
    }
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
