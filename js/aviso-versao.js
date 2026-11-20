// =====================================================================
//  js/aviso-versao.js — FAIXA DISCRETA NO PAINEL quando o servidor está em versão diferente do site
//  ou a rotina da noite parou (regras em js/aviso-versao-lib.js).
//
//  Só aparece para quem pode resolver: o dono da plataforma ou o proprietário da loja original
//  (os mesmos que veem o botão "Plataforma", #link-plataforma, que js/admin.js mostra depois do login).
//  Não mexe em nada do painel: só lê /versao.json e /api/saude. Fechar esconde até a próxima vez que o painel abrir.
// =====================================================================
import { avisosDeVersao } from './aviso-versao-lib.js';

const pegar = async (url) => { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (_) { return null; } };
const podeVer = () => { const l = document.getElementById('link-plataforma'), t = document.getElementById('login-screen'); return !!l && !l.hidden && !(t && t.style.display !== 'none'); };

async function conferir() {
  if (!podeVer()) return false;
  const [site, saude] = await Promise.all([pegar('/versao.json'), pegar('/api/saude')]);
  const avisos = avisosDeVersao(site, saude);
  if (!avisos.length || document.getElementById('aviso-versao')) return true;
  const faixa = document.createElement('div');
  faixa.id = 'aviso-versao'; faixa.setAttribute('role', 'status');
  faixa.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:9000;max-width:640px;margin:0 auto;padding:10px 40px 10px 12px;border-radius:10px;background:#fff7e0;color:#4a3800;border:1px solid #e0c060;font:13px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.15)';
  for (const a of avisos) { const p = document.createElement('p'); p.style.margin = '2px 0'; p.textContent = a; faixa.appendChild(p); }
  const x = document.createElement('button');
  x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Fechar aviso');
  x.style.cssText = 'position:absolute;top:4px;right:6px;border:0;background:none;font-size:20px;cursor:pointer;color:inherit';
  x.addEventListener('click', () => faixa.remove());
  faixa.appendChild(x);
  document.body.appendChild(faixa);
  return true;
}

// espera o login (o botão "Plataforma" aparece depois dele); confere uma vez e para (desiste depois de 5 min)
let tentativas = 0;
const relogio = setInterval(() => { tentativas++; conferir().then((feito) => { if (feito || tentativas > 60) clearInterval(relogio); }).catch(() => {}); }, 5000);
