// Módulo de Inteligência Artificial e Conversação
import { escapeHTML, showToast } from './utils.js';

export const initIA = (STATE) => {
    const btnIaFlutuante = document.getElementById('btn-ia-flutuante');
    const inputMsg = document.getElementById('input-ia-mensagem');
    const btnEnviar = document.getElementById('btn-ia-enviar');
    const corpoChat = document.getElementById('chat-ia-corpo');
    const containerSugestoes = document.getElementById('ia-sugestoes-container');
    
    // Injeção do botão de Câmera (Gemini Vision)
    if(inputMsg && !document.getElementById('btn-ia-camera')) {
        inputMsg.insertAdjacentHTML('beforebegin', `
            <input type="file" id="ia-vision-upload" accept="image/*" style="display: none;">
            <button id="btn-ia-camera" style="background:none; border:none; font-size:1.4rem; cursor:pointer; padding:0 10px; color:var(--text-mid);" title="Enviar foto do que procura">📷</button>
        `);
    }

    const inputCamera = document.getElementById('ia-vision-upload');
    const btnCamera = document.getElementById('btn-ia-camera');

    let base64Image = null;
    let mimeTypeImage = null;

    if(btnCamera) {
        btnCamera.addEventListener('click', () => inputCamera.click());
        inputCamera.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if(!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                base64Image = ev.target.result.split(',')[1];
                mimeTypeImage = file.type;
                showToast("📸 Imagem anexada à sua mensagem!");
                btnCamera.style.color = "var(--forest)";
            };
            reader.readAsDataURL(file);
        });
    }

    if(btnIaFlutuante) {
        btnIaFlutuante.addEventListener('click', () => {
            document.getElementById('modal-ia-chat')?.classList.add('aberto');
            btnIaFlutuante.classList.remove('pulse-anim'); 
        });
    }

    const enviarMensagemParaIA = async () => {
        const texto = inputMsg.value.trim();
        if (!texto && !base64Image) return;

        corpoChat.insertAdjacentHTML('beforeend', `
            <div style="align-self: flex-end; background: var(--forest); color: white; padding: 12px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; box-shadow: var(--shadow-sm); margin-bottom: 8px;">
                ${base64Image ? '📸 [Imagem Anexada]<br>' : ''}${escapeHTML(texto)}
            </div>
        `);
        
        STATE.historicoChat.push({ role: 'user', content: texto + (base64Image ? ' [Enviou uma imagem]' : '') });
        inputMsg.value = ''; containerSugestoes.innerHTML = '';
        btnEnviar.disabled = true; btnEnviar.textContent = '⏱️...';

        const idBolha = 'msg-' + Date.now();
        corpoChat.insertAdjacentHTML('beforeend', `
            <div id="${idBolha}" style="align-self: flex-start; background: white; color: var(--text-dark); padding: 14px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; border: 1px solid #e0dcd4; box-shadow: var(--shadow-sm); line-height: 1.5; margin-bottom: 8px;">
                <span class="typing-indicator" style="animation: pulse 1s infinite;">A pensar...</span>
            </div>
        `);
        corpoChat.scrollTop = corpoChat.scrollHeight;
        const bolhaEl = document.getElementById(idBolha);

        try {
            const payload = {
                action: 'chat_stream',
                mensagemCliente: texto,
                historico: STATE.historicoChat.slice(-6), 
                carrinho: STATE.carrinho.map(i => ({id: i.id, nome: i.nome, qtd: i.qtd, unidade: i.unidade})),
                imagem: base64Image ? { data: base64Image, mimeType: mimeTypeImage } : null
            };

            // Reset da imagem após envio
            base64Image = null; mimeTypeImage = null;
            if(btnCamera) btnCamera.style.color = "var(--text-mid)";

            const response = await fetch('/api/assistente', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(response.status === 429 ? "RATE_LIMIT" : "Erro no Servidor");

            // [FASE 3] Processamento do Server-Sent Events (SSE) (3.01)
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let textoAcumulado = "";
            bolhaEl.innerHTML = ""; // Limpa o "A pensar..."

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6);
                        if(dataStr === "[DONE]") break;
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.text) {
                                textoAcumulado += parsed.text;
                                // Atualiza a UI em tempo real protegendo de XSS
                                bolhaEl.innerHTML = escapeHTML(textoAcumulado.replace(/\\[SUGESTOES:.*?\\]/g, '')).replace(/\\n/g, '<br>');
                                corpoChat.scrollTop = corpoChat.scrollHeight;
                            }
                        } catch(e) {}
                    }
                }
            }

            // Extração Regex dos Produtos Sugeridos e Cupão
            STATE.historicoChat.push({ role: 'ia', content: textoAcumulado });
            
            const matchSugestoes = textoAcumulado.match(/\\[SUGESTOES:(.*?)\\]/);
            if (matchSugestoes && matchSugestoes[1]) {
                const ids = matchSugestoes[1].split(',').map(s => s.trim());
                let botoesHtml = '';
                ids.forEach(prodId => {
                    const produtoNoBanco = STATE.produtos.find(p => String(p.id) === String(prodId));
                    if (produtoNoBanco) {
                        botoesHtml += `
                            <button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.85rem; border-color: var(--earth); color: var(--earth);" data-action="add" data-id="${produtoNoBanco.id}">
                                🛒 + ${escapeHTML(produtoNoBanco.nome)}
                            </button>
                        `;
                    }
                });
                containerSugestoes.innerHTML = botoesHtml;
            }

        } catch (err) {
            let msgErro = `🚨 ${escapeHTML(err.message)}`; 
            if (err.message === "RATE_LIMIT") msgErro = "Muitas mensagens. Aguarde uns segundos.";
            bolhaEl.innerHTML = `<span style="color:var(--danger)">${msgErro}</span>`;
        } finally {
            btnEnviar.disabled = false; btnEnviar.textContent = 'Enviar';
        }
    };

    if(btnEnviar) btnEnviar.addEventListener('click', enviarMensagemParaIA);
    if(inputMsg) inputMsg.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarMensagemParaIA(); });
};
