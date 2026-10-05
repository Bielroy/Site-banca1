// =====================================================================
//  js/enderecos-config.js — ENDEREÇOS DAS LOJAS (subdomínio e domínio próprio).
//
//  Fica tudo DESLIGADO até você preencher as variáveis na Vercel
//  (Settings → Environment Variables) e publicar de novo:
//
//    VITE_DOMINIO_LOJAS      domínio da plataforma, sem "www".
//                            Ex.: minhaplataforma.com.br
//                            → cada loja abre em  id-da-loja.minhaplataforma.com.br
//    VITE_DOMINIOS_PROPRIOS  lojas com domínio só delas, separadas por vírgula.
//                            Ex.: bancaadairepedrina.com.br=banca, espetinhosdoze.com.br=espetinhos-do-ze
//
//  Sem as variáveis, vale o jeito de hoje: /?loja=id-da-loja.
// =====================================================================
import { lerProprios } from './enderecos-lib.js';
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const CFG = { base: env.VITE_DOMINIO_LOJAS || '', proprios: lerProprios(env.VITE_DOMINIOS_PROPRIOS) };
