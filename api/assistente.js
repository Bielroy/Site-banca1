// =====================================================================
//  api/assistente.js  —  Banca Adair e Pedrina
//
//  POR QUE FOI REESCRITO
//  ---------------------
//  1) O modelo "gemini-pro" foi desligado pelo Google. E não só ele:
//     as gerações 1.0, 1.5, 2.0 e o 2.5-pro também respondem 404 hoje.
//     Trocar por outro nome fixo só adiaria a próxima quebra.
//  2) O arquivo antigo usava o pacote @google/generative-ai. Aqui a API
//     é chamada direto por fetch — uma dependência a menos para envelhecer.
//  3) CommonJS (module.exports), igual ao checkout.js. Em ESM daria erro,
//     porque o projeto não está marcado como "type": "module".
//
//  AÇÕES SUPORTADAS
//   chat_stream        -> loja (js/ia.js), resposta em streaming + foto
//   gerar_descricao    -> admin
//   social_post        -> admin
//   gerar_kit          -> admin
//   demand_prediction  -> admin
//
//  VARIÁVEIS NA VERCEL
//   GEMINI_API_KEY  (obrigatória)
//   GEMINI_MODEL    (opcional, padrão gemini-flash-latest)
//   ALLOWED_ORIGIN  (opcional)
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
//       (opcionais aqui — servem para a IA conhecer o catálogo e poder
//        sugerir produtos reais. Sem elas o chat funciona, só não sugere.)
//
//  DIAGNÓSTICO
//   GET /api/assistente?diagnostico=1  -> lista os modelos que a sua chave vê
// =====================================================================

const admin = require('firebase-admin');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODELO_PADRAO = 'gemini-flash-latest';


// Espera um tempo aleatório + exponencial (back-off) antes de tentar de novo.
// 1ª falha: 1-3 seg, 2ª: 3-7 seg, 3ª: 7-15 seg...
async function dormirComJitter(tentativa) {
  const baseMs = Math.pow(2, tentativa) * 1000;
  const jitterMs = Math.random() * baseMs;
  await new Promise(r => setTimeout(r, jitterMs));
}

// Se o modelo escolhido sumir, tenta estes na ordem.
const ALTERNATIVAS = [
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.1-flash',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite'
];

// ---------------------------------------------------------------------
// Firebase (opcional) — só para a IA saber o que existe no catálogo
// ---------------------------------------------------------------------
const formatPrivateKey = (k) => String(k || '').replace(/\\n/g, '\n');

let firebasePronto = false;
function iniciarFirebase() {
  if (firebasePronto || admin.apps.length) { firebasePronto = true; return true; }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) return false;
  admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  firebasePronto = true;
  return true;
}

// O catálogo muda pouco; relê no máximo a cada 5 min para não pesar.
let catalogoCache = { em: 0, lista: [] };
async function lerCatalogo() {
  if (Date.now() - catalogoCache.em < 5 * 60 * 1000) return catalogoCache.lista;
  if (!iniciarFirebase()) return [];
  try {
    const snap = await admin.firestore().collection('produtos').get();
    catalogoCache = {
      em: Date.now(),
      lista: snap.docs
        .map(d => Object.assign({ id: d.id }, d.data()))
        .filter(p => p.ativo !== false)
        .map(p => ({ id: p.id, nome: p.nome, cat: p.cat, preco: p.preco, unidade: p.unidade }))
    };
  } catch (e) {
    console.error('[assistente] catalogo:', e.message);
  }
  return catalogoCache.lista;
}

// ---------------------------------------------------------------------
// Limite simples de uso, por IP, para o chat da loja
// ---------------------------------------------------------------------
const usos = new Map();
function passouDoLimite(ip, max = 20, janelaMs = 60000) {
  const agora = Date.now();
  for (const [k, v] of usos) if (agora - v.inicio > janelaMs) usos.delete(k);
  const reg = usos.get(ip) || { inicio: agora, n: 0 };
  if (agora - reg.inicio > janelaMs) { reg.inicio = agora; reg.n = 0; }
  reg.n++;
  usos.set(ip, reg);
  return reg.n > max;
}

// ---------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------
const VOZ = `Você escreve para a "Banca Adair e Pedrina", um hortifruti de bairro
que entrega em condomínios. Tom caloroso, simples e brasileiro, sem palavra
difícil nem exagero de propaganda. Nunca invente promoção, prazo de entrega
ou selo de qualidade que não foi informado.`;

