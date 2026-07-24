import { escapeHTML, showToast } from './utils.js';

export const initIA = (STATE) => {
    const inputMsg = document.getElementById('input-ia-mensagem');
    const btnEnviar = document.getElementById('btn-ia-enviar');
    const corpoChat = document.getElementById('chat-ia-corpo');
    const containerSugestoes = document.getElementById('ia-sugestoes-container');

    if (inputMsg && !document.getElementById('btn-ia-camera')) {
        inputMsg.insertAdjacentHTML('beforebegin', `
            <input type="file" id="ia-vision-upload" accept="image/*" style="display: none;">
            <button id="btn-ia-camera" style="background:none; border:none; font-size:1.4rem; cursor:pointer; padding:0 10px; color:var(--text-mid);" title="Enviar foto do que procura" aria-label="Enviar foto">📷</button>
        `);
    }

    const inputCamera = document.getElementById('ia-vision-upload');
    const btnCamera = document.getElementById('btn-ia-camera');
    let base64Image = null;
    let mimeTypeImage = null;

    // Fotos de celular passam de 5MB e estouram o limite da requisição.
    // Reduzimos antes de enviar — a IA não precisa de resolução alta.
    const prepararImagem = async (file) => {
        const bitmap = await createImageBitmap(file).catch(() => null);
        if (!bitmap) return null;

        const maxLado = 900;
        let { width, height } = bitmap;
        if (width > maxLado || height > maxLado) {
            const escala = maxLado / Math.max(width, height);
            width = Math.round(width * escala);
            height = Math.round(height * escala);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();

        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        return { data: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
    };

    if (btnCamera) {
        btnCamera.addEventListener('click', () => inputCamera.click());
        inputCamera.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const pronta = await prepararImagem(file);
            if (!pronta) return showToast('Não consegui ler essa imagem.', true);
            base64Image = pronta.data;
            mimeTypeImage = pronta.mimeType;
            showToast('📸 Imagem anexada!');
            btnCamera.style.color = 'var(--forest)';
        });
    }

    const limparAnexo = () => {
        base64Image = null;
        mimeTypeImage = null;
        if (inputCamera) inputCamera.value = '';
        if (btnCamera) btnCamera.style.color = 'var(--text-mid)';
    };

    const enviarMensagemParaIA = async () => {
        const texto = inputMsg.value.trim();
        if (!texto && !base64Image) return;

        corpoChat.insertAdjacentHTML('beforeend', `
            <div style="align-self: flex-end; background: var(--forest); color: white; padding: 12px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; box-shadow: var(--shadow-sm); margin-bottom: 8px;">
                ${base64Image ? '📸 [Imagem anexada]<br>' : ''}${escapeHTML(texto)}
            </div>
        `);

        STATE.historicoChat.push({ role: 'user', content: texto + (base64Image ? ' [Enviou uma imagem]' : '') });
        inputMsg.value = '';
        containerSugestoes.innerHTML = '';
        btnEnviar.disabled = true;
        btnEnviar.textContent = '⏱️...';

        const idBolha = 'msg-' + Date.now();
        corpoChat.insertAdjacentHTML('beforeend', `
            <div id="${idBolha}" style="align-self: flex-start; background: white; color: var(--text-dark); padding: 14px; border-radius: var(--radius-sm); max-width: 85%; font-size: 0.95rem; border: 1px solid #e0dcd4; box-shadow: var(--shadow-sm); line-height: 1.5; margin-bottom: 8px;">
                <span class="typing-indicator" style="animation: pulse 1s infinite;">A pensar...</span>
            </div>
        `);
        corpoChat.scrollTop = corpoChat.scrollHeight;
        const bolhaEl = document.getElementById(idBolha);

        const imagemDoEnvio = base64Image ? { data: base64Image, mimeType: mimeTypeImage } : null;
        limparAnexo();

        try {
            const payload = {
                action: 'chat_stream',
                mensagemCliente: texto,
                historico: STATE.historicoChat.slice(-6),
                carrinho: STATE.carrinho.map(i => ({ id: i.id, nome: i.nome, qtd: i.qtd, unidade: i.unidade })),
                imagem: imagemDoEnvio
            };

            const response = await fetch('/api/assistente', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorMsg = 'Erro no servidor';
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.dica || errorData.error || errorMsg;
                } catch (e) {}
                throw new Error(response.status === 429 ? 'Muitas mensagens. Aguarde um instante.' : errorMsg);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let textoAcumulado = '';
            let buffer = '';
            let terminou = false;
            bolhaEl.innerHTML = '';

            const pintar = () => {
                const visivel = textoAcumulado.replace(/\[SUGESTOES:.*?\]/gs, '').trim();
                bolhaEl.innerHTML = escapeHTML(visivel).replace(/\n/g, '<br>');
                corpoChat.scrollTop = corpoChat.scrollHeight;
            };

            while (!terminou) {
                const { value, done } = await reader.read();
                if (done) break;

                // CORREÇÃO: a resposta chega em pedaços que podem cortar uma
                // linha no meio. Sem guardar o resto, aquele trecho de texto
                // se perdia silenciosamente em respostas longas.
                buffer += decoder.decode(value, { stream: true });
                const linhas = buffer.split('\n');
                buffer = linhas.pop() || '';

                for (const linha of linhas) {
                    if (!linha.startsWith('data:')) continue;
                    const dataStr = linha.slice(5).trim();
                    if (!dataStr) continue;
                    if (dataStr === '[DONE]') { terminou = true; break; }
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.text) {
                            textoAcumulado += parsed.text;
                            pintar();
                        }
                    } catch (e) { /* linha inválida, segue */ }
                }
            }

            if (!textoAcumulado.trim()) {
                bolhaEl.innerHTML = '<span style="color:var(--text-light)">Não consegui responder agora. Tenta de novo?</span>';
            } else {
                pintar();
                STATE.historicoChat.push({ role: 'ia', content: textoAcumulado });
            }

            // Botões de sugestão: só entram produtos que existem mesmo
            const matchSugestoes = textoAcumulado.match(/\[SUGESTOES:(.*?)\]/s);
            if (matchSugestoes && matchSugestoes[1]) {
                const ids = matchSugestoes[1].split(',').map(s => s.trim()).filter(Boolean);
                let botoesHtml = '';
                ids.forEach(prodId => {
                    const produtoNoBanco = STATE.produtos.find(p => String(p.id) === String(prodId));
                    if (produtoNoBanco) {
                        botoesHtml += `<button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.85rem; border-color: var(--earth); color: var(--earth); white-space: nowrap;" data-action="add" data-id="${escapeHTML(produtoNoBanco.id)}">🛒 + ${escapeHTML(produtoNoBanco.nome)}</button>`;
                    }
                });
                containerSugestoes.innerHTML = botoesHtml;
            }

        } catch (err) {
            bolhaEl.innerHTML = `<span style="color:var(--danger)">🚨 ${escapeHTML(err.message)}</span>`;
        } finally {
            btnEnviar.disabled = false;
            btnEnviar.textContent = 'Enviar';
        }
    };

    if (btnEnviar) btnEnviar.addEventListener('click', enviarMensagemParaIA);
    if (inputMsg) inputMsg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); enviarMensagemParaIA(); }
    });
};
