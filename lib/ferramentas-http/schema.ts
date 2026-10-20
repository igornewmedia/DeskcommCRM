/**
 * Schema central da ferramenta HTTP — a fonte única do formato dos jsonb de
 * `ai_http_tools` (doutrina: nada de "UI lê path direto sem schema central").
 *
 * Dois usos:
 *  1. `ferramentaHttpSchema` valida o cadastro que chega pela rota;
 *  2. `shapeDosParametros` transforma a lista de parâmetros no `ZodRawShape` que
 *     vira o `inputSchema` da tool — o AI SDK converte em JSON Schema para
 *     Anthropic, OpenAI e Google, e o MESMO shape valida o que o modelo mandou.
 *
 * Placeholder é `{{nome}}` e só pode citar parâmetro declarado. Nunca no esquema
 * nem no host da URL: o modelo escolheria para onde a requisição vai.
 */
import { z } from "zod";

import {
  EFEITOS_DA_FERRAMENTA,
  METODOS_HTTP,
  SLUG_DA_FERRAMENTA,
  TIMEOUT_MAXIMO_MS,
  TIMEOUT_MINIMO_MS,
  TIMEOUT_PADRAO_MS,
  TIPOS_DE_AUTENTICACAO,
  TIPOS_DE_FERRAMENTA,
} from "./vocabulario";

/** Teto do código de uma ferramenta de código — o mesmo do CHECK (9003). */
export const MAX_CARACTERES_DO_CODIGO = 20_000;

export const TIPOS_DE_PARAMETRO = ["string", "number", "integer", "boolean", "enum"] as const;
export const FORMATOS_DE_TEXTO = ["date", "date-time", "email"] as const;

export const MAX_PARAMETROS = 20;
export const MAX_CABECALHOS = 20;
export const MAX_CAMPOS_MAPEADOS = 20;

/** `{{nome}}` — o mesmo formato de nome de parâmetro. */
export const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,63})\s*\}\}/g;

/** Cabeçalhos que o cadastro não define à mão: a autenticação tem campo próprio, o resto é do transporte. */
const CABECALHOS_RESERVADOS = new Set(["authorization", "host", "content-length", "cookie"]);

/** Nome de cabeçalho HTTP (token da RFC 9110). */
const NOME_DE_CABECALHO = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

/** `$`, `$.a.b`, `$.itens[0].nome` — o mapeamento de resposta. */
export const CAMINHO_DE_RESPOSTA = /^\$((\.[A-Za-z_][A-Za-z0-9_-]*)|(\[\d{1,4}\]))*$/;

export const parametroSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "use letras minúsculas, números e _"),
    type: z.enum(TIPOS_DE_PARAMETRO),
    required: z.boolean().default(false),
    description: z.string().trim().min(1).max(500),
    format: z.enum(FORMATOS_DE_TEXTO).optional(),
    values: z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.type === "enum" && !p.values) {
      ctx.addIssue({ code: "custom", path: ["values"], message: "lista de opções obrigatória" });
    }
    if (p.type !== "enum" && p.values) {
      ctx.addIssue({ code: "custom", path: ["values"], message: "opções só valem para enum" });
    }
    if (p.format && p.type !== "string") {
      ctx.addIssue({ code: "custom", path: ["format"], message: "formato só vale para texto" });
    }
  });

export type Parametro = z.infer<typeof parametroSchema>;

export const parametrosSchema = z
  .array(parametroSchema)
  .max(MAX_PARAMETROS)
  .superRefine((lista, ctx) => {
    const vistos = new Set<string>();
    lista.forEach((p, i) => {
      if (vistos.has(p.name)) {
        ctx.addIssue({ code: "custom", path: [i, "name"], message: "nome repetido" });
      }
      vistos.add(p.name);
    });
  });

const textoDeTemplate = z.string().max(2048);

