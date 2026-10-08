// =====================================================================
//  /api/checkout.js  —  VERSÃO CORRIGIDA (v3.1)
//  Substitui o antigo checkout.js na íntegra.
//
//  Correções principais vs. versão anterior:
//   [CRÍTICO] Itens "a pesar" (tipo 'un' de produto fracionável) NÃO
//             entram mais no total nem baixam estoque com qtd errada.
//   [CRÍTICO] O nº de WhatsApp agora vem de loja/config (não mais fixo).
//   [CRÍTICO] tipo/aPesar/precoOriginal são PERSISTIDOS no pedido, para
//             o fluxo de pesagem do admin funcionar.
//   [ALTO]    Persiste troco, obs e pag; mensagem de WhatsApp completa.
//   [ALTO]    status é recalculado no servidor (fonte de verdade).
//   [MÉDIO]   sanitizeString preserva acentos (não vira "Jos" p/ "José").
//   [MÉDIO]   Rate-limit em memória com poda (evita vazamento em warm start).
// =====================================================================

const admin = require('firebase-admin');

// ---------------------------------------------------------------------
// Helpers de dinheiro (centavos evitam erro de ponto flutuante)
// ---------------------------------------------------------------------
const paraCentavos   = (v) => Math.round(Number(v) * 100);
const paraFlutuante  = (c) => parseFloat((c / 100).toFixed(2));
const fixFloat       = (n) => Math.round(n * 1000) / 1000;
const fmtBRL         = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

// Teto padrão de quantidade por item em um pedido
const LIMITE_POR_ITEM = 50;

// Unidades que são vendidas por peso/volume (fracionáveis)
const FRACIONAVEIS = ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'];
const isFracionavel = (u) => FRACIONAVEIS.includes(String(u || '').toLowerCase());

// Preserva letras acentuadas; remove só o que é perigoso p/ layout/injeção
const sanitizeString = (str, maxLength = 120) => {
  if (str === null || str === undefined) return '';
  const limpo = String(str)
    .normalize('NFC')
    .replace(/[<>]/g, '')     // evita quebrar HTML no painel
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Corta por CARACTERE, não por unidade UTF-16: cortar um emoji ao meio deixava
  // meio caractere solto e a montagem do link do WhatsApp derrubava o pedido.
  return Array.from(limpo).slice(0, maxLength).join('').trim();
};

const { resolverDestinos } = require('../lib/roteamentoWhatsapp');

const WPP_FALLBACK = process.env.WHATSAPP_FALLBACK || '5562999999999';

// ---------------------------------------------------------------------
// CORS — lista de origens confiáveis
//
// POR QUE NÃO DEPENDE MAIS DE VARIÁVEL DE AMBIENTE:
// a versão anterior usava ALLOWED_ORIGIN e, se ela estivesse errada ou
// ausente, o site bloqueava a si mesmo — o navegador da cliente manda a
// requisição de um domínio e o servidor autoriza outro. Como a banca tem
// três endereços válidos (domínio próprio com e sem "www", mais o da
// Vercel), agora conferimos de qual deles a chamada veio e devolvemos
// exatamente esse. Funciona nos três sem configurar nada.
//
// ALLOWED_ORIGIN continua sendo lida e ACRESCENTA origens à lista
// (aceita várias separadas por vírgula), mas não é mais obrigatória.
// ---------------------------------------------------------------------
// Origem (CORS): a lista de endereços nossos fica num lugar só, lib/http.js.
const H = require('../lib/http');
const aplicarCors = H.cors;

// ---------------------------------------------------------------------
// Boot do Firebase Admin (singleton entre invocações "warm")
// ---------------------------------------------------------------------
const formatPrivateKey = (key) =>
  key ? key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '';

let db;
const bootFirebase = () => {
  if (!admin.apps.length) {
    const projectId  = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Variáveis do Firebase ausentes no ambiente.');
    }
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  }
  if (!db) db = admin.firestore();
};

// ---------------------------------------------------------------------
// Montagem da mensagem de WhatsApp (agora com "a pesar", troco e obs)
// ---------------------------------------------------------------------
// Texto sem meio-caractere solto (encodeURIComponent lança erro nesses casos)
const textoSeguro = (t) => (typeof t.toWellFormed === 'function' ? t.toWellFormed() : t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''));

// Hoje no horário de Brasília (o servidor roda em UTC: sem isto, das 21h à
// meia-noite ele já estava "amanhã" — recusava pedido de sábado à noite com
// "a loja não abre hoje" e somava a venda no resumo do dia seguinte).
const agoraBrasilia = () => new Date(Date.now() - 3 * 3600000);

