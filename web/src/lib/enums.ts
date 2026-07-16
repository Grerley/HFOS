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
