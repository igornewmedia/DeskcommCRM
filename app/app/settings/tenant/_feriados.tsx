"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { definirFeriados } from "@/app/actions/settings/definirFeriados";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { irAoDesafioDeMfa } from "@/lib/auth/ir-ao-desafio-de-mfa";
import type { ConfigDeFeriados } from "@/lib/tempo/feriados";

/**
 * Feriados da empresa, em Configurações › Empresa. Ligado, o agente de IA sabe
 * se hoje é feriado e qual é o próximo dia útil (bloco `## Agora`). Desligado
 * é o padrão, e o agente fica como sempre foi.
 */
export function FeriadosDaEmpresaForm({ initial }: { initial: ConfigDeFeriados }) {
  const t = useT();
  const [cfg, setCfg] = useState<ConfigDeFeriados>(initial);
  const [nova, setNova] = useState({ data: "", nome: "" });
  const [isPending, startTransition] = useTransition();

  function salvar() {
    startTransition(async () => {
      const r = await definirFeriados(cfg);
      if (r.ok) {
        toast.success(t("Feriados salvos."));
        return;
      }
      if (r.error === "mfa_required") return irAoDesafioDeMfa();
      toast.error(t("Não foi possível salvar os feriados."));
    });
  }

  function adicionar() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nova.data) || nova.nome.trim() === "") {
      toast.error(t("Informe a data e o nome do feriado."));
      return;
    }
    const proprios = [...cfg.proprios.filter((f) => f.data !== nova.data), { data: nova.data, nome: nova.nome.trim() }].sort(
      (a, b) => a.data.localeCompare(b.data),
    );
    setCfg({ ...cfg, proprios });
    setNova({ data: "", nome: "" });
  }

  return (
    <Card className="space-y-3 p-4" data-testid="feriados-da-empresa">
      <h2 className="text-sm font-medium">{t("Feriados")}</h2>
      <p className="text-xs text-muted-foreground">
        {t(
          "Com a opção ligada, o agente de IA sabe se hoje é feriado e qual é o próximo dia útil (segunda a sexta, sem feriado), para prometer prazo e entrega certos.",
        )}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cfg.ligado}
          onChange={(e) => setCfg({ ...cfg, ligado: e.target.checked })}
          data-testid="feriados-ligado"
        />
        {t("Informar feriados ao agente de IA")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cfg.nacionais}
          onChange={(e) => setCfg({ ...cfg, nacionais: e.target.checked })}
          disabled={!cfg.ligado}
          data-testid="feriados-nacionais"
        />
        {t("Incluir os feriados nacionais do Brasil (calculados automaticamente a cada ano)")}
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("Feriados próprios da empresa")}</p>
        {cfg.proprios.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("Nenhum feriado próprio cadastrado.")}</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm" data-testid="feriados-proprios">
            {cfg.proprios.map((f) => (
              <li key={f.data} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span>
                  <span className="tabular-nums">{f.data.split("-").reverse().join("/")}</span> · {f.nome}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setCfg({ ...cfg, proprios: cfg.proprios.filter((x) => x.data !== f.data) })}
                >
                  {t("Remover")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            {t("Data")}
            <input
              type="date"
              value={nova.data}
              onChange={(e) => setNova({ ...nova, data: e.target.value })}
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
              data-testid="feriado-data"
            />
          </label>
          <label className="text-xs">
            {t("Nome")}
            <input
              value={nova.nome}
              onChange={(e) => setNova({ ...nova, nome: e.target.value })}
              placeholder={t("Aniversário de Brasília")}
              maxLength={80}
              className="mt-1 block h-9 rounded-md border px-2 text-sm"
              data-testid="feriado-nome"
            />
          </label>
          <Button type="button" size="sm" variant="outline" onClick={adicionar} data-testid="adicionar-feriado">
            {t("Adicionar")}
          </Button>
        </div>
      </div>
      <Button type="button" size="sm" disabled={isPending} onClick={salvar} data-testid="salvar-feriados">
        {t("Salvar feriados")}
      </Button>
    </Card>
  );
}
