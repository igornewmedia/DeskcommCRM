-- manifest: **O fundo do tema escuro passa a ser escolhido em /admin/marca.** Coluna OPCIONAL `platform_branding.dark_bg_hex`, mesmo CHECK `^#[0-9a-f]{6}$` de `accent_hex`: `null` = o fundo de fábrica (`#161510`) de `app/globals.css`, byte a byte. Cartões, painéis e bordas do escuro derivam do fundo por `color-mix`, para a tela não ficar com fundo de um tom e cartão de outro. A action recusa fundo claro demais (texto secundário abaixo de 4.5:1). Apêndice idêntico no `supabase/baseline.sql`.
-- O fundo do tema escuro era fixo em app/globals.css e não havia como trocá-lo
-- sem editar código. NULL preserva o comportamento de antes (retrocompatível
-- pela ausência do dado, como accent_dark_hex na 0627).
alter table public.platform_branding
  add column if not exists dark_bg_hex text;

alter table public.platform_branding
  drop constraint if exists platform_branding_dark_bg_hex;

alter table public.platform_branding
  add constraint platform_branding_dark_bg_hex check (
    dark_bg_hex is null or dark_bg_hex ~ '^#[0-9a-f]{6}$'
  );

comment on column public.platform_branding.dark_bg_hex is
  'Cor de FUNDO do tema escuro da instalação. Cartões, painéis e bordas do escuro derivam dela por color-mix (app/layout.tsx). NULL = o fundo de fábrica de app/globals.css. Mesmo CHECK de accent_hex. Lida/escrita só server-side (service_role), como o resto da tabela.';

notify pgrst, 'reload schema';
