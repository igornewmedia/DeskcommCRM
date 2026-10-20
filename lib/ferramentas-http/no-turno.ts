/**
 * As ferramentas HTTP ESCOLHIDAS pelo agente virando tools do turno.
 *
 * ── Por que não passam por `wrapMcpTool` ────────────────────────────────────
 * Lá moram duas guardas de registro DO CRM: o escopo do contato
 * (`escritaCabeNoTurno`) e o de funil (`podeChamarFerramenta`). As duas recusam
 * toda escrita que não conhecem por nome — de propósito, para nenhuma
 * ferramenta nova nascer fora do gate. Uma ferramenta HTTP não carrega id do
 * CRM nenhum: passar por ali faria toda AÇÃO ser recusada numa conversa, e a
 * classificar como "leitura" para atravessar seria mentir para as duas.
 *
 * Então ela tem o montador dela, com as peças de lá que valem para ela e as
 * guardas próprias por cima:
 *  - `ensureScope`: turno só-leitura (prévia) não executa AÇÃO;
 *  - `guardServiceEffect`: turno vencido (cliente assumido por humano, job
 *    perdido) não dispara efeito no sistema de fora;
 *  - `auditMcpToolCall`: a mesma auditoria das outras tools, com os NOMES dos
 *    parâmetros e nunca os valores;
 *  - limite por turno: `MAX_POR_FERRAMENTA` chamadas de cada e `MAX_NO_TURNO`
 *    no total — um modelo em laço não martela o sistema do cliente;
 *  - confirmação em duas fases (abaixo).
 *
 * ── Confirmação explícita ───────────────────────────────────────────────────
 * Ferramenta de AÇÃO marcada "exige confirmação": a primeira chamada NÃO sai
 * para a rede. Grava `aguardando_confirmacao` com o sha256 dos valores e manda
 * o modelo perguntar ao cliente. Só executa uma chamada com os MESMOS valores,
 * na MESMA conversa, em até `JANELA_DA_CONFIRMACAO_MS`, e só se o CLIENTE
 * escreveu depois do pedido (mensagem `inbound`). Follow-up automático não é
 * cliente: sem mensagem dele no meio, a confirmação não vale. O pedido vale
 * uma vez: depois da execução, a linha mais recente daquele hash já não é a
 * pendente, e uma nova ação pede nova confirmação.
 */
import { createHash } from "node:crypto";

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { guardServiceEffect } from "@/lib/atendimento/fronteira-server";
import { logger } from "@/lib/logger";
import { auditMcpToolCall } from "@/lib/mcp/audit";
import { ensureScope, McpAuthError, type McpAuthResult } from "@/lib/mcp/auth";
import type { McpContext } from "@/lib/mcp/types";

import { executarFerramentaHttp, type OpcoesDeExecucao, type ResultadoDaExecucao } from "./executar";
import { lerToolIdHttp } from "./ids";
import { respostaParaOModelo } from "./para-o-modelo";
import { COLUNAS_PUBLICAS, registrarExecucao, type FerramentaParaExecutar, type LinhaPublica } from "./repositorio";
import { shapeDosParametros, validarArgumentos } from "./schema";
import { abrirSegredo } from "./segredo";
import type { StatusDaExecucao } from "./vocabulario";

export const MAX_POR_FERRAMENTA = 5;
export const MAX_NO_TURNO = 10;
export const JANELA_DA_CONFIRMACAO_MS = 30 * 60 * 1000;
/** Teto de ferramentas HTTP montadas num turno — contexto do modelo é caro. */
export const MAX_FERRAMENTAS_HTTP_NO_TURNO = 10;

/**
 * As tools que este módulo montou. A prévia do agente (`preview.ts`) pergunta
 * aqui para transformá-las em PROPOSTA: no Testar do agente nenhuma chamada
 * HTTP sai — quem testa a ferramenta é o botão dela.
 */
const MONTADAS = new WeakSet<object>();
export function ehFerramentaHttpDoTurno(t: unknown): boolean {
  return typeof t === "object" && t !== null && MONTADAS.has(t);
}

/** Lê as ferramentas ativas que `tool_ids` escolheu, já com a credencial aberta. */
export async function carregarFerramentasHttpDoTurno(
  supabase: SupabaseClient,
  organizationId: string,
  toolIds: readonly string[],
): Promise<FerramentaParaExecutar[]> {
  const ids = [...new Set(toolIds.map(lerToolIdHttp).filter((id): id is string => id !== null))].slice(
    0,
    MAX_FERRAMENTAS_HTTP_NO_TURNO,
  );
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("ai_http_tools")
    .select(`${COLUNAS_PUBLICAS}, secret_encrypted, secret_iv, secret_tag`)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .in("id", ids);
  if (error) {
    // Ferramenta extra é privilégio, não invariante: o turno segue sem ela.
    logger.warn("[ferramentas-http] leitura das ferramentas do turno falhou", { organizationId, error: error.message });
    return [];
  }
  return ((data ?? []) as Array<LinhaPublica & Record<"secret_encrypted" | "secret_iv" | "secret_tag", unknown>>).map(
    ({ secret_encrypted, secret_iv, secret_tag, ...linha }) => ({
      linha,
      cadastro: linha,
      segredo: linha.auth_type === "none" ? null : abrirSegredo({ secret_encrypted, secret_iv, secret_tag }),
    }),
  );
}

