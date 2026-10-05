'use strict';
// =====================================================================
//  analytics/config.js — TODOS os parâmetros do motor num único lugar.
//
//  Regra: nenhum número "mágico" fica espalhado pelo código. Cada valor
//  abaixo é um HIPERPARÂMETRO ESTATÍSTICO (força de um prior, nível de
//  significância, tamanho de janela) e não uma regra de negócio disfarçada.
//  Quando houver dados suficientes, a maioria deles pode ser calibrada
//  pelo próprio backtest (analytics/evaluation.js).
//
//  Override sem deploy: documento Firestore `analytics_config/params`
//  (merge raso sobre este objeto — ver store.js).
// =====================================================================

const base = {
  VERSAO: '1.1.0',

  // ---- Tempo -------------------------------------------------------
  TZ_OFFSET_HORAS: -3,            // Brasília (sem horário de verão desde 2019)
  JANELA_DIAS: 180,               // histórico de PEDIDOS lido por execução (perfis de cliente)
  JANELA_LONGA_DIAS: 900,         // histórico de AGREGADOS DIÁRIOS lido (sazonalidade/demanda) — 1 doc por dia
  MAX_PEDIDOS: 20000,             // trava de segurança de leitura
  DIAS_ABERTOS_PADRAO: [0, 1, 2, 3, 4, 5, 6],

  // ---- Hierarquia / credibilidade (pseudo-observações do prior) ----
  K_CRED: 3,                      // peso do prior em P(cliente, produto)
  K_CAT: 5,                       // peso do prior em "cliente gosta da categoria"
  K_CICLO: 2,                     // peso do prior no intervalo de recompra
  K_GAP: 3,                       // peso do prior nas semanas entre visitas
  K_DOW_CLIENTE: 3,               // prior do dia da semana preferido do cliente
  K_DOW_PRODUTO: 10,              // prior do efeito dia-da-semana por produto
  K_ASSOC: 5,                     // encolhimento do lift (pares com pouco suporte)
  MEIA_VIDA_GLOBAL_DIAS: 90,      // popularidade global dá mais peso ao recente
  MEIA_VIDA_COMPRAS: 6,           // peso temporal nas quantidades do cliente

  // ---- Modelo de recompra -----------------------------------------
  S_MIN_LOG: 0.15,                // piso do desvio (escala log): jitter natural de dia de compra
  S_PRIOR_PADRAO: 0.35,           // desvio-prior quando ainda não há dados globais
  TAU_PRIOR_PADRAO: 0.7,          // incerteza (log) do prior de LOCALIZAÇÃO do ciclo ≈ fator 2 entre produtos
  NU_PADRAO: 7,                   // intervalo-prior entre visitas (dias) sem dados globais
  Z_ATRASO: 2,                    // acima de mediana + Z·desvio começa o "atraso"
  MEIA_VIDA_ATRASO_CICLOS: 1,     // a cada ciclo extra de atraso, a retenção cai pela metade
  CV_IRREGULAR: 0.5,              // desvio (log) acima disso = "irregular"
  Z_TENDENCIA: 1.5,               // significância mínima p/ declarar tendência
  LIMIAR_EXPLICAR_FATOR: 1.15,    // só cita fator sazonal/dia-da-semana se ≥ 15%
  GAP_MAX: 12,                    // semanas entre visitas: última classe = "12 ou mais"
  ROTULOS_CICLO: [
    { min: 5,  max: 9,  rotulo: 'semanal' },
    { min: 11, max: 17, rotulo: 'quinzenal' },
    { min: 18, max: 25, rotulo: 'a cada 3 semanas' },
    { min: 26, max: 35, rotulo: 'mensal' },
  ],
  NIVEIS_HISTORICO: { inicial: 1, aprendendo: 2, recorrente: 4 }, // nº de visitas

  // ---- Associação entre produtos ----------------------------------
  ASSOC_MIN_PARES: 3,             // pares vistos menos vezes que isso são ignorados
  ASSOC_TOP: 8,                   // associações guardadas por produto

  // ---- Demanda geral ----------------------------------------------
  N_OBS_DOW: 8,                   // últimas N ocorrências do mesmo dia da semana
  MEIA_VIDA_DEMANDA: 4,           // peso temporal (em ocorrências)
  MIN_OBS_DEMANDA: 3,             // abaixo disso: sem intervalo confiável
  MIN_RESIDUOS: 6,                // resíduos próprios necessários p/ intervalo próprio
  K_DOW_DEMANDA: 1,               // encolhimento do fator dia-da-semana do produto
  K_NUCLEO: 1,                    // peso do nível recente frente ao mesmo-dia-da-semana
  JANELA_NIVEL: 28,               // dias do 'nível recente'
  MIN_HIST_NUCLEO: 4,             // observações mínimas p/ qualquer previsão
  EPS_ESCALA: 0.5,                // evita divisão por zero em demanda intermitente
  BACKTEST_DIAS: 14,              // dias recentes usados p/ avaliar top-down vs bottom-up
  MIN_BACKTEST: 5,                // mínimo de dias avaliados p/ ponderar métodos
  MIN_CLIENTES_BU: 5,             // clientes modelados p/ o bottom-up valer algo
  MIN_VISITAS_BU: 2,              // visitas mínimas do cliente entrar no bottom-up
  HORIZONTE_BU_MAX: 7,            // bottom-up só até N dias à frente
  Z_TEND_DEMANDA: 1.5,

  // ---- Demanda intermitente (produto que passa dias sem vender) ----
  // TSB (Teunter-Syntetos-Babai): acompanha separadamente a CHANCE de vender no dia
  // e o TAMANHO da venda. Entra em média com o núcleo só quando o produto é intermitente.
  TSB_ATIVO: true,
  ADI_INTERMITENTE: 1.32,         // intervalo médio entre vendas (em dias abertos) acima disso = intermitente (Syntetos-Boylan)
  TSB_ALFA: 0.2,                  // suavização do tamanho da venda
  TSB_BETA: 0.1,                  // suavização da chance de venda
  PESO_TSB: 0.5,                  // peso do TSB na média com o núcleo (0 desliga)

  // ---- Falta de produto (demanda censurada) -----------------------
  // Dia em que o Fechamento marcou "Não tem": a venda registrada é só um PISO da
  // procura real. O motor sobe esse dia até o que era esperado e não usa o dia
  // para medir o próprio erro.
  CORRIGIR_RUPTURA: true,

  // ---- Sazonalidade ----------------------------------------------
  JANELA_EVENTO: 3,               // ±dias em torno de feriado/data especial
  MIN_OCORRENCIAS_EVENTO: 2,      // sem 2 ocorrências NÃO assumimos efeito
  MIN_OCORRENCIAS_MES: 2,         // idem para o mês do ano
  K_SAZ: 2,

  // ---- Estoque / compra ------------------------------------------
  NIVEL_SERVICO: 0.8,             // decisão de negócio: P(não faltar). Perecível => <1
  // Por produto (campo "duracao" no cadastro). Quem estraga em 1–2 dias pede MENOS folga
  // (sobra vira perda); quem dura aguenta mais folga. São pontos de partida: ajuste aqui
  // ou no documento analytics_config/params conforme a sua margem e a sua perda real.
  NIVEL_SERVICO_CLASSES: { curta: 0.65, normal: 0.8, longa: 0.9 },
  Q_INF: 0.1,
  Q_SUP: 0.9,
  LARGURA_REL_ALTA: 1.0,          // (q90-q10)/previsto acima disso = "alta variabilidade"

  // ---- Confiança --------------------------------------------------
  N0_VOLUME: 8,                   // ~2 meses de dados semanais ⇒ volume ≈ 63%
  CONF_BAIXA: 0.4,
  CONF_ALTA: 0.7,

  // ---- Avaliação / operação --------------------------------------
  AVALIACAO_JANELA_DIAS: 28,
  RECALC_INTERVALO_MS: 5 * 60 * 1000,
  KG_POR_UN_MIN_OBS: 3,           // pesagens p/ estimar kg por unidade de itens ainda não pesados
};

module.exports = base;

