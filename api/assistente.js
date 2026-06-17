const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let kv = null;
try { kv = require('@vercel/kv').kv; } catch(e) {}

const formatPrivateKey = (key) => key ? key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '';

let db;
// Definimos o modelo mais rápido, moderno e 100% gratuito da Google!
const MODEL_NAME = 'gemini-1.5-flash';

const bootFirebase = () => {
    if (!admin.apps.length) {
        let credential;
        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            credential = admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID.trim(),
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
                privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY)
            });
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
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    
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
    } catch(e) {}

    const { action, mensagemCliente, historico = [], carrinho = [], imagem, produtoInfo, historicoVendas } = req.body;

    try {
        bootFirebase();
        const rawKey = process.env.GEMINI_API_KEY || "";
        const cleanKey = rawKey.replace(/['"]/g, '').trim();
        if (!cleanKey) throw new Error("A chave GEMINI_API_KEY não está na Vercel.");

        const ai = new GoogleGenerativeAI(cleanKey);

        if (!cachedCatalog || (Date.now() - cacheTimestamp > 180000)) {
            if(db) {
                const snap = await db.collection('produtos').where('ativo', '==', true).get();
                cachedCatalog = [];
                snap.forEach(d => cachedCatalog.push({ id: d.id, nome: d.data().nome, preco: d.data().preco }));
                cacheTimestamp = Date.now();
            }
        }

        // [STREAMING DA IA - LIGAÇÃO DIRETA]
        if (action === 'chat_stream') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const sysInst = `És o Sommelier da Banca Adair.
1. Só oferece produtos do catálogo: ${JSON.stringify(cachedCatalog)}.
2. [NEGOCIAÇÃO]: Se o cliente pedir desconto, gera um cupão de até 10%. Diz para inserir 'IA-DESCONTO-10'.
3. IMPORTANTE: Para sugerir produtos, escreve EXATAMENTE no final da resposta: [SUGESTOES: ID_DO_PRODUTO_1, ID_DO_PRODUTO_2]`;

            let conversaCompilada = "";
            if (historico && historico.length > 0) {
                historico.forEach(msg => { conversaCompilada += `[${msg.role === 'ia' ? 'ASSISTENTE' : 'CLIENTE'}]: ${msg.content}\n`; });
            }

            const promptFinal = `${sysInst}\n\n[HISTÓRICO]\n${conversaCompilada || 'Vazio.'}\n\n[CARRINHO]\n${carrinho && carrinho.length > 0 ? JSON.stringify(carrinho) : 'Vazio'}\n\n[MENSAGEM]: ${mensagemCliente}`;

            const model = ai.getGenerativeModel({ model: MODEL_NAME });
            
            const userParts = [{ text: promptFinal }];
            if (imagem && imagem.data) userParts.push({ inlineData: { data: imagem.data, mimeType: imagem.mimeType } });

            try {
                const resultStream = await model.generateContentStream({ contents: [{ role: 'user', parts: userParts }] });
                for await (const chunk of resultStream.stream) {
                    res.write(`data: ${JSON.stringify({ text: chunk.text() })}\n\n`);
                }
                res.write(`data: [DONE]\n\n`);
                return res.end();
            } catch (streamErr) {
                let errMsg = streamErr.message;
                if(errMsg.includes('429')) errMsg = "Atingiu o limite de mensagens da Google ou a chave é inválida.";
                res.write(`data: ${JSON.stringify({ text: `\n[Erro na API: ${errMsg}]` })}\n\n`);
                res.write(`data: [DONE]\n\n`);
                return res.end();
            }
        }

        const modelStandard = ai.getGenerativeModel({ model: MODEL_NAME });

        if (action === 'social_post') {
            const result = await modelStandard.generateContent(`Crie um post engajador para Instagram sobre o produto: "${produtoInfo?.nome}". Categoria: ${produtoInfo?.cat}. Preço: R$ ${produtoInfo?.preco}. Use emojis e 3 hashtags.`);
            return res.status(200).json({ sucesso: true, post: result.response.text().trim() });
        }
        if (action === 'demand_prediction') {
            const result = await modelStandard.generateContent(`Analise este resumo logístico: ${JSON.stringify(historicoVendas)}. Forneça relatório HTML: 1. Alertas de Reposição, 2. Dias de Pico, 3. Sugestão.`);
            return res.status(200).json({ sucesso: true, relatorio: result.response.text().trim() });
        }
        if (action === 'gerar_descricao') {
            const result = await modelStandard.generateContent(`Crie descrição persuasiva para: "${produtoInfo?.nome}". Responda APENAS com a descrição.`);
            return res.status(200).json({ sucesso: true, descricao: result.response.text().trim() });
        }
        if (action === 'gerar_kit') {
            const resultKit = await modelStandard.generateContent(`Analise catálogo: ${JSON.stringify(cachedCatalog)}. Crie "Kit Promocional". JSON VÁLIDO: {"nome":"", "descricao":"", "preco":0.00, "itensInclusos":""}`);
            let kitJson = resultKit.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            return res.status(200).json({ sucesso: true, kit: JSON.parse(kitJson) });
        }

        return res.status(400).json({ error: "Ação não suportada." });

    } catch (err) {
        if(!res.headersSent) return res.status(500).json({ error: err.message });
        return res.end();
    }
};
