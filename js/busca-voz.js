// =====================================================================
//  /js/busca-voz.js  —  Busca por voz (ARQUIVO NOVO)
//
//  POR QUE ESTE ARQUIVO EXISTE:
//  Este código estava escrito solto dentro do index.html, num
//  <script> inline. Funcionava, mas impedia ativar uma proteção
//  importante: a Content-Security-Policy (CSP).
//
//  A CSP é uma regra que o site manda para o navegador dizendo
//  "só execute código que venha dos MEUS arquivos". É a última linha
//  de defesa contra XSS: se algum dia um texto malicioso escapar do
//  escape de HTML, a CSP impede que ele rode.
//
//  O problema é que o navegador não consegue distinguir um script
//  inline legítimo de um injetado por um atacante — os dois estão
//  soltos no HTML do mesmo jeito. Então, para a CSP poder ser
//  estrita, todo o JavaScript precisa morar em arquivos próprios.
//  Foi só isso que mudou aqui: o código é o mesmo, agora num arquivo.
//
//  Onde entra no HTML (já ajustado no index.html):
//      <script type="module" src="./js/busca-voz.js"></script>
// =====================================================================

const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
const botao = document.getElementById('btn-voz');
const campo = document.getElementById('busca-input');

// Sem suporte do navegador (ou sem os elementos): o botão fica oculto.
if (Reconhecimento && botao && campo) {
  botao.hidden = false;

  const rec = new Reconhecimento();
  rec.lang = 'pt-BR';
  rec.continuous = false;
  rec.interimResults = false;

  let ouvindo = false;

  botao.addEventListener('click', () => {
    if (ouvindo) { rec.stop(); return; }
    try { rec.start(); } catch (e) { /* já iniciado: ignora */ }
  });

  rec.onstart = () => { ouvindo = true; botao.classList.add('gravando'); };
  rec.onend = () => { ouvindo = false; botao.classList.remove('gravando'); };
  rec.onerror = () => { ouvindo = false; botao.classList.remove('gravando'); };

  rec.onresult = (evento) => {
    const texto = evento.results[0][0].transcript;
    campo.value = texto;
    // Dispara a busca que já existe, como se a pessoa tivesse digitado
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  };
}
