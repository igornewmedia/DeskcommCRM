import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { atributosDaOrganizacao } from "@/lib/catalogo/atributos";
import { createClient } from "@/lib/supabase/server";

import { AtributosClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Atributos dos produtos" };

/**
 * ATRIBUTOS DOS PRODUTOS (migration 5002) — as informações próprias que esta
 * organização guarda em cada produto (pronta entrega, preço no cartão, versão…)
 * e que o atendente de IA lê na busca do catálogo.
 *
 * Todos veem; `manager` define (a rota e a RLS cobram).
 */
export default async function AtributosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const podeEditar = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const supabase = await createClient();
  const atributos = await atributosDaOrganizacao(supabase, activeOrg.orgId);
  return <AtributosClient inicial={atributos} podeEditar={podeEditar} />;
}
