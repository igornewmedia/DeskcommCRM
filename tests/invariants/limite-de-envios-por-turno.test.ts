import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * O turno COMPLETO chamando `send_message` VÁRIAS vezes — defeito medido em
 * produção: um lead recebeu ~8 mensagens seguidas (variações da mesma pergunta
 * de qualificação) porque nenhum gate de `before-send.ts` limita CONTAGEM por
 * turno — `pacing` só limita RITMO. O único teto era `AGENT_MAX_STEPS`
 * (genérico, conta QUALQUER tool) e o circuit breaker só conta FALHAS — um
 * `send_message` que funciona repetidamente nunca é contado por ele.
 *
 * Harness igual a `agent-send-template-turn.test.ts`: `createInboundTurnHandler`
 * real, modelo fake via `createFakeRegistry`, canal que CAPTURA em vez de
 * enviar. `sleep` é no-op — o throttle de `pacing` "espera" sem esperar de
 * verdade, então não interfere na contagem que este arquivo mede.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "dddddddd-0000-4000-8000-000000000001";
const CONTACT = "dddddddd-0000-4000-8000-000000000002";
const SESSION = "dddddddd-0000-4000-8000-000000000003";
const CONV = "dddddddd-0000-4000-8000-000000000004";
const MSG = "dddddddd-0000-4000-8000-000000000005";
// Segunda sessão, com um agente publicado que declara o PRÓPRIO teto (migration 5001).
const SESSION_AGENTE = "dddddddd-0000-4000-8000-000000000013";
const CONV_AGENTE = "dddddddd-0000-4000-8000-000000000014";
const MSG_AGENTE = "dddddddd-0000-4000-8000-000000000015";
const AGENTE = "dddddddd-0000-4000-8000-000000000016";
const VERSAO_AGENTE = "dddddddd-0000-4000-8000-000000000017";
const NO_AGENTE = { session: SESSION_AGENTE, conv: CONV_AGENTE, msg: MSG_AGENTE };

interface EnvioCapturado {
  body: string;
}

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

let enviados: EnvioCapturado[] = [];
/** Todo resultado de tool que o modelo VIU — inclui repetição entre steps, de propósito
 * (o que importa é que o bloqueio apareceu em algum lugar, não em qual exatamente). */
let resultadosVistos: unknown[] = [];

const CHECKPOINT = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "turno de teste",
});

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** Modelo fake que chama `send_message` `n` vezes seguidas e só então encerra com o
 * checkpoint. `rotulo` PRECISA ser único por teste: os 3 casos compartilham a mesma
 * conversa/sessão, e o gate `spinning` (mass_identical) veta corpo REPETIDO entre
 * turnos — sem o rótulo, o 2º e 3º teste mandariam os MESMOS textos do 1º e o gate
 * (corretamente) bloquearia por um motivo que não é o desta suíte. */
function modeloQueInsisteEmMandar(n: number, rotulo: string) {
  return modeloQueManda(
    Array.from({ length: n }, (_, i) => `pergunta de qualificação número ${i + 1} (${rotulo})`),
  );
}

