/**
 * O id de uma ferramenta HTTP dentro de `ai_agent_versions.tool_ids`.
 *
 * Mesmo motivo do prefixo `mcp_externo:` (lib/mcp/servidor-externo/ids.ts):
 * `tool_ids` é validado contra o catálogo compilado, e um id com marca própria
 * passa pelo mesmo validador sem afrouxar a régua de "id que não existe não
 * entra". O id leva o UUID do cadastro, não o `slug`: renomear a ferramenta não
 * pode desligá-la dos agentes que a usam.
 */

export const PREFIXO_TOOL_ID_HTTP = "http:";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Monta o id que vai para `tool_ids` — o inverso exato de `lerToolIdHttp`. */
export function toolIdHttp(ferramentaId: string): string {
  return `${PREFIXO_TOOL_ID_HTTP}${ferramentaId.toLowerCase()}`;
}

/** O UUID do cadastro contido no id, ou `null` quando o id não é de ferramenta HTTP. */
export function lerToolIdHttp(id: string): string | null {
  if (!id.startsWith(PREFIXO_TOOL_ID_HTTP)) return null;
  const resto = id.slice(PREFIXO_TOOL_ID_HTTP.length);
  return UUID.test(resto) ? resto : null;
}

export function ehToolIdHttp(id: string): boolean {
  return lerToolIdHttp(id) !== null;
}
