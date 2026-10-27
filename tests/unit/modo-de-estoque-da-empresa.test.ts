/**
 * MODO DE ESTOQUE POR EMPRESA — a IA e a API tratam o estoque como a empresa
 * escolheu (`lib/catalogo/modo-de-estoque.ts`).
 *
 * "Sem controle de estoque": todo produto ativo está disponível, mesmo com
 * quantidade 0 (o fornecedor não informa). "Somente com estoque": só o ativo
 * com quantidade > 0, ou com `controla_estoque = false`. A chave mora em
 * `organizations.settings.catalogo.modo_estoque` de CADA organização e é lida a
 * cada consulta — trocar vale na busca seguinte.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import {
  controlaEstoquePadrao,
  modoDeEstoqueDasSettings,
  produtoDisponivel,
  type ModoDeEstoque,
} from "@/lib/catalogo/modo-de-estoque";
import { crmSearchProducts } from "@/lib/mcp/tools/comercio";
import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/api/auth-dual", () => ({ resolveAuthDual: vi.fn(), tetoDeEscritaDoToken: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const TOKEN_ID = "44444444-4444-4444-8444-444444444444";

type Linha = Record<string, unknown>;

/** Banco de mentira, por organização: `organizations` e `catalog_products`, com o filtro `eq` de verdade. */
function bancoFalso(orgs: Record<string, Linha>, produtos: Linha[]) {
  const gravados: { insert?: Linha; update?: Linha } = {};
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let escrita: { tipo: "insert" | "update"; dados: Linha } | null = null;
    const linhas = (): Linha[] => {
      const base = tabela === "organizations" ? Object.entries(orgs).map(([id, o]) => ({ id, ...o })) : produtos;
      return base.filter((l) => filtros.every(([c, v]) => l[c] === v));
    };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "or", "order", "limit"]) q[m] = () => q;
    q.eq = (c: string, v: unknown) => {
      filtros.push([c, v]);
      return q;
    };
    q.range = async () => ({ data: linhas(), error: null, count: linhas().length });
    q.maybeSingle = async () => ({ data: linhas()[0] ?? null, error: null });
    q.single = async () => ({ data: { id: "novo", ...escrita!.dados }, error: null });
    q.insert = (dados: Linha) => {
      escrita = { tipo: "insert", dados };
      gravados.insert = dados;
      return q;
    };
    q.update = (dados: Linha) => {
      escrita = { tipo: "update", dados };
      gravados.update = dados;
      q.maybeSingle = async () => ({ data: { id: "p1", ...dados }, error: null });
      return q;
    };
    // `await q` sem terminal (o GET sem paginação termina em `.limit`).
    q.then = (ok: (r: unknown) => unknown) => ok({ data: linhas(), error: null, count: linhas().length });
    return q;
  };
  return { supabase: { from }, gravados };
}

const modo = (m: ModoDeEstoque | undefined): Linha => ({ settings: m ? { catalogo: { modo_estoque: m } } : {} });

const P = (codigo: string, extra: Linha): Linha => ({
  id: codigo,
  codigo,
  nome: `Produto ${codigo}`,
  descricao: null,
  marca: null,
  categoria: null,
  preco_cents: 1000,
  moeda: "BRL",
  ativo: true,
  controla_estoque: true,
  quantidade: 0,
  fotos: null,
  organization_id: ORG_A,
  ...extra,
});

function ctxDe(supabase: unknown, organizationId = ORG_A): McpContext {
  return {
    organizationId,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", agent_id: "agent-1" },
    apiTokenId: TOKEN_ID,
    requestId: "55555555-5555-4555-8555-555555555555",
    supabase,
  } as unknown as McpContext;
}

async function buscar(supabase: unknown, termo = "produto", organizationId = ORG_A) {
  return (await crmSearchProducts.handler({ termo, limite: 20, somente_disponiveis: true }, ctxDe(supabase, organizationId))) as {
    produtos: Array<Record<string, unknown>>;
    motivo?: string;
  };
}

