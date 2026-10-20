import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/trade-in-devices — aparelhos que a loja aceita na troca (viewer+).
 * POST /api/v1/trade-in-devices — cadastra um aparelho (manager+).
 *
 * Mesmo molde de `/api/v1/products`: ler é operação, mudar valor de abatimento
 * é de quem decide preço. A RLS cobra o mesmo papel (migration 9003).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { traduzir } from "@/lib/i18n/dicionario";
import { aparelhoDeTrocaCreateSchema, COLUNAS_DO_APARELHO } from "@/lib/schemas/aparelhos-de-troca";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "catalog_trade_in_devices" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_trade_in_devices")
    .select(COLUNAS_DO_APARELHO)
    .eq("organization_id", authz.org.orgId)
    .order("ativo", { ascending: false })
    .order("modelo")
    .limit(500);
  if (error) return fail("internal_error", "Erro ao listar os aparelhos.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_trade_in_devices" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = aparelhoDeTrocaCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const moeda = await moedaDaOrganizacao(supabase, authz.org.orgId);
  const { data, error } = await supabase
    .from("catalog_trade_in_devices")
    .insert({ ...parsed.data, capacidade: parsed.data.capacidade || null, moeda, organization_id: authz.org.orgId })
    .select(COLUNAS_DO_APARELHO)
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("conflict", t("Esse aparelho já está cadastrado."), 409, { requestId });
    }
    return fail("internal_error", "Erro ao salvar o aparelho.", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_trade_in_device.created",
    resourceType: "catalog_trade_in_devices",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });
  return ok(data, { requestId, status: 201 });
}
