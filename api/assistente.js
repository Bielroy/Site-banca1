const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// FASE 3: Rate Limiting Distribuído (3.07)
let kv;
try { kv = require('@vercel/kv').kv; } catch(e) { console.warn("Vercel KV não instalado. Fallback para memória."); }

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
        }
        if(credential) admin.initializeApp({ credential });
    }
    if (!db && admin.apps.length) db = admin.firestore();
};

let cachedCatalog = null;
let cacheTimestamp = 0;
const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Method Not Allowed' });

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

    // Sistema Híbrido de Rate Limit (Vercel KV ou Memória)
    try {
        if (kv && process.env.KV_REST_API_URL) {
            const limit = await kv.incr(`rate:ia:${ip}`);
            if (limit === 1) await kv.expire(`rate:ia:${ip}`, 10);
            if (limit > 5) return res.status(429).json({ error: 'Muitas requisições. Abrandar.' });
        } else {
            const agora = Date.now();
            if (rateLimitMap.has(ip) && agora - rateLimitMap.get(ip) < 2000) return res.status(429).json({ error: 'Muitas requisições.' });
            rateLimitMap.set(ip, agora);
        }
    } catch(e) { console.warn("Erro no Rate Limit", e); }

    const { action, mensagemCliente, historico = [], carrinho = [], imagem } = req.body;

    try {
        bootFirebase();
        if(!ai) ai = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || "").replace(/['"]/g, '').trim());

        // Cache do Catálogo (mantém sincronia de contexto)
        if (!cachedCatalog || (Date.now() - cacheTimestamp > 180000)) {
            if(db) {
                const snap = await db.collection('produtos').where('ativo', '==', true).get();
                cachedCatalog = [];
                snap.forEach(d => cachedCatalog.push({ id: d.id, nome: d.data().nome, preco: d.data().preco }));
                cacheTimestamp = Date.now();
            }
        }

        // FASE 3: Action "chat_stream" substitui o chat normal (3.01, 3.02, 3.04)
        if (action === 'chat_stream') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // FASE 3: Instrução de Negociação (3.04)
            const sysInst = `És o Sommelier da Banca Adair. O cliente tem perguntas.
1. Só oferece produtos do catálogo: ${JSON.stringify(cachedCatalog)}.
2. Se o cliente enviar foto, diz o que vês na foto que tens na loja.
3. [NEGOCIAÇÃO]: Se o cliente pedir insistentemente um desconto, tens autorização para gerar um cupão de até 10%. Diz ao cliente para inserir 'IA-DESCONTO-10' na página de checkout.
4. MUITO IMPORTANTE: Escreve de forma fluída. Se quiseres sugerir botões para o cliente adicionar ao carrinho, escreve EXATAMENTE no final da tua resposta: [SUGESTOES: ID_DO_PRODUTO_1, ID_DO_PRODUTO_2]`;

            const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction: sysInst });

            const contents = historico.map(msg => ({ role: msg.role === 'ia' ? 'model' : 'user', parts: [{ text: msg.content }] }));
            
            // FASE 3: Payload de Visão Computacional (3.02)
            const userParts = [{ text: `[CARRINHO ATUAL: ${JSON.stringify(carrinho)}]\n\nMensagem: ${mensagemCliente}` }];
            if (imagem && imagem.data) {
                userParts.push({ inlineData: { data: imagem.data, mimeType: imagem.mimeType } });
            }
            contents.push({ role: 'user', parts: userParts });

            // Iniciar o Streaming e canalizar para a Response (Pipe)
            const resultStream = await model.generateContentStream({ contents });
            for await (const chunk of resultStream.stream) {
                const text = chunk.text();
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
            res.write(`data: [DONE]\n\n`);
            return res.end();
        }

        return res.status(400).json({ error: "Ação não reconhecida." });

    } catch (err) {
        console.error("ERRO ASSISTENTE:", err);
        if(!res.headersSent) return res.status(500).json({ error: err.message });
        res.write(`data: ${JSON.stringify({ text: "\n[Erro de rede. Tente novamente.]" })}\n\n`);
        return res.end();
    }
};