const { linhaEndereco } = require('../lib/endereco');
const T = require('../lib/tenant');
const Avisos = require('../lib/avisos');
const P = require('../lib/prudencia');
const Entrega = require('../lib/entrega');
const E = require('../lib/estoque');
const Conta = require('../lib/conta');
const Feira = require('../lib/feira');

function montarTextoWhatsApp(pedido, numero) {
  const dividido = pedido.parte && pedido.parte.de > 1;
  const primeira = !dividido || pedido.parte.n === 1;
  // Observação do cliente vai em todas as partes; a linha do cupom, só na 1ª
  const cupom = pedido.cupom && pedido.cupom.codigo ? pedido.cupom : null;
  const obsCliente = cupom ? String(pedido.obs || '').replace(/\s*\|?\s*🎁 Cupom .*$/u, '').trim() : String(pedido.obs || '');

  let msg = dividido ? `*NOVO PEDIDO — parte ${pedido.parte.n} de ${pedido.parte.de}*\n` : `*NOVO PEDIDO*\n`;
  msg += `👤 ${pedido.nome}\n`;
  msg += `📍 ${linhaEndereco(pedido)}\n`;
  // pedido feito fora do dia da feira: vai para o próximo dia de feira
  if (pedido.feiraId && pedido.entregaDia && pedido.paraHoje === false) msg += `📅 Para: *${Feira.textoDoDia(pedido.entregaDia)}*\n`;
  if (pedido.entrega && pedido.entrega.horario) msg += `🕒 Entrega: ${pedido.entrega.horario}\n`;
  else if (pedido.entrega && pedido.entrega.horarioACombinar) msg += `🕒 Entrega: horário a combinar\n`;
  msg += `💳 Pagamento: ${pedido.pag || 'A combinar'}\n`;
  // Pedido dividido: troco e cupom aparecem UMA vez (na 1ª parte), para dois
  // atendimentos não darem o mesmo troco nem o mesmo desconto.
  if (pedido.troco && primeira) msg += `💵 Troco para: ${pedido.troco}\n`;
  msg += `\n*ITENS${dividido ? ' DESTA PARTE' : ''}:*\n`;

  (pedido.itens || []).forEach((i) => {
    if (i.aPesar) {
      msg += `• ${i.qtd} un de ${i.nome}  ⚖️ _(a pesar na balança)_\n`;
    } else {
      const rotulo = isFracionavel(i.unidade) ? `${String(i.qtd).replace('.', ',')} ${i.unidade}` : `${i.qtd}x`;
      msg += `• ${rotulo} ${i.nome} — ${fmtBRL(i.subtotal)}\n`;
    }
  });

  if (dividido) {
    msg += `\n*Itens desta parte: ${fmtBRL(pedido.total)}*`;
    if (cupom && primeira) msg += `\n🎁 Cupom ${cupom.codigo}: -${fmtBRL(cupom.desconto)} no total do pedido`;
    if (primeira && pedido.entrega && Number(pedido.entrega.taxa) > 0) msg += `\n🛵 Entrega: ${fmtBRL(Number(pedido.entrega.taxa))} no total do pedido`;
    msg += `\n🧾 Total do pedido inteiro${cupom ? ' (já com o cupom)' : ''}: ${fmtBRL(pedido.totalGeral)}`;
    msg += `\n📦 _Os outros itens foram para outro WhatsApp da banca.${primeira ? '' : ' Troco e cupom, se houver, estão na parte 1.'}_`;
  } else {
    if (cupom) msg += `\n🎁 Cupom ${cupom.codigo}: -${fmtBRL(cupom.desconto)}`;
    const taxa = pedido.entrega && Number(pedido.entrega.taxa) > 0 ? Number(pedido.entrega.taxa) : 0;
    if (taxa) msg += `\n🛵 Entrega: ${fmtBRL(taxa)}`;
    else if (pedido.entrega && Number(pedido.entrega.taxaCheia) > 0) msg += `\n🛵 Entrega grátis`;
    msg += `\n*${cupom || taxa ? 'Total' : 'Subtotal'} (itens já pesados): ${fmtBRL(pedido.total)}*`;
  }
  if (pedido.temItensAPesar) {
    msg += `\n➕ _Os itens marcados com ⚖️ serão pesados e o valor final ajustado._`;
  }
  if (obsCliente) msg += `\n\n📝 Obs: ${obsCliente}`;
  // LINK PESSOAL do cliente (lib/conta.js): fica na conversa dele com a loja e devolve nome, endereço e pedidos
  // em outro aparelho. Vai uma vez só (na 1ª parte), sempre no fim, para não atrapalhar a leitura do pedido.
  if (pedido.linkAcesso && primeira) msg += `\n\n🔑 Meu acesso à loja (guarde esta mensagem): ${pedido.linkAcesso}`;

  return `https://wa.me/${numero}?text=${encodeURIComponent(textoSeguro(msg))}`;
}


