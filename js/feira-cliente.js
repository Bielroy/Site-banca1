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
// Última banca que o cliente abriu em cada feira: o link da feira volta direto para ela.
const KU = 'banca_feira_ultima';
export const lerUltimaBanca = (fid) => { try { const m = JSON.parse(localStorage.getItem(KU) || '{}'); const v = m && m[fid]; return valido(v) ? v : ''; } catch (_) { return ''; } };
export const gravarUltimaBanca = (fid, id) => {
    if (!valido(fid) || !valido(id)) return;
    try { const m = JSON.parse(localStorage.getItem(KU) || '{}') || {}; m[fid] = id; const chaves = Object.keys(m); if (chaves.length > 20) delete m[chaves[0]]; localStorage.setItem(KU, JSON.stringify(m)); } catch (_) { /* sem armazenamento */ }
};
