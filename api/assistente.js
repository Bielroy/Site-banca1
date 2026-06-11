const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const formatPrivateKey = (key) => {
  if (!key) return '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
};

let db;
let ai; 

const bootFirebase = () => {
  if (!admin.apps.length) {
    let credential;
    
    // Tenta formato 1 (Chaves Separadas como no Checkout)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        credential = admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY)
        });
    } 
    // Tenta formato 2 (Chave Única como no seu Assistente Antigo)
    else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
        } catch (e) {
            throw new Error("Sua chave FIREBASE_SERVICE_ACCOUNT existe, mas o JSON está formatado incorretamente.");
        }
    } else {
        throw new Error("As credenciais do Firebase não estão configuradas nas Environment Variables da Vercel.");
    }
    
    admin.initializeApp({ credential });
  }
  if (!db) db = admin.firestore();
};

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
    if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método não permitido' });

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
        if (!process.env.GEMINI_API_KEY) throw new Error("A GEMINI_API_KEY não foi encontrada na Vercel.");
        if (!ai) ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
                    id: doc.id, nome: data.nome, preco: data.preco, unidade: data.unidade || 'un', cat: data.cat
                });
            });
            cachedCatalog = tempCatalog;
            cacheTimestamp = agora;
        }

        const systemInstruction = `
        Você é o assistente virtual e sommelier de hortifruti da "Banca Adair e Pedrina".
        Seu objetivo é ajudar o cliente a escolher produtos, sugerir receitas baseadas no estoque atual e impulsionar vendas.
        
        Regras fundamentais:
        1. Seja cordial e focado em alimentação saudável.
        2. Use APENAS os produtos listados abaixo.
        3. Você deve obrigatoriamente responder em formato JSON estrito, contendo:
           - "respostaTextual": string do texto amigável.
           - "produtosSugeridos": array de IDs.
        CATÁLOGO: ${JSON.stringify(cachedCatalog)}`;

        const model = ai.getGenerativeModel({ 
            model: 'gemini-1.5-flash',
            systemInstruction: systemInstruction 
        });

        const resultado = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: mensagemCliente }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.3 }
        });

        let textoResposta = resultado.response.text();
        textoResposta = textoResposta.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResposta = JSON.parse(textoResposta);

        return res.status(200).json({
            sucesso: true,
            resposta: jsonResposta.respostaTextual,
            sugestoes: jsonResposta.produtosSugeridos
        });

    } catch (error) {
        console.error("CRASH NO SERVIDOR:", error.message);
        return res.status(500).json({ 
            sucesso: false, 
            error: error.message, // ENVIANDO O ERRO EXATO PARA O FRONT-END
            resposta: "Desculpe, tive um soluço técnico.",
            sugestoes: [] 
        });
    }
};
