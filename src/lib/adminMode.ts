/**
 * بوّابة الإدارة الوهمية — القراءة وحدها، في ملف بلا React.
 *
 * لماذا مفصولة عن `AdminGate.tsx`؟ لأن طبقة البيانات تحتاج أن تعرف الجواب،
 * وطبقة البيانات لا تستورد مكوّنات. والجواب مطلوب لسبب واحد معلن: **مسار
 * الإدارة لا يحمل رمز ضيف أبداً**. قراءات الإدارة تبقى على الجداول كما كانت،
 * تحت سياسات RLS ودالة `admin_set_order_status`، ولا تمرّ بدوال الضيف.
 *
 * وهذه ليست مصادقة: مفتاح في `sessionStorage` لا يحمي شيئاً، والصلاحية
 * الحقيقية في `admin_users` داخل القاعدة. MOCK GATE — NOT AUTHENTICATION.
 */
export const ADMIN_GATE_KEY = "razeen_v2_staging_admin";

export const isAdminSignedIn = (): boolean =>
  typeof window !== "undefined" && window.sessionStorage.getItem(ADMIN_GATE_KEY) === "1";
