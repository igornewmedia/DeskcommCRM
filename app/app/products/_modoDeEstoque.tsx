"use client";

/**
 * "Como a IA trata o estoque" — a escolha POR EMPRESA, no topo do catálogo.
 * Salva no clique, como os interruptores de Configurações. O que cada modo faz
 * está em `lib/catalogo/modo-de-estoque.ts`. Quem não é manager+ vê a escolha
 * em vigor, sem poder trocar; a action cobra o papel de novo.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { definirModoDeEstoque } from "@/app/actions/settings/definirModoDeEstoque";
import { useT } from "@/hooks/i18n/useT";
import type { ModoDeEstoque } from "@/lib/catalogo/modo-de-estoque";

const ERRO: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um gerente ou administrador da organização pode mudar esta configuração.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
};

const OPCOES: Array<{ valor: ModoDeEstoque; titulo: string; texto: string }> = [
  {
    valor: "somente_com_estoque",
    titulo: "Vender somente com estoque",
    texto:
      "A IA só oferece o produto ativo com quantidade maior que zero. Produto marcado sem controle de estoque (sob encomenda) continua sempre disponível.",
  },
  {
    valor: "sem_controle",
    titulo: "Vender sem controle de estoque",
    texto:
      "Todo produto ativo do catálogo está disponível, e a quantidade é ignorada. Para quem revende de fornecedor e não informa estoque.",
  },
];

export function ModoDeEstoqueDaEmpresa({ modo, podeMudar }: { modo: ModoDeEstoque; podeMudar: boolean }) {
  const t = useT();
  const router = useRouter();
  const [valor, setValor] = React.useState(modo);
  const [salvando, iniciar] = React.useTransition();

  function mudar(novo: ModoDeEstoque) {
    const anterior = valor;
    setValor(novo);
    iniciar(async () => {
      const r = await definirModoDeEstoque(novo);
      if (r.ok) {
        toast.success(t("Configuração salva."));
        router.refresh();
        return;
      }
      setValor(anterior);
      toast.error(t(ERRO[r.error] ?? "Não consegui salvar agora."));
    });
  }

  return (
    <fieldset className="mb-6 rounded-lg border p-4" data-testid="modo-de-estoque" disabled={!podeMudar || salvando}>
      <legend className="px-1 text-sm font-medium">{t("Como a IA trata o estoque")}</legend>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        {OPCOES.map((o) => (
          <label key={o.valor} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="modo_estoque"
              value={o.valor}
              checked={valor === o.valor}
              onChange={() => mudar(o.valor)}
              className="mt-1"
              data-testid={`modo-estoque-${o.valor}`}
            />
            <span>
              <span className="font-medium">{t(o.titulo)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(o.texto)}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("Nos dois modos a IA nunca diz ao cliente quantas unidades há em estoque.")}
        {podeMudar ? "" : ` ${t("Só um gerente ou administrador pode mudar.")}`}
      </p>
    </fieldset>
  );
}
