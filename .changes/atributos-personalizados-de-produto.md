---
impacto: capacidade_nova
secao: adicionado
titulo: Atributos personalizados de produto, que a IA lê e filtra
---

Cada empresa pode definir as suas próprias informações de produto em **Produtos › Atributos dos produtos**, como "Pronta entrega" (sim ou não), "Preço no cartão" (valor em dinheiro) ou "Versão" (lista de opções), até 30 por empresa. Os atributos aparecem no cadastro e na edição do produto e são aceitos pela API (`atributos` no `POST`, `PUT`, `PATCH` e `GET /api/v1/products`). O valor é conferido contra o tipo definido, e o `PATCH` muda só as chaves enviadas. O atendente de IA recebe os atributos visíveis já formatados na busca do catálogo, entende o significado pela descrição de cada um e pode filtrar por eles (por exemplo, só a pronta entrega). A busca do catálogo passa também a considerar a cor do produto. Só gerente ou administrador define os atributos.

Nenhuma ação é necessária na atualização: sem atributos definidos, o cadastro e a IA funcionam como antes.
