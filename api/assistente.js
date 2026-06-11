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

        // [IA - FASE 2] Routing de Ações (action) para suportar Admin Tools
        const { action = 'chat', mensagemCliente, historico = [], carrinho = [], produtoInfo } = req.body;

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

        // ---------------------------------------------------------------------
        // FEATURE 2.05: Gerador de Descrição de Produto
        // ---------------------------------------------------------------------
        if (action === 'gerar_descricao') {
            const prompt = `Atue como um Especialista em Marketing Gastronómico. Crie uma descrição extremamente apetitosa e persuasiva (máximo 2 frases) para o produto: "${produtoInfo?.nome}" (Categoria: ${produtoInfo?.cat}).
Foque na frescura, origem ou qualidade. Pode usar no máximo 1 emoji. 
Responda APENAS com o texto da descrição. Sem aspas ou formatações extras.`;
            
            const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const result = await model.generateContent(prompt);
            return res.status(200).json({ sucesso: true, descricao: result.response.text().trim() });
        }

        // ---------------------------------------------------------------------
        // FEATURE 2.06: Montador de Kits Inteligentes
        // ---------------------------------------------------------------------
        if (action === 'gerar_kit') {
            const promptKit = `Atue como Estrategista de Retalho. Analise este catálogo de produtos:
${JSON.stringify(cachedCatalog)}

Crie um "Kit Promocional" agrupando produtos que combinam perfeitamente (ex: Kit Salada Completa, Kit Sumos Detox, Kit Sopa de Inverno).
Regras:
1. Use APENAS produtos existentes no catálogo acima.
2. O "preco" do kit deve ter um desconto de aproximadamente 10% a 15% em relação à soma dos itens individuais.
3. Retorne a resposta OBRIGATORIAMENTE num JSON válido.

Formato esperado:
{
  "nome": "Nome criativo do Kit",
  "descricao": "Texto persuasivo a vender a ideia do kit",
  "preco": valor_float_com_desconto,
  "itensInclusos": "2x Tomate, 1x Alface, 1x Cebola (apenas os nomes que usou)"
}`;
            const modelKit = ai.getGenerativeModel({ 
                model: 'gemini-1.5-flash', 
                systemInstruction: "Devolva ESTRITAMENTE o JSON solicitado, sem blocos de markdown.",
                generationConfig: { responseMimeType: "application/json" }
            });
            const resultKit = await modelKit.generateContent(promptKit);
            const kitData = JSON.parse(resultKit.response.text());
            return res.status(200).json({ sucesso: true, kit: kitData });
        }

        // ---------------------------------------------------------------------
        // FUNCIONAMENTO PADRÃO (Atendimento ao Cliente - FASE 1)
        // ---------------------------------------------------------------------
        if (!mensagemCliente || typeof mensagemCliente !== 'string') {
            return res.status(400).json({ sucesso: false, error: 'Mensagem inválida.' });
        }

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

        let resumoCarrinho = "O cliente ainda não colocou nada no carrinho.";
        if (carrinho && carrinho.length > 0) {
            const itensCart = carrinho.map(item => `${item.qtd}${item.unidade || 'un'} de ${item.nome}`).join(", ");
            resumoCarrinho = `ATENÇÃO: O cliente JÁ TEM no carrinho: ${itensCart}. Não sugira comprar o que ele já adicionou, a menos que faça sentido. Sugira complementos!`;
        }

        const formattedContents = [];
        historico.forEach(msg => {
            formattedContents.push({ role: msg.role === 'ia' ? 'model' : 'user', parts: [{ text: msg.content }] });
        });

        const currentPrompt = `[CONTEXTO DO SISTEMA]\n${resumoCarrinho}\n\n[MENSAGEM DO CLIENTE]\n${mensagemCliente}`;
        formattedContents.push({ role: 'user', parts: [{ text: currentPrompt }] });

        let textoResposta = "";
        const generationConfig = { temperature: 0.7, responseMimeType: "application/json" };

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
