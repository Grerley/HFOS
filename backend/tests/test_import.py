"""Import pipeline tests: classification, parsing, reconciliation and idempotency."""
from __future__ import annotations

import io

from app.database import SessionLocal
from app.models import User
from app.scripts.gen_sample_workbook import build_workbook
from app.services import calculations as calc
from app.services.household_service import create_household
from app.services.import_service import analyze_workbook, classify_sheet, import_workbook
from app.services.queries import load_lines_for_calc
from app.security import hash_password


def _workbook_bytes() -> bytes:
    buf = io.BytesIO()
    build_workbook().save(buf)
    return buf.getvalue()


def test_analyze_detects_monthly_sheets_and_owners():
    result = analyze_workbook(_workbook_bytes())
    monthly = [s for s in result["sheets"] if s["kind"] == "monthly"]
    assert len(monthly) == 3
    assert set(result["detected_owners"]) == {"Alex", "Sam", "Robin"}
    assert any(s["kind"] == "scenario" for s in result["sheets"])


def test_classify_scenario_sheet():
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(_workbook_bytes()), data_only=True)
    kind, conf = classify_sheet("Retirement scenario", wb["Retirement scenario"])
    assert kind == "scenario"


def _fresh_household():
    db = SessionLocal()
    import uuid

    user = User(name="Imp", email=f"imp-{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("password123"))
    db.add(user)
    db.flush()
    hh = create_household(db, owner=user, name="Import HH")
    db.commit()
    return db, hh.id, user.id


def test_import_reconciles_with_workbook_totals():
    db, hh_id, user_id = _fresh_household()
    try:
        report = import_workbook(db, household_id=hh_id, file_bytes=_workbook_bytes(),
                                 actor_user_id=user_id)
        db.commit()
        assert report["periods_imported"] == 3
        assert report["lines_imported"] > 0
        # Every imported period's income/expense must match the sheet's own totals.
        for rec in report["reconciliation"]:
            assert rec["imported_total_income_cents"] == rec["workbook_total_income_cents"]
            assert rec["imported_total_expenses_cents"] == rec["workbook_total_expenses_cents"]
    finally:
        db.close()


def test_import_is_idempotent():
    db, hh_id, user_id = _fresh_household()
    try:
        wb = _workbook_bytes()
        first = import_workbook(db, household_id=hh_id, file_bytes=wb, actor_user_id=user_id)
        db.commit()
        second = import_workbook(db, household_id=hh_id, file_bytes=wb, actor_user_id=user_id)
        db.commit()
        assert first["periods_imported"] == 3
        assert second["periods_imported"] == 0  # re-run does not duplicate
        assert second["periods_skipped"] == 3
    finally:
        db.close()


def test_imported_savings_rate_is_computable():
    db, hh_id, user_id = _fresh_household()
    try:
        import_workbook(db, household_id=hh_id, file_bytes=_workbook_bytes(), actor_user_id=user_id)
        db.commit()
        from app.models import BudgetPeriod
        from sqlalchemy import select

        period = db.scalar(select(BudgetPeriod).where(BudgetPeriod.household_id == hh_id))
        lines = load_lines_for_calc(db, hh_id, period.id)
        assert calc.total_income(lines) > 0
        assert 0 <= calc.savings_rate(lines) <= 1
    finally:
        db.close()
