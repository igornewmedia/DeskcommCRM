---
impacto: capacidade_nova
secao: adicionado
titulo: Cada empresa escolhe se a IA vende com ou sem controle de estoque
---

No topo da tela Produtos há uma escolha nova, "Como a IA trata o estoque". Em "Vender somente com estoque" (o padrão, e o comportamento de antes), a IA só oferece o produto ativo com quantidade maior que zero, ou marcado sem controle de estoque. Em "Vender sem controle de estoque", todo produto ativo do catálogo está disponível e a quantidade é ignorada: é para quem revende de fornecedor e sincroniza o catálogo sem informar estoque. Só gerente ou administrador muda. Nos dois modos a IA não diz ao cliente quantas unidades há.

Na API, `GET /api/v1/products` passa a trazer `disponivel` em cada produto, e `POST`/`PUT` sem `controla_estoque` seguem o modo da empresa. A página Administração › Endpoints mostra o campo nos exemplos.

Nenhuma ação é necessária na atualização.
