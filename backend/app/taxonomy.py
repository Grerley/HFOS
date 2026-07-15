"""Default household category template, derived from the workbook sections
(requirements Appendix A). Not hard-coded into logic — it is seed configuration a
household can edit, per Appendix B: "Do not hard-code the workbook rows."
"""
from __future__ import annotations

from app.enums import CategoryType

# Each section: (name, CategoryType, [representative child line names])
DEFAULT_TAXONOMY: list[tuple[str, str, list[str]]] = [
    (
        "Income",
        CategoryType.INCOME.value,
        [
            "Monthly salary",
            "Business income",
            "Reimbursements / refunds",
            "Bonus",
            "Rental income",
            "Transfer from savings",
        ],
    ),
    (
        "Mandatory Obligations",
        CategoryType.EXPENSE.value,
        [
            "Bond",
            "Utilities (water, electricity, gas)",
            "Vehicle / transport",
            "Security",
            "Internet",
            "Phone",
            "Domestic worker",
            "Bank charges",
            "School fees",
            "Children activities",
        ],
    ),
    (
        "Insurance",
        CategoryType.EXPENSE.value,
        [
            "Car insurance",
            "Home contents",
            "Medical aid",
            "Life insurance",
            "Liability insurance",
            "Funeral policy",
        ],
    ),
    (
        "Living Expenses",
        CategoryType.EXPENSE.value,
        [
            "Groceries",
            "Subscriptions",
            "Fuel",
            "Entertainment",
            "Family support",
            "Credit accounts",
            "Professional fees",
        ],
    ),
    (
        "Property Shortfalls",
        CategoryType.EXPENSE.value,
        [
            "Property monthly funding gap",
            "Property utilities",
            "Property maintenance",
        ],
    ),
    (
        "Savings & Investments",
        CategoryType.SAVING.value,
        [
            "Retirement",
            "Trust fund",
            "College fund",
            "Emergency fund",
            "Short-term tax savings",
            "Long-term tax savings",
            "Investment platform",
            "Property fund",
        ],
    ),
    (
        "Ad hoc Expenses",
        CategoryType.EXPENSE.value,
        [
            "Advances",
            "Uniforms",
            "Once-off travel",
            "Holiday clothes",
        ],
    ),
    (
        "Discretionary",
        CategoryType.EXPENSE.value,
        [
            "Tithe",
            "Credit card",
            "Children clothing",
            "Allowances",
        ],
    ),
]
