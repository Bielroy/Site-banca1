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
const CACHE_TTL = 3 * 60 * 1000; 

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
    
    if (rateLimitMap.size > 2000) {
        const excesso = agora - 60000;
        for (let [k, v] of rateLimitMap.entries()) {
            if (v < excesso) rateLimitMap.delete(k);
        }
    }

    // Abrandámos o Rate Limit para a IA conseguir responder a análises profundas do Admin
    if (rateLimitMap.has(ip) && agora - rateLimitMap.get(ip) < 2000) {
        return res.status(429).json({ sucesso: false, resposta: "Aguarde uns segundos para nova ação." });
    }
    rateLimitMap.set(ip, agora);

    try {
        const rawApiKey = process.env.GEMINI_API_KEY || "";
        const cleanApiKey = rawApiKey.replace(/['"]/g, '').trim(); 
        if (!cleanApiKey) throw new Error("A chave GEMINI_API_KEY não existe.");
        if (!ai) ai = new GoogleGenerativeAI(cleanApiKey);
        
        bootFirebase();

        const { action = 'chat', mensagemCliente, historico = [], carrinho = [], produtoInfo, historicoVendas } = req.body;

        if (!cachedCatalog || (agora - cacheTimestamp > CACHE_TTL)) {
            const snap = await db.collection('produtos').where('ativo', '==', true).get();
            const temp = [];
            snap.forEach(doc => { 
                const d = doc.data(); 
                temp.push({ id: doc.id, nome: d.nome, preco: d.preco, cat: d.cat, unidade: d.unidade || 'un', estoque: d.estoque || 0 }); 
            });
            cachedCatalog = temp;
            cacheTimestamp = agora;
        }

        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

        // ---------------------------------------------------------------------
        // FASE 3: Gerador de Posts para Redes Sociais (3.05)
        // ---------------------------------------------------------------------
        if (action === 'social_post') {
            const promptPost = `Atue como um Especialista em Social Media focado em E-commerce Local de hortifruti.
Crie um post altamente engajador para WhatsApp Status e Instagram sobre o produto: "${produtoInfo?.nome}".
Categoria: ${produtoInfo?.cat} | Preço: R$ ${produtoInfo?.preco}.
Inclua: 1. Gatilho de desejo visual (texto). 2. Chamada para ação (Compre na nossa loja online). 3. Emojis bem distribuídos e 3 hashtags relevantes.
O texto deve ser curto, direto e irresistível.`;
            
            const result = await model.generateContent(promptPost);
            return res.status(200).json({ sucesso: true, post: result.response.text().trim() });
        }

        // ---------------------------------------------------------------------
        // FASE 3: Previsão de Demanda (3.08)
        // ---------------------------------------------------------------------
        if (action === 'demand_prediction') {
            const promptAnalise = `Atue como um Analista de Dados e Especialista em Cadeia de Suprimentos.
Analise este resumo das vendas logísticas recentes da banca:
${JSON.stringify(historicoVendas)}

O seu objetivo é fornecer um relatório Executivo e Rápido com:
1. "Top Produtos em Alerta": Quais produtos estão a vender mais rápido e precisam de reforço de stock com urgência.
2. "Dias de Pico": Qual é o dia da semana que exige mais capacidade de entrega.
3. "Ação Sugerida": Uma sugestão estratégica (ex: "faça um desconto no produto X que está a sair pouco", ou "Compre mais Y para o fim de semana").
Use formato HTML simples com <b>, <ul>, <li> para eu exibir no painel de administração da loja. Vá direto ao ponto, não diga 'Aqui está a análise'.`;

            const modelDemand = ai.getGenerativeModel({ model: 'gemini-1.5-flash', generationConfig: { temperature: 0.4 } });
            const resultAnalise = await modelDemand.generateContent(promptAnalise);
            return res.status(200).json({ sucesso: true, relatorio: resultAnalise.response.text().trim() });
        }

        // ---------------------------------------------------------------------
        // FASE 2: Gerador de Descrição de Produto
        // ---------------------------------------------------------------------
        if (action === 'gerar_descricao') {
            const prompt = `Atue como um Especialista em Marketing Gastronómico. Crie uma descrição extremamente apetitosa e persuasiva (máximo 2 frases) para o produto: "${produtoInfo?.nome}" (Categoria: ${produtoInfo?.cat}).
Foque na frescura, origem ou qualidade. Pode usar no máximo 1 emoji. 
Responda APENAS com o texto da descrição. Sem aspas ou formatações extras.`;
            const result = await model.generateContent(prompt);
            return res.status(200).json({ sucesso: true, descricao: result.response.text().trim() });
        }

        // ---------------------------------------------------------------------
        // FASE 2: Montador de Kits Inteligentes
        // ---------------------------------------------------------------------
        if (action === 'gerar_kit') {
            const promptKit = `Atue como Estrategista de Retalho. Analise este catálogo: ${JSON.stringify(cachedCatalog)}
Crie um "Kit Promocional" agrupando produtos que combinam perfeitamente.
Regras: 1. Apenas produtos do catálogo. 2. Desconto de ~10% a 15% na soma. 3. JSON VÁLIDO OBRIGATÓRIO.
Formato: {"nome": "Kit...", "descricao": "...", "preco": 0.00, "itensInclusos": "..."}`;
            
            const modelKit = ai.getGenerativeModel({ 
                model: 'gemini-1.5-flash', systemInstruction: "Devolva ESTRITAMENTE JSON.",
                generationConfig: { responseMimeType: "application/json" }
            });
            const resultKit = await modelKit.generateContent(promptKit);
            return res.status(200).json({ sucesso: true, kit: JSON.parse(resultKit.response.text()) });
        }

        // ---------------------------------------------------------------------
        // Atendimento ao Cliente Chat (Padrão)
        // ---------------------------------------------------------------------
        const systemInstruction = `Você é o sommelier de hortifruti da Banca Adair e Pedrina. Ajude a escolher produtos.
REGRAS: 1. Use APENAS o catálogo. 2. Seja caloroso. 3. JSON VÁLIDO ESTRITO.
Formato: {"respostaTextual": "...", "produtosSugeridos": ["ID1", "ID2"]}
CATÁLOGO DE HOJE: ${JSON.stringify(cachedCatalog)}`;

        let resumoCarrinho = carrinho && carrinho.length > 0 
            ? `ATENÇÃO: O cliente JÁ TEM no carrinho: ${carrinho.map(item => `${item.qtd} de ${item.nome}`).join(", ")}.` 
            : "O cliente ainda não colocou nada no carrinho.";

        const formattedContents = historico.map(msg => ({ role: msg.role === 'ia' ? 'model' : 'user', parts: [{ text: msg.content }] }));
        formattedContents.push({ role: 'user', parts: [{ text: `[CONTEXTO]\n${resumoCarrinho}\n\n[MENSAGEM DO CLIENTE]\n${mensagemCliente}` }] });

        const modelChat = ai.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction });
        const resultChat = await modelChat.generateContent({ contents: formattedContents, generationConfig: { responseMimeType: "application/json" } });
        
        const jsonResposta = JSON.parse(resultChat.response.text().replace(/```json/g, '').replace(/```/g, '').trim());
        return res.status(200).json({ sucesso: true, resposta: jsonResposta.respostaTextual, sugestoes: jsonResposta.produtosSugeridos || [] });

    } catch (error) {
        console.error("ERRO ASSISTENTE:", error.message);
        return res.status(500).json({ sucesso: false, error: error.message, resposta: "Tivemos um problema de ligação. Tente novamente." });
    }
};
