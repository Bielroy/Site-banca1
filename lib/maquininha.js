// =====================================================================
//  lib/maquininha.js — VENDAS DA MAQUININHA (PagBank) NO PAINEL.
//
//  O PagBank entrega as vendas da maquininha pela "API EDI":
//    GET https://edi.api.pagbank.com.br/movement/v3.00/transactional/AAAA-MM-DD
//    com o número do estabelecimento e um token próprio (pedido por chamado).
//  As vendas só ficam completas NO DIA SEGUINTE. Por isso a rotina da
//  madrugada busca o dia anterior e guarda um resumo em {loja}/maquininha/{dia}:
//  total vendido, estornos, quantidade e a divisão por crédito/débito/PIX.
//
//  As credenciais ficam em plataforma/maquininha_{loja}, que as regras do
//  banco não deixam ninguém ler pelo navegador. O painel só fala com isto
//  pelo servidor (api/equipe.js).
//
//  ATENÇÃO: o formato da resposta foi escrito pela documentação pública e
//  NUNCA foi conferido com uma conta de verdade. Por isso a leitura é
//  tolerante (aceita mais de um nome de campo) e, se nada for reconhecido,
//  o resumo guarda `formatoDesconhecido` com os NOMES dos campos recebidos
//  (sem valores), para dar para ajustar.
// =====================================================================
const T = require('./tenant');

const BASE = 'https://edi.api.pagbank.com.br/movement/v3.00';
const MAX_PAGINAS = 20;
const reais = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const diaValido = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const credsRef = (db, tid) => db.collection('plataforma').doc(`maquininha_${tid}`);

const estabelecimentoValido = (v) => /^\d{4,20}$/.test(String(v || ''));
const tokenValido = (v) => /^[A-Za-z0-9._\-=+/]{16,300}$/.test(String(v || ''));

async function salvarCredenciais(db, tid, estabelecimento, token) {
  const e = String(estabelecimento || '').trim(), t = String(token || '').trim();
  if (!e && !t) { await credsRef(db, tid).delete(); return { ligada: false }; }          // os dois vazios = desligar
  if (!estabelecimentoValido(e)) throw Object.assign(new Error('O número do estabelecimento tem só algarismos. Confira no e-mail do PagBank.'), { status: 400 });
  if (!tokenValido(t)) throw Object.assign(new Error('O token da maquininha parece incompleto. Copie inteiro, sem espaços.'), { status: 400 });
  await credsRef(db, tid).set({ estabelecimento: e, token: t, em: new Date().toISOString() });
  return { ligada: true };
}
async function lerCredenciais(db, tid) {
  const s = await credsRef(db, tid).get();
  return s.exists && estabelecimentoValido(s.data().estabelecimento) && tokenValido(s.data().token) ? s.data() : null;
}

// Meio de pagamento → como aparece no painel. Código que não estiver aqui vira "outros".
const MEIOS = { 3: 'credito', 8: 'debito', 11: 'pix', 15: 'debito', 2: 'boleto', 7: 'saldo' };
const pegar = (o, nomes) => { for (const n of nomes) if (o && o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n]; return undefined; };

/**
 * Transforma as linhas do extrato num resumo do dia.
 * - Venda parcelada pode vir em várias linhas (uma por parcela): conta UMA vez, pelo código da transação.
 * - Evento 1 = venda. Cancelamento e chargeback entram em `estornos` (não somem do total: aparecem ao lado).
 */
function resumir(linhas) {
  const r = { total: 0, vendas: 0, estornos: 0, liquido: 0, porMeio: { credito: 0, debito: 0, pix: 0, outros: 0 } };
  const vistas = new Set(); let reconhecidas = 0;
  for (const l of Array.isArray(linhas) ? linhas : []) {
    const valor = pegar(l, ['valor_total_transacao', 'valor_original_transacao', 'valor_parcela']);
    if (valor === undefined) continue;
    reconhecidas++;
    const codigo = String(pegar(l, ['codigo_transacao', 'codigo_venda', 'nsu']) || `linha-${reconhecidas}`);
    const evento = Number(pegar(l, ['tipo_evento']) || 1), chave = `${evento}|${codigo}`;
    if (vistas.has(chave)) continue;            // outra parcela da mesma venda
    vistas.add(chave);
    const v = Math.abs(reais(valor));
    if (evento === 1) {
      r.total += v; r.vendas++;
      const meio = MEIOS[Number(pegar(l, ['meio_pagamento']))] || 'outros';
      r.porMeio[meio === 'boleto' || meio === 'saldo' ? 'outros' : meio] += v;
      r.liquido += reais(pegar(l, ['valor_liquido_transacao']));
    } else if (evento === 5 || evento === 6 || evento === 3) {
      r.estornos += v;
    }
  }
  for (const k of ['total', 'estornos', 'liquido']) r[k] = reais(r[k]);
  for (const k of Object.keys(r.porMeio)) r.porMeio[k] = reais(r.porMeio[k]);
  return { ...r, reconhecidas };
}

