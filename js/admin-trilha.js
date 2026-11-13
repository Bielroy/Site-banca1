// =====================================================================
//  js/admin-trilha.js — TRILHA DO PAINEL: quem mudou preço, tirou produto, apagou ou mexeu em pedido.
//
//  A trilha da loja ({loja}/auditoria) já guardava o que passa pelo servidor (equipe, logins, ajustes).
//  O que o painel grava DIRETO no banco (preço, produto ligado/desligado, status do pedido) ficava de fora.
//  Agora cada uma dessas mudanças deixa uma linha, como no registro de auditoria do Appsmith.
//
//  Não dá para mentir: as regras do banco (firestore.rules, trilhaOk) só aceitam a linha se "quem" e "uid"
//  forem da própria conta logada, a hora for a do servidor (serverTimestamp) e a linha for NOVA: ninguém
//  muda nem apaga linha da trilha pelo navegador. Quem lê é o proprietário, pela aba Equipe (via servidor).
//  Anotar nunca atrapalha a ação: se falhar (sem internet, regra antiga), a mudança já foi feita e segue.
// =====================================================================
import { auth, setDoc, serverTimestamp } from './firebase.js';
import { tdoc } from './tenant.js';

const limpo = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const hex8 = () => { const a = new Uint8Array(4); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); };

/** Uma linha da trilha. acao: 'preco', 'fora-da-loja', 'de-volta', 'apagou-produto', 'status-pedido'... (vira "painel-<acao>"). */
export function anotar(acao, detalhe) {
    const u = auth.currentUser; if (!u) return Promise.resolve(false);
    const agora = Date.now(), id = `${agora}-${hex8()}`;
    const linha = { em: new Date(agora).toISOString(), acao: `painel-${limpo(acao, 30).toLowerCase().replace(/[^a-z-]/g, '-')}`, quem: u.email || u.uid, uid: u.uid, detalhe: limpo(detalhe, 200), noServidor: serverTimestamp(), doPainel: true };
    return setDoc(tdoc('auditoria', id), linha).then(() => true, () => false);
}
