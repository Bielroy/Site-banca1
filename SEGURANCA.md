# Segurança do site — como funciona e o que conferir

Este arquivo descreve **como o site se protege**. Ele não tem chave nem senha (isso nunca fica no projeto).
Para publicar as regras e ligar o que depende do console do Firebase, veja a seção **4l** do `PUBLICAR.md`.

## 1. As peças e quem confia em quem

| Peça | O que é | Quem acessa | Como prova quem é | O que acontece se alguém mexer no pedido |
|---|---|---|---|---|
| Loja (`index.html`) | Vitrine e carrinho | Qualquer pessoa, **sem login** | Login anônimo do Firebase, feito sozinho, só para dizer "este pedido é meu" | O servidor refaz todas as contas; o navegador só mostra |
| Painel (`admin.html`) | Pedidos, produtos, caixa | Equipe da loja | Link que chega no e-mail + papel gravado no login pelo servidor | Sem papel naquela loja, o servidor e o banco recusam |
| Plataforma (`plataforma.html`) | Todas as lojas | Dono da plataforma | O mesmo login, com a marca `plataforma` | Sem a marca, toda ação responde "área restrita" |
| Funções (`api/*.js`, na Vercel) | Quem grava pedido, estoque, equipe | Chamadas do site | Token do Firebase conferido no servidor | Entrada fora do formato é recusada antes de tocar no banco |
| Banco (Firestore) | Os dados | Navegador (com as regras) e servidor | Regras de `firestore.rules` | O que não está liberado nas regras é negado |
| Fotos (Storage / ImgBB) | Fotos de produto | Todos veem; só gestor envia | Regras de `storage.rules` / função `api/foto.js` | Só JPG, PNG e WebP pequenos |
| PagBank | PIX automático e maquininha | Só o servidor | Chave guardada no servidor | Aviso de pagamento sem assinatura do banco é ignorado |
| Gemini (IA) | Ajudante da loja e copiloto | Só o servidor | Chave guardada no servidor | Limite por conexão, por pessoa e por dia |

Regra de ouro: **o navegador nunca é barreira**. Esconder um botão é organização de tela; quem barra é o servidor e o banco.

## 2. Entrar no painel (autenticação)

```
pessoa digita o e-mail no painel
        │
        ▼
servidor (api/equipe.js, ação "pedir-link")
        │  confere limites: por conexão, por e-mail e geral
        │  o e-mail já faz parte de alguma equipe?
        ├── não → responde a MESMA frase e não envia nada
        └── sim → pede ao Firebase para enviar o link (que só abre o NOSSO painel)
        ▼
pessoa toca no link do e-mail (uso único) → Firebase confirma o e-mail e cria o login
        ▼
o login traz o papel (gravado só pelo servidor): tenants{loja: papel} / plataforma / admin
        ▼
painel abre só as telas do papel · servidor e banco conferem o papel em CADA ação
```

- A resposta é sempre "Se este e-mail estiver autorizado, o link chega em instantes".
- Conta com e-mail **não confirmado** não tem papel nenhum (servidor, banco e armazenamento).
- "Sair" apaga do aparelho a cópia dos dados do painel. "Sair de todos os aparelhos" encerra o login em todo lugar.
- Tirar alguém da equipe encerra o login dela; balcão, estoque, fotos, equipe e plataforma recusam na hora.
- O cliente da loja **não tem e nunca terá login obrigatório**.

## 3. Autorização (quem pode o quê)

```
chamada chega ──► qual loja? (endereço, cabeçalho X-Loja ou corpo) ── só diz ONDE olhar
                        │
                        ▼
                 quem é? (token do Firebase conferido no servidor)
                        │
                        ▼
                 que papel essa pessoa tem NESTA loja? ── vem do login, nunca do pedido
                        │
              ┌─────────┴─────────┐
           tem papel            não tem
              │                    │
        executa só na          recusa (403) e
        pasta desta loja       nada é lido nem gravado
```

### Matriz de papéis

