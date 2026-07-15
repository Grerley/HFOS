"""Domain enumerations. Kept as plain str constants stored as VARCHAR for portability."""
from __future__ import annotations

import enum


class Role(str, enum.Enum):
    OWNER = "owner"
    PARTNER = "partner"
    ADMIN = "admin"
    ADVISOR = "advisor"
    VIEWER = "viewer"
    CHILD = "child"


# Roles permitted to mutate financial data.
WRITE_ROLES = {Role.OWNER.value, Role.PARTNER.value, Role.ADMIN.value}
# Roles permitted to administer configuration (categories, members, roles).
ADMIN_ROLES = {Role.OWNER.value, Role.ADMIN.value}


class CategoryType(str, enum.Enum):
    INCOME = "income"
    EXPENSE = "expense"
    SAVING = "saving"
    INVESTMENT = "investment"
    TRANSFER = "transfer"


# Category types that count as budgeted outflows (contribute to total expenses).
OUTFLOW_TYPES = {
    CategoryType.EXPENSE.value,
    CategoryType.SAVING.value,
    CategoryType.INVESTMENT.value,
}
# Category types that count towards the savings rate numerator.
SAVINGS_TYPES = {CategoryType.SAVING.value, CategoryType.INVESTMENT.value}


class AccountType(str, enum.Enum):
    BANK = "bank"
    CASH = "cash"
    INVESTMENT = "investment"
    LOAN = "loan"
    CREDIT_CARD = "credit_card"
    BOND = "bond"
    SAVINGS_POCKET = "savings_pocket"


class PeriodStatus(str, enum.Enum):
    DRAFT = "draft"
    PLANNED = "planned"
    APPROVED = "approved"
    ACTIVE = "active"
    CLOSED = "closed"
    ARCHIVED = "archived"


# Statuses in which lines may be freely edited without an audit-tracked override.
EDITABLE_STATUSES = {
    PeriodStatus.DRAFT.value,
    PeriodStatus.PLANNED.value,
    PeriodStatus.APPROVED.value,
    PeriodStatus.ACTIVE.value,
}
LOCKED_STATUSES = {PeriodStatus.CLOSED.value, PeriodStatus.ARCHIVED.value}


class PaymentStatus(str, enum.Enum):
    PLANNED = "planned"
    UNPAID = "unpaid"
    PAID = "paid"


class RecurrenceFrequency(str, enum.Enum):
    ONCE = "once"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"


class SplitMethod(str, enum.Enum):
    FIXED = "fixed"
    PERCENTAGE = "percentage"


class RentalStatus(str, enum.Enum):
    OWNER_OCCUPIED = "owner_occupied"
    RENTED = "rented"
    VACANT = "vacant"
    ACQUISITION_TARGET = "acquisition_target"


class GoalStatus(str, enum.Enum):
    ACTIVE = "active"
    ACHIEVED = "achieved"
    PAUSED = "paused"
    ARCHIVED = "archived"


class InsightSeverity(str, enum.Enum):
    INFO = "info"
    OPPORTUNITY = "opportunity"
    WARNING = "warning"
    CRITICAL = "critical"


class InsightStatus(str, enum.Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    DISMISSED = "dismissed"


class TransactionSource(str, enum.Enum):
    MANUAL = "manual"
    CSV_IMPORT = "csv_import"
    BANK_SYNC = "bank_sync"
    WORKBOOK_IMPORT = "workbook_import"
