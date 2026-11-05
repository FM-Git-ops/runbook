import type { ToolHandlerFn } from "@/types";
import { SHEET_URL, findTab, getThread, postForReview, readTabs, safeCell, type CheckResult } from "../../lib/shared.ts";

type Input = { status: string; reason: string; unitNumber: string; component: string; failureDescription: string };

// A status must agree with the check, so a note can't get a valid claim logged as denied.
function allowedStatuses(check: CheckResult | null | undefined): string[] {
  if (!check) return ["Needs review"];
  switch (check.status) {
    case "covered": return ["Rejected"];
    case "not_covered":
    case "no_matching_terms": return ["Not covered"];
    case "duplicate": return ["Duplicate"];
    default: return ["Needs review"];
  }
}

export default (async ({ input, ctx }) => {
  if (await ctx.store.get<{ claimId: string }>("filed")) throw new Error("A claim was already filed in this run.");
  const logged = await ctx.store.get<{ logId: string }>("logged");
  if (logged) return { status: "already_logged", logId: logged.logId };

  const check = await ctx.store.get<CheckResult>("check");
  const allowed = allowedStatuses(check);
  if (!allowed.includes(input.status)) {
    throw new Error(`Status "${input.status}" doesn't match the coverage check. Allowed: ${allowed.join(", ")}.`);
  }

  let pending = await ctx.store.get<{ logId: string }>("pending_log");
  if (!pending) {
    pending = { logId: `WL-${Date.now().toString(36).toUpperCase()}` };
    await ctx.store.set("pending_log", pending);
  }

  // Denials record the check's own reason and facts. Only rejections and reviews use the agent's wording.
  const fromCheck = input.status === "Not covered" || input.status === "Duplicate";
  const reason = fromCheck && check ? check.reason : safeCell(input.reason);

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
        "Unit": check?.unitNumber ?? safeCell(input.unitNumber),
        "Make": check?.make ?? "",
        "Model": check?.model ?? "",
        "Model Year": String(check?.modelYear ?? ""),
        "Component": check?.component ?? safeCell(input.component),
        "Failure Date": check?.failureDate ?? "",
        "Mileage": check ? String(check.mileage) : "",
        "Failure Description": safeCell(input.failureDescription),
        "Reason": reason,
        "Technician": safeCell(thread.technician),
        "Logged At": new Date().toISOString(),
      },
    },
  });

  if (input.status === "Needs review") {
    await postForReview(ctx, thread, `${input.unitNumber || "Unknown unit"}: ${reason}`);
  }

  await ctx.store.set("logged", pending);
  await ctx.setOutcome("disqualified", { note: `${input.status}: ${reason}`.slice(0, 200) });
  return { status: "logged", logId: pending.logId };
}) satisfies ToolHandlerFn<Input>;
