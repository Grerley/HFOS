"""Household provisioning: create a household with default members, accounts and
the workbook-derived category taxonomy (backlog HFOS-001)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.enums import Role
from app.models import Account, Category, Household, HouseholdMember, Membership, User
from app.taxonomy import DEFAULT_TAXONOMY


def create_household(
    db: Session,
    *,
    owner: User,
    name: str,
    base_currency: str = "ZAR",
    country: str = "ZA",
    budget_cycle_day: int = 1,
    seed_defaults: bool = True,
) -> Household:
    household = Household(
        name=name,
        base_currency=base_currency,
        country=country,
        budget_cycle_day=budget_cycle_day,
        created_by_id=owner.id,
    )
    db.add(household)
    db.flush()

    db.add(Membership(user_id=owner.id, household_id=household.id, role=Role.OWNER.value))
    # The owner is also a household member (a planning entity), linked to the login user.
    db.add(
        HouseholdMember(
            household_id=household.id,
            user_id=owner.id,
            name=owner.name,
            relationship_label="self",
            role=Role.OWNER.value,
        )
    )
    db.flush()

    if seed_defaults:
        _seed_default_categories(db, household.id)
        db.add(
            Account(
                household_id=household.id,
                name="Primary bank account",
                type="bank",
                currency=base_currency,
            )
        )
    db.flush()
    return household


def _seed_default_categories(db: Session, household_id: int) -> None:
    for order, (section_name, ctype, children) in enumerate(DEFAULT_TAXONOMY):
        section = Category(
            household_id=household_id,
            name=section_name,
            type=ctype,
            sort_order=order,
            is_section=True,
        )
        db.add(section)
        db.flush()
        for cidx, child in enumerate(children):
            db.add(
                Category(
                    household_id=household_id,
                    parent_id=section.id,
                    name=child,
                    type=ctype,
                    sort_order=cidx,
                )
            )
    db.flush()
