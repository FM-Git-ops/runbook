import type { ToolHandlerFn } from "@/types";
import { getThread } from "../../lib/shared.ts";

type Input = { message: string };

export default (async ({ input, ctx }) => {
  const thread = await getThread(ctx);
  await ctx.executeIntegration<{ ok: boolean; ts: string }>({
    connectionConfigId: "slack",
    actionId: "send-message",
    params: { channel: thread.channel, text: input.message, threadTs: thread.threadTs },
  });
  return { sent: true };
}) satisfies ToolHandlerFn<Input>;
