/**
 * Peças comuns às rotas de ferramentas HTTP: o gate de papel, o limite de
 * escrita e a leitura do corpo com o segredo SEPARADO do cadastro.
 *
 * O segredo chega em `secret` e nunca volta: a resposta só traz `secret_last4`.
 * Separado porque o cadastro é validado por `ferramentaHttpSchema` (que tem
 * refinamentos e não aceita `.extend`), e porque um campo que só entra não deve
 * morar no mesmo tipo do que sai.
 */
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export const RECURSO = "ai_http_tools";

const segredoSchema = z.string().min(1).max(4096).optional();

export async function autorizar(requestId: string) {
  return requireRole("manager", { requestId, resource: RECURSO });
}

export async function limiteDeEscrita(orgId: string, requestId: string, idioma: Idioma) {
  const limite = await checkRateLimit(`http-tools:write:${orgId}`, 30, 60);
  if (limite.allowed) return null;
  return fail("rate_limited", traduzir("Muitas alterações em pouco tempo. Tente de novo em instantes.", idioma), 429, {
    requestId,
  });
}

export type CorpoLido =
  | { ok: true; corpo: Record<string, unknown>; segredo: string | undefined }
  | { ok: false; response: Response };

export async function lerCorpo(req: Request, requestId: string, idioma: Idioma): Promise<CorpoLido> {
  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return { ok: false, response: fail("invalid_request", traduzir("Body JSON inválido.", idioma), 400, { requestId }) };
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, response: fail("invalid_request", traduzir("Body JSON inválido.", idioma), 400, { requestId }) };
  }
  const { secret, ...corpo } = bruto as Record<string, unknown>;
  const segredo = segredoSchema.safeParse(secret === "" || secret === null ? undefined : secret);
  if (!segredo.success) {
    return {
      ok: false,
      response: fail("validation_failed", traduzir("Credencial inválida.", idioma), 422, {
        requestId,
        details: { secret: ["de 1 a 4096 caracteres"] },
      }),
    };
  }
  return { ok: true, corpo, segredo: segredo.data };
}
