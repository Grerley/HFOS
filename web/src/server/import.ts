/** Excel workbook import — SheetJS port of the Python importer.
 * Classifies sheets, parses monthly budgets, maps owners/sections, imports
 * idempotently, and returns a reconciliation report + review queue. */
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { budgetLines, budgetPeriods, categories, householdMembers } from "../db/schema";
import { CategoryType } from "../lib/enums";
import * as calc from "../lib/calc";
import { loadLinesForCalc, recordAudit } from "./services";

const SECTION_MAP: Record<string, [string, string]> = {
  "total income": ["Income", CategoryType.INCOME],
  "mandatory obligations": ["Mandatory Obligations", CategoryType.EXPENSE],
  insurance: ["Insurance", CategoryType.EXPENSE],
  "living expenses": ["Living Expenses", CategoryType.EXPENSE],
  "property shortfalls": ["Property Shortfalls", CategoryType.EXPENSE],
  "savings & investments": ["Savings & Investments", CategoryType.SAVING],
  "ad-hoc expenses": ["Ad hoc Expenses", CategoryType.EXPENSE],
  "ad hoc expenses": ["Ad hoc Expenses", CategoryType.EXPENSE],
  discretionary: ["Discretionary", CategoryType.EXPENSE],
};
const SUMMARY_ROWS = new Set(["total income", "total expenses", "nett", "net"]);
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

type WS = XLSX.WorkSheet;

function cell(ws: WS, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return ws[addr]?.v;
}
function maxRow(ws: WS): number {
  if (!ws["!ref"]) return 0;
  return XLSX.utils.decode_range(ws["!ref"]).e.r + 1;
}
function toCents(v: unknown): number | null {
  if (typeof v === "number") return Math.round(v * 100);
  return null;
}

export function classifySheet(name: string, ws: WS): [string, number] {
  const n = name.toLowerCase();
  if (/scenario|retirement|frontier|bryanston/.test(n)) return ["scenario", 0.9];
  if (/owed/.test(n)) return ["receivables", 0.9];
  if (/bonus/.test(n)) return ["bonus", 0.9];
  if (/carsale|car sale/.test(n)) return ["asset_sale", 0.8];
  if (/^[a-z]{3}4[a-z]{3}/.test(n)) return ["monthly", 0.95];
  for (let r = 1; r <= 6; r++) {
    const v = cell(ws, r, 1);
    if (typeof v === "string" && v.toLowerCase().includes("total income")) return ["monthly", 0.7];
  }
  return ["other", 0.3];
}

