// =====================================================================
//  js/escape-lib.js — A ÚNICA função que transforma texto em HTML seguro.
//
//  Todo texto que vem de fora (nome de cliente, de produto, recado, endereço) e entra numa página montada
//  com innerHTML passa por aqui: & < > " ' viram entidades, então nada vira etiqueta nem atributo.
//  Antes cada arquivo tinha a sua cópia (OWASP: um só lugar para escapar = um só lugar para conferir).
//  Arquivo puro, sem navegador: os testes e os outros módulos importam daqui.
//  (js/impressao-lib.js mantém a cópia dele porque o servidor copia só aquele arquivo.)
// =====================================================================
const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
export const escapeHTML = (str) => (str === null || str === undefined ? '' : String(str).replace(/[&<>'"]/g, (m) => MAPA[m]));