export interface ContextoDoTurnoHttp {
  supabase: SupabaseClient;
  ctx: McpContext;
  auth: McpAuthResult;
  agentId: string | null;
  conversationId: string | null;
  jobId: string | null;
  /** Nomes já ocupados (catálogo compilado): a ferramenta HTTP nunca se passa por um deles. */
  nomesOcupados: ReadonlySet<string>;
  /** JUNTA DE TESTE do executor; em produção, ausente. */
  opcoesDeExecucao?: Pick<OpcoesDeExecucao, "guarda" | "esperar">;
  agora?: () => number;
}

/** Valores em ordem estável → sha256. Muda um valor, muda o hash. */
export function hashDosArgumentos(toolId: string, args: Record<string, unknown>): string {
  const ordenado = Object.keys(args)
    .sort()
    .map((k) => [k, args[k]]);
  return createHash("sha256").update(`${toolId}\n${JSON.stringify(ordenado)}`).digest("hex");
}

function descricaoParaOModelo(linha: LinhaPublica): string {
  const partes = [linha.description.trim()];
  partes.push(
    "Se faltar um parâmetro obrigatório, pergunte ao cliente antes de chamar; nunca invente o valor.",
  );
  if (linha.effect === "acao") {
    partes.push(
      linha.requires_confirmation
        ? "Esta ferramenta EXECUTA uma ação e exige que o cliente confirme os valores antes."
        : "Esta ferramenta EXECUTA uma ação no sistema da empresa.",
    );
  }
  return partes.join(" ");
}

type Recusa = { ok: false; status: StatusDaExecucao; orientacao: string };