| Ação | Plataforma | Proprietário | Administrador | Funcionário | Caixa | Produção | Estoque | Cliente |
|---|---|---|---|---|---|---|---|---|
| Ver a vitrine, fazer pedido | sim | sim | sim | sim | sim | sim | sim | sim |
| Ver/cancelar/avaliar o **próprio** pedido | — | — | — | — | — | — | — | sim |
| Ver pedidos da loja, avançar status | sim | sim | sim | sim | sim | não | não | não |
| Cancelar pedido pelo painel, pesar, gerar PIX | sim | sim | sim | sim | sim | não | não | não |
| Vender no balcão | sim | sim | sim | sim | sim | não | não | não |
| Produtos, preço, categorias, configurações | sim | sim | sim | não | não | não | não | não |
| Cupons, clientes (CRM), calendário (editar) | sim | sim | sim | não | não | não | não | não |
| Balanço, previsão, copiloto, textos da IA | sim | sim | sim | não | não | não | não | não |
| Entrada, perda, contagem e produção de estoque | sim | sim | sim | não | não | sim | sim | não |
| Limites de estoque, custo e ficha técnica | sim | sim | sim | não | não | sim | sim | não |
| Fechamento da feira | sim | sim | sim | sim | não | não | sim | não |
| Enviar fotos | sim | sim | sim | não | não | não | não | não |
| Aparência da loja (nome, cores) | sim | sim | sim | não | não | não | não | não |
| Equipe, cópia de segurança, zerar, maquininha, registro de ações | sim | sim | não | não | não | não | não | não |
| Ligar/bloquear loja, módulos, feira, chaves, dono de loja | sim | não | não | não | não | não | não | não |

Só o **servidor** faz: criar pedido, mudar valor ou itens, cancelar (devolve estoque), mexer no estoque físico,
no caixa do dia, nas previsões, na equipe, na nota das avaliações e na trilha de auditoria.

### Status do pedido (máquina de estados)

```
novo ─┐
aguardando pagamento ─┼─► separando ─► a caminho ─► arquivado (fim)
a pesar ─┘                    (qualquer um deles pode ir direto para "arquivado")

cancelado (fim): só o servidor escreve; não volta a andar.
```
O banco recusa qualquer passo para trás e qualquer status que não exista.

## 4. Lojas separadas (multi-tenant)

```
loja "banca" (original) ──► raiz do banco:  produtos/ pedidos/ loja/ ...
loja "x"                 ──► tenants/x/:     produtos/ pedidos/ loja/ ...
```
- A loja pedida pelo navegador só escolhe a pasta. O papel é sempre lido do login **para aquela loja**.
- Cupom, estoque, pedido, previsão, copiloto e cópia de segurança de uma loja nunca enxergam a outra.
- PIX automático só existe na loja original (a conta do banco é uma só); outra loja não gera cobrança com ela.
- Fora da loja original, a página nunca mostra o nome, a frase ou o rodapé da Banca.

## 5. Endereços do servidor

| Endereço | Precisa de login? | Quem pode | Freios |
|---|---|---|---|
| `POST /api/checkout` | não (cliente) | qualquer pessoa | rajada por conexão; 8 pedidos/10 min por conexão; teto da loja; formato de tudo o que vira nome de documento |
| `POST /api/cancelar-pedido` (cancelar, avaliar) | sim | dono do pedido (5 min) ou quem atende | 10/10 min por pessoa; devolução única |
| `POST /api/pagamento-pix` | sim | dono do pedido ou quem atende | 6/10 min por pessoa; 300/dia na loja; não volta status |
| `POST /api/pagamento-webhook` | não (PagBank) | quem tem a assinatura do banco | corpo com teto; reconsulta a ordem; confere ordem, valor e status |
| `POST /api/assistente` chat | não | cliente da loja com o módulo ligado | por conexão (memória e banco); teto do dia por loja; tamanho das entradas |
| `POST /api/assistente` copiloto e textos | sim | gestor | por pessoa; teto do dia por loja |
| `GET /api/assistente?diagnostico=1` | sim | plataforma (ou segredo) | fechado por padrão |
| `POST /api/analytics` ranking | sim (anônimo vale) | o próprio cliente | por pessoa e por conexão |
| `POST /api/analytics` painel, cliente, recalcular | sim | gestor | recalcular: 20/hora por loja |
| `GET /api/analytics` (rotina diária) | segredo | Vercel | comparação de segredo sem vazar tempo |
| `POST /api/pdv` | sim | quem atende | por pessoa; login encerrado não passa |
| `POST /api/estoque` | sim | gestor, estoque, produção | 40/min por pessoa |
| `POST /api/foto` | sim | gestor | 300 fotos/hora; só imagem de verdade |
| `POST /api/equipe` pedir-link | não | qualquer pessoa | por conexão, por e-mail e geral; resposta sempre igual |
| `POST /api/equipe` (resto) | sim | proprietário (avisos: quem atende) | login encerrado não passa; trilha |
| `POST /api/plataforma` | sim | dono da plataforma | login encerrado não passa; trilha e alerta |
| `GET /api/manifest` | não | qualquer pessoa | só dado público; ficha em memória |

Toda resposta de `/api` vai com "não guardar" (`no-store`). Só o próprio site recebe permissão de origem (CORS).

## 6. O que é público e o que é privado

