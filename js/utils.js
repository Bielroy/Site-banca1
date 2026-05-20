// FORMATADORES MATEMÁTICOS E SEGURANÇA
export const fmt = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

// Escape XSS manual isolado (Apenas para uso interno do Tagged Template)
const escapeHTML = (str) => { 
    if(str === null || str === undefined) return ''; 
    return String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match])); 
};

/**
 * TAGGED TEMPLATE LITERAL (Sanitização Automática Contra XSS)
 * Uso: html`<div>${variavel_insegura}</div>`
 */
export const html = (strings, ...values) => {
    return strings.reduce((result, string, i) => {
        let value = values[i];
        
        // Se não houver valor, apenas concatena a string
        if (value === undefined) return result + string;
        
        // Se for um array (ex: map de itens), junta tudo sem vírgulas
        if (Array.isArray(value)) value = value.join('');
        
        // Se for um objeto HTML seguro (bypass intencional interno), pega o conteúdo, senão faz escape
        if (typeof value === 'object' && value !== null && value.__html) {
            value = value.__html;
        } else if (typeof value === 'string' || typeof value === 'number') {
            value = escapeHTML(value);
        }

        return result + string + value;
    }, '');
};

// Permite bypass de sanitização EXCLUSIVAMENTE para blocos controlados pelo sistema (Nunca input de usuário)
export const safeHTML = (string) => ({ __html: string });

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

// UI HELPERS (Estado de Loading para Botões Assegura UX e Evita Double-Click)
export const setBtnLoading = (btnId, isLoading, text = 'Processando...') => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isLoading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = html`<span class="spinner" style="margin-right:8px;">⏳</span> ${text}`;
        btn.disabled = true;
    } else {
        btn.innerHTML = safeHTML(btn.dataset.originalText);
        btn.disabled = false;
    }
};

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

// CONTROLADORES DE MODAL (History API)
export const openModal = (id) => {
    const modal = document.getElementById(id);
    if(modal) {
        modal.classList.add('aberto');
        history.pushState({ modal: id }, '', `#${id}`);
    }
};

export const closeModal = (id) => {
    const modal = document.getElementById(id);
    if(modal) {
        modal.classList.remove('aberto');
    }
};
