import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET    /api/v1/ai/http-tools/:id — uma ferramenta (manager+).
 * PATCH  /api/v1/ai/http-tools/:id — edita (manager+).
 * DELETE /api/v1/ai/http-tools/:id — exclui, LOGICAMENTE (manager+).
 *
 * O PATCH junta o que veio com o que está gravado e valida o cadastro INTEIRO:
 * os refinamentos (placeholder declarado, GET sem corpo, API Key com cabeçalho)
 * cruzam campos, e validar só o pedaço deixaria passar a combinação inválida.
 *
 * Credencial: `secret` presente troca; ausente mantém; autenticação trocada para
 * "nenhuma" apaga. Ligar autenticação sem credencial gravada nem enviada = 422.
 *
 * Excluir é `deleted_at`: o histórico continua apontando, e um agente que ainda
 * tenha `http:<id>` publicado simplesmente deixa de montar a ferramenta.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { COLUNAS_PUBLICAS, lerFerramenta } from "@/lib/ferramentas-http/repositorio";
import { ferramentaHttpSchema } from "@/lib/ferramentas-http/schema";
import { cifrarSegredo, SEGREDO_APAGADO } from "@/lib/ferramentas-http/segredo";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

import { autorizar, lerCorpo, limiteDeEscrita } from "../_comum";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f-]{36}$/i;

function naoEncontrada(requestId: string, idioma: Idioma) {
  return fail("not_found", traduzir("Ferramenta não encontrada.", idioma), 404, { requestId });
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await autorizar(requestId);
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return naoEncontrada(requestId, authz.user.idioma);

  const linha = await lerFerramenta(createAdminClient(), authz.org.orgId, id);
  if (!linha) return naoEncontrada(requestId, authz.user.idioma);
  return ok(linha, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await autorizar(requestId);
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);
  const { id } = await ctx.params;
  if (!UUID.test(id)) return naoEncontrada(requestId, user.idioma);

  const limitado = await limiteDeEscrita(org.orgId, requestId, user.idioma);
  if (limitado) return limitado;

  const lido = await lerCorpo(req, requestId, user.idioma);
  if (!lido.ok) return lido.response;

  const admin = createAdminClient();
  const atual = await lerFerramenta(admin, org.orgId, id);
  if (!atual) return naoEncontrada(requestId, user.idioma);

  const {
    id: _id,
    organization_id: _org,
    secret_last4,
    created_by: _cb,
    updated_by: _ub,
    created_at: _ca,
    updated_at: _ua,
    ...cadastroAtual
  } = atual;
  const parsed = ferramentaHttpSchema.safeParse({ ...cadastroAtual, ...lido.corpo });
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;

  let segredo: Record<string, string | null> = {};
  if (input.auth_type === "none") {
    segredo = { ...SEGREDO_APAGADO };
  } else if (lido.segredo) {
    segredo = { ...cifrarSegredo(lido.segredo) };
  } else if (!secret_last4) {
    return fail("http_tool_sem_segredo", t("Informe a credencial da autenticação escolhida."), 422, {
      requestId,
    });
  }

  const { data: salva, error } = await admin
    .from("ai_http_tools")
    .update({ ...input, ...segredo, updated_by: user.id })
    .eq("organization_id", org.orgId)
    .eq("id", id)
    .is("deleted_at", null)
    .select(COLUNAS_PUBLICAS)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return fail("http_tool_slug_em_uso", t("Já existe uma ferramenta com este nome interno."), 409, {
        requestId,
      });
    }
    return fail("internal_error", "Erro ao salvar ferramenta.", 500, { requestId });
  }
  if (!salva) return naoEncontrada(requestId, user.idioma);

  await audit({
    action: "ai_http_tool.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "ai_http_tool",
    resourceId: id,
    requestId,
    metadata: {
      campos: Object.keys(lido.corpo).filter((k) => k in input),
      credencial_trocada: Boolean(lido.segredo) || input.auth_type === "none",
    },
  });

  return ok(salva, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await autorizar(requestId);
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return naoEncontrada(requestId, user.idioma);

  const limitado = await limiteDeEscrita(org.orgId, requestId, user.idioma);
  if (limitado) return limitado;

  const { data, error } = await createAdminClient()
    .from("ai_http_tools")
    .update({ deleted_at: new Date().toISOString(), is_active: false, updated_by: user.id })
    .eq("organization_id", org.orgId)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, slug")
    .maybeSingle<{ id: string; slug: string }>();
  if (error) return fail("internal_error", "Erro ao excluir ferramenta.", 500, { requestId });
  if (!data) return naoEncontrada(requestId, user.idioma);

  await audit({
    action: "ai_http_tool.deleted",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "ai_http_tool",
    resourceId: id,
    requestId,
    metadata: { slug: data.slug },
  });

  return ok({ id, deleted: true }, { requestId });
}
