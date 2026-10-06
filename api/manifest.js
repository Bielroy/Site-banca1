// =====================================================================
//  /api/manifest.js — O "APP" DE CADA LOJA.
//
//  GET /api/manifest?loja=espetinhos-do-ze            → manifesto (nome, cor, ícone)
//  GET /api/manifest?loja=espetinhos-do-ze&icone=1    → o ícone, em SVG
//  ...&painel=1 em qualquer um dos dois               → o aplicativo do PAINEL da loja (abre /admin.html)
//
//  Quem instala a loja na tela inicial do celular vê o NOME e o ÍCONE dela,
//  e não mais os da Banca em todas. O ícone é o desenho do tipo de negócio
//  sobre a cor principal da loja. A loja original continua com o manifesto
//  fixo (o caixote), gerado no build.
//
//  Só lê dado público (a ficha da loja). Sem login.
// =====================================================================
const admin = require('firebase-admin');
const T = require('../lib/tenant');
const { ARTES, arteDoTipo } = require('../lib/artes');

const formatPrivateKey = (k) => (k ? k.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim() : '');
let db;
const boot = () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY) }) });
  if (!db) db = admin.firestore();
};
const cor = (v, padrao) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : padrao);
const limpo = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Ícone em SVG: fundo na cor da loja, desenho colorido do tipo de negócio. Cabe na área segura do Android. */
function iconeSvg(ficha, painel = false) {
  const tema = (ficha && ficha.tema) || {}, fundo = cor(tema.primaria, '#1a3a2a');
  const qual = arteDoTipo(ficha && ficha.tipo);
  // PAINEL: as cores invertem (fundo claro, desenho na cor da loja) e entra a prancheta, para não se confundir com o app da loja
  if (painel) {
    const desenhoP = ARTES[qual] || ARTES.sacola;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#F6F1E4"/><rect x="66" y="56" width="360" height="360" rx="72" fill="${fundo}"/><g transform="translate(96 86) scale(2.5)">${desenhoP}</g><g transform="translate(322 300)"><circle cx="48" cy="48" r="66" fill="#F6F1E4"/><circle cx="48" cy="48" r="54" fill="${fundo}"/><rect x="24" y="22" width="48" height="58" rx="7" fill="#fff"/><rect x="36" y="14" width="24" height="14" rx="5" fill="#1a1a18"/><path d="M33 42h30M33 54h30M33 66h18" stroke="#1a1a18" stroke-width="5" stroke-linecap="round"/></g></svg>`;
  }
  // loja de hortifruti: o caixote colorido, o mesmo desenho do ícone da loja original
  if (qual === 'caixote') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="${fundo}"/><circle cx="322" cy="204" r="56" fill="#7CC99B"/><circle cx="216" cy="188" r="76" fill="#E9A862"/><path d="M216 118C218 92 238 80 260 82C260 104 242 118 216 118Z" fill="#7CC99B"/><rect x="112" y="232" width="288" height="42" rx="8" fill="#F6F1E4"/><rect x="112" y="289" width="288" height="42" rx="8" fill="#F6F1E4"/><rect x="112" y="346" width="288" height="42" rx="8" fill="#F6F1E4"/><rect x="104" y="224" width="40" height="168" rx="10" fill="#D9C7A3"/><rect x="368" y="224" width="40" height="168" rx="10" fill="#D9C7A3"/></svg>`;
  const desenho = ARTES[qual] || ARTES.sacola;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="${fundo}"/><g transform="translate(106 106) scale(2.5)">${desenho}</g></svg>`;
}

function manifesto(id, ficha, painel = false) {
  const tema = ficha.tema || {}, nome = limpo(ficha.nome, 60) || id, icone = `/api/manifest?loja=${encodeURIComponent(id)}${painel ? '&painel=1' : ''}&icone=1`;
  if (painel) {
    return { id: `/admin.html?loja=${id}`, name: `Painel · ${nome}`.slice(0, 60), short_name: 'Painel', description: `Pedidos, produtos e caixa da ${nome}.`, lang: 'pt-BR',
      start_url: `/admin.html?loja=${encodeURIComponent(id)}`, scope: '/admin.html', display: 'standalone', orientation: 'portrait', theme_color: cor(tema.primaria, '#1a3a2a'), background_color: '#faf7f2',
      icons: [{ src: icone, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' }, { src: icone, sizes: '192x192', type: 'image/svg+xml', purpose: 'any' }] };
  }
  return {
    id: `/?loja=${id}`, name: nome, short_name: nome.length > 14 ? nome.split(' ').slice(0, 2).join(' ').slice(0, 14) : nome,
    description: limpo(ficha.subtitulo, 120) || `Peça na ${nome} e receba em casa.`,
    lang: 'pt-BR', start_url: `/?loja=${encodeURIComponent(id)}`, scope: '/', display: 'standalone', orientation: 'portrait',
    theme_color: cor(tema.primaria, '#1a3a2a'), background_color: cor(tema.fundo, '#faf7f2'), categories: ['shopping', 'food'],
    icons: [
      { src: icone, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: icone, sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: icone, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  const id = String((req.query && req.query.loja) || '');
  if (!T.idValido(id) || id === T.TENANT_PADRAO) return res.status(404).json({ error: 'Loja não encontrada.' });
  try {
    boot();
    const s = await db.collection('tenants').doc(id).get();
    if (!s.exists || s.data().ativo === false) return res.status(404).json({ error: 'Loja não encontrada.' });
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    if (req.query.icone) { res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8'); res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"); return res.status(200).send(iconeSvg(s.data(), !!req.query.painel)); }
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    return res.status(200).send(JSON.stringify(manifesto(id, s.data(), !!req.query.painel)));
  } catch (e) { console.error('[manifest]', e && e.message); return res.status(500).json({ error: 'Não foi possível montar o aplicativo desta loja.' }); }
};
module.exports.iconeSvg = iconeSvg;
module.exports.manifesto = manifesto;
