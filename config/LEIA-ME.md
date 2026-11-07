# Ficha da loja

Tudo o que muda de uma loja para outra fica em `config/loja.js`:

- **pessoas**: quem entra no portal (e-mail, nome, papel: admin / vendedor / tecnico).
- **vendas**: metas do mês, faixas de comissão de iPhone e acessórios, prêmios, produtos que não contam como acessório.
- **assistencia**: faixas de comissão do técnico, meta, valor mínimo da OS.
- **mercadophone**: unidades da loja e os filtros do estoque.

O código (portal, funções e serviço de avisos) lê tudo daqui. Depois de mudar a ficha:
1. Publicar no GitHub (o portal atualiza sozinho).
2. Gerar e publicar o serviço de avisos: `node workers/build.mjs` e enviar `workers/dist/avisos.js` ao Cloudflare.

Outros arquivos da loja: `escala.json` (turnos), `manutencao.json`, `taxas.json`, `avaliacao.json`, `docs/` (termos) e a logo.
