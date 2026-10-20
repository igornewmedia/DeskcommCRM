import { describe, expect, it } from "vitest";

import { montarRequisicao, RequisicaoInvalidaError, type CadastroDaRequisicao } from "./montar-requisicao";

const BASE: CadastroDaRequisicao = {
  method: "POST",
  url: "https://exemplo.com/agenda/{{data}}",
  headers: {},
  query: {},
  body_template: null,
  auth_type: "none",
  auth_header_name: null,
};

describe("montarRequisicao", () => {
  it("valor no caminho é codificado: não troca o recurso nem abre query", () => {
    const r = montarRequisicao(BASE, { data: "../admin?x=1#y" }, null);
    expect(r.url).toBe("https://exemplo.com/agenda/..%2Fadmin%3Fx%3D1%23y");
  });

  it("query: entrada só com placeholder sai quando o opcional não veio", () => {
    const r = montarRequisicao(
      { ...BASE, method: "GET", query: { unidade: "{{unidade}}", fixo: "sim", texto: "u-{{unidade}}" } },
      { data: "2026-10-20" },
      null,
    );
    const url = new URL(r.url);
    expect(url.searchParams.has("unidade")).toBe(false);
    expect(url.searchParams.get("fixo")).toBe("sim");
    expect(url.searchParams.get("texto")).toBe("u-");
    expect(r.body).toBeUndefined();
  });

  it("corpo estrutural: tipo preservado, opcional ausente some, injeção vira texto", () => {
    const r = montarRequisicao(
      {
        ...BASE,
        body_template: {
          data: "{{data}}",
          qtd: "{{qtd}}",
          prof: "{{prof}}",
          frase: "dia {{data}}",
          lista: ["{{prof}}", "fixo"],
        },
      },
      { data: '2026-10-20", "admin": true, "x": "', qtd: 2 },
      null,
    );
    const corpo = JSON.parse(r.body as string);
    expect(corpo.qtd).toBe(2);
    expect("prof" in corpo).toBe(false);
    expect(corpo.lista).toEqual(["fixo"]);
    expect(corpo.admin).toBeUndefined();
    expect(corpo.data).toBe('2026-10-20", "admin": true, "x": "');
    expect(r.headers["Content-Type"]).toBe("application/json");
  });

  it("sem modelo de corpo, os argumentos vão como JSON", () => {
    const r = montarRequisicao(BASE, { data: "2026-10-20" }, null);
    expect(JSON.parse(r.body as string)).toEqual({ data: "2026-10-20" });
  });

  it("bearer, basic e api_key saem no cabeçalho e aparecem mascarados", () => {
    const bearer = montarRequisicao({ ...BASE, auth_type: "bearer" }, { data: "d" }, "tok123");
    expect(bearer.headers.Authorization).toBe("Bearer tok123");
    expect(bearer.paraExibir.headers.Authorization).toBe("••••");
    expect(JSON.stringify(bearer.paraExibir)).not.toContain("tok123");

    const basic = montarRequisicao({ ...BASE, auth_type: "basic" }, { data: "d" }, "ana:s3nha");
    expect(basic.headers.Authorization).toBe(`Basic ${Buffer.from("ana:s3nha").toString("base64")}`);

    const chave = montarRequisicao(
      { ...BASE, auth_type: "api_key", auth_header_name: "X-Api-Key", headers: { "x-api-key": "velho" } },
      { data: "d" },
      "k-999",
    );
    expect(chave.headers["X-Api-Key"]).toBe("k-999");
    expect(chave.headers["x-api-key"]).toBeUndefined();
    expect(new URL(chave.url).search).toBe("");
  });

  it("credencial que não abre não vira chamada sem autenticação", () => {
    expect(() => montarRequisicao({ ...BASE, auth_type: "bearer" }, { data: "d" }, null)).toThrow(
      RequisicaoInvalidaError,
    );
  });

  it("quebra de linha em cabeçalho é recusada (injeção de cabeçalho)", () => {
    expect(() =>
      montarRequisicao({ ...BASE, headers: { "X-Data": "{{data}}" } }, { data: "a\r\nX-Evil: 1" }, null),
    ).toThrow(RequisicaoInvalidaError);
  });
});
