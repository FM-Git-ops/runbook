import type { ToolHandlerFn } from "@/types";
import { getThread, postForReview } from "../../lib/shared.ts";

type Input = { note: string };

export default (async ({ input, ctx }) => {
  await postForReview(ctx, await getThread(ctx), input.note);
  return { posted: true };
}) satisfies ToolHandlerFn<Input>;
