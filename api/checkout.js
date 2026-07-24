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

let kv;
try { kv = require('@vercel/kv').kv; } catch (e) { /* KV opcional */ }

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
  return String(str)
    .normalize('NFC')
    .replace(/[<>]/g, '')     // evita quebrar HTML no painel
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
};

const WPP_FALLBACK = process.env.WHATSAPP_FALLBACK || '5562999999999';
const resolveWpp = (configSnap) => {
  const raw = configSnap && configSnap.exists ? configSnap.data().wpp : null;
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : WPP_FALLBACK;
};

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
const ORIGENS_CONFIAVEIS = [
  'https://www.bancaadairepedrina.com.br',
  'https://bancaadairepedrina.com.br',
  'https://site-banca1.vercel.app',
];

const aplicarCors = (req, res, metodos) => {
  const extras = String(process.env.ALLOWED_ORIGIN || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const permitidas = ORIGENS_CONFIAVEIS.concat(extras);
  const origem = req.headers && req.headers.origin;

  if (origem && permitidas.indexOf(origem) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origem);
  } else if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', '*'); // preview e dev
  } else {
    res.setHeader('Access-Control-Allow-Origin', permitidas[0]);
  }

  // Sem o Vary, um proxy poderia servir a resposta de um domínio para outro.
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', metodos || 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

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
// Rate limit fallback em memória (com poda p/ não vazar)
// ---------------------------------------------------------------------
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 5000;
const pruneRateLimit = () => {
  const agora = Date.now();
  for (const [ip, ts] of rateLimitMap) {
    if (agora - ts > RATE_WINDOW_MS) rateLimitMap.delete(ip);
  }
};

