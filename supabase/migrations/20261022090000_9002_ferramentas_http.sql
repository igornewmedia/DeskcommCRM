-- manifest: ferramentas HTTP dos agentes — cadastro da organização (ai_http_tools, segredo cifrado fora do alcance do browser) e histórico das execuções (ai_http_tool_runs), RLS manager+
--
-- Duas tabelas: o CADASTRO da ferramenta (biblioteca da organização, que vários
-- agentes reaproveitam pondo `http:<id>` em `ai_agent_versions.tool_ids`) e o
-- HISTÓRICO das execuções. Plano em
-- docs/superpowers/plans/2026-10-19-ferramentas-http-dos-agentes.md.
--
-- O segredo (API Key, Bearer, usuário:senha do Basic) vive cifrado com
-- `AI_CRED_AES_KEY` (lib/crypto/aes_gcm.ts) e NÃO chega ao browser nem pela
-- REST: `authenticated` só recebe SELECT nas colunas sem segredo, e escrita é
-- só pela rota (service role, depois de RBAC). As duas policies repetem o gate
-- de papel (`manager`) na camada que sobrevive a uma rota nova.
--
-- O histórico guarda os NOMES dos parâmetros, nunca os valores: o valor é dado
-- do cliente, e a tabela não precisa entrar na cascata de anonimização.
-- Nenhuma função nova em `public` ⇒ nenhuma superfície `security definer` nova.

create table if not exists public.ai_http_tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null,
  is_active boolean not null default true,
  method text not null default 'POST',
  url text not null,
  headers jsonb not null default '{}'::jsonb,
  query jsonb not null default '{}'::jsonb,
  body_template jsonb,
  parameters jsonb not null default '[]'::jsonb,
  response_map jsonb,
  response_instructions text,
  auth_type text not null default 'none',
  auth_header_name text,
  secret_encrypted bytea,
  secret_iv bytea,
  secret_tag bytea,
  secret_last4 text,
  effect text not null default 'consulta',
  requires_confirmation boolean not null default false,
  safe_to_retry boolean not null default false,
  timeout_ms integer not null default 10000,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ai_http_tools_slug_valido check (slug ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint ai_http_tools_name_tamanho check (char_length(name) between 1 and 120),
  constraint ai_http_tools_description_tamanho check (char_length(description) between 1 and 1024),
  constraint ai_http_tools_url_tamanho check (char_length(url) between 8 and 2048),
  constraint ai_http_tools_instructions_tamanho
    check (response_instructions is null or char_length(response_instructions) <= 2000),
  constraint ai_http_tools_method_check
    check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  constraint ai_http_tools_auth_type_check
    check (auth_type in ('none', 'api_key', 'bearer', 'basic')),
  constraint ai_http_tools_effect_check
    check (effect in ('consulta', 'acao')),
  constraint ai_http_tools_timeout_valido check (timeout_ms between 1000 and 30000),
  constraint ai_http_tools_jsonb_formato check (
    jsonb_typeof(headers) = 'object'
    and jsonb_typeof(query) = 'object'
    and jsonb_typeof(parameters) = 'array'
    and (response_map is null or jsonb_typeof(response_map) = 'object')
  ),
  -- As três peças da cifra andam juntas: nunca meia chave gravada.
  constraint ai_http_tools_segredo_inteiro check (
    (secret_encrypted is null) = (secret_iv is null)
    and (secret_iv is null) = (secret_tag is null)
  ),
  -- Sem autenticação não há segredo; API Key precisa dizer em que cabeçalho vai.
  constraint ai_http_tools_segredo_coerente check (
    (auth_type <> 'none' or secret_encrypted is null)
    and (auth_type <> 'api_key' or auth_header_name is not null)
  )
);

-- Nome único entre as que não foram excluídas: excluir é lógico (o histórico
-- continua apontando), e o nome de uma excluída volta a ficar livre.
create unique index if not exists ai_http_tools_slug_uk
  on public.ai_http_tools (organization_id, slug)
  where deleted_at is null;

create index if not exists ai_http_tools_org_idx
  on public.ai_http_tools (organization_id)
  where deleted_at is null;

alter table public.ai_http_tools enable row level security;

drop policy if exists tenant_isolation_ai_http_tools_all on public.ai_http_tools;
create policy tenant_isolation_ai_http_tools_all on public.ai_http_tools
  for all
  using (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  )
  with check (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  );

-- O ALTER DEFAULT PRIVILEGES deste baseline dá GRANT ALL em TABLES a `anon` e
-- `authenticated`: toda tabela nova nasce exposta e revoga por conta própria.
revoke all on public.ai_http_tools from anon, authenticated;
grant select (
  id, organization_id, slug, name, description, is_active, method, url, headers,
  query, body_template, parameters, response_map, response_instructions,
  auth_type, auth_header_name, secret_last4, effect, requires_confirmation,
  safe_to_retry, timeout_ms, created_by, updated_by, created_at, updated_at,
  deleted_at
) on public.ai_http_tools to authenticated;

