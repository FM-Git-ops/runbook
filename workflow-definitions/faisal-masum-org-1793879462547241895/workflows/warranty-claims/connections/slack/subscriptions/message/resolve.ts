import type { ResolveFn } from "@/types";

// A top-level message containing the trigger phrase starts a claim. A reply in its thread goes back to that claim's run.
// The key includes the poster, so a reply from anyone else never reaches the claim agent. In a claim thread,
// that person gets one fixed notice from the thread guard. Replies in any other thread are dropped.
const TRIGGER_PHRASE = /rb-claim-agent/i;

export default (async (ctx) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  if (payload.bot_id || payload.subtype) return null;

  const channel = String(payload.channel ?? "");
  const ts = String(payload.ts ?? "");
  const threadTs = typeof payload.threadTs === "string" ? payload.threadTs : "";
  const user = String(payload.user ?? "");
  if (!channel || !ts || !user) return null;

  const key = `slack:${channel}:${threadTs || ts}:${user}`;
  const existing = await ctx.lookupCorrelation(key);
  if (existing.length > 0) return existing.map((s) => ({ action: "deliver" as const, sessionId: s.sessionId }));
  if (threadTs && threadTs !== ts) {
    const claimThread = await ctx.lookupCorrelation(`claim-thread:${channel}:${threadTs}`);
    if (claimThread.length === 0) return null;
    const guardKey = `thread-guard:${channel}:${threadTs}:${user}`;
    if ((await ctx.lookupCorrelation(guardKey)).length > 0) return null;
    return [{ action: "create_run" as const, agentConfigId: "thread-guard", correlationKey: guardKey, title: "Reply from someone other than the claim's poster" }];
  }

  const raw = String(payload.text ?? "");
  if (!TRIGGER_PHRASE.test(raw)) return null;

  const text = raw.replace(TRIGGER_PHRASE, "").replace(/<@[^>]+>/g, "").trim();
  return [{ action: "create_run" as const, agentConfigId: "main-agent", correlationKey: key, title: `Warranty claim: ${text.slice(0, 60) || "new claim"}` }];
}) satisfies ResolveFn;
