import { describe, expect, it } from "vitest";

import type { AtributoDeProduto } from "@/lib/schemas/atributos-de-produto";

import { corpoDosAtributos, rascunhoDosAtributos } from "./atributos-no-formulario";

const t = (s: string) => s;
const DEFS: AtributoDeProduto[] = [
  { id: "1", chave: "pronta_entrega", rotulo: "Pronta entrega", tipo: "booleano", descricao_ia: null, visivel_ia: true, pesquisavel: false, ordem: 0, opcoes: [] },
  { id: "2", chave: "preco_cartao_cents", rotulo: "Preço no cartão", tipo: "moeda", descricao_ia: null, visivel_ia: true, pesquisavel: false, ordem: 1, opcoes: [] },
  { id: "3", chave: "versao", rotulo: "Versão", tipo: "lista", descricao_ia: null, visivel_ia: true, pesquisavel: false, ordem: 2, opcoes: ["Padrão", "Anatel"] },
];

describe("atributos no formulário do produto", () => {
  it("criação: manda só o preenchido, no tipo certo", () => {
    const r = rascunhoDosAtributos(DEFS, {});
    const corpo = corpoDosAtributos(DEFS, { ...r, pronta_entrega: true, preco_cartao_cents: "7.851,00" }, t);
    expect(corpo).toEqual({ atributos: { pronta_entrega: true, preco_cartao_cents: 785100 } });
  });

  it("edição: só a chave que mudou, e a apagada vai como null", () => {
    const atuais = { pronta_entrega: true, preco_cartao_cents: 785100, versao: "Anatel" };
    const r = rascunhoDosAtributos(DEFS, atuais);
    expect(r.preco_cartao_cents).toBe("7.851,00");
    const corpo = corpoDosAtributos(DEFS, { ...r, versao: "" }, t, atuais);
    expect(corpo).toEqual({ atributos: { versao: null } });
  });

  it("valor em dinheiro ilegível é erro, não número chutado", () => {
    const corpo = corpoDosAtributos(DEFS, { preco_cartao_cents: "sete mil" }, t);
    expect(corpo.erro).toContain("Preço no cartão");
  });
});
