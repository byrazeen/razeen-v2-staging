/**
 * أسماء خصائص العطر بالعربية — مصدر واحد لكل الأسطح.
 *
 * `family` و`intensity` موجودان في البيانات منذ البداية ويُستعملان في الترشيح،
 * ولم يكونا يُعرضان للعميل في أي شاشة: صفحة المنتج كانت تعرض الاسم والسعر
 * والتوفر ثم ٤٠٠ بكسل ورقٍ فارغ. هنا تُترجم القيم الموجودة فقط — لا وصف
 * مُخترع ولا «مقدّمة/قلب/قاعدة» لا يملكها الكتالوج.
 */

export const FAMILY_LABEL: Record<string, string> = {
  warm: "دافئ",
  fresh: "منعش",
  sweet: "حلو",
  woody: "خشبي",
};

export const INTENSITY_LABEL: Record<number, string> = {
  1: "خفيف",
  2: "متوسط",
  3: "قوي",
};

export const familyLabel = (f?: string | null): string | null => (f ? FAMILY_LABEL[f] ?? null : null);
export const intensityLabel = (i?: number | null): string | null =>
  (typeof i === "number" ? INTENSITY_LABEL[i] ?? null : null);

/** «دافئ · قوي» — ما يُعرف منهما فقط، بلا فاصل معلّق. */
export function facetLine(family?: string | null, intensity?: number | null): string | null {
  const parts = [familyLabel(family), intensityLabel(intensity)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
