import type { ToolHandlerFn } from "@/types";
import { getThread } from "../../lib/shared.ts";

type Input = { message: string };

export default (async ({ input, ctx }) => {
  if (/https?:\/\/|www\./i.test(input.message)) throw new Error("Replies can't contain links.");
  const thread = await getThread(ctx);
  await ctx.executeIntegration<{ ok: boolean; ts: string }>({
    connectionConfigId: "slack",
    actionId: "send-message",
    params: { channel: thread.channel, text: input.message, markdownText: input.message, threadTs: thread.threadTs },
  });
  return { sent: true };
}) satisfies ToolHandlerFn<Input>;
