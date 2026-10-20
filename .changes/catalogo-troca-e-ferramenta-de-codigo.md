---
impacto: capacidade_nova
secao: adicionado
titulo: Aparelhos na troca, cor e código automático no catálogo, ferramenta de código JavaScript e cadastro de produto por API
---

O catálogo de produtos ganhou o campo cor (opcional) e o código automático: o
produto cadastrado sem código recebe o próximo PRD-00001 da empresa. Em
Produtos › Aparelhos aceitos na troca dá para cadastrar os aparelhos usados que
a loja aceita como parte do pagamento, com modelo, capacidade e quanto cada um
abate. O atendente de IA consulta essa lista com a nova ferramenta «Consultar
aparelhos aceitos na troca» e passa a ver também a cor e a categoria dos
produtos.

Em IA › Ferramentas, «Nova ferramenta de código» cadastra um trecho de
JavaScript que o agente roda com os valores que ele enviar — por exemplo, o
cálculo de entrada + parcelamento. O código roda isolado no servidor, sem
internet, arquivos ou segredos, com até 2 segundos e 16 MB.

Sistemas externos cadastram e listam produtos em `/api/v1/products` com um
token de API (`Authorization: Bearer dsk_…`), e o super admin vê os endpoints
disponíveis, com exemplo, em Admin › Endpoints. A atualização cria uma tabela,
duas colunas e não pede nenhuma ação de quem opera a instalação.