function autorizar(supabase: unknown, organizationId = ORG_A) {
  vi.mocked(resolveAuthDual).mockResolvedValue({
    ok: true,
    organizationId,
    actor: { type: "api_token", id: TOKEN_ID },
    supabase,
    via: "token",
    apiTokenId: TOKEN_ID,
  } as never);
}

const req = (url: string, metodo = "GET", corpo?: unknown) =>
  new NextRequest(url, {
    method: metodo,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "content-type": "application/json", authorization: "Bearer dsk_teste" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tetoDeEscritaDoToken).mockResolvedValue(null);
});

describe("a régua única de disponibilidade", () => {
  it("sem controle: ativo com quantidade 0 está disponível; inativo não", () => {
    expect(produtoDisponivel({ ativo: true, controla_estoque: true, quantidade: 0 }, "sem_controle")).toBe(true);
    expect(produtoDisponivel({ ativo: false, controla_estoque: true, quantidade: 5 }, "sem_controle")).toBe(false);
  });

  it("somente com estoque: quantidade 0 fica fora, 3 entra, sem controle no produto entra", () => {
    expect(produtoDisponivel({ ativo: true, controla_estoque: true, quantidade: 0 }, "somente_com_estoque")).toBe(false);
    expect(produtoDisponivel({ ativo: true, controla_estoque: true, quantidade: 3 }, "somente_com_estoque")).toBe(true);
    expect(produtoDisponivel({ ativo: true, controla_estoque: false, quantidade: 0 }, "somente_com_estoque")).toBe(true);
  });

  it("padrão (ausente ou lixo) é somente com estoque — o comportamento de antes da chave", () => {
    expect(modoDeEstoqueDasSettings({})).toBe("somente_com_estoque");
    expect(modoDeEstoqueDasSettings(null)).toBe("somente_com_estoque");
    expect(modoDeEstoqueDasSettings({ catalogo: { modo_estoque: "xyz" } })).toBe("somente_com_estoque");
    expect(modoDeEstoqueDasSettings({ catalogo: { modo_estoque: "sem_controle" } })).toBe("sem_controle");
    expect(controlaEstoquePadrao("sem_controle")).toBe(false);
    expect(controlaEstoquePadrao("somente_com_estoque")).toBe(true);
  });
});

describe("busca da IA (crm_search_products)", () => {
  it("sem controle: produto ativo com quantidade 0 aparece disponível, sem quantidade na resposta", async () => {
    const { supabase } = bancoFalso({ [ORG_A]: modo("sem_controle") }, [P("A1", {})]);
    const r = await buscar(supabase);
    expect(r.produtos).toHaveLength(1);
    expect(r.produtos[0]).toMatchObject({ codigo: "A1", disponivel: true });
    expect(r.produtos[0]).not.toHaveProperty("quantidade");
  });

  it("sem controle: produto inativo continua fora", async () => {
    const { supabase } = bancoFalso({ [ORG_A]: modo("sem_controle") }, [P("A1", { ativo: false })]);
    const r = await buscar(supabase);
    expect(r.produtos).toHaveLength(0);
  });

  it("somente com estoque: quantidade 0 não é oferecido; 3 é; controla_estoque false é", async () => {
    const { supabase } = bancoFalso({ [ORG_A]: modo("somente_com_estoque") }, [
      P("A1", { quantidade: 0 }),
      P("A2", { quantidade: 3 }),
      P("A3", { quantidade: 0, controla_estoque: false }),
    ]);
    const r = await buscar(supabase);
    expect(r.produtos.map((p) => p.codigo).sort()).toEqual(["A2", "A3"]);
  });

  it("trocar a configuração muda a busca seguinte, sem cache", async () => {
    const orgs = { [ORG_A]: modo("somente_com_estoque") };
    const { supabase } = bancoFalso(orgs, [P("A1", {})]);
    expect((await buscar(supabase)).motivo).toBe("sem_estoque");
    orgs[ORG_A] = modo("sem_controle");
    expect((await buscar(supabase)).produtos).toHaveLength(1);
  });

  it("a configuração de uma empresa não afeta a outra", async () => {
    const { supabase } = bancoFalso({ [ORG_A]: modo("sem_controle"), [ORG_B]: modo(undefined) }, [
      P("A1", {}),
      P("B1", { organization_id: ORG_B }),
    ]);
    expect((await buscar(supabase, "produto", ORG_A)).produtos.map((p) => p.codigo)).toEqual(["A1"]);
    expect((await buscar(supabase, "produto", ORG_B)).motivo).toBe("sem_estoque");
  });
});

