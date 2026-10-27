import { describe, expect, it } from "vitest";

import {
  atributoCreateSchema,
  casaFiltros,
  formatarValor,
  textoPesquisavel,
  validarValores,
  type AtributoDeProduto,
} from "./atributos-de-produto";

const def = (d: Partial<AtributoDeProduto> & Pick<AtributoDeProduto, "chave" | "tipo">): AtributoDeProduto => ({
  id: d.chave,
  rotulo: d.chave,
  descricao_ia: null,
  visivel_ia: true,
  pesquisavel: false,
  ordem: 0,
  opcoes: [],
  ...d,
});

const DEFS = [
  def({ chave: "pronta_entrega", tipo: "booleano", rotulo: "Pronta entrega", pesquisavel: true }),
  def({ chave: "preco_cartao_cents", tipo: "moeda", rotulo: "Preço no cartão" }),
  def({ chave: "versao", tipo: "lista", rotulo: "Versão", opcoes: ["Padrão", "Anatel"], pesquisavel: true }),
  def({ chave: "garantia_meses", tipo: "numero" }),
  def({ chave: "obs", tipo: "texto" }),
];

describe("validarValores — o valor tem de bater com o tipo da definição", () => {
  it("aceita cada tipo no formato certo", () => {
    const r = validarValores(DEFS, {
      pronta_entrega: true,
      preco_cartao_cents: 785100,
      versao: "Anatel",
      garantia_meses: 12,
      obs: "lacrado",
    });
    expect(r).toEqual({
      ok: true,
      valores: { pronta_entrega: true, preco_cartao_cents: 785100, versao: "Anatel", garantia_meses: 12, obs: "lacrado" },
    });
  });

  it("recusa tipo errado, opção fora da lista e moeda com centavo quebrado", () => {
    const r = validarValores(DEFS, { pronta_entrega: "sim", versao: "China", preco_cartao_cents: 78.5 });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.erros).sort()).toEqual(["preco_cartao_cents", "pronta_entrega", "versao"]);
  });

  it("recusa chave que a organização não definiu", () => {
    const r = validarValores(DEFS, { cor_do_vizinho: "azul" });
    expect(r.ok).toBe(false);
  });

  it("null é apagar: aceito e fora do resultado", () => {
    expect(validarValores(DEFS, { obs: null })).toEqual({ ok: true, valores: {} });
  });

  it("recusa atributos que não sejam objeto", () => {
    expect(validarValores(DEFS, [1, 2]).ok).toBe(false);
  });
});

describe("definição", () => {
  it("lista sem opção é recusada; chave precisa ser slug", () => {
    expect(atributoCreateSchema.safeParse({ chave: "versao", rotulo: "Versão", tipo: "lista" }).success).toBe(false);
    expect(atributoCreateSchema.safeParse({ chave: "Pronta Entrega", rotulo: "x", tipo: "booleano" }).success).toBe(false);
    expect(atributoCreateSchema.safeParse({ chave: "pronta_entrega", rotulo: "x", tipo: "booleano" }).success).toBe(true);
  });
});

describe("formatarValor — como a IA lê", () => {
  it("moeda em reais, booleano em sim/não", () => {
    expect(formatarValor(DEFS[1]!, 785100, "BRL")?.replace(/\s/g, " ")).toBe("R$ 7.851,00");
    expect(formatarValor(DEFS[0]!, true, "BRL")).toBe("sim");
    expect(formatarValor(DEFS[0]!, false, "BRL")).toBe("não");
    expect(formatarValor(DEFS[0]!, undefined, "BRL")).toBeNull();
  });
});

describe("busca", () => {
  it("só os pesquisáveis entram no texto; booleano verdadeiro entra pelo rótulo", () => {
    expect(textoPesquisavel(DEFS, { pronta_entrega: true, versao: "Anatel", obs: "lacrado" })).toBe(
      "Pronta entrega Anatel",
    );
    expect(textoPesquisavel(DEFS, { pronta_entrega: false })).toBe("");
  });

  it("filtro por booleano e por lista (sem caixa)", () => {
    expect(casaFiltros({ pronta_entrega: true }, { pronta_entrega: true })).toBe(true);
    expect(casaFiltros({}, { pronta_entrega: true })).toBe(false);
    expect(casaFiltros({}, { pronta_entrega: false })).toBe(true);
    expect(casaFiltros({ versao: "Anatel" }, { versao: "anatel" })).toBe(true);
    expect(casaFiltros({ versao: "Padrão" }, { versao: "Anatel" })).toBe(false);
  });
});
