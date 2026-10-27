"use client";

import * as React from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

/**
 * "Reiniciar memória da IA" (migration 5004): para testar um agente do zero com
 * o mesmo contato. Fecha o atendimento, apaga checkpoint, resumo e notas do
 * lead e volta o funil do agente para o início; as mensagens ficam na conversa.
 * Só gerente+ (a rota cobra de novo).
 */
export function ReiniciarMemoriaDaIa({ conversationId }: { conversationId: string }) {
  const t = useT();
  // O contexto, e não `useQueryClient`: o cabeçalho também é desenhado sem
  // provedor (testes, telas fora do Inbox), e o botão não pode derrubá-lo.
  const qc = React.useContext(QueryClientContext);
  const [ocupado, setOcupado] = React.useState(false);

  async function reiniciar() {
    const ok = window.confirm(
      t(
        "Reiniciar a memória da IA deste contato? O atendimento atual é fechado e a IA esquece o resumo, as notas e a etapa do funil dele. As mensagens continuam na conversa, mas não entram mais no contexto da IA.",
      ),
    );
    if (!ok) return;
    setOcupado(true);
    try {
      await apiClient.post(`/api/v1/conversations/${conversationId}/reiniciar-memoria`, {});
      toast.success(t("Memória da IA reiniciada. A próxima mensagem do cliente começa do zero."));
      await qc?.invalidateQueries();
    } catch (e) {
      showApiError(e);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={ocupado}
      onClick={() => void reiniciar()}
      title={t("Para testar o agente do zero: a IA esquece o que sabia deste contato. As mensagens ficam.")}
      data-testid="reiniciar-memoria-da-ia"
    >
      {t("Reiniciar memória da IA")}
    </Button>
  );
}
