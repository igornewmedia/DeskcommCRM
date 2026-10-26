-- manifest: catálogo ganha capacidade do produto (opcional, texto livre até 60 caracteres: 128GB, 1TB, 500ml), o mesmo conceito de catalog_trade_in_devices.capacidade
--
-- Molde da `cor` (9003): coluna opcional, sem default, sem backfill — nenhum
-- produto já cadastrado muda. O agente lê pela crm_search_products para
-- responder "tem de 256GB?".

alter table public.catalog_products add column if not exists capacidade text;

alter table public.catalog_products drop constraint if exists catalog_products_capacidade_tamanho;
alter table public.catalog_products
  add constraint catalog_products_capacidade_tamanho
  check (capacidade is null or char_length(capacidade) <= 60);

comment on column public.catalog_products.capacidade is
  'Capacidade do produto (opcional, texto livre: 128GB, 1TB, 500ml). Migration 9004.';
