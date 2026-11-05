import type { ToolHandlerFn } from "@/types";
import { SHEET_URL, findTab, getThread, readTabs, type CheckResult } from "../../lib/shared.ts";

type Input = { status: string; reason: string; unitNumber: string; component: string; failureDescription: string };

export default (async ({ input, ctx }) => {
  if (await ctx.store.get<{ claimId: string }>("filed")) throw new Error("A claim was already filed in this run.");
  const logged = await ctx.store.get<{ logId: string }>("logged");
  if (logged) return { status: "already_logged", logId: logged.logId };

  let pending = await ctx.store.get<{ logId: string }>("pending_log");
  if (!pending) {
    pending = { logId: `WL-${Date.now().toString(36).toUpperCase()}` };
    await ctx.store.set("pending_log", pending);
  }

  const check = await ctx.store.get<CheckResult>("check");
  const thread = await getThread(ctx);
  const claims = findTab(await readTabs(ctx), "Claims");
  await ctx.executeIntegration<{ rowIndex: number }>({
    connectionConfigId: "sheets",
    actionId: "append-row",
    params: {
      sheetUrl: SHEET_URL,
      tabId: claims.gid,
      values: {
        "Claim ID": pending.logId,
        "Status": input.status,
        "Unit": input.unitNumber,
        "Make": check?.make ?? "",
        "Model": check?.model ?? "",
        "Model Year": String(check?.modelYear ?? ""),
        "Component": input.component,
        "Failure Date": check?.failureDate ?? "",
        "Mileage": check ? String(check.mileage) : "",
        "Failure Description": input.failureDescription,
        "Reason": input.reason,
        "Technician": thread.technician,
        "Logged At": new Date().toISOString(),
      },
    },
  });

  await ctx.store.set("logged", pending);
  await ctx.setOutcome("disqualified", { note: `${input.status}: ${input.reason}`.slice(0, 200) });
  return { status: "logged", logId: pending.logId };
}) satisfies ToolHandlerFn<Input>;
