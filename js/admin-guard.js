// =====================================================================
//  /js/admin-guard.js  —  TRAVA DE ACESSO DO PAINEL (arquivo NOVO)
//
//  PROBLEMA QUE ISSO RESOLVE:
//  Se o admin.js hoje só verifica `if (user) { liberar painel }`, então
//  QUALQUER pessoa que criar uma conta no seu Firebase entra no painel e
//  edita preços, produtos e pedidos. Autenticado != autorizado.
//
//  COMO ESTE MÓDULO FUNCIONA:
//  Ele confere um "custom claim" chamado `admin` dentro do token do
//  Firebase. Esse claim SÓ pode ser gravado pelo Admin SDK (servidor) —
//  é impossível o cliente forjar, porque o token é assinado pelo Google.
//  As firestore.rules que já te entreguei validam esse mesmo claim, então
//  front e banco ficam alinhados.
//
//  COMO USAR (2 linhas no seu admin.js):
//    1) No topo do admin.js, adicione o import:
//         import { exigirAdmin } from './admin-guard.js';
//    2) Dentro do seu onAuthStateChanged, quando houver user, troque
//       a liberação direta do painel por:
//         const ok = await exigirAdmin(user);
//         if (!ok) return;   // o módulo já bloqueia a tela e desloga
//         // ...aqui segue o código que você já tem para carregar o painel
//
//  ANTES DE USAR: você precisa marcar sua conta como admin uma única vez.
//  Veja o arquivo set-admin-claim.js que acompanha este.
// =====================================================================

import { auth, db, signOut, terminate, clearIndexedDbPersistence } from './firebase.js';

/**
 * SAIR DE VERDADE. Além de encerrar o login, apaga a cópia dos dados que o painel guarda no aparelho
 * (pedidos com nome, telefone e endereço de cliente, custos, cupons) e recarrega a página, que limpa
 * a tela e a memória. Sem isto, quem entrasse depois no mesmo navegador herdava esses dados.
 */
export const sairELimpar = async () => {
    try { await signOut(auth); } catch (_) { /* segue */ }
    try { await terminate(db); await clearIndexedDbPersistence(db); } catch (_) { /* outra aba aberta ou navegador sem suporte: segue */ }
    try { sessionStorage.removeItem('emailForSignIn'); localStorage.removeItem('emailForSignIn'); } catch (_) { /* sem armazenamento */ }
    location.reload();
};
import { TENANT, TENANT_PADRAO, urlDaLoja, enderecoEhDaLoja } from './tenant.js';
import { bancasDaConta } from './papeis-lib.js';

// Papel da pessoa NESTA loja, lido do token (gravado só pelo servidor).
// Mesma regra de lib/tenant.js. A conta antiga { admin: true } vale como dona da loja original.
export const papelNoToken = (claims, tid = TENANT) => {
  const c = claims || {};
  // conta com e-mail não confirmado não tem papel (mesma regra do servidor e do banco)
  if (c.email_verified === false) return null;
  if (c.plataforma === true) return 'plataforma';
  if (c.tenants && typeof c.tenants === 'object' && typeof c.tenants[tid] === 'string') return c.tenants[tid];
  if (tid === TENANT_PADRAO && c.admin === true) return 'proprietario';
  return null;
};
export let papelAtual = null;
/** Bancas que esta conta pode abrir (seletor "Trocar de banca" no menu do painel). */
export let bancasDaPessoa = [];
// Toda a equipe entra; cada papel vê só as suas abas (js/papeis-lib.js). O servidor e as regras do banco conferem de novo.
const PODEM_ENTRAR = ['plataforma', 'proprietario', 'administrador', 'funcionario', 'caixa', 'producao', 'estoque'];

const TELA_BLOQUEIO_ID = 'admin-bloqueio-acesso';

