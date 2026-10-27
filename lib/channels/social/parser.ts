import { z } from "zod";
import { inboxSupported, socialMessageId } from "./catalog";
import type { ZernioInboundMessage } from "../zernio/webhook";

const text = z.string().min(1);
const schema = z.object({
  event: z.enum([
    "message.received",
    "message.sent",
    "message.delivered",
    "message.read",
    "message.failed",
  ]),
  account: z.object({ id: text, platform: text }),
  message: z.object({
    id: text,
    platformMessageId: text.nullish(),
    conversationId: text,
    platform: text,
    direction: z.enum(["incoming", "outgoing"]),
    text: z.string().nullish(),
    sentAt: z.iso.datetime({ offset: true }).nullish(),
    sender: z
      .object({ id: text, name: z.string().nullish(), username: z.string().nullish() })
      .nullish(),
    attachments: z.array(z.object({ type: text, url: z.url() })).default([]),
  }),
  conversation: z
    .object({
      participantId: text,
      participantName: z.string().nullish(),
      participantUsername: z.string().nullish(),
    })
    .nullish(),
});
export interface SocialMessage extends ZernioInboundMessage {
  platform: string;
  participantId: string;
}
export function parseSocialMessage(
  payload: unknown,
  accountId: string,
  platform: string,
): SocialMessage | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success || !inboxSupported(platform)) return null;
  const p = parsed.data;
  if (
    p.account.id !== accountId ||
    p.account.platform !== platform ||
    p.message.platform !== platform
  )
    return null;
  const outbound = p.message.direction === "outgoing";
  // Event and direction must agree; an outgoing echo must never dispatch the AI.
  if (p.event === "message.received" && outbound) return null;
  if (p.event !== "message.received" && !outbound) return null;
  const participantId = outbound ? p.conversation?.participantId : p.message.sender?.id;
  if (!participantId) return null;
  const status =
    p.event === "message.received"
      ? undefined
      : (p.event.slice(8) as "sent" | "delivered" | "read" | "failed");
  return {
    platform,
    participantId,
    accountId,
    conversationId: p.message.conversationId,
    externalId: socialMessageId(accountId, p.message.platformMessageId ?? p.message.id),
    direction: outbound ? "outbound" : "inbound",
    kind: status && status !== "sent" ? "status" : "message",
    status,
    text: comMarcador(p.message.text ?? null, p.message.attachments, outbound),
    sentAt: p.message.sentAt ?? null,
    attachments: p.message.attachments,
    referral: outbound ? null : referralDoInstagram(payload),
    identity: {
      phone: null,
      bsuid: null,
      anchor: null,
      username:
        (outbound ? p.conversation?.participantUsername : p.message.sender?.username) ?? null,
      displayName: (outbound ? p.conversation?.participantName : p.message.sender?.name) ?? null,
    },
  };
}

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * A origem de anúncio do Direct (click-to-DM) no formato que
 * `extrairAtribuicaoMeta` entende. Documentado pela Zernio: `metadata.referral`
 * traz `ref` e `source` (links ig.me) e, no clique em anúncio, `ad_id` e
 * `ads_context_data`; o primeiro `message.received` do click-to-DM costuma vir
 * sem referral, e o dado chega no seguinte (`metadata.ad`/`metadata.referral`).
 * Link orgânico (sem `ad_id`) não é anúncio: devolve null.
 *
 * NÃO VERIFICADO contra payload real desta instalação — a forma é a da
 * documentação; o extrator ignora o que não reconhece.
 */
export function referralDoInstagram(payload: unknown): unknown {
  const meta = obj(obj(payload)?.metadata);
  const r = obj(meta?.referral) ?? obj(meta?.ad);
  if (!r) return null;
  const adId = str(r.ad_id) ?? str(r.adId);
  if (!adId) return null;
  const ctx = obj(r.ads_context_data) ?? obj(r.adsContextData);
  return {
    source_type: "ad",
    source_id: adId,
    headline: str(ctx?.ad_title) ?? str(ctx?.adTitle),
    thumbnail_url: str(ctx?.photo_url) ?? str(ctx?.photoUrl),
    source_url: str(ctx?.post_url) ?? null,
    ...(str(r.ref) ? { ref: str(r.ref) } : {}),
  };
}

/**
 * Marcador para a IA (e para quem lê a conversa) quando o Direct traz um
 * compartilhamento ou uma interação com story, que chegam como anexo sem texto.
 * Os nomes de tipo vêm da documentação da Meta para o Instagram (`share`,
 * `ig_post`, `ig_reel`, `story_mention`, `story_reply`) e NÃO foram medidos num
 * payload real da Zernio — tipo desconhecido não ganha marcador.
 */
export function marcadorDoAnexo(tipos: string[]): string | null {
  const t = tipos.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes("story_mention"))) return "[o cliente mencionou você no story dele]";
  if (t.some((x) => x.includes("story"))) return "[o cliente respondeu ao seu story]";
  if (t.some((x) => x === "share" || x === "ig_post" || x === "ig_reel" || x === "reel" || x === "post")) {
    return "[o cliente compartilhou um post do Instagram]";
  }
  return null;
}

function comMarcador(texto: string | null, anexos: { type: string }[], saida: boolean): string | null {
  if (saida) return texto;
  const marcador = marcadorDoAnexo(anexos.map((a) => a.type));
  if (!marcador) return texto;
  return texto ? `${marcador}\n${texto}` : marcador;
}

const reacaoSchema = z.object({
  event: z.literal("reaction.received"),
  id: text.optional(),
  account: z.object({ id: text, platform: text }),
  reaction: z.object({
    action: z.enum(["added", "removed"]),
    emoji: z.string().default(""),
    platformMessageId: text,
    messageId: text.nullish(),
  }),
  sender: z.object({ id: text }).nullish(),
  conversation: z.object({ participantId: text.nullish() }).nullish(),
  timestamp: z.string().nullish(),
});

export interface ReacaoSocial {
  externalId: string;
  candidatosDoAlvo: string[];
  emoji: string | null;
  author: string;
  sentAt: string;
}

/**
 * `reaction.received` da Zernio (documentado: `reaction.action`, `emoji`,
 * `platformMessageId`, `messageId`; "reações nunca chegam como
 * message.received"). Vira linha `type='reaction'` ligada ao alvo por
 * `gravarReacaoDeMensagem` — que não move a conversa e, no banco, não dispara a
 * IA. Remoção chega com emoji vazio.
 */
export function parseSocialReaction(payload: unknown, accountId: string, platform: string): ReacaoSocial | null {
  const parsed = reacaoSchema.safeParse(payload);
  if (!parsed.success || !inboxSupported(platform)) return null;
  const p = parsed.data;
  if (p.account.id !== accountId || p.account.platform !== platform) return null;
  const r = p.reaction;
  const alvo = [r.platformMessageId, r.messageId].filter((x): x is string => typeof x === "string");
  const author = p.sender?.id ?? p.conversation?.participantId ?? "cliente";
  const chave = p.id ?? `${r.platformMessageId}:${author}:${r.action}:${r.emoji}`;
  return {
    externalId: socialMessageId(accountId, `reaction:${chave}`),
    candidatosDoAlvo: alvo.map((id) => socialMessageId(accountId, id)),
    emoji: r.action === "removed" || r.emoji === "" ? null : r.emoji,
    author,
    sentAt: p.timestamp ?? new Date().toISOString(),
  };
}

