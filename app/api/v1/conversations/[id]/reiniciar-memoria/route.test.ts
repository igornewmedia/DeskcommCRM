import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

/**
 * POST /api/v1/conversations/:id/reiniciar-memoria — o papel (manager), a
 * organização da sessão em toda leitura e chamada, o fechamento do atendimento
 * antes do reinício e a auditoria. O efeito no banco é medido em
 * `tests/invariants/reiniciar-memoria-da-ia.test.ts`.
 */
const ORG = "22222222-2222-4222-8222-222222222222";
const CONV = "55555555-5555-4555-8555-555555555555";
const CONTATO = "66666666-6666-4666-8666-666666666666";

let conversa: Record<string, unknown> | null;
let filtros: Array<[string, unknown]>;
let rpcs: Array<[string, Record<string, unknown>]>;

beforeEach(() => {
  vi.clearAllMocks();
  filtros = [];
  rpcs = [];
  conversa = { id: CONV, contact_id: CONTATO, status: "open", service_revision: 3, is_group: false };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    org: { orgId: ORG },
    user: { id: "u1", idioma: "pt-BR" },
  } as never);
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      filtros.push([c, v]);
      return q;
    },
    maybeSingle: async () => ({ data: conversa, error: null }),
  };
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => q,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push([nome, args]);
      return { data: nome === "fn_reiniciar_memoria_da_ia" ? { checkpoints: 1, notas: 2 } : {}, error: null };
    },
  } as never);
});

const ctx = { params: Promise.resolve({ id: CONV }) };
const pedido = () => new NextRequest(`http://localhost/api/v1/conversations/${CONV}/reiniciar-memoria`, { method: "POST" });

describe("reiniciar memória da IA", () => {
  it("exige manager", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const { POST } = await import("./route");
    expect((await POST(pedido(), ctx)).status).toBe(403);
    expect(vi.mocked(requireRole)).toHaveBeenCalledWith("manager", expect.anything());
  });

  it("fecha o atendimento, reinicia na organização da sessão e audita", async () => {
    const { POST } = await import("./route");
    const r = await POST(pedido(), ctx);
    expect(r.status).toBe(200);
    expect(filtros).toContainEqual(["organization_id", ORG]);
    expect(rpcs.map(([n]) => n)).toEqual(["fn_service_status", "fn_reiniciar_memoria_da_ia"]);
    expect(rpcs[0]![1]).toMatchObject({ p_org: ORG, p_conversation: CONV, p_status: "closed", p_expected: 3 });
    expect(rpcs[1]![1]).toEqual({ p_org: ORG, p_contact: CONTATO });
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.memory_reset", organizationId: ORG, resourceId: CONTATO }),
    );
  });

  it("conversa já fechada não é fechada de novo", async () => {
    conversa = { ...conversa!, status: "closed" };
    const { POST } = await import("./route");
    await POST(pedido(), ctx);
    expect(rpcs.map(([n]) => n)).toEqual(["fn_reiniciar_memoria_da_ia"]);
  });

  it("conversa de outra organização (ou de grupo) é 404, sem efeito", async () => {
    conversa = null;
    const { POST } = await import("./route");
    expect((await POST(pedido(), ctx)).status).toBe(404);
    expect(rpcs).toHaveLength(0);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});
