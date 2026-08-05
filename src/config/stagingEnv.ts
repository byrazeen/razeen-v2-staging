/**
 * البيئة الفعّالة التي يفحصها الحارس.
 *
 * لا أسرار هنا ولا ملف `.env` في المستودع. هذه قيم staging افتراضية غير سرّية
 * تسمح للنسخة التجريبية بالإقلاع على أي جهاز بلا إعداد. **الأولوية دائماً
 * لمتغيّرات البيئة الحقيقية**: أي قيمة من `import.meta.env` تكتب فوق الافتراضي،
 * فإذا سُرِّبت قيمة إنتاج إلى البيئة بقي الحارس يوقف التطبيق كما هو.
 *
 * Non-secret staging defaults so the app boots without an .env file. Real env
 * values always override them, so the guard's production-signature detection is
 * unchanged and undiminished — only the "you forgot to configure it" case is
 * pre-filled. `envGuard.ts` itself is untouched.
 */
const STAGING_FALLBACKS: Record<string, string> = {
  VITE_APP_ENV: "staging",
  VITE_SUPABASE_URL: "https://stgrazeenv2placeholder.supabase.co",
  VITE_SUPABASE_PROJECT_ID: "stgrazeenv2placeholder",
  VITE_PAYMENT_MODE: "mock",
  VITE_MESSAGING_MODE: "mock",
  VITE_EMAIL_MODE: "mock",
  VITE_SHIPPING_MODE: "mock",
  VITE_ANALYTICS_MODE: "disabled",
};

function definedEntries(env: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

export const stagingEnv: Record<string, string | undefined> = {
  ...STAGING_FALLBACKS,
  ...definedEntries(import.meta.env as unknown as Record<string, unknown>),
};

export const stagingHost = typeof window !== "undefined" ? window.location.hostname : undefined;
