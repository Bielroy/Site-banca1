const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const formatPrivateKey = (key) => {
  if (!key) return '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
};

let db;

// Inicialização Blindada do Firebase
const bootFirebase = () => {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (!projectId || !clientEmail || !privateKey) throw new Error("Variáveis do Firebase ausentes.");

    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey })
    });
  }
  if (!db) db = admin.firestore();
};

// Instancia a IA
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let cachedCatalog = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ sucesso: false, error: 'Método não permitido' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const agora = Date.now();
    if (rateLimitMap.has(ip)) {
        if (agora - rateLimitMap.get(ip) < 3000) {
            return res.status(429).json({ sucesso: false, resposta: "Você está enviando mensagens muito rápido. Por favor, aguarde alguns segundos.", sugestoes: [] });
        }
    }
    rateLimitMap.set(ip, agora);
    if (rateLimitMap.size > 2000) rateLimitMap.clear();

    try {
        bootFirebase();

        const { mensagemCliente } = req.body;
        
        if (!mensagemCliente || typeof mensagemCliente !== 'string' || mensagemCliente.length > 500) {
            return res.status(400).json({ sucesso: false, error: 'Mensagem inválida ou muito longa.' });
        }

        if (!cachedCatalog || (agora - cacheTimestamp > CACHE_TTL)) {
            const produtosSnap = await db.collection('produtos').where('ativo', '==', true).get();
            const tempCatalog = [];
            
            produtosSnap.forEach(doc => {
                const data = doc.data();
                tempCatalog.push({
                    id: doc.id,
                    nome: data.nome,
                    preco: data.preco,
                    unidade: data.unidade || 'un',
                    cat: data.cat
                });
            });
            cachedCatalog = tempCatalog;
            cacheTimestamp = agora;
        }

        const catalogoDisponivel = cachedCatalog;

        const systemInstruction = `
        Você é o assistente virtual e sommelier de hortifruti da "Banca Adair e Pedrina".
        Seu objetivo é ajudar o cliente a escolher produtos, sugerir receitas baseadas no estoque atual e impulsionar vendas.
        
        Regras fundamentais:
        1. Seja sempre cordial, prestativo e focado em alimentação saudável.
        2. Use APENAS os produtos listados no catálogo abaixo. Se o cliente pedir algo fora do catálogo, diga educadamente que não possui no momento.
        3. Você deve obrigatoriamente responder em formato JSON estrito, contendo duas chaves:
           - "respostaTextual": Uma string contendo o texto amigável e formatado em Markdown que será exibido ao cliente.
           - "produtosSugeridos": Um array contendo os IDs dos produtos do catálogo que você mencionou ou sugeriu na resposta (máximo 3).
        
        CATÁLOGO DE PRODUTOS DISPONÍVEIS AGORA NO ESTOQUE:
        ${JSON.stringify(catalogoDisponivel)}
        `;

        // ⚠️ CORREÇÃO DA ARQUITETURA AQUI: systemInstruction agora vai no lugar correto
        const model = ai.getGenerativeModel({ 
            model: 'gemini-1.5-flash',
            systemInstruction: systemInstruction 
        });

        const resultado = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: mensagemCliente }] }],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.3
            }
        });

        let textoResposta = resultado.response.text();
        
        // ⚠️ BLINDAGEM EXTRA: Remove marcações markdown que o Gemini às vezes envia por engano
        textoResposta = textoResposta.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const jsonResposta = JSON.parse(textoResposta);

        return res.status(200).json({
            sucesso: true,
            resposta: jsonResposta.respostaTextual,
            sugestoes: jsonResposta.produtosSugeridos
        });

    } catch (error) {
        console.error("Erro interno no Assistente Gemini:", error);
        return res.status(500).json({ 
            sucesso: false, 
            error: error.message, // Incluído para depuração caso falhe
            resposta: "Desculpe, tive um soluço técnico.",
            sugestoes: [] 
        });
    }
};