const cabecalhosSchema = z
  .record(z.string(), textoDeTemplate)
  .superRefine((h, ctx) => {
    const nomes = Object.keys(h);
    if (nomes.length > MAX_CABECALHOS) {
      ctx.addIssue({ code: "custom", message: `no máximo ${MAX_CABECALHOS} cabeçalhos` });
    }
    for (const nome of nomes) {
      if (!NOME_DE_CABECALHO.test(nome)) {
        ctx.addIssue({ code: "custom", path: [nome], message: "nome de cabeçalho inválido" });
      } else if (CABECALHOS_RESERVADOS.has(nome.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: [nome],
          message: "use o campo de autenticação em vez deste cabeçalho",
        });
      }
    }
  });

/** Todos os nomes de placeholder citados num texto. */
export function placeholdersDe(texto: string): string[] {
  return [...texto.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
}

/** Todos os textos de um JSON (chaves não contam: placeholder só em valor). */
function textosDoJson(valor: unknown, saida: string[] = []): string[] {
  if (typeof valor === "string") saida.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => textosDoJson(v, saida));
  else if (valor && typeof valor === "object") {
    Object.values(valor).forEach((v) => textosDoJson(v, saida));
  }
  return saida;
}

/** Esquema + host da URL, a parte que nunca recebe placeholder. */
function origemDaUrl(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url);
  return m ? m[0] : url;
}

export const ferramentaHttpSchema = z
  .object({
    slug: z.string().regex(SLUG_DA_FERRAMENTA, "use letras minúsculas, números e _ (3 a 64)"),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1024),
    is_active: z.boolean().default(true),
    kind: z.enum(TIPOS_DE_FERRAMENTA).default("http"),
    // Só na ferramenta de código (9003); a de HTTP grava `null`.
    code: z.string().max(MAX_CARACTERES_DO_CODIGO).nullable().default(null),
    method: z.enum(METODOS_HTTP).default("POST"),
    // Vazio só na ferramenta de código; a de HTTP é cobrada no refinamento.
    url: z.string().trim().max(2048).default(""),
    headers: cabecalhosSchema.default({}),
    query: z.record(z.string().min(1).max(128), textoDeTemplate).default({}),
    body_template: z.unknown().nullable().default(null),
    parameters: parametrosSchema.default([]),
    response_map: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        z.string().regex(CAMINHO_DE_RESPOSTA, "caminho no formato $.campo.lista[0]"),
      )
      .refine((m) => Object.keys(m).length <= MAX_CAMPOS_MAPEADOS)
      .nullable()
      .default(null),
    response_instructions: z.string().trim().max(2000).nullable().default(null),
    auth_type: z.enum(TIPOS_DE_AUTENTICACAO).default("none"),
    auth_header_name: z.string().regex(NOME_DE_CABECALHO).nullable().default(null),
    effect: z.enum(EFEITOS_DA_FERRAMENTA).default("consulta"),
    requires_confirmation: z.boolean().default(false),
    safe_to_retry: z.boolean().default(false),
    timeout_ms: z
      .number()
      .int()
      .min(TIMEOUT_MINIMO_MS)
      .max(TIMEOUT_MAXIMO_MS)
      .default(TIMEOUT_PADRAO_MS),
  })
  .superRefine((f, ctx) => {
    // `crm_` é o prefixo do catálogo compilado: o nome do cadastro nunca se passa por ele.
    if (f.slug.startsWith("crm_")) {
      ctx.addIssue({ code: "custom", path: ["slug"], message: "o prefixo crm_ é reservado" });
    }
    if (f.kind === "codigo") {
      // Roda isolado, sem rede (lib/ferramentas-http/codigo.ts): nada de URL,
      // credencial ou efeito. O banco cobra o mesmo (CHECK da 9003).
      if (!f.code?.trim()) {
        ctx.addIssue({ code: "custom", path: ["code"], message: "escreva o código" });
      }
      if (f.url !== "") ctx.addIssue({ code: "custom", path: ["url"], message: "código não tem URL" });
      if (f.auth_type !== "none") {
        ctx.addIssue({ code: "custom", path: ["auth_type"], message: "código não tem autenticação" });
      }
      if (f.effect !== "consulta") {
        ctx.addIssue({ code: "custom", path: ["effect"], message: "código só calcula: é consulta" });
      }
      return;
    }
    if (f.code !== null) ctx.addIssue({ code: "custom", path: ["code"], message: "código só vale para ferramenta de código" });
    let url: URL;
    try {
      url = new URL(f.url.replace(PLACEHOLDER, "x"));
    } catch {
      ctx.addIssue({ code: "custom", path: ["url"], message: "URL inválida" });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: "custom", path: ["url"], message: "use https://" });
    }
    if (url.username || url.password) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "credencial na URL não: use o campo de autenticação",
      });
    }
    if (placeholdersDe(origemDaUrl(f.url)).length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "o endereço do servidor não pode depender de parâmetro",
      });
    }
    if (f.auth_type === "api_key" && !f.auth_header_name) {
      ctx.addIssue({
        code: "custom",
        path: ["auth_header_name"],
        message: "informe o cabeçalho da API Key",
      });
    }
    // `Authorization` vale aqui: há API que espera a chave crua nele.
    const cabecalhoDaChave = f.auth_header_name?.toLowerCase();
    if (cabecalhoDaChave && cabecalhoDaChave !== "authorization" && CABECALHOS_RESERVADOS.has(cabecalhoDaChave)) {
      ctx.addIssue({ code: "custom", path: ["auth_header_name"], message: "cabeçalho reservado" });
    }
    if (f.method === "GET" && f.body_template !== null) {
      ctx.addIssue({ code: "custom", path: ["body_template"], message: "GET não leva corpo" });
    }
    if (f.requires_confirmation && f.effect !== "acao") {
      ctx.addIssue({
        code: "custom",
        path: ["requires_confirmation"],
        message: "confirmação só vale para ação",
      });
    }

    const declarados = new Set(f.parameters.map((p) => p.name));
    const citados = [
      ...placeholdersDe(f.url),
      ...Object.values(f.query).flatMap(placeholdersDe),
      ...Object.values(f.headers).flatMap(placeholdersDe),
      ...textosDoJson(f.body_template).flatMap(placeholdersDe),
    ];
    for (const nome of new Set(citados)) {
      if (!declarados.has(nome)) {
        ctx.addIssue({
          code: "custom",
          path: ["parameters"],
          message: `{{${nome}}} não é um parâmetro declarado`,
        });
      }
    }
  });

