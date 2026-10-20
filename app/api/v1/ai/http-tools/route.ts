import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/ai/http-tools — as ferramentas HTTP da organização ativa (manager+).
 * POST /api/v1/ai/http-tools — cria uma ferramenta (manager+).
 *
 * Quem vê e quem configura é o mesmo papel do editor de agente (manager): a
 * ferramenta só existe para ser ligada a um agente. A credencial entra por
 * `secret`, é cifrada aqui e nunca volta — a resposta traz `secret_last4`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { COLUNAS_PUBLICAS } from "@/lib/ferramentas-http/repositorio";
import { ferramentaHttpSchema } from "@/lib/ferramentas-http/schema";
import { cifrarSegredo } from "@/lib/ferramentas-http/segredo";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { autorizar, lerCorpo, limiteDeEscrita } from "./_comum";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await autorizar(requestId);
  if (!authz.ok) return authz.response;

  const { data, error } = await createAdminClient()
    .from("ai_http_tools")
    .select(COLUNAS_PUBLICAS)
    .eq("organization_id", authz.org.orgId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) return fail("internal_error", "Erro ao listar ferramentas.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await autorizar(requestId);
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);

  const limitado = await limiteDeEscrita(org.orgId, requestId, user.idioma);
  if (limitado) return limitado;

  const lido = await lerCorpo(req, requestId, user.idioma);
  if (!lido.ok) return lido.response;

  const parsed = ferramentaHttpSchema.safeParse(lido.corpo);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;
  if (input.auth_type !== "none" && !lido.segredo) {
    return fail("http_tool_sem_segredo", t("Informe a credencial da autenticação escolhida."), 422, {
      requestId,
    });
  }

  const { data: criada, error } = await createAdminClient()
    .from("ai_http_tools")
    .insert({
      ...input,
      organization_id: org.orgId,
      ...(input.auth_type !== "none" && lido.segredo ? cifrarSegredo(lido.segredo) : {}),
      created_by: user.id,
      updated_by: user.id,
    })
    .select(COLUNAS_PUBLICAS)
    .single<{ id: string }>();

  if (error || !criada) {
    if (error?.code === "23505") {
      return fail("http_tool_slug_em_uso", t("Já existe uma ferramenta com este nome interno."), 409, {
        requestId,
      });
    }
    return fail("internal_error", "Erro ao criar ferramenta.", 500, { requestId });
  }

  await audit({
    action: "ai_http_tool.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "ai_http_tool",
    resourceId: criada.id,
    requestId,
    metadata: { slug: input.slug, method: input.method, auth_type: input.auth_type, effect: input.effect },
  });

  return ok(criada, { status: 201, requestId });
}
