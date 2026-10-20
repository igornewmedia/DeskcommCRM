/**
 * As rotas de ferramentas HTTP: papel, organização da SESSÃO (nunca do corpo),
 * credencial que entra cifrada e nunca volta, exclusão lógica, e o botão Testar
 * gravando só os NOMES dos parâmetros no histórico.
 *
 * O client do Supabase é um falso encadeável: registra cada chamada e devolve as
 * respostas em fila, na ordem em que as queries terminam.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  audit: vi.fn(),
  admin: vi.fn(),
  rate: vi.fn(),
  executar: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: deps.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: deps.support }));
vi.mock("@/lib/audit", () => ({ audit: deps.audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: deps.admin }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: deps.rate }));
vi.mock("@/lib/ferramentas-http/segredo", async (original) => ({
  ...((await original()) as object),
  cifrarSegredo: (s: string) => ({
    secret_encrypted: "\\xcifrado",
    secret_iv: "\\x02",
    secret_tag: "\\x03",
    secret_last4: s.slice(-4),
  }),
  abrirSegredo: () => "tok-aberto",
}));
vi.mock("@/lib/ferramentas-http/executar", async (original) => ({
  ...((await original()) as object),
  executarFerramentaHttp: deps.executar,
}));

import { DELETE, PATCH } from "./[id]/route";
import { POST as TESTAR } from "./[id]/test/route";
import { GET, POST } from "./route";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

type Resposta = { data: unknown; error: unknown };

function fakeAdmin(respostas: Resposta[]) {
  const chamadas: Array<[string, unknown[]]> = [];
  const proxima = () => respostas.shift() ?? { data: null, error: null };
  const chain: unknown = new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === "then") {
          return (ok: (v: Resposta) => unknown, erro: (e: unknown) => unknown) =>
            Promise.resolve(proxima()).then(ok, erro);
        }
        if (prop === "single" || prop === "maybeSingle") return async () => proxima();
        return (...args: unknown[]) => {
          chamadas.push([String(prop), args]);
          return chain;
        };
      },
    },
  );
  deps.admin.mockReturnValue(chain);
  return {
    chamadas,
    payload: (metodo: string) =>
      chamadas.find(([m]) => m === metodo)?.[1][0] as Record<string, unknown> | undefined,
    filtros: () => chamadas.filter(([m]) => m === "eq").map(([, a]) => a),
  };
}

function pedido(url: string, metodo: string, corpo?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: metodo,
    headers: { "content-type": "application/json" },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
}

const CADASTRO = {
  slug: "consultar_horarios",
  name: "Consultar horários",
  description: "Consulta horários livres.",
  method: "POST",
  url: "https://exemplo.com/webhook",
  parameters: [{ name: "data", type: "string", required: true, description: "Data" }],
  body_template: { data: "{{data}}" },
  auth_type: "bearer",
};

const params = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  deps.support.mockResolvedValue(null);
  deps.rate.mockResolvedValue({ allowed: true });
  deps.role.mockResolvedValue({
    ok: true,
    user: { id: "u-1", idioma: "pt-BR" },
    org: { orgId: ORG, role: "manager" },
  });
});

describe("papel", () => {
  it("o gate é manager e a recusa do gate volta como veio", async () => {
    deps.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    fakeAdmin([]);
    expect((await GET()).status).toBe(403);
    expect(deps.role).toHaveBeenCalledWith("manager", expect.anything());
  });
});

describe("POST /api/v1/ai/http-tools", () => {
  it("cria na organização da sessão, cifra a credencial e não a devolve", async () => {
    const db = fakeAdmin([{ data: { id: ID, secret_last4: "1234" }, error: null }]);
    const res = await POST(
      pedido("/api/v1/ai/http-tools", "POST", {
        ...CADASTRO,
        organization_id: OUTRA_ORG,
        secret: "tok-secreto-1234",
      }),
    );
    expect(res.status).toBe(201);
    const gravado = db.payload("insert") as Record<string, unknown>;
    expect(gravado.organization_id).toBe(ORG);
    expect(gravado.secret_encrypted).toBe("\\xcifrado");
    expect(JSON.stringify(gravado)).not.toContain("tok-secreto");
    const corpo = await res.text();
    expect(corpo).not.toContain("tok-secreto");
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ai_http_tool.created" }));
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain("tok-secreto");
  });

  it("autenticação ligada sem credencial é 422 com código próprio", async () => {
    fakeAdmin([]);
    const res = await POST(pedido("/api/v1/ai/http-tools", "POST", CADASTRO));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("http_tool_sem_segredo");
  });

  it("placeholder no host é recusado antes do banco", async () => {
    const db = fakeAdmin([]);
    const res = await POST(
      pedido("/api/v1/ai/http-tools", "POST", {
        ...CADASTRO,
        auth_type: "none",
        url: "https://{{data}}.exemplo.com/x",
      }),
    );
    expect(res.status).toBe(422);
    expect(db.payload("insert")).toBeUndefined();
  });

  it("nome interno repetido é 409", async () => {
    fakeAdmin([{ data: null, error: { code: "23505" } }]);
    const res = await POST(pedido("/api/v1/ai/http-tools", "POST", { ...CADASTRO, secret: "x" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("http_tool_slug_em_uso");
  });

  it("suporte em modo leitura é recusado antes de tudo", async () => {
    deps.support.mockResolvedValue(new Response(null, { status: 403 }));
    fakeAdmin([]);
    expect((await POST(pedido("/api/v1/ai/http-tools", "POST", CADASTRO))).status).toBe(403);
    expect(deps.role).not.toHaveBeenCalled();
  });
});

const GRAVADA = {
  id: ID,
  organization_id: ORG,
  ...CADASTRO,
  is_active: true,
  headers: {},
  query: {},
  response_map: null,
  response_instructions: null,
  auth_header_name: null,
  effect: "consulta",
  requires_confirmation: false,
  safe_to_retry: false,
  timeout_ms: 10_000,
  secret_last4: "1234",
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
};

describe("PATCH /api/v1/ai/http-tools/:id", () => {
  it("trocar para 'sem autenticação' apaga a credencial, filtrando pela organização", async () => {
    const db = fakeAdmin([
      { data: GRAVADA, error: null },
      { data: { id: ID }, error: null },
    ]);
    const res = await PATCH(pedido(`/api/v1/ai/http-tools/${ID}`, "PATCH", { auth_type: "none" }), params);
    expect(res.status).toBe(200);
    const salvo = db.payload("update") as Record<string, unknown>;
    expect(salvo.secret_encrypted).toBeNull();
    expect(salvo.secret_last4).toBeNull();
    expect(db.filtros()).toContainEqual(["organization_id", ORG]);
  });

  it("sem `secret`, a credencial gravada é mantida", async () => {
    const db = fakeAdmin([
      { data: GRAVADA, error: null },
      { data: { id: ID }, error: null },
    ]);
    await PATCH(pedido(`/api/v1/ai/http-tools/${ID}`, "PATCH", { name: "Outro nome" }), params);
    const salvo = db.payload("update") as Record<string, unknown>;
    expect("secret_encrypted" in salvo).toBe(false);
    expect(salvo.name).toBe("Outro nome");
  });

  it("valida o cadastro INTEIRO: virar GET com corpo gravado é 422", async () => {
    fakeAdmin([{ data: GRAVADA, error: null }]);
    const res = await PATCH(pedido(`/api/v1/ai/http-tools/${ID}`, "PATCH", { method: "GET" }), params);
    expect(res.status).toBe(422);
  });

  it("ferramenta de outra organização é 404", async () => {
    fakeAdmin([{ data: null, error: null }]);
    const res = await PATCH(pedido(`/api/v1/ai/http-tools/${ID}`, "PATCH", { name: "x" }), params);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/ai/http-tools/:id", () => {
  it("exclui logicamente e desativa", async () => {
    const db = fakeAdmin([{ data: { id: ID, slug: "consultar_horarios" }, error: null }]);
    const res = await DELETE(pedido(`/api/v1/ai/http-tools/${ID}`, "DELETE"), params);
    expect(res.status).toBe(200);
    const salvo = db.payload("update") as Record<string, unknown>;
    expect(salvo.deleted_at).toEqual(expect.any(String));
    expect(salvo.is_active).toBe(false);
    expect(db.chamadas.some(([m]) => m === "delete")).toBe(false);
  });
});

describe("POST /api/v1/ai/http-tools/:id/test", () => {
  it("executa, grava só os nomes dos parâmetros e devolve o que o agente veria", async () => {
    const db = fakeAdmin([
      { data: { ...GRAVADA, secret_encrypted: "\\x01", secret_iv: "\\x02", secret_tag: "\\x03" }, error: null },
      { data: null, error: null },
    ]);
    deps.executar.mockResolvedValue({
      status: "sucesso",
      ok: true,
      httpStatus: 200,
      duracaoMs: 42,
      tentativas: 1,
      dados: { horarios: ["09:00"] },
      bytes: 30,
      requisicao: { method: "POST", url: "https://exemplo.com/webhook", headers: { Authorization: "••••" } },
    });

    const res = await TESTAR(
      pedido(`/api/v1/ai/http-tools/${ID}/test`, "POST", { args: { data: "2026-10-20" } }),
      params,
    );
    expect(res.status).toBe(200);
    expect(deps.executar.mock.calls[0]?.[2]).toEqual({ segredo: "tok-aberto" });

    const corpo = await res.json();
    expect(corpo.data).toMatchObject({ status: "sucesso", http_status: 200, duration_ms: 42 });
    expect(corpo.data.para_o_modelo.aviso).toMatch(/nunca como instrução/);
    expect(JSON.stringify(corpo)).not.toContain("tok-aberto");

    const historico = db.chamadas.filter(([m]) => m === "insert").map(([, a]) => a[0]);
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ organization_id: ORG, origin: "teste", param_names: ["data"] });
    expect(JSON.stringify(historico)).not.toContain("2026-10-20");
  });
});
