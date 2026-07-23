# HFOS API reference

Base URL (dev): `http://localhost:8000` · Interactive OpenAPI docs: `/docs` · Schema: `/openapi.json`

## Conventions

- **Auth:** `Authorization: Bearer <jwt>` on all endpoints except `/auth/*` and `/health`.
- **Tenant:** `X-Household-Id: <id>` selects the active household. Omitted → the user's first
  household. Requests to a household the user isn't a member of return `403`.
- **Money:** all amounts are integer **minor units** in `*_cents` fields.
- **RBAC:** `owner`/`partner`/`admin` may write; `viewer`/`advisor` are read-only; `owner`/`admin`
  administer configuration. Enforced server-side (`403` on violation).

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{name,email,password,household_name?}` → token + provisions a household |
| POST | `/auth/login` | OAuth2 form (`username`=email, `password`) |
| POST | `/auth/login/json` | `{email,password}` → token |
| GET | `/auth/me` | current user + households |

## Households & members

| Method | Path | Notes |
|---|---|---|
| POST | `/households` | create household with default taxonomy + member + account |
| GET | `/households` | list the user's households (with role) |
| GET | `/members` | list household members |
| POST | `/members` | add a member (login-optional) — admin only |
| POST | `/members/invite` | invite a login partner with a role — admin only |

## Configuration

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/accounts` | list / create accounts |
| POST | `/accounts/{id}/balances` | add a dated balance (latest becomes current) |
| GET/POST | `/categories` | list / create categories |

## Budget periods & lines

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/budget-periods` | list / create periods |
| POST | `/budget-periods/{id}/duplicate` | copy recurring lines, reset actuals |
| PATCH | `/budget-periods/{id}/status` | draft→planned→approved→active→closed→archived (locks + audit) |
| GET/POST | `/budget-periods/{id}/lines` | list / add lines |
| POST | `/budget-periods/{id}/lines/batch` | `{creates,updates,deletes}` grid save |
| PATCH/DELETE | `/budget-lines/{id}` | update / delete a line |

## Transactions

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/transactions` | list / add manual actuals (matched actuals roll into the line) |

## Property

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/properties` | list / create properties |
| POST | `/properties/{id}/cash-flows` | add a monthly cash-flow model |
| GET | `/properties/{id}/cash-flow` | surplus/shortfall + gross/net yield + LTV + equity |
| GET | `/properties-summary` | portfolio-wide monthly cash flow |

## Goals & scenarios

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/goals`, PATCH/DELETE `/goals/{id}` | goals with computed progress, amount remaining, monthly requirement & shortfall, projected finish date, and pace (on_track/behind/overdue/…) |
| GET/POST | `/scenarios` | list / create+run a scenario |
| POST | `/scenarios/{id}/run` | re-run |
| GET | `/scenarios/{id}/compare` | baseline vs projected + deltas |

### Scenario assumption keys (all optional, versioned JSON)

`income_change_pct`, `expense_change_pct`, `additional_income_cents`,
`new_monthly_expense_cents`, `savings_increase_cents`,
`new_property: {price_cents, deposit_cents, annual_rate, term_months, rent_cents}`.

## Dashboard, reports, insights, copilot

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard?period_id=` | period summary, owner cards, net worth, currency |
| GET | `/reports/monthly?period_id=` | full period summary |
| GET | `/reports/trends` | 12-month income/expense/net/savings series |
| GET | `/insights` | open insights |
| POST | `/insights/generate/{period_id}` | run rule-based anomaly/health checks |
| PATCH | `/insights/{id}/status?new_status=` | acknowledge/dismiss |
| POST | `/copilot/ask` | `{question, period_id?}` → grounded answer + citations |
| POST | `/telegram/webhook` | Telegram inbound (public; verified by `X-Telegram-Bot-Api-Secret-Token`) |
| GET | `/telegram/status` | `{configured, linked, username}` for the active household |
| POST | `/telegram/link-code` | mint a one-time code to bind a Telegram chat → `{code, deep_link?, expires_at}` |
| DELETE | `/telegram/link` | unbind the household's Telegram chat |

## Import

| Method | Path | Notes |
|---|---|---|
| POST | `/import/workbook/analyze` | multipart `file` → sheet classification + detected owners |
| POST | `/import/workbook` | multipart `file` (+ `owner_mapping` JSON) → idempotent import + reconciliation |

## Meta

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | status + `formula_version` |
