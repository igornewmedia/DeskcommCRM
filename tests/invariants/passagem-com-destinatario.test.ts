import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { performHumanHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { openCase } from "@/lib/agent-engine/agent/human-cases";

/**
 * "QUEM RECEBE AS PASSAGENS" (migration 5003), no banco de verdade.
 *
 * Com destinatário no agente publicado: a passagem e o caso atribuem a conversa
 * à pessoa e o aviso da Central nasce com dono (`para_user_id`), que é o que
 * leva o push só ao celular dela. Sem destinatário, nada muda. Pessoa que saiu
 * da equipe não recebe nada: a passagem segue para a fila.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 2 });
const logMudo = { info: () => {}, warn: () => {}, error: () => {} };

const ORG = "eeeeeeee-5003-4000-8000-000000000001";
const GABRIEL = "eeeeeeee-5003-4000-8000-000000000002";
const EX_MEMBRO = "eeeeeeee-5003-4000-8000-000000000003";
const SESSAO_COM = "eeeeeeee-5003-4000-8000-000000000011";
const SESSAO_SEM = "eeeeeeee-5003-4000-8000-000000000012";
const SESSAO_EX = "eeeeeeee-5003-4000-8000-000000000013";
const AGENTE_COM = "eeeeeeee-5003-4000-8000-000000000021";
const AGENTE_SEM = "eeeeeeee-5003-4000-8000-000000000022";
const AGENTE_EX = "eeeeeeee-5003-4000-8000-000000000023";

let seq = 0;
/** Uma conversa nova (com contato próprio) numa sessão, para cada caso. */
async function conversaNova(sessao: string): Promise<{ contato: string; conversa: string }> {
  seq += 1;
  const sufixo = String(seq).padStart(4, "0");
  const contato = `eeeeeeee-5003-4000-8000-00000001${sufixo}`;
  const conversa = `eeeeeeee-5003-4000-8000-00000002${sufixo}`;
  await pool.query(`insert into contacts (id, organization_id, name, phone_number) values ($1,$2,'Maria Souza',$3)`, [
    contato,
    ORG,
    `+5561900${sufixo}`,
  ]);
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false)`,
    [conversa, ORG, contato, sessao],
  );
  return { contato, conversa };
}

async function agentePublicado(agente: string, sessao: string, destinatario: string | null) {
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,$3,'WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [sessao, ORG, `passagem-${sessao.slice(-2)}`],
  );
  await pool.query(`insert into ai_agents (id, organization_id, name, system_prompt) values ($1,$2,$3,'s')`, [
    agente,
    ORG,
    `Alice ${agente.slice(-2)}`,
  ]);
  const { rows } = await pool.query<{ id: string }>(
    `insert into ai_agent_versions
       (organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status,
        handoff_target_user_id)
     values ($1,$2,1,'s','anthropic','claude-sonnet-4-6',$3,'published',$4) returning id`,
    [ORG, agente, sessao, destinatario],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [rows[0]!.id, agente]);
}

async function estado(conversa: string) {
  const c = await pool.query<{ assigned_to_user_id: string | null; status: string; bot_silenced_until: string | null }>(
    `select assigned_to_user_id, status, bot_silenced_until::text from conversations where id = $1`,
    [conversa],
  );
  const avisos = await pool.query<{ kind: string; para_user_id: string | null; title: string }>(
    `select kind, para_user_id, title from agent_inbox_items where organization_id = $1 and ref_id = $2`,
    [ORG, conversa],
  );
  return { conversa: c.rows[0]!, avisos: avisos.rows };
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1,'passagem-5003','Nume','Nume')
     on conflict (id) do nothing`,
    [ORG],
  );
  for (const [id, email] of [
    [GABRIEL, "gabriel@nume.test"],
    [EX_MEMBRO, "saiu@nume.test"],
  ] as const) {
    await pool.query(`insert into auth.users (id, email) values ($1,$2) on conflict (id) do nothing`, [id, email]);
  }
  await pool.query(
    `insert into user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'agent',now())`,
    [ORG, GABRIEL],
  );
  await pool.query(
    `insert into user_organizations(organization_id,user_id,role,accepted_at,revoked_at) values($1,$2,'agent',now(),now())`,
    [ORG, EX_MEMBRO],
  );
  await agentePublicado(AGENTE_COM, SESSAO_COM, GABRIEL);
  await agentePublicado(AGENTE_SEM, SESSAO_SEM, null);
  await agentePublicado(AGENTE_EX, SESSAO_EX, EX_MEMBRO);
});

