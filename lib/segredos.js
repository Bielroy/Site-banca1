// =====================================================================
//  lib/segredos.js — as CHAVES de serviços de fora (PagBank, etc.).
//
//  Cada chave pode estar em dois lugares, nesta ordem:
//    1. variável de ambiente da Vercel (como sempre foi);
//    2. plataforma/segredos, gravada pela tela Plataforma, para quem não
//       quer mexer na Vercel. As regras do banco não deixam ninguém ler
//       esse documento pelo navegador: só o servidor chega nele.
//  A leitura do banco fica guardada por 1 minuto para não custar uma
//  consulta a cada pedido.
// =====================================================================
let _guardado = { dados: null, ate: 0 };
async function lerSegredos(db) {
  if (_guardado.ate > Date.now()) return _guardado.dados;
  let dados = {};
  try { const s = await db.collection('plataforma').doc('segredos').get(); dados = s.exists ? s.data() || {} : {}; }
  catch (e) { console.error('[segredos]', e && e.message); }
  _guardado = { dados, ate: Date.now() + 60000 };
  return dados;
}

/** Token do PagBank: sem espaço, entre 20 e 300 caracteres. */
const tokenPagbankValido = (t) => /^[A-Za-z0-9._\-=+/]{20,300}$/.test(String(t || ''));

/** O token do PagBank (PIX). '' = não configurado. */
async function pagbank(db) {
  if (process.env.PAGBANK_API_TOKEN) return process.env.PAGBANK_API_TOKEN;
  const t = (await lerSegredos(db)).pagbank;
  return tokenPagbankValido(t) ? t : '';
}

module.exports = { pagbank, tokenPagbankValido, lerSegredos, _zerar: () => { _guardado = { dados: null, ate: 0 }; } };
