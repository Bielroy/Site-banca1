// FORMATADORES MATEMÁTICOS E SEGURANÇA
export const fmt = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

export const escapeHTML = (str) => { 
    if(!str) return ''; 
    return String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match])); 
};

export const isFracionavel = (unidade) => {
    const u = (unidade || '').toLowerCase();
    return ['kg', 'kilo', 'quilograma', 'g', 'grama', 'l', 'litro'].includes(u);
};

export const fixFloat = (num) => Math.round(num * 1000) / 1000;

export const formatarQuantidadeVisual = (qtd, fracionavel) => {
    if (!fracionavel) return qtd.toString();
    return qtd.toString().replace('.', ',');
};

export const formatarQtdRelatorio = (qtd, und) => {
    if (isFracionavel(und)) return `${qtd.toString().replace('.', ',')} ${und || 'kg'}`;
    return `${qtd}x`;
};

// UI HELPERS
let toastTimer;
export const showToast = (msg) => {
    const t = document.getElementById('toast');
    if(!t) return;
    t.textContent = msg; 
    t.classList.add('visivel');
    clearTimeout(toastTimer); 
    toastTimer = setTimeout(() => t.classList.remove('visivel'), 3000);
};

export const animarFeedbackBtn = (btn) => {
    if(!btn) return;
    btn.classList.add('sucesso'); 
    btn.innerHTML = '✓';
    setTimeout(() => { 
        btn.classList.remove('sucesso'); 
        btn.innerHTML = '+'; 
    }, 500);
};

// HISTORY API MODAIS (Corrige botão voltar do Android)
export const openModal = (id) => {
    const modal = document.getElementById(id);
    if(modal) {
        modal.classList.add('aberto');
        history.pushState({ modal: id }, '', `#${id}`);
    }
};

export const closeModal = (id) => {
    const modal = document.getElementById(id);
    if(modal) modal.classList.remove('aberto');
};

// SVGs puros para Empty States
export const iconeCarrinhoVazio = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>`;
export const iconeHistoricoVazio = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>`;
