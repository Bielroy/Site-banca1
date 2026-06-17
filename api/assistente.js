const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let kv = null;
try { kv = require('@vercel/kv').kv; } catch(e) {}

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

    const { action, mensagemCliente, historico = [], carrinho = [], imagem, produtoInfo, historicoVendas } = req.body;

    try {
        bootFirebase();
        if(!ai) ai = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || "").replace(/['"]/g, '').trim());

        if (!cachedCatalog || (Date.now() - cacheTimestamp > 180000)) {
            if(db) {
                const snap = await db.collection('produtos').where('ativo', '==', true).get();
                cachedCatalog = [];
                snap.forEach(d => cachedCatalog.push({ id: d.id, nome: d.data().nome, preco: d.data().preco }));
                cacheTimestamp = Date.now();
            }
        }

        // [STREAMING DA IA - CORRIGIDO CONTRA CRASHES DA GOOGLE]
        if (action === 'chat_stream') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const sysInst = `És o Sommelier da Banca Adair.
1. Só oferece produtos do catálogo: ${JSON.stringify(cachedCatalog)}.
2. [NEGOCIAÇÃO]: Se o cliente pedir desconto, gera um cupão de até 10%. Diz para inserir 'IA-DESCONTO-10'.
3. IMPORTANTE: Para sugerir produtos, escreve EXATAMENTE no final da resposta: [SUGESTOES: ID_DO_PRODUTO_1, ID_DO_PRODUTO_2]`;

            // Construção Segura: Fundir todo o histórico num único texto!
            let conversaCompilada = "";
            if (historico && historico.length > 0) {
                historico.forEach(msg => {
                    conversaCompilada += `[${msg.role === 'ia' ? 'ASSISTENTE' : 'CLIENTE'}]: ${msg.content}\n`;
                });
            }

            const promptFinal = `
${sysInst}

[HISTÓRICO DA CONVERSA RECENTE]
${conversaCompilada || 'Nenhuma conversa anterior.'}

[CARRINHO ATUAL DO CLIENTE]
${carrinho && carrinho.length > 0 ? JSON.stringify(carrinho) : 'Carrinho Vazio'}

[MENSAGEM ATUAL DO CLIENTE]: ${mensagemCliente}`;

            const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
            
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
                res.write(`data: ${JSON.stringify({ text: `\n[Erro na IA: ${streamErr.message}]` })}\n\n`);
                res.write(`data: [DONE]\n\n`);
                return res.end();
            }
        }

        const modelStandard = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

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
            const modelKit = ai.getGenerativeModel({ model: 'gemini-1.5-flash', generationConfig: { responseMimeType: "application/json" } });
            const resultKit = await modelKit.generateContent(`Analise catálogo: ${JSON.stringify(cachedCatalog)}. Crie "Kit Promocional". JSON VÁLIDO: {"nome":"", "descricao":"", "preco":0.00, "itensInclusos":""}`);
            return res.status(200).json({ sucesso: true, kit: JSON.parse(resultKit.response.text()) });
        }

        return res.status(400).json({ error: "Ação não suportada." });

    } catch (err) {
        if(!res.headersSent) return res.status(500).json({ error: err.message });
        return res.end();
    }
};
