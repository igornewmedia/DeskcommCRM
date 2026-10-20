import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { COLUNAS_DO_APARELHO, type AparelhoDeTroca } from "@/lib/schemas/aparelhos-de-troca";
import { createClient } from "@/lib/supabase/server";

import { TrocaClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aparelhos na troca" };

/**
 * APARELHOS ACEITOS NA TROCA (migration 9003) — o que a loja aceita como parte
 * do pagamento e quanto cada um abate. O atendente de IA consulta esta lista
 * (`crm_search_trade_in_devices`) para montar o orçamento com troca.
 *
 * Mesmo papel do catálogo: todos veem, `manager` cadastra (a rota e a RLS cobram).
 */
export default async function TrocaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const podeEditar = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_trade_in_devices")
    .select(COLUNAS_DO_APARELHO)
    .eq("organization_id", activeOrg.orgId)
    .order("ativo", { ascending: false })
    .order("modelo")
    .limit(500);
  if (error) throw new Error(`Não consegui ler os aparelhos de troca: ${error.message}`);

  return <TrocaClient inicial={(data ?? []) as AparelhoDeTroca[]} podeEditar={podeEditar} />;
}
