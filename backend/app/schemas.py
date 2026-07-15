"""Pydantic v2 request/response schemas.

Money crosses the API as integer minor units in `*_cents` fields, preserving the
exact-cents contract end to end; the frontend formats at the presentation edge.
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

ORM = ConfigDict(from_attributes=True)


# ── Auth ──────────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = None
    household_name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"
    households: list["HouseholdOut"] = []


class UserOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    email: EmailStr
    phone: str | None = None
    is_active: bool


# ── Household & members ─────────────────────────────────────────────────────
class HouseholdCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    base_currency: str = "ZAR"
    country: str = "ZA"
    budget_cycle_day: int = Field(default=1, ge=1, le=31)


class HouseholdOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    base_currency: str
    country: str
    budget_cycle_day: int
    role: str | None = None  # the requesting user's role, populated at the edge


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    relationship_label: str | None = None
    role: str = "partner"
    user_email: EmailStr | None = None  # optional: link/create a login user


class MemberOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    relationship_label: str | None = None
    role: str
    user_id: int | None = None
    is_active: bool


class InviteRequest(BaseModel):
    email: EmailStr
    name: str
    role: str = "partner"
    password: str = Field(min_length=8, max_length=128)


# ── Accounts ────────────────────────────────────────────────────────────────
class AccountCreate(BaseModel):
    name: str
    type: str
    institution: str | None = None
    owner_member_id: int | None = None
    currency: str = "ZAR"
    current_balance_cents: int = 0
    balance_date: date | None = None
    is_manual: bool = True


class AccountOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    type: str
    institution: str | None = None
    owner_member_id: int | None = None
    currency: str
    current_balance_cents: int
    balance_date: date | None = None
    is_active: bool


class BalanceCreate(BaseModel):
    as_of: date
    balance_cents: int


# ── Categories ──────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    name: str
    type: str
    parent_id: int | None = None
    default_owner_member_id: int | None = None
    sort_order: int = 0
    is_section: bool = False


class CategoryOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    type: str
    parent_id: int | None = None
    default_owner_member_id: int | None = None
    sort_order: int
    is_section: bool
    is_active: bool


# ── Budget periods & lines ──────────────────────────────────────────────────
class PeriodCreate(BaseModel):
    label: str
    start_date: date
    end_date: date
    status: str = "draft"
    notes: str | None = None


class PeriodDuplicate(BaseModel):
    label: str
    start_date: date
    end_date: date
    copy_ad_hoc: bool = False  # ad-hoc (non-recurring) lines copied only if requested


class PeriodStatusUpdate(BaseModel):
    status: str


class PeriodOut(BaseModel):
    model_config = ORM
    id: int
    label: str
    start_date: date
    end_date: date
    status: str
    source: str | None = None
    notes: str | None = None


class AllocationIn(BaseModel):
    member_id: int
    method: str = "fixed"
    amount_cents: int = 0
    percent_bp: int = 0


class LineCreate(BaseModel):
    category_id: int
    item_name: str
    owner_member_id: int | None = None
    payer_member_id: int | None = None
    beneficiary_member_id: int | None = None
    planned_amount_cents: int = 0
    actual_amount_cents: int = 0
    due_day: int | None = Field(default=None, ge=1, le=31)
    due_note: str | None = None
    recurrence: str = "monthly"
    payment_status: str = "planned"
    is_recurring: bool = True
    priority: int = 3
    notes: str | None = None
    allocations: list[AllocationIn] = []


class LineUpdate(BaseModel):
    category_id: int | None = None
    item_name: str | None = None
    owner_member_id: int | None = None
    payer_member_id: int | None = None
    beneficiary_member_id: int | None = None
    planned_amount_cents: int | None = None
    actual_amount_cents: int | None = None
    due_day: int | None = Field(default=None, ge=1, le=31)
    due_note: str | None = None
    recurrence: str | None = None
    payment_status: str | None = None
    is_recurring: bool | None = None
    priority: int | None = None
    notes: str | None = None
    allocations: list[AllocationIn] | None = None


class LineOut(BaseModel):
    model_config = ORM
    id: int
    period_id: int
    category_id: int
    item_name: str
    owner_member_id: int | None = None
    payer_member_id: int | None = None
    beneficiary_member_id: int | None = None
    planned_amount_cents: int
    actual_amount_cents: int
    due_day: int | None = None
    due_note: str | None = None
    recurrence: str
    payment_status: str
    is_recurring: bool
    priority: int
    notes: str | None = None
    needs_review: bool
    source_ref: str | None = None


class BatchLineUpdate(BaseModel):
    """Batch save for the planner grid (Appendix B: avoid excessive API calls)."""

    creates: list[LineCreate] = []
    updates: dict[int, LineUpdate] = {}
    deletes: list[int] = []


# ── Transactions ────────────────────────────────────────────────────────────
class TransactionCreate(BaseModel):
    date: date
    description: str
    amount_cents: int
    account_id: int | None = None
    category_id: int | None = None
    budget_line_id: int | None = None
    merchant: str | None = None
    is_transfer: bool = False
    transfer_account_id: int | None = None
    notes: str | None = None


class TransactionOut(BaseModel):
    model_config = ORM
    id: int
    date: date
    description: str
    amount_cents: int
    account_id: int | None = None
    category_id: int | None = None
    budget_line_id: int | None = None
    merchant: str | None = None
    is_transfer: bool
    source: str


# ── Property ────────────────────────────────────────────────────────────────
class PropertyCreate(BaseModel):
    name: str
    address_label: str | None = None
    ownership_share_bp: int = 10000
    market_value_cents: int = 0
    valuation_date: date | None = None
    outstanding_bond_cents: int = 0
    bond_account_id: int | None = None
    rental_status: str = "rented"
    notes: str | None = None


class PropertyOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    address_label: str | None = None
    ownership_share_bp: int
    market_value_cents: int
    outstanding_bond_cents: int
    rental_status: str
    notes: str | None = None


class CashFlowCreate(BaseModel):
    period_id: int | None = None
    label: str | None = None
    rent_cents: int = 0
    bond_cents: int = 0
    levies_cents: int = 0
    rates_cents: int = 0
    utilities_cents: int = 0
    insurance_cents: int = 0
    maintenance_cents: int = 0
    agent_fees_cents: int = 0
    vacancy_cents: int = 0
    other_cents: int = 0


class CashFlowOut(CashFlowCreate):
    model_config = ORM
    id: int
    property_id: int


# ── Goals ───────────────────────────────────────────────────────────────────
class GoalCreate(BaseModel):
    name: str
    goal_type: str | None = None
    target_amount_cents: int = 0
    current_amount_cents: int = 0
    target_date: date | None = None
    monthly_contribution_cents: int = 0
    owner_member_id: int | None = None
    priority: int = 3
    linked_account_id: int | None = None
    notes: str | None = None


class GoalOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    goal_type: str | None = None
    target_amount_cents: int
    current_amount_cents: int
    target_date: date | None = None
    monthly_contribution_cents: int
    owner_member_id: int | None = None
    priority: int
    status: str
    notes: str | None = None


# ── Scenarios ───────────────────────────────────────────────────────────────
class ScenarioCreate(BaseModel):
    name: str
    base_period_id: int | None = None
    description: str | None = None
    assumptions_json: dict = {}


class ScenarioOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    base_period_id: int | None = None
    description: str | None = None
    assumptions_json: dict
    projected_results_json: dict
    schema_version: int


# ── Insights & copilot ──────────────────────────────────────────────────────
class InsightOut(BaseModel):
    model_config = ORM
    id: int
    type: str
    severity: str
    summary: str
    explanation: str | None = None
    action: str | None = None
    status: str
    evidence_json: dict
    period_id: int | None = None
    created_at: datetime


class CopilotQuery(BaseModel):
    question: str
    period_id: int | None = None


class CopilotAnswer(BaseModel):
    answer: str
    citations: list[dict] = []
    matched_intent: str
    provider: str


TokenResponse.model_rebuild()
