"use server";

/**
 * Grava os feriados da empresa (`organizations.settings.feriados`), que o agente
 * de IA lê no bloco `## Agora` (`lib/tempo/feriados.ts`). Mesmo molde de
 * `definirModoDeEstoque`: organização de `resolveActiveOrg`, nunca de argumento,
 * e mescla no jsonb para preservar as outras chaves. Configurações › Empresa é
 * admin, e a ação cobra o mesmo papel.
 */
import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHAVE_DOS_FERIADOS, configDeFeriadosSchema, type ConfigDeFeriados } from "@/lib/tempo/feriados";

export type ResultadoFeriados =
  | { ok: true }
  | {
      ok: false;
      error: "validation_failed" | "unauthenticated" | "forbidden_tenant" | "forbidden_role" | "mfa_required" | "erro_ao_gravar";
    };

export async function definirFeriados(entrada: ConfigDeFeriados): Promise<ResultadoFeriados> {
  const parsed = configDeFeriadosSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden_role" };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[org.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", org.orgId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, error: "erro_ao_gravar" };
  const settings = (atual?.settings ?? {}) as Record<string, unknown>;
  const { error } = await admin
    .from("organizations")
    .update({ settings: { ...settings, [CHAVE_DOS_FERIADOS]: parsed.data } })
    .eq("id", org.orgId);
  if (error) return { ok: false, error: "erro_ao_gravar" };

  await audit({
    action: "settings.holidays_updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "organization",
    resourceId: org.orgId,
    metadata: { ligado: parsed.data.ligado, nacionais: parsed.data.nacionais, proprios: parsed.data.proprios.length },
  });

  revalidatePath("/app/settings/tenant");
  return { ok: true };
}
