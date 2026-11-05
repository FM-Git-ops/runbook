import type { ToolHandlerFn } from "@/types";

const NOTICE = "Thanks, but I can only take details for this claim from the person who started it. I'm waiting for the original poster to reply here.";

export default (async ({ ctx }) => {
  const events = await ctx.getIntegrationEvents({ connectionConfigId: "slack", eventTypeId: "slack:message" });
  const event = events[events.length - 1]?.payload as { channel?: string; threadTs?: string } | undefined;
  if (!event?.channel || !event.threadTs) throw new Error("No thread reply in this run.");
  await ctx.executeIntegration<{ ok: boolean; ts: string }>({
    connectionConfigId: "slack",
    actionId: "send-message",
    params: { channel: event.channel, text: NOTICE, threadTs: event.threadTs },
  });
  await ctx.setOutcome("disqualified", { note: "Reply from someone other than the claim's poster" });
  return { sent: true };
}) satisfies ToolHandlerFn<Record<string, never>>;
