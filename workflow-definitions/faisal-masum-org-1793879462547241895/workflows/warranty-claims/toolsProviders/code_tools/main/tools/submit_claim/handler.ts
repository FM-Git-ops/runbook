import type { ToolHandlerFn } from "@/types";
import { SHEET_URL, findTab, getThread, readTabs, safeCell, type CheckResult } from "../../lib/shared.ts";

type Input = {
  unitNumber: string; component: string; failureDate: string; mileage: number;
  failureDescription: string; repairPerformed: string; laborHours: number; partsCost: number;
};

export default (async ({ input, ctx }) => {
  const filed = await ctx.store.get<{ claimId: string }>("filed");
  if (filed) return { status: "submitted", claimId: filed.claimId };
  if (await ctx.store.get<unknown>("logged")) throw new Error("This claim already has a final decision.");

  const check = await ctx.store.get<CheckResult>("check");
  const matches = check?.status === "covered" && check.unitNumber === input.unitNumber.trim().toUpperCase() &&
    check.component === input.component && check.failureDate === input.failureDate.trim() && check.mileage === input.mileage;
  if (!check || !matches) throw new Error("This claim has no matching covered result from check_claim. Run check_claim on these exact details first.");

  let pending = await ctx.store.get<{ claimId: string }>("pending_claim");
  if (!pending) {
    pending = { claimId: `WC-${Date.now().toString(36).toUpperCase()}` };
    await ctx.store.set("pending_claim", pending);
  }

  const thread = await getThread(ctx);
  const claims = findTab(await readTabs(ctx), "Claims");
  await ctx.executeIntegration<{ rowIndex: number }>({
    connectionConfigId: "sheets",
    actionId: "append-row",
    params: {
      sheetUrl: SHEET_URL,
      tabId: claims.gid,
      values: {
        "Claim ID": pending.claimId,
        "Status": "Submitted",
        "Unit": check.unitNumber,
        "Make": check.make ?? "",
        "Model": check.model ?? "",
        "Model Year": String(check.modelYear ?? ""),
        "Component": check.component,
        "Failure Date": check.failureDate,
        "Mileage": String(check.mileage),
        "Failure Description": safeCell(input.failureDescription),
        "Repair Performed": safeCell(input.repairPerformed),
        "Labor Hours": String(input.laborHours),
        "Parts Cost": String(input.partsCost),
        "Reason": check.reason,
        "Technician": safeCell(thread.technician),
        "Logged At": new Date().toISOString(),
      },
    },
  });

  await ctx.store.set("filed", pending);
  await ctx.setOutcome("success", { note: `Filed ${pending.claimId}` });
  return { status: "submitted", claimId: pending.claimId };
}) satisfies ToolHandlerFn<Input>;
