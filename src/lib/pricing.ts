/**
 * ⚠️ STAGING_PRICING_PLACEHOLDER — NOT A PRICING POLICY.
 *
 * Deliberately trivial and deliberately loud. The production formula was found
 * to disagree with itself on 47.7% of the catalogue because the client forgot a
 * surcharge the server applied, and because 96% of prices were derived from a
 * hash of the oil code rather than from cost. None of that is reproduced here.
 *
 * The real formula (cost, floor, margin, bottle surcharge, size) is a commercial
 * decision that has not been made. Until it is, this function exists only so the
 * journey renders a number — and every number it returns is labelled in the UI.
 *
 * Do not promote this file to production. Do not "improve" it into a policy.
 */
export const STAGING_PRICING_PLACEHOLDER = true;

const SIZE_FACTOR: Record<string, number> = { "50ml": 0.6, "100ml": 1, "200ml": 1.9 };

export interface PlaceholderQuote {
  unitPrice: number;
  currency: "AED";
  isPlaceholder: true;
  note: string;
}

export function quoteCustomPerfumePlaceholder(kiloPrice: number, size: string, quantity = 1): PlaceholderQuote {
  const base = Math.round(kiloPrice / 10) + 110;
  const unitPrice = Math.max(1, Math.round(base * (SIZE_FACTOR[size] ?? 1)));
  return {
    unitPrice: unitPrice * Math.max(1, quantity) / Math.max(1, quantity),
    currency: "AED",
    isPlaceholder: true,
    note: "سعر تجريبي — لم تُعتمد سياسة تسعير العطر المخصص بعد",
  };
}
