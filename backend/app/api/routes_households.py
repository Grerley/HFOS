"""Households, members and partner invitations."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import HouseholdContext, get_current_user, get_household_context, require_admin
from app.models import HouseholdMember, Membership, User
from app.schemas import (
    HouseholdCreate,
    HouseholdOut,
    InviteRequest,
    MemberCreate,
    MemberOut,
)
from app.security import hash_password
from app.services import audit_service
from app.services.household_service import create_household

router = APIRouter(tags=["households"])


@router.post("/households", response_model=HouseholdOut, status_code=201)
def create(payload: HouseholdCreate, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)) -> HouseholdOut:
    h = create_household(
        db, owner=user, name=payload.name, base_currency=payload.base_currency,
        country=payload.country, budget_cycle_day=payload.budget_cycle_day,
    )
    db.commit()
    return HouseholdOut(
        id=h.id, name=h.name, base_currency=h.base_currency, country=h.country,
        budget_cycle_day=h.budget_cycle_day, role="owner",
    )


@router.get("/households", response_model=list[HouseholdOut])
def list_households(user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> list[HouseholdOut]:
    out = []
    for m in db.scalars(select(Membership).where(Membership.user_id == user.id)).all():
        h = m.household
        out.append(HouseholdOut(
            id=h.id, name=h.name, base_currency=h.base_currency, country=h.country,
            budget_cycle_day=h.budget_cycle_day, role=m.role,
        ))
    return out


@router.get("/members", response_model=list[MemberOut])
def list_members(ctx: HouseholdContext = Depends(get_household_context),
                 db: Session = Depends(get_db)) -> list[MemberOut]:
    rows = db.scalars(
        select(HouseholdMember).where(HouseholdMember.household_id == ctx.household_id)
    ).all()
    return [MemberOut.model_validate(m) for m in rows]


@router.post("/members", response_model=MemberOut, status_code=201)
def add_member(payload: MemberCreate, ctx: HouseholdContext = Depends(require_admin),
               db: Session = Depends(get_db)) -> MemberOut:
    user_id = None
    if payload.user_email:
        u = db.scalar(select(User).where(User.email == payload.user_email))
        if u:
            user_id = u.id
    member = HouseholdMember(
        household_id=ctx.household_id, user_id=user_id, name=payload.name,
        relationship_label=payload.relationship_label, role=payload.role,
    )
    db.add(member)
    db.flush()
    audit_service.record(
        db, action="member.create", entity_type="household_member", entity_id=member.id,
        household_id=ctx.household_id, actor_user_id=ctx.user.id, detail={"name": payload.name},
    )
    db.commit()
    return MemberOut.model_validate(member)


@router.post("/members/invite", response_model=MemberOut, status_code=201)
def invite_partner(payload: InviteRequest, ctx: HouseholdContext = Depends(require_admin),
                   db: Session = Depends(get_db)) -> MemberOut:
    """Invite a login user into the household with a role (backlog HFOS-002).

    MVP creates the account directly with a provided password; a production build
    would email a signed invitation link instead.
    """
    u = db.scalar(select(User).where(User.email == payload.email))
    if not u:
        u = User(name=payload.name, email=payload.email,
                 password_hash=hash_password(payload.password))
        db.add(u)
        db.flush()
    existing = db.scalar(
        select(Membership).where(
            Membership.user_id == u.id, Membership.household_id == ctx.household_id
        )
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "User already a member of this household")
    db.add(Membership(user_id=u.id, household_id=ctx.household_id, role=payload.role))
    member = HouseholdMember(
        household_id=ctx.household_id, user_id=u.id, name=payload.name, role=payload.role,
        relationship_label="partner",
    )
    db.add(member)
    db.flush()
    audit_service.record(
        db, action="member.invite", entity_type="membership", entity_id=member.id,
        household_id=ctx.household_id, actor_user_id=ctx.user.id,
        detail={"email": payload.email, "role": payload.role},
    )
    db.commit()
    return MemberOut.model_validate(member)
