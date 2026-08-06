/**
 * العميل الوحيد لـSupabase — a single Supabase client for the whole app.
 *
 * لا مفتاح ولا رابط مكتوب هنا: القيم كلها من `import.meta.env` عبر
 * `stagingEnv`. ولا يُنشأ عميل إلا بعد أن يوافق الحارس على البيئة، فالاتصال
 * بمشروع غير مُثبت أنه staging ممنوع قبل أن يقع لا بعده.
 *
 * No URL and no key is written in this file. Every value comes from
 * `import.meta.env`. The client is created only after the environment guard
 * approves the environment, and a missing configuration throws a named error
 * instead of quietly building a client on `undefined`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findViolations } from "@/config/envGuard";
import { stagingEnv, stagingHost } from "@/config/stagingEnv";

/** الرابط والمفتاح، كما وصلا من البيئة. لا قيمة افتراضية للمفتاح. */
const supabaseUrl = stagingEnv.VITE_SUPABASE_URL;
const supabasePublishableKey = stagingEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

export class SupabaseConfigError extends Error {
  constructor(missing: string[]) {
    super(
      "Supabase is not configured: " +
        missing.join(", ") +
        " missing from import.meta.env. Copy .env.example to .env.local and fill the staging values."
    );
    this.name = "SupabaseConfigError";
  }
}

/** أي متغيّر ناقص؟ يُستعمل للرسالة وللاختيار معاً. */
function missingConfig(): string[] {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabasePublishableKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}

/**
 * هل البيئة تحمل إعداد Supabase كاملاً؟ هذا وحده ما يقرّر مصدر البيانات.
 * True only when BOTH the URL and the publishable key are present.
 */
export const hasSupabaseConfig = missingConfig().length === 0;

let client: SupabaseClient | null = null;

/**
 * العميل المشترك. يرمي رسالة واضحة بدل أن يبني عميلاً على `undefined`.
 * Throws rather than constructing a client on undefined values.
 */
export function getSupabaseClient(): SupabaseClient {
  const missing = missingConfig();
  if (missing.length > 0) throw new SupabaseConfigError(missing);

  // نفس منطق سجلّ المحوّلات: لا اتصال من بيئة لم يُثبت أنها staging.
  const violations = findViolations({ env: stagingEnv, host: stagingHost });
  if (violations.length > 0) {
    throw new Error(
      "Refusing to create a Supabase client in an unverified environment:\n" +
        violations.map((v) => `  • ${v}`).join("\n")
    );
  }

  if (!client) {
    client = createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
      global: { headers: { "x-razeen-env": "staging" } },
    });
  }
  return client;
}
