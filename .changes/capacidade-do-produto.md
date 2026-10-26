---
impacto: capacidade_nova
secao: adicionado
titulo: Capacidade do produto no catálogo
---

O cadastro de produtos ganhou o campo Capacidade (opcional, até 60 caracteres:
128GB, 1TB, 500ml), logo depois de Cor, na criação e na edição. A lista mostra a
capacidade junto da cor, a API de produtos aceita e devolve `capacidade`, e a
importação por planilha lê a coluna «capacidade» quando ela existe. O atendente
de IA vê a capacidade na busca de produtos e acha o produto de 256GB mesmo
quando o nome não repete a capacidade. Nenhum produto já cadastrado muda.
