/**
 * مطابقة العدد في العربية — قاعدة واحدة بدل تكرارها في كل شاشة.
 *
 * العربية لا تجمع كالإنجليزية: «١ صنف»، «صنفان»، «٣ أصناف»، «١١ صنفاً».
 * الواجهة كانت تكتب «٣ صنف» و«أضف ٢ عطر»، وكلاهما خطأ نحوي يقرأه قارئ الشاشة
 * حرفياً. الأشكال تُمرَّر كاملةً كي يبقى النصّ في مكان واحد قابل للمراجعة.
 */
export interface ArabicForms {
  /** لا شيء — «سلتك فاضية» مثلاً. إن غاب استُعمل شكل الجمع. */
  zero?: string;
  /** واحد — «صنف واحد». */
  one: string;
  /** اثنان — «صنفان». */
  two: string;
  /** ٣–١٠ — يُدرَج فيه العدد: «أصناف». */
  few: string;
  /** ١١ فأكثر — تمييز مفرد منصوب: «صنفاً». */
  many: string;
}

/** الشكل المناسب وحده، بلا عدد. */
export function arabicForm(n: number, forms: ArabicForms): string {
  const count = Math.abs(Math.trunc(n));
  if (count === 0) return forms.zero ?? forms.few;
  if (count === 1) return forms.one;
  if (count === 2) return forms.two;
  if (count <= 10) return forms.few;
  return forms.many;
}

/**
 * عبارة كاملة جاهزة للقراءة. المفرد والمثنّى لا يسبقهما عدد في العربية
 * الفصيحة («صنف واحد»، «صنفان») بينما ما بعدهما يسبقه العدد.
 * الأرقام غربية دائماً كي تطابق الأسعار في كل الواجهة.
 */
export function arabicCount(n: number, forms: ArabicForms): string {
  const count = Math.abs(Math.trunc(n));
  const form = arabicForm(count, forms);
  if (count === 0) return forms.zero ? form : `${count} ${form}`;
  if (count === 1 || count === 2) return form;
  return `${count} ${form}`;
}

export const ITEM_FORMS: ArabicForms = {
  zero: "فارغة", one: "صنف واحد", two: "صنفان", few: "أصناف", many: "صنفاً",
};

export const PERFUME_FORMS: ArabicForms = {
  one: "عطراً واحداً", two: "عطرين", few: "عطور", many: "عطراً",
};

export const RESULT_FORMS: ArabicForms = {
  zero: "لا نتائج", one: "نتيجة واحدة", two: "نتيجتان", few: "نتائج", many: "نتيجةً",
};

export const RECORD_FORMS: ArabicForms = {
  zero: "لا سجلات", one: "سجل واحد", two: "سجلان", few: "سجلات", many: "سجلاً",
};

export const ORDER_FORMS: ArabicForms = {
  zero: "لا طلبات", one: "طلب واحد", two: "طلبان", few: "طلبات", many: "طلباً",
};
