"use client";

import { useT } from "@/hooks/i18n/useT";
import type { RascunhoDosAtributos } from "@/lib/catalogo/atributos-no-formulario";
import type { AtributoDeProduto } from "@/lib/schemas/atributos-de-produto";

/**
 * Os campos dos atributos personalizados da organização no formulário do
 * produto (criação e edição), um controle por tipo. Sem atributo definido, não
 * renderiza nada — o formulário fica como sempre foi.
 */
export function CamposDosAtributos(props: {
  defs: AtributoDeProduto[];
  valor: RascunhoDosAtributos;
  onChange: (v: RascunhoDosAtributos) => void;
  desabilitado?: boolean;
  prefixo: string;
}) {
  const t = useT();
  if (props.defs.length === 0) return null;
  const mudar = (chave: string, v: string | boolean) => props.onChange({ ...props.valor, [chave]: v });

  return (
    <fieldset className="mt-3 grid gap-3 sm:grid-cols-2" data-testid={`${props.prefixo}-atributos`}>
      <legend className="mb-1 text-sm font-medium">{t("Atributos")}</legend>
      {props.defs.map((d) => {
        const id = `${props.prefixo}-atributo-${d.chave}`;
        const v = props.valor[d.chave];
        if (d.tipo === "booleano") {
          return (
            <label key={d.chave} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v === true}
                onChange={(e) => mudar(d.chave, e.target.checked)}
                disabled={props.desabilitado}
                data-testid={id}
              />
              {d.rotulo}
            </label>
          );
        }
        if (d.tipo === "lista") {
          return (
            <label key={d.chave} className="text-sm">
              {d.rotulo}
              <select
                value={typeof v === "string" ? v : ""}
                onChange={(e) => mudar(d.chave, e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-3"
                disabled={props.desabilitado}
                data-testid={id}
              >
                <option value="">{t("(não informado)")}</option>
                {d.opcoes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={d.chave} className="text-sm">
            {d.rotulo}
            <input
              value={typeof v === "string" ? v : ""}
              onChange={(e) => mudar(d.chave, e.target.value)}
              inputMode={d.tipo === "texto" ? undefined : "decimal"}
              placeholder={d.tipo === "moeda" ? "1.299,90" : undefined}
              className="mt-1 h-9 w-full rounded-md border px-3"
              disabled={props.desabilitado}
              data-testid={id}
            />
          </label>
        );
      })}
    </fieldset>
  );
}