export function montarFerramentasHttp(
  ferramentas: readonly FerramentaParaExecutar[],
  turno: ContextoDoTurnoHttp,
): Record<string, Tool> {
  const agora = turno.agora ?? Date.now;
  const porFerramenta = new Map<string, number>();
  let noTurno = 0;
  const saida: Record<string, Tool> = {};

  for (const ferramenta of ferramentas) {
    const { linha } = ferramenta;
    if (turno.nomesOcupados.has(linha.slug) || saida[linha.slug]) {
      logger.warn("[ferramentas-http] nome colide com ferramenta existente — desconsiderada", {
        organizationId: turno.ctx.organizationId,
        slug: linha.slug,
      });
      continue;
    }
    const ehAcao = linha.effect === "acao";

    const registrar = (r: ResultadoDaExecucao | Recusa, nomes: string[], argsHash?: string) =>
      registrarExecucao(turno.supabase, {
        organizationId: turno.ctx.organizationId,
        toolId: linha.id,
        origin: "turno",
        status: r.status,
        httpStatus: "httpStatus" in r ? r.httpStatus : undefined,
        duracaoMs: "duracaoMs" in r ? r.duracaoMs : 0,
        tentativas: "tentativas" in r ? r.tentativas : 1,
        paramNames: nomes,
        argsHash: argsHash ?? null,
        bytes: "bytes" in r ? r.bytes : undefined,
        erro: "erro" in r ? r.erro : undefined,
        agentId: turno.agentId,
        conversationId: turno.conversationId,
        jobId: turno.jobId,
      });

    const auditar = (nomes: string[], inicio: number, sucesso: boolean, erro?: string) =>
      void auditMcpToolCall({
        ctx: turno.ctx,
        toolName: linha.slug,
        // Os NOMES: o valor é dado do cliente, e audit é lugar de metadado.
        args: { ferramenta_http: linha.id, parametros: nomes },
        durationMs: Math.max(0, agora() - inicio),
        success: sucesso,
        ...(erro ? { errorMessage: erro } : {}),
      });

    const executar = async (argsBrutos: unknown): Promise<Record<string, unknown>> => {
      const inicio = agora();
      const args = (argsBrutos ?? {}) as Record<string, unknown>;
      const nomes = Object.keys(args);

      const usadas = porFerramenta.get(linha.id) ?? 0;
      if (usadas >= MAX_POR_FERRAMENTA || noTurno >= MAX_NO_TURNO) {
        const r: ResultadoDaExecucao = { status: "limite_excedido", ok: false, duracaoMs: 0, tentativas: 1, erro: "limite_excedido" };
        await registrar(r, nomes);
        auditar(nomes, inicio, false, "limite_excedido");
        return respostaParaOModelo(r, null);
      }
      porFerramenta.set(linha.id, usadas + 1);
      noTurno += 1;

      if (ehAcao) {
        try {
          ensureScope(turno.auth.scopes, "mcp:write");
        } catch (e) {
          if (!(e instanceof McpAuthError)) throw e;
          auditar(nomes, inicio, false, "turno_somente_leitura");
          return {
            ok: false,
            status: "bloqueado",
            orientacao: "Esta ação não está disponível agora. Não diga ao cliente que ela foi feita.",
          };
        }
      }

      const validacao = validarArgumentos(linha.parameters, args);
      if (!validacao.ok) {
        const r: ResultadoDaExecucao = {
          status: "parametros_invalidos",
          ok: false,
          duracaoMs: 0,
          tentativas: 1,
          erro: "parametros_invalidos",
          problemas: validacao.problemas,
        };
        await registrar(r, nomes);
        auditar(nomes, inicio, false, "parametros_invalidos");
        return respostaParaOModelo(r, null);
      }

      let argsHash: string | undefined;
      if (ehAcao && linha.requires_confirmation) {
        argsHash = hashDosArgumentos(linha.id, validacao.args);
        const confirmada = await confirmacaoValida(turno, linha.id, argsHash, agora());
        if (confirmada === "indisponivel") {
          auditar(nomes, inicio, false, "confirmacao_indisponivel");
          return {
            ok: false,
            status: "bloqueado",
            orientacao: "Não consegui conferir a confirmação agora. Não execute nem diga que executou; tente de novo.",
          };
        }
        if (!confirmada) {
          const pendente: Recusa = {
            ok: false,
            status: "aguardando_confirmacao",
            orientacao:
              "A ação NÃO foi executada. Mostre ao cliente os valores abaixo e peça que ele confirme. " +
              "Só chame esta ferramenta de novo, com EXATAMENTE os mesmos valores, depois que ele confirmar.",
          };
          await registrar(pendente, nomes, argsHash);
          auditar(nomes, inicio, true, "aguardando_confirmacao");
          return { ...pendente, valores_para_confirmar: validacao.args };
        }
      }

      // Efeito no sistema de fora: o turno ainda é dono da conversa?
      if (ehAcao) {
        try {
          await guardServiceEffect();
        } catch {
          const r: ResultadoDaExecucao = { status: "bloqueado", ok: false, duracaoMs: 0, tentativas: 1, erro: "turno_vencido" };
          await registrar(r, nomes, argsHash);
          auditar(nomes, inicio, false, "turno_vencido");
          return {
            ok: false,
            status: "bloqueado",
            orientacao: "A ação NÃO foi executada: este atendimento mudou de mãos. Não diga ao cliente que ela foi feita.",
          };
        }
      }

      const resultado = await executarFerramentaHttp(ferramenta.cadastro, validacao.args, {
        segredo: ferramenta.segredo,
        ...(turno.opcoesDeExecucao ?? {}),
      });
      await registrar(resultado, nomes, argsHash);
      auditar(nomes, inicio, resultado.ok, resultado.ok ? undefined : resultado.erro);
      return respostaParaOModelo(resultado, linha.response_instructions);
    };

    const montada = tool({
      description: descricaoParaOModelo(linha),
      inputSchema: z.object(shapeDosParametros(linha.parameters)),
      execute: executar,
    });
    MONTADAS.add(montada);
    saida[linha.slug] = montada;
  }
  return saida;
}

/**
 * A chamada de agora confirma um pedido pendente?
 * `true` só com as três condições; erro de leitura é `"indisponivel"`, nunca
 * "confirmado" — falhar aqui não pode virar ação sem o cliente.
 */
async function confirmacaoValida(
  turno: ContextoDoTurnoHttp,
  toolId: string,
  argsHash: string,
  agora: number,
): Promise<boolean | "indisponivel"> {
  if (!turno.conversationId) return false;
  const ultima = await turno.supabase
    .from("ai_http_tool_runs")
    .select("status, created_at")
    .eq("organization_id", turno.ctx.organizationId)
    .eq("tool_id", toolId)
    .eq("conversation_id", turno.conversationId)
    .eq("args_hash", argsHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string; created_at: string }>();
  if (ultima.error) return "indisponivel";
  const pedido = ultima.data;
  if (!pedido || pedido.status !== "aguardando_confirmacao") return false;
  if (agora - Date.parse(pedido.created_at) > JANELA_DA_CONFIRMACAO_MS) return false;

  const resposta = await turno.supabase
    .from("messages")
    .select("id")
    .eq("organization_id", turno.ctx.organizationId)
    .eq("conversation_id", turno.conversationId)
    .eq("direction", "inbound")
    .gt("created_at", pedido.created_at)
    .limit(1);
  if (resposta.error) return "indisponivel";
  return (resposta.data ?? []).length > 0;
}
