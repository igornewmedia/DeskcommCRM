/**
 * PUT/PATCH/DELETE /api/v1/products/:id — o que a rota faz com a identidade que
 * o `resolveAuthDual` entregou (a resolução do Bearer tem teste próprio). O
 * caso que importa é a automação do fornecedor: entra por token `dsk_`, e a
 * organização vem do token, nunca do corpo.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { apagarDoBucket } from "@/lib/catalogo/fotos-no-bucket";
import { isPublicPath } from "@/lib/auth/public-paths";

vi.mock("@/lib/api/auth-dual", () => ({ resolveAuthDual: vi.fn(), tetoDeEscritaDoToken: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/catalogo/fotos-no-bucket", () => ({ apagarDoBucket: vi.fn(async () => undefined) }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const TOKEN_ID = "44444444-4444-4444-8444-444444444444";
const PRODUTO_ID = "55555555-5555-4555-8555-555555555555";

let atualizado: Record<string, unknown> | null;
let filtros: Record<string, unknown>;
let linhaExiste: boolean;
let atributosAtuais: Record<string, unknown>;

const DEFS = [
  { id: "a1", chave: "pronta_entrega", rotulo: "Pronta entrega", tipo: "booleano", descricao_ia: null, visivel_ia: true, pesquisavel: false, ordem: 0, opcoes: [] },
  { id: "a2", chave: "preco_cartao_cents", rotulo: "Preço no cartão", tipo: "moeda", descricao_ia: null, visivel_ia: true, pesquisavel: false, ordem: 1, opcoes: [] },
];

function supabaseFalso() {
  const cadeia = (resultado: () => unknown) => {
    const c = {
      eq: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return c;
      },
      select: () => c,
      maybeSingle: async () => ({ data: linhaExiste ? resultado() : null, error: null }),
    };
    return c;
  };
  const lista = (dados: unknown[]) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      maybeSingle: async () => ({ data: dados[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => ok({ data: dados, error: null }),
    };
    return q;
  };
  return {
    from: (tabela: string) => tabela === "catalog_product_attributes" ? lista(DEFS) : ({
      select: () => lista([{ atributos: atributosAtuais }]),
      update: (dados: Record<string, unknown>) => {
        atualizado = dados;
        return cadeia(() => ({ id: PRODUTO_ID, ...dados }));
      },
      delete: () => cadeia(() => ({ id: PRODUTO_ID, fotos: ["f1.jpg"] })),
    }),
  };
}

function pedido(metodo: string, corpo?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/products/${PRODUTO_ID}`, {
    method: metodo,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "content-type": "application/json", authorization: "Bearer dsk_teste" },
  });
}

const ctx = { params: Promise.resolve({ id: PRODUTO_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  atualizado = null;
  filtros = {};
  linhaExiste = true;
  atributosAtuais = { pronta_entrega: true, preco_cartao_cents: 785100 };
  vi.mocked(tetoDeEscritaDoToken).mockResolvedValue(null);
  vi.mocked(resolveAuthDual).mockResolvedValue({
    ok: true,
    organizationId: ORG_ID,
    actor: { type: "api_token", id: TOKEN_ID },
    supabase: supabaseFalso(),
    via: "token",
    apiTokenId: TOKEN_ID,
  } as never);
});

describe("PUT /api/v1/products/:id — substitui o produto inteiro", () => {
  it("zera os opcionais que não vieram e mantém o código atual", async () => {
    const { PUT } = await import("./route");
    const r = await PUT(pedido("PUT", { nome: "iPhone 17 Pro Max 256GB", preco_cents: 899000 }), ctx);

    expect(r.status).toBe(200);
    expect(atualizado).toMatchObject({
      nome: "iPhone 17 Pro Max 256GB",
      preco_cents: 899000,
      cor: null,
      capacidade: null,
      descricao: null,
      custo_cents: null,
      quantidade: 0,
      ativo: true,
    });
    // O código é a chave que a automação compara; PUT sem ele não o apaga.
    expect(atualizado).not.toHaveProperty("codigo");
  });

  it("a organização vem do token, não do corpo", async () => {
    const { PUT } = await import("./route");
    await PUT(
      pedido("PUT", { nome: "iPad Air M4", preco_cents: 500000, organization_id: OUTRA_ORG }),
      ctx,
    );

    expect(filtros.organization_id).toBe(ORG_ID);
    expect(atualizado).not.toHaveProperty("organization_id");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, actorApiTokenId: TOKEN_ID, actorUserId: null }),
    );
  });

  it("recusa corpo sem os campos obrigatórios (422)", async () => {
    const { PUT } = await import("./route");
    const r = await PUT(pedido("PUT", { cor: "Prata" }), ctx);
    expect(r.status).toBe(422);
    expect(atualizado).toBeNull();
  });

  it("produto de outra organização ou inexistente é 404 e não audita", async () => {
    linhaExiste = false;
    const { PUT } = await import("./route");
    const r = await PUT(pedido("PUT", { nome: "Mac Mini M4", preco_cents: 400000 }), ctx);
    expect(r.status).toBe(404);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/products/:id — muda só o que veio", () => {
  it("não encosta nos campos ausentes", async () => {
    const { PATCH } = await import("./route");
    const r = await PATCH(pedido("PATCH", { preco_cents: 799000 }), ctx);
    expect(r.status).toBe(200);
    expect(atualizado).toEqual({ preco_cents: 799000 });
  });
});

describe("atributos personalizados (migration 5002)", () => {
  it("PATCH de uma chave preserva as outras", async () => {
    const { PATCH } = await import("./route");
    const r = await PATCH(pedido("PATCH", { atributos: { preco_cartao_cents: 799000 } }), ctx);
    expect(r.status).toBe(200);
    expect(atualizado).toEqual({ atributos: { pronta_entrega: true, preco_cartao_cents: 799000 } });
  });

  it("PATCH com null apaga só aquela chave", async () => {
    const { PATCH } = await import("./route");
    await PATCH(pedido("PATCH", { atributos: { pronta_entrega: null } }), ctx);
    expect(atualizado).toEqual({ atributos: { preco_cartao_cents: 785100 } });
  });

  it("PUT substitui o objeto inteiro", async () => {
    const { PUT } = await import("./route");
    await PUT(pedido("PUT", { nome: "iPhone 17", preco_cents: 1, atributos: { pronta_entrega: false } }), ctx);
    expect(atualizado?.atributos).toEqual({ pronta_entrega: false });
  });

  it("PUT sem atributos zera o objeto", async () => {
    const { PUT } = await import("./route");
    await PUT(pedido("PUT", { nome: "iPhone 17", preco_cents: 1 }), ctx);
    expect(atualizado?.atributos).toEqual({});
  });

  it("valor de tipo errado é 422 e não grava", async () => {
    const { PATCH } = await import("./route");
    const r = await PATCH(pedido("PATCH", { atributos: { pronta_entrega: "sim" } }), ctx);
    expect(r.status).toBe(422);
    expect(atualizado).toBeNull();
  });

  it("chave que a organização não definiu é 422", async () => {
    const { PATCH } = await import("./route");
    const r = await PATCH(pedido("PATCH", { atributos: { outra_org: 1 } }), ctx);
    expect(r.status).toBe(422);
  });
});

describe("DELETE /api/v1/products/:id", () => {
  it("remove, apaga as fotos e audita com o token", async () => {
    const { DELETE } = await import("./route");
    const r = await DELETE(pedido("DELETE"), ctx);
    expect(r.status).toBe(200);
    expect(filtros).toMatchObject({ organization_id: ORG_ID, id: PRODUTO_ID });
    expect(vi.mocked(apagarDoBucket)).toHaveBeenCalledWith(ORG_ID, PRODUTO_ID, ["f1.jpg"], expect.any(String));
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "catalog_product.deleted", actorApiTokenId: TOKEN_ID }),
    );
  });

  it("inexistente é 404, sem apagar foto nem auditar", async () => {
    linhaExiste = false;
    const { DELETE } = await import("./route");
    const r = await DELETE(pedido("DELETE"), ctx);
    expect(r.status).toBe(404);
    expect(vi.mocked(apagarDoBucket)).not.toHaveBeenCalled();
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});

describe("autorização", () => {
  it("recusa do auth-dual (sem escopo, papel baixo) volta como está", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { DELETE, PUT } = await import("./route");
    expect((await DELETE(pedido("DELETE"), ctx)).status).toBe(403);
    expect((await PUT(pedido("PUT", { nome: "x2", preco_cents: 1 }), ctx)).status).toBe(403);
    expect(atualizado).toBeNull();
  });

  it("o teto de escrita do token barra antes de mexer no banco", async () => {
    vi.mocked(tetoDeEscritaDoToken).mockResolvedValue(new Response(null, { status: 429 }));
    const { PATCH } = await import("./route");
    expect((await PATCH(pedido("PATCH", { preco_cents: 1 }), ctx)).status).toBe(429);
    expect(atualizado).toBeNull();
  });

  it("o proxy deixa passar só /products/<uuid>, não /import nem /fotos", () => {
    expect(isPublicPath(`/api/v1/products/${PRODUTO_ID}`)).toBe(true);
    expect(isPublicPath("/api/v1/products/import")).toBe(false);
    expect(isPublicPath(`/api/v1/products/${PRODUTO_ID}/fotos`)).toBe(false);
  });
});
