"use client";
/**
 * Dados das ferramentas HTTP para a tela: a lista da organização, o histórico e
 * o formato do resultado do botão Testar. A credencial nunca chega aqui — a
 * linha traz só `secret_last4`.
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { LinhaPublica } from "@/lib/ferramentas-http/repositorio";
import type { OrigemDaExecucao, StatusDaExecucao } from "@/lib/ferramentas-http/vocabulario";

export type FerramentaHttpRow = LinhaPublica;

export interface ExecucaoHttpRow {
  id: string;
  tool_id: string;
  agent_id: string | null;
  conversation_id: string | null;
  origin: OrigemDaExecucao;
  status: StatusDaExecucao;
  http_status: number | null;
  duration_ms: number;
  attempts: number;
  param_names: string[];
  response_bytes: number | null;
  error_code: string | null;
  created_at: string;
}

export interface ResultadoDoTeste {
  status: StatusDaExecucao;
  ok: boolean;
  http_status: number | null;
  duration_ms: number;
  attempts: number;
  request: { method: string; url: string; headers: Record<string, string>; body?: string } | null;
  response_bytes: number | null;
  truncated: boolean;
  empty: boolean;
  data: unknown;
  error: string | null;
  validation: string[];
  para_o_modelo: Record<string, unknown>;
}

export const ferramentasHttpQueryKey = ["ai", "http-tools", "list"] as const;
export const execucoesHttpQueryKey = (toolId?: string) => ["ai", "http-tools", "runs", toolId ?? "todas"] as const;

export function useFerramentasHttp() {
  return useQuery({
    queryKey: ferramentasHttpQueryKey,
    queryFn: async () => (await apiClient.get<{ data: FerramentaHttpRow[] }>("/api/v1/ai/http-tools")).data,
  });
}

export function useExecucoesHttp(toolId?: string) {
  return useQuery({
    queryKey: execucoesHttpQueryKey(toolId),
    queryFn: async () => {
      const qs = toolId ? `?tool_id=${encodeURIComponent(toolId)}` : "";
      return (await apiClient.get<{ data: ExecucaoHttpRow[] }>(`/api/v1/ai/http-tools/runs${qs}`)).data;
    },
  });
}
