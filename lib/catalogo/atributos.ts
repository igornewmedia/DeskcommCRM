import type { SupabaseClient } from "@supabase/supabase-js";

import {
  chavesApagadas,
  COLUNAS_DO_ATRIBUTO,
  validarValores,
  type AtributoDeProduto,
  type ValoresDeAtributos,
} from "@/lib/schemas/atributos-de-produto";

/**
 * Leitura das definições de atributo de uma organização (migration 5002) e a
 * resolução do `atributos` de um corpo de escrita de produto. As regras de
 * tipo moram em `lib/schemas/atributos-de-produto.ts`; aqui só o acesso ao banco.
 */

export async function atributosDaOrganizacao(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<AtributoDeProduto[]> {
  const { data, error } = await supabase
    .from("catalog_product_attributes")
    .select(COLUNAS_DO_ATRIBUTO)
    .eq("organization_id", organizationId)
    .order("ordem")
    .order("rotulo");
  if (error) throw new Error(`atributos_falharam: ${error.message}`);
  return (data ?? []) as AtributoDeProduto[];
}

export type AtributosResolvidos =
  | { ok: true; atributos: ValoresDeAtributos }
  | { ok: false; erros: Record<string, string> };

/**
 * `substituir` (POST e PUT): o corpo é o estado inteiro.
 * `mesclar` (PATCH): só as chaves enviadas mudam; `null` apaga a chave.
 */
export async function resolverAtributos(
  supabase: SupabaseClient,
  organizationId: string,
  bruto: unknown,
  modo: "substituir" | "mesclar",
  produtoId?: string,
): Promise<AtributosResolvidos> {
  const defs = await atributosDaOrganizacao(supabase, organizationId);
  const r = validarValores(defs, bruto);
  if (!r.ok) return r;
  if (modo === "substituir" || !produtoId) return { ok: true, atributos: r.valores };

  const { data } = await supabase
    .from("catalog_products")
    .select("atributos")
    .eq("organization_id", organizationId)
    .eq("id", produtoId)
    .maybeSingle();
  // shortcut: ler-e-escrever, não `atributos || $1` no banco; dois PATCH no mesmo
  // produto no mesmo instante podem perder uma chave. Trocar por RPC se a
  // automação passar a mandar PATCHes paralelos no mesmo produto.
  const atuais = ((data as { atributos?: ValoresDeAtributos } | null)?.atributos ?? {}) as ValoresDeAtributos;
  const mesclados: ValoresDeAtributos = { ...atuais, ...r.valores };
  for (const chave of chavesApagadas(bruto)) delete mesclados[chave];
  return { ok: true, atributos: mesclados };
}