const PROMPTS = {
  gerar_descricao: (d) => `${VOZ}
Escreva a descrição do produto "${d.nome}" (categoria: ${d.cat}).
Regras: 2 a 3 frases, no máximo 300 caracteres. Fale do frescor, de como usar
no dia a dia e por que vale a pena. Sem emoji no começo.
Responda apenas com o texto da descrição.`,

  social_post: (d) => `${VOZ}
Crie uma legenda de Instagram/WhatsApp para "${d.nome}" (categoria: ${d.cat}),
a ${Number(d.preco).toFixed(2).replace('.', ',')} reais.
Regras: até 4 linhas curtas, emoji com moderação, termine convidando a pedir
pelo site, e feche com 3 a 5 hashtags simples.
Responda apenas com a legenda.`,

  gerar_kit: () => `${VOZ}
Monte um kit de produtos de hortifruti que facilite a vida do cliente.
Responda SOMENTE com um JSON válido neste formato:
{"nome":"","preco":0,"descricao":"","itensInclusos":""}
- nome: curto e criativo (ex: "Kit Salada da Semana")
- preco: número em reais, sem símbolo, entre 15 e 60
- descricao: 1 ou 2 frases
- itensInclusos: itens separados por vírgula`,

  demand_prediction: (d) => `${VOZ}
Você é o analista da banca. Faturamento por dia:
${JSON.stringify(d.historicoVendas || [])}

Escreva um relatório curto em HTML simples (só <p>, <ul>, <li>, <b>). Cubra:
(1) qual dia vende mais, (2) uma tendência visível, (3) duas recomendações
práticas de compra para a próxima semana. Se os dados forem poucos, diga isso
com honestidade em vez de inventar tendência.
Não use <html>, <head> ou <body>. Responda apenas o HTML.`
};

function promptDoChat(dados) {
  const catalogo = dados.catalogo || [];
  const lista = catalogo.slice(0, 120)
    .map(p => `${p.id}|${p.nome}|${p.cat || '-'}|R$${Number(p.preco).toFixed(2)}/${p.unidade || 'un'}`)
    .join('\n');

  const carrinho = dados.carrinho || [];
  const noCarrinho = carrinho.length
    ? carrinho.map(i => `${i.qtd} ${i.unidade || ''} de ${i.nome}`).join(', ')
    : 'vazio';

  return `${VOZ}
Você é o assistente de receitas e compras da banca, conversando por chat.

${lista ? 'CATÁLOGO DE HOJE (id|nome|categoria|preço):\n' + lista + '\n' : 'O catálogo não está disponível agora.\n'}
Carrinho do cliente: ${noCarrinho}

REGRAS:
- Responda em no máximo 6 linhas, direto e simpático.
- Só ofereça produtos que estejam no catálogo acima. Se pedirem algo que não
  temos hoje, diga com clareza em vez de improvisar.
- Nunca invente preço: use os do catálogo.
- Se fizer sentido sugerir produtos, termine a resposta com uma linha no
  formato exato [SUGESTOES:id1,id2,id3] usando os IDs do catálogo.
  No máximo 4 IDs. Se não houver o que sugerir, não escreva essa linha.
- Se o cliente enviar uma foto, diga o que reconhece e relacione com o catálogo.

Mensagem do cliente: "${dados.mensagem || '(sem texto, veja a imagem)'}"`;
}

// ---------------------------------------------------------------------
// Chamadas ao Gemini
// ---------------------------------------------------------------------
function montarCorpo(opcoes) {
  const contents = [];

  (opcoes.historico || []).slice(-6).forEach(h => {
    const texto = String(h.content || '').trim();
    if (!texto) return;
    contents.push({ role: h.role === 'ia' ? 'model' : 'user', parts: [{ text: texto }] });
  });

  const partes = [{ text: opcoes.prompt }];
  if (opcoes.imagem && opcoes.imagem.data) {
    partes.push({
      inlineData: {
        mimeType: opcoes.imagem.mimeType || 'image/jpeg',
        data: opcoes.imagem.data
      }
    });
  }
  contents.push({ role: 'user', parts: partes });

  const generationConfig = {
    temperature: opcoes.temperatura === undefined ? 0.8 : opcoes.temperatura,
    maxOutputTokens: 1200
  };
  if (opcoes.json) generationConfig.responseMimeType = 'application/json';

  return { contents, generationConfig };
}

