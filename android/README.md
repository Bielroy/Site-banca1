# Ponte da Banca (app Android)

O celular que fica perto da impressora térmica e imprime os pedidos sozinho, **mesmo com a tela bloqueada**.

- **Servidor:** `lib/ponte.js` (regras) e `api/ponte.js` (o que o app chama).
- **Painel:** "⋯" → "Impressora" → "Celular da banca" (`js/admin-impressao.js`, `js/impressao-ponte.js`).
- **Compilação:** `.github/workflows/app-ponte.yml` gera o APK assinado e publica em
  `https://github.com/Bielroy/Site-banca1/releases/latest/download/banca-ponte.apk`.

## Como funciona

1. O painel gera um código de 8 letras (vale 15 min, uma vez). O app troca o código por um token próprio.
2. O app fica num serviço com aviso fixo na barra e pergunta à loja: "tem papel?". A loja segura a
   resposta até 45 s e responde na hora em que aparece um pedido para imprimir.
3. O app manda os bytes para a impressora (Bluetooth clássico ou BLE) e, na pergunta seguinte, conta o que saiu.
   A fila no servidor garante que nada sai duas vezes, nem com o painel imprimindo junto.

## Bateria

- Esperando, o celular pode dormir: a trava de "acordado" só liga para imprimir (com prazo).
- O Bluetooth abre para imprimir e fecha logo depois.
- Impressora desligada: tenta de novo em 15 s, 30 s, 1 min, 2 min e depois de 5 em 5 min.
- Sem internet: espera a rede voltar (o Android avisa o app).
- Um alarme leve de 15 em 15 min confere se está tudo vivo. Ao ligar o celular, a ponte volta sozinha.

Sem nenhuma biblioteca de fora: só Android e Kotlin.

## Assinatura

- A chave definitiva fica em `android/assinatura/ponte.jks.enc`, cifrada com uma senha tirada do segredo
  `PONTE_SENHA` do GitHub. Ela nasce na primeira compilação com o segredo, **na branch `app-impressora`**,
  e depois vai junto para a `rota-cloudflare`. Nunca compile as duas ao mesmo tempo antes do `.enc` existir.
- Com a chave definitiva, cada APK novo instala **por cima** do anterior, sem desinstalar e sem perder a ligação com a loja.
- Se o `PONTE_SENHA` mudar, a chave não abre: o app novo exigiria desinstalar o antigo. Guarde o segredo.
