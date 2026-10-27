import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { latestCheckpoint } from "@/lib/agent-engine/agent/inbound-turn";
import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

import { GOV_ORG, GOV_SESSION, seedGov } from "./gov-helpers";

/**
 * "REINICIAR MEMÓRIA DA IA" (migration 5004), no banco de verdade: o que a rota
 * faz — fechar o atendimento (`fn_service_status`) e chamar
 * `fn_reiniciar_memoria_da_ia` — e o que o PRÓXIMO turno lê depois disso.
 * Depois de reiniciar, o turno se comporta como o primeiro: sem checkpoint,
 * sem notas, funil em `new` e sem as mensagens anteriores no contexto — que
 * continuam na conversa.
 */

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});

let contato: string;
let conversa: string;

async function mensagem(direction: "inbound" | "outbound", body: string, segundosAtras: number) {
  await pool.query(
    `insert into messages(organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at,metadata)
     values($1,$2,$3,$4,'text',$5,$6,'external_device',$7,clock_timestamp() - make_interval(secs => $8),'{"raw_type":"chat"}')`,
    [GOV_ORG, conversa, GOV_SESSION, contato, direction, direction === "inbound" ? "delivered" : "sent", body, segundosAtras],
  );
}

async function contexto() {
  const r = await getLeadContext(
    pool,
    {} as never,
    { tenantId: GOV_ORG, leadId: contato, conversationId: conversa, fuso: "America/Sao_Paulo" },
    { historyLimit: 20, maxTokens: 4000 } as never,
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  return JSON.stringify(r.context);
}

beforeAll(async () => {
  await seedGov();
  contato = randomUUID();
  conversa = randomUUID();
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,'Cliente de teste')", [
    contato,
    GOV_ORG,
  ]);
  await pool.query(
    `insert into conversations(id,organization_id,contact_id,channel_session_id,channel,status,is_group)
     values($1,$2,$3,$4,'whatsapp','open',false)`,
    [conversa, GOV_ORG, contato, GOV_SESSION],
  );
  await mensagem("inbound", "SONDA_ANTES_CLIENTE", 120);
  await mensagem("outbound", "SONDA_ANTES_IA", 60);
  await pool.query(
    `insert into lead_checkpoints (organization_id, contact_id, rolling_summary, next_action)
     values ($1,$2,'RESUMO_ANTIGO','ligar amanhã')`,
    [GOV_ORG, contato],
  );
  await pool.query(
    `insert into lead_notes (organization_id, contact_id, headline, body) values ($1,$2,'NOTA_ANTIGA','quer o 17 Pro Max')`,
    [GOV_ORG, contato],
  );
  await pool.query(
    `insert into lead_state (organization_id, contact_id, stage, next_action) values ($1,$2,'negotiating','fechar')`,
    [GOV_ORG, contato],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("reiniciar memória da IA", () => {
  it("antes: o turno lê o histórico, o checkpoint e a etapa", async () => {
    expect(await contexto()).toContain("SONDA_ANTES_CLIENTE");
    expect((await latestCheckpoint(pool, GOV_ORG, contato))?.rolling_summary).toBe("RESUMO_ANTIGO");
  });

  it("depois: o próximo turno começa do zero, e as mensagens seguem na conversa", async () => {
    const { rows } = await pool.query<{ service_revision: string }>(
      "select service_revision from conversations where id = $1",
      [conversa],
    );
    await pool.query("select * from public.fn_service_status($1,$2,'closed',$3)", [
      GOV_ORG,
      conversa,
      rows[0]!.service_revision,
    ]);
    const { rows: resumo } = await pool.query<{ r: { checkpoints: number; notas: number; estagio_anterior: string } }>(
      "select public.fn_reiniciar_memoria_da_ia($1,$2) as r",
      [GOV_ORG, contato],
    );
    expect(resumo[0]!.r).toEqual({ checkpoints: 1, notas: 1, estagio_anterior: "negotiating" });

    // O cliente volta a escrever: atendimento novo.
    await mensagem("inbound", "SONDA_DEPOIS", 0);
    const ctx = await contexto();
    expect(ctx).toContain("SONDA_DEPOIS");
    expect(ctx).not.toContain("SONDA_ANTES_CLIENTE");
    expect(ctx).not.toContain("SONDA_ANTES_IA");
    expect(await latestCheckpoint(pool, GOV_ORG, contato)).toBeNull();

    const notas = await pool.query("select 1 from lead_notes where organization_id=$1 and contact_id=$2", [GOV_ORG, contato]);
    expect(notas.rows).toHaveLength(0);
    const estado = await pool.query<{ stage: string; next_action: string | null }>(
      "select stage, next_action from lead_state where organization_id=$1 and contact_id=$2",
      [GOV_ORG, contato],
    );
    expect(estado.rows[0]).toEqual({ stage: "new", next_action: null });
    const transicao = await pool.query<{ reason: string }>(
      "select reason from lead_state_transitions where organization_id=$1 and contact_id=$2 order by seq desc limit 1",
      [GOV_ORG, contato],
    );
    expect(transicao.rows[0]?.reason).toBe("memoria_da_ia_reiniciada");

    // Nada foi apagado da conversa.
    const msgs = await pool.query("select body from messages where conversation_id=$1 order by sent_at", [conversa]);
    expect(msgs.rows.map((m) => m.body)).toEqual(["SONDA_ANTES_CLIENTE", "SONDA_ANTES_IA", "SONDA_DEPOIS"]);
  });

  it("contato de outra organização é recusado", async () => {
    await expect(
      pool.query("select public.fn_reiniciar_memoria_da_ia($1,$2)", [randomUUID(), contato]),
    ).rejects.toThrow(/contato_nao_encontrado/);
  });
});
