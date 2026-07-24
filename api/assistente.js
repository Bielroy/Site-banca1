// =====================================================================
//  api/assistente.js  —  Banca Adair e Pedrina
//
//  POR QUE ESTE ARQUIVO FOI REESCRITO
//  ----------------------------------
//  O código antigo chamava o modelo "gemini-pro", que o Google desligou.
//  Não foi só ele: as gerações 1.0, 1.5, 2.0 e o 2.5-pro também já
//  retornam 404. Trocar por um nome fixo novo só adiaria o problema.
//
//  Duas decisões para não quebrar de novo:
//   1) Usa o apelido "gemini-flash-latest", que o Google aponta sempre
//      para o Flash atual. Dá para fixar outro pelo env GEMINI_MODEL.
//   2) Chama a API REST por fetch, sem o pacote @google/generative-ai.
//      Menos dependência = menos coisa para desatualizar sozinha.
//
//  VARIÁVEL NECESSÁRIA NA VERCEL
//   GEMINI_API_KEY   (obrigatória)
//   GEMINI_MODEL     (opcional, padrão: gemini-flash-latest)
//   ALLOWED_ORIGIN   (opcional, padrão: *)
//
//  DIAGNÓSTICO
//   Abra no navegador:  /api/assistente?diagnostico=1
//   Ele lista os modelos que a SUA chave enxerga hoje.
// =====================================================================

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODELO_PADRAO = 'gemini-flash-latest';

// Se o modelo escolhido falhar com 404, tenta estes em ordem.
const ALTERNATIVAS = [
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.1-flash',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite'
];

const jsonHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
};

