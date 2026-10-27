import { describe, expect, it } from "vitest";
import { parseSocialMessage, parseSocialReaction } from "./parser";
const event = {
  event: "message.received",
  account: { id: "account-a", platform: "instagram" },
  message: {
    id: "m1",
    conversationId: "thread",
    platform: "instagram",
    direction: "incoming",
    text: "Oi",
    sender: { id: "123456789012345", name: "Pessoa" },
  },
};
describe("native social identity", () => {
  it("keeps a numeric social ID distinct from a telephone", () => {
    const result = parseSocialMessage(event, "account-a", "instagram");
    expect(result?.participantId).toBe("123456789012345");
    expect(result?.identity.phone).toBeNull();
    expect(result?.externalId).toBe("social:account-a:m1");
  });
  it("rejects another account or network and unsupported inboxes", () => {
    expect(parseSocialMessage(event, "account-b", "instagram")).toBeNull();
    expect(parseSocialMessage(event, "account-a", "facebook")).toBeNull();
    expect(parseSocialMessage(event, "account-a", "linkedin")).toBeNull();
  });
  it("does not turn malformed input or an outgoing echo into inbound", () => {
    expect(parseSocialMessage({}, "account-a", "instagram")).toBeNull();
    expect(
      parseSocialMessage(
        { ...event, message: { ...event.message, direction: "outgoing" } },
        "account-a",
        "instagram",
      ),
    ).toBeNull();
  });
  it("resolves outbound identity from the participant, not the business sender", () => {
    const result = parseSocialMessage(
      {
        ...event,
        event: "message.sent",
        conversation: { participantId: "customer" },
        message: { ...event.message, direction: "outgoing", sender: { id: "business" } },
      },
      "account-a",
      "instagram",
    );
    expect(result?.participantId).toBe("customer");
    expect(result?.direction).toBe("outbound");
  });
});

describe("Direct do Instagram — anúncio, compartilhamento, story e reação", () => {
  it("click-to-DM: metadata.referral com ad_id vira referral no formato do extrator", () => {
    const r = parseSocialMessage(
      {
        ...event,
        metadata: {
          referral: {
            ref: "promo-17",
            source: "ADS",
            ad_id: "120210000000001",
            ads_context_data: { ad_title: "iPhone 17 em até 12x", photo_url: "https://cdn.test/ad.jpg" },
          },
        },
      },
      "account-a",
      "instagram",
    );
    expect(r?.referral).toEqual({
      source_type: "ad",
      source_id: "120210000000001",
      headline: "iPhone 17 em até 12x",
      thumbnail_url: "https://cdn.test/ad.jpg",
      source_url: null,
      ref: "promo-17",
    });
  });

  it("link orgânico (sem ad_id) não é anúncio", () => {
    const r = parseSocialMessage({ ...event, metadata: { referral: { ref: "bio", source: "SHORTLINK" } } }, "account-a", "instagram");
    expect(r?.referral).toBeNull();
  });

  it("post compartilhado sem texto chega com marcador", () => {
    const r = parseSocialMessage(
      { ...event, message: { ...event.message, text: null, attachments: [{ type: "share", url: "https://instagram.com/p/x" }] } },
      "account-a",
      "instagram",
    );
    expect(r?.text).toBe("[o cliente compartilhou um post do Instagram]");
  });

  it("resposta a story mantém o texto do cliente depois do marcador", () => {
    const r = parseSocialMessage(
      { ...event, message: { ...event.message, text: "quanto custa?", attachments: [{ type: "story_reply", url: "https://cdn.test/s.jpg" }] } },
      "account-a",
      "instagram",
    );
    expect(r?.text).toBe("[o cliente respondeu ao seu story]\nquanto custa?");
  });

  it("anexo comum (imagem) não ganha marcador", () => {
    const r = parseSocialMessage(
      { ...event, message: { ...event.message, attachments: [{ type: "image", url: "https://cdn.test/i.jpg" }] } },
      "account-a",
      "instagram",
    );
    expect(r?.text).toBe("Oi");
  });

  it("reaction.received vira reação ligada à mensagem, e emoji vazio é remoção", () => {
    const reacao = {
      event: "reaction.received",
      id: "evt-1",
      account: { id: "account-a", platform: "instagram" },
      reaction: { action: "added", emoji: "❤️", platformMessageId: "mid-9", messageId: "zm-9" },
      sender: { id: "123456789012345" },
    };
    const r = parseSocialReaction(reacao, "account-a", "instagram");
    expect(r).toMatchObject({
      externalId: "social:account-a:reaction:evt-1",
      candidatosDoAlvo: ["social:account-a:mid-9", "social:account-a:zm-9"],
      emoji: "❤️",
      author: "123456789012345",
    });
    const removida = parseSocialReaction(
      { ...reacao, id: "evt-2", reaction: { ...reacao.reaction, action: "removed", emoji: "" } },
      "account-a",
      "instagram",
    );
    expect(removida?.emoji).toBeNull();
    // Reação de outra conta não entra.
    expect(parseSocialReaction(reacao, "account-b", "instagram")).toBeNull();
    // E uma mensagem comum não é reação.
    expect(parseSocialReaction(event, "account-a", "instagram")).toBeNull();
  });
});
