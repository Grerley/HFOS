/**
 * Account data-rights operations (POPIA / GDPR): export a household's data and
 * delete a user account, cascade-purging any household left with no members.
 * All operations are scoped and destructive-delete is guarded at the route.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  accountBalances, accounts, auditEvents, budgetLineAllocations, budgetLines, budgetPeriods,
  categories, copilotMessages, expenseComments, goalFundings, goals, householdMembers, households,
  insights, invites, memberships, passwordResetTokens, paymentRecords, properties, propertyCashFlows,
  scenarios, telegramLinkCodes, telegramLinks, transactions, users,
} from "../db/schema";

const ids = <T extends { id: number }>(rows: T[]) => rows.map((r) => r.id);

/** Full export of one household's data as a plain JSON-serialisable object. */
export async function exportHousehold(db: DB, householdId: number) {
  const w = eq;
  const [household] = await db.select().from(households).where(w(households.id, householdId));
  const members = await db.select().from(householdMembers).where(w(householdMembers.household_id, householdId));
  const accts = await db.select().from(accounts).where(w(accounts.household_id, householdId));
  const balances = accts.length ? await db.select().from(accountBalances).where(inArray(accountBalances.account_id, ids(accts))) : [];
  const periods = await db.select().from(budgetPeriods).where(w(budgetPeriods.household_id, householdId));
  const lines = await db.select().from(budgetLines).where(w(budgetLines.household_id, householdId));
  const props = await db.select().from(properties).where(w(properties.household_id, householdId));
  const goalRows = await db.select().from(goals).where(w(goals.household_id, householdId));
  return {
    exported_at_unix: null, // stamped by the caller (Date is unavailable here for determinism)
    household,
    members,
    accounts: accts,
    account_balances: balances,
    categories: await db.select().from(categories).where(w(categories.household_id, householdId)),
    budget_periods: periods,
    budget_lines: lines,
    transactions: await db.select().from(transactions).where(w(transactions.household_id, householdId)),
    payment_records: await db.select().from(paymentRecords).where(w(paymentRecords.household_id, householdId)),
    properties: props,
    property_cash_flows: props.length ? await db.select().from(propertyCashFlows).where(inArray(propertyCashFlows.property_id, ids(props))) : [],
    goals: goalRows,
    goal_fundings: goalRows.length ? await db.select().from(goalFundings).where(inArray(goalFundings.goal_id, ids(goalRows))) : [],
    scenarios: await db.select().from(scenarios).where(w(scenarios.household_id, householdId)),
    insights: await db.select().from(insights).where(w(insights.household_id, householdId)),
  };
}

/** Permanently delete every row belonging to a household. */
export async function deleteHouseholdCascade(db: DB, householdId: number): Promise<void> {
  const accts = await db.select().from(accounts).where(eq(accounts.household_id, householdId));
  const lineRows = await db.select().from(budgetLines).where(eq(budgetLines.household_id, householdId));
  const propRows = await db.select().from(properties).where(eq(properties.household_id, householdId));
  const goalRows = await db.select().from(goals).where(eq(goals.household_id, householdId));

  if (accts.length) await db.delete(accountBalances).where(inArray(accountBalances.account_id, ids(accts)));
  if (lineRows.length) await db.delete(budgetLineAllocations).where(inArray(budgetLineAllocations.line_id, ids(lineRows)));
  if (propRows.length) await db.delete(propertyCashFlows).where(inArray(propertyCashFlows.property_id, ids(propRows)));
  if (goalRows.length) await db.delete(goalFundings).where(inArray(goalFundings.goal_id, ids(goalRows)));

  const byHh = [
    budgetLines, paymentRecords, expenseComments, transactions, budgetPeriods, categories,
    accounts, properties, goals, scenarios, insights, auditEvents, telegramLinks, telegramLinkCodes,
    copilotMessages, invites, householdMembers, memberships,
  ];
  for (const t of byHh) await db.delete(t).where(eq((t as any).household_id, householdId));
  await db.delete(households).where(eq(households.id, householdId));
}

/**
 * Delete a user account. Removes the user from every household; any household
 * that then has no remaining login members is cascade-purged. Personal tokens
 * and links are cleared, then the user row is deleted.
 */
export async function deleteUserAccount(db: DB, userId: number): Promise<void> {
  const mems = await db.select().from(memberships).where(eq(memberships.user_id, userId));
  for (const m of mems) {
    await db.delete(householdMembers).where(and(eq(householdMembers.household_id, m.household_id), eq(householdMembers.user_id, userId)));
    await db.delete(memberships).where(and(eq(memberships.household_id, m.household_id), eq(memberships.user_id, userId)));
    const remaining = await db.select().from(memberships).where(eq(memberships.household_id, m.household_id));
    if (remaining.length === 0) await deleteHouseholdCascade(db, m.household_id);
  }
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.user_id, userId));
  await db.delete(telegramLinks).where(eq(telegramLinks.user_id, userId));
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.user_id, userId));
  await db.delete(users).where(eq(users.id, userId));
}
