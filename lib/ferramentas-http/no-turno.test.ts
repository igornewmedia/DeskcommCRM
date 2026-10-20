/**
 * As ferramentas HTTP no turno: limites, turno só-leitura, confirmação em duas
 * fases, turno vencido e colisão de nome. A saída de rede é a de verdade
 * (`fetchDeSaida` + `allowlistedFetch`) com o `fetch` nativo trocado por um que
 * conta chamadas — o que se prova aqui é QUANDO a chamada sai, não o HTTP.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ guarda: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/atendimento/fronteira-server", () => ({ guardServiceEffect: deps.guarda }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: deps.audit }));

import type { FerramentaParaExecutar, LinhaPublica } from "./repositorio";
import {
  ehFerramentaHttpDoTurno,
  hashDosArgumentos,
  JANELA_DA_CONFIRMACAO_MS,
  MAX_POR_FERRAMENTA,
  montarFerramentasHttp,
  type ContextoDoTurnoHttp,
} from "./no-turno";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "44444444-4444-4444-8444-444444444444";
const TOOL = "33333333-3333-4333-8333-333333333333";
const AGORA = Date.parse("2026-10-19T12:00:00Z");

interface Estado {
  runs: Record<string, unknown>[];
  ultima: { status: string; created_at: string } | null;
  mensagens: unknown[];
}
let estado: Estado;
let chamadasDeRede: number;

function fakeSupabase() {
  return {
    from(tabela: string) {
      const chain = {
        insert: async (linha: Record<string, unknown>) => {
          estado.runs.push(linha);
          return { error: null };
        },
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () =>
          tabela === "messages"
            ? Promise.resolve({ data: estado.mensagens, error: null })
            : chain,
        maybeSingle: async () => ({ data: estado.ultima, error: null }),
      };
      return chain;
    },
  };
}

function linha(parcial: Partial<LinhaPublica> = {}): LinhaPublica {
  return {
    kind: "http",
    code: null,
    id: TOOL,
    organization_id: ORG,
    slug: "consultar_horarios",
    name: "Consultar horários",
    description: "Consulta horários livres.",
    is_active: true,
    method: "POST",
    url: "https://exemplo.com/horarios",
    headers: {},
    query: {},
    body_template: null,
    parameters: [{ name: "data", type: "string", required: true, description: "Data" }],
    response_map: null,
    response_instructions: null,
    auth_type: "none",
    auth_header_name: null,
    effect: "consulta",
    requires_confirmation: false,
    safe_to_retry: false,
    timeout_ms: 2_000,
    secret_last4: null,
    created_by: null,
    updated_by: null,
    created_at: "",
    updated_at: "",
    ...parcial,
  };
}

function montar(l: LinhaPublica, parcial: Partial<ContextoDoTurnoHttp> = {}) {
  const ferramenta: FerramentaParaExecutar = { linha: l, cadastro: l, segredo: null };
  return montarFerramentasHttp([ferramenta], {
    supabase: fakeSupabase() as never,
    ctx: { organizationId: ORG, actor: { type: "ai_agent", id: "ag" } } as never,
    auth: { scopes: ["mcp:read", "mcp:write"] } as never,
    agentId: "55555555-5555-4555-8555-555555555555",
    conversationId: CONVERSA,
    jobId: "job-1",
    nomesOcupados: new Set(["crm_search_contacts"]),
    agora: () => AGORA,
    opcoesDeExecucao: {
      guarda: {
        conferirUrl: () => undefined,
        conferirIp: async () => undefined,
        fetchImpl: (async () => {
          chamadasDeRede += 1;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }) as typeof fetch,
      },
      esperar: async () => undefined,
    },
    ...parcial,
  });
}

async function chamar(tools: ReturnType<typeof montar>, nome: string, args: unknown) {
  const t = tools[nome] as { execute: (a: unknown, o: unknown) => Promise<Record<string, unknown>> };
  return t.execute(args, { toolCallId: "x", messages: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.guarda.mockResolvedValue(undefined);
  estado = { runs: [], ultima: null, mensagens: [] };
  chamadasDeRede = 0;
});

describe("consulta no turno", () => {
  it("executa, grava o histórico do turno com os nomes e marca a tool para a prévia", async () => {
    const tools = montar(linha());
    expect(ehFerramentaHttpDoTurno(tools.consultar_horarios)).toBe(true);
    const r = await chamar(tools, "consultar_horarios", { data: "amanhã" });
    expect(r).toMatchObject({ ok: true, status: "sucesso" });
    expect(chamadasDeRede).toBe(1);
    expect(estado.runs[0]).toMatchObject({
      origin: "turno",
      status: "sucesso",
      conversation_id: CONVERSA,
      param_names: ["data"],
      args_hash: null,
    });
    expect(JSON.stringify(estado.runs)).not.toContain("amanhã");
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain("amanhã");
  });

  it("para no limite por ferramenta e não sai para a rede", async () => {
    const tools = montar(linha());
    for (let i = 0; i < MAX_POR_FERRAMENTA; i++) await chamar(tools, "consultar_horarios", { data: "d" });
    const r = await chamar(tools, "consultar_horarios", { data: "d" });
    expect(r.status).toBe("limite_excedido");
    expect(chamadasDeRede).toBe(MAX_POR_FERRAMENTA);
  });

  it("parâmetro obrigatório faltando volta ao modelo sem rede", async () => {
    const r = await chamar(montar(linha()), "consultar_horarios", {});
    expect(r.status).toBe("parametros_invalidos");
    expect(chamadasDeRede).toBe(0);
  });

  it("nome que colide com o catálogo não é montado", () => {
    expect(montar(linha({ slug: "crm_search_contacts" }))).toEqual({});
  });
});

describe("ação no turno", () => {
  const acao = linha({ slug: "marcar_horario", effect: "acao" });

  it("turno só-leitura (prévia) não executa ação", async () => {
    const r = await chamar(montar(acao, { auth: { scopes: ["mcp:read"] } as never }), "marcar_horario", { data: "d" });
    expect(r.status).toBe("bloqueado");
    expect(chamadasDeRede).toBe(0);
  });

  it("turno vencido não dispara o efeito", async () => {
    deps.guarda.mockRejectedValue(new Error("stale"));
    const r = await chamar(montar(acao), "marcar_horario", { data: "d" });
    expect(r.status).toBe("bloqueado");
    expect(chamadasDeRede).toBe(0);
    expect(estado.runs[0]).toMatchObject({ status: "bloqueado", error_code: "turno_vencido" });
  });

  it("sem confirmação exigida, executa depois da guarda da fronteira", async () => {
    const r = await chamar(montar(acao), "marcar_horario", { data: "d" });
    expect(r.status).toBe("sucesso");
    expect(deps.guarda).toHaveBeenCalledTimes(1);
  });
});

describe("confirmação em duas fases", () => {
  const confirmar = linha({ slug: "cancelar_pedido", effect: "acao", requires_confirmation: true });
  const ARGS = { data: "2026-10-20" };
  const pedidoHa = (ms: number) => new Date(AGORA - ms).toISOString();

  it("primeira chamada não sai: grava o pedido com o hash e manda confirmar", async () => {
    const r = await chamar(montar(confirmar), "cancelar_pedido", ARGS);
    expect(r).toMatchObject({ status: "aguardando_confirmacao", valores_para_confirmar: ARGS });
    expect(chamadasDeRede).toBe(0);
    expect(estado.runs[0]).toMatchObject({
      status: "aguardando_confirmacao",
      args_hash: hashDosArgumentos(TOOL, ARGS),
    });
  });

  it("com o pedido pendente e resposta do cliente depois dele, executa", async () => {
    estado.ultima = { status: "aguardando_confirmacao", created_at: pedidoHa(60_000) };
    estado.mensagens = [{ id: "m1" }];
    const r = await chamar(montar(confirmar), "cancelar_pedido", ARGS);
    expect(r.status).toBe("sucesso");
    expect(chamadasDeRede).toBe(1);
  });

  it("sem mensagem do cliente no meio (ex.: follow-up), não executa", async () => {
    estado.ultima = { status: "aguardando_confirmacao", created_at: pedidoHa(60_000) };
    const r = await chamar(montar(confirmar), "cancelar_pedido", ARGS);
    expect(r.status).toBe("aguardando_confirmacao");
    expect(chamadasDeRede).toBe(0);
  });

  it("pedido vencido ou já executado pede confirmação de novo", async () => {
    estado.mensagens = [{ id: "m1" }];
    estado.ultima = { status: "aguardando_confirmacao", created_at: pedidoHa(JANELA_DA_CONFIRMACAO_MS + 1) };
    expect((await chamar(montar(confirmar), "cancelar_pedido", ARGS)).status).toBe("aguardando_confirmacao");
    estado.ultima = { status: "sucesso", created_at: pedidoHa(60_000) };
    expect((await chamar(montar(confirmar), "cancelar_pedido", ARGS)).status).toBe("aguardando_confirmacao");
    expect(chamadasDeRede).toBe(0);
  });

  it("valores diferentes têm hash diferente", () => {
    expect(hashDosArgumentos(TOOL, { data: "2026-10-20" })).not.toBe(hashDosArgumentos(TOOL, { data: "2026-10-21" }));
    expect(hashDosArgumentos(TOOL, { a: 1, b: 2 })).toBe(hashDosArgumentos(TOOL, { b: 2, a: 1 }));
  });
});
