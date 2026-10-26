---
impacto: capacidade_nova
secao: adicionado
titulo: Sistemas externos podem editar e remover produtos do catálogo pela API
---

`PUT`, `PATCH` e `DELETE /api/v1/products/:id` passam a aceitar token de API (`Authorization: Bearer dsk_…`), além do login pela tela, como o cadastro (`POST`) e a consulta (`GET`) já aceitavam. É o que uma automação precisa para manter o catálogo igual ao do fornecedor: consulta a lista, atualiza o que mudou, cadastra o que é novo e remove o que saiu. O `PUT` substitui o produto inteiro (campos opcionais ausentes ficam vazios; o código, se não vier, é mantido), e o `PATCH` muda só o que veio. Editar e remover pedem o escopo `mcp:write` e papel de gerente, e cada operação fica na auditoria com o token que a fez. Os três aparecem, com exemplo, na tela Administração › Endpoints.

Correção junto: mudar só um campo de um produto (pela tela de edição, pelo botão de desativar ou pela API) zerava a quantidade em estoque e reativava o produto. Agora os campos que não vêm na edição ficam como estavam.

Nenhuma ação é necessária na atualização.
