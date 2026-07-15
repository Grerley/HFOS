"""Excel workbook import: analyze (preview) and import."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.database import get_db
from app.deps import HouseholdContext, require_write
from app.services import import_service
from sqlalchemy.orm import Session

router = APIRouter(prefix="/import", tags=["import"])


@router.post("/workbook/analyze")
async def analyze(file: UploadFile = File(...),
                  ctx: HouseholdContext = Depends(require_write)):
    """Preview: classify sheets and detect owners without writing anything."""
    content = await file.read()
    return import_service.analyze_workbook(content)


@router.post("/workbook")
async def import_workbook(
    file: UploadFile = File(...),
    owner_mapping: str | None = Form(default=None),
    ctx: HouseholdContext = Depends(require_write),
    db: Session = Depends(get_db),
):
    """Idempotently import monthly sheets. owner_mapping is a JSON object mapping
    workbook owner names to household member ids."""
    content = await file.read()
    mapping = json.loads(owner_mapping) if owner_mapping else None
    report = import_service.import_workbook(
        db, household_id=ctx.household_id, file_bytes=content,
        owner_mapping=mapping, actor_user_id=ctx.user.id,
    )
    db.commit()
    return report
