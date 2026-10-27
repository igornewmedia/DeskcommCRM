import { describe, expect, it } from "vitest";

import { renderAgora } from "./agora";
import { feriadoDoDia, feriadosDasSettings, linhasDeFeriado, type ConfigDeFeriados } from "./feriados";

const FUSO = "America/Sao_Paulo";
const LIGADO: ConfigDeFeriados = { ligado: true, nacionais: true, proprios: [] };
/** Meio-dia em Brasília numa data civil. */
const em = (iso: string) => new Date(`${iso}T15:00:00Z`);

describe("feriados no bloco ## Agora", () => {
  it("desligado (o padrão): o bloco fica exatamente como era", () => {
    const agora = em("2026-12-25");
    expect(renderAgora(agora, FUSO, feriadosDasSettings({}))).toBe(renderAgora(agora, FUSO));
    expect(linhasDeFeriado(agora, FUSO, feriadosDasSettings({ feriados: { ligado: false } }))).toEqual([]);
  });

  it("hoje é feriado nacional: diz qual, e o próximo dia útil", () => {
    // 25/12/2026 é sexta; 26 e 27 são fim de semana; 28 é segunda.
    expect(linhasDeFeriado(em("2026-12-25"), FUSO, LIGADO)).toEqual([
      "Hoje é feriado: Natal.",
      "Próximo dia útil (segunda a sexta, sem feriado): segunda-feira, 28/12/2026.",
    ]);
  });

  it("véspera de feriado: avisa o de amanhã e pula ele no próximo dia útil", () => {
    // 20/11/2026 (sexta) é Consciência Negra; 19/11 é quinta.
    expect(linhasDeFeriado(em("2026-11-19"), FUSO, LIGADO)).toEqual([
      "Hoje não é feriado.",
      "Amanhã é feriado: Dia Nacional de Zumbi e da Consciência Negra.",
      "Próximo dia útil (segunda a sexta, sem feriado): segunda-feira, 23/11/2026.",
    ]);
  });

  it("feriado próprio da empresa entra, e vence o nome do nacional", () => {
    const cfg: ConfigDeFeriados = {
      ligado: true,
      nacionais: true,
      proprios: [{ data: "2026-04-21", nome: "Aniversário de Brasília" }],
    };
    expect(feriadoDoDia("2026-04-21", cfg)).toBe("Aniversário de Brasília");
    expect(linhasDeFeriado(em("2026-04-21"), FUSO, cfg)[0]).toBe("Hoje é feriado: Aniversário de Brasília.");
  });

  it("sem os nacionais, só os próprios contam", () => {
    const cfg: ConfigDeFeriados = { ligado: true, nacionais: false, proprios: [] };
    expect(feriadoDoDia("2026-12-25", cfg)).toBeNull();
  });

  it("entra no ## Agora, depois do instante absoluto", () => {
    const bloco = renderAgora(em("2026-12-25"), FUSO, LIGADO);
    expect(bloco).toContain("Hoje é feriado: Natal.");
    expect(bloco.indexOf("instante_absoluto")).toBeLessThan(bloco.indexOf("Hoje é feriado"));
  });

  it("configuração torta vira desligado, nunca erro", () => {
    expect(feriadosDasSettings({ feriados: { ligado: "sim" } }).ligado).toBe(false);
    expect(feriadosDasSettings(null).ligado).toBe(false);
  });
});
