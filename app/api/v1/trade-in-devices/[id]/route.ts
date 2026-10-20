import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH  /api/v1/trade-in-devices/:id — altera um aparelho de troca (manager+).
 * DELETE /api/v1/trade-in-devices/:id — remove (manager+).
 *
 * `maybeSingle` vazio = a RLS barrou ou o id é de outra org: 404 e sem auditoria
 * de mutação que não aconteceu.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { aparelhoDeTrocaPatchSchema, COLUNAS_DO_APARELHO } from "@/lib/schemas/aparelhos-de-troca";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_trade_in_devices" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;

  const parsed = aparelhoDeTrocaPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail("validation_failed", t("Nada para alterar."), 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_trade_in_devices")
    .update(parsed.data.capacidade === "" ? { ...parsed.data, capacidade: null } : parsed.data)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS_DO_APARELHO)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return fail("conflict", t("Esse aparelho já está cadastrado."), 409, { requestId });
    }
    return fail("internal_error", "Erro ao salvar o aparelho.", 500, { requestId });
  }
  if (!data) return fail("not_found", t("Aparelho não encontrado."), 404, { requestId });

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_trade_in_device.updated",
    resourceType: "catalog_trade_in_devices",
    resourceId: id,
    requestId,
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_trade_in_devices" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_trade_in_devices")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao remover o aparelho.", 500, { requestId });
  if (!data) return fail("not_found", t("Aparelho não encontrado."), 404, { requestId });

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_trade_in_device.deleted",
    resourceType: "catalog_trade_in_devices",
    resourceId: id,
    requestId,
  });
  return ok({ id }, { requestId });
}
