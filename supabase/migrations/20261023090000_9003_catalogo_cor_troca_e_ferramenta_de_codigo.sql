-- manifest: catálogo ganha cor e código automático (PRD-00001), catálogo de aparelhos aceitos na troca (catalog_trade_in_devices, RLS manager+ para escrita) e ferramenta de CÓDIGO JavaScript dos agentes (ai_http_tools.kind/code, status erro_codigo)
--
-- Três peças, uma migration, porque andam juntas no mesmo pedido (orçamento de
-- aparelho com troca e parcelamento):
--
--  1. `catalog_products.cor` (opcional) e o CÓDIGO AUTOMÁTICO: produto que chega
--     sem código (tela, API externa) recebe o próximo `PRD-NNNNN` da organização.
--     O trigger serializa por organização com advisory lock da transação, então
--     dois cadastros simultâneos não disputam o mesmo número. Quem manda código
--     continua mandando — a planilha reusa o código como identidade.
--  2. `catalog_trade_in_devices`: os aparelhos que a loja aceita como parte do
--     pagamento — modelo, capacidade e quanto abate. Molde de `catalog_products`
--     (0204/0553): leitura da organização, escrita de `manager` para cima.
--  3. Ferramenta de código: `ai_http_tools.kind = 'codigo'` com o JavaScript em
--     `code`. Roda isolada (QuickJS/WASM, lib/ferramentas-http/codigo.ts), sem
--     URL, credencial nem efeito — o CHECK cobra os três. O histórico ganha o
--     status `erro_codigo`.

-- ---- 1. cor e código automático ----
alter table public.catalog_products add column if not exists cor text;

alter table public.catalog_products drop constraint if exists catalog_products_cor_tamanho;
alter table public.catalog_products
  add constraint catalog_products_cor_tamanho check (cor is null or char_length(cor) <= 60);

comment on column public.catalog_products.cor is
  'Cor do produto (opcional, texto livre). Migration 9003.';

create or replace function public.fn_catalog_products_codigo_automatico()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    perform pg_advisory_xact_lock(hashtext('catalog_products_codigo:' || new.organization_id::text));
    select 'PRD-' || lpad((coalesce(max((substring(p.codigo from '^PRD-(\d{1,9})$'))::bigint), 0) + 1)::text, 5, '0')
      into new.codigo
      from public.catalog_products p
     where p.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_catalog_products_codigo_automatico() from public, anon;
grant  execute on function public.fn_catalog_products_codigo_automatico() to authenticated, service_role;

drop trigger if exists trg_catalog_products_codigo_automatico on public.catalog_products;
create trigger trg_catalog_products_codigo_automatico
  before insert on public.catalog_products
  for each row execute function public.fn_catalog_products_codigo_automatico();

-- ---- 2. aparelhos aceitos na troca ----
create table if not exists public.catalog_trade_in_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modelo text not null,
  capacidade text,
  -- Quanto o aparelho usado abate do preço do novo. `_cents` + `moeda`.
  abatimento_cents bigint not null,
  moeda text not null default 'BRL',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_trade_in_devices_modelo_tamanho check (char_length(btrim(modelo)) between 1 and 200),
  constraint catalog_trade_in_devices_capacidade_tamanho check (capacidade is null or char_length(capacidade) <= 60),
  constraint catalog_trade_in_devices_abatimento_nao_negativo check (abatimento_cents >= 0),
  constraint catalog_trade_in_devices_moeda_iso check (moeda ~ '^[A-Z]{3}$')
);

-- Um modelo + capacidade por organização: "iPhone 13 128GB" não entra duas vezes.
create unique index if not exists catalog_trade_in_devices_org_modelo_key
  on public.catalog_trade_in_devices (organization_id, lower(modelo), lower(coalesce(capacidade, '')));

create index if not exists catalog_trade_in_devices_org_ativos_idx
  on public.catalog_trade_in_devices (organization_id, ativo, modelo);

alter table public.catalog_trade_in_devices enable row level security;

drop policy if exists catalog_trade_in_devices_select on public.catalog_trade_in_devices;
create policy catalog_trade_in_devices_select on public.catalog_trade_in_devices
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

drop policy if exists catalog_trade_in_devices_insert on public.catalog_trade_in_devices;
create policy catalog_trade_in_devices_insert on public.catalog_trade_in_devices
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_trade_in_devices_write on public.catalog_trade_in_devices;
create policy catalog_trade_in_devices_write on public.catalog_trade_in_devices
  for update using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_trade_in_devices_delete on public.catalog_trade_in_devices;
create policy catalog_trade_in_devices_delete on public.catalog_trade_in_devices
  for delete using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.catalog_trade_in_devices from anon;
grant select, insert, update, delete on public.catalog_trade_in_devices to authenticated;
grant all on public.catalog_trade_in_devices to service_role;

drop trigger if exists trg_catalog_trade_in_devices_updated_at on public.catalog_trade_in_devices;
create trigger trg_catalog_trade_in_devices_updated_at
  before update on public.catalog_trade_in_devices
  for each row execute function public.fn_set_updated_at();

comment on table public.catalog_trade_in_devices is
  'Aparelhos que a loja aceita como parte do pagamento (troca), com o valor que cada um abate. O agente consulta por crm_search_trade_in_devices. Migration 9003.';

-- ---- 3. ferramenta de código dos agentes ----
alter table public.ai_http_tools add column if not exists kind text not null default 'http';
alter table public.ai_http_tools add column if not exists code text;

alter table public.ai_http_tools drop constraint if exists ai_http_tools_kind_check;
alter table public.ai_http_tools
  add constraint ai_http_tools_kind_check check (kind in ('http', 'codigo'));

-- URL vazia só na de código; a de HTTP mantém o tamanho da 9002.
alter table public.ai_http_tools drop constraint if exists ai_http_tools_url_tamanho;
alter table public.ai_http_tools
  add constraint ai_http_tools_url_tamanho check (
    (kind = 'codigo' and url = '') or (kind = 'http' and char_length(url) between 8 and 2048)
  );

-- Código não sai para a rede: sem credencial, sem efeito, sem confirmação.
alter table public.ai_http_tools drop constraint if exists ai_http_tools_codigo_coerente;
alter table public.ai_http_tools
  add constraint ai_http_tools_codigo_coerente check (
    (kind = 'http' and code is null)
    or (kind = 'codigo' and code is not null and char_length(code) between 1 and 20000
        and auth_type = 'none' and secret_encrypted is null and effect = 'consulta'
        and not requires_confirmation)
  );

grant select (kind, code) on public.ai_http_tools to authenticated;

comment on column public.ai_http_tools.kind is
  'http = chama outro sistema; codigo = roda o JavaScript de `code` isolado (QuickJS/WASM), sem rede. Vocabulário em TIPOS_DE_FERRAMENTA (lib/ferramentas-http/vocabulario.ts). Migration 9003.';
comment on column public.ai_http_tools.code is
  'Corpo de função JavaScript da ferramenta de código: lê `input`, devolve com `return`. Nulo na de HTTP.';

alter table public.ai_http_tool_runs drop constraint if exists ai_http_tool_runs_status_check;
alter table public.ai_http_tool_runs
  add constraint ai_http_tool_runs_status_check check (status in (
    'sucesso', 'erro_http', 'timeout', 'falha_conexao', 'bloqueado',
    'parametros_invalidos', 'resposta_invalida', 'aguardando_confirmacao',
    'limite_excedido', 'erro_codigo'
  ));

notify pgrst, 'reload schema';
