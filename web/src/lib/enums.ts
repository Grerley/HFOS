// Domain enumerations (ported from backend/app/enums.py).

export const CategoryType = {
  INCOME: "income",
  EXPENSE: "expense",
  SAVING: "saving",
  INVESTMENT: "investment",
  TRANSFER: "transfer",
} as const;
export type CategoryTypeValue = (typeof CategoryType)[keyof typeof CategoryType];

// Category types that count as budgeted outflows (contribute to total expenses).
export const OUTFLOW_TYPES = new Set<string>([
  CategoryType.EXPENSE,
  CategoryType.SAVING,
  CategoryType.INVESTMENT,
]);

// Category types that count towards the savings-rate numerator.
export const SAVINGS_TYPES = new Set<string>([CategoryType.SAVING, CategoryType.INVESTMENT]);

// How a budget line is settled. This is the source of truth on the line; the
// legacy is_debit_order / is_manual_payment / requires_confirmation booleans are
// derived from it (see derivePaymentFlags) so the settlement engine is unchanged.
export const PaymentType = {
  DEBIT_ORDER: "debit_order",
  STOP_ORDER: "stop_order",
  SALARY_DEDUCTION: "salary_deduction",
  MANUAL: "manual",
  OTHER: "other",
} as const;
export type PaymentTypeValue = (typeof PaymentType)[keyof typeof PaymentType];

export const PAYMENT_TYPES: PaymentTypeValue[] = [
  PaymentType.DEBIT_ORDER,
  PaymentType.STOP_ORDER,
  PaymentType.SALARY_DEDUCTION,
  PaymentType.MANUAL,
  PaymentType.OTHER,
];

// Automatic = money moves without the user acting, but it should be confirmed
// each month that it actually went off.
export const AUTOMATIC_PAYMENT_TYPES = new Set<string>([
  PaymentType.DEBIT_ORDER,
  PaymentType.STOP_ORDER,
  PaymentType.SALARY_DEDUCTION,
]);

export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  debit_order: "Debit order",
  stop_order: "Stop order",
  salary_deduction: "Salary deduction",
  manual: "Manual payment",
  other: "Other",
};

/** Derive the settlement booleans from a payment type (keeps the engine in sync). */
export function derivePaymentFlags(paymentType: string | null | undefined) {
  const t = paymentType ?? PaymentType.MANUAL;
  const automatic = AUTOMATIC_PAYMENT_TYPES.has(t);
  return {
    is_debit_order: automatic, // "automatic" for settlement purposes
    is_manual_payment: t === PaymentType.MANUAL,
    requires_confirmation: automatic,
  };
}

export const Role = {
  OWNER: "owner",
  PARTNER: "partner",
  ADMIN: "admin",
  ADVISOR: "advisor",
  VIEWER: "viewer",
  CHILD: "child",
} as const;

export const WRITE_ROLES = new Set<string>([Role.OWNER, Role.PARTNER, Role.ADMIN]);
export const ADMIN_ROLES = new Set<string>([Role.OWNER, Role.ADMIN]);

export const PeriodStatus = {
  DRAFT: "draft",
  PLANNED: "planned",
  APPROVED: "approved",
  ACTIVE: "active",
  CLOSED: "closed",
  ARCHIVED: "archived",
} as const;

export const EDITABLE_STATUSES = new Set<string>([
  PeriodStatus.DRAFT,
  PeriodStatus.PLANNED,
  PeriodStatus.APPROVED,
  PeriodStatus.ACTIVE,
]);
export const LOCKED_STATUSES = new Set<string>([PeriodStatus.CLOSED, PeriodStatus.ARCHIVED]);
