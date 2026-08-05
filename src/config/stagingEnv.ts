/**
 * البيئة الفعّالة التي يفحصها الحارس.
 *
 * لا أسرار هنا ولا ملف `.env` في المستودع. القيم الافتراضية غير السرّية تسمح
 * بتشغيل النسخة التجريبية محلياً بلا إعداد — **وفي خادم التطوير وحده**.
 *
 * لماذا التفريق: أحد فحوص الحارس الستة أن غياب متغيّر إعداد بحد ذاته حالة غير
 * آمنة ("نسيت الإعداد" تعني أننا لا نعرف إلى أين نتحدث). لو مُلئت القيم
 * افتراضياً في البناء المنشور لصار ذلك الفحص غير قابل للتحقق أبداً: نشرةٌ نُسي
 * فيها `VITE_SUPABASE_URL` تُقلع بهدوء نحو مشروع وهمي بدل أن تتوقف وتقول ما
 * الذي نقص. فالافتراضيات راحة للمطوّر محلياً، لا سلوك مقبول في نشرة.
 *
 * وفي الوضعين معاً **الأولوية دائماً لمتغيّرات البيئة الحقيقية**، فكشف توقيعات
 * الإنتاج لا يتأثر بشيء مما هنا. و`envGuard.ts` غير ممسوس.
 */

/** قيم staging افتراضية — غير سرّية، ولا تُستعمل إلا في خادم التطوير. */
const STAGING_FALLBACKS: Record<string, string> = {
  VITE_APP_ENV: "staging",
  VITE_SUPABASE_URL: "https://stgrazeenv2placeholder.supabase.co",
  VITE_SUPABASE_PROJECT_ID: "stgrazeenv2placeholder",
  VITE_PAYMENT_MODE: "mock",
  VITE_MESSAGING_MODE: "mock",
  VITE_EMAIL_MODE: "disabled",
  VITE_SHIPPING_MODE: "mock",
  VITE_ANALYTICS_MODE: "disabled",
};

/** السلسلة الفارغة ليست إعداداً — تُعامَل كغائبة. */
function definedEntries(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * دالة نقية، ليُثبت الاختبار الفرق بين الوضعين بدل الوثوق بتعليق.
 *
 * @param rawEnv متغيّرات البيئة كما وصلت.
 * @param isDevServer صحيح في خادم التطوير وحده.
 */
export function resolveStagingEnv(
  rawEnv: Record<string, unknown>,
  isDevServer: boolean
): Record<string, string | undefined> {
  const provided = definedEntries(rawEnv);
  return isDevServer ? { ...STAGING_FALLBACKS, ...provided } : provided;
}

export const stagingEnv: Record<string, string | undefined> = resolveStagingEnv(
  import.meta.env as unknown as Record<string, unknown>,
  import.meta.env.DEV === true
);

export const stagingHost = typeof window !== "undefined" ? window.location.hostname : undefined;
