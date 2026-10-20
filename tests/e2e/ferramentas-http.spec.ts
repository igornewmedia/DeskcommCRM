/**
 * Ferramentas HTTP dos agentes (migration 9002), provadas PELA TELA como um
 * leigo as usaria: criar a ferramenta na biblioteca, testar, ver o histórico,
 * ligar no agente, desativar e excluir.
 *
 * ═══ O receiver é real, nos dois sentidos ═══════════════════════════════════
 *
 * 1. Um servidor HTTP de verdade em 127.0.0.1. O botão Testar aponta para ele e
 *    a tela tem de mostrar "Bloqueado" com o receiver em ZERO requisições: é o
 *    anti-SSRF agindo antes do primeiro byte (rede interna, localhost).
 * 2. A entrega POSITIVA precisa de um destino público em HTTPS (o mesmo motivo
 *    do `vps-webhook-outbound-ssrf`). Ela roda quando `E2E_ECO_PUBLICO_URL`
 *    aponta para um serviço que devolve o que recebeu (ex.:
 *    `https://postman-echo.com/post`, ou um túnel ngrok para um receiver seu).
 *    Sem a variável o caso é PULADO, e diz isso — nunca finge que passou. Fora
 *    do CI de propósito: um check obrigatório não pode depender de terceiro.
 *
 * A credencial usada é de teste e nunca pode aparecer no HTML da tela nem na
 * resposta da listagem — a prova disso está aqui também.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoAdmin, type CredsE2E } from "./helpers/login-admin";

const EVIDENCIA = path.join(process.cwd(), "evidence", "ferramentas-http");
const SEGREDO = "tok-de-teste-e2e-9f3a";
const ECO_PUBLICO = process.env.E2E_ECO_PUBLICO_URL ?? "";

let creds: CredsE2E & { org_id?: string };
let receiver: http.Server;
let hits = 0;
let urlDoReceiver = "";
let ferramentaId = "";
let agenteId = "";

function admin() {
  const c = credenciaisSupabaseDeTeste();
  return createClient(c.url, c.serviceRole, { auth: { persistSession: false } });
}

async function foto(page: Page, nome: string): Promise<void> {
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`), fullPage: true });
}

async function escolher(page: Page, combobox: string, opcao: string): Promise<void> {
  await page.getByRole("combobox", { name: combobox }).click();
  await page.getByRole("option", { name: opcao, exact: true }).click();
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  creds = lerCreds() as typeof creds;
  receiver = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"slots":["09:00"]}');
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  urlDoReceiver = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/horarios`;

  // Pré-requisito, não o que se prova: um agente COMPLETO (versão com provedor
  // e credencial) — o mesmo que o spec de capacidades usa. Um `ai_agents` só
  // com o cadastro não passa da validação do "Salvar rascunho".
  if (!creds.capacidades) {
    for (const script of ["seed-e2e-followup-agent.ts", "seed-e2e-capacidades.ts"]) {
      execFileSync("npx", ["tsx", `scripts/${script}`], { stdio: "inherit" });
    }
    creds = lerCreds() as typeof creds;
  }
  agenteId = creds.capacidades!.agent_id;

  // Rodada anterior que parou no meio deixa a ferramenta viva e o nome ocupado.
  await admin()
    .from("ai_http_tools")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("organization_id", creds.org_id)
    .eq("slug", "consultar_horarios")
    .is("deleted_at", null);
});

test.afterAll(async () => {
  await new Promise<void>((r) => receiver.close(() => r()));
});

test.beforeEach(async ({ page }) => {
  creds = (await loginComoAdmin(page, creds)) as typeof creds;
});

test("cria a ferramenta pela biblioteca, sem a credencial voltar para a tela", async ({ page }) => {
  await page.goto("/app/ai/ferramentas");
  await expect(page.getByRole("heading", { name: "Ferramentas dos agentes" })).toBeVisible({ timeout: 90_000 });
  await foto(page, "01-biblioteca-vazia");

  await page.getByRole("button", { name: "Nova ferramenta" }).click();
  await page.locator("#ft-nome").fill("Consultar horários");
  await expect(page.locator("#ft-slug")).toHaveValue("consultar_horarios");
  await page.locator("#ft-descricao").fill("Consulta os horários livres de um procedimento numa data.");
  await page.getByRole("textbox", { name: "URL" }).fill(urlDoReceiver);

  for (const [nome, descricao, obrigatorio] of [
    ["data", "Data desejada (AAAA-MM-DD)", true],
    ["procedimento", "Nome do procedimento", true],
    ["profissional", "Profissional preferido", false],
  ] as const) {
    await page.getByRole("button", { name: "Adicionar parâmetro" }).click();
    await page.getByRole("textbox", { name: "Nome do parâmetro" }).last().fill(nome);
    await page.getByRole("textbox", { name: "Descrição do parâmetro" }).last().fill(descricao);
    if (obrigatorio) await page.getByRole("switch", { name: "Obrigatório" }).last().click();
  }

  await escolher(page, "Autenticação", "Bearer Token");
  await page.getByLabel("Credencial").fill(SEGREDO);
  await foto(page, "02-editor-preenchido");

  const [criada] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/v1/ai/http-tools") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Salvar", exact: true }).click(),
  ]);
  expect(criada.status()).toBe(201);
  const corpoDaCriacao = await criada.text();
  expect(corpoDaCriacao).not.toContain(SEGREDO);
  ferramentaId = (JSON.parse(corpoDaCriacao) as { data: { id: string } }).data.id;

  const linha = page.getByTestId("ferramenta-http").filter({ hasText: "Consultar horários" });
  await expect(linha).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.content()).not.toContain(SEGREDO);
  const lista = await page.request.get("/api/v1/ai/http-tools");
  expect(await lista.text()).not.toContain(SEGREDO);
  await foto(page, "03-ferramenta-na-lista");

  // No banco, a credencial está cifrada — nunca em claro.
  const { data } = await admin()
    .from("ai_http_tools")
    .select("secret_encrypted, secret_last4")
    .eq("id", ferramentaId)
    .single();
  expect(data?.secret_last4).toBe(SEGREDO.slice(-4));
  expect(JSON.stringify(data)).not.toContain(SEGREDO);
});

test("Testar contra a rede interna: a tela mostra Bloqueado e o receiver não recebe nada", async ({ page }) => {
  await page.goto("/app/ai/ferramentas");
  const linha = page.getByTestId("ferramenta-http").filter({ hasText: "Consultar horários" });
  await linha.getByRole("button", { name: "Testar" }).click();

  // Sem o obrigatório: a validação aparece e nada sai.
  await page.locator("#teste-data").fill("2026-10-21");
  await page.getByRole("dialog").getByRole("button", { name: "Testar", exact: true }).click();
  const resultado = page.getByTestId("resultado-do-teste");
  await expect(resultado).toContainText("Parâmetros inválidos", { timeout: 30_000 });
  await expect(resultado).toContainText("procedimento");

  await page.locator("#teste-procedimento").fill("limpeza");
  await page.getByRole("dialog").getByRole("button", { name: "Testar", exact: true }).click();
  await expect(resultado).toContainText("Bloqueado", { timeout: 30_000 });
  await expect(resultado).toContainText("unsafe_url");
  await expect(resultado).toContainText("Não invente");
  await foto(page, "04-teste-bloqueado");
  expect(hits).toBe(0);

  await page.keyboard.press("Escape");
  const historico = page.getByRole("table");
  await expect(historico).toContainText("Bloqueado");
  await expect(historico).toContainText("Teste manual");
  await foto(page, "05-historico");
});

test("Testar contra um destino público entrega e mostra o que voltou", async ({ page }) => {
  test.skip(ECO_PUBLICO === "", "sem E2E_ECO_PUBLICO_URL: a entrega positiva precisa de HTTPS público");
  await page.goto("/app/ai/ferramentas");
  const linha = page.getByTestId("ferramenta-http").filter({ hasText: "Consultar horários" });
  await linha.getByRole("button", { name: "Editar" }).click();
  await page.getByRole("textbox", { name: "URL" }).fill(ECO_PUBLICO);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Ferramenta salva.")).toBeVisible();

  await linha.getByRole("button", { name: "Testar" }).click();
  await page.locator("#teste-data").fill("2026-10-21");
  await page.locator("#teste-procedimento").fill("limpeza");
  await page.getByRole("dialog").getByRole("button", { name: "Testar", exact: true }).click();
  const resultado = page.getByTestId("resultado-do-teste");
  await expect(resultado).toContainText("Sucesso", { timeout: 45_000 });
  await expect(resultado).toContainText("HTTP 200");
  // O eco devolve o corpo: o valor preenchido chegou do outro lado.
  await expect(resultado).toContainText("limpeza");
  // O que a tela mostra como ENVIADO tem a credencial mascarada.
  await expect(resultado.getByText("••••").first()).toBeVisible();
  // Medido, não a olho: o resultado longo não pode empurrar o painel para fora.
  const vazamento = await page.getByRole("dialog").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(vazamento).toBeLessThanOrEqual(1);
  await foto(page, "06-teste-entregue");
});

test("liga a ferramenta no agente pela seção Ferramentas e o rascunho guarda o vínculo", async ({ page }) => {
  await page.goto(`/app/ai/agents/${agenteId}`);
  await page.getByTestId("tool-picker").waitFor({ state: "visible", timeout: 90_000 });
  const secao = page.getByRole("heading", { name: "Ferramentas", exact: true }).locator("xpath=..");
  await secao.scrollIntoViewIfNeeded();
  await secao.getByRole("switch", { name: "Usar neste agente" }).click();
  await foto(page, "07-agente-com-ferramenta");

  await page.getByRole("button", { name: /salvar rascunho/i }).click();
  await expect(page.getByText(/Rascunho v\d+ salvo/)).toBeVisible({ timeout: 20_000 });

  const { data } = await admin()
    .from("ai_agent_versions")
    .select("tool_ids")
    .eq("agent_id", agenteId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  expect(data?.tool_ids).toContain(`http:${ferramentaId}`);

  // Recarregada a tela, o vínculo continua lá.
  await page.reload();
  await page.getByTestId("tool-picker").waitFor({ state: "visible", timeout: 90_000 });
  await expect(page.getByRole("switch", { name: "Usar neste agente" })).toBeChecked();
});

test("desativa e exclui pela biblioteca; o histórico fica", async ({ page }) => {
  await page.goto("/app/ai/ferramentas");
  const linha = page.getByTestId("ferramenta-http").filter({ hasText: "Consultar horários" });
  await linha.getByRole("switch", { name: "Ativa" }).click();
  await expect(linha).toContainText("Inativa");

  await linha.getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Ferramenta excluída.")).toBeVisible();
  await expect(page.getByTestId("ferramenta-http")).toHaveCount(0);
  await expect(page.getByRole("table")).toContainText("(excluída)");
  await foto(page, "08-excluida-historico-fica");
});
