import type { OnActionResultFn } from "@/types";

// A permalink ends in /archives/<channel>/p<ts without the dot>. This registers the claim's thread,
// so the trigger can tell a claim thread from any other thread in the channel.
export default (async (ctx) => {
  const r = ctx.result as { permalink?: string };
  const match = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(r.permalink ?? "");
  if (match) await ctx.setCorrelation(`claim-thread:${match[1]}:${match[2]}.${match[3]}`);
}) satisfies OnActionResultFn;
