import type { ToolHandlerFn } from "@/types";

export type Ctx = Parameters<ToolHandlerFn<Record<string, never>>>[0]["ctx"];

export const SHEET_URL = "https://docs.google.com/spreadsheets/d/1GizNlnI3iDDiBnFkUiSANXsJgdTvWM5Equ3NLHfUSPE/edit";

type Row = Record<string, { value: string; options: string[] | null }>;
export type Tab = { name: string; gid: string; rows: Row[] };
export type Thread = { channel: string; threadTs: string; technician: string };

export type CheckResult = {
  status: "covered" | "not_covered" | "duplicate" | "unit_not_found" | "no_matching_terms" | "invalid_input";
  unitNumber: string;
  component: string;
  failureDate: string;
  mileage: number;
  reason: string;
  make?: string;
  model?: string;
  modelYear?: number;
  inServiceDate?: string;
  coverageMonths?: number;
  coverageMiles?: number;
  coverageEndDate?: string;
  monthsInService?: number;
  existingClaimId?: string;
};

export const cell = (row: Row, column: string): string => (row[column]?.value ?? "").trim();

// Text from Slack must never run as a spreadsheet formula, so a leading formula character is escaped.
export const safeCell = (value: string): string => (/^[\s]*[=+\-@]/.test(value) ? `'${value}` : value);

export async function readTabs(ctx: Ctx): Promise<Tab[]> {
  const sheet = await ctx.executeIntegration<{ tabs: Tab[] }>({
    connectionConfigId: "sheets",
    actionId: "get-rows",
    params: { sheetUrl: SHEET_URL },
  });
  return sheet.tabs;
}

export function findTab(tabs: Tab[], name: string): Tab {
  const tab = tabs.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
  if (!tab) throw new Error(`The warranty sheet has no "${name}" tab.`);
  return tab;
}

// Slack formatting, mentions and links in claim text must not reach Slack as live content.
export const plain = (value: string): string => value.replace(/[<>*_`~|]/g, " ").replace(/https?:\/\/\S+/gi, "[link removed]").trim();

// Posts at the top of the channel, so a person owns the review instead of it sitting in a thread.
export async function postForReview(ctx: Ctx, thread: Thread, note: string): Promise<void> {
  const opened = await ctx.store.get<{ permalink?: string }>("opened");
  const lines = [`**Needs review:** ${plain(note)}`];
  if (opened?.permalink) lines.push(`Thread: ${opened.permalink}`);
  const message = lines.join("\n");
  await ctx.executeIntegration<{ ok: boolean; ts: string }>({
    connectionConfigId: "slack",
    actionId: "send-message",
    params: { channel: thread.channel, text: message, markdownText: message },
  });
}

// The channel and thread come from the Slack event, so the model never copies them.
export async function getThread(ctx: Ctx): Promise<Thread> {
  const saved = await ctx.store.get<Thread>("thread");
  if (saved) return saved;
  const events = await ctx.getIntegrationEvents({ connectionConfigId: "slack", eventTypeId: "slack:message" });
  const first = events[0]?.payload as { channel?: string; ts?: string; threadTs?: string; userName?: string } | undefined;
  if (!first?.channel || !first.ts) throw new Error("No triggering Slack message in this run.");
  const thread = { channel: first.channel, threadTs: first.threadTs ?? first.ts, technician: first.userName ?? "" };
  await ctx.store.set("thread", thread);
  return thread;
}
