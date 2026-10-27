import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../reacao", () => ({ gravarReacaoDeMensagem: vi.fn() }));
vi.mock("../zernio/ingest", () => ({ ingestZernioInbound: vi.fn() }));

import { gravarReacaoDeMensagem } from "../reacao";
import { ingestZernioInbound } from "../zernio/ingest";
import { ingestSocialInbound } from "./ingest";

/**
 * Reação do Direct (`reaction.received`): grava a linha `type='reaction'` ligada
 * ao alvo e NUNCA vai para a ingestão de mensagem — que é quem chama a IA.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const SESSAO = "22222222-2222-4222-8222-222222222222";

function db() {
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    maybeSingle: async () => ({
      data: { zernio_account_id: "account-a", metadata: { social_platform: "instagram" } },
      error: null,
    }),
  };
  return { from: () => q } as never;
}

const reacao = {
  event: "reaction.received",
  id: "evt-1",
  account: { id: "account-a", platform: "instagram" },
  reaction: { action: "added", emoji: "🔥", platformMessageId: "mid-1" },
  sender: { id: "cliente-1" },
};

beforeEach(() => vi.clearAllMocks());

describe("ingestSocialInbound — reação", () => {
  it("grava a reação no alvo e não chama a ingestão de mensagem", async () => {
    vi.mocked(gravarReacaoDeMensagem).mockResolvedValue({ status: "gravada", messageId: "m1", conversationId: "c1" });
    const r = await ingestSocialInbound(db(), ORG, SESSAO, reacao);
    expect(r).toEqual({ status: "ingested", reason: "reacao_gravada" });
    expect(vi.mocked(gravarReacaoDeMensagem)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        channelSessionId: SESSAO,
        emoji: "🔥",
        candidatosDoAlvo: ["social:account-a:mid-1"],
        direction: "inbound",
      }),
    );
    expect(vi.mocked(ingestZernioInbound)).not.toHaveBeenCalled();
  });

  it("reação sobre mensagem que o CRM não conhece é ignorada", async () => {
    vi.mocked(gravarReacaoDeMensagem).mockResolvedValue({ status: "sem_alvo" });
    const r = await ingestSocialInbound(db(), ORG, SESSAO, reacao);
    expect(r.status).toBe("ignored");
    expect(vi.mocked(ingestZernioInbound)).not.toHaveBeenCalled();
  });
});
