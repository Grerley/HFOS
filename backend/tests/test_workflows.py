"""Integration tests for key end-to-end workflows through the HTTP API."""
from __future__ import annotations


def _seed_period(client, headers, planned_income=10_000_00):
    p = client.post("/budget-periods", headers=headers, json={
        "label": "Jan4Feb", "start_date": "2025-01-01", "end_date": "2025-02-28"}).json()
    cats = client.get("/categories", headers=headers).json()
    inc = next(c for c in cats if c["type"] == "income" and not c["is_section"])
    exp = next(c for c in cats if c["type"] == "expense" and not c["is_section"])
    sav = next(c for c in cats if c["type"] == "saving" and not c["is_section"])
    client.post(f"/budget-periods/{p['id']}/lines", headers=headers, json={
        "category_id": inc["id"], "item_name": "Salary",
        "planned_amount_cents": planned_income, "actual_amount_cents": planned_income})
    client.post(f"/budget-periods/{p['id']}/lines", headers=headers, json={
        "category_id": exp["id"], "item_name": "Bond",
        "planned_amount_cents": 3_000_00, "actual_amount_cents": 3_200_00})
    client.post(f"/budget-periods/{p['id']}/lines", headers=headers, json={
        "category_id": sav["id"], "item_name": "Retirement",
        "planned_amount_cents": 1_500_00, "actual_amount_cents": 1_500_00})
    return p["id"]


def test_household_setup_creates_defaults(client, auth):
    cats = client.get("/categories", headers=auth["headers"]).json()
    assert any(c["name"] == "Mandatory Obligations" for c in cats)
    members = client.get("/members", headers=auth["headers"]).json()
    assert len(members) >= 1  # the owner is a member


def test_full_budget_and_dashboard_flow(client, auth):
    pid = _seed_period(client, auth["headers"])
    d = client.get("/dashboard", headers=auth["headers"], params={"period_id": pid}).json()
    s = d["summary"]["planned"]
    assert s["total_income_cents"] == 10_000_00
    assert s["total_expenses_cents"] == 4_500_00
    assert s["net_position_cents"] == 5_500_00
    assert s["savings_rate"] == 0.15
    assert d["summary"]["variance"]["expenses"]["variance_cents"] == 200_00


def test_duplicate_period_resets_actuals(client, auth):
    pid = _seed_period(client, auth["headers"])
    dup = client.post(f"/budget-periods/{pid}/duplicate", headers=auth["headers"], json={
        "label": "Feb4Mar", "start_date": "2025-02-01", "end_date": "2025-03-31"}).json()
    lines = client.get(f"/budget-periods/{dup['id']}/lines", headers=auth["headers"]).json()
    assert len(lines) == 3
    assert all(line["actual_amount_cents"] == 0 for line in lines)  # actuals reset
    assert all(line["planned_amount_cents"] > 0 for line in lines)  # planned copied


def test_locked_period_blocks_edits(client, auth):
    pid = _seed_period(client, auth["headers"])
    client.patch(f"/budget-periods/{pid}/status", headers=auth["headers"], json={"status": "closed"})
    cats = client.get("/categories", headers=auth["headers"]).json()
    exp = next(c for c in cats if c["type"] == "expense" and not c["is_section"])
    r = client.post(f"/budget-periods/{pid}/lines", headers=auth["headers"], json={
        "category_id": exp["id"], "item_name": "Late add", "planned_amount_cents": 100_00})
    assert r.status_code == 409  # locked


def test_scenario_projects_income_cut(client, auth):
    pid = _seed_period(client, auth["headers"])
    sc = client.post("/scenarios", headers=auth["headers"], json={
        "name": "Income -20%", "base_period_id": pid,
        "assumptions_json": {"income_change_pct": -0.20}}).json()
    proj = sc["projected_results_json"]
    assert proj["baseline"]["total_income_cents"] == 10_000_00
    assert proj["projected"]["total_income_cents"] == 8_000_00
    assert proj["deltas"]["total_income_cents"]["delta"] == -2_000_00


def test_property_cash_flow_endpoint(client, auth):
    prop = client.post("/properties", headers=auth["headers"], json={
        "name": "Unit A", "market_value_cents": 2_100_000_00,
        "outstanding_bond_cents": 1_450_000_00}).json()
    client.post(f"/properties/{prop['id']}/cash-flows", headers=auth["headers"], json={
        "rent_cents": 15_000_00, "bond_cents": 13_800_00, "levies_cents": 1_900_00})
    cf = client.get(f"/properties/{prop['id']}/cash-flow", headers=auth["headers"]).json()
    assert cf["surplus_shortfall_cents"] == 15_000_00 - (13_800_00 + 1_900_00)
    assert cf["loan_to_value"] == round(1_450_000_00 / 2_100_000_00, 6)


def test_goal_monthly_requirement(client, auth):
    g = client.post("/goals", headers=auth["headers"], json={
        "name": "Emergency fund", "target_amount_cents": 300_000_00,
        "current_amount_cents": 120_000_00, "target_date": "2099-12-31",
        "monthly_contribution_cents": 10_000_00}).json()
    assert g["progress"] == round(120_000_00 / 300_000_00, 6)
    assert g["monthly_required_cents"] >= 0


def test_copilot_answer_cites_metrics(client, auth):
    pid = _seed_period(client, auth["headers"])
    ans = client.post("/copilot/ask", headers=auth["headers"], json={
        "question": "why are we over budget?", "period_id": pid}).json()
    assert ans["matched_intent"] == "over_budget"
    assert ans["citations"] and ans["citations"][0]["source"] == "calculation_engine"


def test_rbac_viewer_cannot_write(client, auth):
    # Invite a viewer, log in as them, assert writes are denied.
    client.post("/members/invite", headers=auth["headers"], json={
        "email": "viewer@test.com", "name": "Viewer", "role": "viewer",
        "password": "password123"})
    tok = client.post("/auth/login/json", json={
        "email": "viewer@test.com", "password": "password123"}).json()["access_token"]
    vheaders = {"Authorization": f"Bearer {tok}", "X-Household-Id": str(auth["household_id"])}
    r = client.post("/budget-periods", headers=vheaders, json={
        "label": "X", "start_date": "2025-01-01", "end_date": "2025-02-28"})
    assert r.status_code == 403


def test_cross_household_isolation(client, auth):
    # A second household's user must not read the first household's periods.
    pid = _seed_period(client, auth["headers"])
    other = client.post("/auth/register", json={
        "name": "Other", "email": "other@test.com", "password": "password123"}).json()
    oheaders = {"Authorization": f"Bearer {other['access_token']}",
                "X-Household-Id": str(auth["household_id"])}  # tries to target HH #1
    r = client.get("/dashboard", headers=oheaders, params={"period_id": pid})
    assert r.status_code == 403  # denied: no membership in that household