// Monta 1 link por número de destino (ver lib/roteamentoWhatsapp.js)
function montarLinksWhatsApp(pedido, categorias, config) {
  const destinos = resolverDestinos({ itens: pedido.itens, categorias, config, fallback: WPP_FALLBACK });
  return destinos.map((d, i) => {
    const sub = d.itens.reduce((t, it) => t + (it.aPesar ? 0 : Number(it.subtotal) || 0), 0);
    const unico = destinos.length === 1;
    const parte = { ...pedido, itens: d.itens,
      total: unico ? pedido.total : Math.round(sub * 100) / 100,     // com 1 destino, o total já vem com o cupom
      temItensAPesar: d.itens.some((it) => it.aPesar), parte: { n: i + 1, de: destinos.length }, totalGeral: pedido.total };
    return { nome: d.nome, qtdItens: d.itens.length, url: montarTextoWhatsApp(parte, d.numero) };
  });
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
module.exports = async function handler(req, res) {
  aplicarCors(req, res, 'OPTIONS,POST');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const ip = H.ipDe(req);

  // CONTA DO CLIENTE (crachá, link pessoal, link gerado pelo painel): mesma função, outras ações. Ver lib/conta.js.
  const acaoConta = req.body && Conta.ehAcao(req.body.acao) ? req.body.acao : '';
  // quem nunca pediu não tem crachá: responde na hora, sem abrir o banco
  if (acaoConta === 'conta-ver' && !Conta.lerCookie(req, T.tenantDaRequisicao(req) || '')) return res.status(200).json({ sucesso: true, conta: null });
  if (acaoConta) {
    if (H.passouNaMemoria(`conta-acao:${ip}`, 60, 60000)) return res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde um minuto.' });
    try { bootFirebase(); } catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }
    let lojaDaConta;
    try { lojaDaConta = (await T.resolverLoja(db, req)).tid; } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    return Conta.tratar({ db, admin, req, res, tid: lojaDaConta, acao: acaoConta });
  }

  // Primeira barreira, de memória (barata): rajada da mesma conexão. O toque repetido no botão não cria pedido
  // em dobro de qualquer jeito (a chave do pedido garante); isto só segura quem dispara dezenas por segundo.
  // O limite que vale para todas as cópias do servidor vem logo abaixo, contado no banco.
  if (H.passouNaMemoria(`pedido:${ip}`, 4, 10000)) return res.status(429).json({ error: 'Aguarde alguns segundos antes de enviar outro pedido.' });

  try { bootFirebase(); }
  catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }

  // Qual loja? (cabeçalho X-Loja; sem ele, a loja original). Só diz ONDE olhar.
  let tid;
  try { ({ tid } = await T.resolverLoja(db, req)); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  // Limite de verdade: contado no banco (vale para todas as cópias do servidor e não zera sozinho).
  // 8 pedidos em 10 minutos, por conexão, é folga de sobra para uma família e pouco para quem quer encher a loja de pedido falso.
  const conexao = ip || 'desconhecida';
  if (!(await P.limitar(db, 'pedido', `${tid}|${conexao}`, 8, 600))) return res.status(429).json({ error: 'Muitos pedidos seguidos desta conexão. Aguarde alguns minutos e tente de novo.' });
  // Fusível da LOJA INTEIRA: nenhuma banca de bairro recebe 150 pedidos em 10 minutos. Se chegar a isso, é ataque
  // vindo de muitas conexões ao mesmo tempo, e o freio por conexão não pega. (CHECKOUT_TETO_LOJA muda o número.)
  const tetoLoja = Number(process.env.CHECKOUT_TETO_LOJA) > 0 ? Number(process.env.CHECKOUT_TETO_LOJA) : 150;
  if (!(await P.limitar(db, 'pedido-loja', tid, tetoLoja, 600))) {
    await P.avisarFalha(db, tid, 'A fila de pedidos (pedidos demais em pouco tempo)', new Error('teto de pedidos da loja atingido'));
    return res.status(429).json({ error: 'A loja está recebendo pedidos demais agora. Tente de novo em alguns minutos ou chame no WhatsApp.' });
  }


  // -------------------------------------------------------------------
  // DE QUEM É ESTE PEDIDO?
  //
  // O `userId` do corpo da requisição serve só como pista. Quem manda é o
  // token do Firebase, assinado pelo Google: dele tiramos o uid de verdade.
  // Isso importa porque o cancelamento pela loja compara o dono do pedido
  // com o uid do token — se aqui a gente aceitasse qualquer texto enviado
  // pelo navegador, alguém poderia registrar um pedido no nome de outra
  // pessoa, ou tornar o próprio pedido impossível de cancelar.
  //
  // Sem token (ex.: login anônimo falhou), o pedido entra como 'anonimo':
  // a venda acontece normalmente, só não dá para cancelar pelo site depois.
  // -------------------------------------------------------------------
  let donoVerificado = 'anonimo';
  const cabecalhoAuth = String((req.headers && req.headers.authorization) || '');
  if (cabecalhoAuth.startsWith('Bearer ')) {
    try {
      const decodificado = await admin.auth().verifyIdToken(cabecalhoAuth.slice(7).trim());
      donoVerificado = decodificado.uid;
    } catch (e) {
      console.warn('[checkout] token inválido; pedido seguirá como anônimo.');
    }
  }

  // Validação de entrada
  // Nota: userId NÃO é lido do corpo de propósito — ver donoVerificado acima.
  let { nome, quadra, lote, telefone, pag, troco, obs, cupom, itens, idempotencyKey, condominio, condominioId, formatoEndereco, aceitaOfertas } = req.body || {};
  if (!idempotencyKey || !nome || !quadra || !lote || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Dados do pedido incompletos.' });
  }
  if (itens.length > 100) return res.status(400).json({ error: 'Pedido excede o limite de itens.' });
  // A chave do pedido e o id de cada produto viram NOME DE DOCUMENTO no banco. Antes entravam como vieram:
  // uma barra ("a/b/c") gravava o pedido fora da lista de pedidos (baixava o estoque e sumia do painel), e um
  // valor que não é texto derrubava o servidor por dentro e disparava o alerta de "problema no site".
  if (!H.idSeguro(idempotencyKey, 8, 80)) return res.status(400).json({ error: 'Não consegui identificar este pedido. Atualize a página e tente de novo.' });
  const idDeProduto = (v) => { const x = typeof v === 'number' ? String(v) : v; return typeof x === 'string' && x.length >= 1 && x.length <= 120 && !/[\/\u0000-\u001f]/.test(x) && x !== '.' && x !== '..' && !/^__.*__$/.test(x) ? x : null; };
  for (const i of itens) {
    const id = i && typeof i === 'object' ? idDeProduto(i.id) : null;
    if (id === null) return res.status(400).json({ error: 'Um produto do carrinho não foi reconhecido. Atualize a página e monte o carrinho de novo.' });
    i.id = id;
  }
  // Cupom: letras, números, hífen e sublinhado. Qualquer outra coisa nem chega a ser procurada no banco.
  if (cupom !== undefined && cupom !== null && cupom !== '') {
    const c = typeof cupom === 'string' ? cupom.trim().toUpperCase() : '';
    if (!/^[A-Z0-9_-]{1,40}$/.test(c)) return res.status(400).json({ error: 'Cupom não encontrado.' });
    // (chutar cupom já é freado pelo limite de pedidos por conexão: cada tentativa conta como um pedido)
    cupom = c;
  } else cupom = '';

  nome   = sanitizeString(nome, 100);
  quadra = sanitizeString(quadra, 60);   // também guarda o nome da rua, nos condomínios que usam rua + número
  // Condomínio: opcional AQUI de propósito. Celular com a versão antiga da loja
  // guardada ainda envia pedido sem esse campo, e não pode ser recusado.
  condominio = sanitizeString(condominio, 60);
  condominioId = sanitizeString(condominioId, 40).replace(/[^\w-]/g, '');
  formatoEndereco = ['rua', 'livre'].includes(formatoEndereco) ? formatoEndereco : 'ql';
  // Telefone é opcional; guardamos só dígitos para montar o link do WhatsApp depois.
  telefone = String(telefone || '').replace(/\D/g, '').slice(0, 13);
  lote   = sanitizeString(lote, 30);
  pag    = sanitizeString(pag, 30);
  troco  = sanitizeString(troco, 40);
  obs    = sanitizeString(obs, 300);

  // CONTA DO CLIENTE: de onde pode vir a conta deste pedido (crachá ou login deste aparelho). Ver lib/conta.js.
  const achado = await Conta.localizar(db, tid, req, donoVerificado);
  let codigoConta = '';
  // FEIRA do cliente (link da feira ou condomínio). Só vale se ESTA loja estiver nela; senão o pedido segue como sempre.
  // Ela decide PARA QUANDO é o pedido (hoje, ou o próximo dia de feira).
  const feiraDoPedido = await Feira.daLoja(db, tid, req.body && req.body.feira);

  try {
    const resultado = await db.runTransaction(async (t) => {
      codigoConta = '';                                  // a transação pode rodar de novo: começa limpo
      const pedidoRef = T.tdoc(db, tid, 'pedidos', idempotencyKey);
      const configRef = T.docDe(db, tid, 'loja/config');
      const contaRef = Conta.refCandidata(db, tid, achado);

      // ---- TODAS as leituras ANTES de qualquer escrita (regra do Firestore) ----
      const [pedidoSnap, configSnap, catsSnap, contaSnap] = await Promise.all([t.get(pedidoRef), t.get(configRef), t.get(T.tcol(db, tid, 'categorias')), contaRef ? t.get(contaRef) : null]);
      const categoriasCfg = catsSnap.docs.map((c) => c.data());
      const configCfg = configSnap.exists ? configSnap.data() : {};

      // Idempotência: pedido já criado -> retorna o mesmo resultado
      if (pedidoSnap.exists) {
        const d = pedidoSnap.data();
        // A mesma chave vinda de OUTRA pessoa (ou batendo numa venda do balcão) não recebe os dados do pedido de volta.
        if (d.origem === 'balcao' || (d.userId && d.userId !== 'anonimo' && d.userId !== donoVerificado)) throw Object.assign(new Error('Não consegui identificar este pedido. Atualize a página e tente de novo.'), { status: 409 });
        codigoConta = await Conta.codigoDoReenvio(t, db, tid, d, achado, donoVerificado);
        const links = montarLinksWhatsApp({ ...d, ...(codigoConta ? { linkAcesso: Conta.linkDeAcesso(req, tid, codigoConta) } : {}) }, categoriasCfg, configCfg);
        return { id: pedidoRef.id, total: d.total, temItensAPesar: !!d.temItensAPesar,
                 whatsappMsg: links[0].url, whatsapps: links };
      }

      // Loja fechada? (defesa extra além do front)
      // Cliente de feira: fora do dia da feira o pedido é aceito para o próximo dia de feira (o "fechar a loja" continua valendo).
      let entrega = null;
      if (configSnap.exists && configSnap.data().lojaAberta === false) throw new Error('A loja está fechada no momento.');
      if (feiraDoPedido) {
        entrega = Feira.proximaEntrega(feiraDoPedido, Date.now());
        if (!entrega) throw new Error('Esta feira está sem data marcada. Fale com a banca pelo WhatsApp.');
      } else if (configSnap.exists) {
        const diasAbertos = configSnap.data().diasAbertos || [0, 1, 2, 3, 4, 5, 6];
        if (!diasAbertos.includes(agoraBrasilia().getUTCDay())) throw new Error('A loja não abre hoje.');
      }

      // dia da semana que decide o preço: o da entrega (feira) ou hoje, em Brasília
      const diaDoPreco = entrega ? entrega.dow : agoraBrasilia().getUTCDay();

      // O mesmo produto duas vezes no pedido baixaria o estoque só pela última linha
      const idsVistos = new Set();
      for (const i of itens) {
        if (idsVistos.has(i.id)) throw new Error('Há um produto repetido no pedido. Atualize a página e monte o carrinho de novo.');
        idsVistos.add(i.id);
      }

      const prodSnaps = await Promise.all(itens.map((i) => t.get(T.docDe(db, tid, `produtos/${i.id}`))));

      // O cupom também é lido AQUI: no Firestore, toda leitura de uma
      // transação tem que acontecer antes da primeira escrita.
      const codigoCupom = cupom;                 // já conferido e em maiúsculas lá em cima
      const cupomSnap = codigoCupom ? await t.get(T.docDe(db, tid, `cupons/${codigoCupom}`)) : null;

      // ---- Cálculo (ainda sem escrever) ----
      let totalExatoCentavos = 0;
      const itensValidados = [];
      const estoqueUpdates = [];

      itens.forEach((item, idx) => {
        const snap = prodSnaps[idx];
        if (!snap.exists) throw new Error(`Um produto do carrinho não existe mais.`);
        const p = snap.data();
        if (p.ativo === false) throw new Error(`"${p.nome}" está esgotado.`);
        if (p.soInsumo === true) throw new Error(`"${p.nome}" não está à venda.`);   // só ingrediente de ficha técnica

        // Produto sem preço (ou com preço que não é número) não é vendido: antes isso virava "NaN" no total do
        // pedido e ESTRAGAVA o caixa do dia e o total geral da loja, que são somas.
        const precoN = typeof p.preco === 'number' ? p.preco : Number(String(p.preco == null ? '' : p.preco).replace(',', '.'));
        if (!Number.isFinite(precoN) || precoN <= 0 || precoN > 100000) throw new Error(`"${p.nome}" está sem preço. Chame a loja no WhatsApp.`);
        // PREÇO DO DIA DA ENTREGA (preço por dia da semana; oferta ligada vence). Nunca o preço que veio do navegador.
        p.preco = Feira.precoDoDia({ ...p, preco: precoN }, diaDoPreco);
        const fracionavel = isFracionavel(p.unidade);
        // tipo escolhido pelo cliente; produto não-fracionável é sempre 'un'
        const tipo = (item.tipo === 'un') ? 'un' : (fracionavel ? 'kg' : 'un');
        const aPesar = fracionavel && tipo === 'un';

        // qtd inteira para unidade; float para peso
        let qtd = Number(String(item.qtd).replace(',', '.'));
        if (!Number.isFinite(qtd) || qtd <= 0) throw new Error(`Quantidade inválida para "${p.nome}".`);
        // Teto por item: evita pedido absurdo ("999999 kg de tomate") entrando
        // na fila. O limite pode ser afrouxado por produto com maxPorPedido.
        const teto = Number(p.maxPorPedido) > 0 ? Number(p.maxPorPedido) : LIMITE_POR_ITEM;
        if (qtd > teto) {
          throw new Error(`O máximo por pedido de "${p.nome}" é ${teto}. Para quantidade maior, chame no WhatsApp.`);
        }
        qtd = (aPesar || !fracionavel) ? Math.round(qtd) : fixFloat(qtd);
        // "0,4 unidade" arredondava para zero e entrava no pedido como quantidade 0
        if (qtd <= 0) throw new Error(`Quantidade inválida para "${p.nome}".`);

        if (aPesar) {
          // NÃO soma no total (preço só após pesagem) e NÃO baixa estoque por unidade
          itensValidados.push({
            id: item.id, nome: p.nome, cat: p.cat || '', qtd, tipo: 'un', aPesar: true,
            precoOriginal: p.preco, unidade: p.unidade || 'un', subtotal: 0,
          });
        } else {
          const subC = Math.round(paraCentavos(p.preco) * qtd);
          totalExatoCentavos += subC;
          itensValidados.push({
            id: item.id, nome: p.nome, cat: p.cat || '', qtd, tipo, aPesar: false,
            preco: p.preco, precoOriginal: p.preco, unidade: p.unidade || 'un',
            subtotal: paraFlutuante(subC),
          });
          // Baixa de estoque só para itens de valor fechado
          if (p.estoqueFisico !== null && p.estoqueFisico !== undefined && p.estoqueFisico !== '') {
            const novo = fixFloat(Number(p.estoqueFisico) - qtd);
            if (novo < 0) throw new Error(`"${p.nome}" não tem estoque suficiente.`);
            estoqueUpdates.push([snap.ref, { estoqueFisico: novo, ativo: novo > 0 }, { produtoId: item.id, nome: p.nome, unidade: p.unidade, delta: -qtd, saldo: novo, custoUnit: p.custo }]);
          }
        }
      });

      // ---- Cupom ----
      // CORRIGIDO: antes existia um cupom fixo no código ('IA-DESCONTO-10')
      // que dava 10% para sempre, sem validade nem limite de uso, e que nem
      // aparecia na tela — só era alcançável chamando a API por fora do site.
      // Agora o cupom precisa existir na coleção "cupons" do Firestore,
      // estar ativo, dentro da validade e com usos disponíveis.
      let obsFinal = obs;
      let cupomAplicado = null;

      if (cupomSnap && cupomSnap.exists) {
        const c = cupomSnap.data();
        const agora = new Date();
        // A data vem como "2026-07-24" (só o dia). new Date() nesse formato
        // devolve meia-noite em UTC, que no Brasil é 21h do dia ANTERIOR —
        // então um cupom "válido até 24" morreria durante todo o dia 24.
        // Empurramos para o fim do dia no horário de Brasília (UTC-3).
        const validoAte = c.validoAte ? new Date(`${c.validoAte}T23:59:59-03:00`) : null;
        const usos = Number(c.usos || 0);
        const limite = c.limiteUsos === null || c.limiteUsos === undefined ? Infinity : Number(c.limiteUsos);
        const minimo = paraCentavos(c.minimoCompra || 0);

        if (c.ativo === false)                    throw new Error('Este cupom está desativado.');
        if (validoAte && !isNaN(validoAte) && agora > validoAte) throw new Error('Este cupom já venceu.');
        if (usos >= limite)                       throw new Error('Este cupom atingiu o limite de usos.');
        if (totalExatoCentavos < minimo)          throw new Error(`Este cupom vale para pedidos a partir de ${fmtBRL(c.minimoCompra)}.`);

        // Desconto: percentual OU valor fixo (o que estiver cadastrado)
        let descC = 0;
        if (Number(c.percentual) > 0) {
          descC = Math.round(totalExatoCentavos * (Number(c.percentual) / 100));
        } else if (Number(c.valorFixo) > 0) {
          descC = paraCentavos(c.valorFixo);
        }
        // Nunca deixa o total ficar negativo
        descC = Math.min(descC, totalExatoCentavos);

        // cupom em % vale mesmo se o pedido só tem itens a pesar (o desconto entra na balança)
        if (descC > 0 || Number(c.percentual) > 0) {
          totalExatoCentavos -= descC;
          // percentual guardado no pedido: a pesagem aplica o mesmo desconto ao que ainda vai para a balança
          const pct = Number(c.percentual) > 0 ? Math.min(100, Number(c.percentual)) : 0;
          cupomAplicado = { codigo: cupomSnap.id, desconto: paraFlutuante(descC), percentual: pct, especial: c.foraDaPrevisao === true, ref: cupomSnap.ref };
          obsFinal = `${obs ? obs + ' | ' : ''}🎁 Cupom ${cupomSnap.id} (-${fmtBRL(paraFlutuante(descC))})`;
        }
      } else if (cupom) {
        throw new Error('Cupom não encontrado.');
      }

      // ---- Entrega: taxa (grátis acima de um valor) e horário escolhido ----
      // A taxa é calculada aqui, com a configuração da loja: o navegador só mostra a prévia.
      // Com item a pesar, o valor ainda sobe na balança: a pesagem reavalia a entrega grátis.
      const cfgEntrega = Entrega.lerConfig(configCfg);
      const horarioEntrega = Entrega.horarioValido(cfgEntrega, req.body && req.body.horarioEntrega);
      // cupom de 100% (família, cortesia): o pedido sai de graça, entrega incluída
      const cortesia = !!cupomAplicado && cupomAplicado.percentual >= 100;
      const taxaEntregaC = cortesia ? 0 : Entrega.taxaC(cfgEntrega, totalExatoCentavos);
      totalExatoCentavos += taxaEntregaC;

      const totalExato = paraFlutuante(totalExatoCentavos);
      const temItensAPesar = itensValidados.some((i) => i.aPesar);

      // conta do cliente: usa a que existe (crachá ou login deste aparelho) ou cria uma
      const conta = Conta.decidir(db, tid, achado, contaSnap, donoVerificado);

      const dadosPedido = {
        id: pedidoRef.id,
        tenantId: tid,
        userId: donoVerificado,
        clienteId: conta.cid,     // ID do cliente: liga os pedidos da mesma pessoa, em qualquer aparelho
        nome, quadra, lote, telefone: telefone || '', pag, troco: troco || '', obs: obsFinal || '',
        condominio, condominioId, formatoEndereco,
        aceitaOfertas: aceitaOfertas === true && !!telefone,   // consentimento para receber ofertas no WhatsApp (LGPD)
        itens: itensValidados,
        total: totalExato,        // total dos itens de valor fechado
        clientTotal: totalExato,  // usado pelo painel de pesagem como base
        temItensAPesar,
        ...(cupomAplicado && cupomAplicado.especial ? { foraDaPrevisao: true } : {}),   // cupom especial (família, cortesia): o motor de previsão ignora este pedido
        cupom: cupomAplicado ? { codigo: cupomAplicado.codigo, desconto: cupomAplicado.desconto, ...(cupomAplicado.percentual ? { percentual: cupomAplicado.percentual } : {}) } : null,
        // taxa cobrada agora + a regra do dia do pedido (a pesagem usa para reavaliar a entrega grátis)
        entrega: { taxa: paraFlutuante(taxaEntregaC), taxaCheia: paraFlutuante(cfgEntrega.taxaC), gratisAcima: paraFlutuante(cfgEntrega.gratisAcimaC), horario: horarioEntrega, ...(Entrega.horarioACombinar(cfgEntrega, horarioEntrega) ? { horarioACombinar: true } : {}) },
        status: temItensAPesar ? 'aguardando_pesagem' : 'pendente',
        data: new Date().toISOString(),
        // PARA QUANDO é o pedido. Caixa do dia, fechamento e previsão contam por esta data.
        entregaDia: entrega ? entrega.dia : Feira.hojeBR(),
        ...(entrega ? { feiraId: feiraDoPedido.id, paraHoje: entrega.hoje } : {}),
        origem: 'whatsapp',
      };

      // ---- Agora sim, as escritas ----
      estoqueUpdates.forEach(([ref, patch]) => t.update(ref, patch));
      // histórico do estoque: uma linha por produto com estoque controlado
      E.registrarMovs(t, db, tid, estoqueUpdates.map(([, , m]) => ({ ...m, tipo: 'venda', pedidoId: pedidoRef.id })), admin.firestore.FieldValue);
      if (cupomAplicado) {
        t.update(cupomAplicado.ref, { usos: admin.firestore.FieldValue.increment(1) });
      }
      t.set(pedidoRef, dadosPedido);
      conta.escrever(t, dadosPedido); codigoConta = conta.codigo;
      t.set(T.docDe(db, tid, 'analytics/dashboard'), {
        receitaTotal: admin.firestore.FieldValue.increment(totalExato),
        totalPedidos: admin.firestore.FieldValue.increment(1),
      }, { merge: true });

      // Resumo por dia (ex.: resumos/2026-07-24).
      // Hoje o Balanço ainda lê os pedidos um por um, o que funciona bem no
      // volume atual. Estes resumos começam a acumular a partir de agora para
      // que, quando houver histórico longo, o Balanço possa somar 30 documentos
      // em vez de reler centenas de pedidos.
      const diaChave = dadosPedido.entregaDia;   // dia da ENTREGA (pedido para a próxima feira cai no caixa daquele dia)
      t.set(T.docDe(db, tid, `resumos/${diaChave}`), {
        dia: diaChave,
        receita: admin.firestore.FieldValue.increment(totalExato),
        pedidos: admin.firestore.FieldValue.increment(1),
        atualizadoEm: new Date().toISOString(),
      }, { merge: true });

      const links = montarLinksWhatsApp({ ...dadosPedido, linkAcesso: Conta.linkDeAcesso(req, tid, conta.codigo) }, categoriasCfg, configCfg);
      return { id: pedidoRef.id, total: totalExato, temItensAPesar, entregaDia: dadosPedido.entregaDia, paraHoje: entrega ? entrega.hoje : true,
               whatsappMsg: links[0].url, whatsapps: links };
    });

    // Aviso no celular da equipe. Espera no máximo ~3 s e nunca derruba o pedido, que já está gravado.
    await Avisos.avisarLoja(db, tid, {
      titulo: resultado.temItensAPesar ? 'Pedido novo (tem item a pesar)' : 'Pedido novo',
      corpo: `${nome} · ${Number(resultado.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${resultado.temItensAPesar ? ' + itens a pesar' : ''}`,
      url: tid === T.TENANT_PADRAO ? '/admin.html' : `/admin.html?loja=${tid}`, tag: `pedido-${resultado.id}`,
    });

    // o crachá vai num cookie que só o servidor lê; a página só fica sabendo que a conta existe
    if (codigoConta) Conta.porCookie(res, tid, codigoConta);
    return res.status(200).json({ sucesso: true, pedido: resultado, temConta: !!codigoConta });
  } catch (error) {
    // Falha NOSSA (banco fora do ar, erro de programa): a equipe recebe um aviso no celular, e a
    // cliente vê uma frase simples em vez do erro técnico. Aviso de regra ("esgotado") segue como era.
    if (P.ehFalhaInterna(error)) {
      await P.avisarFalha(db, tid, 'O envio de pedidos', error);
      return res.status(500).json({ error: 'Não consegui registrar o pedido agora. Tente de novo em instantes.' });
    }
    return res.status(400).json({ error: error.message || 'Não foi possível registrar o pedido.' });
  }
};
