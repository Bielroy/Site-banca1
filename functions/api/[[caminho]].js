// =====================================================================
//  functions/api/[[caminho]].js — O CLOUDFLARE ENCAMINHA /api/* PARA O SERVIDOR (Cloud Run).
//
//  O site continua chamando /api/checkout, /api/pdv... no próprio endereço (nada muda no navegador).
//  Aqui o pedido é repassado ao servidor (server/index.js) e a resposta volta igual.
//
//  Variáveis do Cloudflare Pages (Settings → Variables and Secrets):
//     API_ORIGEM      endereço do Cloud Run, sem barra no fim (https://banca-api-xxxx.a.run.app)
//     PROXY_SEGREDO   texto longo e aleatório, IGUAL ao do Cloud Run (prova que o pedido veio daqui)
//
//  Por que o segredo: o servidor usa o IP e o endereço que mandamos aqui para os freios (login, pedido).
//  Sem o segredo ele não acredita nesses cabeçalhos. O cabeçalho do visitante nunca passa adiante.
// =====================================================================

// os mesmos cabeçalhos que o vercel.json põe nas respostas de /api (um teste confere)
export const CABECALHOS_DA_API = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};
// só estes cabeçalhos do visitante seguem para o servidor (conferido no código de api/ e lib/):
//   authorization: login · x-loja: qual loja · cookie: a conta do cliente (lib/conta.js) · origin: de onde veio (CORS e links de e-mail)
//   x-authenticity-token: a assinatura do aviso de pagamento do PagBank (api/pagamento-webhook.js): sem ela, nenhum PIX é confirmado
const IDA = ['content-type', 'authorization', 'accept', 'accept-language', 'user-agent', 'x-loja', 'cookie', 'origin', 'x-authenticity-token'];
// e só estes da resposta voltam (o Set-Cookie é tratado à parte, pode ser mais de um)
const VOLTA = ['content-type', 'content-disposition', 'retry-after', 'cache-control', 'vary', 'content-security-policy',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'];

const json = (corpo, status) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CABECALHOS_DA_API } });

export async function onRequest({ request, env, params }) {
  const origem = String(env.API_ORIGEM || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origem) || !env.PROXY_SEGREDO) return json({ error: 'Servidor ainda não configurado.' }, 503);

  const url = new URL(request.url);
  const caminho = [].concat(params.caminho || []).map(encodeURIComponent).join('/');
  const destino = `${origem}/api/${caminho}${url.search}`;

  const cab = new Headers();
  for (const k of IDA) { const v = request.headers.get(k); if (v) cab.set(k, v); }
  cab.set('x-proxy-segredo', env.PROXY_SEGREDO);
  cab.set('x-cliente-ip', request.headers.get('cf-connecting-ip') || '');
  cab.set('x-host-original', url.host);

  const comCorpo = !['GET', 'HEAD'].includes(request.method);
  try {
    const r = await fetch(destino, { method: request.method, headers: cab, body: comCorpo ? request.body : undefined, duplex: comCorpo ? 'half' : undefined, redirect: 'manual', signal: AbortSignal.timeout(58000) });
    const saida = new Headers(CABECALHOS_DA_API);          // a função de api/ pode trocar o Cache-Control (ex.: o manifesto); sem isso, nunca guarda
    for (const k of VOLTA) { const v = r.headers.get(k); if (v) saida.set(k, v); }
    for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) saida.append('Set-Cookie', c);
    return new Response(r.body, { status: r.status, headers: saida });
  } catch (_) {
    return json({ error: 'O servidor não respondeu. Tente de novo em instantes.' }, 502);
  }
}
