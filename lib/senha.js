'use strict';
// =====================================================================
//  lib/senha.js — SENHA DE CHAMADA do pedido PARA RETIRAR (contas puras, sem banco).
//
//  Quando a equipe marca "Pronto para retirar" (api/pdv.js → ajuste, op 'pronto'), o pedido
//  ganha uma senha de 3 dígitos, como nos quiosques: 001, 002 ... 999, e volta para 001.
//  A contagem recomeça todo dia (dia de Brasília). A senha aparece grande na tela do cliente
//  e no cartão do painel; com a caixinha de LED, é o número que vai para o painel de senhas.
//
//  Configuração da loja (loja/config.senhaChamada):
//    'desligada'  (padrão)  pedido pronto, sem senha: a tela do cliente só diz "pronto".
//    'tela'                  senha na tela do cliente e no painel.
//    'caixinha'              igual a 'tela' e a loja tem o painel de senhas de LED (a chamada vai para ele).
// =====================================================================

const MODOS = ['desligada', 'tela', 'caixinha'];
const MAXIMO = 999;            // o painel de LED tem 3 dígitos

/** Modo da senha desta loja. Qualquer valor estranho = desligada. */
function modoDaSenha(config) {
  const m = config && config.senhaChamada;
  return MODOS.includes(m) ? m : 'desligada';
}

/** Dia de Brasília (AAAA-MM-DD) do instante dado: a contagem da senha recomeça à meia-noite daqui. */
function diaDaSenha(agora) {
  return new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}

/** Próxima senha do dia. contador = { dia, ultimo } (ou nada, na primeira vez). Depois de 999 volta para 001. */
function proximaSenha(contador, dia) {
  const ultimo = contador && contador.dia === dia ? Math.floor(Number(contador.ultimo)) || 0 : 0;
  const numero = ultimo >= MAXIMO || ultimo < 0 ? 1 : ultimo + 1;
  return { numero, texto: textoDaSenha(numero) };
}

/** 7 → "007". */
function textoDaSenha(numero) {
  return String(Math.max(0, Math.min(MAXIMO, Math.floor(Number(numero)) || 0))).padStart(3, '0');
}

/** Por que este pedido NÃO pode ser marcado como pronto para retirar ('' = pode). */
function travaDoPronto(ped) {
  if (!ped) return 'Pedido não encontrado.';
  if (ped.status === 'cancelado') return 'Este pedido foi cancelado.';
  if (ped.origem === 'balcao') return 'Venda de balcão já foi entregue na hora.';
  if (ped.modo !== 'retirada') return 'Este pedido é de entrega: use "Saiu para entrega".';
  if (ped.status === 'enviado') return 'Este pedido já está pronto.';
  if (ped.status === 'arquivado') return 'Este pedido já foi retirado.';
  if (ped.status === 'aguardando_pesagem' || (ped.itens || []).some((i) => i && i.aPesar)) return 'Pese os itens antes de marcar como pronto.';
  if (!['pendente', 'preparando'].includes(ped.status)) return 'Este pedido ainda não pode ficar pronto.';
  return '';
}

/** A senha que o pedido usa agora: a que ele já tinha HOJE (marcou pronto, voltou, marcou de novo) ou '' (precisa de uma nova). */
function senhaGuardada(ped, dia) {
  return ped && /^\d{3}$/.test(String(ped.senha || '')) && ped.senhaDia === dia ? String(ped.senha) : '';
}

/** Chamar a senha de novo (o cliente não ouviu): por que não dá ('' = dá). */
function travaDaChamada(ped) {
  if (!ped) return 'Pedido não encontrado.';
  if (ped.modo !== 'retirada' || ped.status !== 'enviado') return 'Só dá para chamar pedido pronto para retirar.';
  if (!/^\d{3}$/.test(String(ped.senha || ''))) return 'Este pedido não tem senha.';
  return '';
}

