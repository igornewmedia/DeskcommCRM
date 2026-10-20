/**
 * Os endpoints que um sistema EXTERNO pode chamar com `Authorization: Bearer dsk_…`
 * — a lista que a tela /admin/endpoints mostra ao super admin.
 *
 * Curada à mão (não é todo `resolveAuthDual`): é o que faz sentido integrar.
 * `tests/unit/endpoints-externos.test.ts` confere cada linha contra o código —
 * o caminho tem de passar pelo `proxy.ts` (`PUBLIC_PATHS`) e o arquivo da rota
 * tem de exportar o método — para a tela não anunciar porta que não abre.
 */
export type MetodoHttp = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface EndpointExterno {
  metodo: MetodoHttp;
  /** Caminho com `:id` no lugar do segmento dinâmico. */
  caminho: string;
  /** Arquivo da rota, para o teste conferir. */
  arquivo: string;
  escopo: "mcp:read" | "mcp:write";
  /** Papel mínimo do token. */
  papel: "viewer" | "agent" | "manager";
  descricao: string;
  /** Corpo de exemplo (JSON), quando o método leva corpo. */
  exemplo?: Record<string, unknown>;
}

export const ENDPOINTS_EXTERNOS: readonly EndpointExterno[] = [
  {
    metodo: "POST",
    caminho: "/api/v1/products",
    arquivo: "app/api/v1/products/route.ts",
    escopo: "mcp:write",
    papel: "manager",
    descricao:
      "Cadastra um produto no catálogo. Valores em centavos. Sem `codigo`, o sistema gera o próximo PRD-00001. Custo, quantidade e cor são opcionais.",
    exemplo: {
      nome: "iPhone 15 Pro 256GB",
      marca: "Apple",
      descricao: "Lacrado, 1 ano de garantia",
      categoria: "Smartphones",
      preco_cents: 749900,
      custo_cents: 620000,
      quantidade: 3,
      cor: "Titânio natural",
    },
  },
  {
    metodo: "GET",
    caminho: "/api/v1/products",
    arquivo: "app/api/v1/products/route.ts",
    escopo: "mcp:read",
    papel: "viewer",
    descricao: "Lista o catálogo. `?busca=` filtra por nome, código ou marca; `?pagina=N` pagina de 50 em 50.",
  },
  {
    metodo: "GET",
    caminho: "/api/v1/contacts",
    arquivo: "app/api/v1/contacts/route.ts",
    escopo: "mcp:read",
    papel: "viewer",
    descricao: "Lista os contatos da organização do token.",
  },
  {
    metodo: "POST",
    caminho: "/api/v1/messages",
    arquivo: "app/api/v1/messages/route.ts",
    escopo: "mcp:write",
    papel: "agent",
    descricao: "Envia uma mensagem numa conversa pelo canal conectado.",
  },
  {
    metodo: "PATCH",
    caminho: "/api/v1/leads/:id",
    arquivo: "app/api/v1/leads/[id]/route.ts",
    escopo: "mcp:write",
    papel: "agent",
    descricao: "Atualiza um lead do funil (etapa, valor, responsável, campos).",
  },
  {
    metodo: "POST",
    caminho: "/api/v1/agenda/agendamentos",
    arquivo: "app/api/v1/agenda/agendamentos/route.ts",
    escopo: "mcp:write",
    papel: "agent",
    descricao: "Cria um agendamento na agenda da organização.",
  },
  {
    metodo: "POST",
    caminho: "/api/v1/conversations/open-with-contact",
    arquivo: "app/api/v1/conversations/open-with-contact/route.ts",
    escopo: "mcp:write",
    papel: "agent",
    descricao: "Abre (ou reaproveita) a conversa com um contato.",
  },
];