describe("GET /api/v1/products — campo `disponivel`", () => {
  it("sem controle: quantidade 0 vem com disponivel true; campos atuais seguem iguais", async () => {
    const { supabase } = bancoFalso({ [ORG_A]: modo("sem_controle") }, [P("A1", {})]);
    autorizar(supabase);
    const { GET } = await import("@/app/api/v1/products/route");
    const corpo = (await (await GET(req("http://localhost/api/v1/products"))).json()) as { data: Linha[] };
    expect(corpo.data[0]).toMatchObject({ codigo: "A1", quantidade: 0, controla_estoque: true, disponivel: true });
  });

  it("somente com estoque: quantidade 0 vem com disponivel false, 3 com true", async () => {
    const { supabase } = bancoFalso({ [ORG_A]: modo("somente_com_estoque") }, [
      P("A1", {}),
      P("A2", { quantidade: 3 }),
    ]);
    autorizar(supabase);
    const { GET } = await import("@/app/api/v1/products/route");
    const corpo = (await (await GET(req("http://localhost/api/v1/products?pagina=1"))).json()) as { data: Linha[] };
    expect(corpo.data.map((p) => [p.codigo, p.disponivel])).toEqual([
      ["A1", false],
      ["A2", true],
    ]);
  });
});

describe("POST /api/v1/products — padrão de `controla_estoque`", () => {
  const corpo = { nome: "Produto novo", preco_cents: 1000 };

  it.each([
    ["sem_controle", false],
    ["somente_com_estoque", true],
  ] as const)("sem o campo, empresa em %s grava controla_estoque %s", async (m, esperado) => {
    const { supabase, gravados } = bancoFalso({ [ORG_A]: modo(m) }, []);
    autorizar(supabase);
    const { POST } = await import("@/app/api/v1/products/route");
    expect((await POST(req("http://localhost/api/v1/products", "POST", corpo))).status).toBe(201);
    expect(gravados.insert).toMatchObject({ controla_estoque: esperado });
  });

  it.each([
    ["sem_controle", true],
    ["somente_com_estoque", false],
  ] as const)("com o campo, empresa em %s respeita o enviado (%s)", async (m, enviado) => {
    const { supabase, gravados } = bancoFalso({ [ORG_A]: modo(m) }, []);
    autorizar(supabase);
    const { POST } = await import("@/app/api/v1/products/route");
    await POST(req("http://localhost/api/v1/products", "POST", { ...corpo, controla_estoque: enviado }));
    expect(gravados.insert).toMatchObject({ controla_estoque: enviado });
  });
});

describe("PATCH /api/v1/products/:id — só `controla_estoque`", () => {
  it("grava só o campo enviado", async () => {
    const { supabase, gravados } = bancoFalso({ [ORG_A]: modo("sem_controle") }, []);
    autorizar(supabase);
    const { PATCH } = await import("@/app/api/v1/products/[id]/route");
    const r = await PATCH(req("http://localhost/api/v1/products/p1", "PATCH", { controla_estoque: false }), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(r.status).toBe(200);
    expect(gravados.update).toEqual({ controla_estoque: false });
  });
});