afterAll(async () => {
  await pool.end();
});

describe("passagem para humano", () => {
  it("com destinatário: atribui a conversa e o aviso da Central nasce com dono", async () => {
    const { contato, conversa } = await conversaNova(SESSAO_COM);
    await performHumanHandoff(
      pool,
      { tenantId: ORG, leadId: contato, conversationId: conversa },
      { reason: "requested_human", conversationSummary: "quer falar do iPhone 17", log: logMudo },
    );
    const e = await estado(conversa);
    expect(e.conversa.assigned_to_user_id).toBe(GABRIEL);
    expect(e.conversa.status).toBe("claimed");
    expect(e.avisos).toEqual([expect.objectContaining({ kind: "handoff", para_user_id: GABRIEL })]);
  });

  it("sem destinatário: comportamento de sempre (fila, aviso da empresa)", async () => {
    const { contato, conversa } = await conversaNova(SESSAO_SEM);
    await performHumanHandoff(
      pool,
      { tenantId: ORG, leadId: contato, conversationId: conversa },
      { reason: "requested_human", conversationSummary: "resumo", log: logMudo },
    );
    const e = await estado(conversa);
    expect(e.conversa.assigned_to_user_id).toBeNull();
    expect(e.conversa.status).toBe("pending");
    expect(e.avisos).toEqual([expect.objectContaining({ kind: "handoff", para_user_id: null })]);
  });

  it("destinatário que saiu da equipe: a passagem segue para a fila", async () => {
    const { contato, conversa } = await conversaNova(SESSAO_EX);
    await performHumanHandoff(
      pool,
      { tenantId: ORG, leadId: contato, conversationId: conversa },
      { reason: "requested_human", conversationSummary: "resumo", log: logMudo },
    );
    const e = await estado(conversa);
    expect(e.conversa.assigned_to_user_id).toBeNull();
    expect(e.avisos).toEqual([expect.objectContaining({ para_user_id: null })]);
  });
});

describe("caso aberto pela IA", () => {
  it("com destinatário: atribui sem calar a IA e avisa a pessoa na Central", async () => {
    const { conversa } = await conversaNova(SESSAO_COM);
    const r = await openCase(
      pool,
      { tenantId: ORG, conversationId: conversa, agentId: AGENTE_COM },
      { title: "Confirmar estoque do 17 Pro Max laranja", summary: "Cliente quer retirar hoje.", blocker: "estoque" },
    );
    expect(r.ok).toBe(true);
    const e = await estado(conversa);
    expect(e.conversa.assigned_to_user_id).toBe(GABRIEL);
    // `routing` não mexe no silêncio: a IA segue atendendo enquanto o caso espera.
    expect(e.conversa.bot_silenced_until).toBeNull();
    expect(e.avisos).toEqual([
      expect.objectContaining({ kind: "handoff", para_user_id: GABRIEL, title: expect.stringContaining("Confirmar estoque") }),
    ]);
  });

  it("sem destinatário: só o caso, como sempre", async () => {
    const { conversa } = await conversaNova(SESSAO_SEM);
    const r = await openCase(
      pool,
      { tenantId: ORG, conversationId: conversa, agentId: AGENTE_SEM },
      { title: "x", summary: "y", blocker: "z" },
    );
    expect(r.ok).toBe(true);
    const e = await estado(conversa);
    expect(e.conversa.assigned_to_user_id).toBeNull();
    expect(e.avisos).toEqual([]);
  });
});
