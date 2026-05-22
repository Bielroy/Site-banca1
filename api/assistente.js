import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/generative-ai';

// Inicialização segura do Firebase Admin
if (!global.firebaseAdminInitialized) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
    global.firebaseAdminInitialized = true;
}

const db = getFirestore();

// Inicializa o SDK do Gemini usando a sua API Key protegida em ambiente cloud
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ sucesso: false, error: 'Método não permitido' });
    }

    try {
        const { mensagemCliente } = req.body;
        if (!mensagemCliente) {
            return res.status(400).json({ sucesso: false, error: 'Mensagem inválida' });
        }

        // 1. Busca todos os produtos ativos direto do Firestore para passar o contexto real à IA
        const produtosSnap = await db.collection('produtos').where('ativo', '==', true).get();
        const catalogoDisponivel = [];
        
        produtosSnap.forEach(doc => {
            const data = doc.data();
            catalogoDisponivel.push({
                id: doc.id,
                nome: data.nome,
                preco: data.preco,
                unidade: data.unidade || 'un',
                cat: data.cat
            });
        });

        // 2. Instancia o modelo ultra-rápido focado em chat e tarefas estruturadas
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

        // 3. Prompt de Sistema rigoroso definindo comportamento comercial, tom de voz e regras de saída
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

        // 4. Executa a chamada gerando a resposta
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
