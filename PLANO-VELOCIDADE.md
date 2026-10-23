# Plano de velocidade (proposto em 23/10/2026 — NADA disso foi aplicado ainda)

Fica aqui até o dono confirmar. Quando vier a lista final, junta com os outros pedidos e só então começa.
Medições feitas num Chromium com rede e celular simulados (`scratchpad/perf`, não está no projeto): são relativas, não o site de verdade.

## Números medidos (tempo até a vitrine aparecer, mediana de 5)
| Cenário | Rede boa | Rede fraca |
|---|---|---|
| Hoje | 2,0 s | 3,2 s |
| Estilos em 1 arquivo + código pré-carregado | 1,9 s | 3,0 s |
| Loja já conhecida no aparelho + catálogo sem espera | 1,5 s | 1,9 s |
| Tudo junto | 1,4 s | 1,8 s |
Fluidez depois de aberta (celular 4x mais lento): 80 produtos = rolagem em ~60 fps e toque no "+" ~80 ms; 300 produtos = rolagem boa, toque no "+" ~300 ms.

## O que pesa (achado no código)
1. Trocar de loja recarrega a página inteira (`location.href`/`replace` em js/tema.js e js/feira.js).
2. A vitrine só aparece depois do tema: `iniciarTema` (js/tema.js) busca a ficha, depois a feira, depois a ficha das outras bancas da feira, uma etapa após a outra; a tela de entrada (js/melhorias-ui.js) espera isso (até 1,2 s depois dos produtos) e deixa tudo invisível (`body.montando`).
3. 14 arquivos de estilo bloqueiam a primeira tela; o código da loja (237 KB, 75 KB comprimido) vem num pacote só, sem pré-carregamento.
4. Service worker (vite.config.js): páginas em `NetworkFirst` com `networkTimeoutSeconds: 4` — em rede muito ruim, espera até 4 s antes de usar a cópia guardada.
5. Não existe `_routes.json`; com `functions/_middleware.js` na raiz, todo arquivo do site passa pelas Functions do Cloudflare (plano grátis: 100 mil por dia, somando API; estático fora das Functions é grátis e ilimitado — conferido na documentação).
6. Cloudflare Transformations (plano grátis): 5.000 transformações únicas por mês (foto × tamanho). Acima disso, novas dão erro 9422 e a loja cai na foto original.

## Proposta (ordem de ganho e risco)
**Baixo risco**
- Juntar os estilos num arquivo só (ou dentro do HTML) e pré-carregar o código da loja (`modulepreload`).
- Criar `_routes.json` (só `/api/*`, `/_vercel/image`, `/` e `/index.html` passam pelas Functions) — gerar em `scripts/cloudflare-arquivos.js`.
- Baixar o `networkTimeoutSeconds` do service worker (4 s → ~1,5 s).
- Adiar o que não aparece na primeira tela (avaliações, comunicados, ranking) até depois do primeiro desenho.
**Médio risco**
- Buscar ficha, feira e fichas das outras bancas em paralelo (hoje é em sequência) e/ou guardar a lista da feira no aparelho. É onde está o maior ganho.
- Categorias dentro do documento do catálogo (hoje a vitrine espera as duas respostas).
- Dividir o código pouco usado na abertura (artes em js/arte-lib.js + js/vitrine-arte.js = ~52 KB minificados, montar-loja, ia, endereço) com `import()` sob demanda.
- Não pré-guardar no service worker os arquivos do painel/plataforma no celular do cliente (`globIgnores`).
**Maior risco (segunda rodada)**
- Trocar de loja sem recarregar a página inteira.
- Dados da loja entregues pelo Cloudflare já dentro do HTML (as leituras de ficha, catálogo e config são públicas pelas regras; a função `_middleware.js` já busca a ficha por REST para o cartão do WhatsApp). Cotas do Firebase também agradecem.
- Fontes (Fraunces/Figtree) servidas pelo próprio site em vez do Google Fonts.

## Perguntas em aberto
- Região do Firestore (Firebase → Firestore Database → Localização): se estiver nos EUA, cada consulta custa 150–250 ms a mais saindo do Brasil.
- Quantos produtos cada loja tem (o toque no "+" passa de 300 ms perto de 300 produtos).
- Fotos antigas cadastradas por link sem passar pelo otimizador do painel continuam pesadas (o otimizador reduz para 1000 px em WebP).

---

# Pedidos simultâneos (analisado em 23/10/2026 — NADA aplicado ainda)

## O que o teste de carga mostrou (`node testes/carga/carga.js`, banco de mentira com 40 ms por consulta)
- 360 pedidos em 3 lojas, 60 ao mesmo tempo: 0 erros, nenhum pedido perdido, 117 pedidos/s, resposta típica 0,4–0,5 s.
- 25 clientes atrás do MESMO endereço de internet na mesma loja: 20 passam, 5 recebem "aguarde" (a loja oferece o WhatsApp).
- Fusível da loja: 160 pedidos em 10 min → 150 aceitos, 10 barrados; outras lojas seguem normais.
- Toque repetido (mesma chave): 1 pedido só.

## Os freios que podem barrar cliente de verdade (api/checkout.js, server/index.js)
| Freio | Hoje | Onde muda |
|---|---|---|
| Rajada por conexão (memória) | 6 pedidos em 10 s | código: `H.passouNaMemoria('pedido:...', 6, 10000)` |
| Por conexão (banco), por loja | 20 pedidos em 10 min | variável `CHECKOUT_POR_CONEXAO` no `~/segredos.env` do servidor |
| Fusível da loja inteira | 150 pedidos em 10 min | variável `CHECKOUT_TETO_LOJA` |
| Servidor, qualquer chamada /api | 600 por minuto por conexão | variável `LIMITE_POR_MINUTO` |
"Conexão" = endereço de internet público: quem está no mesmo Wi-Fi ou na mesma operadora (CGNAT) conta junto.

## Recomendação
- `CHECKOUT_POR_CONEXAO` 20 → 60 (só variável + `atualizar-servidor.sh`, sem código).
- Rajada por conexão 6 → 15 em 10 s (1 linha + teste).
- Manter o fusível da loja em 150 (já é 7x o movimento de 20 por 10 min e 2,5x o pior caso de 60) e `LIMITE_POR_MINUTO` em 600.
- A capacidade do servidor não é o problema (um servidor só, Node, ~117 pedidos/s no teste).

## O que realmente pode dar erro num dia de feira grande (cotas por dia)
- Firebase no plano grátis (Spark): 50.000 leituras e 20.000 gravações por dia; passou disso, o produto é desligado até renovar. Cada visita lê ~15–45 documentos; cada pedido grava ~10–15. Estimativa: 1.000–2.000 clientes por dia. Solução: plano Blaze (pague só o que passar da cota) com alerta de orçamento (R$ 20 já estava pendente).
- Cloudflare Functions no plano grátis: 100.000 requisições por dia (site + API + fotos). Cada abertura de loja usa ~75 hoje. Solução: `_routes.json` (tira os arquivos estáticos) e, depois, fotos fora das Functions; ou Workers Pago (US$ 5/mês, 10 milhões de requisições/mês).
- Cloudflare Transformations: 5.000 fotos×tamanhos únicos por mês no plano grátis.

## Perguntas em aberto
- O Firebase está no Spark ou no Blaze? (Firebase → Uso e faturamento)
- Tamanho da instância do Lightsail (RAM/CPU)?
