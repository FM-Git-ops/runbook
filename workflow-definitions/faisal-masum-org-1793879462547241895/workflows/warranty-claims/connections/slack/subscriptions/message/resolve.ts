import type { ResolveFn } from "@/types";

// A top-level message containing the trigger phrase starts a claim. A reply in its thread goes back to that claim's run.
const TRIGGER_PHRASE = /rb-claim-agent/i;

export default (async (ctx) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  if (payload.bot_id || payload.subtype) return null;

  const channel = String(payload.channel ?? "");
  const ts = String(payload.ts ?? "");
  const threadTs = typeof payload.threadTs === "string" ? payload.threadTs : "";
  if (!channel || !ts) return null;

  const key = `slack:${channel}:${threadTs || ts}`;
  const existing = await ctx.lookupCorrelation(key);
  if (existing.length > 0) return existing.map((s) => ({ action: "deliver" as const, sessionId: s.sessionId }));
  if (threadTs && threadTs !== ts) return null;

  const raw = String(payload.text ?? "");
  if (!TRIGGER_PHRASE.test(raw)) return null;

  const text = raw.replace(TRIGGER_PHRASE, "").replace(/<@[^>]+>/g, "").trim();
  return [{ action: "create_run" as const, agentConfigId: "main-agent", correlationKey: key, title: `Warranty claim: ${text.slice(0, 60) || "new claim"}` }];
}) satisfies ResolveFn;