drop trigger if exists trg_ai_http_tools_updated_at on public.ai_http_tools;
create trigger trg_ai_http_tools_updated_at
  before update on public.ai_http_tools
  for each row execute function public.fn_set_updated_at();

-- `fn_audit_log_row` grava ação, recurso e id — nunca o conteúdo da linha, então
-- o segredo cifrado não passa para a auditoria.
drop trigger if exists trg_ai_http_tools_audit on public.ai_http_tools;
create trigger trg_ai_http_tools_audit
  after insert or update or delete on public.ai_http_tools
  for each row execute function public.fn_audit_log_row();

comment on table public.ai_http_tools is
  'Ferramenta HTTP que o agente de IA chama durante a conversa (9002). Vínculo ao agente: `http:<id>` em ai_agent_versions.tool_ids. O segredo é cifrado (AI_CRED_AES_KEY) e authenticated não tem SELECT nas colunas secret_encrypted/iv/tag.';
comment on column public.ai_http_tools.slug is
  'Nome que o modelo vê como nome da tool. Único na organização entre as não excluídas.';
comment on column public.ai_http_tools.effect is
  'consulta = só lê; acao = muda algo no sistema de fora e segue a regra de escrita do turno. Declarado por quem administra. Vocabulário em EFEITOS_DA_FERRAMENTA (lib/ferramentas-http/vocabulario.ts).';
comment on column public.ai_http_tools.parameters is
  'Lista de {name, type, required, description, format?, enum?} que a IA preenche. Vira JSON Schema da tool. Schema central em lib/ferramentas-http/schema.ts.';
comment on column public.ai_http_tools.deleted_at is
  'Exclusão lógica: preserva o histórico em ai_http_tool_runs. Não nulo = fora da tela e de todo turno.';

create table if not exists public.ai_http_tool_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tool_id uuid not null references public.ai_http_tools(id) on delete cascade,
  agent_id uuid references public.ai_agents(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  job_id text,
  origin text not null,
  status text not null,
  http_status integer,
  duration_ms integer not null default 0,
  attempts integer not null default 1,
  param_names text[] not null default '{}',
  args_hash text,
  response_bytes integer,
  error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ai_http_tool_runs_origin_check check (origin in ('turno', 'teste')),
  constraint ai_http_tool_runs_status_check check (status in (
    'sucesso', 'erro_http', 'timeout', 'falha_conexao', 'bloqueado',
    'parametros_invalidos', 'resposta_invalida', 'aguardando_confirmacao',
    'limite_excedido'
  )),
  constraint ai_http_tool_runs_numeros_validos check (
    duration_ms >= 0 and attempts between 1 and 5
    and (http_status is null or http_status between 100 and 599)
    and (response_bytes is null or response_bytes >= 0)
  ),
  constraint ai_http_tool_runs_error_code_tamanho
    check (error_code is null or char_length(error_code) <= 120)
);

create index if not exists ai_http_tool_runs_org_created_idx
  on public.ai_http_tool_runs (organization_id, created_at desc);
create index if not exists ai_http_tool_runs_tool_created_idx
  on public.ai_http_tool_runs (tool_id, created_at desc);
create index if not exists ai_http_tool_runs_agent_idx
  on public.ai_http_tool_runs (agent_id)
  where agent_id is not null;
create index if not exists ai_http_tool_runs_conversation_idx
  on public.ai_http_tool_runs (conversation_id)
  where conversation_id is not null;
-- A confirmação em duas fases procura o pedido pendente pelos mesmos valores.
create index if not exists ai_http_tool_runs_confirmacao_idx
  on public.ai_http_tool_runs (tool_id, conversation_id, args_hash, created_at desc)
  where args_hash is not null;

alter table public.ai_http_tool_runs enable row level security;

drop policy if exists tenant_isolation_ai_http_tool_runs_all on public.ai_http_tool_runs;
create policy tenant_isolation_ai_http_tool_runs_all on public.ai_http_tool_runs
  for all
  using (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  )
  with check (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  );

-- Histórico é escrito pelo executor (service role); quem está logado só lê.
revoke all on public.ai_http_tool_runs from anon, authenticated;
grant select on public.ai_http_tool_runs to authenticated;
revoke update on public.ai_http_tool_runs from service_role;

comment on table public.ai_http_tool_runs is
  'Uma linha por chamada de ferramenta HTTP (turno ou botão Testar), 9002. Guarda os NOMES dos parâmetros, nunca valores, corpo ou segredo. Sem UPDATE para service_role: o histórico só cresce (a poda é DELETE por idade).';
comment on column public.ai_http_tool_runs.args_hash is
  'sha256 dos valores enviados, só em ferramenta que exige confirmação: é como a segunda chamada prova que pede EXATAMENTE o que o cliente confirmou. Não guarda o valor.';
comment on column public.ai_http_tool_runs.status is
  'Vocabulário em STATUS_DA_EXECUCAO (lib/ferramentas-http/vocabulario.ts).';
