import type { ToolHandlerFn } from "@/types";
import { cell, findTab, readTabs, type CheckResult } from "../../lib/shared.ts";

type Input = { unitNumber: string; component: string; failureDate: string; mileage: number };

const DUPLICATE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCMonth() === Number(match[2]) - 1 ? date : null;
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function wholeMonthsBetween(start: Date, end: Date): number {
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (addMonths(start, months) > end) months -= 1;
  return months;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export default (async ({ input, ctx }) => {
  const base = { unitNumber: input.unitNumber.trim().toUpperCase(), component: input.component, failureDate: input.failureDate.trim(), mileage: input.mileage };
  const finish = async (result: CheckResult) => {
    await ctx.store.set("check", result);
    return result;
  };

  const failure = parseDate(input.failureDate);
  if (!failure) return finish({ ...base, status: "invalid_input", reason: "The failure date is not a valid YYYY-MM-DD date." });
  if (failure.getTime() > Date.now()) return finish({ ...base, status: "invalid_input", reason: "The failure date is in the future." });
  if (!Number.isFinite(input.mileage) || input.mileage < 0) return finish({ ...base, status: "invalid_input", reason: "The mileage is not a valid number of miles." });

  const tabs = await readTabs(ctx);
  const unit = findTab(tabs, "Units").rows.find((row) => same(cell(row, "Unit"), base.unitNumber));
  if (!unit) return finish({ ...base, status: "unit_not_found", reason: `Unit ${base.unitNumber} is not in the fleet records.` });

  const make = cell(unit, "Make");
  const model = cell(unit, "Model");
  const modelYear = Number(cell(unit, "Model Year"));
  const inServiceDate = cell(unit, "In-Service Date");
  const inService = parseDate(inServiceDate);
  if (!inService || !Number.isInteger(modelYear)) throw new Error(`Unit ${base.unitNumber} has an invalid model year or in-service date in the sheet.`);
  const vehicle = { ...base, make, model, modelYear, inServiceDate };

  if (failure < inService) return finish({ ...vehicle, status: "invalid_input", reason: `The failure date is before the unit's in-service date of ${inServiceDate}.` });

  const terms = findTab(tabs, "Warranty Terms").rows.find((row) =>
    same(cell(row, "Make"), make) && same(cell(row, "Model"), model) && same(cell(row, "Component"), input.component) &&
    Number(cell(row, "Year From")) <= modelYear && modelYear <= Number(cell(row, "Year To")));
  if (!terms) return finish({ ...vehicle, status: "no_matching_terms", reason: `There are no ${input.component} warranty terms for a ${modelYear} ${make} ${model}.` });

  const coverageMonths = Number(cell(terms, "Months"));
  const coverageMiles = Number(cell(terms, "Miles"));
  const coverageEnd = addMonths(inService, coverageMonths);
  const coverage = { ...vehicle, coverageMonths, coverageMiles, coverageEndDate: isoDate(coverageEnd), monthsInService: wholeMonthsBetween(inService, failure) };

  if (failure > coverageEnd) return finish({ ...coverage, status: "not_covered", reason: `The ${coverageMonths}-month coverage ended on ${isoDate(coverageEnd)}.` });
  if (input.mileage > coverageMiles) return finish({ ...coverage, status: "not_covered", reason: `The mileage of ${input.mileage} is over the ${coverageMiles}-mile limit.` });

  const duplicate = findTab(tabs, "Claims").rows.find((row) => {
    const earlier = parseDate(cell(row, "Failure Date"));
    return same(cell(row, "Status"), "Submitted") && same(cell(row, "Unit"), base.unitNumber) && same(cell(row, "Component"), input.component) &&
      earlier !== null && Math.abs(failure.getTime() - earlier.getTime()) <= DUPLICATE_WINDOW_DAYS * DAY_MS;
  });
  if (duplicate) {
    const existingClaimId = cell(duplicate, "Claim ID");
    return finish({ ...coverage, status: "duplicate", existingClaimId, reason: `Claim ${existingClaimId} already covers this unit and component within ${DUPLICATE_WINDOW_DAYS} days.` });
  }

  return finish({ ...coverage, status: "covered", reason: `Within ${coverageMonths} months and ${coverageMiles} miles.` });
}) satisfies ToolHandlerFn<Input>;