/** Modelo fake que chama `send_message` uma vez para cada corpo, na ordem. */
function modeloQueManda(corpos: string[]) {
  const n = corpos.length;
  let chamadas = 0;
  return async (opts: { prompt?: unknown }) => {
    const msgs = (opts.prompt ?? []) as Array<{ role: string; content?: unknown }>;
    for (const msg of msgs) {
      if (!Array.isArray(msg.content)) continue;
      for (const parte of msg.content as Array<Record<string, unknown>>) {
        if (parte.type === "tool-result") resultadosVistos.push(parte.output ?? parte);
      }
    }
    if (chamadas < n) {
      chamadas += 1;
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: `c${chamadas}`,
            toolName: "send_message",
            input: JSON.stringify({ body: corpos[chamadas - 1] }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return {
      content: [{ type: "text" as const, text: CHECKPOINT }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: USO,
      warnings: [],
    };
  };
}

function montaHandler(doGenerate: unknown, maxSendsPerTurn?: number) {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 12,
      ...(maxSendsPerTurn !== undefined ? { maxSendsPerTurn } : {}),
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 5,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 8,
        noProgressWarn: 3,
        noProgressBlock: 5,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(doGenerate as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: EnvioCapturado) => {
          enviados.push(i);
          return { kind: "sent" as const, idempotencyKey: `k${enviados.length}`, messageId: `m${enviados.length}` };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    // Terça, 15h BRT: dentro da janela anti-ban (7h-22h) — sem isso o gate `pacing`
    // vetaria por horário, e o teste mediria o motivo errado.
    clock: () => new Date("2026-07-28T18:00:00Z"),
    sleep: async () => {},
  });
}

async function rodaTurno(
  handler: ReturnType<typeof montaHandler>,
  alvo: { session: string; conv: string; msg: string } = { session: SESSION, conv: CONV, msg: MSG },
): Promise<Error | null> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: CONTACT,
    payload: {
      conversation_id: alvo.conv,
      contact_id: CONTACT,
      channel_session_id: alvo.session,
      inbound_message_id: alvo.msg,
      crm_event_id: "dddddddd-0000-4000-8000-000000000006",
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "sends-cap", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await handler(claimed!, pool, { workerId: "sends-cap" });
    await m.queue.completeJob(pool, claimed!.id, "sends-cap");
    return null;
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "sends-cap", err);
    return err as Error;
  }
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn"))
      .createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'limite-envios-turno','Limite Envios','Limite Envios') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1,$2,'Lead Insistido','+5511900000888') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'limite-envios-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered','Oi','external_device', now())
     on conflict (id) do nothing`,
    [MSG, ORG, CONV, SESSION, CONTACT],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'limite-envios-agente','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION_AGENTE, ORG],
  );
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente com teto 6', 'system') on conflict (id) do nothing`,
    [AGENTE, ORG],
  );
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id,
        status, split_messages, max_sends_per_turn)
     values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published', true, 6)
     on conflict (id) do nothing`,
    [VERSAO_AGENTE, ORG, AGENTE, SESSION_AGENTE],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSAO_AGENTE, AGENTE]);
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false) on conflict (id) do nothing`,
    [CONV_AGENTE, ORG, CONTACT, SESSION_AGENTE],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered','Oi','external_device', now())
     on conflict (id) do nothing`,
    [MSG_AGENTE, ORG, CONV_AGENTE, SESSION_AGENTE, CONTACT],
  );
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

beforeEach(() => {
  enviados = [];
  resultadosVistos = [];
});

describe("turno completo — send_message chamado repetidamente pelo modelo", () => {
  it("o modelo insiste 5x e só as 2 primeiras (o teto) saem pro canal", async () => {
    const erro = await rodaTurno(montaHandler(modeloQueInsisteEmMandar(5, "caso-a"), 2));
    expect(erro).toBeNull();

    // O teto é o que decide QUANTAS mensagens físicas chegam ao lead — não o modelo.
    expect(enviados).toHaveLength(2);
    expect(enviados.map((e) => e.body)).toEqual([
      "pergunta de qualificação número 1 (caso-a)",
      "pergunta de qualificação número 2 (caso-a)",
    ]);

    // E o modelo RECEBEU o motivo do bloqueio — sem isto, "bloqueou" não distingue de
    // "engoliu em silêncio", que é o mesmo defeito medido em produção com outra cara.
    const vistos = JSON.stringify(resultadosVistos);
    expect(vistos).toMatch(/max_sends_per_turn/);
    expect(vistos).toMatch(/encerre o turno/);
  });

  it("sem o knob explícito, o teto padrão (DEFAULT_MAX_SENDS_PER_TURN) ainda protege", async () => {
    const { DEFAULT_MAX_SENDS_PER_TURN } = await import("@/lib/agent-engine/agent/inbound-turn");
    const erro = await rodaTurno(
      montaHandler(modeloQueInsisteEmMandar(DEFAULT_MAX_SENDS_PER_TURN + 3, "caso-b")),
    );
    expect(erro).toBeNull();
    expect(enviados).toHaveLength(DEFAULT_MAX_SENDS_PER_TURN);
  });

  it("dentro do teto, nada é bloqueado — a rede não aperta quem manda pouco", async () => {
    const erro = await rodaTurno(montaHandler(modeloQueInsisteEmMandar(2, "caso-c"), 3));
    expect(erro).toBeNull();
    expect(enviados).toHaveLength(2);
    expect(JSON.stringify(resultadosVistos)).not.toMatch(/max_sends_per_turn/);
  });
});

describe("teto do AGENTE (migration 5001) — vence o da instalação", () => {
  it("agente com 6 manda até 6 mensagens mesmo com a instalação em 2", async () => {
    const erro = await rodaTurno(montaHandler(modeloQueInsisteEmMandar(8, "caso-d"), 2), NO_AGENTE);
    expect(erro).toBeNull();
    expect(enviados).toHaveLength(6);
    expect(JSON.stringify(resultadosVistos)).toMatch(/teto: 6/);
  });

  it("em bolhas: 8 parágrafos saem em 6 bolhas, o excedente junto na última", async () => {
    const paragrafos = Array.from({ length: 8 }, (_, i) => `Parágrafo ${i + 1} do caso-e.`);
    const erro = await rodaTurno(montaHandler(modeloQueManda([paragrafos.join("\n\n")]), 2), NO_AGENTE);
    expect(erro).toBeNull();
    expect(enviados).toHaveLength(6);
    expect(enviados[0]?.body).toBe("Parágrafo 1 do caso-e.");
    expect(enviados[5]?.body).toContain("Parágrafo 6 do caso-e.");
    expect(enviados[5]?.body).toContain("Parágrafo 8 do caso-e.");
  });
});
