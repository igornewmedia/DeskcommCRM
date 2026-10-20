import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * FERRAMENTAS HTTP DOS AGENTES (migration 9002): ISOLAMENTO, PAPEL E SEGREDO.
 *
 * O cadastro guarda a credencial do sistema de fora (API Key, Bearer, Basic)
 * cifrada. Cifrada não basta: a promessa é que ela NUNCA chega ao browser, então
 * `authenticated` não pode nem ler o texto cifrado pela REST. As asserções:
 *   - manager de A lê as ferramentas e o histórico de A, e ZERO de B;
 *   - agent e viewer de A leem ZERO (o editor de agente é manager+);
 *   - `authenticated` recebe "permission denied" ao pedir `secret_encrypted`,
 *     mesmo sendo manager da própria organização;
 *   - `authenticated` não escreve em nenhuma das duas (escrita é da rota);
 *   - `anon` não lê nada;
 *   - `service_role` não reescreve o histórico (sem UPDATE).
 *
 * `set role authenticated` + `request.jwt.claims` — o mesmo caminho da produção.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-f",
      "-",
    ],
    { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

function comoUsuario(userId: string, consulta: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${consulta}
  `);
}

function contarComo(userId: string, consulta: string): number {
  const last = comoUsuario(userId, consulta).split("\n").pop();
  if (last === undefined || !/^\d+$/.test(last)) {
    throw new Error(`saída inesperada do psql: ${last}`);
  }
  return Number(last);
}

const ORG_A = "e7e7e7e7-0000-4000-8000-00000000000a";
const ORG_B = "e7e7e7e7-0000-4000-8000-00000000000b";
const MANAGER_A = "e7e7e7e7-1111-4000-8000-00000000000a";
const AGENT_A = "e7e7e7e7-1111-4000-8000-00000000000c";
const VIEWER_A = "e7e7e7e7-1111-4000-8000-00000000000d";
const MANAGER_B = "e7e7e7e7-1111-4000-8000-00000000000b";
const TOOL_A = "e7e7e7e7-2222-4000-8000-00000000000a";
const TOOL_B = "e7e7e7e7-2222-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${MANAGER_A}', 'http-tools-mgr-a@invariant.test'),
      ('${AGENT_A}',   'http-tools-agent-a@invariant.test'),
      ('${VIEWER_A}',  'http-tools-viewer-a@invariant.test'),
      ('${MANAGER_B}', 'http-tools-mgr-b@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'http-tools-inv-a', 'Ferramentas HTTP A', 'Ferramentas A'),
      ('${ORG_B}', 'http-tools-inv-b', 'Ferramentas HTTP B', 'Ferramentas B')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENT_A}',   '${ORG_A}', 'agent',   now()),
      ('${VIEWER_A}',  '${ORG_A}', 'viewer',  now()),
      ('${MANAGER_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;

    insert into public.ai_http_tools
      (id, organization_id, slug, name, description, url, auth_type,
       secret_encrypted, secret_iv, secret_tag, secret_last4)
    values
      ('${TOOL_A}', '${ORG_A}', 'consultar_horarios', 'Consultar horários',
       'Consulta horários livres.', 'https://exemplo.com/a', 'bearer',
       '\\x01', '\\x02', '\\x03', 'abcd'),
      ('${TOOL_B}', '${ORG_B}', 'consultar_horarios', 'Consultar horários',
       'Consulta horários livres.', 'https://exemplo.com/b', 'bearer',
       '\\x01', '\\x02', '\\x03', 'wxyz')
      on conflict (id) do nothing;

    insert into public.ai_http_tool_runs (organization_id, tool_id, origin, status)
    select v.org, v.tool, 'teste', 'sucesso'
      from (values ('${ORG_A}'::uuid, '${TOOL_A}'::uuid),
                   ('${ORG_B}'::uuid, '${TOOL_B}'::uuid)) as v(org, tool)
     where not exists (
       select 1 from public.ai_http_tool_runs r where r.tool_id = v.tool
     );
  `);
});

