// Campos opcionais do cadastro de produto que a plataforma liga/desliga por loja.
// CÓPIA de CAMPOS_PRODUTO em js/cadastro-lib.js (o painel usa aquela; um teste confere que são iguais).
const CAMPOS_PRODUTO = {
  oferta: 'Preço de oferta (riscado)',
  estoque: 'Quantidade em estoque',
  pacote: 'Pacote fechado e "leve X por R$"',
  pesoMedio: 'Peso médio da unidade (produto por quilo)',
  selos: 'Selos (Chegou hoje, Da estação, Escolha da casa)',
  descricao: 'Descrição',
  insumo: 'Só ingrediente (fora da loja)',
  duracao: 'Quanto tempo dura na banca',
  rotulo: 'Rótulo adesivo',
  montar: 'Montar pedido (complementos e adicionais)',
};
module.exports = { CAMPOS_PRODUTO };
