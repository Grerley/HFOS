"""Seed a representative demo household.

Creates a demo login, a household with the default taxonomy, members, accounts,
imports the synthetic sample workbook (exercising the import pipeline), and adds a
property with cash flow, goals and a scenario.

Run: python -m app.scripts.seed_db [--if-empty]
Login: demo@hfos.app / demo12345
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from sqlalchemy import select

from app.database import SessionLocal, create_all
from app.models import (
    Account,
    Goal,
    HouseholdMember,
    Property,
    PropertyCashFlow,
    Scenario,
    User,
)
from app.security import hash_password
from app.services import insight_service, scenario_service
from app.services.household_service import create_household
from app.services.import_service import import_workbook
from app.scripts.gen_sample_workbook import build_workbook

DEMO_EMAIL = "demo@hfos.app"
DEMO_PASSWORD = "demo12345"


def seed(if_empty: bool = False) -> None:
    create_all()
    db = SessionLocal()
    try:
        existing = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if existing:
            if if_empty:
                print("Demo user already exists — skipping seed.")
                return
            print("Demo user already exists — reusing it.")
            user = existing
        else:
            user = User(name="Demo Owner", email=DEMO_EMAIL,
                        password_hash=hash_password(DEMO_PASSWORD))
            db.add(user)
            db.flush()

        household = create_household(db, owner=user, name="Demo Household",
                                     base_currency="ZAR", country="ZA")
        db.flush()

        # Accounts (assets + a bond liability) for net-worth.
        db.add_all([
            Account(household_id=household.id, name="Everyday bank", type="bank",
                    currency="ZAR", current_balance_cents=8_500_00, balance_date=date.today()),
            Account(household_id=household.id, name="Investment platform", type="investment",
                    currency="ZAR", current_balance_cents=1_250_000_00, balance_date=date.today()),
            Account(household_id=household.id, name="Home bond", type="bond",
                    currency="ZAR", current_balance_cents=1_900_000_00, balance_date=date.today()),
        ])

        # Import the synthetic sample workbook → historical periods + lines.
        import io

        buf = io.BytesIO()
        build_workbook().save(buf)
        report = import_workbook(
            db, household_id=household.id, file_bytes=buf.getvalue(), actor_user_id=user.id
        )
        print(f"Imported workbook: {report['periods_imported']} periods, "
              f"{report['lines_imported']} lines.")

        # A rental property with a monthly cash-flow model.
        prop = Property(
            household_id=household.id, name="Rental unit A", address_label="12 Example Road",
            market_value_cents=2_100_000_00, outstanding_bond_cents=1_450_000_00,
            rental_status="rented",
        )
        db.add(prop)
        db.flush()
        db.add(PropertyCashFlow(
            property_id=prop.id, label="Typical month", rent_cents=15_000_00,
            bond_cents=13_800_00, levies_cents=1_900_00, rates_cents=900_00,
            utilities_cents=1_200_00, insurance_cents=450_00, maintenance_cents=800_00,
        ))

        # Goals.
        db.add_all([
            Goal(household_id=household.id, name="Emergency fund", goal_type="emergency_fund",
                 target_amount_cents=300_000_00, current_amount_cents=120_000_00,
                 target_date=date(2026, 12, 31), monthly_contribution_cents=15_000_00, priority=1),
            Goal(household_id=household.id, name="School fees 2026", goal_type="school_fees",
                 target_amount_cents=180_000_00, current_amount_cents=45_000_00,
                 target_date=date(2026, 1, 15), monthly_contribution_cents=12_000_00, priority=2),
        ])

        # A scenario against the most recent imported period.
        from app.models import BudgetPeriod

        latest = db.scalar(
            select(BudgetPeriod).where(BudgetPeriod.household_id == household.id)
            .order_by(BudgetPeriod.start_date.desc())
        )
        if latest:
            assumptions = {"income_change_pct": -0.20, "savings_increase_cents": 5_000_00}
            results = scenario_service.run_scenario(db, household.id, latest.id, assumptions)
            db.add(Scenario(
                household_id=household.id, base_period_id=latest.id,
                name="20% income reduction", description="Stress test: primary income cut by 20%.",
                assumptions_json=assumptions, projected_results_json=results,
                created_by_id=user.id,
            ))
            # Generate rule-based insights for the latest period.
            for item in insight_service.generate_period_insights(db, household.id, latest.id):
                from app.models import Insight

                db.add(Insight(
                    household_id=household.id, period_id=latest.id, type=item["type"],
                    severity=item["severity"], summary=item["summary"],
                    explanation=item["explanation"], action=item["action"],
                    evidence_json=item.get("evidence", {}),
                ))

        db.commit()
        members = db.scalars(
            select(HouseholdMember).where(HouseholdMember.household_id == household.id)
        ).all()
        print(f"Seed complete. Household '{household.name}' with {len(members)} members.")
        print(f"Login: {DEMO_EMAIL} / {DEMO_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    seed(if_empty="--if-empty" in sys.argv)
