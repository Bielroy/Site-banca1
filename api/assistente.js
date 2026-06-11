const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const formatPrivateKey = (key) => key ? key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '';

let db;
let ai;

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
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método não permitido' });

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const agora = Date.now();
    if (rateLimitMap.has(ip) && agora - rateLimitMap.get(ip) < 3000) {
        return res.status(429).json({ sucesso: false, resposta: "Aguarde uns segundos para mandar outra mensagem.", sugestoes: [] });
    }
    rateLimitMap.set(ip, agora);
    if (rateLimitMap.size > 2000) rateLimitMap.clear();

    try {
        const rawApiKey = process.env.GEMINI_API_KEY || "";
        const cleanApiKey = rawApiKey.replace(/['"]/g, '').trim(); 
        
        if (!cleanApiKey) throw new Error("A chave GEMINI_API_KEY não existe na Vercel.");
        if (!ai) ai = new GoogleGenerativeAI(cleanApiKey);
        
        bootFirebase();

        const { mensagemCliente } = req.body;
        if (!mensagemCliente) return res.status(400).json({ sucesso: false, error: 'Mensagem inválida.' });

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

        // PROMPT UNIVERSAL (Funciona em 100% das versões do Gemini sem dar conflito de parâmetros)
        const promptUniversal = `
Você é o sommelier de hortifruti da Banca Adair e Pedrina.
Use APENAS os produtos do catálogo abaixo.
Responda OBRIGATORIAMENTE em formato JSON estrito contendo APENAS duas chaves: 
1. "respostaTextual": string com a resposta amigável para o cliente.
2. "produtosSugeridos": array contendo os IDs numéricos ou textuais dos produtos sugeridos.

CATÁLOGO DISPONÍVEL: 
${JSON.stringify(cachedCatalog)}

MENSAGEM DO CLIENTE: 
${mensagemCliente}
`;
        
        let textoResposta = "";

        try {
            // TENTATIVA 1: Gemini 1.5 Flash (Rápido, mas pode dar 404 na sua conta)
            const model15 = ai.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
            const result = await model15.generateContent(promptUniversal);
            textoResposta = result.response.text();
        } catch (err15) {
            console.warn("Modelo 1.5 bloqueado pelo Google. Ativando Resiliência para 1.0 Pro:", err15.message);
            
            // TENTATIVA 2: Fallback Absoluto (O Gemini Pro Universal)
            const model10 = ai.getGenerativeModel({ model: 'gemini-pro' });
            const result = await model10.generateContent(promptUniversal);
            textoResposta = result.response.text();
        }
        
        // Limpa sujeiras de markdown que a IA possa enviar por acidente
        textoResposta = textoResposta.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResposta = JSON.parse(textoResposta);

        return res.status(200).json({ 
            sucesso: true, 
            resposta: jsonResposta.respostaTextual || "Aqui estão as minhas sugestões de hoje!", 
            sugestoes: jsonResposta.produtosSugeridos || []
        });

    } catch (error) {
        console.error("CRASH NO SERVIDOR:", error.message);
        return res.status(500).json({ 
            sucesso: false, 
            error: error.message,
            resposta: "Desculpe, tive um pequeno soluço técnico agora.",
            sugestoes: [] 
        });
    }
};
