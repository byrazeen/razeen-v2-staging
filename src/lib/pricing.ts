/**
 * سياسة التسعير المعتمدة من المالك — المصدر الوحيد لكل رقم يُعرض أو يُخزَّن.
 * The owner-approved pricing policy. Single source of truth for every number
 * shown in the UI and every number written to the database.
 *
 * القواعد (بالحرف، بلا اجتهاد):
 *   1. العطر الجاهز: السعر المخزَّن للمقاس (`product_variants.price_fils`) كما هو.
 *      لا معادلة، لا مضاعِف مقاس، ولا اشتقاق. السعر المخزَّن لا يُعدَّل أبداً.
 *   2. أي مقاس بلا سعر صالح (غائب أو null أو ≤ 0) غير قابل للشراء: يُعرض
 *      «غير متاح حالياً»، ويُعطَّل زر الإضافة، ولا يُخترع له سعر بديل.
 *   3. العطر المخصص: 50ml = 280 درهم، 100ml = 320 درهم. هذان المقاسان فقط،
 *      وما عداهما تنطبق عليه القاعدة 2.
 *   4. الشحن: 25 درهم ثابتة.
 *   5. من 3 عطور فأكثر في السلة (مجموع الكميات، جاهز ومخصص معاً): الشحن مجاني
 *      **و** خصم 5% على مجموع العطور.
 *   6. نفس الأرقام في السلة وإتمام الطلب وملخّص الطلب ولوحة الإدارة — حساب واحد.
 *
 * كل الحساب بالفلس الصحيح (عدد صحيح). 100 فلس = 1 درهم. لا عدد عشري للمال
 * إطلاقاً، وتقريب الخصم معرَّف هنا مرة واحدة (تقريب النصف لأعلى على الفلس) كي لا
 * يفترق ما يراه العميل عمّا يُحفظ في الطلب.
 */

/** 100 فلس = 1 درهم. */
export const FILS_PER_AED = 100;

/** الشحن الثابت داخل الإمارات — 25 درهماً. */
export const SHIPPING_FLAT_FILS = 25 * FILS_PER_AED;

/** من ثلاث عطور فأكثر: شحن مجاني + خصم. */
export const BULK_THRESHOLD_ITEMS = 3;

/** نسبة خصم الكمية. */
export const BULK_DISCOUNT_PERCENT = 5;

/** العطر المخصص: مقاسان معتمدان فقط. */
export const CUSTOM_PRICE_FILS: Readonly<Record<string, number>> = Object.freeze({
  "50ml": 280 * FILS_PER_AED,
  "100ml": 320 * FILS_PER_AED,
});

/** النص الوحيد لحالة «لا سعر صالح». */
export const UNAVAILABLE_LABEL = "غير متاح حالياً";

export const CURRENCY = "AED" as const;

/** ما يكفي لتسعير سطر: سعر الوحدة بالفلس، والكمية. */
export interface Priceable {
  unitPriceFils: number;
  quantity: number;
}

export interface Totals {
  /** مجموع الكميات (عطور جاهزة + مخصصة). */
  itemCount: number;
  subtotalFils: number;
  discountFils: number;
  shippingFils: number;
  totalFils: number;
  /** هل انطبقت قاعدة الكمية (3 فأكثر)؟ */
  bulkApplied: boolean;
  currency: typeof CURRENCY;
}

