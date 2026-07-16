// Presentation-edge formatting. The server owns all maths in integer cents;
// the client only divides by 100 to display. No financial logic lives here.

export function formatMoney(cents: number | null | undefined, currency = "ZAR"): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  return `${((fraction ?? 0) * 100).toFixed(digits)}%`;
}

export function toCents(input: string | number): number {
  const n = typeof input === "number" ? input : parseFloat(input || "0");
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2);
}
