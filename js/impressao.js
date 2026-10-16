// =====================================================================
//  js/impressao.js — COMO o papel sai: os caminhos até a impressora.
//
//  O navegador não deixa um site falar direto com qualquer impressora, então
//  o sistema oferece vários caminhos e cada aparelho escolhe o seu:
//
//   sistema    Impressão do próprio aparelho (a mesma tela de "Imprimir" de
//              sempre). Serve para QUALQUER impressora já instalada nele:
//              Wi-Fi, rede, cabo, AirPrint. Funciona em todo navegador.
//   bluetooth  Térmica Bluetooth (BLE) direto pelo navegador. Chrome/Edge no
//              Android, Windows, Mac e Linux. Não existe no iPhone.
//   serial     Térmica no cabo USB ou Bluetooth "clássico" já pareado no
//              computador (porta serial). Chrome/Edge no computador.
//   app        Entrega o cupom para um aplicativo de impressão no Android
//              (padrão "rawbt:"), que fala com térmica por Bluetooth clássico,
//              Wi-Fi/IP ou USB.
//
//  A escolha fica guardada NESTE aparelho (cada caixa pode ter a sua impressora).
//  Para criar um caminho novo: acrescente em CAMINHOS e em enviar().
// =====================================================================
import { chave } from './tenant.js';
import { paraEscPos, paraHtml, fatiar, paraBase64, suporte } from './impressao-lib.js';
export { suporte };

export const CAMINHOS = {
    sistema:   ['Impressão do aparelho', 'Qualquer impressora já instalada neste aparelho: Wi-Fi, rede ou cabo. Abre a tela de imprimir.'],
    bluetooth: ['Bluetooth direto', 'Impressora térmica Bluetooth, sem instalar nada. Imprime sem abrir tela nenhuma.'],
    serial:    ['Cabo USB ou Bluetooth do computador', 'Térmica ligada no cabo, ou Bluetooth já pareado no computador.'],
    app:       ['Aplicativo de impressão (Android)', 'Usa um app como o RawBT, que alcança térmicas por Bluetooth, Wi-Fi (IP) ou USB.'],
};
// auto: impressão automática deste aparelho (js/impressao-fila-lib.js). aparelho: nome sorteado deste aparelho na fila.
const PADRAO = { modo: 'sistema', largura: 58, acentos: false, copias: 1, baud: 9600, btNome: '', btId: '',
    auto: 'manual', autoEtiqueta: false, autoPesado: false, autoCancelado: true, aparelho: '' };
const CHAVE = chave('banca_impressora');