// ---------------------------------------------------------------------
// Chamada crua ao Gemini
// ---------------------------------------------------------------------
async function chamarGemini(modelo, prompt, { json = false, temperatura = 0.8 } = {}) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw new Error('GEMINI_API_KEY não configurada na Vercel.');

  const corpo = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperatura,
      maxOutputTokens: 1200,
      ...(json ? { responseMimeType: 'application/json' } : {})
    }
  };

  const resp = await fetch(`${BASE}/models/${modelo}:generateContent?key=${chave}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  });

  const dados = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const erro = new Error(dados?.error?.message || `HTTP ${resp.status}`);
    erro.status = resp.status;
    throw erro;
  }

  const texto = dados?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!texto) throw new Error('A IA respondeu vazio (pode ter sido bloqueio de conteúdo).');
  return texto.trim();
}

// Tenta o modelo configurado; se ele não existir mais, percorre as alternativas.
async function gerar(prompt, opcoes = {}) {
  const preferido = process.env.GEMINI_MODEL || MODELO_PADRAO;
  const fila = [preferido, ...ALTERNATIVAS.filter(m => m !== preferido)];

  let ultimoErro;
  for (const modelo of fila) {
    try {
      return await chamarGemini(modelo, prompt, opcoes);
    } catch (e) {
      ultimoErro = e;
      // Só vale tentar outro modelo se o problema foi o modelo em si.
      if (e.status !== 404 && e.status !== 400) throw e;
    }
  }
  throw ultimoErro || new Error('Nenhum modelo disponível.');
}

// A IA às vezes embrulha o JSON em ```json ... ```
function lerJSON(texto) {
  const limpo = texto.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(limpo);
}

// ---------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------
const VOZ = `Você escreve para a "Banca Adair e Pedrina", um hortifruti de bairro
que entrega em condomínios. Tom caloroso, simples e brasileiro, sem palavras
difíceis nem exagero de marketing. Nada de inventar promoção, prazo ou selo
de qualidade que não foi informado.`;

const PROMPTS = {
  gerar_descricao: (d) => `${VOZ}
Escreva a descrição do produto "${d.nome}" (categoria: ${d.cat}).
Regras: 2 a 3 frases, no máximo 300 caracteres. Fale de frescor, de como
usar no dia a dia e por que vale a pena. Sem emoji no começo. Responda
apenas com o texto da descrição, nada além disso.`,

  social_post: (d) => `${VOZ}
Crie uma legenda de Instagram/WhatsApp para "${d.nome}" (categoria: ${d.cat}),
a ${Number(d.preco).toFixed(2).replace('.', ',')} reais.
Regras: até 4 linhas curtas, use emoji com moderação, termine com uma
chamada para pedir pelo site. Inclua de 3 a 5 hashtags simples no final.
Responda apenas com a legenda.`,

  gerar_kit: (d) => `${VOZ}
Monte um kit de produtos para facilitar a vida do cliente, usando itens
comuns de hortifruti. Responda SOMENTE com um JSON válido neste formato:
{"nome":"","preco":0,"descricao":"","itensInclusos":""}
- nome: criativo e curto (ex: "Kit Salada da Semana")
- preco: número em reais, sem símbolo, entre 15 e 60
- descricao: 1 ou 2 frases
- itensInclusos: lista separada por vírgula`,

  demand_prediction: (d) => `${VOZ}
Você é o analista da banca. Abaixo está o faturamento por dia:
${JSON.stringify(d.historicoVendas || [])}

Escreva um relatório curto em HTML simples (use apenas <p>, <ul>, <li>, <b>).
Cubra: (1) qual dia vende mais, (2) uma tendência que dá para notar,
(3) duas recomendações práticas de compra ou estoque para a próxima semana.
Se os dados forem poucos, diga isso com honestidade em vez de inventar
tendência. Não use <html>, <head> nem <body>. Responda apenas o HTML.`,

  chat: (d) => `${VOZ}
Você é o assistente de receitas da banca, conversando com um cliente.
${d.catalogo ? `Produtos disponíveis hoje: ${d.catalogo}` : ''}
Pergunta do cliente: "${d.mensagem}"

Responda em no máximo 5 linhas, de forma prática e simpática. Se a pergunta
for sobre uma receita, liste os ingredientes que a banca tem. Se pedirem algo
que não está no catálogo, diga com clareza que não temos hoje. Não invente
preço nem prazo de entrega.`
};

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
export default async function handler(req, res) {
  jsonHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // /api/assistente?diagnostico=1  -> mostra o que a sua chave enxerga
  if (req.method === 'GET') {
    if (!req.query?.diagnostico) {
      return res.status(405).json({ sucesso: false, error: 'Use POST.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ sucesso: false, error: 'GEMINI_API_KEY não está configurada na Vercel.' });
    }
    try {
      const r = await fetch(`${BASE}/models?key=${process.env.GEMINI_API_KEY}&pageSize=100`);
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ sucesso: false, error: d?.error?.message || 'Falha ao listar.' });

      const usaveis = (d.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace('models/', ''));

      return res.status(200).json({
        sucesso: true,
        modeloConfigurado: process.env.GEMINI_MODEL || MODELO_PADRAO,
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

  const { action, produtoInfo, historicoVendas, mensagem, catalogo } = req.body || {};
  const montar = PROMPTS[action];
  if (!montar) {
    return res.status(400).json({ sucesso: false, error: `Ação desconhecida: ${action}` });
  }

  try {
    const dados = { ...(produtoInfo || {}), historicoVendas, mensagem, catalogo };
    const pedeJSON = action === 'gerar_kit';
    const texto = await gerar(montar(dados), { json: pedeJSON, temperatura: pedeJSON ? 0.9 : 0.8 });

    // Cada ação devolve o campo que o front já espera
    if (action === 'gerar_descricao') return res.status(200).json({ sucesso: true, descricao: texto });
    if (action === 'social_post')     return res.status(200).json({ sucesso: true, post: texto });
    if (action === 'demand_prediction') return res.status(200).json({ sucesso: true, relatorio: texto });
    if (action === 'chat')            return res.status(200).json({ sucesso: true, resposta: texto });

    if (action === 'gerar_kit') {
      const kit = lerJSON(texto);
      return res.status(200).json({ sucesso: true, kit });
    }
  } catch (e) {
    console.error('[assistente]', action, e);
    const msg = String(e.message || e);
    // 404 aqui significa que nem as alternativas existem mais
    const dica = /not found|404/i.test(msg)
      ? 'Nenhum dos modelos conhecidos respondeu. Acesse /api/assistente?diagnostico=1 para ver quais a sua chave aceita e configure GEMINI_MODEL na Vercel.'
      : /API key|PERMISSION|403/i.test(msg)
        ? 'A chave GEMINI_API_KEY parece inválida ou sem permissão. Gere outra no Google AI Studio.'
        : null;
    return res.status(500).json({ sucesso: false, error: msg, dica });
  }
}
