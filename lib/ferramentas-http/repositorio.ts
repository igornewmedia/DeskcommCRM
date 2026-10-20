/**
 * Leitura e escrita de `ai_http_tools` / `ai_http_tool_runs` pelo servidor.
 *
 * Toda função recebe o `organization_id` de fonte confiável (sessão, job) e o
 * aplica em TODA query: o client é service role e ignora a RLS. As colunas
 * cifradas só são lidas em `carregarParaExecutar`, e o que sai de lá é o
 * plaintext para a chamada — nunca a linha com as colunas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import type { CadastroExecutavel } from "./executar";
import type { FerramentaHttp } from "./schema";
import { abrirSegredo } from "./segredo";
import type { OrigemDaExecucao, StatusDaExecucao } from "./vocabulario";

/** O que a tela recebe. Literal: o client do Supabase tipa lendo o texto do select. */
export const COLUNAS_PUBLICAS =
  "id, organization_id, slug, name, description, is_active, kind, code, method, url, headers, query, body_template, parameters, response_map, response_instructions, auth_type, auth_header_name, secret_last4, effect, requires_confirmation, safe_to_retry, timeout_ms, created_by, updated_by, created_at, updated_at";

export const COLUNAS_DO_HISTORICO =
  "id, tool_id, agent_id, conversation_id, origin, status, http_status, duration_ms, attempts, param_names, response_bytes, error_code, created_by, created_at";

export type LinhaPublica = FerramentaHttp & {
  id: string;
  organization_id: string;
  secret_last4: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function lerFerramenta(
  admin: SupabaseClient,
  organizationId: string,
  id: string,
): Promise<LinhaPublica | null> {
  const { data, error } = await admin
    .from("ai_http_tools")
    .select(COLUNAS_PUBLICAS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<LinhaPublica>();
  if (error) throw new Error(`ai_http_tools: ${error.message}`);
  return data;
}

export interface FerramentaParaExecutar {
  linha: LinhaPublica;
  cadastro: CadastroExecutavel;
  /** Plaintext da credencial; `null` com autenticação ligada = credencial que não abre. */
  segredo: string | null;
}

export async function carregarParaExecutar(
  admin: SupabaseClient,
  organizationId: string,
  id: string,
): Promise<FerramentaParaExecutar | null> {
  const { data, error } = await admin
    .from("ai_http_tools")
    .select(`${COLUNAS_PUBLICAS}, secret_encrypted, secret_iv, secret_tag`)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<LinhaPublica & { secret_encrypted: unknown; secret_iv: unknown; secret_tag: unknown }>();
  if (error) throw new Error(`ai_http_tools: ${error.message}`);
  if (!data) return null;
  const { secret_encrypted, secret_iv, secret_tag, ...linha } = data;
  return {
    linha,
    cadastro: linha,
    segredo:
      linha.auth_type === "none" ? null : abrirSegredo({ secret_encrypted, secret_iv, secret_tag }),
  };
}

export interface RegistroDeExecucao {
  organizationId: string;
  toolId: string;
  origin: OrigemDaExecucao;
  status: StatusDaExecucao;
  httpStatus?: number | undefined;
  duracaoMs: number;
  tentativas: number;
  /** Só os NOMES — o valor é dado do cliente. */
  paramNames: readonly string[];
  /** Só em ferramenta com confirmação: sha256 dos valores (ver `no-turno.ts`). */
  argsHash?: string | null;
  bytes?: number | undefined;
  erro?: string | undefined;
  agentId?: string | null;
  conversationId?: string | null;
  jobId?: string | null;
  createdBy?: string | null;
}

/**
 * Grava uma linha no histórico. Falha de escrita não derruba a chamada que já
 * aconteceu: vira log e segue (mesma postura do audit log).
 */
export async function registrarExecucao(admin: SupabaseClient, r: RegistroDeExecucao): Promise<void> {
  const { error } = await admin.from("ai_http_tool_runs").insert({
    organization_id: r.organizationId,
    tool_id: r.toolId,
    origin: r.origin,
    status: r.status,
    http_status: r.httpStatus ?? null,
    duration_ms: r.duracaoMs,
    attempts: Math.min(Math.max(r.tentativas, 1), 5),
    param_names: [...r.paramNames].slice(0, 50),
    args_hash: r.argsHash ?? null,
    response_bytes: r.bytes ?? null,
    error_code: r.erro ? r.erro.slice(0, 120) : null,
    agent_id: r.agentId ?? null,
    conversation_id: r.conversationId ?? null,
    job_id: r.jobId ?? null,
    created_by: r.createdBy ?? null,
  });
  if (error) {
    logger.error("[ferramentas-http] histórico não gravado", {
      organizationId: r.organizationId,
      toolId: r.toolId,
      error: error.message,
    });
  }
}
