# Ferramentas HTTP dos agentes — plano (aguardando aprovação)

> Status: **planejamento**. Nada implementado. Data: 2026-10-19.
> Pedido: Tools HTTP/Webhook no estilo do nó AI Agent do n8n, sem depender do n8n.

## 1. Diagnóstico — o que já existe

| Peça | Onde | Serve para a feature? |
|---|---|---|
| Turno do agente (WhatsApp) | `lib/agent-engine/agent/inbound-turn.ts`, chamado pelo `workers/agent-worker` | Sim: já é loop de tool calling (AI SDK `ai` v6, `tool()`, `maxSteps` por versão) |
| Ferramentas da tela entrando no turno | `lib/agent-engine/edge/crm/mcp-tools.ts` → `pickToolsFromMcp` (`lib/ai/runtime/tools.ts`) | **Ponto de encaixe.** Toda tool passa por `wrapMcpTool`: auditoria (`auditMcpToolCall` → `api_audit_log`), papel, escopo, erro vira texto e não derruba o turno |
| Precedente quase idêntico: servidor MCP externo (#2147) | `lib/mcp/servidor-externo/*` + `lib/mcp/tools/externo.ts` | **Molde a copiar.** Ids prefixados em `tool_ids` (`mcp_externo:leitura:<nome>`), chave cifrada, marca leitura/escrita dada pelo admin, falha do terceiro vira "sem ferramenta" |
| Anti-SSRF completo | `fetchDeSaida` em `lib/mcp/servidor-externo/chamada.ts` (usa `assertSafeOutboundUrl` + `assertDestinoResolvidoSeguro` + `allowlistedFetch` com `redirect: "manual"`) | Reuso direto, sem escrever guard novo |
| Criptografia | `lib/crypto/aes_gcm.ts` (`AI_CRED_AES_KEY`), colunas `*_encrypted/_iv/_tag/_last4` | Reuso direto (mesmo padrão de `segredo.ts`) |
| Dado de fora como NÃO confiável | `AVISO_DADOS_NAO_CONFIAVEIS` em `lib/mcp/tools/dados-externos.ts` | Reuso do mesmo envelope |
| Agente versionado | `ai_agents` + `ai_agent_versions.tool_ids` (rascunho → publicar); validação em `lib/ai/agents/validation.ts`, `_actions.ts` e `publish/route.ts` via `ehToolIdRemoto` | Vincular ferramenta = id prefixado em `tool_ids`. Reusa versão, diff e publicação |
| Tela do agente | `app/app/ai/agents/[id]/` (`AgentForm`, `ToolPicker`, `TestPanel`, `RunTrace`, `RunsTable`) | Seção nova ao lado do `ToolPicker`; teste e histórico reaproveitam `RunTrace`/`RunsTable` |
| Auth/RBAC | `requireAuth` + `resolveActiveOrg`; editor de agente já exige `manager` | Mesmo gate |
| Contexto da conversa | histórico por janela (`history_message_window`/`token_window`) + compaction no engine | Resultado da tool entra como tool-result no próprio turno; nada novo |

**Conclusão:** tool calling, auditoria, anti-SSRF e cifra já existem. Falta só o **cadastro** da ferramenta HTTP, o **executor** e a **tela**.

## 2. Abordagem

1. **Núcleo, desligado por padrão.** A régua de extensões responde "a operação comum continua sem isto?" — sim, mas o contrato de extensão atual não permite tabela, código nem ferramenta de IA, e a peça toca egress, cifra e o turno (infra de segurança). Zero ferramentas = turno idêntico ao de hoje (`buildMcpTurnTools` não carrega nada, sem banco extra além de 1 select, sem rede).
2. **Biblioteca da organização + vínculo por versão.** A ferramenta vive numa tabela própria (reaproveitável); o agente a escolhe pondo `http:<uuid>` em `tool_ids` da versão. Sem tabela de junção: publicar, desfazer e diff já funcionam.
3. **Mesmo caminho das outras tools.** A ferramenta HTTP vira `McpToolDefinition` montada por `wrapMcpTool` — sem porta dos fundos.
4. **Consulta × Ação.** O admin marca o efeito. `consulta` passa em turno de conversa; `acao` segue a regra de escopo de escrita do turno e, se marcada `requer_confirmacao`, só executa em duas fases (ver §5).
5. **Retentativa só segura:** GET/PUT/DELETE, ou POST/PATCH marcado "seguro repetir" (vai com `Idempotency-Key`). Só em falha de conexão, 429 e 5xx. Máx. 2 tentativas extras.

## 3. Arquivos

**Novos**
1. `lib/ferramentas-http/` — `schema.ts` (Zod da ferramenta e dos parâmetros → JSON Schema), `montar-requisicao.ts` (template `{{param}}`, montagem estrutural do body), `executar.ts` (fetch via `fetchDeSaida`, timeout, teto de bytes, retentativa, mapeamento), `segredo.ts`, `carregar.ts` (lê as escolhidas do agente para o turno), `ids.ts` (`http:<uuid>`).
2. `lib/mcp/tools/ferramenta-http.ts` — converte ferramenta → `McpToolDefinition`.
3. `app/api/v1/ai/http-tools/route.ts` (GET/POST), `[id]/route.ts` (PATCH/DELETE), `[id]/test/route.ts` (POST), `runs/route.ts` (GET).
4. `app/app/ai/ferramentas/page.tsx` (biblioteca + histórico) e `app/app/ai/agents/[id]/_components/FerramentasHttp.tsx` (seção no editor, com criar/editar/testar inline).
5. Migration `supabase/migrations/<ts>_<NNNN>_ferramentas_http.sql` + apêndice no `baseline.sql`; fragmento em `.changes/`; spec e2e `tests/e2e/ferramentas-http.spec.ts`; invariante RLS em `tests/invariants/`.

**Alterados**
1. `lib/agent-engine/edge/crm/mcp-tools.ts` e `lib/ai/runtime/tools.ts` — carregar e montar as HTTP.
2. `lib/ai/agents/validation.ts`, `app/app/ai/agents/[id]/_actions.ts`, `app/api/v1/ai/agents/[id]/publish/route.ts` — aceitar o prefixo `http:`.
3. `app/app/ai/agents/[id]/_components/AgentForm.tsx` — seção "Ferramentas".
4. `lib/navigation/catalogo.ts` — porta para `/app/ai/ferramentas`.
5. `lib/auth/public-paths.ts` — nada (rotas só cookie). `app/api/v1/cron/data-retention` — poda do histórico.

## 4. Banco (uma migration, idempotente, + apêndice)

**`ai_http_tools`**
- `id`, `organization_id` (FK cascade), `slug` (nome para o modelo, `^[a-z][a-z0-9_]{2,63}$`, único por org entre não excluídas), `name`, `description`, `is_active`
- `method` text + check (`GET|POST|PUT|PATCH|DELETE`), `url`, `headers` jsonb (não secretos), `query` jsonb, `body_template` jsonb
- `parameters` jsonb (ver §6), `response_map` jsonb, `response_instructions` text
- `auth_type` check (`none|api_key|bearer|basic`), `auth_header_name` (API Key vai em header, nunca em query), `secret_encrypted/_iv/_tag/_last4`
- `effect` check (`consulta|acao`), `requires_confirmation`, `safe_to_retry`, `timeout_ms` check 1000–30000 (padrão 10000)
- `created_by`/`updated_by` (FK users), `created_at`, `updated_at`, `deleted_at` (excluir é lógico: o histórico continua lendo)

**`ai_http_tool_runs`** (histórico)
- `id`, `organization_id`, `tool_id` FK, `agent_id` FK nullable, `conversation_id` FK nullable (`on delete set null`), `job_id`
- `origin` check (`turno|teste`), `status` check (`sucesso|erro_http|timeout|falha_conexao|bloqueado|parametros_invalidos|resposta_invalida|aguardando_confirmacao|limite_excedido`)
- `http_status`, `duration_ms`, `attempts`, `param_names` text[] (**só os nomes**, nunca valores — é dado do cliente), `response_bytes`, `error_code`, `created_at`

**Regras:** RLS `tenant_isolation_<tabela>_all` via `fn_user_org_ids()` nas duas; `revoke select (secret_*)` de `anon, authenticated` (a chave não chega ao browser nem por REST); índices `(organization_id, created_at desc)` e `(tool_id, created_at desc)`; mutações auditadas em `api_audit_log` (`ai_http_tool.created|updated|deleted|tested`).

## 5. Fluxo de uma chamada

1. **Turno começa** → `buildMcpTurnTools` lê `tool_ids` com prefixo `http:`, carrega só as ativas da organização do job (nunca do payload).
2. **Montagem** → cada ferramenta vira tool do AI SDK com `description` + JSON Schema dos parâmetros. O modelo decide chamar; se falta obrigatório, a descrição manda perguntar ao cliente.
3. **Chamada** → Zod valida os args contra o schema (`parametros_invalidos` volta ao modelo como texto). Limite por turno: 5 por ferramenta, 10 no total.
4. **Ação com confirmação** → 1ª chamada **não** sai para a rede: grava `aguardando_confirmacao` com hash dos args e devolve "peça confirmação ao cliente com este resumo". Só executa numa chamada com os **mesmos args** num turno seguinte (houve mensagem do cliente no meio), em até 30 min.
5. **Requisição** → monta URL/query/headers/body por substituição estrutural (valor de path com `encodeURIComponent`, body montado como objeto, nunca concatenação de string); abre o segredo só aqui; `fetchDeSaida` (SSRF + DNS + redirect manual) com `AbortSignal.timeout`.
6. **Resposta** → lê até 256 KB (corta o resto); JSON → aplica `response_map` se houver; vazia/inválida/erro → resultado estruturado `{ ok:false, motivo }` com instrução "não invente dado; diga que não conseguiu consultar".
7. **Ao modelo** → envelope `{ ok, status, dados (≤ 8 KB) }` + `AVISO_DADOS_NAO_CONFIAVEIS` + `response_instructions`. O modelo responde em linguagem natural.
8. **Registro** → 1 linha em `ai_http_tool_runs` + auditoria do `wrapMcpTool`. Segredo e valores nunca entram em log.

## 6. Schema de uma ferramenta (exemplo)

```json
{
  "slug": "consultar_horarios",
  "name": "Consultar horários",
  "description": "Consulta horários livres de um procedimento numa data.",
  "method": "POST",
  "url": "https://exemplo.com/webhook/horarios",
  "headers": { "Content-Type": "application/json" },
  "query": {},
  "body_template": { "data": "{{data}}", "procedimento": "{{procedimento}}", "profissional": "{{profissional}}" },
  "parameters": [
    { "name": "data", "type": "string", "format": "date", "required": true, "description": "Data desejada (AAAA-MM-DD)" },
    { "name": "procedimento", "type": "string", "required": true, "description": "Nome do procedimento" },
    { "name": "profissional", "type": "string", "required": false, "description": "Profissional preferido" }
  ],
  "auth": { "type": "bearer" },
  "effect": "consulta",
  "requires_confirmation": false,
  "safe_to_retry": true,
  "timeout_ms": 10000,
  "response_map": { "horarios": "$.data.slots" },
  "response_instructions": "Ofereça no máximo 3 horários."
}
```

Tipos de parâmetro: `string` (com `format` date/date-time/email opcional), `number`, `integer`, `boolean`, `enum`. Sem objetos aninhados na v1. Vira JSON Schema `{ type: "object", properties, required, additionalProperties: false }`, aceito por Anthropic, OpenAI e Google.

## 7. Etapas (cada uma = 1 commit, testável sozinha)

1. **Banco + tipos** — migration, apêndice, RLS, revoke das colunas secretas, invariante de isolamento 2 orgs (`pnpm test:db`). ~3 h
2. **Executor puro** — `lib/ferramentas-http/` com testes unitários: template, validação, timeout, teto de bytes, retentativa, mapeamento, SSRF (receiver real em teste). ~5 h
3. **API CRUD + Testar + histórico** — rotas com `manager+`, Zod, audit, `requireSupportWrite`, rate limit no `:test`. ~4 h
4. **Turno** — prefixo `http:` nos 3 validadores, carga no `mcp-tools.ts`, confirmação em 2 fases, limites por turno. Teste em par (tela pelo agente + ferramenta direta). ~5 h
5. **Tela** — seção no editor, biblioteca `/app/ai/ferramentas`, painel Testar, histórico; porta no `NAV_CATALOG`. ~6 h
6. **Prova** — e2e pela tela em banco fresco (baseline + bootstrap), webhook receiver real, evidência em `evidence/ferramentas-http/`; fragmento `.changes/` (`capacidade_nova`); mapa em `docs/architecture/`. ~3 h

Total: ~26 h de trabalho (3–4 dias).

## 8. Riscos

1. **Seu dev local é LAN (192.168.1.12).** O anti-SSRF recusa IP privado — um webhook do n8n na sua rede vai ser bloqueado. Decisão sua: (a) testar com URL pública (ngrok/n8n cloud), ou (b) knob `HTTP_TOOLS_ALLOW_PRIVATE_HOSTS` que só vale fora de produção.
2. **Escopo de escrita do turno.** Hoje escrita em turno com contato é recusada (`escrita_sem_escopo_do_turno`). Ferramenta `acao` precisa entrar nessa regra sem furá-la — ponto mais delicado da etapa 4.
3. **Teto de 27 tools por agente** (`TETO_TOOLS_POR_AGENTE`). As HTTP contam nele; mais tools = mais tokens por turno e custo.
4. **Prompt injection pela resposta.** Mitigado com envelope + aviso + teto de bytes, não eliminado. Ferramenta `acao` com confirmação é a defesa real contra efeito indevido.
5. **Janela de DNS rebinding** residual, já declarada em `outbound-ip.ts` (o mesmo risco aceito nos webhooks de saída).

## Fora da v1 (adiado de propósito)

- Parâmetros aninhados (objeto/array), OAuth2, upload de arquivo, resposta não-JSON além de texto puro.
- Ferramentas HTTP no papel Operador (só Conversador na v1).
