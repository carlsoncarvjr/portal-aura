// Ficha da loja. Tudo o que é específico da Aura fica aqui; o resto do código é igual para qualquer loja.
// Para outra loja: copiar este arquivo, trocar os dados e publicar.
export default {
  id: 'aura',
  nome: 'Aura',
  instagram: 'somosaura.ps',
  fuso: 'America/Bahia',

  // Quem entra no portal. papel: admin (dono/gerente), vendedor ou tecnico. arq: nome do arquivo de comissão do vendedor.
  pessoas: [
    { email: 'carlsoncarvjr@gmail.com', nome: 'Carlson', papel: 'admin' },
    { email: 'guadariachi0@gmail.com', nome: 'Guadalupe', papel: 'admin' },
    { email: 'maikobarreto16@gmail.com', nome: 'Maiko', papel: 'tecnico' },
    { email: 'gusthavowork@gmail.com', nome: 'Gustavo', papel: 'vendedor', arq: 'gustavo' },
    { email: 'elisaprettiferrer@icloud.com', nome: 'Elisa', papel: 'vendedor', arq: 'elisa' },
    { email: 'danilosilvaobl@gmail.com', nome: 'Danilo', papel: 'vendedor', arq: 'danilo' },
  ],

  // Vendas e comissão dos vendedores (tabela do mês).
  vendas: {
    excluidos: ['JBL', 'IPAD', 'MACBOOK', 'MAC ', 'WATCH', 'SERVICO', 'SERVIÇO'],   // não contam como acessório
    metaIphones: 110,
    metaAcessorios: 26000,
    faixasIphone: [[12, 16, 10], [17, 24, 15], [25, 28, 20], [29, 32, 25], [33, 36, 30], [37, 42, 35], [43, 1e6, 40]],   // [de, até, R$ por iPhone]
    faixasAcessorios: [[3000, 4499.99, 3.0], [4500, 6499.99, 5.0], [6500, 9999.99, 7.5], [10000, 14499.99, 10.0], [14500, 1e12, 12.5]],   // [de, até, %]
    premios: { metaIphones: 100, metaAcessorios: 100, melhorVendedor: 100 },
  },

  // Assistência técnica (comissão do técnico).
  assistencia: {
    faixas: [[1, 6, 25], [7, 12, 30], [13, 19, 35], [20, 1e6, 40]],   // [da OS nº, até, %]
    meta: 15,
    valorMinimo: 150,
    garantia30: ['2026-11', '2026-12'],   // meses em que vale o mínimo de 30% do lucro
  },

  // Cloudflare: conta e regra de login (Access) que o Painel do dono mantém igual à lista da equipe.
  // Precisa do segredo CF_ACCESS_TOKEN no projeto do portal (Pages).
  cloudflare: {
    conta: '8c1e47ac6af3ec3ce55411195ae36a9f',
    politicaAcesso: '8a3e874b-75ad-44a9-807b-85af32f00476',
  },

  // MercadoPhone: unidades e filtros do estoque.
  mercadophone: {
    unidades: [
      { chave: 'meu', rotulo: 'Meu iPhone', soConferido: true },   // só "Em estoque (conferido)"
      { chave: 'riachi', rotulo: 'Riachi', nomeContem: 'riachi' },
    ],
    disponibilidadeConferido: 62709,
    tipoCelular: 6235,
  },
};