describe("ai_http_tools — isolamento e papel", () => {
  it("manager de A lê a ferramenta de A (controle positivo)", () => {
    expect(
      contarComo(MANAGER_A, `select count(*) from public.ai_http_tools where id = '${TOOL_A}';`),
    ).toBe(1);
  });

  it("manager de A não vê nenhuma ferramenta de B, nem sem filtro de org", () => {
    expect(
      contarComo(MANAGER_A, `select count(*) from public.ai_http_tools where id = '${TOOL_B}';`),
    ).toBe(0);
    expect(
      contarComo(
        MANAGER_A,
        `select count(*) from public.ai_http_tools where organization_id <> '${ORG_A}';`,
      ),
    ).toBe(0);
  });

  it("agent e viewer de A leem zero", () => {
    for (const quem of [AGENT_A, VIEWER_A]) {
      expect(contarComo(quem, `select count(*) from public.ai_http_tools;`)).toBe(0);
    }
  });

  it("nem o manager da própria organização lê o segredo cifrado", () => {
    expect(() =>
      comoUsuario(MANAGER_A, `select secret_encrypted from public.ai_http_tools;`),
    ).toThrow(/permission denied/);
    // As colunas sem segredo continuam legíveis — o `last4` é o que a tela mostra.
    expect(
      comoUsuario(MANAGER_A, `select secret_last4 from public.ai_http_tools where id = '${TOOL_A}';`)
        .split("\n")
        .pop(),
    ).toBe("abcd");
  });

  it("authenticated não escreve no cadastro (escrita é da rota)", () => {
    expect(() =>
      comoUsuario(
        MANAGER_A,
        `update public.ai_http_tools set url = 'https://outro.com' where id = '${TOOL_A}';`,
      ),
    ).toThrow(/permission denied/);
    expect(() =>
      comoUsuario(
        MANAGER_A,
        `insert into public.ai_http_tools (organization_id, slug, name, description, url)
         values ('${ORG_A}', 'nova_ferramenta', 'x', 'x', 'https://exemplo.com');`,
      ),
    ).toThrow(/permission denied/);
  });

  it("anon não lê nada", () => {
    expect(() => sql(`set role anon; select count(*) from public.ai_http_tools;`)).toThrow(
      /permission denied/,
    );
  });
});

describe("ai_http_tool_runs — histórico isolado e só cresce", () => {
  it("manager de A lê o histórico de A e zero de B", () => {
    expect(
      contarComo(
        MANAGER_A,
        `select count(*) from public.ai_http_tool_runs where tool_id = '${TOOL_A}';`,
      ),
    ).toBeGreaterThan(0);
    expect(
      contarComo(
        MANAGER_A,
        `select count(*) from public.ai_http_tool_runs where organization_id <> '${ORG_A}';`,
      ),
    ).toBe(0);
  });

  it("agent de A lê zero", () => {
    expect(contarComo(AGENT_A, `select count(*) from public.ai_http_tool_runs;`)).toBe(0);
  });

  it("authenticated não grava histórico", () => {
    expect(() =>
      comoUsuario(
        MANAGER_A,
        `insert into public.ai_http_tool_runs (organization_id, tool_id, origin, status)
         values ('${ORG_A}', '${TOOL_A}', 'teste', 'sucesso');`,
      ),
    ).toThrow(/permission denied/);
  });

  it("service_role não reescreve uma execução", () => {
    expect(() =>
      sql(`set role service_role;
           update public.ai_http_tool_runs set status = 'sucesso' where tool_id = '${TOOL_A}';`),
    ).toThrow(/permission denied/);
  });
});

describe("ai_http_tools — o banco recusa cadastro incoerente", () => {
  it("API Key sem o nome do cabeçalho não entra", () => {
    expect(() =>
      sql(`insert into public.ai_http_tools (organization_id, slug, name, description, url, auth_type)
           values ('${ORG_A}', 'sem_cabecalho', 'x', 'x', 'https://exemplo.com', 'api_key');`),
    ).toThrow(/ai_http_tools_segredo_coerente/);
  });

  it("nome fora do formato que o provedor aceita não entra", () => {
    expect(() =>
      sql(`insert into public.ai_http_tools (organization_id, slug, name, description, url)
           values ('${ORG_A}', 'Consultar Horários', 'x', 'x', 'https://exemplo.com');`),
    ).toThrow(/ai_http_tools_slug_valido/);
  });

  it("excluir libera o nome para uma ferramenta nova", () => {
    sql(`
      insert into public.ai_http_tools (organization_id, slug, name, description, url, deleted_at)
      values ('${ORG_A}', 'reaproveitada', 'x', 'x', 'https://exemplo.com', now());
      insert into public.ai_http_tools (organization_id, slug, name, description, url)
      values ('${ORG_A}', 'reaproveitada', 'x', 'x', 'https://exemplo.com');
    `);
    expect(() =>
      sql(`insert into public.ai_http_tools (organization_id, slug, name, description, url)
           values ('${ORG_A}', 'reaproveitada', 'x', 'x', 'https://exemplo.com');`),
    ).toThrow(/ai_http_tools_slug_uk/);
  });
});
