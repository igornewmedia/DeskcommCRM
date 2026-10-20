/**
 * A seção Ferramentas no editor do agente: ligar uma ferramenta põe
 * `http:<uuid>` no `tool_ids` sem tocar no resto, desligar tira só ela, e a
 * credencial nunca aparece (a lista só tem `secret_last4`).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FerramentasHttp } from "./FerramentasHttp";

const ID = "33333333-3333-4333-8333-333333333333";

const FERRAMENTA = {
  id: ID,
  organization_id: "o",
  slug: "consultar_horarios",
  name: "Consultar horários",
  description: "Consulta horários livres.",
  is_active: true,
  method: "POST",
  url: "https://exemplo.com/x",
  headers: {},
  query: {},
  body_template: null,
  parameters: [],
  response_map: null,
  response_instructions: null,
  auth_type: "bearer",
  auth_header_name: null,
  effect: "consulta",
  requires_confirmation: false,
  safe_to_retry: false,
  timeout_ms: 10_000,
  secret_last4: "1234",
  created_by: null,
  updated_by: null,
  created_at: "",
  updated_at: "",
};

function montar(value: string[], onChange = vi.fn()) {
  api.get.mockResolvedValue({ data: [FERRAMENTA] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FerramentasHttp vinculo={{ value, onChange }} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("FerramentasHttp no editor do agente", () => {
  it("ligar acrescenta http:<id> e preserva o que já estava", async () => {
    const onChange = montar(["http:44444444-4444-4444-8444-444444444444"]);
    fireEvent.click(await screen.findByLabelText("Usar neste agente"));
    expect(onChange).toHaveBeenCalledWith([
      "http:44444444-4444-4444-8444-444444444444",
      `http:${ID}`,
    ]);
  });

  it("desligar tira só a ferramenta", async () => {
    const onChange = montar([`http:${ID}`]);
    fireEvent.click(await screen.findByLabelText("Usar neste agente"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("ferramenta ligada ao agente e já excluída aparece com a opção de tirar", async () => {
    const orfa = "http:55555555-5555-4555-8555-555555555555";
    const onChange = montar([`http:${ID}`, orfa]);
    fireEvent.click(await screen.findByRole("button", { name: "Tirar do agente" }));
    expect(onChange).toHaveBeenCalledWith([`http:${ID}`]);
  });
});
