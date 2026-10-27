/**
 * A gravação do modo de estoque da empresa: só manager+, org da sessão (nunca
 * do argumento), merge do jsonb preserva o resto, e a troca entra no audit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
  mfaEmDivida: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: mocks.loadAuthUser,
  resolveActiveOrg: mocks.resolveActiveOrg,
  mfaEmDivida: mocks.mfaEmDivida,
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { definirModoDeEstoque } from "./definirModoDeEstoque";

const ORG = "11111111-1111-4111-8111-111111111111";
const SETTINGS_ATUAL = { branding: { accent_hex: "#123456" }, catalogo: { outra: 1 } };

function adminQueGrava() {
  const updates: Array<{ payload: unknown; id: unknown }> = [];
  const admin = {
    from() {
      let payload: unknown = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.update = (p: unknown) => {
        payload = p;
        return b;
      };
      b.eq = (_c: string, id: unknown) => {
        if (payload !== null) {
          updates.push({ payload, id });
          return Promise.resolve({ error: null });
        }
        return b;
      };
      b.maybeSingle = async () => ({ data: { settings: structuredClone(SETTINGS_ATUAL) }, error: null });
      return b;
    },
  };
  mocks.createAdminClient.mockReturnValue(admin);
  return updates;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadAuthUser.mockResolvedValue({ id: "u1", support: null });
  mocks.mfaEmDivida.mockResolvedValue(false);
});

describe("definirModoDeEstoque", () => {
  it.each(["viewer", "agent"])("%s não consegue alterar", async (role) => {
    const updates = adminQueGrava();
    mocks.resolveActiveOrg.mockResolvedValue({ orgId: ORG, role });
    expect(await definirModoDeEstoque("sem_controle")).toEqual({ ok: false, error: "forbidden_role" });
    expect(updates).toHaveLength(0);
  });

  it("manager grava na org da sessão, preservando o resto do settings, e audita", async () => {
    const updates = adminQueGrava();
    mocks.resolveActiveOrg.mockResolvedValue({ orgId: ORG, role: "manager" });
    expect(await definirModoDeEstoque("sem_controle")).toEqual({ ok: true });
    expect(updates).toEqual([
      {
        id: ORG,
        payload: { settings: { ...SETTINGS_ATUAL, catalogo: { outra: 1, modo_estoque: "sem_controle" } } },
      },
    ]);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "settings.catalog_stock_mode_updated", organizationId: ORG }),
    );
  });

  it("valor fora da lista é recusado", async () => {
    const updates = adminQueGrava();
    mocks.resolveActiveOrg.mockResolvedValue({ orgId: ORG, role: "admin" });
    expect(await definirModoDeEstoque("tudo" as never)).toEqual({ ok: false, error: "validation_failed" });
    expect(updates).toHaveLength(0);
  });
});
