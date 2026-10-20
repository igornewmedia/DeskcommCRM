"use client";
/**
 * Histórico das chamadas: agente, ferramenta, quando, status, tempo e conversa.
 * Só metadados — o servidor não guarda valor, corpo nem credencial.
 */
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useExecucoesHttp, type FerramentaHttpRow } from "@/hooks/ai/useFerramentasHttp";
import { useT } from "@/hooks/i18n/useT";

import { rotuloDoStatus } from "./rotulos";

export function HistoricoDeExecucoesHttp(props: {
  ferramentas: readonly FerramentaHttpRow[];
  agentes?: ReadonlyMap<string, string>;
  toolId?: string;
}) {
  const t = useT();
  const { data, isLoading } = useExecucoesHttp(props.toolId);
  const nomeDa = new Map(props.ferramentas.map((f) => [f.id, f.name]));

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("Nenhuma chamada registrada ainda.")}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Quando")}</TableHead>
          <TableHead>{t("Ferramenta")}</TableHead>
          <TableHead>{t("Agente")}</TableHead>
          <TableHead>{t("Status")}</TableHead>
          <TableHead>{t("Tempo")}</TableHead>
          <TableHead>{t("Conversa")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
            <TableCell className="text-xs">{nomeDa.get(r.tool_id) ?? t("(excluída)")}</TableCell>
            <TableCell className="text-xs">
              {r.origin === "teste" ? t("Teste manual") : (r.agent_id && props.agentes?.get(r.agent_id)) || "—"}
            </TableCell>
            <TableCell className="text-xs">
              <Badge variant={r.status === "sucesso" ? "default" : "secondary"}>{t(rotuloDoStatus(r.status))}</Badge>
              {r.http_status ? <span className="ml-1 text-muted-foreground">HTTP {r.http_status}</span> : null}
            </TableCell>
            <TableCell className="text-xs">{r.duration_ms} ms</TableCell>
            <TableCell className="text-xs">
              {r.conversation_id ? (
                <Link className="underline" href={`/app/inbox?id=${r.conversation_id}`}>
                  {t("Abrir")}
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
