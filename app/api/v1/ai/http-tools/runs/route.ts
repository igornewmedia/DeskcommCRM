/**
 * GET /api/v1/ai/http-tools/runs — histórico das execuções (manager+).
 *
 * Filtros: `tool_id`, `agent_id`, `conversation_id`, `status`, `limit` (1–200,
 * padrão 50) e `before` (ISO; a página seguinte começa antes do `created_at` da
 * última linha). O histórico só tem metadados — nomes de parâmetro, status,
 * tempo —, nunca valor, corpo ou credencial.
 *
 * shortcut: cursor é o `created_at` cru, não o opaco com HMAC; troca quando a
 * rota for exposta a bearer (hoje só a tela lê).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { COLUNAS_DO_HISTORICO } from "@/lib/ferramentas-http/repositorio";
import { STATUS_DA_EXECUCAO } from "@/lib/ferramentas-http/vocabulario";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { autorizar } from "../_comum";

export const dynamic = "force-dynamic";

const filtrosSchema = z.object({
  tool_id: z.uuid().optional(),
  agent_id: z.uuid().optional(),
  conversation_id: z.uuid().optional(),
  status: z.enum(STATUS_DA_EXECUCAO).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime({ offset: true }).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await autorizar(requestId);
  if (!authz.ok) return authz.response;

  const filtros = filtrosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filtros.success) {
    return fail("validation_failed", traduzir("Filtros inválidos.", authz.user.idioma), 422, {
      requestId,
      details: filtros.error.flatten(),
    });
  }
  const f = filtros.data;

  let q = createAdminClient()
    .from("ai_http_tool_runs")
    .select(COLUNAS_DO_HISTORICO)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(f.limit + 1);
  if (f.tool_id) q = q.eq("tool_id", f.tool_id);
  if (f.agent_id) q = q.eq("agent_id", f.agent_id);
  if (f.conversation_id) q = q.eq("conversation_id", f.conversation_id);
  if (f.status) q = q.eq("status", f.status);
  if (f.before) q = q.lt("created_at", f.before);

  const { data, error } = await q;
  if (error) return fail("internal_error", "Erro ao ler o histórico.", 500, { requestId });

  const linhas = (data ?? []) as Array<{ created_at: string }>;
  const pagina = linhas.slice(0, f.limit);
  const temMais = linhas.length > f.limit;
  return ok(pagina, {
    requestId,
    meta: { has_more: temMais, cursor: temMais ? (pagina.at(-1)?.created_at ?? null) : null },
  });
}
