        // [STREAMING DA IA - CORRIGIDO CONTRA CRASHES DE HISTÓRICO]
        if (action === 'chat_stream') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const sysInst = `És o Sommelier da Banca Adair.
1. Só oferece produtos do catálogo: ${JSON.stringify(cachedCatalog)}.
2. [NEGOCIAÇÃO]: Se o cliente pedir desconto, gera um cupão de até 10%. Diz para inserir 'IA-DESCONTO-10'.
3. IMPORTANTE: Para sugerir produtos, escreve EXATAMENTE no final da resposta: [SUGESTOES: ID_DO_PRODUTO_1, ID_DO_PRODUTO_2]`;

            // Construção Blindada: Transforma o histórico em texto para não quebrar a API do Gemini
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
                // Envia tudo como uma única requisição protegida
                const resultStream = await model.generateContentStream({ contents: [{ role: 'user', parts: userParts }] });
                for await (const chunk of resultStream.stream) {
                    res.write(`data: ${JSON.stringify({ text: chunk.text() })}\n\n`);
                }
                res.write(`data: [DONE]\n\n`);
                return res.end();
            } catch (streamErr) {
                // Agora, se a Google falhar, a IA vai dizer-te o erro exato na tela!
                res.write(`data: ${JSON.stringify({ text: `\n[Erro na API da Google: ${streamErr.message}]` })}\n\n`);
                res.write(`data: [DONE]\n\n`);
                return res.end();
            }
        }