export function parseMonthDates(label: string): [string, string] | null {
  const m = label.toLowerCase().match(/^([a-z]{3})4([a-z]{3})/);
  if (!m) return null;
  const sm = MONTHS[m[1]];
  const em = MONTHS[m[2]];
  if (!sm || !em) return null;
  const yr = label.match(/20\d{2}|\b\d{2}\b/);
  let year = 2025;
  if (yr) {
    const y = parseInt(yr[0], 10);
    year = y > 100 ? y : 2000 + y;
  }
  const endYear = em < sm ? year + 1 : year;
  const lastDay = new Date(endYear, em, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [`${year}-${pad(sm)}-01`, `${endYear}-${pad(em)}-${pad(lastDay)}`];
}

interface ParsedLine {
  raw_name: string;
  due_note: string | null;
  amounts: Record<string, number>;
  total_cents: number;
  cell: string;
}
interface ParsedSection {
  mapped: [string, string];
  lines: ParsedLine[];
}

export function parseMonthlySheet(ws: WS) {
  const owners: [number, string][] = [];
  let headerRow = 1;
  for (let r = 1; r <= 3; r++) {
    const vals = [3, 4, 5, 6].map((c) => cell(ws, r, c));
    if (vals.some((v) => typeof v === "string" && v.trim())) {
      headerRow = r;
      for (let c = 3; c <= 6; c++) {
        const v = cell(ws, r, c);
        if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "total") owners.push([c, v.trim()]);
      }
      break;
    }
  }

  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  const reconciliation: { total_income: number | null; total_expenses: number | null; nett: number | null } = {
    total_income: null,
    total_expenses: null,
    nett: null,
  };

  for (let r = headerRow + 1; r <= maxRow(ws); r++) {
    const label = cell(ws, r, 1);
    if (typeof label !== "string" || !label.trim()) continue;
    const key = label.trim().toLowerCase();
    const total = toCents(cell(ws, r, 6));

    if (SUMMARY_ROWS.has(key)) {
      if (key === "total income" && total != null && reconciliation.total_income == null) reconciliation.total_income = total;
      else if (key === "total expenses" && total != null) reconciliation.total_expenses = total;
      else if ((key === "nett" || key === "net") && total != null) reconciliation.nett = total;
      continue;
    }

    const matched = Object.keys(SECTION_MAP).find((k) => key.startsWith(k));
    if (matched) {
      current = { mapped: SECTION_MAP[matched], lines: [] };
      sections.push(current);
      continue;
    }

    const dueNote = cell(ws, r, 2);
    const amounts: Record<string, number> = {};
    for (const [col, ownerName] of owners) {
      const cents = toCents(cell(ws, r, col));
      if (cents) amounts[ownerName] = cents;
    }
    const line: ParsedLine = {
      raw_name: label.trim(),
      due_note: typeof dueNote === "string" ? dueNote : null,
      amounts,
      total_cents: total ?? Object.values(amounts).reduce((s, v) => s + v, 0),
      cell: `A${r}`,
    };
    if (!current) {
      current = { mapped: ["Income", CategoryType.INCOME], lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }

  return { owners: owners.map((o) => o[1]), sections, reconciliation };
}

export function analyzeWorkbook(bytes: ArrayBuffer) {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheets: any[] = [];
  const owners = new Set<string>();
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const [kind, confidence] = classifySheet(name, ws);
    const entry: any = { sheet: name, kind, confidence };
    if (kind === "monthly") {
      const parsed = parseMonthlySheet(ws);
      parsed.owners.forEach((o) => owners.add(o));
      entry.owners = parsed.owners;
      entry.line_count = parsed.sections.reduce((s, sec) => s + sec.lines.length, 0);
      const d = parseMonthDates(name);
      entry.dates = d ? { start: d[0], end: d[1] } : null;
    }
    sheets.push(entry);
  }
  return { sheets, detected_owners: [...owners].sort() };
}

export async function importWorkbook(
  db: DB,
  householdId: number,
  bytes: ArrayBuffer,
  actorUserId: number,
) {
  const wb = XLSX.read(bytes, { type: "array" });

  const catRows = await db.select().from(categories).where(eq(categories.household_id, householdId));
  const catByName = new Map(catRows.map((c) => [c.name.toLowerCase(), c]));
  const memberRows = await db.select().from(householdMembers).where(eq(householdMembers.household_id, householdId));
  const memberByName = new Map(memberRows.map((m) => [m.name.toLowerCase(), m]));

  const report: any = {
    periods_imported: 0,
    periods_skipped: 0,
    lines_imported: 0,
    rows_skipped_empty: 0,
    review_queue: [] as any[],
    reconciliation: [] as any[],
    sheets: [] as any[],
  };

  async function resolveMember(name: string): Promise<number> {
    const m = memberByName.get(name.toLowerCase());
    if (m) return m.id;
    const [created] = await db
      .insert(householdMembers)
      .values({ household_id: householdId, name, relationship_label: "imported", role: "partner" })
      .returning();
    memberByName.set(name.toLowerCase(), created);
    return created.id;
  }
  async function resolveCategory(sectionName: string, ctype: string): Promise<number> {
    const c = catByName.get(sectionName.toLowerCase());
    if (c) return c.id;
    const [created] = await db
      .insert(categories)
      .values({ household_id: householdId, name: sectionName, type: ctype, is_section: true })
      .returning();
    catByName.set(sectionName.toLowerCase(), created);
    return created.id;
  }

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const [kind] = classifySheet(name, ws);
    if (kind !== "monthly") {
      report.sheets.push({ sheet: name, kind, status: "not_imported" });
      continue;
    }
    const dates = parseMonthDates(name);
    if (!dates) {
      report.review_queue.push({ sheet: name, reason: "could_not_map_dates", action: "confirm period dates" });
      report.sheets.push({ sheet: name, kind, status: "needs_date_mapping" });
      continue;
    }
    const existing = await db
      .select()
      .from(budgetPeriods)
      .where(and(eq(budgetPeriods.household_id, householdId), eq(budgetPeriods.label, name)));
    if (existing.length) {
      report.periods_skipped++;
      report.sheets.push({ sheet: name, kind, status: "already_imported" });
      continue;
    }

    const parsed = parseMonthlySheet(ws);
    const [period] = await db
      .insert(budgetPeriods)
      .values({ household_id: householdId, label: name, start_date: dates[0], end_date: dates[1], status: "closed", source: "workbook_import" })
      .returning();

    let lineCount = 0;
    for (const section of parsed.sections) {
      const [mappedName, ctype] = section.mapped;
      const categoryId = await resolveCategory(mappedName, ctype);
      for (const line of section.lines) {
        if (Object.keys(line.amounts).length === 0 && !line.total_cents) report.rows_skipped_empty++;
        let ownerId: number | null = null;
        const owners = Object.keys(line.amounts);
        if (owners.length) {
          const top = owners.reduce((a, b) => (line.amounts[a] >= line.amounts[b] ? a : b));
          ownerId = await resolveMember(top);
        }
        await db.insert(budgetLines).values({
          period_id: period.id,
          household_id: householdId,
          category_id: categoryId,
          item_name: line.raw_name,
          owner_member_id: ownerId,
          planned_amount_cents: line.total_cents || 0,
          actual_amount_cents: 0,
          due_note: line.due_note,
          recurrence: "monthly",
          payment_status: "planned",
          source_ref: `workbook:${name}!${line.cell}`,
          needs_review: (line.total_cents || 0) === 0,
        });
        lineCount++;
      }
    }

    const calcLines = await loadLinesForCalc(db, householdId, period.id);
    report.reconciliation.push({
      sheet: name,
      workbook_total_income_cents: parsed.reconciliation.total_income,
      imported_total_income_cents: calc.totalIncome(calcLines),
      workbook_total_expenses_cents: parsed.reconciliation.total_expenses,
      imported_total_expenses_cents: calc.totalExpenses(calcLines),
    });
    report.periods_imported++;
    report.lines_imported += lineCount;
    report.sheets.push({ sheet: name, kind, status: "imported", lines: lineCount });
  }

  await recordAudit(db, {
    action: "workbook.import",
    entity_type: "household",
    entity_id: householdId,
    household_id: householdId,
    actor_user_id: actorUserId,
    detail: { periods_imported: report.periods_imported, periods_skipped: report.periods_skipped, lines_imported: report.lines_imported },
  });
  return report;
}