**Público (qualquer visitante lê):** produtos (nome, preço, foto, unidade, se está à venda, estoque e limites),
categorias, ficha da loja (nome, cores, tipo, módulos), `loja/config` (WhatsApp da loja, chave PIX e nome de quem
recebe, condomínios atendidos, taxa e horários), comunicados, nota média das avaliações, feiras.

**Do cliente (só ele e quem atende):** o pedido dele: nome, telefone, condomínio, quadra, lote, itens, total, avaliação.

**Da equipe da loja:** pedidos (quem atende), custos e fichas técnicas, histórico de estoque e produções (estoque,
produção, gestor), fechamento da feira, calendário.

**Só de quem administra:** cupons, clientes (CRM), resumos do caixa, previsão e perfil de compra dos clientes,
equipe, banco de fotos.

**Só do servidor (ninguém lê pelo navegador):** chaves (`plataforma/segredos`, `plataforma/maquininha_*`), cópias de
segurança, contadores de limite, trilha de auditoria, aparelhos que recebem aviso, uso da IA.

## 7. Segredos

| Segredo | Onde fica | Vai ao navegador? |
|---|---|---|
| `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` | variáveis da Vercel | não |
| `GEMINI_API_KEY` | variável da Vercel (vai no cabeçalho da chamada, nunca no endereço) | não |
| `PAGBANK_API_TOKEN` | Vercel ou `plataforma/segredos` | não |
| Token da maquininha (EDI) | `plataforma/maquininha_{loja}` | não |
| Chave do ImgBB | Vercel ou `plataforma/segredos` | não |
| `CRON_SECRET`, `DIAGNOSTICO_SECRET` | variáveis da Vercel | não |
| `VAPID_PRIVATE_KEY` | variável da Vercel | não |
| `VITE_FIREBASE_API_KEY`, `VITE_VAPID_PUBLIC_KEY` | variáveis da Vercel | **sim, são públicas por natureza** |

A chave pública do Firebase identifica o projeto; ela não dá acesso a nada sozinha (quem protege são as regras).
Convém restringi-la no Google Cloud (PUBLICAR.md, 4l). Rotação: trocar `CRON_SECRET` e as chaves de serviço uma vez
por ano, e na hora se alguém que tinha acesso sair.

## 8. Cabeçalhos do site

`Content-Security-Policy` **valendo** (código só do próprio site, sem código embutido, sem `eval`; conexões só com o
Firebase; imagens `https`; fontes do Google), `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
`frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`. Estilos embutidos continuam permitidos (o site usa muitos); código embutido, não.

## 9. Trilha de auditoria

Fica no servidor (ninguém edita nem apaga pelo navegador). Registra: pedido de link de entrada (enviado, recusado,
barrado), papel dado ou tirado, "sair de todos os aparelhos", cópia baixada, cadastro restaurado, movimento zerado,
maquininha, e toda ação da plataforma. Nunca registra chave, token ou senha. O proprietário vê as da loja em
**Equipe → Registro de ações**. Guarda 400 dias.

Alertas no celular (no máximo um a cada 30 min por assunto): falha interna, muitas tentativas de entrar, limite de
links do Firebase, equipe alterada, movimento zerado, cadastro restaurado, mudança na plataforma, PIX menor que o
pedido, PIX de pedido cancelado, enxurrada de pedidos.

## 10. Testes de segurança

- `npm test` (roda sem internet): 27 testes "SEGURANÇA · ..." em `testes/seguranca.js`, além dos 83 que já existiam.
  Incluem mais de 600 tentativas de uma loja mexer em outra, a matriz de papéis, fraude de preço/quantidade/cupom,
  repetição de pedido e de aviso de pagamento, entrada no painel, IA, cabeçalhos e segredos.
- `testes/regras/regras.test.js`: as regras do banco e do armazenamento no **emulador oficial do Firebase**
  (leitura pública, cliente, isolamento, cada papel, status do pedido, aparência, fotos). O GitHub roda sozinho a
  cada mudança (`.github/workflows/seguranca.yml`).

## 11. O que este projeto NÃO tem (e por quê)

- **Segundo fator (MFA) dentro do site.** O Firebase só oferece com upgrade pago do login. O segundo fator de hoje
  é a verificação em duas etapas **da conta de e-mail** de quem entra no painel: ligue nela.
- **App Check e CAPTCHA.** Dependem de cadastro e chaves no console; ficaram documentados em PUBLICAR.md.
- **Registro de mudança de preço e de exclusão de produto.** Essas gravações vão do painel direto ao banco; para
  registrá-las o cadastro teria de passar pelo servidor.
- **Limite na borda (Firewall da Vercel).** Os freios atuais contam no banco; uma regra na borda barraria antes.
- **Teste com o PagBank de verdade.** O PIX automático e a maquininha nunca rodaram contra uma conta real.
