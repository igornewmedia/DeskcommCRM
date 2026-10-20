/**
 * Cadastro + argumentos já validados → a requisição que sai. Puro, sem rede.
 *
 * Regras de substituição de `{{nome}}`:
 *  - caminho da URL: `encodeURIComponent` — um valor com `/`, `?` ou `#` não
 *    muda o recurso pedido nem abre query nova;
 *  - query e cabeçalho: texto; na query, uma entrada que é SÓ `{{nome}}` sai
 *    quando o parâmetro opcional não veio;
 *  - corpo: substituição ESTRUTURAL. Um texto que é só `{{nome}}` vira o valor
 *    com o tipo dele (número continua número) e some quando não veio; texto com
 *    placeholder no meio vira texto. Nunca se concatena JSON — o valor do
 *    modelo não fecha aspas nem injeta campo.
 *  - sem modelo de corpo, POST/PUT/PATCH/DELETE mandam os argumentos como JSON.
 *
 * A autenticação entra por último e vence um cabeçalho de mesmo nome. A versão
 * para a tela (`paraExibir`) troca o segredo por `••••`.
 */
import type { FerramentaHttp } from "./schema";
import { PLACEHOLDER } from "./schema";

export type CadastroDaRequisicao = Pick<
  FerramentaHttp,
  "method" | "url" | "headers" | "query" | "body_template" | "auth_type" | "auth_header_name"
>;

export interface RequisicaoMontada {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** Os mesmos dados com o segredo mascarado — o que a tela e o log podem mostrar. */
  paraExibir: { method: string; url: string; headers: Record<string, string>; body?: string };
}

export class RequisicaoInvalidaError extends Error {
  override readonly name = "requisicao_invalida";
}

const MASCARA = "••••";
const SOZINHO = /^\{\{\s*([a-z][a-z0-9_]{0,63})\s*\}\}$/;

function comoTexto(valor: unknown): string {
  return valor === undefined || valor === null ? "" : String(valor);
}

function substituirTexto(
  modelo: string,
  args: Record<string, unknown>,
  codificar: (v: string) => string = (v) => v,
): string {
  return modelo.replace(PLACEHOLDER, (_, nome: string) => codificar(comoTexto(args[nome])));
}

/** Substitui no corpo; `undefined` = "tire esta chave/posição". */
function substituirJson(valor: unknown, args: Record<string, unknown>): unknown {
  if (typeof valor === "string") {
    const sozinho = SOZINHO.exec(valor);
    if (sozinho) return args[sozinho[1] as string];
    return substituirTexto(valor, args);
  }
  if (Array.isArray(valor)) {
    return valor.map((v) => substituirJson(v, args)).filter((v) => v !== undefined);
  }
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) {
      const novo = substituirJson(v, args);
      if (novo !== undefined) saida[k] = novo;
    }
    return saida;
  }
  return valor;
}

function semQuebraDeLinha(nome: string, valor: string): string {
  if (/[\r\n\0]/.test(valor)) {
    throw new RequisicaoInvalidaError(`o cabeçalho ${nome} recebeu quebra de linha`);
  }
  return valor;
}

function cabecalhoDeAutenticacao(
  cadastro: CadastroDaRequisicao,
  segredo: string | null,
): [string, string] | null {
  if (cadastro.auth_type === "none") return null;
  if (!segredo) {
    throw new RequisicaoInvalidaError("a credencial da ferramenta não pôde ser aberta");
  }
  switch (cadastro.auth_type) {
    case "bearer":
      return ["Authorization", `Bearer ${segredo}`];
    case "basic":
      return ["Authorization", `Basic ${Buffer.from(segredo, "utf8").toString("base64")}`];
    case "api_key":
      return [cadastro.auth_header_name as string, segredo];
  }
}

export function montarRequisicao(
  cadastro: CadastroDaRequisicao,
  args: Record<string, unknown>,
  segredo: string | null,
): RequisicaoMontada {
  // O esquema e o host nunca têm placeholder (o schema recusa); só o resto é substituído.
  const corte = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(cadastro.url)?.[0] ?? "";
  let url: URL;
  try {
    url = new URL(corte + substituirTexto(cadastro.url.slice(corte.length), args, encodeURIComponent));
  } catch {
    throw new RequisicaoInvalidaError("a URL montada é inválida");
  }

  for (const [chave, modelo] of Object.entries(cadastro.query)) {
    const sozinho = SOZINHO.exec(modelo);
    if (sozinho && (args[sozinho[1] as string] === undefined || args[sozinho[1] as string] === null)) {
      continue;
    }
    url.searchParams.append(chave, substituirTexto(modelo, args));
  }

  const headers: Record<string, string> = {};
  for (const [nome, modelo] of Object.entries(cadastro.headers)) {
    headers[nome] = semQuebraDeLinha(nome, substituirTexto(modelo, args));
  }

  let body: string | undefined;
  if (cadastro.method !== "GET") {
    const corpo =
      cadastro.body_template === null || cadastro.body_template === undefined
        ? args
        : substituirJson(cadastro.body_template, args);
    body = JSON.stringify(corpo ?? {});
    const temTipo = Object.keys(headers).some((h) => h.toLowerCase() === "content-type");
    if (!temTipo) headers["Content-Type"] = "application/json";
  }

  const paraExibirHeaders = { ...headers };
  const auth = cabecalhoDeAutenticacao(cadastro, segredo);
  if (auth) {
    const [nome, valor] = auth;
    // Um cabeçalho de mesmo nome (outra caixa) não pode sobreviver ao da autenticação.
    for (const h of Object.keys(headers)) {
      if (h.toLowerCase() === nome.toLowerCase()) {
        delete headers[h];
        delete paraExibirHeaders[h];
      }
    }
    headers[nome] = semQuebraDeLinha(nome, valor);
    paraExibirHeaders[nome] = MASCARA;
  }

  return {
    method: cadastro.method,
    url: url.toString(),
    headers,
    ...(body !== undefined ? { body } : {}),
    paraExibir: {
      method: cadastro.method,
      url: url.toString(),
      headers: paraExibirHeaders,
      ...(body !== undefined ? { body } : {}),
    },
  };
}
