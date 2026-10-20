"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { centavosParaTexto } from "@/lib/catalogo/edicao-do-produto";
import { formatCents } from "@/lib/money";
import type { AparelhoDeTroca } from "@/lib/schemas/aparelhos-de-troca";
import { precoParaCentavos } from "@/lib/schemas/produtos";

interface Rascunho {
  id: string | null;
  modelo: string;
  capacidade: string;
  abatimento: string;
}

const VAZIO: Rascunho = { id: null, modelo: "", capacidade: "", abatimento: "" };

export function TrocaClient(props: { inicial: AparelhoDeTroca[]; podeEditar: boolean }) {
  const t = useT();
  const router = useRouter();
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  async function salvar() {
    if (!rascunho) return;
    const abatimento_cents = precoParaCentavos(rascunho.abatimento);
    if (abatimento_cents === null) {
      toast.error(t("Valor inválido. Escreva assim: 1.200,00"));
      return;
    }
    const corpo = { modelo: rascunho.modelo.trim(), capacidade: rascunho.capacidade.trim() || null, abatimento_cents };
    setSalvando(true);
    try {
      if (rascunho.id) await apiClient.patch(`/api/v1/trade-in-devices/${rascunho.id}`, corpo);
      else await apiClient.post("/api/v1/trade-in-devices", corpo);
      toast.success(t("Aparelho salvo."));
      setRascunho(null);
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(a: AparelhoDeTroca) {
    try {
      await apiClient.patch(`/api/v1/trade-in-devices/${a.id}`, { ativo: !a.ativo });
      router.refresh();
    } catch (err) {
      showApiError(err);
    }
  }

  async function remover(a: AparelhoDeTroca) {
    if (!window.confirm(t("Remover este aparelho da lista de troca?"))) return;
    try {
      await apiClient.delete(`/api/v1/trade-in-devices/${a.id}`);
      router.refresh();
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <a href="/app/products" className="text-sm underline">
          {t("Produtos")}
        </a>
        <h1 className="text-2xl font-semibold">{t("Aparelhos aceitos na troca")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Os aparelhos usados que a loja aceita como parte do pagamento e quanto cada um abate. O atendente de IA consulta esta lista para montar o orçamento com troca.",
          )}
        </p>
      </header>

      {props.podeEditar && !rascunho ? (
        <Button className="mb-4" onClick={() => setRascunho(VAZIO)} data-testid="novo-aparelho">
          {t("Novo aparelho")}
        </Button>
      ) : null}

      {rascunho ? (
        <div className="mb-6 rounded-lg border p-4" data-testid="form-aparelho">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              {t("Modelo")}
              <input
                value={rascunho.modelo}
                onChange={(e) => setRascunho({ ...rascunho, modelo: e.target.value })}
                placeholder="iPhone 13"
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="aparelho-modelo"
              />
            </label>
            <label className="text-sm">
              {t("Capacidade")}
              <input
                value={rascunho.capacidade}
                onChange={(e) => setRascunho({ ...rascunho, capacidade: e.target.value })}
                placeholder="128GB"
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="aparelho-capacidade"
              />
            </label>
            <label className="text-sm">
              {t("Valor de abatimento")}
              <input
                value={rascunho.abatimento}
                onChange={(e) => setRascunho({ ...rascunho, abatimento: e.target.value })}
                placeholder="1.200,00"
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="aparelho-abatimento"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={salvar} disabled={salvando} data-testid="salvar-aparelho">
              {salvando ? t("Salvando…") : t("Salvar")}
            </Button>
            <Button variant="outline" onClick={() => setRascunho(null)}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : null}

      {props.inicial.length === 0 ? (
        <div className="rounded-lg border p-6 text-center">
          <p className="font-medium">{t("Nenhum aparelho cadastrado ainda")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Enquanto a lista estiver vazia, o atendente responde que a loja não aceita aparelho na troca.")}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="lista-aparelhos">
          {props.inicial.map((a) => (
            <li key={a.id} className="flex items-center gap-4 p-3" data-testid="aparelho">
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${a.ativo ? "" : "text-muted-foreground line-through"}`}>
                  {a.modelo}
                  {a.capacidade ? ` · ${a.capacidade}` : ""}
                </p>
              </div>
              <span className="shrink-0 tabular-nums font-medium">{formatCents(a.abatimento_cents, a.moeda)}</span>
              {props.podeEditar ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRascunho({
                        id: a.id,
                        modelo: a.modelo,
                        capacidade: a.capacidade ?? "",
                        abatimento: centavosParaTexto(a.abatimento_cents),
                      })
                    }
                  >
                    {t("Editar")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void alternar(a)}>
                    {a.ativo ? t("Desativar") : t("Ativar")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remover(a)}>
                    {t("Remover")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
