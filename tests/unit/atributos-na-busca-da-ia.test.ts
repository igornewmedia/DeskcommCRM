import { describe, expect, it } from "vitest";

import { crmSearchProducts } from "@/lib/mcp/tools/comercio";
import type { McpContext } from "@/lib/mcp/types";

/**
 * ATRIBUTOS PERSONALIZADOS NA BUSCA DA IA (migration 5002) — o que a
 * `crm_search_products` devolve ao agente: os visíveis formatados, os ocultos
 * fora, o significado numa legenda só, o filtro exato e a cor na pontuação.
 */

const ORG = "22222222-2222-4222-8222-222222222222";

const DEFS = [
  {
    id: "a1",
    chave: "pronta_entrega",
    rotulo: "Pronta entrega",
    tipo: "booleano",
    descricao_ia: "sim = em estoque em Brasília, pagamento na entrega",
    visivel_ia: true,
    pesquisavel: false,
    ordem: 0,
    opcoes: [],
  },
  {
    id: "a2",
    chave: "preco_cartao_cents",
    rotulo: "Preço no cartão",
    tipo: "moeda",
    descricao_ia: null,
    visivel_ia: true,
    pesquisavel: false,
    ordem: 1,
    opcoes: [],
  },
  {
    id: "a3",
    chave: "margem_interna",
    rotulo: "Margem interna",
    tipo: "numero",
    descricao_ia: null,
    visivel_ia: false,
    pesquisavel: false,
    ordem: 2,
    opcoes: [],
  },
];

const base = {
  descricao: null,
  marca: "Apple",
  categoria: null,
  capacidade: "256GB",
  moeda: "BRL",
  controla_estoque: false,
  quantidade: 0,
  ativo: true,
  fotos: [],
};

const PRODUTOS = [
  {
    ...base,
    id: "p1",
    codigo: "IP17PM-LAR",
    nome: "iPhone 17 Pro Max",
    cor: "Laranja",
    preco_cents: 999900,
    atributos: { pronta_entrega: true, preco_cartao_cents: 1049900, margem_interna: 12 },
  },
  {
    ...base,
    id: "p2",
    codigo: "IP17PM-AZU",
    nome: "iPhone 17 Pro Max",
    cor: "Azul",
    preco_cents: 979900,
    atributos: { pronta_entrega: false },
  },
];

/** Supabase falso por tabela; o filtro por organização é registrado para conferir. */
function ctx(defs: unknown[] = DEFS, orgsVistas: string[] = []): McpContext {
  const tabela = (dados: unknown[]) => {
    const q = {
      select: () => q,
      eq: (col: string, v: string) => {
        if (col === "organization_id") orgsVistas.push(v);
        return q;
      },
      order: () => q,
      range: async () => ({ data: dados, error: null, count: dados.length }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: (r: unknown) => unknown) => ok({ data: dados, error: null }),
    };
    return q;
  };
  return {
    organizationId: ORG,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", agent_id: "agent-1" },
    apiTokenId: "33333333-3333-4333-8333-333333333333",
    requestId: "44444444-4444-4444-8444-444444444444",
    supabase: {
      from: (t: string) =>
        t === "catalog_product_attributes" ? tabela(defs) : t === "catalog_products" ? tabela(PRODUTOS) : tabela([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  } as McpContext;
}

type Resposta = {
  produtos: Array<{ codigo: string; cor?: string; atributos?: Record<string, string> }>;
  legenda_dos_atributos?: Record<string, string>;
  mensagem?: string;
};

const buscar = (termo: string, extra: Record<string, unknown> = {}, c = ctx()) =>
  crmSearchProducts.handler(
    { termo, limite: 8, somente_disponiveis: true, ...extra } as never,
    c,
  ) as Promise<Resposta>;

describe("crm_search_products — atributos personalizados", () => {
  it("traz os visíveis formatados e esconde os ocultos", async () => {
    const r = await buscar("iphone 17 pro max laranja");
    const laranja = r.produtos.find((p) => p.codigo === "IP17PM-LAR")!;
    expect(laranja.atributos?.["Pronta entrega"]).toBe("sim");
    expect(laranja.atributos?.["Preço no cartão"]?.replace(/[  ]/g, " ")).toBe("R$ 10.499,00");
    expect(laranja.atributos).not.toHaveProperty("Margem interna");
    // O significado vem uma vez, na legenda, e diz a chave para filtrar.
    expect(r.legenda_dos_atributos?.["Pronta entrega"]).toContain("(filtro: pronta_entrega)");
  });

  it("a cor entra na busca: 'laranja' põe o laranja na frente", async () => {
    const r = await buscar("iphone 17 pro max laranja");
    expect(r.produtos[0]!.codigo).toBe("IP17PM-LAR");
  });

  it("filtro por booleano devolve só a pronta entrega", async () => {
    const r = await buscar("iphone 17", { filtros: { pronta_entrega: true } });
    expect(r.produtos.map((p) => p.codigo)).toEqual(["IP17PM-LAR"]);
  });

  it("filtro por chave inexistente é ignorado e dito ao modelo", async () => {
    const r = await buscar("iphone 17", { filtros: { cor_do_vizinho: "x" } });
    expect(r.produtos).toHaveLength(2);
    expect(r.mensagem).toContain("cor_do_vizinho");
  });

  it("sem atributos definidos, a resposta é a de sempre", async () => {
    const r = await buscar("iphone 17", {}, ctx([]));
    expect(r.produtos.every((p) => p.atributos === undefined)).toBe(true);
    expect(r.legenda_dos_atributos).toBeUndefined();
  });

  it("as definições são lidas só da organização do contexto", async () => {
    const vistas: string[] = [];
    await buscar("iphone 17", {}, ctx(DEFS, vistas));
    expect(vistas.length).toBeGreaterThan(0);
    expect(new Set(vistas)).toEqual(new Set([ORG]));
  });
});
