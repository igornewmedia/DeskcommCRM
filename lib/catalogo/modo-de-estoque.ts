/**
 * COMO ESTA EMPRESA TRATA O ESTOQUE — e, daí, o que está disponível para a IA.
 *
 * Duas empresas, dois catálogos que significam coisas diferentes:
 *
 * - **Somente com estoque** (`somente_com_estoque`): a loja conta o que tem. Só
 *   está disponível o produto ativo com `quantidade > 0` — exceto o produto com
 *   `controla_estoque = false` (sob encomenda), que está sempre disponível.
 * - **Sem controle de estoque** (`sem_controle`): a loja revende de fornecedor e
 *   sincroniza o catálogo; a quantidade não vem e fica 0. Estar ativo no
 *   catálogo já é estar disponível.
 *
 * O padrão é `somente_com_estoque` para toda empresa, nova ou antiga: é a regra
 * que a busca da IA aplicava antes desta chave existir, então nenhuma empresa
 * muda de comportamento sem alguém escolher.
 *
 * A chave mora em `organizations.settings.catalogo.modo_estoque` e é lida a
 * cada consulta, sem cache: trocar na tela vale na próxima busca.
 *
 * `produtoDisponivel` é a ÚNICA régua de disponibilidade — a busca da IA, a
 * validação do que a IA afirma e o `GET /api/v1/products` a usam.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export const MODOS_DE_ESTOQUE = ["somente_com_estoque", "sem_controle"] as const;
export type ModoDeEstoque = (typeof MODOS_DE_ESTOQUE)[number];

/** Chave de `organizations.settings` — um namespace por assunto. */
export const CHAVE_DO_CATALOGO = "catalogo";
export const MODO_DE_ESTOQUE_PADRAO: ModoDeEstoque = "somente_com_estoque";

export function modoDeEstoqueDoValor(bruto: unknown): ModoDeEstoque {
  return (MODOS_DE_ESTOQUE as readonly unknown[]).includes(bruto) ? (bruto as ModoDeEstoque) : MODO_DE_ESTOQUE_PADRAO;
}

/** Lê o modo de um `organizations.settings` já carregado. Lixo ou ausência = padrão. */
export function modoDeEstoqueDasSettings(settings: unknown): ModoDeEstoque {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return MODO_DE_ESTOQUE_PADRAO;
  const catalogo = (settings as Record<string, unknown>)[CHAVE_DO_CATALOGO];
  if (!catalogo || typeof catalogo !== "object" || Array.isArray(catalogo)) return MODO_DE_ESTOQUE_PADRAO;
  return modoDeEstoqueDoValor((catalogo as Record<string, unknown>).modo_estoque);
}

/** Nunca lança: leitura que falha cai no padrão, que é o comportamento de antes da chave. */
export async function modoDeEstoqueDaOrganizacao(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ModoDeEstoque> {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) {
      logger.warn("modo de estoque: não deu para ler a configuração da empresa — usando o padrão", {
        organizationId,
        detalhe: error.message,
      });
      return MODO_DE_ESTOQUE_PADRAO;
    }
    return modoDeEstoqueDasSettings((data as { settings?: unknown } | null)?.settings);
  } catch (e) {
    logger.warn("modo de estoque: leitura falhou — usando o padrão", {
      organizationId,
      detalhe: e instanceof Error ? e.message : String(e),
    });
    return MODO_DE_ESTOQUE_PADRAO;
  }
}

export interface EstoqueDoProduto {
  ativo: boolean;
  controla_estoque: boolean;
  quantidade: number | string | null;
}

export function produtoDisponivel(p: EstoqueDoProduto, modo: ModoDeEstoque): boolean {
  if (p.ativo !== true) return false;
  if (modo === "sem_controle" || !p.controla_estoque) return true;
  return Number(p.quantidade) > 0;
}

/** O padrão de `controla_estoque` num produto novo que não disse o valor. */
export function controlaEstoquePadrao(modo: ModoDeEstoque): boolean {
  return modo === "somente_com_estoque";
}
