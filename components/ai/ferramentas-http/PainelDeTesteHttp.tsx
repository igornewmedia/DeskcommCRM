"use client";
/**
 * "Testar ferramenta": valores de exemplo → chamada DE VERDADE pelo servidor.
 *
 * Mostra o que o pedido pede: status HTTP, tempo, o que foi enviado (credencial
 * mascarada pelo servidor), o corpo que voltou, erros, a validação dos
 * parâmetros e o que o agente receberia. Uma ferramenta de AÇÃO executa a ação
 * de verdade — o aviso fica em cima do botão.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { execucoesHttpQueryKey, type FerramentaHttpRow, type ResultadoDoTeste } from "@/hooks/ai/useFerramentasHttp";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { Parametro } from "@/lib/ferramentas-http/schema";

import { rotuloDoStatus } from "./rotulos";

function converter(p: Parametro, texto: string): unknown {
  if (texto === "") return undefined;
  if (p.type === "number" || p.type === "integer") return Number(texto.replace(",", "."));
  if (p.type === "boolean") return texto === "true";
  return texto;
}

function Bloco(props: { titulo: string; conteudo: unknown }) {
  const texto = typeof props.conteudo === "string" ? props.conteudo : JSON.stringify(props.conteudo, null, 2);
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium">{props.titulo}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{texto}</pre>
    </div>
  );
}

export function PainelDeTesteHttp(props: {
  ferramenta: FerramentaHttpRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const f = props.ferramenta;
  const [valores, setValores] = React.useState<Record<string, string>>({});
  const [rodando, setRodando] = React.useState(false);
  const [resultado, setResultado] = React.useState<ResultadoDoTeste | null>(null);

  async function testar() {
    if (!f) return;
    const args = Object.fromEntries(
      f.parameters
        .map((p) => [p.name, converter(p, valores[p.name] ?? "")] as const)
        .filter(([, v]) => v !== undefined),
    );
    setRodando(true);
    try {
      const res = await apiClient.post<{ data: ResultadoDoTeste }>(`/api/v1/ai/http-tools/${f.id}/test`, { args });
      setResultado(res.data);
      await qc.invalidateQueries({ queryKey: execucoesHttpQueryKey(f.id) });
      await qc.invalidateQueries({ queryKey: execucoesHttpQueryKey() });
    } catch (err) {
      showApiError(err);
    } finally {
      setRodando(false);
    }
  }

  return (
    <Dialog open={f !== null} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("Testar ferramenta")}: {f?.name}
          </DialogTitle>
          <DialogDescription>{t("Informe valores de exemplo. A chamada é feita de verdade, pelo servidor.")}</DialogDescription>
        </DialogHeader>

        {/* `min-w-0`: item de grade não encolhe abaixo do conteúdo, e o JSON
            longo do resultado empurrava o painel para fora da janela. */}
        <div className="min-w-0 space-y-3">
          {f?.parameters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Esta ferramenta não tem parâmetros.")}</p>
          ) : null}
          {f?.parameters.map((p) => (
            <div key={p.name} className="space-y-1">
              <Label htmlFor={`teste-${p.name}`}>
                {p.name}
                {p.required ? " *" : ""}
              </Label>
              <Input
                id={`teste-${p.name}`}
                value={valores[p.name] ?? ""}
                placeholder={p.type === "enum" ? (p.values ?? []).join(" | ") : p.description}
                onChange={(e) => setValores((v) => ({ ...v, [p.name]: e.target.value }))}
              />
            </div>
          ))}
          {f?.effect === "acao" ? (
            <p className="text-xs text-destructive">{t("Atenção: esta ferramenta executa uma ação de verdade no sistema de destino.")}</p>
          ) : null}
          <Button type="button" onClick={testar} disabled={rodando}>
            {rodando ? t("Testando…") : t("Testar")}
          </Button>
        </div>

        {resultado ? (
          <div className="min-w-0 space-y-3 border-t pt-3" data-testid="resultado-do-teste">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={resultado.ok ? "default" : "destructive"}>{t(rotuloDoStatus(resultado.status))}</Badge>
              {resultado.http_status ? <span>HTTP {resultado.http_status}</span> : null}
              <span>{resultado.duration_ms} ms</span>
              {resultado.attempts > 1 ? (
                <span>
                  {resultado.attempts} {t("tentativas")}
                </span>
              ) : null}
              {resultado.truncated ? <span>{t("resposta cortada no limite")}</span> : null}
              {resultado.empty ? <span>{t("resposta vazia")}</span> : null}
            </div>
            {resultado.error ? <Bloco titulo={t("Erro")} conteudo={resultado.error} /> : null}
            {resultado.validation.length > 0 ? <Bloco titulo={t("Validação")} conteudo={resultado.validation} /> : null}
            {resultado.request ? <Bloco titulo={t("Enviado")} conteudo={resultado.request} /> : null}
            {resultado.data !== null ? <Bloco titulo={t("Recebido")} conteudo={resultado.data} /> : null}
            <Bloco titulo={t("O que o agente recebe")} conteudo={resultado.para_o_modelo} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
