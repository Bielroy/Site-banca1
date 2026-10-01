# Motor de Demanda, Recomendação e Previsão

Estatística explicável (sem machine learning pesado, sem números aleatórios): tudo é derivado dos pedidos reais em `pedidos`/`produtos`.

## 1. Diagnóstico do sistema existente

| Item | Como é hoje |
|---|---|
| Pedido | `pedidos/{id}`: `data` (ISO UTC), `status`, `userId`, `nome`, `quadra`, `lote`, `telefone?`, `itens[{id,nome,qtd,tipo,unidade,preco,pesoFinal?}]`, `total` |
| Cliente | **Não existe coleção.** `userId` é uid **anônimo** do Firebase (muda por aparelho); telefone é opcional. A identidade estável é **quadra + lote** |
| Produto | `produtos/{id}`: `nome, cat, unidade, preco, foto, ativo, estoqueFisico?, maxPorPedido?` |
| Peso real | Itens "a pesar" (`tipo:'un'`, unidade kg) só têm o kg real em `pesoFinal`, preenchido no fechamento da esteira |
| Ordem da vitrine | **Não havia lógica de pontos**: os cards saíam na ordem do Firestore (id do documento) |
| Previsão atual | Só no admin, via Gemini (`api/assistente.js`, `demand_prediction`) — LLM sem estatística |
| Faltava | Perfil por cliente, intervalo de recompra, associação entre produtos, sazonalidade, incerteza, avaliação do erro, histórico agregado de longo prazo |

**Estratégia de dados faltantes (sem tocar no checkout):** a identidade do cliente é *derivada* (quadra+lote normalizados) e o histórico longo passa a ser coletado em `analytics_vendas/{dia}` (1 documento por dia) a cada execução.

## 2. Arquitetura

```
DADOS → ANÁLISE → FEATURES → PREVISÃO → RECOMENDAÇÃO → INTERFACE

pedidos ─► normalize ─► customerProfile ─► repurchaseModel ─► ranking ───────► /api/analytics {ranking} ─► loja (CSS order)
produtos ─►           ─► productAssociation ─┘                    └► explicações
analytics_vendas ─► demandForecast (+seasonality, +confidence) ─► inventoryRecommendation ─► painel admin
snapshots ─► evaluation (previsto × realizado) ─► confiança / calibração
```

Roda **no servidor** (função Vercel + cron diário). O navegador só consome resultados prontos. A loja nunca lê histórico.

### Arquivos novos
`analytics/` — `config` (todos os hiperparâmetros), `stats`, `normalize`, `seasonality`, `repurchaseModel`, `productAssociation`, `customerProfile`, `ranking`, `demandForecast`, `confidence`, `inventoryRecommendation`, `evaluation`, `engine` (pipeline puro), `store` (Firestore), `publicApi` (resposta mínima p/ a loja), `__tests__/` (63 testes).
`api/analytics.js` · `js/ranking-loja.js` · `js/admin-previsao.js` · `css/admin-previsao.css` · `ANALYTICS.md`

### Arquivos alterados (mudanças mínimas)
- `js/loja.js` (+4 linhas): importa o ranking, chama `iniciarRanking()` após o login, `aplicarOrdem()` quando o grid é recriado, upsell ordenado por probabilidade.
- `js/admin.js` (+2): importa e abre a aba. `admin.html` (+1 aba, +1 `<link>`). `css/loja.css` (+etiqueta). `vercel.json` (+cron, +`maxDuration`). `package.json` (+`npm test`).

## 3. Como funciona

**Cliente × produto.** Cada par é um processo de renovação. O tempo entre compras segue uma lognormal ajustada com a **mediana** e o **desvio robusto (MAD)** dos intervalos reais, encolhidos em direção ao ritmo de visitas do próprio cliente (`ajustarCiclo`).

Probabilidade de comprar na próxima visita, com `t` = dias desde a última compra e `w` = metade do intervalo entre visitas:

    h(t) = [F(t+w) − F(t−w)] / [1 − F(t−w)]        (F = cdf da lognormal)

