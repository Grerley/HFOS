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
| GET | `/scenarios/start-state` | `?base_period_id=` → the projection's starting flows + balance sheet |
| POST | `/scenarios/preview` | run a projection without saving (powers the wizard's live preview) |
| PATCH/DELETE | `/scenarios/{id}` | update (re-runs on change) / delete |
| POST | `/scenarios/{id}/run` | re-run |
| GET | `/scenarios/{id}/compare` | full projection (baseline vs scenario + summary) |

### Scenario assumptions — v2 (multi-year projection, `version: 2`)

Global (all optional; SA defaults applied server-side): `horizon_months`,
`annual_inflation`, `annual_income_growth`, `annual_investment_return`,
`annual_cash_return` (rates are fractions, e.g. `0.05`). Plus `events: []`, each
`{ month, kind, … }` where `kind` is one of `income_delta`, `expense_delta`,
`contribution_delta`, `one_off_income`, `one_off_expense`, `debt_extra_payment`,
`recurring_income`, `recurring_expense` (with optional `end_month`),
`lump_sum_invest`, `property_purchase` (`price_cents`, `deposit_cents`,
`annual_rate`, `term_months`, `rent_cents`), `property_sale` (`price_cents` =
proceeds, `clears_liability_cents`). Deltas take `pct` (fraction) and/or
`amount_cents`. The engine returns the full month-by-month trajectory (income,
expenses, cash, investments, liabilities, net worth) for both the scenario and a
do-nothing baseline, plus a summary (horizon net worth, net-worth delta, cash
runway, lowest cash point, break-even month, ending savings rate).

### Scenario assumptions — v1 (legacy single-month; still supported)

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
| POST | `/copilot/ask` | `{question, period_id?}` → agentic, grounded answer; the model uses read-only engine tools + per-user conversation memory. Returns `{answer, provider, citations (tools consulted), grounded}` |
| POST | `/copilot/reset` | clear the caller's copilot conversation memory |
| POST | `/insights/analyze` | run the proactive analyst for the active household now (managing roles) → `{recorded, summaries}` |
| POST | `/insights/analyze-all` | scheduled proactive analysis across all households (cron-authenticated); records insights + pushes a Telegram digest to linked chats |
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
