"use client";
import { Card } from "@/components/ui/card";
import { FerramentasHttp } from "@/components/ai/ferramentas-http/FerramentasHttp";
import { HistoricoDeExecucoesHttp } from "@/components/ai/ferramentas-http/HistoricoDeExecucoesHttp";
import { useFerramentasHttp } from "@/hooks/ai/useFerramentasHttp";
import { useT } from "@/hooks/i18n/useT";

export function BibliotecaDeFerramentasHttp(props: { agentes: ReadonlyArray<readonly [string, string]> }) {
  const t = useT();
  const { data: ferramentas = [] } = useFerramentasHttp();
  return (
    <>
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium">{t("Ferramentas")}</h2>
        <FerramentasHttp />
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium">{t("Histórico de chamadas")}</h2>
        <HistoricoDeExecucoesHttp ferramentas={ferramentas} agentes={new Map(props.agentes)} />
      </Card>
    </>
  );
}
