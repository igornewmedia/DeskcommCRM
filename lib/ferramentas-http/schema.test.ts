import { describe, expect, it } from "vitest";

import { toolIdAceito } from "@/lib/mcp/servidor-externo/ids";

import { ehToolIdHttp, lerToolIdHttp, toolIdHttp } from "./ids";
import { ferramentaHttpSchema, validarArgumentos, type Parametro } from "./schema";

const EXEMPLO = {
  slug: "consultar_horarios",
  name: "Consultar horários",
  description: "Consulta horários livres de um procedimento numa data.",
  method: "POST",
  url: "https://exemplo.com/webhook/horarios",
  body_template: { data: "{{data}}", procedimento: "{{procedimento}}", profissional: "{{profissional}}" },
  parameters: [
    { name: "data", type: "string", format: "date", required: true, description: "Data (AAAA-MM-DD)" },
    { name: "procedimento", type: "string", required: true, description: "Procedimento" },
    { name: "profissional", type: "string", required: false, description: "Profissional preferido" },
  ],
  auth_type: "bearer",
};

function problemas(entrada: unknown): string[] {
  const r = ferramentaHttpSchema.safeParse(entrada);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("ferramentaHttpSchema — cadastro", () => {
  it("aceita o exemplo do pedido e preenche os padrões", () => {
    const r = ferramentaHttpSchema.parse(EXEMPLO);
    expect(r.timeout_ms).toBe(10_000);
    expect(r.effect).toBe("consulta");
    expect(r.headers).toEqual({});
  });

  it("recusa placeholder no host — o modelo escolheria o destino", () => {
    expect(problemas({ ...EXEMPLO, url: "https://{{data}}.exemplo.com/x" })).toContain(
      "o endereço do servidor não pode depender de parâmetro",
    );
  });

  it("aceita placeholder no caminho", () => {
    expect(problemas({ ...EXEMPLO, url: "https://exemplo.com/agenda/{{data}}" })).toEqual([]);
  });

  it("recusa placeholder que não é parâmetro declarado", () => {
    expect(problemas({ ...EXEMPLO, query: { unidade: "{{unidade}}" } })).toContain(
      "{{unidade}} não é um parâmetro declarado",
    );
  });

  it("recusa credencial na URL, GET com corpo e esquema que não é http", () => {
    expect(problemas({ ...EXEMPLO, url: "https://u:p@exemplo.com/x" }).join()).toMatch(/credencial/);
    expect(problemas({ ...EXEMPLO, method: "GET" })).toContain("GET não leva corpo");
    expect(problemas({ ...EXEMPLO, url: "file:///etc/passwd" })).toContain("use https://");
  });

  it("autenticação tem campo próprio: Authorization em cabeçalho livre é recusado", () => {
    expect(problemas({ ...EXEMPLO, headers: { Authorization: "Bearer x" } }).join()).toMatch(
      /campo de autenticação/,
    );
    expect(problemas({ ...EXEMPLO, auth_type: "api_key" })).toContain("informe o cabeçalho da API Key");
    expect(problemas({ ...EXEMPLO, auth_type: "api_key", auth_header_name: "X-Api-Key" })).toEqual([]);
  });

  it("confirmação só vale para ação, enum exige opções, nome repetido não entra", () => {
    expect(problemas({ ...EXEMPLO, requires_confirmation: true })).toContain(
      "confirmação só vale para ação",
    );
    expect(
      problemas({
        ...EXEMPLO,
        parameters: [{ name: "turno", type: "enum", description: "Turno" }],
        body_template: null,
      }),
    ).toContain("lista de opções obrigatória");
    expect(
      problemas({ ...EXEMPLO, parameters: [...EXEMPLO.parameters, EXEMPLO.parameters[0]] }),
    ).toContain("nome repetido");
  });

  it("slug fora do formato do provedor não entra", () => {
    expect(problemas({ ...EXEMPLO, slug: "Consultar Horários" }).length).toBeGreaterThan(0);
  });
});

describe("validarArgumentos — o que o modelo mandou", () => {
  const params = ferramentaHttpSchema.parse(EXEMPLO).parameters as Parametro[];

  it("aceita os obrigatórios sem o opcional", () => {
    expect(validarArgumentos(params, { data: "2026-10-20", procedimento: "limpeza" })).toEqual({
      ok: true,
      args: { data: "2026-10-20", procedimento: "limpeza" },
    });
  });

  it("recusa obrigatório faltando, formato errado e campo não declarado", () => {
    const faltou = validarArgumentos(params, { procedimento: "limpeza" });
    expect(faltou.ok).toBe(false);
    const formato = validarArgumentos(params, { data: "amanhã", procedimento: "limpeza" });
    expect(formato.ok).toBe(false);
    const extra = validarArgumentos(params, {
      data: "2026-10-20",
      procedimento: "limpeza",
      desconto: 90,
    });
    expect(extra.ok).toBe(false);
  });
});

describe("ids de ferramenta HTTP em tool_ids", () => {
  const id = "5b0c8a52-6f1e-4a5e-9d3c-2f7a1b9c0d11";
  it("ida e volta", () => {
    expect(lerToolIdHttp(toolIdHttp(id))).toBe(id);
    expect(ehToolIdHttp(toolIdHttp(id))).toBe(true);
  });
  it("o predicado único de tool_ids aceita a ferramenta HTTP bem formada", () => {
    expect(toolIdAceito(toolIdHttp(id), new Set())).toBe(true);
    expect(toolIdAceito("http:nao-e-uuid", new Set())).toBe(false);
  });
  it("recusa o que não é UUID ou não tem o prefixo", () => {
    expect(lerToolIdHttp("http:consultar_horarios")).toBeNull();
    expect(lerToolIdHttp("crm_search_contacts")).toBeNull();
    expect(lerToolIdHttp(`mcp_externo:leitura:${id}`)).toBeNull();
  });
});