export type FerramentaHttp = z.infer<typeof ferramentaHttpSchema>;

function campoDoParametro(p: Parametro): z.ZodType {
  let campo: z.ZodType;
  switch (p.type) {
    case "string":
      campo =
        p.format === "date"
          ? z.iso.date()
          : p.format === "date-time"
            ? z.iso.datetime({ offset: true })
            : p.format === "email"
              ? z.email()
              : z.string().max(2000);
      break;
    case "number":
      campo = z.number().finite();
      break;
    case "integer":
      campo = z.number().int();
      break;
    case "boolean":
      campo = z.boolean();
      break;
    case "enum":
      campo = z.enum(p.values as [string, ...string[]]);
      break;
  }
  campo = campo.describe(p.description);
  return p.required ? campo : campo.optional();
}

/** O `inputSchema` da tool: o que o modelo vê e o que valida o que ele mandou. */
export function shapeDosParametros(parametros: readonly Parametro[]): Record<string, z.ZodType> {
  return Object.fromEntries(parametros.map((p) => [p.name, campoDoParametro(p)]));
}

export type ResultadoDaValidacao =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; problemas: string[] };

/**
 * Valida o que o modelo (ou o botão Testar) mandou. Campo não declarado é
 * recusado: o modelo só escreve o que o esquema nomeia.
 */
export function validarArgumentos(
  parametros: readonly Parametro[],
  args: unknown,
): ResultadoDaValidacao {
  const r = z.strictObject(shapeDosParametros(parametros)).safeParse(args ?? {});
  if (r.success) return { ok: true, args: r.data as Record<string, unknown> };
  return {
    ok: false,
    problemas: r.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`),
  };
}
