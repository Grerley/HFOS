// Settlement engine — covers acceptance criteria AC-001..AC-005 + reversal/soft-delete.
import { describe, expect, it } from "vitest";
import { paidAmount, settlement } from "../src/lib/calc";

describe("settlement engine", () => {
  it("AC-001 full payment", () => {
    const paid = paidAmount([{ amount_cents: 500000 }]);
    const s = settlement(500000, paid);
    expect(s.paid_cents).toBe(500000);
    expect(s.outstanding_cents).toBe(0);
    expect(s.status).toBe("fully_paid");
  });

  it("AC-002 partial payment", () => {
    const s = settlement(1000000, paidAmount([{ amount_cents: 600000 }]));
    expect(s.paid_cents).toBe(600000);
    expect(s.outstanding_cents).toBe(400000);
    expect(s.status).toBe("partially_paid");
  });

  it("AC-003 multiple payments settle in full", () => {
    const paid = paidAmount([{ amount_cents: 300000 }, { amount_cents: 700000 }]);
    const s = settlement(1000000, paid);
    expect(s.paid_cents).toBe(1000000);
    expect(s.outstanding_cents).toBe(0);
    expect(s.status).toBe("fully_paid");
  });

  it("AC-004 overpayment", () => {
    const s = settlement(200000, paidAmount([{ amount_cents: 250000 }]));
    expect(s.outstanding_cents).toBe(0);
    expect(s.overpaid_cents).toBe(50000);
    expect(s.status).toBe("overpaid");
  });

  it("AC-005 overdue when unpaid and due date passed", () => {
    const s = settlement(500000, 0, { dueDate: "2025-01-01", today: "2025-02-01" });
    expect(s.status).toBe("overdue");
    expect(s.is_overdue).toBe(true);
  });

  it("not paid (unpaid, not yet due)", () => {
    const s = settlement(500000, 0, { dueDate: "2025-03-01", today: "2025-02-01" });
    expect(s.status).toBe("not_paid");
    expect(s.is_overdue).toBe(false);
  });

  it("reversal offsets the original payment", () => {
    const paid = paidAmount([
      { amount_cents: 100000 },
      { amount_cents: 100000, is_reversal: true },
    ]);
    expect(paid).toBe(0);
    expect(settlement(100000, paid).status).toBe("not_paid");
  });

  it("soft-deleted payments are excluded", () => {
    const paid = paidAmount([{ amount_cents: 100000, deleted: true }, { amount_cents: 40000 }]);
    expect(paid).toBe(40000);
  });

  it("partial + overdue keeps partially_paid status but flags overdue", () => {
    const s = settlement(100000, 40000, { dueDate: "2025-01-01", today: "2025-02-01" });
    expect(s.status).toBe("partially_paid");
    expect(s.is_overdue).toBe(true);
  });

  it("manual override wins (cancelled)", () => {
    const s = settlement(100000, 0, { manualStatus: "cancelled" });
    expect(s.status).toBe("cancelled");
    expect(s.is_overdue).toBe(false);
  });
});
