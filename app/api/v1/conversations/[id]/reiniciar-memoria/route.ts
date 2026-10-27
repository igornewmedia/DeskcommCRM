import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/:id/reiniciar-memoria — "Reiniciar memória da IA"
 * do contato desta conversa (manager+), para testar um agente do zero.
 *
 * 1. Fecha o atendimento atual (`fn_service_status`, o mesmo do botão
 *    Encerrar): o histórico que o agente lê é o do atendimento, então as
 *    mensagens antigas saem do contexto sem ser apagadas.
 * 2. `fn_reiniciar_memoria_da_ia` (migration 5004): apaga checkpoint, resumo
 *    acumulado e notas do lead, volta o funil do agente para `new` e grava a
 *    data de corte que tira do contexto os desfechos anteriores.
 *
 * Não mexe no que é do CRM (negócios, propostas, atividades) nem no
 * `force_human` (passagem para humano é irrevogável; "Devolver ao automático"
 * é o caminho para isso).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const orgId = authz.org.orgId;

  // Service role: a organização vem da sessão validada, nunca do corpo.
  const admin = createAdminClient();
  const { data: conversa, error: erroDeLeitura } = await admin
    .from("conversations")
    .select("id, contact_id, status, service_revision, is_group")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (erroDeLeitura) return fail("internal_error", "Erro ao ler a conversa.", 500, { requestId });
  const c = conversa as {
    id: string;
    contact_id: string;
    status: string;
    service_revision: number;
    is_group: boolean;
  } | null;
  if (!c || c.is_group) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  if (c.status !== "closed") {
    const { error } = await admin.rpc("fn_service_status", {
      p_org: orgId,
      p_conversation: c.id,
      p_status: "closed",
      p_expected: c.service_revision,
    });
    if (error) {
      const conflito = error.code === "PT409" || error.code === "40001";
      return fail(
        conflito ? "conflict" : "internal_error",
        conflito ? t("O atendimento mudou. Atualize e tente novamente.") : "Erro ao fechar o atendimento.",
        conflito ? 409 : 500,
        { requestId },
      );
    }
  }

  const { data: resumo, error } = await admin.rpc("fn_reiniciar_memoria_da_ia", {
    p_org: orgId,
    p_contact: c.contact_id,
  });
  if (error) return fail("internal_error", "Erro ao reiniciar a memória da IA.", 500, { requestId });

  await audit({
    organizationId: orgId,
    actorUserId: authz.user.id,
    action: "ai.memory_reset",
    resourceType: "contact",
    resourceId: c.contact_id,
    requestId,
    metadata: { conversation_id: c.id, ...(resumo as Record<string, unknown>) },
  });
  return ok({ conversation_id: c.id, contact_id: c.contact_id, ...(resumo as Record<string, unknown>) }, { requestId });
}
