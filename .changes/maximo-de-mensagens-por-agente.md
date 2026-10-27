---
impacto: capacidade_nova
secao: adicionado
titulo: Cada agente de IA escolhe quantas mensagens manda numa resposta
---

Novo campo "Máximo de mensagens por resposta" (1 a 10) na aba Configuração do agente, no card "Estilo de resposta". Antes o teto era um só para a instalação inteira (`MAX_SENDS_PER_TURN`, padrão 3) e só mudava editando o `.env` da VPS. As partes da resposta que passarem do limite vão juntas na última mensagem. Vale também na aba Teste. Deixar vazio mantém o padrão da instalação, que é o que todos os agentes existentes continuam usando.

Nenhuma ação é necessária na atualização.
