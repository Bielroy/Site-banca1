// =====================================================================
//  js/pix-loja.js — tela do PIX automático na loja do cliente.
//  Pede o CPF (o PagBank exige), mostra o QR Code e o "copia e cola", e
//  fica olhando o pedido até o pagamento ser confirmado pelo servidor.
//  O CPF vai só para o PagBank: não é gravado no pedido nem no aparelho.
// =====================================================================
import { getDoc } from './firebase.js';
import { tdoc } from './tenant.js';
import { fmt, escapeHTML, showToast, openModal } from './utils.js';
import { cpfValido, mascararCpf } from './pix-lib.js';

let relogio = null;
const $ = (id) => document.getElementById(id);
const parar = () => { if (relogio) { clearInterval(relogio); relogio = null; } };

function montar() {
    if ($('modal-pix')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-pix" role="dialog" aria-modal="true" aria-labelledby="pix-titulo">
        <div class="modal">
            <header class="modal-head"><h2 id="pix-titulo">Pagar com PIX</h2><button class="btn-fechar" data-fechar="modal-pix" aria-label="Fechar">&times;</button></header>
            <div class="modal-body" id="pix-corpo"></div>
        </div>
    </div>`);
}

function telaCpf(total) {
    $('pix-corpo').innerHTML = `
        <p class="pix-valor">Total do pedido <b>${fmt(total)}</b></p>
        <div class="form-group">
            <label for="pix-cpf">CPF de quem vai pagar</label>
            <input type="text" id="pix-cpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" maxlength="14">
            <small class="dica-campo">O banco exige o CPF para gerar o PIX. Ele não fica guardado na loja.</small>
        </div>
        <button class="btn-finalizar" id="pix-gerar">Gerar o código PIX</button>`;
    $('pix-cpf').addEventListener('input', (e) => { e.target.value = mascararCpf(e.target.value); });
}

function telaQr(d, total) {
    $('pix-corpo').innerHTML = `
        <p class="pix-valor">Pague <b>${fmt(total)}</b> pelo aplicativo do seu banco</p>
        ${d.qr_code_url ? `<img class="pix-qr" src="${escapeHTML(d.qr_code_url)}" alt="QR Code do PIX" width="220" height="220">` : ''}
        <label for="pix-codigo" class="pix-rotulo">PIX copia e cola</label>
        <textarea id="pix-codigo" class="pix-codigo" rows="3" readonly>${escapeHTML(d.qr_code || '')}</textarea>
        <button class="btn-finalizar" id="pix-copiar">Copiar o código</button>
        <p class="pix-estado" id="pix-estado" aria-live="polite">Esperando o pagamento. Esta tela avisa sozinha quando ele cair.</p>
        <small class="dica-campo">O código vale por 30 minutos.</small>`;
    $('pix-copiar').addEventListener('click', async () => {
        const campo = $('pix-codigo');
        try { await navigator.clipboard.writeText(campo.value); } catch (_) { campo.select(); document.execCommand && document.execCommand('copy'); }
        showToast('Código copiado. Cole no aplicativo do banco.');
    });
}

function telaPago() {
    parar();
    $('pix-corpo').innerHTML = `<div class="pix-pago"><b>Pagamento confirmado</b><p>Recebemos o seu PIX. Já vamos separar o pedido.</p><button class="btn-finalizar" data-fechar="modal-pix">Fechar</button></div>`;
}

/**
 * Abre a tela do PIX para um pedido.
 *   chamarApi(url, corpo, opcoes) e erroAmigavel(e) vêm da loja (js/loja.js).
 *   aoPagar() é chamado uma vez quando o servidor confirma o pagamento.
 */
export function abrirPix({ pedidoId, total, chamarApi, erroAmigavel, aoPagar }) {
    montar(); parar(); telaCpf(total); openModal('modal-pix');
    $('pix-gerar').addEventListener('click', async (e) => {
        const cpf = $('pix-cpf').value;
        if (!cpfValido(cpf)) { showToast('Confira o CPF: são 11 números.', true); $('pix-cpf').focus(); return; }
        e.target.disabled = true; e.target.textContent = 'Gerando...';
        try {
            const d = await chamarApi('/api/pagamento-pix', { pedidoId, cpf: cpf.replace(/\D/g, '') }, { comToken: true, limiteMs: 30000 });
            telaQr(d, total);
            let voltas = 0;
            relogio = setInterval(async () => {
                if (!$('modal-pix').classList.contains('aberto') || ++voltas > 360) return parar();      // 360 × 5 s = 30 min
                try {
                    const s = await getDoc(tdoc('pedidos', pedidoId));
                    let pago = s.exists() && s.data().pagamento && s.data().pagamento.status === 'PAID';
                    // A cada 30 s (depois do primeiro minuto) pergunta ao servidor, que confere direto no PagBank:
                    // se o aviso do banco se perdeu, o pedido anda mesmo assim.
                    if (!pago && voltas >= 12 && voltas % 6 === 0) {
                        const r = await chamarApi('/api/pagamento-pix', { pedidoId, acao: 'conferir' }, { comToken: true, limiteMs: 20000 }).catch(() => null);
                        pago = !!(r && r.pago);
                    }
                    if (pago && relogio) { parar(); telaPago(); if (aoPagar) aoPagar(); }
                } catch (_) { /* sem sinal: tenta de novo na próxima volta */ }
            }, 5000);
        } catch (err) {
            showToast(erroAmigavel ? erroAmigavel(err) : (err.message || 'Não foi possível gerar o PIX.'), true);
            e.target.disabled = false; e.target.textContent = 'Gerar o código PIX';
        }
    });
}