Compra recente ⇒ h≈0 · perto do ciclo ⇒ h alto · produto quinzenal com visitas semanais alterna sozinho. **Atraso não zera:** passado `mediana + 2·desvio` a hazard fica em platô e só uma retenção `A(t)` decai devagar (meia-vida de 1 ciclo) → "possivelmente abandonado", nunca "cliente perdido".

**Mistura por credibilidade (Bühlmann):** `P = λ·h·A + (1−λ)·prior`, com `λ = n_ef / (n_ef + K·(s/τ)²)`, `n_ef = intervalos − 1`. Compras muito regulares ⇒ λ≈1; erráticas ou com 1 intervalo ⇒ pesa o prior. O prior é a frequência encolhida (beta-binomial, inclui a evidência de *ausência*) sobre `popularidade global × gosto do cliente pela categoria × dia da semana do produto` — é a hierarquia cliente→categoria→produto→loja e o **cold start** (sem histórico, só o prior manda).

**Associações:** `support`, `confidence`, `lift` por cesta (visita). O lift é encolhido a 1 com pouco suporte: `1 + (lift−1)·n/(n+5)`, e pares vistos < 3 vezes são ignorados. Com itens na cesta, o ajuste entra nos log-odds. Não recomenda "o mais vendido": lift mede o *excesso* sobre a popularidade.

**Demanda geral (por produto, só dias abertos, zeros preenchidos):**
`núcleo = (n·E1 + K·E2)/(n+K)`; E1 = média ponderada das últimas 8 ocorrências do mesmo dia da semana; E2 = nível dos últimos 28 dias × fator do dia. Fatores de **feriado/mês só entram com ≥ 2 ocorrências observadas** (senão fator = 1 e a explicação diz o motivo). **Bottom-up:** Σ clientes `P(visita no dia) × P(compra|visita) × qtd habitual`, misturado ao top-down com peso ∝ 1/WAPE medido em backtest dos últimos 14 dias.

**Incerteza:** quantis **empíricos** (10%/90%) dos resíduos de um walk-forward do próprio modelo; horizontes de vários dias usam a soma móvel dos resíduos. Sem resíduos suficientes ⇒ incerteza de Poisson + confiança limitada a "baixa".

**Sugestão de compra** = quantil de nível `NIVEL_SERVICO` (0,80 em `config.js`, decisão de negócio: custo de faltar × custo de sobrar; perecível ⇒ <1). **Faixas** (🔴<q10, 🟡 q10–previsto, 🟢 previsto–q90, 🔵>q90) vêm dos quantis — não de ±%.

**Confiança** (média geométrica; um elo fraco derruba): volume `1−e^(−n/8)` · regularidade `1/(1+CV)` · acerto recente `1/(1+WAPE)` · qualidade `1−fração de pesos estimados`. Com < 3 observações do dia nunca passa de "baixa".

**Aprendizado contínuo:** a cada manhã o motor congela `{previsto,q10,q90}` de *hoje* e *amanhã* (`analytics_snapshots`). Quando o dia fecha, compara com o vendido (`analytics_avaliacao`): **MAE, RMSE, WAPE** (no lugar do MAPE, que explode com vendas ≈ 0), viés e **cobertura** (um intervalo 10–90 honesto cobre ≈ 80%). O WAPE recente alimenta a confiança; o backtest recalibra o peso TD×BU. Previsão da demanda usa **só dias completos** (≤ hoje−1): vendas parciais de hoje nunca entram na previsão de hoje.

## 4. Operação

**Variáveis (Vercel):** as `FIREBASE_*` que o checkout já usa + **`CRON_SECRET`** (qualquer string longa; o cron da Vercel a envia como `Authorization: Bearer`).

**Execução:** cron diário às 08:00 UTC (05:00 Brasília) · botão **↻ Recalcular** na aba 🔮 Previsão · `POST /api/analytics {acao:'recalcular'}` (admin). Plano Hobby: 1 cron/dia; no Pro dá para rodar de hora em hora editando `vercel.json`.

