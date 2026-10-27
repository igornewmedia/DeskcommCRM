"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface Membro {
  user_id: string;
  role: string;
  full_name: string | null;
  email?: string | null;
}

/**
 * "Quem recebe as passagens" (migration 5003): a pessoa da equipe para quem
 * vão as passagens e os casos deste agente. Vazio = a fila, como sempre. A
 * lista é a mesma de quem pode receber conversa (`/api/v1/team/assignable`).
 */
export function QuemRecebeAsPassagens(props: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [membros, setMembros] = React.useState<Membro[] | null>(null);

  React.useEffect(() => {
    let vivo = true;
    apiClient
      .get<{ data: Membro[] }>("/api/v1/team/assignable")
      .then((r) => vivo && setMembros(r.data ?? []))
      .catch(() => vivo && setMembros([]));
    return () => {
      vivo = false;
    };
  }, []);

  const nome = (m: Membro) => m.full_name || m.email || m.user_id.slice(0, 8);
  // A pessoa escolhida pode ter saído da equipe: segue na lista, marcada, até alguém trocar.
  const ausente = props.value && membros && !membros.some((m) => m.user_id === props.value);

  return (
    <div className="space-y-1">
      <Label htmlFor="handoff_target_user_id">{t("Quem recebe as passagens")}</Label>
      <select
        id="handoff_target_user_id"
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value === "" ? null : e.target.value)}
        disabled={props.disabled || membros === null}
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
      >
        <option value="">{t("Ninguém em especial (fica na fila da equipe)")}</option>
        {ausente ? <option value={props.value!}>{t("Pessoa que saiu da equipe")}</option> : null}
        {(membros ?? []).map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {nome(m)}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {t(
          "Quando o agente passar a conversa ou abrir um caso, a conversa é atribuída a essa pessoa e ela recebe o aviso na Central e no celular, com o motivo e o resumo.",
        )}
      </p>
    </div>
  );
}
