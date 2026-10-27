import { centavosParaTexto } from "@/lib/catalogo/edicao-do-produto";
import type { AtributoDeProduto, ValorDeAtributo } from "@/lib/schemas/atributos-de-produto";
import { precoParaCentavos } from "@/lib/schemas/produtos";

/**
 * Atributos personalizados no formulário do produto (migration 5002): o
 * rascunho guarda texto (o que o input mostra) e booleano; o corpo da API leva
 * o tipo certo. Puro, para o teste sem DOM.
 */

export type RascunhoDosAtributos = Record<string, string | boolean>;

export function rascunhoDosAtributos(
  defs: AtributoDeProduto[],
  valores: Record<string, unknown> | null | undefined,
): RascunhoDosAtributos {
  const v = valores ?? {};
  return Object.fromEntries(
    defs.map((d) => {
      const x = v[d.chave];
      if (d.tipo === "booleano") return [d.chave, x === true];
      if (d.tipo === "moeda") return [d.chave, typeof x === "number" ? centavosParaTexto(x) : ""];
      if (d.tipo === "numero") return [d.chave, typeof x === "number" ? String(x).replace(".", ",") : ""];
      return [d.chave, typeof x === "string" ? x : ""];
    }),
  );
}

type Tradutor = (texto: string) => string;

/**
 * O objeto `atributos` do corpo. `soMudancas` (edição): só as chaves que
 * mudaram, com `null` para a que foi apagada — o PATCH mescla. Sem ele
 * (criação): todas as preenchidas.
 */
export function corpoDosAtributos(
  defs: AtributoDeProduto[],
  rascunho: RascunhoDosAtributos,
  t: Tradutor,
  atuais?: Record<string, unknown> | null,
): { atributos: Record<string, ValorDeAtributo | null>; erro?: string } {
  const atributos: Record<string, ValorDeAtributo | null> = {};
  for (const d of defs) {
    const bruto = rascunho[d.chave];
    let valor: ValorDeAtributo | null;
    if (d.tipo === "booleano") {
      // Desmarcado é "não"; na criação não vale a pena gravar o falso.
      valor = bruto === true ? true : atuais ? false : null;
    } else {
      const texto = typeof bruto === "string" ? bruto.trim() : "";
      if (texto === "") valor = null;
      else if (d.tipo === "moeda") {
        const c = precoParaCentavos(texto);
        if (c === null) return { atributos: {}, erro: `${d.rotulo}: ${t("valor inválido. Escreva assim: 1.299,90")}` };
        valor = c;
      } else if (d.tipo === "numero") {
        const n = Number(texto.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(n)) return { atributos: {}, erro: `${d.rotulo}: ${t("número inválido.")}` };
        valor = n;
      } else valor = texto;
    }
    if (atuais) {
      const anterior = atuais[d.chave] ?? null;
      const igual = anterior === valor || (d.tipo === "booleano" && anterior === null && valor === false);
      if (!igual) atributos[d.chave] = valor;
    } else if (valor !== null) {
      atributos[d.chave] = valor;
    }
  }
  return { atributos };
}
