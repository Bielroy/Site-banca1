import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/generative-ai';

// [3] Inicialização Estável do Firebase Admin (Evita Cold Start Crashes)
if (!getApps().length) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}

const db = getFirestore();

// Inicializa o SDK do Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// [2] Cache In-Memory Serverless (Economia absurda de custos de leitura no Firestore)
let cachedCatalog = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // O cache expira a cada 5 minutos

// [4] Rate Limit Básico em Memória (Evita Spam Bots)
const rateLimitMap = new Map();

export default async function handler(req, res) {
    // Configurações CORS
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ sucesso: false, error: 'Método não permitido' });
    }

    // Rate Limiting por IP (Máximo de 1 mensagem a cada 3 segundos por usuário)
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const agora = Date.now();
    if (rateLimitMap.has(ip)) {
        if (agora - rateLimitMap.get(ip) < 3000) {
            return res.status(429).json({ sucesso: false, resposta: "Você está enviando mensagens muito rápido. Por favor, aguarde alguns segundos.", sugestoes: [] });
        }
    }
    rateLimitMap.set(ip, agora);
    // Prevenção de memory leak no Map
    if (rateLimitMap.size > 2000) rateLimitMap.clear();

    try {
        const { mensagemCliente } = req.body;
        
        // Validação de Payload (Evita tokens excessivos)
        if (!mensagemCliente || typeof mensagemCliente !== 'string' || mensagemCliente.length > 500) {
            return res.status(400).json({ sucesso: false, error: 'Mensagem inválida ou muito longa.' });
        }

        // Lógica de Cache (Só bate no banco se o cache não existir ou estiver vencido)
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

        // Instancia o modelo
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

        const resultado = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: mensagemCliente }] }],
            generationConfig: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
                temperature: 0.3
            }
        });

        const textoResposta = resultado.response.text();
        const jsonResposta = JSON.parse(textoResposta);

        return res.status(200).json({
            sucesso: true,
            resposta: jsonResposta.respostaTextual,
            sugestoes: jsonResposta.produtosSugeridos
        });

    } catch (error) {
        console.error("Erro no Assistente Gemini:", error);
        return res.status(500).json({ 
            sucesso: false, 
            resposta: "Olá! Desculpe, tive um pequeno soluço técnico na minha IA. Como posso te ajudar com os nossos vegetais frescos hoje?",
            sugestoes: [] 
        });
    }
}