/** Busca o extrato de um dia no PagBank (todas as páginas). Lança erro com mensagem que o painel pode mostrar. */
async function baixarDia(creds, dia) {
  const auth = 'Basic ' + Buffer.from(`${creds.estabelecimento}:${creds.token}`).toString('base64');
  const linhas = []; let validado = null, paginas = 1;
  for (let p = 1; p <= Math.min(paginas, MAX_PAGINAS); p++) {
    const ctl = new AbortController(), relogio = setTimeout(() => ctl.abort(), 20000);
    let r;
    try { r = await fetch(`${BASE}/transactional/${dia}?pageNumber=${p}&pageSize=1000`, { headers: { Authorization: auth, Accept: 'application/json' }, signal: ctl.signal }); }
    catch (e) { throw Object.assign(new Error('Não consegui falar com o PagBank agora. Tente de novo mais tarde.'), { status: 502 }); }
    finally { clearTimeout(relogio); }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('O PagBank recusou o número do estabelecimento ou o token. Confira os dois.'), { status: 400 });
    if (r.status === 404 || r.status === 204) break;                       // dia sem movimento
    if (!r.ok) throw Object.assign(new Error(`O PagBank respondeu com erro (${r.status}). Tente de novo mais tarde.`), { status: 502 });
    const corpo = await r.json().catch(() => null);
    if (!corpo) break;
    const lista = Array.isArray(corpo.detalhes) ? corpo.detalhes : Array.isArray(corpo.details) ? corpo.details : Array.isArray(corpo) ? corpo : [];
    linhas.push(...lista);
    const pg = corpo.pagination || corpo.paginacao || {};
    paginas = Number(pg.totalPages || pg.total_pages || 1) || 1;
    const cab = r.headers && typeof r.headers.get === 'function' ? r.headers.get('validado') : null;
    if (cab !== null && cab !== undefined) validado = String(cab).toLowerCase() === 'true';
    else if (corpo.validado !== undefined) validado = corpo.validado === true || String(corpo.validado).toLowerCase() === 'true';
    if (!lista.length) break;
  }
  return { linhas, validado };
}

/** Busca um dia e guarda o resumo em {loja}/maquininha/{dia}. Devolve o resumo. Sem credenciais, devolve null. */
async function buscarDia(db, tid, dia) {
  if (!diaValido(dia)) throw Object.assign(new Error('Dia inválido.'), { status: 400 });
  const creds = await lerCredenciais(db, tid);
  if (!creds) return null;
  const { linhas, validado } = await baixarDia(creds, dia), r = resumir(linhas);
  const doc = { dia, total: r.total, vendas: r.vendas, estornos: r.estornos, liquido: r.liquido, porMeio: r.porMeio, validado: validado !== false, buscadoEm: new Date().toISOString() };
  if (linhas.length && !r.reconhecidas) doc.formatoDesconhecido = Object.keys(linhas[0] || {}).slice(0, 60);      // só os NOMES dos campos, para ajustar a leitura
  await T.tdoc(db, tid, 'maquininha', dia).set(doc);
  return doc;
}

/** Os últimos dias, com o que o painel registrou em cada um, para comparar. */
async function ultimosDias(db, tid, hojeIso, dias = 7) {
  const base = new Date(`${hojeIso}T12:00:00Z`), saida = [];
  for (let i = 1; i <= dias; i++) {
    const dia = new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10);
    const [m, p] = await Promise.all([T.tdoc(db, tid, 'maquininha', dia).get(), T.tdoc(db, tid, 'resumos', dia).get()]);
    saida.push({ dia, maquininha: m.exists ? m.data() : null, painel: p.exists ? reais(p.data().receita) : 0 });
  }
  return saida;
}

module.exports = { salvarCredenciais, lerCredenciais, resumir, baixarDia, buscarDia, ultimosDias, estabelecimentoValido, tokenValido, diaValido };