**Primeira vez:** abra 🔮 Previsão → Recalcular → *Opções avançadas → Importar histórico de 365 dias* (uma vez). Daí em diante cada execução lê só 180 dias de pedidos e acumula o resto em `analytics_vendas`.

**Custo (Firestore):** por execução ≈ pedidos dos últimos 180 dias + 1 doc/dia de agregado + ~1 doc por cliente (escrita). A loja gasta **2–3 leituras por cliente por sessão** (cache de 10 min no navegador e 5 min no servidor).

**Parâmetros:** tudo em `analytics/config.js`. Override sem deploy: documento `analytics_config/params` (ex.: `{"NIVEL_SERVICO": 0.9}`). Datas especiais próprias: `analytics_config/eventos` → `{"lista":[{"data":"2026-12-12","nome":"Festa do condomínio"}]}`. Dias de funcionamento: `loja/config.diasAbertos` (ex.: `[1,2,3,4,5,6]`).

### Regras do Firestore (cole no console)
```
match /analytics_vendas/{d}              { allow read, write: if false; }
match /analytics_clientes/{d}            { allow read, write: if false; }
match /analytics_uid/{d}                 { allow read, write: if false; }
match /analytics_global/{d}              { allow read, write: if false; }
match /analytics_previsoes/{d}           { allow read, write: if false; }
match /analytics_previsoes_chunks/{d}    { allow read, write: if false; }
match /analytics_snapshots/{d}           { allow read, write: if false; }
match /analytics_avaliacao/{d}           { allow read, write: if false; }
match /analytics_config/{d}              { allow read, write: if false; }
match /analytics_meta/{d}                { allow read, write: if false; }
```
O Admin SDK ignora as regras; o navegador só acessa tudo isso via `/api/analytics`, que valida o token (cliente: só o próprio ranking, só `id`+probabilidade+motivo; admin: claim `admin === true`). Se suas regras já negam por padrão, nada a fazer — mas **confirme**.

## 5. Limitações conhecidas (leia)
1. **Identidade = quadra+lote.** Se duas pessoas da mesma casa pedem, viram um cliente. Cliente novo/aparelho novo sem pedido ⇒ ranking geral (cold start) até o 1º pedido; depois o `uid` é associado na próxima execução.
2. **Ranking atualiza 1×/dia** (cron). Quem acabou de comprar só "se vê" no ranking na próxima execução ou após Recalcular.
3. **Demanda censurada:** dia com produto em falta aparece como venda baixa/zero e o modelo subestima. Hoje não há registro de ruptura; quando houver, basta marcar esses dias.
4. **Sazonalidade/feriados** só passam a valer com ≥ 2 anos (ou ≥ 2 ocorrências); até lá o sistema diz "sem ajuste".
5. **Risco de falta/excesso** só para produtos com `estoqueFisico` cadastrado.
6. **Não validado contra o Firestore real nem em produção:** a suíte usa um Firestore falso em memória (o SDK não roda neste ambiente). Faça o primeiro Recalcular com acompanhamento e confira o painel.
7. Previsão de **categoria/loja** está em R$ (somar kg + unidades não faz sentido).

## 6. Evolução (sem reescrever)
`engine.js` é uma função pura; `demandForecast.nucleo` e `ranking.probCompra` são os pontos de troca. Com 1–2 anos de dados: substituir o núcleo por LightGBM/Prophet (serviço separado) mantendo `intervalo`, `recomendar` e `evaluation`, que já medem se o novo modelo é melhor (WAPE e cobertura).

## 7. Testes
`npm test` — 63 testes: clientes semanal/quinzenal/mensal, parou de comprar, novo, 1 pedido, alternado, comprados juntos, histórico insuficiente, produto novo/sazonal, aumento e queda repentinos, previsão ≠ realizado e métricas de erro, ausência de vazamento temporal, privacidade e a persistência de ponta a ponta.
