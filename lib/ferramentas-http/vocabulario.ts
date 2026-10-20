/**
 * Vocabulário das ferramentas HTTP dos agentes (migration 0705).
 *
 * Cada lista é a MESMA do CHECK da coluna no banco; o par é vigiado por
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`. Mudou aqui, muda lá
 * (migration nova + apêndice do baseline).
 */

/** `ai_http_tools.method` */
export const METODOS_HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type MetodoHttp = (typeof METODOS_HTTP)[number];

/** `ai_http_tools.auth_type` — API Key vai sempre em cabeçalho, nunca em query string. */
export const TIPOS_DE_AUTENTICACAO = ["none", "api_key", "bearer", "basic"] as const;
export type TipoDeAutenticacao = (typeof TIPOS_DE_AUTENTICACAO)[number];

/**
 * `ai_http_tools.effect` — quem administra declara. `consulta` só lê; `acao` muda
 * algo no sistema de fora e segue a regra de escrita do turno.
 */
export const EFEITOS_DA_FERRAMENTA = ["consulta", "acao"] as const;
export type EfeitoDaFerramenta = (typeof EFEITOS_DA_FERRAMENTA)[number];

/** `ai_http_tool_runs.origin` */
export const ORIGENS_DA_EXECUCAO = ["turno", "teste"] as const;
export type OrigemDaExecucao = (typeof ORIGENS_DA_EXECUCAO)[number];

/** `ai_http_tool_runs.status` */
export const STATUS_DA_EXECUCAO = [
  "sucesso",
  "erro_http",
  "timeout",
  "falha_conexao",
  "bloqueado",
  "parametros_invalidos",
  "resposta_invalida",
  "aguardando_confirmacao",
  "limite_excedido",
] as const;
export type StatusDaExecucao = (typeof STATUS_DA_EXECUCAO)[number];

/** Limites do cadastro — os mesmos números dos CHECKs. */
export const TIMEOUT_MINIMO_MS = 1_000;
export const TIMEOUT_MAXIMO_MS = 30_000;
export const TIMEOUT_PADRAO_MS = 10_000;
/** Nome que o modelo vê: o formato que Anthropic, OpenAI e Google aceitam. */
export const SLUG_DA_FERRAMENTA = /^[a-z][a-z0-9_]{2,63}$/;
