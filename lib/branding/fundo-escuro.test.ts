import { describe, expect, it } from "vitest";

import { cssDoFundoEscuro, fundoEscuroLegivel } from "./fundo-escuro";

describe("fundo do tema escuro", () => {
  it("o fundo de fábrica e um preto neutro são legíveis", () => {
    expect(fundoEscuroLegivel("#161510")).toBe(true);
    expect(fundoEscuroLegivel("#0b0f14")).toBe(true);
  });

  it("fundo claro demais, ou hex inválido, é recusado", () => {
    expect(fundoEscuroLegivel("#ffffff")).toBe(false);
    expect(fundoEscuroLegivel("#5a5a5a")).toBe(false);
    expect(fundoEscuroLegivel("azul")).toBe(false);
  });

  it("emite o bloco com o fundo normalizado e as superfícies derivadas dele", () => {
    const css = cssDoFundoEscuro(" #0B0F14 ");
    expect(css).toContain(':root:root[data-theme="dark"]');
    expect(css).toContain("--color-bg: #0b0f14;");
    expect(css).toContain("--color-surface: color-mix(in oklab, #0b0f14, #ffffff 3%);");
    expect(css).not.toContain("<");
  });

  it("sem cor, ou com cor recusada, não emite nada (e não lança)", () => {
    expect(cssDoFundoEscuro(null)).toBeNull();
    expect(cssDoFundoEscuro("")).toBeNull();
    expect(cssDoFundoEscuro("#ffffff")).toBeNull();
    expect(cssDoFundoEscuro("</style><script>")).toBeNull();
  });
});
