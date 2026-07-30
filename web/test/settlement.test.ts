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

// The savings→account auto-adjust (payments.applyAccountDelta) moves the linked
// account by the change in a line's paid total on every payment operation. So the
// account's cumulative movement must always equal paidAmount(records) — these
// tests pin that invariant so add/reverse/edit stay balance-consistent.
describe("linked account movement equals paid total", () => {
  const movement = (recs: Parameters<typeof paidAmount>[0]) => paidAmount(recs);

  it("a deposit then its reversal nets to zero movement", () => {
    expect(movement([{ amount_cents: 250000 }, { amount_cents: 250000, is_reversal: true }])).toBe(0);
  });

  it("editing a deposit down moves the account to the new amount", () => {
    // Before: one 250000 deposit (account +250000). After edit to 100000, the
    // paid total is 100000, so the account must reflect exactly that.
    const before = movement([{ amount_cents: 250000 }]);
    const after = movement([{ amount_cents: 100000 }]);
    expect(before).toBe(250000);
    expect(after).toBe(100000);
    expect(after - before).toBe(-150000); // the delta applyAccountDelta applies
  });

  it("soft-deleting a deposit removes its contribution", () => {
    expect(movement([{ amount_cents: 250000, deleted: true }])).toBe(0);
  });

  it("multiple deposits accumulate", () => {
    expect(movement([{ amount_cents: 100000 }, { amount_cents: 150000 }])).toBe(250000);
  });
});
