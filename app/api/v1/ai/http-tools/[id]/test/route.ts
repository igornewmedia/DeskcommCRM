import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/http-tools/:id/test — o botão "Testar ferramenta" (manager+).
 *
 * Corpo: `{ "args": { ...valores de exemplo } }`. Faz a chamada DE VERDADE, pela
 * mesma porta anti-SSRF do turno, e devolve o que a tela precisa: status HTTP,
 * tempo, requisição enviada (credencial mascarada), corpo devolvido, erros, o
 * resultado da validação e o que o agente receberia (`para_o_modelo`).
 *
 * 200 mesmo quando a chamada FALHA: o resultado é dado para a tela, não erro do
 * pedido (mesma postura do teste de banco externo). Testa também ferramenta
 * inativa — é para isso que se testa antes de ligar.
 *
 * É efeito (uma ferramenta de ação muda o sistema de fora), por isso declara
 * `requireSupportWrite` e tem limite próprio. O histórico guarda a execução com
 * `origin = teste`, só com os NOMES dos parâmetros.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { executarFerramentaHttp } from "@/lib/ferramentas-http/executar";
import { respostaParaOModelo } from "@/lib/ferramentas-http/para-o-modelo";
import { carregarParaExecutar, registrarExecucao } from "@/lib/ferramentas-http/repositorio";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { autorizar } from "../../_comum";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ args: z.record(z.string(), z.unknown()).default({}) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await autorizar(requestId);
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("not_found", t("Ferramenta não encontrada."), 404, { requestId });

  const limite = await checkRateLimit(`http-tools:test:${org.orgId}`, 10, 60);
  if (!limite.allowed) {
    return fail("rate_limited", t("Muitos testes seguidos. Tente de novo em instantes."), 429, { requestId });
  }

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    bruto = {};
  }
  const corpo = corpoSchema.safeParse(bruto ?? {});
  if (!corpo.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, { requestId, details: corpo.error.flatten() });
  }

  const admin = createAdminClient();
  const ferramenta = await carregarParaExecutar(admin, org.orgId, id);
  if (!ferramenta) return fail("not_found", t("Ferramenta não encontrada."), 404, { requestId });

  const resultado = await executarFerramentaHttp(ferramenta.cadastro, corpo.data.args, {
    segredo: ferramenta.segredo,
  });

  await registrarExecucao(admin, {
    organizationId: org.orgId,
    toolId: id,
    origin: "teste",
    status: resultado.status,
    httpStatus: resultado.httpStatus,
    duracaoMs: resultado.duracaoMs,
    tentativas: resultado.tentativas,
    paramNames: Object.keys(corpo.data.args),
    bytes: resultado.bytes,
    erro: resultado.erro,
    createdBy: user.id,
  });

  await audit({
    action: "ai_http_tool.tested",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "ai_http_tool",
    resourceId: id,
    requestId,
    metadata: { status: resultado.status, http_status: resultado.httpStatus ?? null },
  });

  return ok(
    {
      status: resultado.status,
      ok: resultado.ok,
      http_status: resultado.httpStatus ?? null,
      duration_ms: resultado.duracaoMs,
      attempts: resultado.tentativas,
      request: resultado.requisicao ?? null,
      response_bytes: resultado.bytes ?? null,
      truncated: resultado.truncada ?? false,
      empty: resultado.vazia ?? false,
      data: resultado.dados ?? null,
      error: resultado.erro ?? null,
      validation: resultado.problemas ?? [],
      para_o_modelo: respostaParaOModelo(resultado, ferramenta.linha.response_instructions),
    },
    { requestId },
  );
}
