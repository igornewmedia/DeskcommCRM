import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ENDPOINTS_EXTERNOS } from "@/lib/api/endpoints-externos";
import { loadAuthUser } from "@/lib/auth/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Endpoints" };
export const dynamic = "force-dynamic";

/**
 * OS ENDPOINTS PARA SISTEMAS EXTERNOS — o que um ERP, uma loja ou uma automação
 * pode chamar com um token `dsk_`. Só lê `lib/api/endpoints-externos.ts`, cuja
 * conferência contra as rotas é teste. `notFound()` para quem não é super admin,
 * como as vizinhas de /admin.
 */
export default async function EndpointsPage() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  const idioma = normalizarIdioma(usuario.idioma);
  const t = (texto: string) => traduzir(texto, idioma);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Endpoints para sistemas externos")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Outros sistemas chamam estes endereços com um token de API. O token é criado dentro da empresa, em Configurações › Tokens de API, e vale só para ela: a empresa vem do token, nunca do corpo.",
          )}{" "}
          <a className="underline" href="/app/settings/api-tokens">
            {t("Criar token")}
          </a>
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
          {`Authorization: Bearer dsk_...\nContent-Type: application/json`}
        </pre>
      </header>

      <ul className="space-y-4">
        {ENDPOINTS_EXTERNOS.map((e) => (
          <li key={`${e.metodo} ${e.caminho}`} className="space-y-2 rounded-lg border p-4" data-testid="endpoint">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold">{e.metodo}</span>
              <code className="break-all text-sm">{e.caminho}</code>
              <span className="text-xs text-muted-foreground">
                {t("escopo")} {e.escopo} · {t("papel mínimo")} {e.papel}
              </span>
            </div>
            <p className="text-sm">{t(e.descricao)}</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {[
                `curl -X ${e.metodo} ${base}${e.caminho} \\`,
                `  -H "Authorization: Bearer dsk_SEU_TOKEN"` + (e.exemplo ? " \\" : ""),
                ...(e.exemplo
                  ? [`  -H "Content-Type: application/json" \\`, `  -d '${JSON.stringify(e.exemplo, null, 2)}'`]
                  : []),
              ].join("\n")}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
