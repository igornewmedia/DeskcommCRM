import { describe, expect, it } from "vitest";

import { executarCodigo } from "./codigo";
import type { Parametro } from "./schema";

const PARAMETROS: Parametro[] = [
  { name: "valor_a_vista", type: "number", required: true, description: "preço à vista" },
  { name: "entrada", type: "number", required: true, description: "entrada" },
  { name: "parcelas", type: "integer", required: true, description: "parcelas" },
];

const PARCELAMENTO = `
  const financiado = input.valor_a_vista - input.entrada;
  const taxa = 0.0299;
  const parcela = financiado * taxa / (1 - Math.pow(1 + taxa, -input.parcelas));
  return { financiado, parcela: Math.round(parcela * 100) / 100, parcelas: input.parcelas };
`;

const rodar = (code: string, args: unknown = { valor_a_vista: 5000, entrada: 1000, parcelas: 10 }) =>
  executarCodigo({ code, parameters: PARAMETROS, timeout_ms: 10_000 }, args);

describe("ferramenta de código — QuickJS isolado", () => {
  it("calcula entrada + parcelamento com o input validado", async () => {
    const r = await rodar(PARCELAMENTO);
    expect(r.status).toBe("sucesso");
    expect(r.dados).toEqual({ financiado: 4000, parcela: 468.68, parcelas: 10 });
  });

  it("recusa input fora do schema antes de rodar", async () => {
    const r = await rodar(PARCELAMENTO, { valor_a_vista: "5000", entrada: 1, parcelas: 1 });
    expect(r.status).toBe("parametros_invalidos");
  });

  it("não enxerga process, require, fetch nem globalThis do Node", async () => {
    const r = await rodar(`return [typeof process, typeof require, typeof fetch, typeof Buffer, typeof setTimeout];`);
    expect(r.dados).toEqual(["undefined", "undefined", "undefined", "undefined", "undefined"]);
  });

  it("o truque do constructor não sai do QuickJS", async () => {
    const r = await rodar(`return typeof (function(){}).constructor("return this")().process;`);
    expect(r.dados).toBe("undefined");
  });

  it("laço infinito é cortado pelo tempo", async () => {
    const r = await rodar(`while (true) {}`);
    expect(r.status).toBe("timeout");
    expect(r.duracaoMs).toBeLessThan(5_000);
  });

  it("estourar a memória vira erro, não derruba o processo", async () => {
    const r = await rodar(`const a = []; while (true) a.push(new Array(100000).fill(1));`);
    expect(["erro_codigo", "timeout"]).toContain(r.status);
  });

  it("erro do código volta com a mensagem", async () => {
    const r = await rodar(`throw new Error("parcelas demais");`);
    expect(r.status).toBe("erro_codigo");
    expect(r.problemas?.[0]).toContain("parcelas demais");
  });

  it("sem return é sucesso vazio", async () => {
    const r = await rodar(`const x = 1;`);
    expect(r).toMatchObject({ status: "sucesso", vazia: true });
  });
});
