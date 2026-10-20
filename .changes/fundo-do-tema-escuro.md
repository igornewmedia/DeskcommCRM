---
impacto: capacidade_nova
secao: adicionado
titulo: O fundo do tema escuro pode ser escolhido na tela de Marca
---

Em Administração › Marca há um campo novo, "Cor de fundo no tema escuro". Cartões, painéis e bordas do modo escuro acompanham o fundo escolhido, e um fundo claro demais, que deixaria o texto ilegível, é recusado com aviso no próprio campo. Em branco, o modo escuro continua com o fundo de antes. A atualização acrescenta uma coluna opcional em `platform_branding` pelo `baseline.sql`, aplicado pelo `update.sh` como sempre, e não exige nenhuma ação de quem opera a instalação.
