"""Configuration: accounts and categories (settings & admin)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import HouseholdContext, get_household_context, require_write
from app.models import Account, AccountBalance, Category
from app.schemas import (
    AccountCreate,
    AccountOut,
    BalanceCreate,
    CategoryCreate,
    CategoryOut,
)
from app.services.queries import get_scoped_or_404

router = APIRouter(tags=["config"])


# ── Accounts ────────────────────────────────────────────────────────────────
@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(ctx: HouseholdContext = Depends(get_household_context),
                  db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Account).where(Account.household_id == ctx.household_id)
    ).all()
    return [AccountOut.model_validate(a) for a in rows]


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreate, ctx: HouseholdContext = Depends(require_write),
                   db: Session = Depends(get_db)):
    account = Account(household_id=ctx.household_id, **payload.model_dump())
    db.add(account)
    db.flush()
    if payload.balance_date is not None:
        db.add(AccountBalance(account_id=account.id, as_of=payload.balance_date,
                              balance_cents=payload.current_balance_cents))
    db.commit()
    return AccountOut.model_validate(account)


@router.post("/accounts/{account_id}/balances", response_model=AccountOut)
def add_balance(account_id: int, payload: BalanceCreate,
                ctx: HouseholdContext = Depends(require_write), db: Session = Depends(get_db)):
    account = get_scoped_or_404(db, Account, ctx.household_id, account_id)
    db.add(AccountBalance(account_id=account.id, as_of=payload.as_of,
                          balance_cents=payload.balance_cents))
    # Latest dated balance becomes the current balance (backlog HFOS-011).
    if account.balance_date is None or payload.as_of >= account.balance_date:
        account.current_balance_cents = payload.balance_cents
        account.balance_date = payload.as_of
    db.commit()
    return AccountOut.model_validate(account)


# ── Categories ──────────────────────────────────────────────────────────────
@router.get("/categories", response_model=list[CategoryOut])
def list_categories(ctx: HouseholdContext = Depends(get_household_context),
                    db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Category)
        .where(Category.household_id == ctx.household_id)
        .order_by(Category.sort_order)
    ).all()
    return [CategoryOut.model_validate(c) for c in rows]


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, ctx: HouseholdContext = Depends(require_write),
                    db: Session = Depends(get_db)):
    category = Category(household_id=ctx.household_id, **payload.model_dump())
    db.add(category)
    db.commit()
    return CategoryOut.model_validate(category)
