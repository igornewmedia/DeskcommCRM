/**
 * O FUNDO do tema escuro escolhido em `/admin/marca` (migration 0704).
 *
 * Só o fundo é semente: cartões, painéis e bordas derivam dele por `color-mix`,
 * clareando aos poucos, como os tokens de fábrica de `app/globals.css` fazem a
 * olho (`#161510` → `#1d1c17` → `#272620`). Trocar só o `--color-bg` deixaria
 * fundo de um tom e cartão de outro.
 *
 * O texto do escuro NÃO muda, então o fundo é que tem de servir a ele: o piso é
 * o texto secundário (`--color-text-muted`), o mais fraco que carrega leitura,
 * com 4.5:1 (WCAG AA). Um fundo claro demais é recusado, nunca "ajustado".
 */
import { razaoDeContraste } from "./contraste";
import { ehHexValido, normalizarHex } from "./rampa";

/** `--color-text-muted` do `[data-theme="dark"]` de `app/globals.css`. */
const TEXTO_SECUNDARIO_DO_ESCURO = "#8e8b7f";
export const CONTRASTE_MINIMO_DO_FUNDO = 4.5;

export function fundoEscuroLegivel(hex: string): boolean {
  if (!ehHexValido(hex)) return false;
  return razaoDeContraste(normalizarHex(hex), TEXTO_SECUNDARIO_DO_ESCURO) >= CONTRASTE_MINIMO_DO_FUNDO;
}

/**
 * O bloco a injetar, ou `null` (sem cor, cor inválida ou ilegível): nunca lança,
 * porque roda no `app/layout.tsx` — ver "Resolvedor NUNCA lança" no CLAUDE.md.
 * O seletor é o mesmo da cor da instalação (`ESCOPO_DA_INSTALACAO`, (0,3,0)),
 * que vence o `[data-theme="dark"]` (0,1,0) do `globals.css` sem depender da
 * ordem dos `<style>` no `<head>`.
 */
export function cssDoFundoEscuro(hex: string | null | undefined): string | null {
  const cru = (hex ?? "").trim();
  if (!fundoEscuroLegivel(cru)) return null;
  const bg = normalizarHex(cru);
  const mistura = (pct: number) => `color-mix(in oklab, ${bg}, #ffffff ${pct}%)`;
  return `:root:root[data-theme="dark"] {
  --color-bg: ${bg};
  --color-surface: ${mistura(3)};
  --color-surface-elevated: ${mistura(7)};
  --color-border: ${mistura(12)};
  --color-border-strong: ${mistura(19)};
}`;
}
