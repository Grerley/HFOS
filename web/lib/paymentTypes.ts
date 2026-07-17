// Client-side mirror of the payment-type options (kept trivial + in sync with
// src/lib/enums.ts PaymentType). How a budget line is settled; drives Payments.
export const PAYMENT_TYPE_OPTIONS = [
  { value: "debit_order", label: "Debit order" },
  { value: "stop_order", label: "Stop order" },
  { value: "salary_deduction", label: "Salary deduction" },
  { value: "manual", label: "Manual payment" },
  { value: "other", label: "Other" },
];

export const PAYMENT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);