async function chamar(modelo, corpo, streaming) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) {
    const e = new Error('GEMINI_API_KEY não configurada na Vercel.');
    e.status = 500;
    throw e;
  }

  // Retry automático para 429 (sobrecarregado) e 500 (erro temporário)
  for (let tent = 0; tent < 3; tent++) {
    const metodo = streaming ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    const resp = await fetch(`${BASE}/models/${modelo}:${metodo}key=${chave}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    });

    if (resp.ok) return resp;

    const statusCode = resp.status;
    let msg = `HTTP ${statusCode}`;
    try { const e = await resp.json(); msg = (e && e.error && e.error.message) || msg; } catch (_) {}

    // Se for 429 ou 500, tenta de novo depois de esperar
    if ((statusCode === 429 || statusCode === 500) && tent < 2) {
      await dormirComJitter(tent);
      continue;
    }

    // Se não for temporário, desiste já
    const erro = new Error(msg);
    erro.status = statusCode;
    throw erro;
  }
}

// Percorre a fila de modelos até um responder.
// Códigos que significam "tenta de novo, o problema é passageiro":
// 429 = muitas requisições, 500/502/503/504 = servidor ocupado ou instável.
const TRANSITORIO = [429, 500, 502, 503, 504];
// Códigos que significam "esse modelo não serve": vale tentar outro nome.
const MODELO_RUIM = [400, 403, 404];

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function comFallback(corpo, streaming) {
  const preferido = process.env.GEMINI_MODEL || MODELO_PADRAO;
  const fila = [preferido].concat(ALTERNATIVAS.filter(m => m !== preferido));

  // Orçamento de tempo: a função serverless tem limite, então não adianta
  // insistir para sempre. Paramos de tentar perto dos 20 segundos.
  const prazoFinal = Date.now() + 20000;
  let ultimo;

  for (let i = 0; i < fila.length; i++) {
    const modelo = fila[i];

    // Para CADA modelo, tenta até 3 vezes se o erro for passageiro.
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        return await chamar(modelo, corpo, streaming);
      } catch (e) {
        ultimo = e;

        if (MODELO_RUIM.indexOf(e.status) !== -1) break;      // troca de modelo
        if (TRANSITORIO.indexOf(e.status) === -1) throw e;    // erro de verdade

        // Sobrecarga: espera um pouco e tenta de novo (0,4s -> 1,2s)
        const espera = 400 * Math.pow(3, tentativa);
        if (Date.now() + espera > prazoFinal) break;
        await dormir(espera);
      }
    }

    if (Date.now() > prazoFinal) break;
    // Modelo esgotado: o próximo da fila pode estar com capacidade livre.
  }

  throw ultimo || new Error('Nenhum modelo disponível.');
}

// Traduz o erro técnico em algo que o cliente da banca entenda.
function mensagemAmigavel(e) {
  const msg = String((e && e.message) || e || '');
  const status = e && e.status;

  if (status === 429 || /quota|rate limit/i.test(msg)) {
    return 'O assistente recebeu muitos pedidos agora há pouco. Espere alguns segundos e tente de novo.';
  }
  if (TRANSITORIO.indexOf(status) !== -1 || /overload|high demand|unavailable|try again/i.test(msg)) {
    return 'O assistente está sobrecarregado neste momento. Isso costuma passar rápido — tente de novo em instantes.';
  }
  if (/not found|404/i.test(msg)) {
    return 'O modelo de IA configurado não existe mais. Abra /api/assistente?diagnostico=1 para ver os disponíveis.';
  }
  if (/API key|PERMISSION|403/i.test(msg)) {
    return 'A chave da IA parece inválida ou sem permissão. Gere outra no Google AI Studio.';
  }
  return msg;
}

async function textoUnico(prompt, opcoes) {
  const cfg = Object.assign({ prompt: prompt }, opcoes || {});
  const resp = await comFallback(montarCorpo(cfg), false);
  const d = await resp.json();
  const partes = (d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
  const t = partes.map(p => p.text).join('').trim();
  if (!t) throw new Error('A IA respondeu vazio (pode ter sido bloqueio de conteúdo).');
  return t;
}

const lerJSON = (t) => JSON.parse(String(t).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
module.exports = async function handler(req, res) {
  // CORS: sem ALLOWED_ORIGIN, em produção usa o domínio próprio em vez de "*"
  const origemPermitida = process.env.ALLOWED_ORIGIN
    || (process.env.VERCEL_ENV === 'production' ? 'https://site-banca1.vercel.app' : '*');
  res.setHeader('Access-Control-Allow-Origin', origemPermitida);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-diagnostico');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // ---- Diagnóstico: quais modelos a chave enxerga hoje ----
  if (req.method === 'GET') {
    if (!req.query || !req.query.diagnostico) {
      return res.status(405).json({ sucesso: false, error: 'Use POST.' });
    }
    // O diagnóstico mostra quais modelos a chave aceita. Não vaza a chave,
    // mas também não precisa ficar aberto a qualquer visitante.
    // Configure DIAGNOSTICO_SECRET na Vercel e chame com &secret=...
    const segredo = process.env.DIAGNOSTICO_SECRET;
    if (segredo && req.query.secret !== segredo) {
      return res.status(403).json({ sucesso: false, error: 'Diagnóstico protegido. Informe o parâmetro secret.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ sucesso: false, error: 'GEMINI_API_KEY não está configurada na Vercel.' });
    }
    try {
      const r = await fetch(`${BASE}/models?key=${process.env.GEMINI_API_KEY}&pageSize=200`);
      const d = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ sucesso: false, error: (d && d.error && d.error.message) || 'Falha ao listar modelos.' });
      }
      const usaveis = (d.models || [])
        .filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1)
        .map(m => m.name.replace('models/', ''));

      return res.status(200).json({
        sucesso: true,
        modeloConfigurado: process.env.GEMINI_MODEL || MODELO_PADRAO,
        firebaseConectado: iniciarFirebase(),
        totalDisponiveis: usaveis.length,
        modelosDisponiveis: usaveis
      });
    } catch (e) {
      return res.status(500).json({ sucesso: false, error: String(e.message || e) });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ sucesso: false, error: 'Método não permitido.' });
  }

  const corpoReq = req.body || {};
  const action = corpoReq.action;

  // =================================================================
  // CHAT DA LOJA — resposta em streaming (SSE), como o ia.js espera
  // =================================================================
  if (action === 'chat_stream') {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
    if (passouDoLimite(ip)) {
      return res.status(429).json({ sucesso: false, error: 'Muitas mensagens seguidas. Aguarde um instante.' });
    }

    let upstream;
    try {
      const catalogo = await lerCatalogo();
      const corpo = montarCorpo({
        prompt: promptDoChat({
          mensagem: corpoReq.mensagemCliente,
          carrinho: corpoReq.carrinho,
          catalogo: catalogo
        }),
        historico: corpoReq.historico,
        imagem: corpoReq.imagem,
        temperatura: 0.7
      });
      upstream = await comFallback(corpo, true);
    } catch (e) {
      // Ainda não começou a transmitir, então dá para responder JSON normal
      console.error('[assistente] chat:', e);
      const sobrecarga = TRANSITORIO.indexOf(e.status) !== -1;
      // 503 avisa ao navegador que vale a pena tentar de novo daqui a pouco
      return res.status(sobrecarga ? 503 : 500).json({
        sucesso: false,
        error: mensagemAmigavel(e),
        podeRepetir: sobrecarga
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // impede o proxy de segurar os pedaços
    });

    try {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      for (;;) {
        const passo = await reader.read();
        if (passo.done) break;

        buffer += decoder.decode(passo.value, { stream: true });
        const linhas = buffer.split('\n');
        buffer = linhas.pop() || ''; // guarda a linha incompleta para o próximo pedaço

        for (let i = 0; i < linhas.length; i++) {
          const linha = linhas[i];
          if (linha.indexOf('data:') !== 0) continue;
          const cru = linha.slice(5).trim();
          if (!cru || cru === '[DONE]') continue;
          try {
            const d = JSON.parse(cru);
            const partes = (d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
            const t = partes.map(p => p.text).join('');
            if (t) res.write('data: ' + JSON.stringify({ text: t }) + '\n\n');
          } catch (_) { /* pedaço ainda incompleto */ }
        }
      }
      res.write('data: [DONE]\n\n');
    } catch (e) {
      console.error('[assistente] stream:', e);
      res.write('data: ' + JSON.stringify({ text: '\n\n(A conexão caiu no meio da resposta.)' }) + '\n\n');
    }
    return res.end();
  }

  // =================================================================
  // AÇÕES DO ADMIN — resposta JSON comum
  // =================================================================
  const montar = PROMPTS[action];
  if (!montar) return res.status(400).json({ sucesso: false, error: 'Ação desconhecida: ' + action });

  try {
    const dados = Object.assign({}, corpoReq.produtoInfo || {}, { historicoVendas: corpoReq.historicoVendas });
    const pedeJSON = action === 'gerar_kit';
    const texto = await textoUnico(montar(dados), { json: pedeJSON, temperatura: pedeJSON ? 0.9 : 0.8 });

    if (action === 'gerar_descricao')   return res.status(200).json({ sucesso: true, descricao: texto });
    if (action === 'social_post')       return res.status(200).json({ sucesso: true, post: texto });
    if (action === 'demand_prediction') return res.status(200).json({ sucesso: true, relatorio: texto });
    if (action === 'gerar_kit')         return res.status(200).json({ sucesso: true, kit: lerJSON(texto) });
  } catch (e) {
    console.error('[assistente]', action, e);
    const sobrecarga = TRANSITORIO.indexOf(e.status) !== -1;
    return res.status(sobrecarga ? 503 : 500).json({
      sucesso: false,
      error: mensagemAmigavel(e),
      podeRepetir: sobrecarga
    });
  }
};