// ---------------------------------------------------------------------
// Montagem da mensagem de WhatsApp (agora com "a pesar", troco e obs)
// ---------------------------------------------------------------------
function montarTextoWhatsApp(pedido, numero) {
  let msg = `*NOVO PEDIDO*\n`;
  msg += `👤 ${pedido.nome}\n`;
  msg += `📍 Quadra ${pedido.quadra} • Lote ${pedido.lote}\n`;
  msg += `💳 Pagamento: ${pedido.pag || 'A combinar'}\n`;
  if (pedido.troco) msg += `💵 Troco para: ${pedido.troco}\n`;
  msg += `\n*ITENS:*\n`;

  (pedido.itens || []).forEach((i) => {
    if (i.aPesar) {
      msg += `• ${i.qtd} un de ${i.nome}  ⚖️ _(a pesar na balança)_\n`;
    } else {
      const und = isFracionavel(i.unidade) ? ` ${i.unidade}` : 'x';
      const rotulo = isFracionavel(i.unidade) ? `${i.qtd}${und}` : `${i.qtd}x`;
      msg += `• ${rotulo} ${i.nome} — ${fmtBRL(i.subtotal)}\n`;
    }
  });

  msg += `\n*Subtotal (itens já pesados): ${fmtBRL(pedido.total)}*`;
  if (pedido.temItensAPesar) {
    msg += `\n➕ _Os itens marcados com ⚖️ serão pesados e o valor final ajustado._`;
  }
  if (pedido.obs) msg += `\n\n📝 Obs: ${pedido.obs}`;

  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
module.exports = async function handler(req, res) {
  aplicarCors(req, res, 'OPTIONS,POST');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  // Rate limit
  try {
    if (kv && process.env.KV_REST_API_URL) {
      const n = await kv.incr(`checkout:${ip}`);
      if (n === 1) await kv.expire(`checkout:${ip}`, 20);
      if (n > 3) return res.status(429).json({ error: 'Aguarde antes de enviar um novo pedido.' });
    } else {
      pruneRateLimit();
      const ultimo = rateLimitMap.get(ip);
      if (ultimo && Date.now() - ultimo < RATE_WINDOW_MS) {
        return res.status(429).json({ error: 'Processando o pedido anterior...' });
      }
      rateLimitMap.set(ip, Date.now());
    }
  } catch (e) { /* nunca bloqueia o pedido por falha do limitador */ }

  try { bootFirebase(); }
  catch (e) { return res.status(500).json({ error: 'Erro interno de configuração.' }); }

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
  let { nome, quadra, lote, telefone, pag, troco, obs, cupom, itens, idempotencyKey } = req.body || {};
  if (!idempotencyKey || !nome || !quadra || !lote || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Dados do pedido incompletos.' });
  }
  if (itens.length > 100) return res.status(400).json({ error: 'Pedido excede o limite de itens.' });

  nome   = sanitizeString(nome, 100);
  quadra = sanitizeString(quadra, 30);
  // Telefone é opcional; guardamos só dígitos para montar o link do WhatsApp depois.
  telefone = String(telefone || '').replace(/\D/g, '').slice(0, 13);
  lote   = sanitizeString(lote, 30);
  pag    = sanitizeString(pag, 30);
  troco  = sanitizeString(troco, 40);
  obs    = sanitizeString(obs, 300);

  try {
    const resultado = await db.runTransaction(async (t) => {
      const pedidoRef = db.collection('pedidos').doc(idempotencyKey);
      const configRef = db.doc('loja/config');

      // ---- TODAS as leituras ANTES de qualquer escrita (regra do Firestore) ----
      const [pedidoSnap, configSnap] = await Promise.all([t.get(pedidoRef), t.get(configRef)]);

      // Idempotência: pedido já criado -> retorna o mesmo resultado
      if (pedidoSnap.exists) {
        const d = pedidoSnap.data();
        return { id: pedidoRef.id, total: d.total, temItensAPesar: !!d.temItensAPesar,
                 whatsappMsg: montarTextoWhatsApp(d, resolveWpp(configSnap)) };
      }

      const wpp = resolveWpp(configSnap);

      // Loja fechada? (defesa extra além do front)
      if (configSnap.exists) {
        const cfg = configSnap.data();
        if (cfg.lojaAberta === false) throw new Error('A loja está fechada no momento.');
        const diasAbertos = cfg.diasAbertos || [0, 1, 2, 3, 4, 5, 6];
        if (!diasAbertos.includes(new Date().getDay())) throw new Error('A loja não abre hoje.');
      }

      const prodSnaps = await Promise.all(itens.map((i) => t.get(db.doc(`produtos/${i.id}`))));

      // O cupom também é lido AQUI: no Firestore, toda leitura de uma
      // transação tem que acontecer antes da primeira escrita.
      const codigoCupom = cupom ? String(cupom).trim().toUpperCase().slice(0, 40) : '';
      const cupomSnap = codigoCupom ? await t.get(db.doc(`cupons/${codigoCupom}`)) : null;

      // ---- Cálculo (ainda sem escrever) ----
      let totalExatoCentavos = 0;
      const itensValidados = [];
      const estoqueUpdates = [];

      itens.forEach((item, idx) => {
        const snap = prodSnaps[idx];
        if (!snap.exists) throw new Error(`Um produto do carrinho não existe mais.`);
        const p = snap.data();
        if (p.ativo === false) throw new Error(`"${p.nome}" está esgotado.`);

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

        if (aPesar) {
          // NÃO soma no total (preço só após pesagem) e NÃO baixa estoque por unidade
          itensValidados.push({
            id: item.id, nome: p.nome, qtd, tipo: 'un', aPesar: true,
            precoOriginal: p.preco, unidade: p.unidade || 'un', subtotal: 0,
          });
        } else {
          const subC = Math.round(paraCentavos(p.preco) * qtd);
          totalExatoCentavos += subC;
          itensValidados.push({
            id: item.id, nome: p.nome, qtd, tipo, aPesar: false,
            preco: p.preco, precoOriginal: p.preco, unidade: p.unidade || 'un',
            subtotal: paraFlutuante(subC),
          });
          // Baixa de estoque só para itens de valor fechado
          if (p.estoqueFisico !== null && p.estoqueFisico !== undefined && p.estoqueFisico !== '') {
            const novo = fixFloat(Number(p.estoqueFisico) - qtd);
            if (novo < 0) throw new Error(`"${p.nome}" não tem estoque suficiente.`);
            estoqueUpdates.push([snap.ref, { estoqueFisico: novo, ativo: novo > 0 }]);
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

        if (descC > 0) {
          totalExatoCentavos -= descC;
          cupomAplicado = { codigo: cupomSnap.id, desconto: paraFlutuante(descC), ref: cupomSnap.ref };
          obsFinal = `${obs ? obs + ' | ' : ''}🎁 Cupom ${cupomSnap.id} (-${fmtBRL(paraFlutuante(descC))})`;
        }
      } else if (cupom) {
        throw new Error('Cupom não encontrado.');
      }

      const totalExato = paraFlutuante(totalExatoCentavos);
      const temItensAPesar = itensValidados.some((i) => i.aPesar);

      const dadosPedido = {
        id: pedidoRef.id,
        userId: donoVerificado,
        nome, quadra, lote, telefone: telefone || '', pag, troco: troco || '', obs: obsFinal || '',
        itens: itensValidados,
        total: totalExato,        // total dos itens de valor fechado
        clientTotal: totalExato,  // usado pelo painel de pesagem como base
        temItensAPesar,
        cupom: cupomAplicado ? { codigo: cupomAplicado.codigo, desconto: cupomAplicado.desconto } : null,
        status: temItensAPesar ? 'aguardando_pesagem' : 'pendente',
        data: new Date().toISOString(),
        origem: 'whatsapp',
      };

      // ---- Agora sim, as escritas ----
      estoqueUpdates.forEach(([ref, patch]) => t.update(ref, patch));
      if (cupomAplicado) {
        t.update(cupomAplicado.ref, { usos: admin.firestore.FieldValue.increment(1) });
      }
      t.set(pedidoRef, dadosPedido);
      t.set(db.doc('analytics/dashboard'), {
        receitaTotal: admin.firestore.FieldValue.increment(totalExato),
        totalPedidos: admin.firestore.FieldValue.increment(1),
      }, { merge: true });

      // Resumo por dia (ex.: resumos/2026-07-24).
      // Hoje o Balanço ainda lê os pedidos um por um, o que funciona bem no
      // volume atual. Estes resumos começam a acumular a partir de agora para
      // que, quando houver histórico longo, o Balanço possa somar 30 documentos
      // em vez de reler centenas de pedidos.
      const diaChave = new Date().toISOString().slice(0, 10);
      t.set(db.doc(`resumos/${diaChave}`), {
        dia: diaChave,
        receita: admin.firestore.FieldValue.increment(totalExato),
        pedidos: admin.firestore.FieldValue.increment(1),
        atualizadoEm: new Date().toISOString(),
      }, { merge: true });

      return { id: pedidoRef.id, total: totalExato, temItensAPesar,
               whatsappMsg: montarTextoWhatsApp(dadosPedido, wpp) };
    });

    return res.status(200).json({ sucesso: true, pedido: resultado });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Não foi possível registrar o pedido.' });
  }
};
