import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PUT    /api/v1/products/:id — substitui o produto inteiro pelo corpo.
 * PATCH  /api/v1/products/:id — muda o que veio, não encosta no resto.
 * DELETE /api/v1/products/:id — remove do catálogo.
 *
 * Sessão OU `Authorization: Bearer dsk_…` (`lib/api/auth-dual.ts`), como o
 * `POST` da coleção: a automação do fornecedor sincroniza o catálogo todo dia
 * (GET, compara, PUT/POST/DELETE). Escrever pede `mcp:write` e papel manager.
 *
 * O id vai no PATH, não no corpo, e o DELETE confere que a linha existia ANTES
 * de auditar: sem isso, um DELETE barrado pela RLS devolveria sucesso e gravaria
 * auditoria de uma mutação que não aconteceu.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";
import { apagarDoBucket } from "@/lib/catalogo/fotos-no-bucket";
import { COLUNAS_DO_PRODUTO, produtoCreateSchema, produtoPatchSchema } from "@/lib/schemas/produtos";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Os opcionais que o PUT zera quando não vêm: substituir é dizer o estado inteiro. */
const OPCIONAIS_ZERADOS_NO_PUT = {
  descricao: null,
  marca: null,
  categoria: null,
  cor: null,
  capacidade: null,
  custo_cents: null,
  imagem_url: null,
} as const;

function opcoesDeEscrita(requestId: string) {
  return { requestId, resource: "catalog_products", role: "manager", scope: "mcp:write" } as const;
}

type Autorizado = Extract<Awaited<ReturnType<typeof resolveAuthDual>>, { ok: true }>;

async function atualizar(
  req: NextRequest,
  { params }: Params,
  modo: "put" | "patch",
  authz: Autorizado,
  requestId: string,
): Promise<Response> {
  const t = (texto: string) => traduzir(texto, authz.idioma ?? "pt-BR");
  const { id } = await params;

  const corpo = await req.json().catch(() => null);
  const parsed = modo === "put" ? produtoCreateSchema.safeParse(corpo) : produtoPatchSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail("validation_failed", t("Nada para alterar."), 422, { requestId });
  }
  // PUT sem `codigo` mantém o atual: ele é autopreenchido no cadastro e é a
  // chave que a automação usa para comparar listas.
  const dados = modo === "put" ? { ...OPCIONAIS_ZERADOS_NO_PUT, ...parsed.data } : parsed.data;

  const { supabase, organizationId } = authz;
  const { data, error } = await supabase
    .from("catalog_products")
    .update(dados)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select(COLUNAS_DO_PRODUTO)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um produto com esse código."), 409, { requestId });
    }
    // 22P02 = id fora do formato uuid: para quem chama, é "não existe".
    if (error.code === "22P02") return fail("not_found", t("Produto não encontrado."), 404, { requestId });
    return fail("internal_error", "Erro ao salvar o produto.", 500, { requestId });
  }
  // `maybeSingle` devolve null quando a RLS barrou ou o id não é desta org — os
  // dois são "não existe para você", e 404 é a resposta honesta.
  if (!data) return fail("not_found", t("Produto não encontrado."), 404, { requestId });

  await audit({
    organizationId,
    actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
    actorApiTokenId: authz.apiTokenId ?? null,
    action: "catalog_product.updated",
    resourceType: "catalog_products",
    resourceId: id,
    requestId,
  });

  return ok(data, { requestId });
}

export async function PUT(req: NextRequest, ctx: Params): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await resolveAuthDual(req, opcoesDeEscrita(requestId));
  if (!authz.ok) return authz.response;
  const teto = await tetoDeEscritaDoToken(authz, "produtos", requestId);
  if (teto) return teto;
  return atualizar(req, ctx, "put", authz, requestId);
}

export async function PATCH(req: NextRequest, ctx: Params): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await resolveAuthDual(req, opcoesDeEscrita(requestId));
  if (!authz.ok) return authz.response;
  const teto = await tetoDeEscritaDoToken(authz, "produtos", requestId);
  if (teto) return teto;
  return atualizar(req, ctx, "patch", authz, requestId);
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await resolveAuthDual(req, opcoesDeEscrita(requestId));
  if (!authz.ok) return authz.response;
  const teto = await tetoDeEscritaDoToken(authz, "produtos", requestId);
  if (teto) return teto;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? "pt-BR");
  const { id } = await params;

  const { supabase, organizationId } = authz;
  const { data, error } = await supabase
    .from("catalog_products")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("id, fotos")
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") return fail("not_found", t("Produto não encontrado."), 404, { requestId });
    return fail("internal_error", "Erro ao remover o produto.", 500, { requestId });
  }
  if (!data) return fail("not_found", t("Produto não encontrado."), 404, { requestId });
  // As fotos saem junto: a linha era a única referência a elas.
  await apagarDoBucket(organizationId, id, (data as { fotos: string[] | null }).fotos ?? [], requestId);

  await audit({
    organizationId,
    actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
    actorApiTokenId: authz.apiTokenId ?? null,
    action: "catalog_product.deleted",
    resourceType: "catalog_products",
    resourceId: id,
    requestId,
  });

  return ok({ id }, { requestId });
}
