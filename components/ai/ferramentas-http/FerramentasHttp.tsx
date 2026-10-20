"use client";
/**
 * A lista de ferramentas HTTP da organização, com tudo o que se faz com uma:
 * criar, editar, excluir, ativar/desativar e testar.
 *
 * Dois lugares usam o mesmo componente:
 *  - a biblioteca (`/app/ai/ferramentas`), sem vínculo;
 *  - o editor do agente, com `vinculo`: cada linha ganha a chave "Usar neste
 *    agente", que liga/desliga `http:<id>` no `tool_ids` da versão. Uma
 *    ferramenta serve a vários agentes — o cadastro é da organização.
 *
 * Ativar/desativar vale para TODOS os agentes que a usam (é do cadastro);
 * vincular vale só para este agente (é da versão, e só sai ao publicar).
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ferramentasHttpQueryKey, useFerramentasHttp, type FerramentaHttpRow } from "@/hooks/ai/useFerramentasHttp";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { toolIdHttp } from "@/lib/ferramentas-http/ids";
import type { TipoDeFerramenta } from "@/lib/ferramentas-http/vocabulario";

import { EditorDeFerramentaHttp } from "./EditorDeFerramentaHttp";
import { PainelDeTesteHttp } from "./PainelDeTesteHttp";

export interface VinculoComOAgente {
  /** Os `http:<uuid>` que a versão em edição já tem. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function FerramentasHttp(props: { vinculo?: VinculoComOAgente }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: ferramentas = [], isLoading, isSuccess } = useFerramentasHttp();
  const [editando, setEditando] = React.useState<FerramentaHttpRow | null>(null);
  const [editorAberto, setEditorAberto] = React.useState(false);
  const [tipoNovo, setTipoNovo] = React.useState<TipoDeFerramenta>("http");
  // Muda a cada abertura: o editor remonta com o estado da ferramenta da vez.
  const [abertura, setAbertura] = React.useState(0);
  const [testando, setTestando] = React.useState<FerramentaHttpRow | null>(null);
  const [excluindo, setExcluindo] = React.useState<FerramentaHttpRow | null>(null);

  const vinculadas = new Set(props.vinculo?.value ?? []);

  function abrirEditor(f: FerramentaHttpRow | null, tipo: TipoDeFerramenta = "http") {
    setEditando(f);
    setTipoNovo(tipo);
    setAbertura((n) => n + 1);
    setEditorAberto(true);
  }

  function vincular(f: FerramentaHttpRow, ligar: boolean) {
    if (!props.vinculo) return;
    const id = toolIdHttp(f.id);
    const atual = props.vinculo.value.filter((x) => x !== id);
    props.vinculo.onChange(ligar ? [...atual, id] : atual);
  }

  async function alternarAtiva(f: FerramentaHttpRow, ativa: boolean) {
    try {
      await apiClient.patch(`/api/v1/ai/http-tools/${f.id}`, { is_active: ativa });
      await qc.invalidateQueries({ queryKey: ferramentasHttpQueryKey });
    } catch (err) {
      showApiError(err);
    }
  }

  async function excluir(f: FerramentaHttpRow) {
    try {
      await apiClient.delete(`/api/v1/ai/http-tools/${f.id}`);
      await qc.invalidateQueries({ queryKey: ferramentasHttpQueryKey });
      if (props.vinculo) vincular(f, false);
      toast.success(t("Ferramenta excluída."));
    } catch (err) {
      showApiError(err);
    } finally {
      setExcluindo(null);
    }
  }

  // Vínculo para ferramenta excluída fica de fora da conta, mas some do agente
  // só quando alguém mexe aqui — mostrar o resto é o que deixa a pessoa decidir.
  // Só com a lista CARREGADA: antes dela, toda ferramenta ligada pareceria
  // excluída, e "Tirar do agente" apagaria as que existem.
  const orfas = props.vinculo && isSuccess
    ? props.vinculo.value.filter((id) => !ferramentas.some((f) => toolIdHttp(f.id) === id))
    : [];

  return (
    <div className="space-y-3">
      {isLoading ? <p className="text-sm text-muted-foreground">{t("Carregando…")}</p> : null}
      {!isLoading && ferramentas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Nenhuma ferramenta ainda. Crie uma para o agente consultar ou executar algo em outro sistema.")}
        </p>
      ) : null}

      <ul className="space-y-2">
        {ferramentas.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3" data-testid="ferramenta-http">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{f.name}</span>
                <code className="text-xs text-muted-foreground">{f.slug}</code>
                <Badge variant="secondary">{f.kind === "codigo" ? t("Código JS") : f.method}</Badge>
                {f.effect === "acao" ? <Badge variant="outline">{t("Ação")}</Badge> : null}
                {!f.is_active ? <Badge variant="outline">{t("Inativa")}</Badge> : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{f.description}</p>
            </div>
            {props.vinculo ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={`vinculo-${f.id}`}
                  checked={vinculadas.has(toolIdHttp(f.id))}
                  onCheckedChange={(v) => vincular(f, v)}
                  disabled={props.vinculo.disabled}
                />
                <label htmlFor={`vinculo-${f.id}`} className="text-xs">
                  {t("Usar neste agente")}
                </label>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Switch
                id={`ativa-${f.id}`}
                checked={f.is_active}
                onCheckedChange={(v) => void alternarAtiva(f, v)}
                aria-label={t("Ativa")}
              />
              <label htmlFor={`ativa-${f.id}`} className="text-xs">
                {t("Ativa")}
              </label>
            </div>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setTestando(f)}>
                {t("Testar")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => abrirEditor(f)}>
                {t("Editar")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setExcluindo(f)}>
                {t("Excluir")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {orfas.length > 0 && props.vinculo ? (
        <p className="text-xs text-muted-foreground">
          {orfas.length} {t("ferramenta(s) ligada(s) a este agente foram excluídas e não serão usadas.")}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => props.vinculo!.onChange(props.vinculo!.value.filter((id) => !orfas.includes(id)))}
          >
            {t("Tirar do agente")}
          </button>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => abrirEditor(null)}>
          {t("Nova ferramenta")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => abrirEditor(null, "codigo")}>
          {t("Nova ferramenta de código")}
        </Button>
      </div>

      <EditorDeFerramentaHttp
        key={abertura}
        open={editorAberto}
        onOpenChange={setEditorAberto}
        ferramenta={editando}
        tipo={tipoNovo}
        onSalva={(f) => {
          // Criada a partir do editor do agente, já nasce usada por ele.
          if (!editando && props.vinculo && !props.vinculo.disabled) vincular(f, true);
        }}
      />
      <PainelDeTesteHttp key={testando?.id ?? "fechado"} ferramenta={testando} onOpenChange={(open) => !open && setTestando(null)} />

      <AlertDialog open={excluindo !== null} onOpenChange={(open) => !open && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Excluir ferramenta?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Nenhum agente vai usá-la mais. O histórico das chamadas continua guardado.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => excluindo && void excluir(excluindo)}>{t("Excluir")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
