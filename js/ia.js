import { escapeHTML, showToast, isFracionavel } from './utils.js';
import { ICO } from './icones.js';

export const initIA = (STATE) => {
    const inputMsg = document.getElementById('input-ia-mensagem');
    const btnEnviar = document.getElementById('btn-ia-enviar');
    const corpoChat = document.getElementById('chat-ia-corpo');
    const containerSugestoes = document.getElementById('ia-sugestoes-container');

    if (inputMsg && !document.getElementById('btn-ia-camera')) {
        inputMsg.insertAdjacentHTML('beforebegin', `
            <input type="file" id="ia-vision-upload" accept="image/*" style="display: none;">
            <button type="button" id="btn-ia-camera" title="Enviar foto do que procura" aria-label="Enviar foto">${ICO.camera}</button>
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
            showToast('Foto anexada');
            btnCamera.style.color = 'var(--forest)';
        });
    }

    const limparAnexo = () => {
        base64Image = null;
        mimeTypeImage = null;
        if (inputCamera) inputCamera.value = '';
        if (btnCamera) btnCamera.style.color = 'var(--text-mid)';
    };

    // ---------- Pílula de quantidade: [ + Adicionar ] vira [ − 1 kg + ] ----------
    const textoQtd = (item) => {
        const frac = isFracionavel(item.unidade);
        if (frac && item.tipo === 'kg') return `${String(item.qtd).replace('.', ',')} ${String(item.unidade || 'kg').toLowerCase()}`;
        if (frac) return `${item.qtd} un`;
        return `${item.qtd} ${item.unidade && item.unidade !== 'un' ? item.unidade : 'un'}`;
    };

    const montarPilula = (p) => `
        <div class="ia-pill" data-pill="${escapeHTML(p.id)}">
            <span class="ia-pill-nome" title="${escapeHTML(p.nome)}">${escapeHTML(p.nome)}</span>
            <button type="button" class="ia-pill-add" data-action="add" data-id="${escapeHTML(p.id)}">+ Adicionar</button>
            <div class="ia-pill-qtd" hidden>
                <button type="button" data-action="dec" data-id="${escapeHTML(p.id)}" aria-label="Tirar um">−</button>
                <span class="ia-pill-valor" aria-live="polite"></span>
                <button type="button" data-action="inc" data-id="${escapeHTML(p.id)}" aria-label="Colocar mais um">+</button>
            </div>
        </div>`;

    const sincronizarPilulas = () => {
        containerSugestoes.querySelectorAll('.ia-pill').forEach(pill => {
            const item = STATE.carrinho.find(i => String(i.id) === pill.dataset.pill);
            const add = pill.querySelector('.ia-pill-add');
            const qtd = pill.querySelector('.ia-pill-qtd');
            add.textContent = '+ Adicionar';          // o feedback global troca o texto por ✓/+
            add.hidden = !!item;
            qtd.hidden = !item;
            if (item) pill.querySelector('.ia-pill-valor').textContent = textoQtd(item);
        });
    };

    // O clique em add/inc/dec é tratado pelo delegador global (loja.js);
    // aqui só esperamos ele mexer no carrinho para refletir na pílula.
    containerSugestoes.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) setTimeout(sincronizarPilulas, 0);
    });
    const modalIA = document.getElementById('modal-ia-chat');
    if (modalIA) new MutationObserver(sincronizarPilulas).observe(modalIA, { attributes: true, attributeFilter: ['class'] });

    // Etiquetas de sugestão ("Vinagrete", "Sobremesa"...) mandam a pergunta pronta
    corpoChat.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-prompt]');
        if (!chip) return;
        inputMsg.value = chip.dataset.prompt;
        enviarMensagemParaIA();
    });

    let ultimoEnvio = null; // guarda o que foi mandado, p/ o botão "tentar de novo"
    let ocupado = false;    // uma resposta por vez (Enter e etiquetas não disparam em paralelo)

    // ---------- Leitura da linha [SUGESTOES:id1,id2] ----------
    // A IA nem sempre escreve do jeito combinado: põe acento ("SUGESTÕES"),
    // crases/aspas/asteriscos em volta do id, usa o NOME em vez do id, ou a
    // resposta é cortada antes do "]". Em todos esses casos a pílula sumia
    // sem aviso e a marcação crua aparecia na conversa.
    const RE_TAG = /\[\s*SUGEST[OÕ]ES\s*:([^\]]*)\]?/i;
    const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const textoVisivel = (bruto) => {
        let t = String(bruto || '');
        const i = t.search(/\[\s*SUGEST/i);
        if (i >= 0) t = t.slice(0, i);                      // esconde a marcação, mesmo ainda incompleta
        t = t.replace(/\[\s*S?U?G?E?S?T?$/i, '');            // começo da marcação chegando em pedaços
        return t.replace(/\*\*(.+?)\*\*/g, '$1').trim();   // **negrito** do modelo vira texto simples
    };
    const produtosSugeridos = (bruto) => {
        const m = String(bruto || '').match(RE_TAG);
        if (!m) return [];
        const achados = [];
        m[1].split(/[,;\n]/).map(x => x.replace(/[`"'*\s]+/g, ' ').trim()).filter(Boolean).forEach(tok => {
            const p = STATE.produtos.find(x => String(x.id) === tok)
                   || STATE.produtos.find(x => semAcento(x.nome) === semAcento(tok));
            if (p && !achados.includes(p)) achados.push(p);
        });
        return achados.slice(0, 4);
    };

    const enviarMensagemParaIA = async (repetindo) => {
        const texto = repetindo ? repetindo.texto : inputMsg.value.trim();
        const anexo = repetindo ? repetindo.imagem : (base64Image ? { data: base64Image, mimeType: mimeTypeImage } : null);
        if (!texto && !anexo) return;
        if (ocupado) return;
        ocupado = true;

        // histórico = só o que veio ANTES desta mensagem (ela vai no campo próprio)
        const historicoAnterior = STATE.historicoChat.slice(-6);

        if (!repetindo) {
            corpoChat.insertAdjacentHTML('beforeend', `
                <div class="ia-msg ia-msg--eu">${anexo ? '[Foto anexada]<br>' : ''}${escapeHTML(texto)}</div>
            `);
            STATE.historicoChat.push({ role: 'user', content: texto + (anexo ? ' [Enviou uma imagem]' : '') });
        }
        ultimoEnvio = { texto: texto, imagem: anexo };
        inputMsg.value = '';
        containerSugestoes.innerHTML = '';
        btnEnviar.disabled = true;
        btnEnviar.textContent = '...';
        inputMsg.disabled = true;
        if (btnCamera) btnCamera.disabled = true;

        const idBolha = 'msg-' + Date.now();
        corpoChat.insertAdjacentHTML('beforeend', `
            <div id="${idBolha}" class="ia-msg ia-msg--bot">
                <span class="ia-digitando" aria-label="Pensando"><span></span><span></span><span></span></span>
            </div>
        `);
        corpoChat.scrollTop = corpoChat.scrollHeight;
        const bolhaEl = document.getElementById(idBolha);

        const imagemDoEnvio = anexo;
        limparAnexo();

        try {
            const payload = {
                action: 'chat_stream',
                mensagemCliente: texto,
                historico: repetindo ? STATE.historicoChat.slice(0, -1).slice(-6) : historicoAnterior,
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
                let podeRepetir = response.status === 429 || response.status === 503;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                    if (errorData.podeRepetir !== undefined) podeRepetir = errorData.podeRepetir;
                } catch (e) {}
                const erro = new Error(errorMsg);
                erro.podeRepetir = podeRepetir;
                throw erro;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let textoAcumulado = '';
            let buffer = '';
            let terminou = false;
            bolhaEl.innerHTML = '';

            const pintar = () => {
                bolhaEl.innerHTML = escapeHTML(textoVisivel(textoAcumulado)).replace(/\n/g, '<br>');
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

            if (!textoVisivel(textoAcumulado)) {
                bolhaEl.innerHTML = '<span class="ia-msg--erro">Não consegui responder agora. Tenta de novo?</span>';
            } else {
                pintar();
                STATE.historicoChat.push({ role: 'ia', content: textoAcumulado });
            }

            // Pílulas de sugestão: só entram produtos que existem na vitrine agora
            const sugeridos = produtosSugeridos(textoAcumulado);
            containerSugestoes.innerHTML = sugeridos.map(montarPilula).join('');
            containerSugestoes.classList.toggle('tem-mais', sugeridos.length > 1);
            containerSugestoes.scrollLeft = 0;
            sincronizarPilulas();

        } catch (err) {
            // Sobrecarga da IA é passageira: oferece repetir sem redigitar.
            const passageiro = err.podeRepetir === true;
            bolhaEl.innerHTML = `
                <div class="ia-msg--erro ${passageiro ? '' : 'fatal'}">${escapeHTML(err.message)}</div>
                ${passageiro ? '<button type="button" class="ia-tentar btn-repetir-ia">Tentar de novo</button>' : ''}`;
            const btnRepetir = bolhaEl.querySelector('.btn-repetir-ia');
            if (btnRepetir) {
                btnRepetir.addEventListener('click', () => {
                    bolhaEl.remove();
                    enviarMensagemParaIA(ultimoEnvio);
                });
            }
        } finally {
            ocupado = false;
            btnEnviar.disabled = false;
            btnEnviar.textContent = 'Enviar';
            inputMsg.disabled = false;
            if (btnCamera) btnCamera.disabled = false;
        }
    };

    if (btnEnviar) btnEnviar.addEventListener('click', () => enviarMensagemParaIA());
    if (inputMsg) inputMsg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); enviarMensagemParaIA(); }
    });
};
