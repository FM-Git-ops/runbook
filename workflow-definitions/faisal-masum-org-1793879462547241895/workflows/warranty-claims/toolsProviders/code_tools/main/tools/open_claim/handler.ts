import type { ToolHandlerFn } from "@/types";
import { getThread } from "../../lib/shared.ts";

export default (async ({ ctx }) => {
  if (await ctx.store.get<{ done: boolean }>("opened")) return { opened: true };
  const thread = await getThread(ctx);
  const link = await ctx.executeIntegration<{ ok: boolean; permalink: string }>({
    connectionConfigId: "slack",
    actionId: "get-permalink",
    params: { channel: thread.channel, ts: thread.threadTs },
  });
  await ctx.store.set("opened", { done: true, permalink: link.permalink });
  return { opened: true };
}) satisfies ToolHandlerFn<Record<string, never>>;
