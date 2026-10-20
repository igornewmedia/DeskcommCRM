import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

import { BibliotecaDeFerramentasHttp } from "./_components/BibliotecaDeFerramentasHttp";

export const dynamic = "force-dynamic";

/**
 * A biblioteca de ferramentas HTTP da organização (migration 9002): as mesmas
 * que o editor de cada agente liga, mais o histórico de todas as chamadas.
 * Mesmo papel do editor de agente (manager+).
 */
export default async function FerramentasPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const idioma = user.idioma;

  // Só o nome, para o histórico dizer QUEM chamou.
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_agents")
    .select("id, name")
    .eq("organization_id", activeOrg.orgId);
  const agentes = ((data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name] as const);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Ferramentas dos agentes", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Endereços de outros sistemas que os agentes consultam ou acionam durante a conversa — agenda, estoque, pedidos. Crie aqui e ligue em cada agente, na seção Ferramentas.",
            idioma,
          )}
        </p>
      </header>
      <BibliotecaDeFerramentasHttp agentes={agentes} />
    </div>
  );
}
