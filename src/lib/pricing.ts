/**
 * ⚠️ STAGING_PRICING_PLACEHOLDER — سعر تجريبي، وليست سياسة تسعير.
 * ⚠️ STAGING_PRICING_PLACEHOLDER — A PLACEHOLDER, NOT THE PRICING POLICY.
 *
 * كل رقم يُعرض في هذا التطبيق يخرج من هنا وحده: العطور الجاهزة، العطر المخصص،
 * الشحن، والمجاميع. مصدر واحد لأن التدقيق وجد سعراً يُحسب في الواجهة وسعراً آخر
 * يُحصَّل على الخادم. هذه الأرقام **غير معتمدة** ولا تُنقل إلى الإنتاج.
 *
 * Every price rendered anywhere in this app comes from this single export —
 * ready-made, custom, shipping and totals. One source, because the audit found
 * the client and the server disagreeing on 47.7% of the catalogue, and 96% of
 * custom prices derived from a hash of the oil code rather than from cost.
 *
 * The real formula (cost, floor, margin, bottle surcharge, size) is a commercial
 * decision that has NOT been made. Until it is, this exists only so the journey
 * renders a number — and every number it returns is labelled in the UI.
 *
 * Do not promote this file to production. Do not "improve" it into a policy.
 */

/** الجملة الوحيدة التي تُعرض بجانب أي سعر. One note, shown wherever a price appears. */
const PLACEHOLDER_NOTE = "سعر تجريبي — لم تُعتمد سياسة التسعير بعد · staging placeholder, not final pricing";

const SIZE_FACTOR: Record<string, number> = { "50ml": 0.6, "100ml": 1, "200ml": 1.9 };

/** شحن ثابت داخل الإمارات يسقط بعد عدد أصناف — رقم تجريبي أيضاً. */
const SHIPPING_FLAT = 25;
const FREE_SHIPPING_FROM_ITEMS = 3;

export interface Quote {
  unitPrice: number;
  currency: "AED";
  /** دائماً true في staging — الواجهة تعتمد عليها لعرض التنبيه. */
  isPlaceholder: true;
  note: string;
}

export interface Priceable { unitPrice: number; quantity: number; }

export interface Totals {
  subtotal: number; shipping: number; total: number; itemCount: number;
  currency: "AED"; isPlaceholder: true; note: string;
}

/**
 * المصدر الوحيد للأسعار في staging.
 * The single pricing source. Nothing else in the app may compute a price.
 */
export const STAGING_PRICING_PLACEHOLDER = {
  isPlaceholder: true as const,
  note: PLACEHOLDER_NOTE,
  currency: "AED" as const,
  shippingFlat: SHIPPING_FLAT,
  freeShippingFromItems: FREE_SHIPPING_FROM_ITEMS,

  /** عطر جاهز: السعر المخزَّن كما هو، ومع ذلك يُوسم تجريبياً. */
  quoteReadyMade(catalogPrice: number): Quote {
    return { unitPrice: Math.max(0, Math.round(catalogPrice)), currency: "AED", isPlaceholder: true, note: PLACEHOLDER_NOTE };
  },

  /** عطر مخصص: من سعر الكيلو والحجم. رقم تجريبي بحت. */
  quoteCustom(kiloPrice: number, size: string): Quote {
    const base = Math.round(kiloPrice / 10) + 110;
    return {
      unitPrice: Math.max(1, Math.round(base * (SIZE_FACTOR[size] ?? 1))),
      currency: "AED", isPlaceholder: true, note: PLACEHOLDER_NOTE,
    };
  },

  /** عطر غير موجود في القائمة — لا يُسعَّر قبل تأكيد التوفر. */
  quoteUnlistedCustom(): Quote {
    return { unitPrice: 0, currency: "AED", isPlaceholder: true, note: PLACEHOLDER_NOTE };
  },

  lineTotal(line: Priceable): number { return line.unitPrice * line.quantity; },

  shippingFor(itemCount: number): number {
    return itemCount >= FREE_SHIPPING_FROM_ITEMS ? 0 : SHIPPING_FLAT;
  },

  /** المجاميع كلها من هنا — لا صفحة تجمع بنفسها. */
  totals(lines: Priceable[]): Totals {
    const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
    const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    const shipping = STAGING_PRICING_PLACEHOLDER.shippingFor(itemCount);
    return { subtotal, shipping, total: subtotal + shipping, itemCount, currency: "AED", isPlaceholder: true, note: PLACEHOLDER_NOTE };
  },

  /** صياغة موحّدة للعرض. */
  format(amount: number): string { return `${amount} د.إ`; },
} as const;

/** نص التنبيه، للاستيراد المباشر في المكوّنات. */
export const PLACEHOLDER_PRICE_NOTE = PLACEHOLDER_NOTE;
