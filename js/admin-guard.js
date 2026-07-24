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

import { auth, signOut } from './firebase.js';

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
        <div style="font-size: 3.2rem; margin-bottom: 14px;" aria-hidden="true">🔒</div>
        <h1 style="font-size: 1.4rem; margin: 0 0 10px;">Acesso restrito</h1>
        <p style="opacity: .8; line-height: 1.6; margin: 0 0 22px;">${mensagem}</p>
        ${mostrarSair ? `<button id="btn-sair-bloqueio" style="
            padding: 13px 26px; border-radius: 10px; border: none;
            background: #fff; color: #0f1b14; font-weight: 700;
            font-size: 1rem; cursor: pointer;">Sair da conta</button>` : ''}
      </div>
    </div>`);

  document.getElementById('btn-sair-bloqueio')?.addEventListener('click', async () => {
    try { await signOut(auth); } catch (e) {}
    location.reload();
  });
};

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

    if (tokenResult.claims.admin === true) return true;

    mostrarBloqueio(
      'Esta conta não tem permissão de administrador. ' +
      'Se você é o responsável pela banca, entre com a conta autorizada.'
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
      try { await signOut(auth); } catch (e) {}
      mostrarBloqueio('Sessão encerrada por inatividade, para proteger seus dados.', false);
      setTimeout(() => location.reload(), 2500);
    }, minutos * 60 * 1000);
  };
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) =>
    document.addEventListener(ev, reiniciar, { passive: true })
  );
  reiniciar();
};
