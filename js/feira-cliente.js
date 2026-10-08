// =====================================================================
//  js/feira-cliente.js — DE QUAL FEIRA é este cliente (guardado no aparelho).
//
//  Vem do link da feira (/feira/id ou ?feira=id), do condomínio escolhido ou da
//  conta (celular novo). Fica numa gaveta só, sem o nome da loja na chave: no
//  site principal todas as bancas leem a mesma. Com uma banca por subdomínio,
//  cada banca tem a sua gaveta e a feira vai junto no endereço (?feira=id).
// =====================================================================
const K = 'banca_feira_cliente';
const valido = (id) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(id || ''));
export const lerFeiraCliente = () => { try { const v = localStorage.getItem(K) || ''; return valido(v) ? v : ''; } catch (_) { return ''; } };
export const gravarFeiraCliente = (id) => { try { if (valido(id)) localStorage.setItem(K, id); else localStorage.removeItem(K); } catch (_) { /* sem armazenamento */ } };
export const esquecerFeiraCliente = () => gravarFeiraCliente('');
