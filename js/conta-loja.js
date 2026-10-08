// =====================================================================
//  js/conta-loja.js — CONTA DO CLIENTE, lado da loja (navegador).
//
//  O cliente não faz login. No primeiro pedido o servidor cria uma conta e
//  entrega um "crachá" (cookie que só o servidor lê). Este arquivo:
//    - ao abrir a loja SEM dados no aparelho (iPhone limpou, celular novo),
//      pergunta ao servidor se existe conta e devolve os dados;
//    - ao abrir pelo LINK PESSOAL (#a=...), troca o código pelos dados;
//    - guarda a sacola e as preferências na conta, de tempos em tempos;
//    - "Esquecer meus dados neste aparelho".
//  Toda a regra de quem pode o quê está no servidor (lib/conta.js).
// =====================================================================
import { chave } from './tenant.js';
import { codigoDoEndereco } from './conta-lib.js';

const API = '/api/checkout';
const MARCA = () => chave('banca_conta');
const VISTO = () => chave('banca_conta_visto');
const perguntouHaPouco = () => { try { const ha = Date.now() - Number(localStorage.getItem(VISTO()) || 0); return ha >= 0 && ha < 20 * 3600000; } catch (_) { return false; } };

async function chamar(corpo, opcoes = {}) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), ...opcoes });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não consegui falar com a loja agora.');
    return j;
}

/** Este aparelho já sabe que tem conta? (só uma marca; o crachá de verdade a página não enxerga) */
export const temConta = () => { try { return localStorage.getItem(MARCA()) === '1'; } catch (_) { return false; } };
export const marcarConta = (sim) => { try { if (sim) localStorage.setItem(MARCA(), '1'); else localStorage.removeItem(MARCA()); } catch (_) { /* sem armazenamento */ } };

/**
 * Chamada uma vez, ao abrir a loja. Devolve { conta, porLink, erro }.
 *   - veio pelo link pessoal → mostra de quem é a conta, pergunta, e só então entra (o código sai da barra de endereço na hora);
 *   - aparelho sem nome nem endereço guardados → pergunta se o crachá ainda está aqui;
 *   - aparelho que já tem os dados → não chama o servidor.
 */
export async function buscarConta({ semDados, confirmar }) {
    const codigo = codigoDoEndereco(location.hash);
    if (codigo) {
        // o código não fica na barra de endereço, no histórico nem em print da tela
        try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) { /* segue */ }
        try {
            // PRIMEIRO só pergunta de quem é a conta (o servidor ainda não entrega o crachá) e mostra para a pessoa.
            // Um link mandado por um estranho faria os próximos pedidos caírem na conta DELE: por isso nunca entra calado.
            const { previa } = await chamar({ acao: 'conta-entrar', codigo, previa: true });
            if (!previa || !(await confirmar(previa))) return { conta: null, porLink: true, erro: '', recusou: true };
            const j = await chamar({ acao: 'conta-entrar', codigo }); marcarConta(!!j.conta);
            return { conta: j.conta || null, porLink: true, erro: '' };
        } catch (e) { return { conta: null, porLink: true, erro: e.message }; }
    }
    if (!semDados || !navigator.onLine || perguntouHaPouco()) return { conta: null, porLink: false, erro: '' };
    try {
        const j = await chamar({ acao: 'conta-ver' }); marcarConta(!!j.conta);
        // quem só está olhando a loja (sem conta) não pergunta de novo a cada página: uma vez por dia basta.
        // A limpeza do iPhone apaga esta marca junto com o resto, então depois dela a pergunta volta a ser feita.
        if (!j.conta) { try { localStorage.setItem(VISTO(), String(Date.now())); } catch (_) { /* sem armazenamento */ } }
        return { conta: j.conta || null, porLink: false, erro: '' };
    } catch (_) { return { conta: null, porLink: false, erro: '' }; }         // sem sinal: a loja abre normal, só não lembra
}

// ---------------------------------------------------------------------
// GUARDAR sacola e preferências na conta. Uma chamada depois que a pessoa
// para de mexer, e outra ao sair da página se ficou algo por mandar.
// ---------------------------------------------------------------------
let relogio = null, pendente = null, ultimaEnviada = '';
const enviar = (aoSair) => {
    clearTimeout(relogio); relogio = null;
    if (!pendente || !temConta() || !navigator.onLine) return;
    const estado = pendente(), cara = JSON.stringify(estado);
    if (cara === ultimaEnviada) return;
    ultimaEnviada = cara;
    chamar({ acao: 'conta-guardar', ...estado }, aoSair ? { keepalive: true } : {}).catch(() => { ultimaEnviada = ''; });
};
/** `lerEstado` devolve { sacola, prefs } na hora do envio. */
export function agendarGuardar(lerEstado, esperaMs = 6000) {
    pendente = lerEstado;
    if (!temConta()) return;
    clearTimeout(relogio); relogio = setTimeout(() => enviar(false), esperaMs);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && relogio) enviar(true); });

/** Tira o crachá deste aparelho. Os dados continuam na loja e voltam pelo link da mensagem do WhatsApp. */
export async function sairDaConta() {
    clearTimeout(relogio); relogio = null; pendente = null;
    await chamar({ acao: 'conta-sair' });
    marcarConta(false);
}