const mostrarBloqueio = (mensagem, mostrarSair = true) => {
  if (document.getElementById(TELA_BLOQUEIO_ID)) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="${TELA_BLOQUEIO_ID}" role="alertdialog" aria-modal="true" style="
        position: fixed; inset: 0; z-index: 99999;
        background: #0f1b14; color: #fff;
        display: flex; align-items: center; justify-content: center;
        padding: 24px; text-align: center;
        font-family: system-ui, -apple-system, sans-serif;">
      <div style="max-width: 380px;">
        <div style="font-size: 3.2rem; margin-bottom: 14px;" aria-hidden="true"><i class="ic" data-i="cadeado"></i></div>
        <h1 style="font-size: 1.4rem; margin: 0 0 10px;">Acesso restrito</h1>
        <p style="opacity: .8; line-height: 1.6; margin: 0 0 22px;">${mensagem}</p>
        ${mostrarSair ? `<button id="btn-sair-bloqueio" style="
            padding: 13px 26px; border-radius: 10px; border: none;
            background: #fff; color: #0f1b14; font-weight: 700;
            font-size: 1rem; cursor: pointer;">Sair da conta</button>` : ''}
      </div>
    </div>`);

  document.getElementById('btn-sair-bloqueio')?.addEventListener('click', () => sairELimpar());
};

/**
 * LOJA BLOQUEADA pela plataforma (falta de pagamento): o painel não abre.
 * O proprietário vê a mensalidade (valor e vencimento); o resto da equipe, só o aviso.
 * O servidor já recusa vendas, balcão e estoque de loja bloqueada; esta tela é o aviso claro.
 */
export async function mostrarSuspensa(ehDono) {
  let a = null;
  if (ehDono) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'minha-assinatura' }) });
      if (r.ok) a = (await r.json()).assinatura || null;
    } catch (_) { /* sem a mensalidade, fica só o aviso */ }
  }
  const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const texto = ehDono
    ? `<p style="opacity:.85;line-height:1.6;margin:0 0 16px;">Sua assinatura foi interrompida por falta de pagamento. Pague a mensalidade e volte a usar o painel.</p>
       ${a ? `<div style="background:rgba(255,255,255,.08);border-radius:14px;padding:14px 16px;margin:0 0 16px;text-align:left;"><div style="font-size:.85rem;opacity:.75;">Sua mensalidade</div><div style="font-size:1.5rem;font-weight:800;margin:2px 0;">${reais(a.valor)} por mês</div>${a.dia ? `<div style="opacity:.85;">Vence todo dia ${a.dia}.</div>` : ''}${a.obs ? `<div style="opacity:.85;margin-top:4px;">${esc(a.obs)}</div>` : ''}</div>` : ''}
       <p style="opacity:.7;line-height:1.5;margin:0 0 22px;font-size:.92rem;">Assim que o pagamento for confirmado, o painel volta a funcionar. Seus produtos, clientes e pedidos continuam guardados.</p>`
    : `<p style="opacity:.85;line-height:1.6;margin:0 0 22px;">O painel desta loja está suspenso no momento. Fale com o proprietário da loja.</p>`;
  if (document.getElementById(TELA_BLOQUEIO_ID)) document.getElementById(TELA_BLOQUEIO_ID).remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="${TELA_BLOQUEIO_ID}" role="alertdialog" aria-modal="true" aria-labelledby="suspensa-titulo" style="position:fixed;inset:0;z-index:99999;background:#0f1b14;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:system-ui,-apple-system,sans-serif;overflow-y:auto;">
      <div style="max-width:400px;">
        <h1 id="suspensa-titulo" style="font-size:1.45rem;margin:0 0 12px;">Assinatura interrompida</h1>
        ${texto}
        <button id="btn-sair-bloqueio" style="padding:13px 26px;border-radius:10px;border:none;background:#fff;color:#0f1b14;font-weight:700;font-size:1rem;cursor:pointer;">Sair da conta</button>
      </div>
    </div>`);
  document.getElementById('btn-sair-bloqueio')?.addEventListener('click', () => sairELimpar());
}

/**
 * Verifica se o usuário autenticado é realmente administrador.
 * @param {import('firebase/auth').User} user
 * @returns {Promise<boolean>} true = pode seguir; false = bloqueado
 */
export const exigirAdmin = async (user) => {
  if (!user) return false;

  try {
    // force refresh = true garante que um claim recém-concedido (ou
    // recém-revogado) seja refletido sem precisar deslogar e logar.
    const tokenResult = await user.getIdTokenResult(true);

    const claims = tokenResult.claims;
    papelAtual = papelNoToken(claims);
    bancasDaPessoa = bancasDaConta(claims);
    if (PODEM_ENTRAR.includes(papelAtual)) return true;

    // Entrou sem dizer a loja, mas a conta pertence a outra: leva para o painel dela.
    const minhas = claims.tenants && typeof claims.tenants === 'object' ? Object.keys(claims.tenants) : [];
    if (!papelAtual && !enderecoEhDaLoja && !new URLSearchParams(location.search).get('loja') && minhas.length) {
      location.replace(urlDaLoja(minhas[0], location.pathname));
      return false;
    }

    mostrarBloqueio(
      'Esta conta não faz parte da equipe desta loja. ' +
      'Peça ao proprietário para incluir o seu e-mail na aba Equipe.'
    );
    return false;
  } catch (erro) {
    console.error('Falha ao validar permissão:', erro);
    mostrarBloqueio('Não foi possível validar suas permissões. Verifique a conexão e tente novamente.');
    return false;
  }
};

/**
 * Opcional: encerra a sessão automaticamente após um período de inatividade.
 * Útil porque o painel costuma ficar aberto no balcão, à vista de clientes.
 * Uso: iniciarLogoutPorInatividade(30); // 30 minutos
 */
export const iniciarLogoutPorInatividade = (minutos = 30) => {
  let timer;
  const reiniciar = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      mostrarBloqueio('Sessão encerrada por inatividade, para proteger seus dados.', false);
      setTimeout(() => sairELimpar(), 2500);
    }, minutos * 60 * 1000);
  };
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) =>
    document.addEventListener(ev, reiniciar, { passive: true })
  );
  reiniciar();
};
