import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH  /api/v1/product-attributes/:id — altera rótulo, descrição, visibilidade,
 *        busca, ordem ou opções (manager+). Chave e tipo não mudam.
 * DELETE /api/v1/product-attributes/:id — remove o atributo e apaga o valor dele
 *        dos produtos da organização (manager+).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { atributoPatchSchema, COLUNAS_DO_ATRIBUTO } from "@/lib/schemas/atributos-de-produto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_product_attributes" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;

  const parsed = atributoPatchSchema.safeParse(await req.json().catch(() => null));
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
    .from("catalog_product_attributes")
    .update(parsed.data.descricao_ia === "" ? { ...parsed.data, descricao_ia: null } : parsed.data)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS_DO_ATRIBUTO)
    .maybeSingle();
  if (error) {
    // 23514 = a lista ficou sem opção (CHECK da migration 5002).
    if (error.code === "23514") {
      return fail("validation_failed", t("Uma lista precisa de ao menos uma opção."), 422, { requestId });
    }
    return fail("internal_error", "Erro ao salvar o atributo.", 500, { requestId });
  }
  if (!data) return fail("not_found", t("Atributo não encontrado."), 404, { requestId });

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_product_attribute.updated",
    resourceType: "catalog_product_attributes",
    resourceId: id,
    requestId,
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_product_attributes" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_product_attributes")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select("chave")
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao remover o atributo.", 500, { requestId });
  if (!data) return fail("not_found", t("Atributo não encontrado."), 404, { requestId });

  // O valor some dos produtos: uma chave recriada depois com outro tipo não pode
  // herdar o valor antigo.
  const chave = (data as { chave: string }).chave;
  const { data: comValor } = await supabase
    .from("catalog_products")
    .select("id, atributos")
    .eq("organization_id", authz.org.orgId)
    .not(`atributos->${chave}`, "is", null);
  // shortcut: um UPDATE por produto que tinha o valor; trocar por RPC se uma org passar de alguns milhares.
  for (const p of (comValor ?? []) as Array<{ id: string; atributos: Record<string, unknown> }>) {
    const { [chave]: _removido, ...resto } = p.atributos ?? {};
    await supabase
      .from("catalog_products")
      .update({ atributos: resto })
      .eq("organization_id", authz.org.orgId)
      .eq("id", p.id);
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_product_attribute.deleted",
    resourceType: "catalog_product_attributes",
    resourceId: id,
    requestId,
    metadata: { chave, produtos_limpos: (comValor ?? []).length },
  });
  return ok({ id }, { requestId });
}
