import { z } from "zod";

import { formatCents } from "@/lib/money";

/**
 * ATRIBUTOS PERSONALIZADOS DE PRODUTO (migration 5002) — o contrato único lido
 * pela tela de definição, pelo formulário do produto, pela API e pela busca da
 * IA, como `lib/schemas/produtos.ts`.
 *
 * Cada organização declara os SEUS atributos (`catalog_product_attributes`) e
 * cada produto guarda os valores em `catalog_products.atributos` (jsonb, chave
 * do atributo → valor). O valor é validado contra a definição na escrita: o
 * banco só garante que é um objeto, porque a regra de tipo depende da linha de
 * outra tabela.
 */

export const TIPOS_DE_ATRIBUTO = ["texto", "numero", "booleano", "moeda", "lista"] as const;
export type TipoDeAtributo = (typeof TIPOS_DE_ATRIBUTO)[number];

/** Teto por organização. Cobrado na rota e na RLS não (a contagem é da rota). */
export const LIMITE_DE_ATRIBUTOS = 30;

const opcao = z.string().trim().min(1).max(60);

export const atributoCreateSchema = z
  .object({
    chave: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "use só letras minúsculas, números e _ (ex.: pronta_entrega)"),
    rotulo: z.string().trim().min(1, "informe o nome").max(60),
    tipo: z.enum(TIPOS_DE_ATRIBUTO),
    descricao_ia: z.string().trim().max(300).nullable().optional(),
    visivel_ia: z.boolean().default(true),
    pesquisavel: z.boolean().default(false),
    ordem: z.number().int().min(0).max(1000).default(0),
    opcoes: z.array(opcao).max(50).default([]),
  })
  .refine((a) => a.tipo !== "lista" || a.opcoes.length > 0, {
    message: "uma lista precisa de ao menos uma opção",
    path: ["opcoes"],
  });

/** A chave e o tipo não mudam depois de criados: os valores gravados dependem deles. */
export const atributoPatchSchema = z.object({
  rotulo: z.string().trim().min(1).max(60).optional(),
  descricao_ia: z.string().trim().max(300).nullable().optional(),
  visivel_ia: z.boolean().optional(),
  pesquisavel: z.boolean().optional(),
  ordem: z.number().int().min(0).max(1000).optional(),
  opcoes: z.array(opcao).max(50).optional(),
});

export interface AtributoDeProduto {
  id: string;
  chave: string;
  rotulo: string;
  tipo: TipoDeAtributo;
  descricao_ia: string | null;
  visivel_ia: boolean;
  pesquisavel: boolean;
  ordem: number;
  opcoes: string[];
}

export const COLUNAS_DO_ATRIBUTO = "id, chave, rotulo, tipo, descricao_ia, visivel_ia, pesquisavel, ordem, opcoes";

export type ValorDeAtributo = string | number | boolean;
export type ValoresDeAtributos = Record<string, ValorDeAtributo>;

function schemaDoValor(def: AtributoDeProduto) {
  switch (def.tipo) {
    case "texto":
      return z.string().trim().min(1).max(500);
    case "numero":
      return z.number().finite();
    case "booleano":
      return z.boolean();
    case "moeda":
      return z.number().int().min(0);
    case "lista":
      return z.enum(def.opcoes as [string, ...string[]]);
  }
}

export type ResultadoDosValores =
  | { ok: true; valores: ValoresDeAtributos }
  | { ok: false; erros: Record<string, string> };

/**
 * Valida o objeto `atributos` de um corpo contra as definições da organização.
 * Chave desconhecida é recusada (erro de digitação não vira dado mudo). `null`
 * numa chave quer dizer "apagar este valor" — o PATCH usa isso; no resultado,
 * a chave fica de fora.
 */
export function validarValores(defs: AtributoDeProduto[], entrada: unknown): ResultadoDosValores {
  if (entrada === undefined) return { ok: true, valores: {} };
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, erros: { atributos: "precisa ser um objeto { chave: valor }" } };
  }
  const porChave = new Map(defs.map((d) => [d.chave, d]));
  const valores: ValoresDeAtributos = {};
  const erros: Record<string, string> = {};
  for (const [chave, bruto] of Object.entries(entrada as Record<string, unknown>)) {
    const def = porChave.get(chave);
    if (!def) {
      erros[chave] = "atributo não existe nesta organização";
      continue;
    }
    if (bruto === null) continue;
    const r = schemaDoValor(def).safeParse(bruto);
    if (!r.success) erros[chave] = `valor inválido para o tipo ${def.tipo}`;
    else valores[chave] = r.data;
  }
  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, valores };
}

/** As chaves com `null` explícito — o que o PATCH deve apagar. */
export function chavesApagadas(entrada: unknown): string[] {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return [];
  return Object.entries(entrada as Record<string, unknown>)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
}

/** O valor como a pessoa (e a IA) lê: "R$ 7.851,00", "sim", "Anatel". */
export function formatarValor(def: AtributoDeProduto, valor: unknown, moeda: string): string | null {
  if (valor === null || valor === undefined) return null;
  switch (def.tipo) {
    case "booleano":
      return valor === true ? "sim" : valor === false ? "não" : null;
    case "moeda":
      return typeof valor === "number" ? formatCents(valor, moeda) : null;
    case "numero":
      return typeof valor === "number" ? String(valor).replace(".", ",") : null;
    default:
      return typeof valor === "string" ? valor : null;
  }
}

/** Texto que entra na pontuação da busca para os atributos pesquisáveis. */
export function textoPesquisavel(defs: AtributoDeProduto[], valores: unknown): string {
  if (!valores || typeof valores !== "object") return "";
  const v = valores as Record<string, unknown>;
  return defs
    .filter((d) => d.pesquisavel)
    .map((d) => {
      const x = v[d.chave];
      // Booleano verdadeiro pesquisa pelo rótulo: "pronta entrega" acha quem tem.
      if (d.tipo === "booleano") return x === true ? d.rotulo : "";
      return typeof x === "string" ? x : "";
    })
    .filter(Boolean)
    .join(" ");
}

/** Filtro exato por atributo (`filtros` da ferramenta). Texto compara sem caixa. */
export function casaFiltros(valores: unknown, filtros: Record<string, ValorDeAtributo> | undefined): boolean {
  if (!filtros) return true;
  const v = (valores && typeof valores === "object" ? valores : {}) as Record<string, unknown>;
  return Object.entries(filtros).every(([chave, esperado]) => {
    const atual = v[chave];
    if (typeof esperado === "string" && typeof atual === "string") {
      return atual.trim().toLowerCase() === esperado.trim().toLowerCase();
    }
    // Booleano ausente conta como falso: "pronta_entrega: false" acha quem não marcou.
    if (esperado === false && atual === undefined) return true;
    return atual === esperado;
  });
}
