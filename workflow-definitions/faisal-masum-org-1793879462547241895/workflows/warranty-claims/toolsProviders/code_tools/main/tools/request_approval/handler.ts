import type { ToolHandlerFn } from "@/types";
import { costWarning, getThread, plain, type CheckResult } from "../../lib/shared.ts";

type Input = {
  unitNumber: string; component: string; failureDate: string; mileage: number;
  failureDescription: string; repairPerformed: string; laborHours: number; partsCost: number;
};

const APPROVER_EMAIL = "fmasum.fm@gmail.com";
const RUNS_URL = "https://interview.myrunbook.com/org/faisal-masum-org-1793879462547241895/workflows/01a1ac6d-48bb-728f-8730-55973b7b17cf/runs";

const html = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default (async ({ input, ctx }) => {
  const check = await ctx.store.get<CheckResult>("check");
  const matches = check?.status === "covered" && check.unitNumber === input.unitNumber.trim().toUpperCase() &&
    check.component === input.component && check.failureDate === input.failureDate.trim() && check.mileage === input.mileage;
  if (!check || !matches) throw new Error("This claim has no matching covered result from check_claim.");

  // check_claim stored this first. This refreshes it when an approver corrected the cost.
  const { high: highCost, text: warning } = costWarning(input.partsCost);
  await ctx.store.set("costWarning", { text: warning });

  const thread = await getThread(ctx);
  const lines = [
    `Vehicle: ${check.modelYear} ${check.make} ${check.model}`,
    `Failure date: ${check.failureDate}. Mileage: ${check.mileage}.`,
    `Failure: ${plain(input.failureDescription)}`,
    `Repair: ${plain(input.repairPerformed)}`,
    `Labor hours: ${input.laborHours}. Parts cost: $${input.partsCost}.`,
    `Coverage check: ${check.reason}`,
    `Technician: ${plain(thread.technician)}`,
    "The failure and repair text comes from the technician's notes and is not verified.",
  ];
  const body = [
    ...(highCost ? [`<p><b>WARNING: ${html(warning)}</b></p>`] : []),
    `<p><b>Approval needed: unit ${html(check.unitNumber)}, ${html(check.component)}</b></p>`,
    ...lines.map((line) => `<p>${html(line)}</p>`),
    `<p><a href="${RUNS_URL}">Approve, correct or reject it in Runbook</a></p>`,
  ].join("");

  await ctx.executeIntegration<{ messageId: string; threadId: string }>({
    connectionConfigId: "gmail",
    actionId: "send-email",
    params: { to: APPROVER_EMAIL, subject: `${highCost ? "WARNING high cost - " : ""}Approval needed: warranty claim for ${check.unitNumber}, ${check.component}`, body },
  });
  await ctx.executeIntegration<{ ok: boolean; ts: string }>({
    connectionConfigId: "slack",
    actionId: "send-message",
    params: { channel: thread.channel, text: "Sent for approval. I'll post here once there's a decision.", threadTs: thread.threadTs },
  });
  return { sent: true };
}) satisfies ToolHandlerFn<Input>;