/** رقم صحيح موجب فقط يُقبل كسعر. أي شيء آخر = لا سعر. */
function isUsableFils(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

/**
 * تقريب النصف لأعلى على الفلس — **معرَّف مرة واحدة** ويُستعمل في كل مكان.
 * حساب صحيح بالكامل: لا قسمة عشرية ولا تقريب على عدد عشري.
 */
export function roundHalfUpFils(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error("roundHalfUpFils: الحساب بالفلس الصحيح فقط");
  }
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** نسبة مئوية من مبلغ بالفلس، بتقريب النصف لأعلى. */
export function percentOfFils(amountFils: number, percent: number): number {
  if (!Number.isInteger(amountFils) || amountFils < 0) {
    throw new Error("percentOfFils: المبلغ يجب أن يكون فلساً صحيحاً غير سالب");
  }
  return roundHalfUpFils(amountFils * percent, 100);
}

/**
 * سعر عطر جاهز = السعر المخزَّن للمقاس، حرفياً. لا اشتقاق ولا بديل.
 * يعيد `null` حين لا يوجد سعر صالح — والصفحة تعرض حينها «غير متاح حالياً».
 */
export function readyMadePriceFils(storedPriceFils: number | null | undefined): number | null {
  return isUsableFils(storedPriceFils) ? storedPriceFils : null;
}

/** سعر العطر المخصص حسب المقاس. أي مقاس غير معتمد ⇒ غير قابل للشراء. */
export function customPriceFils(size: string | null | undefined): number | null {
  if (!size) return null;
  const price = CUSTOM_PRICE_FILS[size];
  return isUsableFils(price) ? price : null;
}

/** هل هذا السعر قابل للشراء أصلاً؟ */
export function isPurchasable(priceFils: number | null | undefined): boolean {
  return isUsableFils(priceFils);
}

/** مجموع السطر. */
export function lineTotalFils(line: Priceable): number {
  if (!isUsableFils(line.unitPriceFils) || !Number.isInteger(line.quantity) || line.quantity <= 0) return 0;
  return line.unitPriceFils * line.quantity;
}

/** الشحن حسب عدد العطور. */
export function shippingFilsFor(itemCount: number): number {
  return itemCount >= BULK_THRESHOLD_ITEMS ? 0 : SHIPPING_FLAT_FILS;
}

/** الخصم حسب عدد العطور ومجموعها. */
export function discountFilsFor(itemCount: number, subtotalFils: number): number {
  return itemCount >= BULK_THRESHOLD_ITEMS ? percentOfFils(subtotalFils, BULK_DISCOUNT_PERCENT) : 0;
}

/**
 * المجاميع — الحساب الوحيد في التطبيق. لا صفحة تجمع بنفسها.
 * السطور بلا سعر صالح لا تُسعَّر ولا تُحتسب (ولا يجب أن تصل السلة أصلاً).
 */
export function totals(lines: readonly Priceable[]): Totals {
  const priced = lines.filter((l) => isUsableFils(l.unitPriceFils) && Number.isInteger(l.quantity) && l.quantity > 0);
  const itemCount = priced.reduce((n, l) => n + l.quantity, 0);
  const subtotalFils = priced.reduce((n, l) => n + lineTotalFils(l), 0);
  const discountFils = discountFilsFor(itemCount, subtotalFils);
  const shippingFils = shippingFilsFor(itemCount);
  return {
    itemCount,
    subtotalFils,
    discountFils,
    shippingFils,
    totalFils: subtotalFils - discountFils + shippingFils,
    bulkApplied: itemCount >= BULK_THRESHOLD_ITEMS,
    currency: CURRENCY,
  };
}

/** صياغة العرض — من الفلس الصحيح مباشرة، بلا قسمة عشرية. */
export function formatFils(amountFils: number): string {
  const sign = amountFils < 0 ? "−" : "";
  const abs = Math.abs(Math.trunc(amountFils));
  const dirhams = Math.floor(abs / FILS_PER_AED);
  const fils = abs % FILS_PER_AED;
  return fils === 0
    ? `${sign}${dirhams} د.إ`
    : `${sign}${dirhams}.${String(fils).padStart(2, "0")} د.إ`;
}

/** الواجهة المجمّعة — للاستيراد المريح في الصفحات. */
export const RAZEEN_PRICING = {
  FILS_PER_AED,
  SHIPPING_FLAT_FILS,
  BULK_THRESHOLD_ITEMS,
  BULK_DISCOUNT_PERCENT,
  CUSTOM_PRICE_FILS,
  UNAVAILABLE_LABEL,
  currency: CURRENCY,
  roundHalfUpFils,
  percentOfFils,
  readyMadePriceFils,
  customPriceFils,
  isPurchasable,
  lineTotalFils,
  shippingFilsFor,
  discountFilsFor,
  totals,
  format: formatFils,
} as const;
