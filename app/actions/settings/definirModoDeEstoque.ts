"use server";

/**
 * Grava como a IA desta empresa trata o estoque. O que cada modo decide e o
 * padrão estão em `lib/catalogo/modo-de-estoque.ts`; aqui só a gravação.
 *
 * ⚠️ SERVICE ROLE COM `organization_id` DE FONTE CONFIÁVEL, como
 * `definirAiDecideDaEmpresa`: o id vem de `resolveActiveOrg`, nunca de
 * argumento. `settings` é jsonb compartilhado: ler, mesclar nos dois níveis e
 * gravar preserva o que não é desta chave.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { CHAVE_DO_CATALOGO, MODOS_DE_ESTOQUE, type ModoDeEstoque } from "@/lib/catalogo/modo-de-estoque";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export type ResultadoModoDeEstoque =
  | { ok: true }
  | {
      ok: false;
      error:
        | "validation_failed"
        | "unauthenticated"
        | "forbidden_tenant"
        | "forbidden_role"
        | "mfa_required"
        | "erro_ao_gravar";
    };

export async function definirModoDeEstoque(modo: ModoDeEstoque): Promise<ResultadoModoDeEstoque> {
  // Server Action é endpoint público: o tipo do parâmetro não chega ao servidor.
  const entrada = z.enum(MODOS_DE_ESTOQUE).safeParse(modo);
  if (!entrada.success) return { ok: false, error: "validation_failed" };

  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden_role" };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  // Mesmo gate do catálogo: quem cadastra produto e preço é manager+.
  if (ROLE_RANK[org.role] < ROLE_RANK.manager) return { ok: false, error: "forbidden_role" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", org.orgId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, error: "erro_ao_gravar" };

  const settings = (atual?.settings ?? {}) as Record<string, unknown>;
  const catalogo = (settings[CHAVE_DO_CATALOGO] ?? {}) as Record<string, unknown>;
  const novo = { ...settings, [CHAVE_DO_CATALOGO]: { ...catalogo, modo_estoque: entrada.data } };

  const { error } = await admin.from("organizations").update({ settings: novo }).eq("id", org.orgId);
  if (error) return { ok: false, error: "erro_ao_gravar" };

  await audit({
    action: "settings.catalog_stock_mode_updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "organization",
    resourceId: org.orgId,
    metadata: { modo_estoque: entrada.data },
  });

  revalidatePath("/app/products");
  return { ok: true };
}
