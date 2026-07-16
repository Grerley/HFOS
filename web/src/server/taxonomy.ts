import { CategoryType } from "../lib/enums";

// Default household category template (workbook Appendix A). Editable config, not logic.
export const DEFAULT_TAXONOMY: [string, string, string[]][] = [
  ["Income", CategoryType.INCOME, ["Monthly salary", "Business income", "Reimbursements / refunds", "Bonus", "Rental income", "Transfer from savings"]],
  ["Mandatory Obligations", CategoryType.EXPENSE, ["Bond", "Utilities (water, electricity, gas)", "Vehicle / transport", "Security", "Internet", "Phone", "Domestic worker", "Bank charges", "School fees", "Children activities"]],
  ["Insurance", CategoryType.EXPENSE, ["Car insurance", "Home contents", "Medical aid", "Life insurance", "Liability insurance", "Funeral policy"]],
  ["Living Expenses", CategoryType.EXPENSE, ["Groceries", "Subscriptions", "Fuel", "Entertainment", "Family support", "Credit accounts", "Professional fees"]],
  ["Property Shortfalls", CategoryType.EXPENSE, ["Property monthly funding gap", "Property utilities", "Property maintenance"]],
  ["Savings & Investments", CategoryType.SAVING, ["Retirement", "Trust fund", "College fund", "Emergency fund", "Short-term tax savings", "Long-term tax savings", "Investment platform", "Property fund"]],
  ["Ad hoc Expenses", CategoryType.EXPENSE, ["Advances", "Uniforms", "Once-off travel", "Holiday clothes"]],
  ["Discretionary", CategoryType.EXPENSE, ["Tithe", "Credit card", "Children clothing", "Allowances"]],
];