export function lerConfig() {
    try { const c = JSON.parse(localStorage.getItem(CHAVE) || 'null'); if (c && CAMINHOS[c.modo]) return { ...PADRAO, ...c, copias: Math.min(Math.max(parseInt(c.copias, 10) || 1, 1), 5), auto: ['chegada', 'aceite'].includes(c.auto) ? c.auto : 'manual' }; } catch (_) { /* segue com o padrão */ }
    return { ...PADRAO };
}
export function salvarConfig(c) { try { localStorage.setItem(CHAVE, JSON.stringify({ ...lerConfig(), ...c })); } catch (_) { /* armazenamento bloqueado */ } return lerConfig(); }
/** Nome sorteado deste aparelho (a fila de impressão usa para saber quem reservou o pedido). */
export function aparelhoId() {
    const c = lerConfig(); if (/^[\w-]{6,40}$/.test(c.aparelho)) return c.aparelho;
    let id = '';
    try { id = 'ap-' + [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
    catch (_) { id = 'ap-' + Math.random().toString(36).slice(2, 14) + Date.now().toString(36); }
    salvarConfig({ aparelho: id });
    return lerConfig().aparelho || id;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const erro = (msg) => Object.assign(new Error(msg), { amigavel: true });

// Um papel por vez: a impressão automática e um toque em "Cupom" ao mesmo tempo misturariam os bytes na impressora.
let filaEnvio = Promise.resolve();
const emFila = (fn) => { const r = filaEnvio.then(fn, fn); filaEnvio = r.catch(() => {}); return r; };
const enviarTermica = (modo, bytes) => (modo === 'bluetooth' ? enviarBt(bytes) : modo === 'serial' ? enviarSerial(bytes) : modo === 'app' ? enviarApp(bytes) : undefined);

// ---------------------------------------------------------------- Bluetooth (BLE)
// Serviços usados pelas térmicas mais comuns. O navegador só deixa abrir os que estiverem nesta lista.
const SERVICOS_BT = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb'];
const bt = { aparelho: null, canal: null };
async function abrirBt(aparelho) {
    const g = aparelho.gatt.connected ? aparelho.gatt : await aparelho.gatt.connect();
    for (const s of await g.getPrimaryServices()) {
        let cs = []; try { cs = await s.getCharacteristics(); } catch (_) { continue; }
        const c = cs.find((x) => x.properties && (x.properties.writeWithoutResponse || x.properties.write));
        if (c) { bt.aparelho = aparelho; bt.canal = c; return c; }
    }
    throw erro('Conectei, mas este aparelho não aceita impressão por este caminho. Tente "Aplicativo de impressão" ou "Impressão do aparelho".');
}
async function escolherBt() {
    if (!navigator.bluetooth) throw erro(suporte().bluetooth);
    let aparelho;
    try { aparelho = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICOS_BT }); }
    catch (e) { if (e && e.name === 'NotFoundError') throw erro('Nenhuma impressora escolhida.'); throw e; }
    await abrirBt(aparelho);
    salvarConfig({ btNome: aparelho.name || 'Impressora', btId: aparelho.id || '' });
    return aparelho.name || 'Impressora';
}
async function canalBt() {
    if (bt.canal && bt.aparelho && bt.aparelho.gatt.connected) return bt.canal;
    if (bt.aparelho) return abrirBt(bt.aparelho);                           // caiu a conexão: tenta de novo com o mesmo aparelho
    const id = lerConfig().btId;                                            // painel reaberto: alguns navegadores lembram a impressora
    if (id && navigator.bluetooth && navigator.bluetooth.getDevices) {
        const d = (await navigator.bluetooth.getDevices()).find((x) => x.id === id);
        if (d) { try { return await abrirBt(d); } catch (_) { /* cai no aviso abaixo */ } }
    }
    throw erro('A impressora Bluetooth não está conectada. Toque em "Impressora" e depois em "Conectar".');
}
async function enviarBt(bytes, segunda = false) {
    const c = await canalBt();
    const escrever = async (tam) => { for (const p of fatiar(bytes, tam)) { if (c.properties.write && c.writeValueWithResponse) await c.writeValueWithResponse(p); else { await c.writeValueWithoutResponse(p); await esperar(25); } } };
    try { await escrever(100); }
    catch (_) {
        bt.canal = null;                                      // uma nova tentativa, reabrindo a conexão
        if (!segunda) return enviarBt(bytes, true);
        throw erro('A impressora parou de responder. Confira se está ligada e perto, e toque em "Conectar".');
    }
}

// ---------------------------------------------------------------- cabo / porta serial
const serial = { porta: null };
async function escolherSerial() {
    if (!navigator.serial) throw erro(suporte().serial);
    try { serial.porta = await navigator.serial.requestPort(); }
    catch (e) { if (e && e.name === 'NotFoundError') throw erro('Nenhuma impressora escolhida.'); throw e; }
    return 'Impressora no cabo';
}
async function enviarSerial(bytes) {
    if (!navigator.serial) throw erro(suporte().serial);
    if (!serial.porta) serial.porta = (await navigator.serial.getPorts())[0] || null;      // já autorizada antes neste computador
    if (!serial.porta) throw erro('Nenhuma impressora escolhida. Toque em "Impressora" e depois em "Conectar".');
    const p = serial.porta;
    try {
        if (!p.writable) await p.open({ baudRate: Number(lerConfig().baud) || 9600 });
        const w = p.writable.getWriter();
        try { await w.write(bytes); } finally { w.releaseLock(); }
    } catch (e) { serial.porta = null; throw erro('Não consegui falar com a impressora no cabo. Confira se está ligada e toque em "Conectar".'); }
}

// ---------------------------------------------------------------- aplicativo (Android)
function enviarApp(bytes) {
    const a = document.createElement('a'); a.href = `rawbt:base64,${paraBase64(bytes)}`; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- impressão do aparelho
function enviarSistema(folhas, largura) { return enviarPagina(paraHtml(folhas, { largura })); }
function enviarPagina(html) {
    return new Promise((resolve, reject) => {
        const f = document.createElement('iframe');
        f.setAttribute('aria-hidden', 'true'); f.title = 'Impressão'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
        const limpar = () => setTimeout(() => f.remove(), 1000);
        f.onload = () => {
            try { const w = f.contentWindow; w.onafterprint = limpar; w.focus(); w.print(); setTimeout(limpar, 120000); resolve(); }
            catch (e) { f.remove(); reject(erro('Este navegador não abriu a tela de imprimir.')); }
        };
        f.srcdoc = html;
        document.body.appendChild(f);
    });
}

/**
 * RÓTULOS (js/admin-rotulos.js): o desenho já vem pronto.
 *  pagina = página com os rótulos → tela de imprimir do aparelho (folha A4, rolo de adesivo, qualquer impressora).
 *  bytes  = comandos ESC/POS da imagem → a térmica escolhida em "Impressora" (Bluetooth, cabo ou app).
 */
export async function imprimirPagina(html) { const falta = suporte().sistema; if (falta) throw erro(falta); return enviarPagina(html); }
export async function imprimirNaTermica(bytes) {
    const c = lerConfig();
    if (c.modo === 'sistema') throw erro('Para a térmica, escolha o caminho dela em "Impressora" (no topo do painel).');
    const falta = suporte()[c.modo]; if (falta) throw erro(falta);
    return emFila(() => enviarTermica(c.modo, bytes));
}

/** Abre a escolha da impressora (precisa vir de um toque). Devolve o nome para mostrar. */
export async function conectar(modo = lerConfig().modo) {
    if (modo === 'bluetooth') return escolherBt();
    if (modo === 'serial') return escolherSerial();
    return '';
}
/**
 * Tenta voltar a falar com a impressora SEM toque na tela (Bluetooth já escolhido antes, cabo já autorizado).
 * Devolve true se conseguiu. Nunca abre a lista de impressoras (isso só com um toque, em conectar()).
 */
export async function reconectar() {
    const m = lerConfig().modo;
    try {
        if (m === 'bluetooth') { await canalBt(); return true; }
        if (m === 'serial') { if (!serial.porta && navigator.serial) serial.porta = (await navigator.serial.getPorts())[0] || null; return !!serial.porta; }
    } catch (_) { /* segue desconectada */ }
    return false;
}
export const conectada = () => { const m = lerConfig().modo; return m === 'bluetooth' ? !!(bt.aparelho && bt.aparelho.gatt.connected) : m === 'serial' ? !!serial.porta : true; };

/**
 * Imprime. `folhas` = lista de folhas; cada folha é uma lista de linhas (js/impressao-lib.js).
 * Lança erro com .amigavel = true e uma frase pronta para mostrar.
 */
export async function imprimir(folhas, { copias } = {}) {
    const c = lerConfig(), n = Math.min(Math.max(parseInt(copias, 10) || c.copias || 1, 1), 20);
    const todas = []; for (let i = 0; i < n; i++) todas.push(...folhas);
    if (!todas.length) return;
    const falta = suporte()[c.modo]; if (falta) throw erro(falta);
    if (c.modo === 'sistema') return enviarSistema(todas, c.largura);
    const largura = c.largura === 'a4' ? 80 : c.largura;
    const partes = todas.map((f) => paraEscPos(f, { largura, acentos: c.acentos }));
    const bytes = new Uint8Array(partes.reduce((t, p) => t + p.length, 0)); let pos = 0; partes.forEach((p) => { bytes.set(p, pos); pos += p.length; });
    return emFila(() => enviarTermica(c.modo, bytes));
}
