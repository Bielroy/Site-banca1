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
// TTL reduzido para garantir sincronia mais fina do catálogo no backend
const CACHE_TTL = 3 * 60 * 1000; 

const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
    // [SEGURANÇA - FASE 1] Restringir CORS em Produção
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ sucesso: false, error: 'Método não permitido' });

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const agora = Date.now();
    
    // Cleanup do rate limit para evitar vazamento de memória e zeragem global abrupta (S04 Parcial)
    if (rateLimitMap.size > 2000) {
        const excesso = agora - 60000;
        for (let [k, v] of rateLimitMap.entries()) {
            if (v < excesso) rateLimitMap.delete(k);
        }
    }

    if (rateLimitMap.has(ip) && agora - rateLimitMap.get(ip) < 3000) {
        return res.status(429).json({ sucesso: false, resposta: "Aguarde uns segundos para mandar outra mensagem.", sugestoes: [] });
    }
    rateLimitMap.set(ip, agora);

    try {
        const rawApiKey = process.env.GEMINI_API_KEY || "";
        const cleanApiKey = rawApiKey.replace(/['"]/g, '').trim(); 
        
        if (!cleanApiKey) throw new Error("A chave GEMINI_API_KEY não existe na Vercel.");
        if (!ai) ai = new GoogleGenerativeAI(cleanApiKey);
        
        bootFirebase();

        // Novo payload suportando histórico e contexto do carrinho (I01, I02)
        const { mensagemCliente, historico = [], carrinho = [] } = req.body;
        if (!mensagemCliente || typeof mensagemCliente !== 'string') {
            return res.status(400).json({ sucesso: false, error: 'Mensagem inválida.' });
        }

        if (!cachedCatalog || (agora - cacheTimestamp > CACHE_TTL)) {
            const snap = await db.collection('produtos').where('ativo', '==', true).get();
            const temp = [];
            snap.forEach(doc => { 
                const d = doc.data(); 
                temp.push({ id: doc.id, nome: d.nome, preco: d.preco, cat: d.cat, unidade: d.unidade || 'un' }); 
            });
            cachedCatalog = temp;
            cacheTimestamp = agora;
        }

        // Prompt Engineering Avançado: Instrução do Sistema separada do contexto do usuário
        const systemInstruction = `
Você é o simpático e experiente sommelier de hortifruti da Banca Adair e Pedrina.
Seu objetivo é ajudar clientes a escolher produtos, dar dicas de preparo, sugerir receitas rápidas e converter vendas de forma natural.

REGRAS DE OURO:
1. Use APENAS os produtos disponíveis no catálogo. Nunca invente produtos.
2. Seja prestativo, caloroso e use emojis com moderação.
3. Se o cliente pedir dicas para uma receita, sugira os itens do catálogo que combinam.
4. OBRIGATÓRIO: Retorne a resposta ESTRITAMENTE em formato JSON.

FORMATO DE SAÍDA EXIGIDO:
{
  "respostaTextual": "Sua resposta humanizada e amigável aqui.",
  "produtosSugeridos": ["ID_DO_PRODUTO_1", "ID_DO_PRODUTO_2"]
}

CATÁLOGO DISPONÍVEL HOJE: 
${JSON.stringify(cachedCatalog)}
`;

        // Construção do contexto do Carrinho
        let resumoCarrinho = "O cliente ainda não colocou nada no carrinho.";
        if (carrinho && carrinho.length > 0) {
            const itensCart = carrinho.map(item => `${item.qtd}${item.unidade || 'un'} de ${item.nome}`).join(", ");
            resumoCarrinho = `ATENÇÃO: O cliente JÁ TEM no carrinho: ${itensCart}. Não sugira comprar o que ele já adicionou, a menos que faça sentido. Sugira complementos!`;
        }

        // Histórico Multi-turn para o Gemini
        const formattedContents = [];
        historico.forEach(msg => {
            formattedContents.push({
                role: msg.role === 'ia' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        });

        // Última mensagem com a injeção do carrinho invisível ao usuário, mas visível à IA
        const currentPrompt = `[CONTEXTO DO SISTEMA]\n${resumoCarrinho}\n\n[MENSAGEM DO CLIENTE]\n${mensagemCliente}`;
        formattedContents.push({ role: 'user', parts: [{ text: currentPrompt }] });

        let textoResposta = "";

        const generationConfig = {
            temperature: 0.7,
            responseMimeType: "application/json", // Força o JSON Mode nativamente no Gemini 1.5
        };

        try {
            const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction });
            const result = await model.generateContent({ contents: formattedContents, generationConfig });
            textoResposta = result.response.text();
        } catch (errApi) {
            console.warn("Modelo padrão falhou. Iniciando varredura na conta da Google...");
            const respostaModelos = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanApiKey}`);
            const dadosModelos = await respostaModelos.json();

            if (!dadosModelos.models) throw new Error("Chave sem acesso a modelos.");

            const modeloValido = dadosModelos.models.find(m => 
                m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent") && m.name.includes("gemini")
            );

            if (modeloValido) {
                const nomeRealDoModelo = modeloValido.name.replace('models/', '');
                const modelFallback = ai.getGenerativeModel({ model: nomeRealDoModelo, systemInstruction });
                const resultFallback = await modelFallback.generateContent({ contents: formattedContents, generationConfig });
                textoResposta = resultFallback.response.text();
            } else {
                throw new Error("Nenhum modelo compatível encontrado.");
            }
        }
        
        // Limpeza de segurança caso o Gemini ignore a tipagem
        textoResposta = textoResposta.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResposta = JSON.parse(textoResposta);

        return res.status(200).json({ 
            sucesso: true, 
            resposta: jsonResposta.respostaTextual || "Aqui estão as minhas sugestões de hoje!", 
            sugestoes: jsonResposta.produtosSugeridos || []
        });

    } catch (error) {
        console.error("ERRO ASSISTENTE:", error.message);
        return res.status(500).json({ 
            sucesso: false, 
            error: error.message,
            resposta: "Desculpe, a nossa rede de hortifruti deu um pequeno curto-circuito. Pode repetir?",
            sugestoes: [] 
        });
    }
};
