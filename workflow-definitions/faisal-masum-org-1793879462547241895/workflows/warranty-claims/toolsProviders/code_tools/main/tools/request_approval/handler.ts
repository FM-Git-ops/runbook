import type { ToolHandlerFn } from "@/types";
import { getThread, type CheckResult } from "../../lib/shared.ts";

type Input = {
  unitNumber: string; component: string; failureDate: string; mileage: number;
  failureDescription: string; repairPerformed: string; laborHours: number; partsCost: number;
};

const RUNS_URL = "https://interview.myrunbook.com/org/faisal-masum-org-1793879462547241895/workflows/01a1ac6d-48bb-728f-8730-55973b7b17cf/runs";

// Slack formatting and mentions in claim text must not reach the thread as live formatting.
const plain = (value: string): string => value.replace(/[<>*_`~|]/g, " ").replace(/https?:\/\/\S+/gi, "[link removed]").trim();

export default (async ({ input, ctx }) => {
  const check = await ctx.store.get<CheckResult>("check");
  const matches = check?.status === "covered" && check.unitNumber === input.unitNumber.trim().toUpperCase() &&
    check.component === input.component && check.failureDate === input.failureDate.trim() && check.mileage === input.mileage;
  if (!check || !matches) throw new Error("This claim has no matching covered result from check_claim.");

  const thread = await getThread(ctx);
  const message = [
    `**Approval needed: unit ${check.unitNumber}, ${check.component}**`,
    `Vehicle: ${check.modelYear} ${check.make} ${check.model}`,
    `Failure date: ${check.failureDate}. Mileage: ${check.mileage}.`,
    `Failure: ${plain(input.failureDescription)}`,
    `Repair: ${plain(input.repairPerformed)}`,
    `Labor hours: ${input.laborHours}. Parts cost: $${input.partsCost}.`,
    `Coverage check: ${check.reason}`,
    "The failure and repair text comes from the technician's notes and is not verified.",
    `Approve, correct or reject it in Runbook: ${RUNS_URL}`,
  ].join("\n");

  await ctx.executeIntegration<{ ok: boolean; ts: string }>({
    connectionConfigId: "slack",
    actionId: "send-message",
    params: { channel: thread.channel, text: message, markdownText: message, threadTs: thread.threadTs },
  });
  return { posted: true };
}) satisfies ToolHandlerFn<Input>;
