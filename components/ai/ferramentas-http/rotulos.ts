/** Rótulos de tela do vocabulário (chaves em português; `t()` traduz). */
import type { StatusDaExecucao } from "@/lib/ferramentas-http/vocabulario";

const ROTULO: Record<StatusDaExecucao, string> = {
  sucesso: "Sucesso",
  erro_http: "Erro HTTP",
  timeout: "Tempo esgotado",
  falha_conexao: "Falha de conexão",
  bloqueado: "Bloqueado",
  parametros_invalidos: "Parâmetros inválidos",
  resposta_invalida: "Resposta inválida",
  aguardando_confirmacao: "Aguardando confirmação",
  limite_excedido: "Limite excedido",
};

export function rotuloDoStatus(s: StatusDaExecucao): string {
  return ROTULO[s];
}