/** "PIX recebido" (a equipe conferiu no app do banco que o PIX pela chave caiu): por que não dá ('' = dá). */
function travaDoPixRecebido(ped) {
  if (!ped) return 'Pedido não encontrado.';
  if (String(ped.pag || '').toUpperCase() !== 'PIX') return 'Este pedido não é PIX.';
  if (ped.status === 'cancelado') return 'Este pedido foi cancelado.';
  if (ped.pagamento && ped.pagamento.status === 'PAID') return 'Este PIX já foi confirmado pelo banco.';
  // conferido a menos (o pedido subiu depois): dá para marcar de novo com o total de agora
  if (ped.pixConferido && ped.pixConferido.em && Math.round((Number(ped.pixConferido.valor) || 0) * 100) >= Math.round((Number(ped.total) || 0) * 100)) return 'O PIX deste pedido já está marcado como recebido.';
  if (ped.temItensAPesar || ped.status === 'aguardando_pesagem') return 'Pese os itens antes: o valor ainda vai mudar.';
  if (!(Number(ped.total) > 0)) return 'Este pedido não tem valor a pagar.';
  return '';
}

/**
 * A senha guardada no pedido é de OUTRO dia? A contagem recomeça todo dia: a 005 de ontem pode ser a 005 de
 * outra pessoa hoje. Pedido pronto ontem e não retirado precisa de senha nova antes de ser chamado.
 */
function senhaVencida(ped, dia) {
  return !!ped && /^\d{3}$/.test(String(ped.senha || '')) && !!ped.senhaDia && ped.senhaDia !== dia;
}

const centavos = (v) => Math.round((Number(v) || 0) * 100);
/** O PIX deste pedido já está pago (banco confirmou, ou a equipe conferiu o valor todo)? */
function pixJaPago(ped) {
  if (!ped) return false;
  if (ped.pagamento && ped.pagamento.status === 'PAID') return true;
  return !!(ped.pixConferido && ped.pixConferido.em && centavos(ped.pixConferido.valor) >= centavos(ped.total));
}

/** "Já paguei" do CLIENTE (api/pix-informado.js): por que não dá para anotar ('' = dá). */
function travaDoPixInformado(ped) {
  if (!ped) return 'Pedido não encontrado.';
  if (String(ped.pag || '').toUpperCase() !== 'PIX') return 'Este pedido não é PIX.';
  if (ped.status === 'cancelado') return 'Este pedido foi cancelado.';
  if (pixJaPago(ped)) return 'A banca já confirmou este PIX.';
  if (ped.temItensAPesar || ped.status === 'aguardando_pesagem') return 'Espere a banca pesar os itens: o valor ainda vai mudar.';
  if (!(Number(ped.total) > 0)) return 'Este pedido não tem valor a pagar.';
  return '';
}

/** "Entregue" / "Cliente retirou" pelo servidor (op 'concluir'): por que não dá ('' = dá). */
function travaDoConcluir(ped) {
  if (!ped) return 'Pedido não encontrado.';
  if (ped.status === 'cancelado') return 'Este pedido foi cancelado.';
  if (ped.status === 'arquivado') return 'Este pedido já foi concluído.';
  if (ped.status !== 'enviado') return 'Este pedido ainda não saiu: marque "Saiu para entrega" ou "Pronto" antes.';
  return '';
}

/** Ficou PIX sem conferir ao concluir o pedido? (o Balanço mostra como "PIX não conferido", não como recebido) */
function pixPendenteAoConcluir(ped) {
  return !!ped && String(ped.pag || '').toUpperCase() === 'PIX' && ped.origem !== 'balcao' && Number(ped.total) > 0 && !pixJaPago(ped);
}

module.exports = { senhaVencida, pixJaPago, travaDoPixInformado, travaDoConcluir, pixPendenteAoConcluir, travaDoPixRecebido, MODOS, MAXIMO, modoDaSenha, diaDaSenha, proximaSenha, textoDaSenha, travaDoPronto, senhaGuardada, travaDaChamada };
