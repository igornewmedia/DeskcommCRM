import { z } from "zod";

/**
 * Aparelhos aceitos na troca (migration 9003) — um contrato lido pela tela e
 * pela rota, como `lib/schemas/produtos.ts`. A moeda vem da organização, nunca
 * do corpo.
 */
export const aparelhoDeTrocaCreateSchema = z.object({
  modelo: z.string().trim().min(1, "informe o modelo").max(200),
  capacidade: z.string().trim().max(60).nullable().optional(),
  abatimento_cents: z.number().int().min(0, "o abatimento não pode ser negativo"),
  ativo: z.boolean().default(true),
});

export const aparelhoDeTrocaPatchSchema = aparelhoDeTrocaCreateSchema.partial();

export interface AparelhoDeTroca {
  id: string;
  modelo: string;
  capacidade: string | null;
  abatimento_cents: number;
  moeda: string;
  ativo: boolean;
  updated_at: string;
}

export const COLUNAS_DO_APARELHO = "id, modelo, capacidade, abatimento_cents, moeda, ativo, updated_at";
