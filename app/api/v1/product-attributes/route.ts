import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/product-attributes — atributos personalizados de produto da organização (viewer+).
 * POST /api/v1/product-attributes — cria um atributo (manager+), até LIMITE_DE_ATRIBUTOS.
 *
 * Mesmo molde de `/api/v1/trade-in-devices`; a RLS cobra o mesmo papel (migration 5002).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  atributoCreateSchema,
  COLUNAS_DO_ATRIBUTO,
  LIMITE_DE_ATRIBUTOS,
} from "@/lib/schemas/atributos-de-produto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "catalog_product_attributes" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_product_attributes")
    .select(COLUNAS_DO_ATRIBUTO)
    .eq("organization_id", authz.org.orgId)
    .order("ordem")
    .order("rotulo");
  if (error) return fail("internal_error", "Erro ao listar os atributos.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_product_attributes" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = atributoCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("catalog_product_attributes")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", authz.org.orgId);
  // shortcut: contagem e insert não são atômicos; dois cliques simultâneos podem passar de 30 por um.
  if ((count ?? 0) >= LIMITE_DE_ATRIBUTOS) {
    return fail("conflict", t("Limite de 30 atributos por organização."), 409, { requestId });
  }

  const opcoes = parsed.data.tipo === "lista" ? parsed.data.opcoes : [];
  const { data, error } = await supabase
    .from("catalog_product_attributes")
    .insert({ ...parsed.data, opcoes, descricao_ia: parsed.data.descricao_ia || null, organization_id: authz.org.orgId })
    .select(COLUNAS_DO_ATRIBUTO)
    .single();
  if (error) {
    if (error.code === "23505") return fail("conflict", t("Já existe um atributo com essa chave."), 409, { requestId });
    return fail("internal_error", "Erro ao salvar o atributo.", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_product_attribute.created",
    resourceType: "catalog_product_attributes",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });
  return ok(data, { requestId, status: 201 });
}
