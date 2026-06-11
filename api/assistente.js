const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Utilitário para limpar quebras de linha das chaves do Firebase
const formatPrivateKey = (key) => key ? key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '';

let db;
let ai;

// 1. INICIALIZAÇÃO SEGURA DO FIREBASE
const bootFirebase = () => {
    if (!admin.apps.length) {
        let credential;
        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            credential = admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID.trim(),
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
                privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY)
            });
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
        } else {
            throw new Error("Nenhuma chave do Firebase foi encontrada nas variáveis de ambiente.");
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
    // CORS
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método não permitido' });

    // Prevenção de DDoS (Spam na IA)
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const agora = Date.now();
    if (rateLimitMap.has(ip) && agora - rateLimitMap.get(ip) < 3000) {
        return res.status(429).json({ sucesso: false, resposta: "Aguarde uns segundos para mandar outra mensagem.", sugestoes: [] });
    }
    rateLimitMap.set(ip, agora);
    if (rateLimitMap.size > 2000) rateLimitMap.clear();

    try {
        // 2. BLINDAGEM DA CHAVE DO GOOGLE GEMINI (Remove espaços invisíveis e aspas)
        const rawApiKey = process.env.GEMINI_API_KEY || "";
        const cleanApiKey = rawApiKey.replace(/['"]/g, '').trim(); 
        
        if (!cleanApiKey) throw new Error("A chave GEMINI_API_KEY não existe na Vercel.");
        if (!ai) ai = new GoogleGenerativeAI(cleanApiKey);
        
        bootFirebase();

        const { mensagemCliente } = req.body;
        if (!mensagemCliente) return res.status(400).json({ sucesso: false, error: 'Mensagem inválida.' });

        // 3. RECUPERA OS PRODUTOS (COM CACHE PARA ECONOMIZAR)
        if (!cachedCatalog || (agora - cacheTimestamp > CACHE_TTL)) {
            const snap = await db.collection('produtos').where('ativo', '==', true).get();
            const temp = [];
            snap.forEach(doc => { 
                const d = doc.data(); 
                temp.push({ id: doc.id, nome: d.nome, preco: d.preco, cat: d.cat }); 
            });
            cachedCatalog = temp;
            cacheTimestamp = agora;
        }

        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

        // 4. CHAMADA BRUTA (Ignora configurações avançadas da SDK que causam bugs)
        const promptBlindado = `
Você é o sommelier de hortifruti da Banca Adair e Pedrina.
Use APENAS os produtos do catálogo.
Responda OBRIGATORIAMENTE em JSON com duas chaves: "respostaTextual" e "produtosSugeridos" (array de IDs).

CATÁLOGO: ${JSON.stringify(cachedCatalog)}

MENSAGEM DO CLIENTE: ${mensagemCliente}
`;
        
        const resultado = await model.generateContent(promptBlindado);
        let textoResposta = resultado.response.text();
        
        // Remove marcações markdown (```json) se o modelo adicionar por acidente
        textoResposta = textoResposta.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResposta = JSON.parse(textoResposta);

        return res.status(200).json({ 
            sucesso: true, 
            resposta: jsonResposta.respostaTextual, 
            sugestoes: jsonResposta.produtosSugeridos 
        });

    } catch (error) {
        // Agora o erro exato vai parar nos Logs da Vercel
        console.error("CRASH NO SERVIDOR:", error.message);
        return res.status(500).json({ 
            sucesso: false, 
            error: error.message,
            resposta: "Desculpe, tive um soluço técnico.",
            sugestoes: [] 
        });
    }
};
