---
impacto: capacidade_nova
secao: adicionado
titulo: Ferramentas HTTP: o agente consulta e aciona outros sistemas durante a conversa
---

Em IA › Ferramentas (e na seção Ferramentas de cada agente) dá para cadastrar
um endereço de outro sistema — um webhook, a API da agenda, do estoque, dos
pedidos — com método, cabeçalhos, parâmetros de URL, corpo, autenticação
(nenhuma, API Key, Bearer ou Basic) e tempo máximo de espera. Os parâmetros que
a IA preenche durante a conversa são declarados com tipo, obrigatoriedade e
descrição; faltando um obrigatório, o agente pergunta ao cliente. A mesma
ferramenta serve a vários agentes, e cada agente liga as suas.

A chamada sai só do servidor, com proteção contra endereços internos, limite de
tamanho da resposta e de chamadas por atendimento. A credencial fica guardada
criptografada e não volta para a tela. Ferramenta que executa uma ação pode
exigir que o cliente confirme os valores antes. O botão «Testar ferramenta»
mostra o status, o tempo, o que foi enviado, o que voltou e o que o agente
receberia; o histórico guarda cada chamada sem os valores enviados. Agentes sem
ferramenta funcionam exatamente como antes. A atualização cria duas tabelas e
não pede nenhuma ação de quem opera a instalação.
