# HFOS data model

Sixteen core entities. Tenant key is `household_id` on every household-scoped table.
Money columns are integer minor units (suffix `_cents`). Source: `backend/app/models/`.

## Identity & tenancy

- **User** — `id, name, email (unique), phone, password_hash (bcrypt), is_active`.
- **Household** — `id, name, base_currency, country, budget_cycle_day, created_by_id`.
- **HouseholdMember** — `id, household_id, user_id?, name, relationship_label, role, is_active`.
  A member may be a login user or a planning-only entity (child, dependant, beneficiary).
- **Membership** — `id, user_id, household_id, role` (unique per user+household). The RBAC grant.

## Accounts

- **Account** — `id, household_id, name, type, institution, owner_member_id?, currency,
  current_balance_cents, balance_date, is_manual, is_active`.
- **AccountBalance** — `id, account_id, as_of, balance_cents`. Dated history; net worth uses
  the latest dated value per account.

## Budget

- **Category** — `id, household_id, parent_id?, name, type
  (income|expense|saving|investment|transfer), default_owner_member_id?, sort_order,
  is_section, is_active`.
- **BudgetPeriod** — `id, household_id, label, start_date, end_date, status, locked_at?,
  approved_at?, source, notes`.
- **BudgetLine** — `id, period_id, household_id, category_id, item_name, owner_member_id?,
  payer_member_id?, beneficiary_member_id?, planned_amount_cents, actual_amount_cents,
  due_day?, due_note?, recurrence, payment_status, is_recurring, priority, sort_order, notes,
  source_ref?, needs_review`.
- **BudgetLineAllocation** — `id, line_id, member_id, method (fixed|percentage),
  amount_cents, percent_bp`. Per-owner split; percentage in basis points.
- **Transaction** — `id, household_id, account_id?, date, description, merchant?,
  amount_cents (signed), category_id?, budget_line_id?, is_transfer, transfer_account_id?,
  source, confidence_bp?, notes`.

## Property

- **Property** — `id, household_id, name, address_label?, ownership_share_bp,
  market_value_cents, valuation_date?, outstanding_bond_cents, bond_account_id?,
  rental_status, notes`.
- **PropertyCashFlow** — `id, property_id, period_id?, label?, rent_cents, bond_cents,
  levies_cents, rates_cents, utilities_cents, insurance_cents, maintenance_cents,
  agent_fees_cents, vacancy_cents, other_cents`.

## Planning

- **Goal** — `id, household_id, name, goal_type?, target_amount_cents, current_amount_cents,
  target_date?, monthly_contribution_cents, owner_member_id?, priority, status,
  linked_account_id?, notes`.
- **GoalFunding** — `id, goal_id, source, amount_cents, expected_date?, probability_bp`.
- **Scenario** — `id, household_id, base_period_id?, name, description?, assumptions_json,
  projected_results_json, schema_version, created_by_id?`.
- **Insight** — `id, household_id, period_id?, type, severity, summary, explanation?, action?,
  status, evidence_json`. `evidence_json` holds the exact calc-engine figures cited.

## Audit

- **AuditEvent** — `id, household_id?, actor_user_id?, action, entity_type, entity_id?,
  before_hash, after_hash, detail_json, ip_metadata, created_at`. Immutable; sensitive
  before/after states are hashed, not stored in the clear.

## Relationships (summary)

```
User 1─* Membership *─1 Household 1─* HouseholdMember
Household 1─* Category (self-referential parent_id)
Household 1─* BudgetPeriod 1─* BudgetLine 1─* BudgetLineAllocation
BudgetLine *─1 Category ;  Transaction *─1 BudgetLine
Household 1─* Property 1─* PropertyCashFlow
Household 1─* Goal 1─* GoalFunding ;  Household 1─* Scenario ;  Household 1─* Insight
```

## Migrations

The schema's source of truth is the SQLAlchemy models. For dev/SQLite, `create_all()` runs on
startup (`HFOS_AUTO_CREATE_TABLES=true`) and the seed script calls it directly. For production
on PostgreSQL, generate a versioned migration with Alembic (already a dependency):

```bash
cd backend
alembic init alembic          # first time only, then point env.py at Base.metadata
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```
