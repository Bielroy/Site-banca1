const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let kv = null;
try { kv = require('@vercel/kv').kv; } catch(e) {}

const formatPrivateKey = (key) => key ? key.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '';

let db;

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

        // BATERIA DE MODELOS: A Lista de Sobrevivência
        const modelosDisponiveis = [
            'gemini-1.5-flash-latest', 
            'gemini-1.5-flash', 
            'gemini-1.0-pro-latest', 
            'gemini-pro'
        ];

        // Helper Blindado para Ações do Painel Admin
        const tentarGerarTexto = async (prompt) => {
            let ultimoErro = null;
            for (const nomeModelo of modelosDisponiveis) {
                try {
                    const model = ai.getGenerativeModel({ model: nomeModelo });
                    const result = await model.generateContent(prompt);
                    return result;
                } catch (e) { ultimoErro = e; }
            }
            throw ultimoErro;
        };

        // [STREAMING DA IA NO CHAT]
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

            const userParts = [{ text: promptFinal }];
            if (imagem && imagem.data) userParts.push({ inlineData: { data: imagem.data, mimeType: imagem.mimeType } });

            let resultStream = null;
            let erroFinal = "";

            // O SEGREDO CONTRA ERROS: Testa os modelos um por um até um funcionar!
            for (const nomeModelo of modelosDisponiveis) {
                try {
                    const model = ai.getGenerativeModel({ model: nomeModelo });
                    resultStream = await model.generateContentStream({ contents: [{ role: 'user', parts: userParts }] });
                    break; // Se funcionou, cancela o loop de erros!
                } catch (err) {
                    erroFinal = err.message;
                }
            }

            // Se TODOS os modelos falharem, exibe uma mensagem amigável explicando o motivo
            if (!resultStream) {
                let amigavel = "Erro de conexão com a IA.";
                if (erroFinal.includes('429') || erroFinal.includes('quota') || erroFinal.includes('limit')) {
                    amigavel = "A sua chave da Google esgotou o plano gratuito. Precisa de ativar a faturação (Billing) na Google Cloud ou criar uma chave com uma conta Google nova.";
                } else if (erroFinal.includes('404')) {
                    amigavel = "A sua chave não tem permissão para os modelos mais recentes. Crie uma chave nova no AI Studio.";
                } else if (erroFinal.includes('API_KEY_INVALID')) {
                    amigavel = "A chave da API fornecida nas configurações da Vercel é inválida.";
                }
                res.write(`data: ${JSON.stringify({ text: `\n🚨 **[ERRO]**: ${amigavel}**\n*(Detalhe Técnico: ${erroFinal})*` })}\n\n`);
                res.write(`data: [DONE]\n\n`);
                return res.end();
            }

            // Se um modelo funcionou, envia a resposta fluída
            for await (const chunk of resultStream.stream) {
                res.write(`data: ${JSON.stringify({ text: chunk.text() })}\n\n`);
            }
            res.write(`data: [DONE]\n\n`);
            return res.end();
        }

        // Outras Ações Administrativas
        if (action === 'social_post') {
            const result = await tentarGerarTexto(`Crie um post engajador para Instagram sobre o produto: "${produtoInfo?.nome}". Categoria: ${produtoInfo?.cat}. Preço: R$ ${produtoInfo?.preco}. Use emojis e 3 hashtags.`);
            return res.status(200).json({ sucesso: true, post: result.response.text().trim() });
        }
        if (action === 'demand_prediction') {
            const result = await tentarGerarTexto(`Analise este resumo logístico: ${JSON.stringify(historicoVendas)}. Forneça relatório HTML: 1. Alertas de Reposição, 2. Dias de Pico, 3. Sugestão.`);
            return res.status(200).json({ sucesso: true, relatorio: result.response.text().trim() });
        }
        if (action === 'gerar_descricao') {
            const result = await tentarGerarTexto(`Crie descrição persuasiva para: "${produtoInfo?.nome}". Responda APENAS com a descrição.`);
            return res.status(200).json({ sucesso: true, descricao: result.response.text().trim() });
        }
        if (action === 'gerar_kit') {
            const resultKit = await tentarGerarTexto(`Analise catálogo: ${JSON.stringify(cachedCatalog)}. Crie "Kit Promocional". JSON VÁLIDO: {"nome":"", "descricao":"", "preco":0.00, "itensInclusos":""}`);
            let kitJson = resultKit.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            return res.status(200).json({ sucesso: true, kit: JSON.parse(kitJson) });
        }

        return res.status(400).json({ error: "Ação não suportada." });

    } catch (err) {
        if(!res.headersSent) return res.status(500).json({ error: err.message });
        return res.end();
    }
};
