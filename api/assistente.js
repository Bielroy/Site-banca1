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
// Igual às outras funções: aceita a chave colada com aspas em volta
const formatPrivateKey = (k) => String(k || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();

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

const T = require('../lib/tenant');
const Copiloto = require('../lib/copiloto');
const contextos = new Map();     // resumo dos dados de cada loja, por poucos minutos

// O catálogo muda pouco; relê no máximo a cada 5 min para não pesar.
// Um catálogo guardado POR LOJA: a IA de uma loja nunca vê produto de outra.
const catalogos = new Map();
async function lerCatalogo(tid = T.TENANT_PADRAO) {
  let catalogoCache = catalogos.get(tid) || { em: 0, lista: [] };
  if (Date.now() - catalogoCache.em < 5 * 60 * 1000) return catalogoCache.lista;
  try {
    if (!iniciarFirebase()) return [];      // dentro do try: chave mal formatada não derruba o chat
    const snap = await T.tcol(admin.firestore(), tid, 'produtos').get();
    // Categorias ocultas no painel não podem ser sugeridas pela IA
    const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    let ocultas = new Set();
    try {
      const cs = await T.tcol(admin.firestore(), tid, 'categorias').get();
      ocultas = new Set(cs.docs.map(d => d.data()).filter(c => c.visivel === false).map(c => semAcento(c.chave)));
    } catch (e) { /* sem categorias cadastradas: segue normal */ }
    catalogoCache = {
      em: Date.now(),
      lista: snap.docs
        .map(d => Object.assign({ id: d.id }, d.data()))
        // mesmo critério da vitrine (ativo verdadeiro): o que a loja não mostra, a IA não sugere
        .filter(p => p.ativo && !p.soInsumo && p.nome && !ocultas.has(semAcento(p.cat)))
        .map(p => ({ id: p.id, nome: p.nome, cat: p.cat, preco: p.preco, unidade: p.unidade }))
    };
    catalogos.set(tid, catalogoCache);
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
  formato exato [SUGESTOES:id1,id2,id3] usando os IDs do catálogo (a primeira
  coluna), copiados sem aspas, sem crase e sem negrito. Escreva SUGESTOES
  assim mesmo, sem acento. No máximo 4 IDs. Se não houver o que sugerir, não
  escreva essa linha.
- Não use Markdown (nada de ** ou #): o chat mostra texto simples.
- Se o cliente enviar uma foto, diga o que reconhece e relacione com o catálogo.

Mensagem do cliente: "${dados.mensagem || '(sem texto, veja a imagem)'}"`;
}

// ---------------------------------------------------------------------
// Chamadas ao Gemini
// ---------------------------------------------------------------------
function montarCorpo(opcoes) {
  let contents = [];

  (Array.isArray(opcoes.historico) ? opcoes.historico : []).slice(-6).forEach(h => {
    // a marcação de sugestões é coisa nossa; não precisa voltar para o modelo
    const texto = String((h && h.content) || '').replace(/\[\s*SUGEST[^\]]*\]?/gi, '').trim().slice(0, 2000);
    if (!texto) return;
    const role = h.role === 'ia' ? 'model' : 'user';
    const ultimo = contents[contents.length - 1];
    if (ultimo && ultimo.role === role) ultimo.parts[0].text += '\n' + texto;   // dois turnos seguidos do mesmo lado viram um
    else contents.push({ role, parts: [{ text: texto }] });
  });
  // O Gemini espera a conversa alternando, começando pelo cliente e terminando
  // na resposta da IA (a pergunta atual entra logo abaixo). Versões antigas da
  // loja mandavam a pergunta atual também dentro do histórico: tiramos a sobra.
  while (contents.length && contents[0].role !== 'user') contents.shift();
  while (contents.length && contents[contents.length - 1].role !== 'model') contents.pop();

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
    // folga: em alguns modelos o "raciocínio" também gasta deste limite, e a
    // linha [SUGESTOES:...] é a última — era a primeira a ser cortada
    maxOutputTokens: 2048
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Loja');
};

module.exports = async function handler(req, res) {
  aplicarCors(req, res, 'OPTIONS, POST, GET');

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

    // Loja do chat. Fora da loja original, o Ajudante só responde se o módulo estiver ligado na ficha.
    let tidChat = T.TENANT_PADRAO;
    const semChat = (codigo, msg) => res.status(codigo).json({ sucesso: false, error: msg });
    try {
      if (iniciarFirebase()) {
        const loja = await T.resolverLoja(admin.firestore(), req); tidChat = loja.tid;
        if (tidChat !== T.TENANT_PADRAO && !(loja.ficha.modulos && loja.ficha.modulos.ia === true)) return semChat(403, 'O ajudante não está ligado nesta loja.');
        // Teto diário por loja: o chat é aberto ao público, então alguém mal-intencionado poderia gastar a cota da IA.
        const teto = Number(process.env.CHAT_LIMITE_DIA) || 1500, dia = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
        const usoRef = T.docDe(admin.firestore(), tidChat, `uso_ia/${dia}`);
        const ok = await admin.firestore().runTransaction(async (t) => {
          const s = await t.get(usoRef), n = (s.exists && Number(s.data().chat)) || 0;
          if (n >= teto) return false;
          t.set(usoRef, { chat: n + 1, dia }, { merge: true }); return true;
        });
        if (!ok) return semChat(429, 'O ajudante atingiu o limite de hoje. Chame a loja pelo WhatsApp.');
      }
    } catch (e) {
      if (e.status) return semChat(e.status, e.message);       // loja inexistente ou bloqueada
      console.warn('[assistente] sem controle de uso:', e && e.message);   // falha do contador não derruba o chat
    }
    // Entradas com tamanho limitado: texto de até 600 letras e foto de até ~1,5 MB em formato comum.
    const img = corpoReq.imagem && typeof corpoReq.imagem === 'object' ? corpoReq.imagem : null;
    if (img && (typeof img.data !== 'string' || img.data.length > 2000000 || !/^image\/(jpeg|png|webp)$/.test(String(img.mimeType || 'image/jpeg')))) return semChat(400, 'Envie uma foto menor (JPG ou PNG).');
    const mensagemLimpa = String(corpoReq.mensagemCliente || '').slice(0, 600);

    let upstream;
    try {
      const catalogo = await lerCatalogo(tidChat);
      const corpo = montarCorpo({
        prompt: promptDoChat({
          mensagem: mensagemLimpa,
          carrinho: Array.isArray(corpoReq.carrinho) ? corpoReq.carrinho.slice(0, 60) : [],
          catalogo: catalogo
        }),
        historico: corpoReq.historico,
        imagem: img,
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
  // COPILOTO DO PAINEL — perguntas sobre os dados DA PRÓPRIA LOJA
  // Só proprietário e administrador (são dados financeiros). A loja vem do
  // cabeçalho, a permissão vem do login, e os dados são lidos com o banco
  // limitado a essa loja: não existe caminho para ver dados de outra.
  // =================================================================
  if (action === 'copiloto') {
    let dec, tid, ficha;
    try {
      if (!iniciarFirebase()) throw new Error('config');
      const cab = String((req.headers && req.headers.authorization) || '');
      dec = await admin.auth().verifyIdToken(cab.startsWith('Bearer ') ? cab.slice(7).trim() : '');
    } catch (e) { return res.status(401).json({ sucesso: false, error: 'Entre no painel de novo para usar o copiloto.' }); }
    const banco = admin.firestore();
    try { ({ tid, ficha } = await T.resolverLoja(banco, req)); }
    catch (e) { return res.status(e.status || 400).json({ sucesso: false, error: e.message }); }
    if (!T.moduloAtivo(ficha, 'copiloto')) return res.status(403).json({ sucesso: false, error: 'O copiloto não está ligado nesta loja.' });
    if (!T.temPapel(dec, tid, T.GESTORES)) return res.status(403).json({ sucesso: false, error: 'O copiloto é só para o proprietário e administradores desta loja.' });

    const pergunta = String(corpoReq.pergunta || '').replace(/\s+/g, ' ').trim();
    if (pergunta.length < 3 || pergunta.length > 500) return res.status(400).json({ sucesso: false, error: 'Escreva a pergunta (até 500 letras).' });
    if (passouDoLimite('cop:' + dec.uid, 8)) return res.status(429).json({ sucesso: false, error: 'Muitas perguntas seguidas. Aguarde um minuto.', podeRepetir: true });

    try {
      // Teto diário por loja: protege a conta da IA de uso descontrolado.
      const teto = Number(process.env.COPILOTO_LIMITE_DIA) || 150, dia = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
      const usoRef = T.docDe(banco, tid, `uso_ia/${dia}`);
      const usados = await banco.runTransaction(async (t) => {
        const s = await t.get(usoRef), n = (s.exists && Number(s.data().copiloto)) || 0;
        if (n >= teto) return -1;
        t.set(usoRef, { copiloto: n + 1, dia }, { merge: true }); return n + 1;
      });
      if (usados < 0) return res.status(429).json({ sucesso: false, error: 'O limite de perguntas de hoje foi atingido. Volta amanhã.' });

      // os dados da loja ficam 3 minutos em memória: várias perguntas seguidas não releem o banco
      let ctx = contextos.get(tid);
      if (!ctx || Date.now() - ctx.em > 180000) {
        const dados = await Copiloto.lerDados(T.escopo(banco, tid), { campoId: admin.firestore.FieldPath.documentId() });
        ctx = { em: Date.now(), resumo: Copiloto.resumir({ loja: (ficha && ficha.nome) || (tid === T.TENANT_PADRAO ? 'Banca Adair e Pedrina' : tid), ...dados }) };
        contextos.set(tid, ctx);
      }
      const prompt = `${Copiloto.INSTRUCOES(ctx.resumo.loja, `${ctx.resumo.diaDaSemana}, ${ctx.resumo.hoje}`)}\n\nDADOS (JSON):\n${JSON.stringify(ctx.resumo)}\n\nPERGUNTA: ${pergunta}`;
      const historico = (Array.isArray(corpoReq.historico) ? corpoReq.historico : []).slice(-6)
        .map((h) => ({ role: h && h.role === 'ia' ? 'ia' : 'user', content: String((h && h.content) || '').slice(0, 800) }));
      const resposta = await textoUnico(prompt, { historico, temperatura: 0.2 });
      return res.status(200).json({ sucesso: true, resposta, dadosDe: ctx.resumo.previsaoCalculadaEm, avisos: ctx.resumo.avisos });
    } catch (e) {
      console.error('[copiloto]', e);
      const sobrecarga = TRANSITORIO.indexOf(e.status) !== -1;
      return res.status(sobrecarga ? 503 : 500).json({ sucesso: false, error: mensagemAmigavel(e), podeRepetir: sobrecarga });
    }
  }

  // =================================================================
  // AÇÕES DO ADMIN — resposta JSON comum
  // =================================================================
  const montar = PROMPTS[action];
  if (!montar) return res.status(400).json({ sucesso: false, error: 'Ação desconhecida: ' + action });

  // Só a equipe da loja usa estas ações (antes qualquer visitante podia chamá-las e gastar a cota da IA).
  try {
    if (!iniciarFirebase()) throw new Error('config');
    const cab = String((req.headers && req.headers.authorization) || '');
    const dec = await admin.auth().verifyIdToken(cab.startsWith('Bearer ') ? cab.slice(7).trim() : '');
    const tidAdm = T.tenantDaRequisicao(req);
    if (!tidAdm || !T.temPapel(dec, tidAdm, T.PAPEIS)) return res.status(403).json({ sucesso: false, error: 'Acesso restrito à equipe da loja.' });
  } catch (e) {
    return res.status(401).json({ sucesso: false, error: 'Entre no painel de novo para usar a IA.' });
  }

  // Estas ações também gastam a cota da IA: mesmo freio por IP do chat
  const ipAdmin = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (passouDoLimite('adm:' + ipAdmin, 12)) {
    return res.status(429).json({ sucesso: false, error: 'Muitos pedidos à IA seguidos. Aguarde um minuto.', podeRepetir: true });
  }

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
