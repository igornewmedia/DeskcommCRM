-- manifest: atributos personalizados de produto por organização (catalog_product_attributes + catalog_products.atributos jsonb), lidos pela tela, pela API e pela busca da IA

alter table public.catalog_products add column if not exists atributos jsonb not null default '{}'::jsonb;

-- Lixo de clone (array, número) vira objeto vazio antes da constraint.
update public.catalog_products set atributos = '{}'::jsonb where jsonb_typeof(atributos) <> 'object';

alter table public.catalog_products drop constraint if exists catalog_products_atributos_objeto;
alter table public.catalog_products
  add constraint catalog_products_atributos_objeto check (jsonb_typeof(atributos) = 'object');

comment on column public.catalog_products.atributos is
  'Valores dos atributos personalizados da organização (chave do atributo -> valor), validados contra catalog_product_attributes na escrita. Migration 5002.';

create table if not exists public.catalog_product_attributes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null,
  rotulo text not null,
  -- Vocabulário fechado com CHECK: a tabela nasce aqui, sem linha legada.
  tipo text not null,
  descricao_ia text,
  visivel_ia boolean not null default true,
  pesquisavel boolean not null default false,
  ordem integer not null default 0,
  opcoes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_product_attributes_chave_slug check (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint catalog_product_attributes_rotulo_tamanho check (char_length(btrim(rotulo)) between 1 and 60),
  constraint catalog_product_attributes_tipo check (tipo in ('texto', 'numero', 'booleano', 'moeda', 'lista')),
  constraint catalog_product_attributes_descricao_tamanho check (descricao_ia is null or char_length(descricao_ia) <= 300),
  constraint catalog_product_attributes_lista_tem_opcao check (tipo <> 'lista' or cardinality(opcoes) > 0),
  constraint catalog_product_attributes_org_chave_key unique (organization_id, chave)
);

create index if not exists catalog_product_attributes_org_ordem_idx
  on public.catalog_product_attributes (organization_id, ordem);

alter table public.catalog_product_attributes enable row level security;

drop policy if exists catalog_product_attributes_select on public.catalog_product_attributes;
create policy catalog_product_attributes_select on public.catalog_product_attributes
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

drop policy if exists catalog_product_attributes_insert on public.catalog_product_attributes;
create policy catalog_product_attributes_insert on public.catalog_product_attributes
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_product_attributes_write on public.catalog_product_attributes;
create policy catalog_product_attributes_write on public.catalog_product_attributes
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

drop policy if exists catalog_product_attributes_delete on public.catalog_product_attributes;
create policy catalog_product_attributes_delete on public.catalog_product_attributes
  for delete using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.catalog_product_attributes from anon;
grant select, insert, update, delete on public.catalog_product_attributes to authenticated;
grant all on public.catalog_product_attributes to service_role;

drop trigger if exists trg_catalog_product_attributes_updated_at on public.catalog_product_attributes;
create trigger trg_catalog_product_attributes_updated_at
  before update on public.catalog_product_attributes
  for each row execute function public.fn_set_updated_at();

comment on table public.catalog_product_attributes is
  'Atributos personalizados de produto definidos por organização (pronta entrega, preço no cartão…). A IA lê os visíveis na busca do catálogo. Teto de 30 por organização, cobrado na rota. Migration 5002.';

notify pgrst, 'reload schema';
